import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export async function encryptedStore(file, keyHex, codec = JSON) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('Kunci penyimpanan bot tidak valid.');
  const key = Buffer.from(keyHex, 'hex');
  let data = { auth: { creds: null, keys: {} }, pending: [] };
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    if (stored.version !== 1) throw new Error('Format penyimpanan bot tidak dikenal.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(stored.body, 'base64')), decipher.final()]);
    data = codec.parse(plaintext.toString('utf8'));
    if (!data.auth || !Array.isArray(data.pending)) throw new Error('Format data bot tidak valid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Data bot tidak dapat dibuka. Periksa kunci sesi; jangan menghapus file untuk melewati error ini.');
  }
  let tail = Promise.resolve();
  function persist() {
    const snapshot = codec.stringify(data);
    tail = tail.then(async () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(snapshot, 'utf8'), cipher.final()]);
      const stored = JSON.stringify({ version: 1, iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'), body: encrypted.toString('base64') });
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = file + '.tmp';
      await writeFile(temporary, stored, { encoding: 'utf8', mode: 0o600, flush: true });
      await rename(temporary, file);
    });
    return tail;
  }
  return { data, persist, flush: () => tail };
}
