import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingPage, qrSvg } from '../pairing.mjs';

test('QR browser berbentuk persegi dengan bingkai putih empat modul', () => {
  const svg = qrSvg('synthetic-pairing-value');
  assert.match(svg, /viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /width="480" height="480"/);
  assert.match(svg, /M4 4h1v1h-1z/);
  assert.ok(!svg.includes('synthetic-pairing-value'));
});

test('halaman lokal membatasi akses, memperbarui QR, dan membuang QR kedaluwarsa', async t => {
  let time = 0;
  const page = await pairingPage({ now: () => time });
  t.after(() => page.close());
  assert.ok(page.url.startsWith('http://127.0.0.1:'));
  assert.equal((await fetch(new URL('/', page.url))).status, 404);
  let response = await fetch(page.url);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!(await response.text()).includes('<svg'));
  page.update('synthetic-first');
  assert.ok((await (await fetch(page.url)).text()).includes(qrSvg('synthetic-first')));
  page.update('synthetic-second');
  assert.ok((await (await fetch(page.url)).text()).includes(qrSvg('synthetic-second')));
  time = 20001;
  assert.ok(!(await (await fetch(page.url)).text()).includes('<svg'));
  page.update('synthetic-third');
  page.clear();
  assert.ok(!(await (await fetch(page.url)).text()).includes('<svg'));
});
