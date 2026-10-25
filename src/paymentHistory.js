const { normalizeCompany } = require('./identity');
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
    record[field] = field === 'company' ? normalizeCompany(value) : value.trim();
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


function paymentHistoryFilters(query = {}) {
  const filters = {};
  const text = field => {
    if (query[field] === undefined || query[field] === '') return '';
    if (typeof query[field] !== 'string' || query[field].length > 255) invalid('Filter ' + field + ' tidak valid.');
    return query[field].trim();
  };
  for (const field of ['search', 'company', 'division']) {
    const value = text(field);
    if (value && value !== 'Semua') filters[field] = field === 'company' ? normalizeCompany(value) : value;
  }
  const date = text('date'), startDate = text('startDate'), endDate = text('endDate');
  const month = text('month'), year = text('year');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  for (const value of [date, startDate, endDate]) {
    if (value && !validDate(value)) invalid('Tanggal filter tidak valid.');
  }
  if (date && (startDate || endDate || month || year)) invalid('Pilih satu jenis filter tanggal.');
  if ((month || year) && (startDate || endDate)) invalid('Pilih satu jenis filter periode.');
  if (month || year) {
    if (!/^(0?[1-9]|1[0-2])$/.test(month) || !/^[1-9]\d{3}$/.test(year)) invalid('Bulan dan tahun filter tidak valid.');
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    filters.startDate = year + '-' + month.padStart(2, '0') + '-01';
    filters.endDate = year + '-' + month.padStart(2, '0') + '-' + days;
  } else {
    if (date || startDate) filters.startDate = date || startDate;
    if (date || endDate) filters.endDate = date || endDate;
  }
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    invalid('Tanggal awal tidak boleh melebihi tanggal akhir.');
  }
  return filters;
}

module.exports = { paymentHistoryFilters, validatePaymentHistory, validateManualPaymentHistory, paymentHistoryId, historyPage, jakartaDate, parseBayarCaption };
