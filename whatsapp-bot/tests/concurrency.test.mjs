import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { lockWorker } from '../process-lock.mjs';
import { encryptedStore } from '../store.mjs';
import { paymentQueue } from '../payments.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ogi-wa-race-'));
  t.after(async () => {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('ogi-wa-race-')) throw Error('Unsafe cleanup target');
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}
const group = '120363123456789@g.us';
const allowedGroups = new Set([group]);
const entry = id => ({ id, group, record: { user_name: 'Synthetic', company: 'PT Test', division: 'QA' },
  receivedAt: '2026-10-17T12:00:00Z' });
const barrier = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

test('simultaneous worker startup grants exactly one lock', async t => {
  const dir = await temporary(t);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => lockWorker(dir)));
  const winners = results.filter(r => r.status === 'fulfilled');
  try {
    assert.equal(winners.length, 1);
    assert.equal(await readFile(join(dir, 'worker.lock'), 'utf8'), String(process.pid));
  } finally { for (const winner of winners) await winner.value(); }
});

test('simultaneous stale-lock recovery cannot remove the winner lock', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'worker.lock'), '2147483647');
  const results = await Promise.allSettled(Array.from({ length: 16 }, () =>
    lockWorker(dir, { isAlive: pid => pid === process.pid })));
  const winners = results.filter(r => r.status === 'fulfilled');
  try {
    assert.equal(winners.length, 1);
    assert.equal(await readFile(join(dir, 'worker.lock'), 'utf8'), String(process.pid));
  } finally { for (const winner of winners) await winner.value(); }
  const release = await lockWorker(dir);
  await release();
  await release();
});

test('invalid lock and interrupted recovery fail closed', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'worker.lock'), 'invalid');
  await assert.rejects(() => lockWorker(dir), /Lock bot tidak valid/);
  await writeFile(join(dir, 'worker-lock.guard'), '');
  await assert.rejects(() => lockWorker(dir), /lock sedang dipulihkan/);
});

test('concurrent enqueue and drain retain every unique payment and serialize database calls', async t => {
  const dir = await temporary(t), file = join(dir, 'runtime.enc'), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key);
  const firstWrite = barrier(), started = barrier();
  const seen = new Set();
  let active = 0, maximum = 0;
  const queue = paymentQueue({ store, allowedGroups, async savePayment(_record, { messageId }) {
    active++; maximum = Math.max(maximum, active);
    if (messageId === 'first') { started.release(); await firstWrite.promise; }
    assert.ok(!seen.has(messageId)); seen.add(messageId);
    active--;
    return { id: messageId };
  } });
  await queue.enqueue(entry('first'));
  const drain = queue.drain();
  await started.promise;
  const accepted = await Promise.all(Array.from({ length: 80 }, (_, i) => queue.enqueue(entry('message-' + (i % 40)))));
  assert.equal(accepted.filter(Boolean).length, 40);
  const overlapping = Array.from({ length: 15 }, () => queue.drain());
  firstWrite.release();
  await Promise.all([drain, ...overlapping]);
  await queue.drain();
  assert.equal(maximum, 1);
  assert.equal(seen.size, 41);
  await queue.close();
  assert.equal((await encryptedStore(file, key)).data.pending.length, 0);
});

test('shutdown waits for in-flight save and keeps unprocessed payments for restart', async t => {
  const dir = await temporary(t), file = join(dir, 'runtime.enc'), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key), entered = barrier(), finish = barrier();
  const queue = paymentQueue({ store, allowedGroups, async savePayment() {
    entered.release(); await finish.promise; return { id: 1 };
  } });
  await queue.enqueue(entry('one')); await queue.enqueue(entry('two'));
  const drain = queue.drain();
  await entered.promise;
  const closing = queue.close();
  await assert.rejects(() => queue.enqueue(entry('three')), /ditutup/);
  finish.release();
  await Promise.all([closing, drain]);
  assert.deepEqual((await encryptedStore(file, key)).data.pending.map(row => row.id), ['two']);
});

test('crash after database commit before queue acknowledgement retries without another insert', async t => {
  const dir = await temporary(t), file = join(dir, 'runtime.enc'), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key), committed = new Set();
  const queue = paymentQueue({ store, allowedGroups, async savePayment(_record, { messageId }) {
    committed.add(messageId);
    throw Error('Synthetic lost database response after commit');
  } });
  await queue.enqueue(entry('one')); await queue.drain(); await queue.close();
  const restored = await encryptedStore(file, key), outcomes = [];
  const retry = paymentQueue({ store: restored, allowedGroups, onResult: result => outcomes.push(result),
    async savePayment(_record, { messageId }) {
      assert.ok(committed.has(messageId));
      return null; // Unique constraint / ignoreDuplicates on the database side.
    } });
  await retry.drain(); await retry.close();
  assert.equal(committed.size, 1);
  assert.deepEqual(outcomes, ['duplicate']);
  assert.equal((await encryptedStore(file, key)).data.pending.length, 0);
});
