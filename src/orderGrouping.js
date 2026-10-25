const { employeeKey, paymentMethod } = require('./kasbon');

const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function groupOrdersByCustomerDay(orders) {
  const groups = new Map();
  for (const [index, original] of orders.entries()) {
    const order = { ...original,
      user_name: original.user_name || original.userName || '',
      order_date: original.order_date || original.orderDate || String(original.created_at || '').slice(0, 10),
      total_price: amount(original.total_price ?? original.totalPrice) };
    const dateKey = order.order_date || 'undated:' + (order.order_number || order.id || index);
    const key = JSON.stringify([employeeKey(order), dateKey]);
    if (!groups.has(key)) groups.set(key, {
      ...order, _group_key: key, order_count: 0, order_numbers: [], total_price: 0,
      cash_total: 0, kasbon_total: 0, _items: new Map(), _locations: new Set(),
      _days: new Set(), _methods: new Set(), _notes: []
    });
    const group = groups.get(key);
    const number = String(order.order_number || order.id || 'Pesanan ' + (index + 1));
    const method = paymentMethod(order);
    group.order_count++;
    group.order_numbers.push(number);
    group.total_price += order.total_price;
    if (method === 'Kasbon') group.kasbon_total += order.total_price;
    else group.cash_total += order.total_price;
    group._methods.add(method);
    if (order.location) group._locations.add(order.location);
    if (order.order_day || order.orderDay) group._days.add(order.order_day || order.orderDay);
    const meta = Array.isArray(order.items) ? order.items.find(item => item?._meta) : null;
    const note = order.notes || meta?.notes;
    if (note) group._notes.push(number + ': ' + note);
    if (Date.parse(order.created_at) > (Date.parse(group.created_at) || 0)) group.created_at = order.created_at;
    for (const item of Array.isArray(order.items) ? order.items : []) {
      if (!item || item._meta) continue;
      const qty = amount(item.qty), price = amount(item.price);
      if (qty <= 0) continue;
      const itemKey = JSON.stringify([item.name, price]);
      const subtotal = item.subtotal == null ? price * qty : amount(item.subtotal);
      if (!group._items.has(itemKey)) group._items.set(itemKey, { name: item.name, price, qty: 0, subtotal: 0 });
      const aggregate = group._items.get(itemKey);
      aggregate.qty += qty;
      aggregate.subtotal += subtotal;
    }
  }
  return [...groups.values()].map(group => {
    const { _items, _locations, _days, _methods, _notes, ...row } = group;
    return { ...row, items: [..._items.values()], location: [..._locations].join(' / '),
      order_day: [..._days].join(' / '), notes: _notes.join(' | '),
      payment_methods: [..._methods], payment_method: [..._methods].join(' / ') };
  });
}

module.exports = { groupOrdersByCustomerDay };
