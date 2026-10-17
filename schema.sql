-- ========================================================
-- DATABASE SCHEMA UNTUK SUPABASE POSTGRESQL (CATERING APP)
-- Jalankan skrip ini di SQL Editor pada Dashboard Supabase
-- ========================================================

-- 1. Tabel Master Menu
CREATE TABLE IF NOT EXISTS public.menus (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(100) NOT NULL DEFAULT 'Lainnya',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Tabel Jadwal Menu Mingguan (Senin - Minggu)
CREATE TABLE IF NOT EXISTS public.menu_schedules (
    id BIGSERIAL PRIMARY KEY,
    menu_id VARCHAR(50) NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
    day_name VARCHAR(20) NOT NULL, -- 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT uq_menu_day UNIQUE (menu_id, day_name)
);

-- 3. Tabel Pesanan Pelanggan (Orders)
CREATE TABLE IF NOT EXISTS public.orders (
    id BIGSERIAL PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    user_name VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    division VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    items JSONB NOT NULL,
    total_price INTEGER NOT NULL DEFAULT 0,
    order_day VARCHAR(100) NOT NULL,
    order_date DATE DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) DEFAULT 'Cash',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Migrasi jika tabel orders sudah dibuat sebelumnya
ALTER TABLE public.orders ALTER COLUMN order_day TYPE VARCHAR(100);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- Indexing untuk pencarian cepat di Riwayat Pesanan
CREATE INDEX IF NOT EXISTS idx_orders_date ON public.orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_company ON public.orders(company);
CREATE INDEX IF NOT EXISTS idx_orders_division ON public.orders(division);
CREATE INDEX IF NOT EXISTS idx_orders_location ON public.orders(location);

-- 4. Keamanan Akses (Row Level Security / RLS)
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Full Access on menus" ON public.menus;
CREATE POLICY "Full Access on menus" ON public.menus FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Full Access on menu_schedules" ON public.menu_schedules;
CREATE POLICY "Full Access on menu_schedules" ON public.menu_schedules FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Full Access on orders" ON public.orders;
CREATE POLICY "Full Access on orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);

-- 5. Initial Seed Data (47 Master Menu)
INSERT INTO public.menus (id, name, price, category) VALUES
-- 1. Karbohidrat
('m-1', 'Nasi 1 Porsi', 5000, 'Karbohidrat'),
('m-2', 'Nasi 1/2 Porsi', 3000, 'Karbohidrat'),
('m-14', 'Mie goreng', 3000, 'Karbohidrat'),
('m-36', 'Kwetiau goreng', 3000, 'Karbohidrat'),
('m-37', 'Bihun goreng', 3000, 'Karbohidrat'),
('m-30', 'Sambal goreng kentang', 3000, 'Karbohidrat'),
('m-31', 'Kentang mustopa', 3000, 'Karbohidrat'),
-- 2. Sayur
('m-3', 'Oseng tahu', 3000, 'Sayur'),
('m-4', 'Oseng kangkung', 3000, 'Sayur'),
('m-5', 'Lodeh nangka', 3000, 'Sayur'),
('m-6', 'Capcay', 3000, 'Sayur'),
('m-7', 'Oseng tahu sawi ijo', 3000, 'Sayur'),
('m-8', 'Oseng kacang', 3000, 'Sayur'),
('m-9', 'Oseng labu siam', 3000, 'Sayur'),
('m-10', 'Oseng tahu toge', 3000, 'Sayur'),
('m-11', 'Oseng pare', 3000, 'Sayur'),
('m-12', 'Bening bayam', 3000, 'Sayur'),
('m-13', 'Sayur sop', 3000, 'Sayur'),
('m-28', 'Terong balado', 3000, 'Sayur'),
('m-29', 'Semur jengkol', 4000, 'Sayur'),
-- 3. Lauk
('m-15', 'Orek tempe', 3000, 'Lauk'),
('m-16', 'Kikil', 3000, 'Lauk'),
('m-17', 'Usus', 3000, 'Lauk'),
('m-18', 'Telur balado', 4000, 'Lauk'),
('m-19', 'Telur ceplok', 4000, 'Lauk'),
('m-20', 'Telur dadar', 4000, 'Lauk'),
('m-21', 'Ayam balado', 8000, 'Lauk'),
('m-22', 'Ati balado', 5000, 'Lauk'),
('m-23', 'Cue tongkol', 4000, 'Lauk'),
('m-24', 'Lele goreng', 6000, 'Lauk'),
('m-25', 'Bawal goreng', 6000, 'Lauk'),
('m-26', 'Bandeng goreng', 6000, 'Lauk'),
('m-27', 'Cumi balado', 5000, 'Lauk'),
('m-32', 'Teri kering balado', 3000, 'Lauk'),
('m-33', 'Tahu bacem', 2000, 'Lauk'),
('m-34', 'Tempe bacem', 2000, 'Lauk'),
('m-35', 'Ayam kecap', 8000, 'Lauk'),
('m-38', 'Lele balado', 6000, 'Lauk'),
('m-39', 'Bawal balado', 6000, 'Lauk'),
('m-40', 'Tumis asin japu', 4000, 'Lauk'),
('m-41', 'Rica-rica ayam', 5000, 'Lauk'),
('m-42', 'Tahu goreng', 2000, 'Lauk'),
('m-43', 'Tempe goreng', 2000, 'Lauk'),
('m-44', 'Gorengan', 2000, 'Lauk'),
('m-46', 'Opor Ayam', 8000, 'Lauk'),
('m-47', 'Ayam Goreng', 8000, 'Lauk'),
-- 4. Alat Makan
('m-45', 'Sendok', 0, 'Alat Makan')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    category = EXCLUDED.category;

-- 5. Default Schedules: Aktifkan semua menu untuk hari Senin s/d Minggu secara default
INSERT INTO public.menu_schedules (menu_id, day_name, is_available)
SELECT m.id, d.day_name, TRUE
FROM public.menus m
CROSS JOIN (
    VALUES ('Senin'), ('Selasa'), ('Rabu'), ('Kamis'), ('Jumat'), ('Sabtu'), ('Minggu')
) AS d(day_name)
ON CONFLICT (menu_id, day_name) DO NOTHING;

-- Pelunasan manual per karyawan dan periode tagihan.
-- Jalankan sekali di Supabase SQL Editor; tidak mengubah tabel orders.
CREATE TABLE IF NOT EXISTS public.kasbon_payments (
  id BIGSERIAL PRIMARY KEY,
  employee_key VARCHAR(64) NOT NULL,
  period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  user_name VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  division VARCHAR(255) NOT NULL,
  kasbon_amount BIGINT NOT NULL DEFAULT 0 CHECK (kasbon_amount >= 0),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(255),
  CONSTRAINT uq_kasbon_employee_period UNIQUE (employee_key, period_month),
  CONSTRAINT ck_kasbon_paid_at CHECK (
    (is_paid AND paid_at IS NOT NULL) OR (NOT is_paid AND paid_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_kasbon_payments_period ON public.kasbon_payments(period_month);
ALTER TABLE public.kasbon_payments ENABLE ROW LEVEL SECURITY;
-- Akses lewat backend dengan service_role, tanpa policy akses publik.
REVOKE ALL ON public.kasbon_payments FROM anon, authenticated;
GRANT ALL ON public.kasbon_payments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.kasbon_payments_id_seq TO service_role;

-- Riwayat pembayaran manual; akses hanya melalui API admin backend.
CREATE TABLE IF NOT EXISTS public.history_payments (
  id BIGSERIAL PRIMARY KEY,
  user_name VARCHAR(255) NOT NULL CHECK (char_length(btrim(user_name)) > 0),
  company VARCHAR(255) NOT NULL CHECK (char_length(btrim(company)) > 0),
  division VARCHAR(255) NOT NULL CHECK (char_length(btrim(division)) > 0),
  payment_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_history_payments_date
  ON public.history_payments (payment_date DESC, id DESC);
ALTER TABLE public.history_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.history_payments FROM anon, authenticated;
GRANT ALL ON public.history_payments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.history_payments_id_seq TO service_role;

-- Jalankan setelah 002_history_payments.sql pada database yang sudah ada.
ALTER TABLE public.history_payments
  ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_payments_whatsapp_message
  ON public.history_payments (whatsapp_message_id);
-- Berlaku untuk insert baru saja; data lama tetap menggunakan tanggal aslinya.
ALTER TABLE public.history_payments
  ALTER COLUMN payment_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE);

-- Jalankan setelah migrasi 002 dan 003. Data pembayaran lama tetap disimpan.
ALTER TABLE public.history_payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_history_payments_active_date
  ON public.history_payments (payment_date DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Hapus memakai deleted_at agar ID pesan tetap unik saat WhatsApp mengirim ulang.
-- Akses tetap melalui backend service_role; tidak menambah akses publik.
