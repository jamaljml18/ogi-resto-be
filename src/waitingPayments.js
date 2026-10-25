const crypto = require('crypto');
function waitingIdentity(value) {
  return JSON.stringify([value.user_name,value.company,value.division]
    .map(field => String(field || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID')));
}

function problem(status, message) { const error = new Error(message); error.status = status; return error; }
function tokenHash(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw problem(400, 'Token status pesanan tidak valid.');
  return crypto.createHash('sha256').update(token).digest('hex');
}
function orderReference(value) {
  if (typeof value !== 'string' || !/^ORD-[A-Za-z0-9-]{1,46}$/.test(value)) throw problem(400, 'Nomor pesanan tidak valid.');
  return value;
}
function waitingFailure(error) {
  if (error?.code === '42703') return problem(503, 'Struktur tabel pesanan belum lengkap. Jalankan migrasi 006_orders_payment_columns.sql di Supabase, lalu coba lagi.');
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) return problem(503, 'Tabel atau fungsi pembayaran belum tersedia. Jalankan migrasi 005 dan 006 di Supabase.');
  if (error?.code === '42501') return problem(503, 'Akses database pembayaran ditolak. Periksa service_role atau secret key pada backend.');
  if (error?.code === '23505') return problem(409, 'Masih ada pesanan menunggu untuk nama, perusahaan, dan divisi ini. Selesaikan pesanan tersebut terlebih dahulu.');
  if (error?.message?.includes('WAITING_ALREADY_PROCESSED')) return problem(409, 'Pesanan sudah diproses. Muat ulang daftar.');
  if (error?.message?.includes('WAITING_NOT_FOUND')) return problem(404, 'Pesanan menunggu tidak ditemukan.');
  return problem(503, 'Perubahan pembayaran belum dapat dikonfirmasi. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi.');
}
function settleLocal(store, number, action, actor) {
  const status = (store.order_payment_status || []).find(row => row.order_number === number);
  if (!status) throw problem(404, 'Pesanan menunggu tidak ditemukan.');
  const target = action === 'pay' ? 'paid' : 'deleted';
  if (status.status !== 'waiting') {
    if (status.status === target) return { status: target, order_number: number };
    throw problem(409, 'Pesanan sudah diproses. Muat ulang daftar.');
  }
  const waiting = (store.waiting_payments || []).find(row => row.order_number === number);
  if (!waiting) throw problem(404, 'Pesanan menunggu tidak ditemukan.');
  if (action === 'pay') {
    if (store.orders.some(row => row.order_number === number)) throw problem(409, 'Nomor pesanan sudah tercatat.');
    const order = { ...waiting, id: store.orders.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1 };
    store.orders.unshift(order); status.order_id = order.id;
  }
  store.waiting_payments = store.waiting_payments.filter(row => row.order_number !== number);
  Object.assign(status, { status: target, processed_by: actor, updated_at: new Date().toISOString() });
  return { status: target, order_number: number };
}
function settleMatchingLocal(store, record, paymentId, receivedAt, actor) {
  const match = (store.waiting_payments || []).find(row => waitingIdentity(row) === waitingIdentity(record) &&
    Date.parse(row.created_at) <= Date.parse(receivedAt));
  if (!match) return [];
  settleLocal(store, match.order_number, 'pay', actor);
  store.order_payment_status.find(row => row.order_number === match.order_number).history_payment_id = paymentId;
  return [match.order_number];
}
module.exports = { waitingIdentity, problem, tokenHash, orderReference, waitingFailure, settleLocal, settleMatchingLocal };
