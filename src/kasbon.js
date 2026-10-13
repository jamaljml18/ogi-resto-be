const crypto = require('crypto');
function periodBounds(month, year) {
  const m = Number(month), y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2100) {
    const error = new Error('Bulan dan tahun periode tidak valid.'); error.status = 400; throw error;
  }
  return { period: y + '-' + String(m).padStart(2,'0') + '-01',
    nextMonth: m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2,'0') + '-01' };
}
function employeeKey(order) {
  const identity = [order.user_name, order.company, order.division]
    .map(value => String(value || '').trim().toLocaleLowerCase('id-ID'));
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
function paymentMethod(order) {
  const meta = Array.isArray(order.items) ? order.items.find(item => item && item._meta) : null;
  return order.payment_method || meta?.payment_method || 'Cash';
}
function summarizeKasbon(orders, payments = []) {
  const paymentMap = new Map(payments.map(payment => [payment.employee_key, payment]));
  const groups = new Map();
  for (const order of orders) {
    const key = employeeKey(order);
    if (!groups.has(key)) groups.set(key, {
      employeeKey: key, userName: order.user_name, company: order.company, division: order.division,
      location: order.location, days: {}, totalKasbon: 0, totalCash: 0, totalOrdersCount: 0,
      isPaid: paymentMap.get(key)?.is_paid === true, paidAt: paymentMap.get(key)?.paid_at || null
    });
    const row = groups.get(key), amount = Number(order.total_price) || 0;
    const day = Number(String(order.order_date || '').split('-')[2]);
    if (!row.days[day]) row.days[day] = { hasKasbon:false, hasCash:false, kasbonAmount:0, cashAmount:0, orderCount:0 };
    const dayData = row.days[day];
    if (paymentMethod(order) === 'Kasbon') {
      row.totalKasbon += amount; dayData.kasbonAmount += amount; dayData.hasKasbon = true;
    } else {
      row.totalCash += amount; dayData.cashAmount += amount; dayData.hasCash = true;
    }
    row.totalOrdersCount++; dayData.orderCount++;
  }
  return [...groups.values()].sort((a,b) => b.totalKasbon-a.totalKasbon || a.userName.localeCompare(b.userName));
}
module.exports = { periodBounds, employeeKey, paymentMethod, summarizeKasbon };
