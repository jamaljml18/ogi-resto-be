function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function jakartaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

function validatePaymentHistory(body = {}, now = new Date()) {
  const record = {};
  for (const [field, label] of [['user_name', 'Nama'], ['company', 'Perusahaan'], ['division', 'Divisi']]) {
    const value = body?.[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
      invalid(label + ' wajib diisi, maksimal 255 karakter.');
    }
    record[field] = value.trim();
  }
  // Tanggal selalu berasal dari waktu backend, bukan payload pengirim.
  record.payment_date = jakartaDate(now);
  return record;
}

function parseBayarCaption(caption) {
  if (typeof caption !== 'string') return null;
  const lines = caption.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() !== '/bayar') return null;
  if (lines.length !== 4) invalid('Format caption: /bayar, nama, perusahaan, divisi; masing-masing satu baris.');
  const record = validatePaymentHistory({ user_name: lines[1], company: lines[2], division: lines[3] });
  return { user_name: record.user_name, company: record.company, division: record.division };
}

function historyPage(value = '1') {
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) invalid('Halaman tidak valid.');
  return Number(value);
}


function validateManualPaymentHistory(body = {}) {
  const record = validatePaymentHistory(body);
  const date = body?.payment_date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date < '0001-01-01' || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
    invalid('Tanggal pembayaran wajib diisi dengan tanggal yang valid.');
  }
  record.payment_date = date;
  return record;
}

function paymentHistoryId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    invalid('ID riwayat pembayaran tidak valid.');
  }
  return value;
}

module.exports = { validatePaymentHistory, validateManualPaymentHistory, paymentHistoryId, historyPage, jakartaDate, parseBayarCaption };
