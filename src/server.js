const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { DAYS_OF_WEEK } = require('./seedData');
const { periodBounds, employeeKey, summarizeKasbon } = require('./kasbon');

const { validateManualPaymentHistory, paymentHistoryId, historyPage } = require('./paymentHistory');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    if (req.originalUrl.split('?')[0] === '/api/webhooks/whatsapp') req.rawBody = Buffer.from(buffer);
  }
}));

// Helper: Nama hari dalam Bahasa Indonesia dari Date
function getIndonesianDayName(date = new Date()) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

// Helper: Proteksi CSV Injection
function sanitizeForCsv(str) {
  if (typeof str !== 'string') return String(str ?? '');
  let trimmed = str.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return "'" + trimmed;
  }
  return trimmed;
}

// Simple Stateless Token Authentication
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_SECRET = process.env.JWT_SECRET || 'secret-catering-token';

function generateToken(username) {
  const payload = Buffer.from(JSON.stringify({
    username, role: 'admin', exp: Date.now() + 24 * 60 * 60 * 1000
  })).toString('base64url');
  const signature = crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + signature;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const expected = crypto.createHmac('sha256',TOKEN_SECRET).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1],'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if (payload.role !== 'admin' || payload.username !== ADMIN_USER ||
        !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {return null;}
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.' });
  }
  req.user = user;
  next();
}

// ==========================================
// 1. ENDPOINT AUTENTIKASI ADMIN
// ==========================================
app.post(['/api/auth/login', '/api/admin/login'], (req, res) => {
  const { username, password } = req.body;
  const isEnvMatch = username === ADMIN_USER && password === ADMIN_PASS;
  if (isEnvMatch) {
    const token = generateToken(username);
    return res.json({
      success: true,
      token,
      user: { username, role: 'admin' }
    });
  }
  return res.status(401).json({ error: 'Username atau password admin salah!' });
});

// ==========================================
// 2. ENDPOINT PELANGGAN (PUBLIC)
// ==========================================

// Daftar hari
app.get('/api/days', (req, res) => {
  res.json({
    days: DAYS_OF_WEEK,
    today: getIndonesianDayName()
  });
});

// Ambil Menu Aktif untuk hari tertentu (default: hari ini)
app.get('/api/menu', async (req, res) => {
  try {
    const day = req.query.day || getIndonesianDayName();
    const menus = await db.getMenusByDay(day);
    res.json({
      day,
      menus
    });
  } catch (err) {
    console.error('Error get menu:', err);
    res.status(500).json({ error: 'Gagal memuat menu: ' + err.message });
  }
});

