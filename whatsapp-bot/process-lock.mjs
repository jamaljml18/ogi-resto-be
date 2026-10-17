import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const busy = () => new Error('Bot masih berjalan atau lock sedang dipulihkan. Tutup proses bot lain dahulu.');

// Every acquisition uses the same exclusive gate, including stale-lock recovery.
// Do not auto-delete the gate: an interrupted recovery requires manual inspection.
export async function lockWorker(directory, { isAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
} } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'worker.lock');
  const gateFile = join(directory, 'worker-lock.guard');
  let gate;
  try { gate = await open(gateFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
  let handle;
  try {
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = Number(await readFile(file, 'utf8'));
      if (!Number.isSafeInteger(owner) || owner <= 0) {
        throw new Error('Lock bot tidak valid. Periksa proses bot sebelum memulai ulang.');
      }
      if (isAlive(owner)) throw busy();
      await unlink(file);
      handle = await open(file, 'wx', 0o600);
    }
    try { await handle.writeFile(String(process.pid)); }
    catch (error) {
      await handle.close();
      await unlink(file);
      throw error;
    }
  } finally {
    await gate.close();
    await unlink(gateFile);
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  };
}
