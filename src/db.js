const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { INITIAL_MENUS, DAYS_OF_WEEK } = require('./seedData');
const { validateOrderEdit, priceEditedItems, editFailure } = require('./orderEditing');
const { periodBounds, employeeKey, paymentMethod } = require('./kasbon');
const { validatePaymentHistory, validateManualPaymentHistory, paymentHistoryId, paymentHistoryFilters } = require('./paymentHistory');
const { waitingIdentity, problem, tokenHash, orderReference, waitingFailure, settleLocal, settleMatchingLocal } = require('./waitingPayments');

const rawSupabaseUrl = process.env.SUPABASE_URL || '';
const supabaseUrl = rawSupabaseUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
const supabaseKey = (process.env.SUPABASE_KEY || '').trim();

const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl !== '' &&
  supabaseKey !== '' &&
  !supabaseUrl.includes('your-project')
);

let supabase = null;
if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Database] Menggunakan koneksi Supabase Cloud PostgreSQL.');
  } catch (err) {
    console.error('[Database] Gagal menginisialisasi Supabase client:', err.message);
  }
} else {
  console.log('[Database] Supabase belum dikonfigurasi. Menggunakan Local JSON Storage (Otomatis beralih ke Supabase saat .env diisi).');
}

// Identify a public key without logging or exposing its value.
function requireKasbonBackendKey() {
  if (!supabase) return;
  let role = '';
  try {
    if (supabaseKey.startsWith('eyJ')) {
      role = JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64url').toString('utf8')).role;
    }
  } catch { /* Invalid credentials are handled by Supabase. */ }
  if (role === 'anon' || role === 'authenticated' || supabaseKey.startsWith('sb_publishable_')) {
    const error = new Error('SUPABASE_KEY backend memakai key publik. Ganti dengan service_role atau secret key Supabase, lalu restart backend.');
    error.status = 503;
    throw error;
  }
}

// Helper: Pengurutan Kategori & ID Numerik Alami
const CATEGORY_ORDER = {
  'Karbohidrat': 1,
  'Sayur': 2,
  'Lauk': 3,
  'Alat Makan': 4
};

function parseMenuId(id) {
  if (typeof id !== 'string') return { num: 999999, suffix: '' };
  const match = id.match(/^m-(\d+)(.*)$/i);
  if (match) {
    return {
      num: parseInt(match[1], 10),
      suffix: match[2] || ''
    };
  }
  return { num: 999999, suffix: id };
}

function sortMenusNaturally(menuList) {
  if (!Array.isArray(menuList)) return [];
  return [...menuList].sort((a, b) => {
    const catA = CATEGORY_ORDER[a.category] || 99;
    const catB = CATEGORY_ORDER[b.category] || 99;
    if (catA !== catB) {
      return catA - catB;
    }
    const idA = parseMenuId(a.id);
    const idB = parseMenuId(b.id);
    if (idA.num !== idB.num) {
      return idA.num - idB.num;
    }
    return idA.suffix.localeCompare(idB.suffix);
  });
}

// Local JSON Store Setup (untuk development / fallback offline)
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function ensureLocalStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    // Generate default initial state
    const schedules = {};
    INITIAL_MENUS.forEach((menu) => {
      schedules[menu.id] = {
        Senin: true,
        Selasa: true,
        Rabu: true,
        Kamis: true,
        Jumat: true,
        Sabtu: true,
        Minggu: true
      };
    });

    const initialStore = {
      menus: INITIAL_MENUS,
      schedules,
      orders: []
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2), 'utf8');
  }
}

function readLocalStore() {
  ensureLocalStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { menus: INITIAL_MENUS, schedules: {}, orders: [] };
  }
}

