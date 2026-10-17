import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingPhone, codeRequester } from '../phone-pairing.mjs';

test('normalisasi nomor pairing tidak menerima nomor kosong atau karakter nonangka', () => {
  assert.equal(pairingPhone('081234567890'), '6281234567890');
  assert.equal(pairingPhone('+62 812-3456-7890'), '6281234567890');
  for (const value of ['', '123', '62812abc567890', '0'.repeat(12), '1'.repeat(16)]) {
    assert.throws(() => pairingPhone(value));
  }
});

test('permintaan kode menunggu QR siap dan hanya dilakukan sekali per socket', async () => {
  let count = 0, displayed;
  const request = codeRequester({
    socket: { async requestPairingCode(phone) { count++; assert.equal(phone, '6281234567890'); return 'ABCD1234'; } },
    phone: '6281234567890', registered: () => false,
    onCode: code => { displayed = code; }, onError: () => assert.fail('unexpected failure')
  });
  await request({ connection: 'connecting' });
  assert.equal(count, 0);
  await Promise.all([request({ qr: 'synthetic' }), request({ qr: 'synthetic-next' })]);
  assert.equal(count, 1);
  assert.equal(displayed, 'ABCD1234');
});

test('sesi tertaut tidak meminta kode, kegagalan meneruskan kode status saja', async () => {
  const linked = codeRequester({
    socket: { requestPairingCode() { assert.fail('already registered'); } },
    registered: () => true, onCode: () => assert.fail('unexpected code')
  });
  await linked({ qr: 'synthetic' });
  let status;
  const request = codeRequester({
    socket: { async requestPairingCode() { throw { output: { statusCode: 428 }, secret: 'do-not-log' }; } },
    registered: () => false, onCode: () => assert.fail('unexpected code'),
    onError: value => { status = value; }
  });
  await request({ qr: 'synthetic' });
  assert.equal(status, 428);
});
