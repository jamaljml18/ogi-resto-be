const crypto = require('crypto');
const { parseBayarCaption } = require('./paymentHistory');

function validSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

function createWhatsappHandlers({ db, env = process.env }) {
  function verify(req, res) {
    if (!env.WHATSAPP_VERIFY_TOKEN) return res.status(503).json({ error: 'Webhook WhatsApp belum dikonfigurasi.' });
    const query = req.query || {};
    if (query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== env.WHATSAPP_VERIFY_TOKEN ||
        typeof query['hub.challenge'] !== 'string') {
      return res.status(403).json({ error: 'Verifikasi webhook ditolak.' });
    }
    return res.status(200).send(query['hub.challenge']);
  }

  async function receive(req, res) {
    if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_PHONE_NUMBER_ID) {
      return res.status(503).json({ error: 'Webhook WhatsApp belum dikonfigurasi.' });
    }
    if (!validSignature(req.rawBody, req.headers?.['x-hub-signature-256'], env.WHATSAPP_APP_SECRET)) {
      return res.status(401).json({ error: 'Signature webhook tidak valid.' });
    }
    const counts = { saved: 0, duplicates: 0, ignored: 0, invalid: 0 };
    const payload = req.body;
    if (payload?.object !== 'whatsapp_business_account') return res.status(200).json(counts);
    try {
      for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
          const value = change?.value;
          if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID) continue;
          for (const message of Array.isArray(value.messages) ? value.messages : []) {
            // Foto dan caption dikirim sebagai satu pesan. Teks terpisah tidak diproses.
            if (message?.type !== 'image' || typeof message.image?.id !== 'string' || !message.image.id) {
              counts.ignored++;
              continue;
            }
            let record;
            try {
              record = parseBayarCaption(message.image.caption);
              if (!record) { counts.ignored++; continue; }
              if (typeof message.id !== 'string' || !message.id || message.id.length > 255) {
                counts.invalid++;
                continue;
              }
            } catch (error) {
              if (error.status !== 400) throw error;
              counts.invalid++;
              continue;
            }
            const payment = await db.createPaymentHistory(record, { messageId: message.id });
            if (payment) counts.saved++;
            else counts.duplicates++;
          }
        }
      }
      return res.status(200).json(counts);
    } catch {
      // Non-2xx memungkinkan Meta mengirim ulang; ID pesan mencegah pencatatan ganda.
      return res.status(503).json({ error: 'Riwayat pembayaran belum tersimpan. Coba kirim ulang webhook.' });
    }
  }

  return { verify, receive };
}

module.exports = { validSignature, createWhatsappHandlers };
