import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { encryptedStore } from '../store.mjs';
import { authState } from '../auth.mjs';
import { paymentFromMessage, paymentQueue } from '../payments.mjs';
import { botConfig } from '../config.mjs';

const group = '120363123456789@g.us';
const allowed = new Set([group]);
const caption = '/bayar\nBudi\nPT Contoh\nProduksi';
const image = (changes = {}) => ({ key: { remoteJid: group, participant: '628123@s.whatsapp.net', id: 'MSG1', fromMe: false },
  message: { imageMessage: { caption } }, ...changes });
const env = { WA_GROUP_BOT_SESSION_KEY: 'ab'.repeat(32), WA_GROUP_BOT_ENABLED: 'true',
  WA_GROUP_BOT_ALLOWED_GROUPS: group, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'synthetic' };
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ogi-wa-bot-test-'));
  t.after(async () => {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('ogi-wa-bot-test-')) throw Error('Unexpected cleanup target');
    await rm(dir, { recursive: true, force: true });
  });
  return join(dir, 'state.enc');
}

test('Recording fails closed without enable flag, explicit group list or encryption key', () => {
  assert.equal(botConfig(env).groups.size, 1);
  assert.throws(() => botConfig({ ...env, WA_GROUP_BOT_ENABLED: 'false' }), /belum aktif/);
  assert.throws(() => botConfig({ ...env, WA_GROUP_BOT_ALLOWED_GROUPS: '' }), /ALLOWED_GROUPS/);
  assert.throws(() => botConfig({ ...env, WA_GROUP_BOT_ALLOWED_GROUPS: 'all' }), /ID grup/);
  assert.throws(() => botConfig({ ...env, WA_GROUP_BOT_SESSION_KEY: '' }), /SESSION_KEY/);
  assert.equal(botConfig({ ...env, WA_GROUP_BOT_ENABLED: 'false', WA_GROUP_BOT_ALLOWED_GROUPS: '' }, { listGroups: true }).groups.size, 0);
});

test('Only selected groups, incoming photos and valid captions produce a payment', () => {
  const entry = paymentFromMessage(image(), allowed, new Date('2026-10-17T16:59:00Z'));
  assert.equal(entry.record.user_name, 'Budi');
  assert.equal(entry.receivedAt, '2026-10-17T16:59:00.000Z');
  assert.match(entry.id, /^baileys:[a-f0-9]{64}$/);
  assert.equal(paymentFromMessage(image({ key: { ...image().key, remoteJid: '628@s.whatsapp.net' } }), allowed), null);
  assert.equal(paymentFromMessage(image({ key: { ...image().key, fromMe: true } }), allowed), null);
  assert.equal(paymentFromMessage(image({ message: { conversation: caption } }), allowed), null);
  assert.equal(paymentFromMessage(image({ message: { viewOnceMessage: { message: image().message } } }), allowed), null);
  assert.equal(paymentFromMessage(image({ message: { ephemeralMessage: { message: image().message } } }), allowed).id, entry.id);
  assert.throws(() => paymentFromMessage(image({ message: { imageMessage: { caption: '/bayar\nBudi' } } }), allowed), /Format caption/);
});

test('Message identity includes both group and sender to prevent cross-group collisions', () => {
  const first = paymentFromMessage(image(), allowed);
  const otherGroup = '120363999@g.us';
  const second = paymentFromMessage(image({ key: { ...image().key, remoteJid: otherGroup } }), new Set([otherGroup]));
  const third = paymentFromMessage(image({ key: { ...image().key, participant: '62999@s.whatsapp.net' } }), allowed);
  assert.notEqual(first.id, second.id); assert.notEqual(first.id, third.id);
});

test('Encrypted snapshots hide credentials and names, survive concurrent saves and reject wrong keys', async t => {
  const file = await temp(t), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key);
  store.data.auth.creds = { secret: 'private-login-material' };
  store.data.pending.push({ record: { user_name: 'Private Employee' } });
  await store.persist();
  store.data.auth.keys['session:user'] = { value: 2 };
  const first = store.persist();
  store.data.auth.keys['session:user'].value = 3;
  await Promise.all([first, store.persist()]);
  const raw = await readFile(file, 'utf8');
  assert.equal(raw.includes('Private Employee'), false);
  assert.equal(raw.includes('private-login-material'), false);
  const restored = await encryptedStore(file, key);
  assert.equal(restored.data.auth.keys['session:user'].value, 3);
  assert.equal(restored.data.pending.length, 1);
  await assert.rejects(() => encryptedStore(file, randomBytes(32).toString('hex')), /tidak dapat dibuka/);
});

