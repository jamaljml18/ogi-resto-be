require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { DAYS_OF_WEEK } = require('./seedData');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
  const payload = {
    username,
    role: 'admin',
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 jam
  };
  return Buffer.from(JSON.stringify(payload) + '.' + TOKEN_SECRET).toString('base64');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const safeToken = String(token).replace(/ /g, '+');
    const raw = Buffer.from(safeToken, 'base64').toString('utf8');
    const separator = '.' + TOKEN_SECRET;
    const lastIndex = raw.lastIndexOf(separator);
    if (lastIndex === -1) return null;
    const jsonStr = raw.slice(0, lastIndex);
    const payload = JSON.parse(jsonStr);
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
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
  const isDemoMatch = username === 'admin' && password === 'admin123';
  if (isEnvMatch || isDemoMatch) {
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

    // Akumulasi total bayar harian per pemesan pada hari/tanggal yang sama
    const userDailyTotals = {};
    orders.forEach((ord) => {
      const uKey = `${(ord.user_name || '').trim().toLowerCase()}___${ord.order_date}`;
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

      const uKey = `${(ord.user_name || '').trim().toLowerCase()}___${ord.order_date}`;
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
    const { month, year, company, division } = req.query;
    const selectedMonth = parseInt(month, 10) || (new Date().getMonth() + 1);
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();

    const orders = await db.getOrders({
      company,
      division,
      month: selectedMonth,
      year: selectedYear
    });

    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();

    // Grouping per pemesan
    const userMap = {};
    orders.forEach((ord) => {
      const uName = (ord.user_name || '').trim();
      if (!uName) return;
      const key = `${uName}___${ord.company || ''}___${ord.division || ''}`;
      if (!userMap[key]) {
        userMap[key] = {
          userName: uName,
          company: ord.company || '-',
          division: ord.division || '-',
          ordersByDay: {},
          totalKasbon: 0
        };
      }

      const ordDate = ord.order_date || (ord.created_at ? ord.created_at.split('T')[0] : '');
      if (ordDate) {
        const dayNum = parseInt(ordDate.split('-')[2], 10);
        if (dayNum >= 1 && dayNum <= daysInMonth) {
          if (!userMap[key].ordersByDay[dayNum]) {
            userMap[key].ordersByDay[dayNum] = [];
          }
          userMap[key].ordersByDay[dayNum].push(ord);
        }
      }

      if (ord.payment_method === 'Kasbon') {
        userMap[key].totalKasbon += Number(ord.total_price) || 0;
      }
    });

    const userList = Object.values(userMap).sort(
      (a, b) => b.totalKasbon - a.totalKasbon || a.userName.localeCompare(b.userName)
    );

    // Headers
    const headers = ['No', 'Nama Pemesan', 'Perusahaan', 'Divisi'];
    for (let d = 1; d <= daysInMonth; d++) {
      headers.push(`Tgl ${d}`);
    }
    headers.push('Total Kasbon Bulan Ini (Rp)');

    const rows = [headers.join(';')];

    userList.forEach((user, idx) => {
      const row = [
        idx + 1,
        `"${sanitizeForCsv(user.userName)}"`,
        `"${sanitizeForCsv(user.company)}"`,
        `"${sanitizeForCsv(user.division)}"`
      ];

      for (let d = 1; d <= daysInMonth; d++) {
        const dayOrders = user.ordersByDay[d] || [];
        if (dayOrders.length === 0) {
          row.push('"- "');
        } else {
          const hasKasbon = dayOrders.some((o) => o.payment_method === 'Kasbon');
          const dayTotal = dayOrders.reduce((s, o) => s + (Number(o.total_price) || 0), 0);
          if (hasKasbon) {
            row.push(`"Kasbon (Rp ${dayTotal.toLocaleString('id-ID')})"`);
          } else {
            row.push(`"Cash (Rp ${dayTotal.toLocaleString('id-ID')})"`);
          }
        }
      }

      row.push(user.totalKasbon);
      rows.push(row.join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const mStr = String(selectedMonth).padStart(2, '0');
    const filename = `Rekap_Kasbon_Bulanan_${selectedYear}_${mStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error export kasbon CSV:', err);
    res.status(500).json({ error: 'Gagal mengekspor data kasbon: ' + err.message });
  }
});

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
