import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Reuse the QR encoder shipped with our pinned qrcode-terminal dependency.
const QRCode = require('qrcode-terminal/vendor/QRCode');
const levels = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

export function qrSvg(value) {
  const qr = new QRCode(-1, levels.L);
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  const width = size + 8;
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.isDark(y, x)) cells.push('M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z');
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + width +
    '" width="480" height="480" role="img" aria-label="QR penautan WhatsApp" shape-rendering="crispEdges">' +
    '<rect width="100%" height="100%" fill="white"/><path fill="black" d="' + cells.join('') + '"/></svg>';
}

export async function pairingPage({ now = Date.now } = {}) {
  const route = '/pair/' + randomBytes(24).toString('hex');
  let svg = '', expires = 0;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if (req.url !== route || req.method !== 'GET' || req.headers.host !== new URL(url).host) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const content = svg && now() < expires ? svg :
      '<p>Menunggu QR terbaru. Halaman ini diperbarui otomatis.</p>';
    res.end('<!doctype html><html lang="id"><meta charset="utf-8"><meta http-equiv="refresh" content="2">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Tautkan bot WhatsApp</title>' +
      '<style>body{font:16px system-ui;text-align:center;margin:32px;background:#fff;color:#111}' +
      'svg{display:block;width:min(480px,90vw);height:auto;margin:24px auto}</style>' +
      '<h1>Tautkan bot WhatsApp</h1><p>WhatsApp di HP: Perangkat tertaut &gt; Tautkan perangkat.</p>' +
      content + '<p>Pindai QR di halaman ini. Jangan bagikan halaman atau QR.</p></html>');
  });
  let url;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  url = 'http://127.0.0.1:' + server.address().port + route;
  return {
    url,
    update(value) { svg = qrSvg(value); expires = now() + 20000; },
    clear() { svg = ''; expires = 0; },
    async close() {
      svg = '';
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