test('Credentials, Signal keys and app state keys persist and can be removed', async t => {
  const file = await temp(t), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key);
  const api = { initAuthCreds: () => ({ registered: false }),
    proto: { Message: { AppStateSyncKeyData: { fromObject: value => ({ ...value, restored: true }) } } } };
  const auth = await authState(store, api);
  await auth.state.keys.set({ 'app-state-sync-key': { 'one': { keyData: 'synthetic' } } });
  assert.equal((await auth.state.keys.get('app-state-sync-key', ['one'])).one.restored, true);
  auth.state.creds.registered = true;
  await auth.saveCreds();
  const restored = await encryptedStore(file, key);
  assert.equal(restored.data.auth.creds.registered, true);
  await auth.state.keys.set({ 'app-state-sync-key': { 'one': null } });
  assert.deepEqual(await auth.state.keys.get('app-state-sync-key', ['one']), {});
});

test('Payment queue persists before saving, survives database failures and retries without losing received date', async t => {
  const file = await temp(t), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key);
  let failure = true, calls = 0;
  const results = [];
  const entry = paymentFromMessage(image(), allowed, new Date('2026-10-17T16:59:00Z'));
  const queue = paymentQueue({ store, allowedGroups: allowed, onResult: value => results.push(value),
    async savePayment(record, options) {
      calls++;
      assert.equal((await encryptedStore(file, key)).data.pending.length, 1);
      assert.equal(options.receivedAt, entry.receivedAt);
      if (failure) throw Error('Database offline');
      return { id: 1, ...record };
    } });
  assert.equal(await queue.enqueue(entry), true);
  assert.equal(await queue.enqueue(entry), false);
  await queue.drain();
  assert.equal(queue.size(), 1); assert.deepEqual(results, ['retry']);
  await queue.close();
  const restored = await encryptedStore(file, key);
  failure = false;
  const next = paymentQueue({ store: restored, allowedGroups: allowed,
    savePayment: async (_record, options) => { assert.equal(options.receivedAt, entry.receivedAt); return { id: 1 }; } });
  await next.drain(); assert.equal(next.size(), 0); assert.equal(calls, 1);
  assert.equal((await encryptedStore(file, key)).data.pending.length, 0);
});

test('Duplicate database results remove queued work; removed groups remain paused without being inserted', async t => {
  const file = await temp(t), key = randomBytes(32).toString('hex');
  const store = await encryptedStore(file, key);
  const entry = paymentFromMessage(image(), allowed);
  const blocked = { ...entry, id: 'blocked', group: '12036399@g.us' };
  store.data.pending.push(blocked);
  await store.persist();
  let calls = 0;
  const queue = paymentQueue({ store, allowedGroups: allowed, savePayment: async () => { calls++; return null; } });
  await queue.enqueue(entry);
  await Promise.all([queue.drain(), queue.drain()]);
  assert.equal(calls, 1);
  assert.equal(queue.size(), 1);
  assert.equal(store.data.pending[0].id, 'blocked');
});

test('Real Baileys credentials and app-state keys survive encrypted serialization without a connection', async t => {
  const b = await import('@whiskeysockets/baileys');
  const file = await temp(t), key = randomBytes(32).toString('hex');
  const codec = { stringify: value => JSON.stringify(value, b.BufferJSON.replacer),
    parse: value => JSON.parse(value, b.BufferJSON.reviver) };
  const store = await encryptedStore(file, key, codec);
  const auth = await authState(store, b);
  const expected = Buffer.from(auth.state.creds.noiseKey.public);
  await auth.state.keys.set({ 'app-state-sync-key': { sample: { keyData: Buffer.from([1, 2, 3]) } } });
  const restored = await encryptedStore(file, key, codec);
  const next = await authState(restored, b);
  assert.deepEqual(Buffer.from(next.state.creds.noiseKey.public), expected);
  const keys = await next.state.keys.get('app-state-sync-key', ['sample']);
  assert.deepEqual(Buffer.from(keys.sample.keyData), Buffer.from([1, 2, 3]));
});
