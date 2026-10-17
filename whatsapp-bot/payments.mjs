import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseBayarCaption } = require('../src/paymentHistory');

export function paymentFromMessage(message, allowedGroups, now = new Date()) {
  const group = message?.key?.remoteJid;
  if (!allowedGroups.has(group) || message.key.fromMe || !message.key.id || !message.key.participant) return null;
  let content = message.message;
  // Mendukung pesan sementara; foto sekali lihat sengaja tidak diproses.
  if (content?.ephemeralMessage) content = content.ephemeralMessage.message;
  const image = content?.imageMessage;
  if (!image || typeof image.caption !== 'string') return null;
  const record = parseBayarCaption(image.caption);
  if (!record) return null;
  // Namespace + hash grup/pengirim/ID pesan membedakan pesan antar grup dan dari webhook Meta.
  const id = createHash('sha256').update(JSON.stringify([group, message.key.participant, message.key.id])).digest('hex');
  return { id: 'baileys:' + id, group, record, receivedAt: now.toISOString() };
}

export function paymentQueue({ store, allowedGroups, savePayment, onResult = () => {} }) {
  let running = false;
  let accepting = Promise.resolve();
  let working = Promise.resolve();
  let closed = false;

  async function enqueue(entry) {
    if (closed) throw new Error('Antrean sedang ditutup.');
    const operation = accepting.then(async () => {
      if (!allowedGroups.has(entry.group)) return false;
      if (store.data.pending.some(item => item.id === entry.id)) return false;
      store.data.pending.push(entry);
      await store.persist();
      return true;
    });
    accepting = operation;
    return operation;
  }

  function drain() {
    if (closed || running) return working;
    running = true;
    working = (async () => {
      try {
        await accepting;
        // Snapshot agar pesan yang datang terus-menerus tidak menahan shutdown.
        for (const entry of [...store.data.pending]) {
          if (closed) break;
          if (!allowedGroups.has(entry.group)) continue;
          let payment;
          try {
            payment = await savePayment(entry.record, { messageId: entry.id, receivedAt: entry.receivedAt });
          } catch {
            onResult('retry');
            break;
          }
          store.data.pending = store.data.pending.filter(item => item.id !== entry.id);
          await store.persist();
          onResult(payment ? 'saved' : 'duplicate');
        }
      } finally { running = false; }
    })();
    return working;
  }

  async function close() {
    closed = true;
    await accepting;
    await working;
    await store.flush();
  }

  return { enqueue, drain, close, size: () => store.data.pending.length };
}
