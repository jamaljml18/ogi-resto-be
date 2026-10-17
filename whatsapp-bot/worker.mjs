import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { lockWorker } from './process-lock.mjs';
import { createInterface } from 'node:readline/promises';
import { pairingPhone, codeRequester } from './phone-pairing.mjs';
import { pairingPage } from './pairing.mjs';
import { botConfig } from './config.mjs';
import { encryptedStore } from './store.mjs';
import { authState } from './auth.mjs';
import { paymentFromMessage, paymentQueue } from './payments.mjs';

const require = createRequire(import.meta.url);
const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
require('dotenv').config({ path: join(backendDir, '.env'), quiet: true });

async function main() {
  const listGroups = process.argv.includes('--list-groups');
  const check = process.argv.includes('--check');
  const useCode = process.argv.includes('--pairing-code');
  const config = botConfig(process.env, { listGroups: listGroups || check, backendDir });
  if (check) {
    console.log('[Bot] Konfigurasi terenkripsi valid.');
    console.log('[Bot] Aktif: ' + (process.env.WA_GROUP_BOT_ENABLED === 'true' ? 'ya' : 'belum'));
    console.log('[Bot] Grup yang diizinkan: ' + config.groups.size);
    console.log('[Bot] Pemeriksaan ini tidak menghubungkan WhatsApp atau menulis pembayaran.');
    return;
  }

  const stateDir = join(backendDir, 'whatsapp-bot', '.state');
  const release = await lockWorker(stateDir);
  let store, queue, socket, retryTimer, drainTimer, pairing;
  let stopping = false, attempts = 0, listed = false;
  let phone;
  const metadata = new Map();
  async function stop(message, code = 0) {
    if (stopping) return;
    stopping = true;
    clearTimeout(retryTimer);
    clearInterval(drainTimer);
    socket?.ev.removeAllListeners('messages.upsert');
    socket?.ev.removeAllListeners('connection.update');
    socket?.ev.removeAllListeners('creds.update');
    socket?.end(new Error('Bot stopped'));
    try {
      await queue?.close();
      await store?.flush();
      await pairing?.close();
    } catch { code = 1; console.error('[Bot] Ada data antrean/sesi yang belum berhasil ditulis. Periksa disk sebelum memulai ulang.'); }
    await release().catch(() => {});
    if (message) console.log('[Bot] ' + message);
    process.exit(code);
  }
  const fatal = message => stop(message, 1);
  process.once('SIGINT', () => { void stop('Bot dihentikan. Antrean tersimpan.'); });
  process.once('SIGTERM', () => { void stop('Bot dihentikan. Antrean tersimpan.'); });

  try {
    const baileys = await import('@whiskeysockets/baileys');
    const { default: makeWASocket, BufferJSON, initAuthCreds, proto,
      makeCacheableSignalKeyStore, DisconnectReason } = baileys;
    const { default: pino } = await import('pino');
    const { default: qrCode } = await import('qrcode-terminal');
    const logger = pino({ level: 'silent' });
    store = await encryptedStore(join(stateDir, 'runtime.enc'), config.key, {
      stringify: value => JSON.stringify(value, BufferJSON.replacer),
      parse: value => JSON.parse(value, BufferJSON.reviver)
    });
    if (process.argv.includes('--reset-session')) {
      if (!listGroups) throw new Error('Penautan ulang hanya tersedia melalui npm.cmd run bot:pair.');
      store.data.auth = { creds: null, keys: {} };
      await store.persist();
    }
    const auth = await authState(store, { initAuthCreds, proto });
    if (useCode && !auth.state.creds.registered) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        phone = pairingPhone(await prompt.question('[Bot] Nomor WhatsApp bot (contoh 6281234567890): '));
      } finally { prompt.close(); }
      console.log('[Bot] Di HP, pilih Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon saja.');
    }
    if (!useCode) {
      pairing = await pairingPage();
      console.log('[Bot] Buka halaman QR di browser komputer ini: ' + pairing.url);
    }

    if (!listGroups) {
      const db = require('../src/db.js');
      await db.getPaymentHistory(1);
      queue = paymentQueue({
        store, allowedGroups: config.groups,
        savePayment: (record, options) => db.createPaymentHistory(record, options),
        onResult: result => {
          const text = { saved: 'Pembayaran tersimpan.', duplicate: 'Pesan duplikat dilewati.',
            retry: 'Database belum tersedia; pembayaran tetap di antrean untuk dicoba ulang.' };
          console.log('[Bot] ' + text[result]);
        }
      });
      console.log('[Bot] Menjalankan pencatatan untuk ' + config.groups.size + ' grup. Tidak mengirim balasan.');
      console.log('[Bot] Antrean tertunda: ' + queue.size());
      drainTimer = setInterval(() => { void queue.drain().catch(() => fatal('Penyimpanan antrean gagal.')); }, 5000);
    }

    async function connect() {
      if (stopping) return;
      socket = makeWASocket({
        logger,
        auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: jid => listGroups || !config.groups.has(jid),
        cachedGroupMetadata: async jid => metadata.get(jid)
      });
      const current = socket;
      const requestCode = phone ? codeRequester({
        socket: current, phone, registered: () => auth.state.creds.registered,
        onCode: code => {
          if (stopping || current !== socket) return;
          console.log('[Bot] Kode penautan: ' + code.slice(0, 4) + '-' + code.slice(4));
          console.log('[Bot] Masukkan kode ini di WhatsApp HP. Kode bukan SMS/OTP; jangan bagikan.');
        },
        onError: status => {
          if (stopping || current !== socket) return;
          void fatal('Permintaan kode penautan gagal (status ' + (Number.isInteger(status) ? status : 'tidak tersedia') + '). Periksa koneksi dan coba kembali melalui bot:code.');
        }
      }) : null;
      current.ev.on('creds.update', () => {
        void auth.saveCreds().catch(() => fatal('Penyimpanan sesi gagal. Bot dihentikan.'));
      });

      if (!listGroups) current.ev.on('messages.upsert', event => {
        if (stopping || event.type !== 'notify') return;
        for (const message of event.messages || []) {
          let entry;
          try { entry = paymentFromMessage(message, config.groups); }
          catch {
            console.log('[Bot] Caption pembayaran tidak valid. Gunakan /bayar, nama, perusahaan, divisi; masing-masing satu baris.');
            continue;
          }
          if (!entry) continue;
          void queue.enqueue(entry).then(() => queue.drain())
            .catch(() => fatal('Pembayaran gagal ditulis ke antrean lokal. Periksa penyimpanan.'));
        }
      });

      current.ev.on('connection.update', update => {
        if (stopping || current !== socket) return;
        if (requestCode) void requestCode(update);
        if (update.qr && !useCode) {
          pairing.update(update.qr);
          console.log('[Bot] Pindai QR di terminal melalui WhatsApp nomor bot > Perangkat tertaut. Jangan bagikan QR.');
          qrCode.generate(update.qr, { small: true });
        }
        if (update.connection === 'open') {
          pairing?.clear();
          attempts = 0;
          console.log('[Bot] WhatsApp terhubung.');
          void current.groupFetchAllParticipating().then(async groups => {
            if (stopping || current !== socket) return;
            for (const [id, group] of Object.entries(groups)) metadata.set(id, group);
            if (listGroups && !listed) {
              listed = true;
              console.log('[Bot] Salin ID grup tujuan ke WA_GROUP_BOT_ALLOWED_GROUPS di backend/.env:');
              for (const [id, group] of Object.entries(groups)) console.log(id + '  ' + group.subject);
              await stop('Daftar grup selesai. Sesi siap dipakai pada proses bot.');
            } else if (!listGroups) {
              const absent = [...config.groups].filter(id => !groups[id]);
              if (absent.length) return fatal('Nomor bot belum menjadi anggota seluruh grup yang dipilih. Jalankan bot:groups untuk memeriksa ID.');
              console.log('[Bot] Grup tujuan sudah diverifikasi. Menunggu foto dengan caption /bayar.');
              await queue.drain();
            }
          }).catch(() => {
            if (!stopping && current === socket) void fatal('Tidak dapat memeriksa grup atau memuat antrean. Jalankan ulang bot.');
          });
        }
        if (update.connection === 'close') {
          pairing?.clear();
          current.ev.removeAllListeners('messages.upsert');
          current.ev.removeAllListeners('connection.update');
          current.ev.removeAllListeners('creds.update');
          const status = update.lastDisconnect?.error?.output?.statusCode;
          const terminal = [DisconnectReason.loggedOut, DisconnectReason.badSession,
            DisconnectReason.connectionReplaced, DisconnectReason.forbidden].includes(status);
          if (terminal) {
            void stop('Sesi WhatsApp berakhir (kode ' + status + '). Periksa perangkat tertaut; gunakan bot:pair untuk menautkan ulang.', 1);
          } else if (++attempts > 10) {
            void stop('Koneksi gagal 10 kali. Periksa internet, lalu jalankan ulang bot.', 1);
          } else {
            const delay = status === DisconnectReason.restartRequired ? 500 : Math.min(30000, 1000 * 2 ** (attempts - 1));
            console.log('[Bot] Koneksi terputus (kode ' + (Number.isInteger(status) ? status : 'tidak tersedia') + '). Mencoba kembali dalam ' + Math.ceil(delay / 1000) + ' detik.');
            retryTimer = setTimeout(() => { void connect().catch(() => fatal('Gagal menghubungkan ulang WhatsApp.')); }, delay);
          }
        }
      });
    }
    await connect();
  } catch (error) {
    // Jangan mencetak error library mentah: bisa berisi kredensial atau isi pesan.
    const safe = ['WA_', 'Bot ', 'Konfigurasi ', 'ID grup ', 'Isi ', 'Data bot ', 'Kunci ', 'Penautan ', 'Nomor bot ']
      .some(prefix => error.message?.startsWith(prefix));
    await stop(safe ? error.message : 'Bot gagal dimulai. Periksa instalasi, konfigurasi Supabase, migrasi 002-004, dan penyimpanan sesi.', 1);
  }
}

main().catch(error => {
  console.error('[Bot] ' + error.message);
  process.exitCode = 1;
});
