const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { jakartaDate, validatePaymentHistory, parseBayarCaption } = require('../src/paymentHistory');
const { validSignature, createWhatsappHandlers } = require('../src/whatsappWebhook');

const env = { WHATSAPP_VERIFY_TOKEN: 'test-verify', WHATSAPP_APP_SECRET: 'test-secret', WHATSAPP_PHONE_NUMBER_ID: '12345' };
const image = (id = 'wamid.1', caption = '/bayar\nBudi\nPT A\nHR') => ({
  id, type: 'image', image: { id: 'media-1', caption }
});
const payload = messages => ({ object: 'whatsapp_business_account', entry: [{
  changes: [{ field: 'messages', value: { metadata: { phone_number_id: '12345' }, messages } }]
}] });
function request(body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { body, rawBody, headers: {
    'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')
  } };
}
function response() {
  return { code: 200, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}

test('Backend sets Jakarta date at midnight regardless of supplied payment_date', () => {
  assert.equal(jakartaDate(new Date('2026-10-17T16:59:59Z')), '2026-10-17');
  assert.equal(jakartaDate(new Date('2026-10-17T17:00:00Z')), '2026-10-18');
  assert.equal(jakartaDate(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
  assert.equal(validatePaymentHistory({
    user_name: 'Budi', company: 'PT A', division: 'HR', payment_date: '1900-01-01'
  }, new Date('2026-10-17T17:00:00Z')).payment_date, '2026-10-18');
});

test('Caption reads exactly three identity lines, supports CRLF and rejects incomplete commands', () => {
  assert.deepEqual(parseBayarCaption(' /BAYAR\r\n Budi \r\n PT A \r\n HR '),
    { user_name: 'Budi', company: 'PT A', division: 'HR' });
  for (const caption of ['/bayar\nBudi\nPT A', '/bayar\nBudi\nPT A\nHR\nExtra', '/bayar\nBudi\nPT A\n' + 'x'.repeat(256)]) {
    assert.throws(() => parseBayarCaption(caption), error => error.status === 400);
  }
  assert.equal(parseBayarCaption('/pesan\nBudi'), null);
  assert.equal(parseBayarCaption(undefined), null);
});

test('Meta verification handshake requires configured matching verify token', () => {
  const { verify } = createWhatsappHandlers({ db: {}, env });
  const res = response();
  verify({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify', 'hub.challenge': '123456' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body, '123456');
  const bad = response();
  verify({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong' } }, bad);
  assert.equal(bad.code, 403);
  const missing = response();
  createWhatsappHandlers({ db: {}, env: {} }).verify({ query: {} }, missing);
  assert.equal(missing.code, 503);
});

test('Signature protects exact raw bytes, rejecting altered, missing and malformed signatures', async () => {
  const req = request(payload([image()]));
  assert.equal(validSignature(req.rawBody, req.headers['x-hub-signature-256'], env.WHATSAPP_APP_SECRET), true);
  assert.equal(validSignature(Buffer.from('changed'), req.headers['x-hub-signature-256'], env.WHATSAPP_APP_SECRET), false);
  for (const signature of [undefined, 'sha256=nope', 'sha256=' + '0'.repeat(64)]) {
    const res = response();
    await createWhatsappHandlers({ db: { createPaymentHistory() { throw Error('Must not save'); } }, env })
      .receive({ ...req, headers: { 'x-hub-signature-256': signature } }, res);
    assert.equal(res.code, 401);
  }
});

test('Valid image captions are saved; redelivery returns duplicate and statuses/text/wrong receiver are ignored', async () => {
  const records = new Map();
  const db = { async createPaymentHistory(record, { messageId }) {
    if (records.has(messageId)) return null;
    records.set(messageId, record);
    return { ...record, id: records.size };
  } };
  const { receive } = createWhatsappHandlers({ db, env });
  const req = request(payload([image(), image(), { type: 'text', text: { body: '/bayar\nBudi\nPT A\nHR' } },
    image('bad', '/bayar\nIncomplete'), image('other', 'Halo')]));
  const res = response(); await receive(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { saved: 1, duplicates: 1, ignored: 2, invalid: 1 });
  assert.deepEqual(records.get('wamid.1'), { user_name: 'Budi', company: 'PT A', division: 'HR' });
  const wrong = payload([image('wrong')]);
  wrong.entry[0].changes[0].value.metadata.phone_number_id = 'other-number';
  const wrongRes = response(); await receive(request(wrong), wrongRes);
  assert.equal(wrongRes.body.saved, 0); assert.equal(records.size, 1);
  const statusRes = response(); await receive(request(payload([])), statusRes);
  assert.equal(statusRes.code, 200);
});

test('Database failure requests redelivery; missing configuration never accepts a message', async () => {
  const failed = response();
  await createWhatsappHandlers({ db: { createPaymentHistory() { throw Error('Cloud unavailable'); } }, env })
    .receive(request(payload([image()])), failed);
  assert.equal(failed.code, 503);
  const missing = response();
  await createWhatsappHandlers({ db: {}, env: {} }).receive(request(payload([image()])), missing);
  assert.equal(missing.code, 503);
});


test('Meta receipt matching uses a stable signed message timestamp across redelivery',async()=>{
  const options=[];
  const db={async createPaymentHistory(_record,value){options.push(value);return {id:1};}};
  const {receive}=createWhatsappHandlers({db,env});
  const message={...image('wa.stable-time'),timestamp:'1767225600'};
  await receive(request(payload([message])),response());
  await receive(request(payload([message])),response());
  assert.equal(options[0].receivedAt,'2026-01-01T00:00:00.000Z');
  assert.equal(options[0].receivedAt,options[1].receivedAt);
});


test('Waiting errors distinguish incomplete legacy schema from missing RPC and connection failures', () => {
  const { waitingFailure } = require('../src/waitingPayments');
  assert.match(waitingFailure({code:'42703',message:'record new has no field payment_method'}).message,/006_orders_payment_columns/);
  assert.match(waitingFailure({code:'PGRST202'}).message,/fungsi pembayaran/);
  assert.match(waitingFailure({code:'42501'}).message,/Akses database/);
  assert.doesNotMatch(waitingFailure({code:'FETCH_ERROR'}).message,/migrasi/);
});