// Kirim Pesanan Baru
app.post('/api/orders', async (req, res) => {
  try {
    const {
      userName,
      company,
      division,
      location,
      items,
      totalPrice,
      orderDay,
      orderDate,
      paymentMethod,
      notes
    } = req.body;

    // Validasi form data diri
    if (!userName || typeof userName !== 'string' || !userName.trim()) {
      return res.status(400).json({ error: 'Nama pemesan wajib diisi!' });
    }
    if (!company || typeof company !== 'string' || !company.trim()) {
      return res.status(400).json({ error: 'Perusahaan wajib diisi atau dipilih!' });
    }
    if (!division || typeof division !== 'string' || !division.trim()) {
      return res.status(400).json({ error: 'Divisi wajib diisi atau dipilih!' });
    }
    if (!location || typeof location !== 'string' || !location.trim()) {
      return res.status(400).json({ error: 'Lokasi makanan wajib diisi atau dipilih!' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Minimal harus memilih 1 menu makanan!' });
    }

    // Validasi & re-kalkulasi item untuk mencegah manipulasi harga
    let calculatedTotal = 0;
    const sanitizedItems = [];
    for (const item of items) {
      const qty = parseInt(item.qty, 10);
      const price = parseInt(item.price, 10);
      if (isNaN(qty) || qty <= 0) continue;
      const subtotal = (isNaN(price) ? 0 : price) * qty;
      calculatedTotal += subtotal;
      sanitizedItems.push({
        name: sanitizeForCsv(item.name),
        price: isNaN(price) ? 0 : price,
        qty,
        subtotal
      });
    }

    if (sanitizedItems.length === 0) {
      return res.status(400).json({ error: 'Daftar pesanan tidak valid!' });
    }

    const newOrder = await db.createOrder({
      userName: sanitizeForCsv(userName),
      company: sanitizeForCsv(company),
      division: sanitizeForCsv(division),
      location: sanitizeForCsv(location),
      items: sanitizedItems,
      totalPrice: calculatedTotal,
      orderDay: orderDay || getIndonesianDayName(),
      orderDate,
      paymentMethod: paymentMethod === 'Kasbon' ? 'Kasbon' : 'Cash',
      notes: notes ? sanitizeForCsv(notes) : ''
    });

    res.status(201).json({
      success: true,
      message: 'Pesanan berhasil dicatat!',
      order: newOrder
    });
  } catch (err) {
    console.error('Error submit order:', err);
    res.status(500).json({ error: 'Gagal menyimpan pesanan: ' + err.message });
  }
});

// ==========================================
// 3. ENDPOINT ADMIN (PROTECTED)
// ==========================================

// Ambil semua master menu beserta jadwal Senin s/d Minggu
app.get('/api/admin/menus', requireAuth, async (req, res) => {
  try {
    const data = await db.getAllMenusWithSchedules();
    res.json(data);
  } catch (err) {
    console.error('Error admin get menus:', err);
    res.status(500).json({ error: err.message });
  }
});

// Tambah Menu Baru
app.post('/api/admin/menus', requireAuth, async (req, res) => {
  try {
    const { name, price, category, schedules } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nama menu tidak boleh kosong!' });
    }
    const menu = await db.createMenu({
      name: name.trim(),
      price: parseInt(price, 10) || 0,
      category: category ? category.trim() : 'Lainnya',
      schedules: schedules || {}
    });
    res.status(201).json({ success: true, menu });
  } catch (err) {
    console.error('Error create menu:', err);
    res.status(500).json({ error: err.message });
  }
});

// Simpan Perubahan Jadwal Menu Mingguan (Senin s/d Minggu)
app.put(['/api/admin/menus/schedules', '/api/admin/schedules'], requireAuth, async (req, res) => {
  try {
    const { schedules } = req.body;
    if (!schedules || typeof schedules !== 'object') {
      return res.status(400).json({ error: 'Format data jadwal tidak valid!' });
    }
    await db.updateSchedules(schedules);
    res.json({ success: true, message: 'Jadwal menu mingguan berhasil diperbarui!' });
  } catch (err) {
    console.error('Error update schedules:', err);
    res.status(500).json({ error: err.message });
  }
});

// Edit / Update Menu Tertentu
app.put('/api/admin/menus/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category, schedules } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nama menu tidak boleh kosong!' });
    }
    const updated = await db.updateMenu(id, {
      name: name.trim(),
      price: parseInt(price, 10) || 0,
      category: category ? category.trim() : 'Lainnya',
      schedules: schedules || {}
    });
    res.json({ success: true, message: 'Menu berhasil diperbarui!', menu: updated });
  } catch (err) {
    console.error('Error update menu:', err);
    res.status(500).json({ error: err.message });
  }
});