function writeLocalStore(data) {
  ensureLocalStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// API DATABASE INTERFACE
const db = {
  async getOrderForEditing(number) {
    orderReference(number); requireKasbonBackendKey();
    if (isSupabaseConfigured && !supabase) throw editFailure();
    let order, menus;
    if (supabase) {
      const [row,catalog] = await Promise.all([
        supabase.from('orders').select('*').eq('order_number',number).maybeSingle(),
        supabase.from('menus').select('id,name,price,category,is_active').order('id')
      ]);
      if (row.error || catalog.error) throw editFailure(row.error || catalog.error);
      order=row.data;menus=catalog.data || [];
      if (order && !Number.isSafeInteger(Number(order.revision))) throw editFailure({code:'42703'});
    } else {
      const store=readLocalStore(); order=store.orders.find(row=>row.order_number===number);menus=store.menus;
      if (order) order={...order,revision:order.revision || 1};
    }
    if (!order) throw problem(404,'Pesanan tidak ditemukan.');
    return {order,menus:menus.filter(menu=>menu.is_active!==false)};
  },
  async editOrderItems(number,body,admin) {
    orderReference(number); requireKasbonBackendKey();
    const {revision,items}=validateOrderEdit(body);
    if (isSupabaseConfigured && !supabase) throw editFailure();
    if (supabase) {
      const {data,error}=await supabase.rpc('edit_order_items',{p_order_number:number,p_expected_revision:revision,p_items:items,p_actor:admin});
      if (error) throw editFailure(error);
      if (!data) throw editFailure(); return data;
    }
    const store=readLocalStore(),order=store.orders.find(row=>row.order_number===number);
    if (!order) throw problem(404,'Pesanan tidak ditemukan.');
    if ((order.revision || 1)!==revision) throw editFailure({message:'ORDER_EDIT_CONFLICT'});
    if (paymentMethod(order)==='Kasbon' && (store.kasbon_payments || []).some(row=>
      row.employee_key===employeeKey(order) && row.period_month===order.order_date.slice(0,7)+'-01' && row.is_paid)) {
      throw editFailure({message:'ORDER_KASBON_ALREADY_PAID'});
    }
    const priced=priceEditedItems(items,store.menus);
    store.order_item_changes=store.order_item_changes || [];
    store.order_item_changes.push({order_id:order.id,order_number:number,before_items:order.items,after_items:priced.items,
      before_total:order.total_price,after_total:priced.total,edited_by:admin,edited_at:new Date().toISOString()});
    Object.assign(order,{items:priced.items,total_price:priced.total,revision:revision+1,updated_at:new Date().toISOString(),updated_by:admin});
    writeLocalStore(store);return order;
  },
  async getWaitingPayments(page = 1) {
    requireKasbonBackendKey();
    if (isSupabaseConfigured && !supabase) throw waitingFailure();
    const offset = (page - 1) * 50;
    let rows;
    if (supabase) {
      const { data, error } = await supabase.from('waiting_payments')
        .select('id,order_number,user_name,company,division,location,items,total_price,order_day,order_date,payment_method,notes,created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 50);
      if (error) throw waitingFailure(error);
      rows = data || [];
    } else {
      rows = [...(readLocalStore().waiting_payments || [])]
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id)).slice(offset, offset + 51);
    }
    return { payments: rows.slice(0, 50), hasMore: rows.length > 50, page };
  },

  async settleWaitingPayment(number, action, actor) {
    orderReference(number);
    if (!['pay', 'delete'].includes(action)) throw problem(400, 'Aksi pembayaran tidak valid.');
    requireKasbonBackendKey();
    if (isSupabaseConfigured && !supabase) throw waitingFailure();
    if (supabase) {
      const { data, error } = await supabase.rpc('settle_waiting_order', {
        p_order_number: number, p_action: action, p_admin: actor
      });
      if (error) throw waitingFailure(error);
      if (!data) throw waitingFailure();
      return data;
    }
    const store = readLocalStore();
    const result = settleLocal(store, number, action, actor);
    writeLocalStore(store);
    return result;
  },

  async getOrderPaymentStatus(number, token) {
    orderReference(number);
    const hash = tokenHash(token);
    requireKasbonBackendKey();
    if (isSupabaseConfigured && !supabase) throw waitingFailure();
    let row;
    if (supabase) {
      const { data, error } = await supabase.from('order_payment_status')
        .select('status,updated_at').eq('order_number', number).eq('status_token_hash', hash).maybeSingle();
      if (error) throw waitingFailure(error);
      row = data;
    } else {
      row = (readLocalStore().order_payment_status || [])
        .find(value => value.order_number === number && value.status_token_hash === hash);
    }
    if (!row) throw problem(404, 'Status pesanan tidak ditemukan.');
    if (!['waiting', 'paid', 'deleted'].includes(row.status)) throw waitingFailure();
    return { order_number: number, status: row.status, updated_at: row.updated_at };
  },


  async getPaymentHistory(page = 1, rawFilters = {}) {
    requireKasbonBackendKey();
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    const filters = paymentHistoryFilters(rawFilters);
    const offset = (page - 1) * 50;
    let payments;
    if (supabase) {
      let query = supabase.from('history_payments')
        .select('id,user_name,company,division,payment_date,created_at,whatsapp_message_id,updated_at,updated_by')
        .is('deleted_at', null);
      if (filters.search) query = query.ilike('user_name', '%' + filters.search.replace(/[\\%_]/g, '\\$&') + '%');
      if (filters.company) query = query.eq('company', filters.company);
      if (filters.division) query = query.eq('division', filters.division);
      if (filters.startDate) query = query.gte('payment_date', filters.startDate);
      if (filters.endDate) query = query.lte('payment_date', filters.endDate);
      const { data, error } = await query
        .order('payment_date', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 50);
      if (error) throw error;
      payments = data || [];
    } else {
      payments = [...(readLocalStore().history_payments || [])]
        .filter(payment => !payment.deleted_at &&
          (!filters.search || payment.user_name.toLocaleLowerCase('id-ID').includes(filters.search.toLocaleLowerCase('id-ID'))) &&
          (!filters.company || payment.company === filters.company) &&
          (!filters.division || payment.division === filters.division) &&
          (!filters.startDate || payment.payment_date >= filters.startDate) &&
          (!filters.endDate || payment.payment_date <= filters.endDate))
        .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || Number(b.id) - Number(a.id))
        .slice(offset, offset + 51);
    }
    return { payments: payments.slice(0, 50), hasMore: payments.length > 50, page };
  },

  async createPaymentHistory(input, { messageId, manual = false, admin, receivedAt } = {}) {
    requireKasbonBackendKey();
    const receivedDate = receivedAt === undefined ? new Date() : new Date(receivedAt);
    if (!Number.isFinite(receivedDate.getTime())) {
      const error = new Error('Waktu penerimaan pembayaran tidak valid.');
      error.status = 400;
      throw error;
    }
    const record = manual ? validateManualPaymentHistory(input) : validatePaymentHistory(input, receivedDate);
    if (manual) record.updated_by = admin || null;
    if (messageId !== undefined) {
      if (typeof messageId !== 'string' || !messageId || messageId.length > 255) {
        const error = new Error('ID pesan WhatsApp tidak valid.');
        error.status = 400;
        throw error;
      }
      record.whatsapp_message_id = messageId;
    }
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      const { data, error } = await supabase.rpc('record_payment_and_settle_waiting', {
        p_record: record, p_message_id: messageId || null,
        p_received_at: receivedDate.toISOString(), p_actor: manual ? admin || 'admin' : 'WhatsApp'
      });
      if (error) throw waitingFailure(error);
      return data;
    }
    const store = readLocalStore();
    store.history_payments = store.history_payments || [];
    if (messageId && store.history_payments.some(payment => payment.whatsapp_message_id === messageId)) return null;
    const payment = { ...record,
      id: store.history_payments.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
      created_at: new Date().toISOString() };
    store.history_payments.push(payment);
    const settled = settleMatchingLocal(store, record, payment.id, receivedDate.toISOString(), manual ? admin || 'admin' : 'WhatsApp');
    writeLocalStore(store);
    return { ...payment, settled_orders: settled };
  },



  async updatePaymentHistory(id, input, admin) {
    requireKasbonBackendKey();
    paymentHistoryId(id);
    const record = { ...validateManualPaymentHistory(input),
      updated_at: new Date().toISOString(), updated_by: admin || null };
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      const { data, error } = await supabase.from('history_payments').update(record)
        .eq('id', id).is('deleted_at', null).select().maybeSingle();
      if (error) throw error;
      if (data) return data;
    } else {
      const store = readLocalStore();
      const payment = (store.history_payments || []).find(row => String(row.id) === id && !row.deleted_at);
      if (payment) {
        Object.assign(payment, record);
        writeLocalStore(store);
        return payment;
      }
    }
    const error = new Error('Riwayat pembayaran tidak ditemukan atau sudah dihapus.');
    error.status = 404;
    throw error;
  },

  async deletePaymentHistory(id, admin) {
    requireKasbonBackendKey();
    paymentHistoryId(id);
    const now = new Date().toISOString();
    const record = { deleted_at: now, updated_at: now, updated_by: admin || null };
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      const { data, error } = await supabase.from('history_payments').update(record)
        .eq('id', id).is('deleted_at', null).select('id').maybeSingle();
      if (error) throw error;
      if (data) return data;
    } else {
      const store = readLocalStore();
      const payment = (store.history_payments || []).find(row => String(row.id) === id && !row.deleted_at);
      if (payment) {
        Object.assign(payment, record);
        writeLocalStore(store);
        return { id: payment.id };
      }
    }
    const error = new Error('Riwayat pembayaran tidak ditemukan atau sudah dihapus.');
    error.status = 404;
    throw error;
  },

  // Configured cloud errors must never silently save a payment locally.
  async getKasbonOrders({ month, year, company, division }) {
    const { period, nextMonth } = periodBounds(month, year);
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      const orders = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from('orders').select('*')
          .gte('order_date', period).lt('order_date', nextMonth).order('id')
          .range(offset, offset + 999);
        if (company && company !== 'Semua') query = query.eq('company', company);
        if (division && division !== 'Semua') query = query.eq('division', division);
        const { data, error } = await query;
        if (error) throw error;
        orders.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return orders;
    }
    return readLocalStore().orders.filter(order =>
      order.order_date >= period && order.order_date < nextMonth &&
      (!company || company === 'Semua' || order.company === company) &&
      (!division || division === 'Semua' || order.division === division));
  },
  async getKasbonPayments(month, year) {
    requireKasbonBackendKey();
    const { period } = periodBounds(month, year);
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      const payments = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('kasbon_payments').select('*')
          .eq('period_month', period).order('employee_key').range(offset, offset + 999);
        if (error) throw error;
        payments.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return payments;
    }
    return (readLocalStore().kasbon_payments || []).filter(payment => payment.period_month === period);
  },
  async setKasbonPayment({ month, year, key, isPaid, admin }) {
    requireKasbonBackendKey();
    const { period } = periodBounds(month, year);
    const orders = await this.getKasbonOrders({ month, year });
    const employeeOrders = orders.filter(order => employeeKey(order) === key && paymentMethod(order) === 'Kasbon');
    const amount = employeeOrders.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);
    if (!employeeOrders.length || amount <= 0) {
      const error = new Error('Tagihan kasbon karyawan pada periode ini tidak ditemukan.');
      error.status = 404; throw error;
    }
    const employee = employeeOrders[0];
    const record = { employee_key: key, period_month: period, user_name: employee.user_name,
      company: employee.company, division: employee.division, kasbon_amount: amount,
      is_paid: isPaid, paid_at: isPaid ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(), updated_by: admin };
    if (supabase) {
      const { data, error } = await supabase.from('kasbon_payments')
        .upsert(record, { onConflict: 'employee_key,period_month' }).select().single();
      if (error) throw error;
      return data;
    }
    const store = readLocalStore();
    store.kasbon_payments = (store.kasbon_payments || []).filter(payment =>
      !(payment.employee_key === key && payment.period_month === period));
    store.kasbon_payments.push(record);
    writeLocalStore(store);
    return record;
  },
  // Ambil menu untuk hari tertentu (untuk tampilan pengguna / pelanggan)
  async getMenusByDay(dayName) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      try {
        const { data: scheduleData, error: schedErr } = await supabase
          .from('menu_schedules')
          .select('menu_id, is_available')
          .eq('day_name', dayName)
          .eq('is_available', true);

        if (schedErr) throw schedErr;
        const availableMenuIds = (scheduleData || []).map((s) => s.menu_id);

        if (availableMenuIds.length === 0) return [];

        const { data: menus, error: menuErr } = await supabase
          .from('menus')
          .select('*')
          .in('id', availableMenuIds)
          .eq('is_active', true)
          .order('id');

        if (menuErr) throw menuErr;
        return sortMenusNaturally(menus);
      } catch (err) {
        throw err;
      }
    }

    // Local Fallback
    const store = readLocalStore();
    const filtered = store.menus.filter((m) => {
      const menuSched = store.schedules[m.id];
      return menuSched ? menuSched[dayName] === true : true;
    });
    return sortMenusNaturally(filtered);
  },

  // Ambil semua master menu beserta matriks jadwal (untuk Halaman Admin)
  async getAllMenusWithSchedules() {
    if (isSupabaseConfigured && !supabase) {
      throw new Error('Koneksi Supabase gagal dibuat. Periksa konfigurasi backend.');
    }
    if (supabase) {
      const { data: menus, error: menuErr } = await supabase
        .from('menus')
        .select('*')
        .order('id');
      if (menuErr) throw new Error('Gagal memuat menu dari Supabase: ' + menuErr.message);

      const { data: schedules, error: schedErr } = await supabase
        .from('menu_schedules')
        .select('*');
      if (schedErr) throw new Error('Gagal memuat jadwal menu dari Supabase: ' + schedErr.message);

      const schedMap = {};
      (schedules || []).forEach((s) => {
        if (!schedMap[s.menu_id]) schedMap[s.menu_id] = {};
        schedMap[s.menu_id][s.day_name] = s.is_available;
      });

      return { menus: sortMenusNaturally(menus), schedules: schedMap };
    }

    const store = readLocalStore();
    return { menus: sortMenusNaturally(store.menus), schedules: store.schedules };
  },

  // Tambah Menu Baru (Admin)
  async createMenu({ name, price, category, schedules }) {
    const id = 'm-' + Date.now() + '-' + crypto.randomUUID().replace(/-/g, '');
    const newMenu = {
      id,
      name,
      price: Number(price) || 0,
      category: category || 'Lainnya',
      is_active: true
    };

    if (isSupabaseConfigured && !supabase) {
      throw new Error('Koneksi Supabase gagal dibuat. Periksa konfigurasi backend.');
    }
    if (supabase) {
      const { error: insErr } = await supabase.from('menus').insert(newMenu);
      if (insErr) throw new Error('Gagal menyimpan menu di Supabase: ' + insErr.message);

      const scheduleInserts = DAYS_OF_WEEK.map((day) => ({
        menu_id: id,
        day_name: day,
        is_available: schedules && schedules[day] !== undefined ? Boolean(schedules[day]) : true
      }));
      let schedErr;
      try {
        ({ error: schedErr } = await supabase.from('menu_schedules').insert(scheduleInserts));
      } catch (error) {
        schedErr = error;
      }
      if (schedErr) {
        try {
          const { error: rollbackErr } = await supabase.from('menus').delete().eq('id', id);
          if (rollbackErr) console.error('Gagal membatalkan menu setelah jadwal gagal disimpan:', rollbackErr);
        } catch (rollbackErr) {
          console.error('Gagal membatalkan menu setelah jadwal gagal disimpan:', rollbackErr);
        }
        throw new Error('Gagal menyimpan jadwal menu di Supabase: ' + schedErr.message);
      }
      return newMenu;
    }

    // Local Fallback
    const store = readLocalStore();
    store.menus = sortMenusNaturally([...store.menus, newMenu]);
    store.schedules[id] = {};
    DAYS_OF_WEEK.forEach((d) => {
      store.schedules[id][d] = schedules && schedules[d] !== undefined ? Boolean(schedules[d]) : true;
    });
    writeLocalStore(store);
    return newMenu;
  },

  // Edit / Update Menu (Admin)
  async updateMenu(id, { name, price, category, schedules }) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      try {
        const updateData = {};
        if (name) updateData.name = name.trim();
        if (price !== undefined) updateData.price = Number(price) || 0;
        if (category) updateData.category = category.trim();

        if (Object.keys(updateData).length > 0) {
          const { error: menuErr } = await supabase.from('menus').update(updateData).eq('id', id);
          if (menuErr) throw menuErr;
        }

        if (schedules && typeof schedules === 'object') {
          const rows = Object.entries(schedules).map(([dayName, isAvailable]) => ({
            menu_id: id,
            day_name: dayName,
            is_available: Boolean(isAvailable)
          }));
          const { error: schedErr } = await supabase.from('menu_schedules').upsert(rows, {
            onConflict: 'menu_id,day_name'
          });
          if (schedErr) throw schedErr;
        }

        return { id, ...updateData };
      } catch (err) {
        throw err;
      }
    }

    // Local Fallback
    const store = readLocalStore();
    const idx = store.menus.findIndex((m) => m.id === id);
    if (idx !== -1) {
      if (name) store.menus[idx].name = name.trim();
      if (price !== undefined) store.menus[idx].price = Number(price) || 0;
      if (category) store.menus[idx].category = category.trim();
    }

    if (schedules && typeof schedules === 'object') {
      store.schedules[id] = {
        ...(store.schedules[id] || {}),
        ...schedules
      };
    }

    store.menus = sortMenusNaturally(store.menus);
    writeLocalStore(store);
    return idx !== -1 ? store.menus.find((m) => m.id === id) : { id, name, price, category };
  },

  // Hapus / Delete Menu (Admin)
  async deleteMenu(id) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      try {
        // FK ON DELETE CASCADE removes schedules in the same database statement.
        const { error } = await supabase.from('menus').delete().eq('id', id);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        throw err;
      }
    }

    // Local Fallback
    const store = readLocalStore();
    store.menus = store.menus.filter((m) => m.id !== id);
    delete store.schedules[id];
    writeLocalStore(store);
    return { success: true };
  },

  // Update Jadwal Menu Mingguan (Admin)
  async updateSchedules(newSchedules) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      try {
        const rows = [];
        for (const [menuId, days] of Object.entries(newSchedules)) {
          for (const [dayName, isAvailable] of Object.entries(days)) {
            rows.push({
              menu_id: menuId,
              day_name: dayName,
              is_available: Boolean(isAvailable)
            });
          }
        }

        const { error } = await supabase.from('menu_schedules').upsert(rows, {
          onConflict: 'menu_id,day_name'
        });
        if (error) throw error;
        return { success: true };
      } catch (err) {
        throw err;
      }
    }

    const store = readLocalStore();
    store.schedules = { ...store.schedules, ...newSchedules };
    writeLocalStore(store);
    return { success: true };
  },

  // Simpan Pesanan Baru
  async createOrder(orderPayload) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderNumber = `ORD-${Date.now()}-${randomSuffix}`;
    const localDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const finalDate = (orderPayload.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(String(orderPayload.orderDate).trim()))
      ? String(orderPayload.orderDate).trim()
      : localDateStr;

    const safeOrderDay = String(orderPayload.orderDay || 'Senin').trim().slice(0, 20);
    const paymentMethod = orderPayload.paymentMethod === 'Kasbon' ? 'Kasbon' : 'Cash';
    const notes = String(orderPayload.notes || '').trim();

    const order = {
      order_number: orderNumber,
      user_name: orderPayload.userName.trim(),
      company: orderPayload.company.trim(),
      division: orderPayload.division.trim(),
      location: orderPayload.location.trim(),
      items: orderPayload.items,
      total_price: Number(orderPayload.totalPrice) || 0,
      order_day: safeOrderDay,
      order_date: finalDate,
      payment_method: paymentMethod,
      notes: notes,
      created_at: new Date().toISOString()
    };

    if (paymentMethod === 'Cash') {
      requireKasbonBackendKey();
      const statusToken = orderPayload.paymentToken || crypto.randomBytes(32).toString('hex');
      const statusHash = tokenHash(statusToken);
      let waiting;
      if (supabase) {
        const { data, error } = await supabase.rpc('create_waiting_order', {
          p_order: order, p_token_hash: statusHash
        });
        if (error) throw waitingFailure(error);
        if (!data) throw waitingFailure();
        waiting = data;
      } else {
        const store = readLocalStore();
        store.waiting_payments = store.waiting_payments || [];
        store.order_payment_status = store.order_payment_status || [];
        const previous = store.order_payment_status.find(value => value.status_token_hash === statusHash);
        if (previous) {
          const found = (previous.status === 'paid' ? store.orders : store.waiting_payments)
            .find(value => value.order_number === previous.order_number);
          if (previous.status === 'deleted' || !found || waitingIdentity(found) !== waitingIdentity(order)) {
            throw problem(409, 'Pesanan sebelumnya sudah diproses. Muat ulang halaman.');
          }
          return { ...found, payment_status: previous.status,
            ...(previous.status === 'waiting' ? { payment_status_token: statusToken } : {}) };
        }
        if (store.waiting_payments.some(value => waitingIdentity(value) === waitingIdentity(order))) {
          throw problem(409, 'Masih ada pesanan menunggu untuk nama, perusahaan, dan divisi ini. Selesaikan pesanan tersebut terlebih dahulu.');
        }
        waiting = { ...order, id: store.waiting_payments.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1 };
        store.waiting_payments.push(waiting);
        store.order_payment_status.push({ order_number: order.order_number, status_token_hash: statusHash,
          status: 'waiting', created_at: order.created_at, updated_at: order.created_at });
        writeLocalStore(store);
      }
      return { ...waiting, payment_status: waiting.payment_status || 'waiting',
        ...((waiting.payment_status || 'waiting') === 'waiting' ? { payment_status_token: statusToken } : {}) };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.from('orders').insert(order).select().single();
        if (error) {
          // Graceful fallback jika kolom payment_method atau notes belum dieksekusi di SQL Editor Supabase
          if (error.message && (error.message.includes('payment_method') || error.message.includes('notes'))) {
            const { payment_method: pm, notes: nt, ...fallbackPayload } = order;
            const itemsWithMeta = Array.isArray(fallbackPayload.items) ? [...fallbackPayload.items] : [];
            itemsWithMeta.push({ _meta: true, payment_method: pm, notes: nt });
            fallbackPayload.items = itemsWithMeta;
            const { data: fbData, error: fbErr } = await supabase.from('orders').insert(fallbackPayload).select().single();
            if (fbErr) throw fbErr;
            return { ...(fbData || fallbackPayload), payment_method: pm, notes: nt };
          }
          throw error;
        }
        return data || order;
      } catch (err) {
        throw err;
      }
    }

    const store = readLocalStore();
    store.orders.unshift(order);
    writeLocalStore(store);
    return order;
  },

  // Ambil Riwayat Pesanan dengan Filter (Mendukung Range Tanggal, Bulan, Tahun)
  async getOrders({ search, company, division, location, date, day, startDate, endDate, month, year }) {
    if (isSupabaseConfigured && !supabase) throw new Error('Koneksi Supabase tidak tersedia.');
    if (supabase) {
      try {
        let query = supabase.from('orders').select('*').order('created_at', { ascending: false });

        if (company && company !== 'Semua') query = query.eq('company', company);
        if (division && division !== 'Semua') query = query.eq('division', division);
        if (location && location !== 'Semua') query = query.eq('location', location);
        if (day && day !== 'Semua') query = query.ilike('order_day', `%${day}%`);
        if (search) query = query.ilike('user_name', `%${search}%`);

        if (startDate) query = query.gte('order_date', startDate);
        if (endDate) query = query.lte('order_date', endDate);
        if (!startDate && !endDate && date) query = query.eq('order_date', date);

        if (!startDate && !endDate && !date) {
          if (year && year !== 'Semua') {
            if (month && month !== 'Semua') {
              const mStr = String(month).padStart(2, '0');
              const yNum = parseInt(year, 10);
              const mNum = parseInt(mStr, 10);
              const lastDay = new Date(yNum, mNum, 0).getDate();
              query = query.gte('order_date', `${year}-${mStr}-01`).lte('order_date', `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`);
            } else {
              query = query.gte('order_date', `${year}-01-01`).lte('order_date', `${year}-12-31`);
            }
          }
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []).map((ord) => {
          let pm = ord.payment_method;
          let nt = ord.notes;
          if (Array.isArray(ord.items)) {
            const meta = ord.items.find((it) => it && it._meta);
            if (meta) {
              if (!pm) pm = meta.payment_method;
              if (!nt) nt = meta.notes;
            }
          }
          return {
            ...ord,
            payment_method: pm || 'Cash',
            notes: nt || ''
          };
        });
      } catch (err) {
        throw err;
      }
    }

    const store = readLocalStore();
    return store.orders
      .filter((ord) => {
        if (search && !ord.user_name.toLowerCase().includes(search.toLowerCase())) return false;
        if (company && company !== 'Semua' && ord.company.toLowerCase() !== company.toLowerCase()) return false;
        if (division && division !== 'Semua' && ord.division.toLowerCase() !== division.toLowerCase()) return false;
        if (location && location !== 'Semua' && ord.location.toLowerCase() !== location.toLowerCase()) return false;
        if (day && day !== 'Semua' && !ord.order_day.toLowerCase().includes(day.toLowerCase())) return false;

        const oDate = ord.order_date || (ord.created_at ? ord.created_at.split('T')[0] : '');
        if (startDate && oDate < startDate) return false;
        if (endDate && oDate > endDate) return false;
        if (!startDate && !endDate && date && oDate !== date) return false;

        if (!startDate && !endDate && !date) {
          if (year && year !== 'Semua') {
            if (month && month !== 'Semua') {
              const mStr = String(month).padStart(2, '0');
              if (!oDate.startsWith(`${year}-${mStr}`)) return false;
            } else {
              if (!oDate.startsWith(String(year))) return false;
            }
          }
        }
        return true;
      })
      .map((ord) => ({
        ...ord,
        payment_method: ord.payment_method || 'Cash',
        notes: ord.notes || ''
      }));
  }
};

module.exports = db;