// Hapus Menu Tertentu
app.delete('/api/admin/menus/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteMenu(id);
    res.json({ success: true, message: 'Menu berhasil dihapus!' });
  } catch (err) {
    console.error('Error delete menu:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ambil Riwayat Pesanan dengan Multi-filter (Termasuk Range Tanggal, Bulan, Tahun)
app.get('/api/admin/orders', requireAuth, async (req, res) => {
  try {
    const { search, company, division, location, date, day, startDate, endDate, month, year } = req.query;
    const orders = await db.getOrders({ search, company, division, location, date, day, startDate, endDate, month, year });

    // Hitung ringkasan statistik
    const totalTransactions = orders.length;
    const totalRevenue = orders.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0);

    res.json({
      summary: {
        totalTransactions,
        totalRevenue
      },
      orders
    });
  } catch (err) {
    console.error('Error get orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ekspor Riwayat Pesanan ke CSV (Terproteksi & Anti-CSV Injection)
app.get('/api/admin/orders/export-csv', requireAuth, async (req, res) => {
  try {
    const { search, company, division, location, date, day, startDate, endDate, month, year } = req.query;
    const orders = await db.getOrders({ search, company, division, location, date, day, startDate, endDate, month, year });

    // Akumulasi per nama, perusahaan, divisi, dan tanggal pengiriman yang sama.
    const userDailyTotals = {};
    orders.forEach((ord) => {
      const uKey = JSON.stringify([employeeKey(ord), ord.order_date]);
      userDailyTotals[uKey] = (userDailyTotals[uKey] || 0) + (Number(ord.total_price) || 0);
    });

    // Header CSV
    const headers = [
      'No',
      'Nomor Pesanan',
      'Tanggal',
      'Hari',
      'Nama Pemesan',
      'Perusahaan',
      'Divisi',
      'Lokasi Makanan',
      'Metode Pembayaran',
      'Catatan / Request',
      'Rincian Menu',
      'Total Harga (Rp)',
      'Total Bayar Harian Pemesan (Rp)'
    ];

    const rows = [headers.join(';')];

    orders.forEach((ord, index) => {
      const itemsDetail = Array.isArray(ord.items)
        ? ord.items.filter((it) => it && !it._meta).map((it) => `${it.name} (${it.qty}x)`).join(', ')
        : '';

      const uKey = JSON.stringify([employeeKey(ord), ord.order_date]);
      const dailyTotal = userDailyTotals[uKey] || ord.total_price;

      const row = [
        index + 1,
        `"${sanitizeForCsv(ord.order_number)}"`,
        `"${sanitizeForCsv(ord.order_date)}"`,
        `"${sanitizeForCsv(ord.order_day)}"`,
        `"${sanitizeForCsv(ord.user_name)}"`,
        `"${sanitizeForCsv(ord.company)}"`,
        `"${sanitizeForCsv(ord.division)}"`,
        `"${sanitizeForCsv(ord.location)}"`,
        `"${sanitizeForCsv(ord.payment_method || 'Cash')}"`,
        `"${sanitizeForCsv(ord.notes || '-')}"`,
        `"${sanitizeForCsv(itemsDetail)}"`,
        ord.total_price,
        dailyTotal
      ];
      rows.push(row.join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n'); // UTF-8 BOM untuk Microsoft Excel

    const dateLabel = (startDate && endDate)
      ? `${startDate}_sd_${endDate}`
      : (date || (year && month ? `${year}_${month}` : (year || new Date().toISOString().split('T')[0])));
    const filename = `Rekap_Pesanan_Catering_${dateLabel}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error export CSV:', err);
    res.status(500).json({ error: 'Gagal mengekspor data: ' + err.message });
  }
});

// Ekspor Rekap Kasbon Bulanan ke CSV (Format Matriks Tanggal 1 s/d Akhir Bulan)
app.get('/api/admin/kasbon/export-csv', requireAuth, async (req, res) => {
  try {
    const {month,year,company,division} = req.query;
    const {period} = periodBounds(month,year);
    const [orders,payments] = await Promise.all([
      db.getKasbonOrders({month,year,company,division}),db.getKasbonPayments(month,year)
    ]);
    const users = summarizeKasbon(orders,payments);
    const daysInMonth = new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
    const cell = value => '"' + sanitizeForCsv(String(value ?? '')).replace(/"/g,'""') + '"';
    const headers = ['No','Nama Pemesan','Perusahaan','Divisi'];
    for (let day=1;day<=daysInMonth;day++) headers.push('Tgl '+day);
    headers.push('Total Kasbon Bulan Ini (Rp)','Sudah Bayar','Tanggal Konfirmasi');
    const rows = [headers.map(cell).join(';')];
    users.forEach((user,index) => {
      const row=[index+1,user.userName,user.company,user.division];
      for (let day=1;day<=daysInMonth;day++) {
        const data=user.days[day],parts=[];
        if (data?.hasKasbon) parts.push('Kasbon (Rp '+data.kasbonAmount.toLocaleString('id-ID')+')');
        if (data?.hasCash) parts.push('Cash (Rp '+data.cashAmount.toLocaleString('id-ID')+')');
        row.push(parts.join(' / ') || '-');
      }
      row.push(user.totalKasbon,user.totalKasbon>0 ? (user.isPaid ? 'Sudah bayar' : 'Belum bayar') : '-',
        user.paidAt || '');
      rows.push(row.map(cell).join(';'));
    });
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="Rekap_Kasbon_'+period.slice(0,7)+'.csv"');
    res.send('\uFEFF'+rows.join('\r\n'));
  } catch(error) {
    console.error('Kasbon export failed:',error.message);
    res.status(error.status || 503).json({error:error.status ? error.message :
      'Gagal mengekspor kasbon. Periksa koneksi Supabase dan tabel kasbon_payments.'});
  }
});

app.get('/api/admin/session', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username, role: 'admin' } });
});

app.get('/api/admin/kasbon', requireAuth, async (req, res) => {
  try {
    const { month, year, company, division } = req.query;
    const { period } = periodBounds(month, year);
    const [orders, payments] = await Promise.all([
      db.getKasbonOrders({ month, year, company, division }), db.getKasbonPayments(month, year)
    ]);
    res.json({ period, orders, rows: summarizeKasbon(orders, payments) });
  } catch (error) {
    console.error('Kasbon report failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Gagal memuat kasbon. Periksa koneksi Supabase dan tabel kasbon_payments.' });
  }
});
app.put('/api/admin/kasbon/payments', requireAuth, async (req, res) => {
  try {
    const { month, year, employeeKey, isPaid } = req.body || {};
    periodBounds(month, year);
    if (typeof isPaid !== 'boolean' || typeof employeeKey !== 'string' || !/^[a-f0-9]{64}$/.test(employeeKey)) {
      return res.status(400).json({ error: 'Identitas karyawan atau status pembayaran tidak valid.' });
    }
    const payment = await db.setKasbonPayment({
      month, year, key: employeeKey, isPaid, admin: req.user.username
    });
    res.json({ success: true, payment });
  } catch (error) {
    console.error('Kasbon payment failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Status belum tersimpan. Periksa koneksi Supabase dan tabel kasbon_payments.' });
  }
});

// Riwayat pembayaran manual (admin).
app.get('/api/admin/history-payments', requireAuth, async (req, res) => {
  try {
    res.json(await db.getPaymentHistory(historyPage(req.query.page), req.query));
  } catch (error) {
    console.error('Payment history failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Gagal memuat riwayat pembayaran. Periksa koneksi Supabase dan migrasi 002, 003, dan 004_history_payments_management.sql.' });
  }
});

app.post('/api/admin/history-payments', requireAuth, async (req, res) => {
  try {
    const record = validateManualPaymentHistory(req.body);
    const payment = await db.createPaymentHistory(record, { manual: true, admin: req.user.username });
    res.status(201).json({ success: true, payment });
  } catch (error) {
    console.error('Save payment history failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Pembayaran belum tersimpan. Periksa koneksi Supabase dan migrasi 002, 003, dan 004_history_payments_management.sql.' });
  }
});


app.put('/api/admin/history-payments/:id', requireAuth, async (req, res) => {
  try {
    const id = paymentHistoryId(req.params.id);
    const record = validateManualPaymentHistory(req.body);
    const payment = await db.updatePaymentHistory(id, record, req.user.username);
    res.json({ success: true, payment });
  } catch (error) {
    console.error('Update payment history failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Perubahan belum tersimpan. Periksa koneksi Supabase dan migrasi 004_history_payments_management.sql.' });
  }
});

app.delete('/api/admin/history-payments/:id', requireAuth, async (req, res) => {
  try {
    const id = paymentHistoryId(req.params.id);
    const payment = await db.deletePaymentHistory(id, req.user.username);
    res.json({ success: true, payment });
  } catch (error) {
    console.error('Delete payment history failed:', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message :
      'Riwayat belum dihapus. Periksa koneksi Supabase dan migrasi 004_history_payments_management.sql.' });
  }
});

const { createWhatsappHandlers } = require('./whatsappWebhook');
const whatsapp = createWhatsappHandlers({ db });
app.get('/api/webhooks/whatsapp', whatsapp.verify);
app.post('/api/webhooks/whatsapp', whatsapp.receive);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Backend Server] Berjalan pada port http://localhost:${PORT}`);
  });
}

module.exports = app;
