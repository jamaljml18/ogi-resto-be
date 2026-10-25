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

-- 005: Cash/Transfer waits for confirmation; Kasbon continues directly to orders.
-- Apply after migrations 001-004. Existing orders are not moved or deleted.
BEGIN;

-- Older installations may still use the original orders table without these fields.
-- Add them before installing the Cash transition trigger; existing rows are preserved.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.orders ALTER COLUMN order_day TYPE VARCHAR(100);

CREATE OR REPLACE FUNCTION public.normalize_waiting_identity(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT lower(regexp_replace(btrim(p_value),'[[:space:]]+',' ','g'));
$$;

CREATE TABLE IF NOT EXISTS public.waiting_payments (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  user_name VARCHAR(255) NOT NULL CHECK (char_length(btrim(user_name)) > 0),
  company VARCHAR(255) NOT NULL CHECK (char_length(btrim(company)) > 0),
  division VARCHAR(255) NOT NULL CHECK (char_length(btrim(division)) > 0),
  location VARCHAR(255) NOT NULL,
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  total_price INTEGER NOT NULL CHECK (total_price >= 0),
  order_day VARCHAR(100) NOT NULL,
  order_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash' CHECK (payment_method = 'Cash'),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP INDEX IF EXISTS public.uq_waiting_identity;
CREATE UNIQUE INDEX uq_waiting_identity ON public.waiting_payments
  (public.normalize_waiting_identity(user_name), public.normalize_waiting_identity(company), public.normalize_waiting_identity(division));
CREATE INDEX IF NOT EXISTS idx_waiting_created ON public.waiting_payments (created_at DESC, id DESC);

-- Private capability hash, final status, and links remain after removing the waiting row.
CREATE TABLE IF NOT EXISTS public.order_payment_status (
  order_number VARCHAR(50) PRIMARY KEY,
  status_token_hash VARCHAR(64) NOT NULL UNIQUE CHECK (status_token_hash ~ '^[a-f0-9]{64}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','paid','deleted')),
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  history_payment_id BIGINT REFERENCES public.history_payments(id) ON DELETE SET NULL,
  processed_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.waiting_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payment_status ENABLE ROW LEVEL SECURITY;
-- All browser access uses Express. Public writes must not bypass payment confirmation.
DROP POLICY IF EXISTS "Full Access on orders" ON public.orders;
REVOKE ALL ON public.orders, public.waiting_payments, public.order_payment_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.orders, public.waiting_payments, public.order_payment_status TO service_role;
REVOKE ALL ON SEQUENCE public.orders_id_seq, public.waiting_payments_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.orders_id_seq, public.waiting_payments_id_seq TO service_role;

-- Prevent older API code from inserting unconfirmed Cash orders directly.
CREATE OR REPLACE FUNCTION public.enforce_cash_waiting_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_method IS DISTINCT FROM 'Kasbon' AND NOT EXISTS (
    SELECT 1 FROM public.waiting_payments w JOIN public.order_payment_status s USING(order_number)
    WHERE w.order_number=NEW.order_number AND s.status='waiting'
      AND w.user_name=NEW.user_name AND w.company=NEW.company AND w.division=NEW.division
      AND w.location=NEW.location AND w.items=NEW.items AND w.total_price=NEW.total_price
      AND w.order_day=NEW.order_day AND w.order_date=NEW.order_date
      AND w.payment_method=NEW.payment_method AND w.notes=COALESCE(NEW.notes,'')
      AND w.created_at=NEW.created_at
  ) THEN RAISE EXCEPTION 'CASH_REQUIRES_WAITING_CONFIRMATION'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_cash_waiting_transition ON public.orders;
CREATE TRIGGER enforce_cash_waiting_transition BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_waiting_transition();

CREATE OR REPLACE FUNCTION public.waiting_identity_lock_key(p_name TEXT, p_company TEXT, p_division TEXT)
RETURNS BIGINT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(public.normalize_waiting_identity(p_name),public.normalize_waiting_identity(p_company),public.normalize_waiting_identity(p_division))::text, 0);
$$;

CREATE OR REPLACE FUNCTION public.create_waiting_order(p_order JSONB, p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_wait public.waiting_payments%ROWTYPE;
  v_existing public.order_payment_status%ROWTYPE;
  v_previous JSONB;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(public.waiting_identity_lock_key(
    p_order->>'user_name',p_order->>'company',p_order->>'division'));
  -- A retry with the same private capability returns the original checkout.
  SELECT * INTO v_existing FROM public.order_payment_status WHERE status_token_hash=p_token_hash;
  IF FOUND THEN
    IF v_existing.status='waiting' THEN
      SELECT to_jsonb(w) INTO v_previous FROM public.waiting_payments w WHERE order_number=v_existing.order_number;
    ELSIF v_existing.status='paid' THEN
      SELECT to_jsonb(o) INTO v_previous FROM public.orders o WHERE order_number=v_existing.order_number;
    ELSE RAISE EXCEPTION 'WAITING_ALREADY_PROCESSED';
    END IF;
    IF v_previous IS NULL OR
      public.normalize_waiting_identity(v_previous->>'user_name') <> public.normalize_waiting_identity(p_order->>'user_name') OR
      public.normalize_waiting_identity(v_previous->>'company') <> public.normalize_waiting_identity(p_order->>'company') OR
      public.normalize_waiting_identity(v_previous->>'division') <> public.normalize_waiting_identity(p_order->>'division') THEN
      RAISE EXCEPTION 'WAITING_ALREADY_PROCESSED';
    END IF;
    RETURN v_previous || jsonb_build_object('payment_status',v_existing.status);
  END IF;
  INSERT INTO public.waiting_payments
    (order_number,user_name,company,division,location,items,total_price,order_day,order_date,payment_method,notes,created_at)
  VALUES (p_order->>'order_number',p_order->>'user_name',p_order->>'company',p_order->>'division',
    p_order->>'location',p_order->'items',(p_order->>'total_price')::integer,p_order->>'order_day',
    (p_order->>'order_date')::date,'Cash',COALESCE(p_order->>'notes',''),clock_timestamp())
  RETURNING * INTO v_wait;
  INSERT INTO public.order_payment_status(order_number,status_token_hash)
    VALUES(v_wait.order_number,p_token_hash);
  RETURN to_jsonb(v_wait);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_waiting_order(p_order_number TEXT, p_action TEXT, p_admin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_wait public.waiting_payments%ROWTYPE;
  v_status public.order_payment_status%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_action NOT IN ('pay','delete') THEN RAISE EXCEPTION 'WAITING_INVALID_ACTION'; END IF;
  -- All paths acquire identity lock before the status/row lock.
  SELECT * INTO v_wait FROM public.waiting_payments WHERE order_number=p_order_number;
  IF FOUND THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(public.waiting_identity_lock_key(v_wait.user_name,v_wait.company,v_wait.division));
  END IF;
  SELECT * INTO v_status FROM public.order_payment_status WHERE order_number=p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITING_NOT_FOUND'; END IF;
  IF v_status.status <> 'waiting' THEN
    IF (v_status.status='paid' AND p_action='pay') OR (v_status.status='deleted' AND p_action='delete') THEN
      RETURN jsonb_build_object('status',v_status.status,'order_number',p_order_number);
    END IF;
    RAISE EXCEPTION 'WAITING_ALREADY_PROCESSED';
  END IF;
  SELECT * INTO v_wait FROM public.waiting_payments WHERE order_number=p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITING_NOT_FOUND'; END IF;
  IF p_action='pay' THEN
    INSERT INTO public.orders
      (order_number,user_name,company,division,location,items,total_price,order_day,order_date,payment_method,notes,created_at)
    VALUES(v_wait.order_number,v_wait.user_name,v_wait.company,v_wait.division,v_wait.location,v_wait.items,
      v_wait.total_price,v_wait.order_day,v_wait.order_date,v_wait.payment_method,v_wait.notes,v_wait.created_at)
    RETURNING * INTO v_order;
  END IF;
  UPDATE public.order_payment_status
    SET status=CASE WHEN p_action='pay' THEN 'paid' ELSE 'deleted' END,
      order_id=CASE WHEN p_action='pay' THEN v_order.id ELSE NULL END,
      processed_by=p_admin,updated_at=clock_timestamp()
    WHERE order_number=p_order_number;
  DELETE FROM public.waiting_payments WHERE order_number=p_order_number;
  RETURN jsonb_build_object('status',CASE WHEN p_action='pay' THEN 'paid' ELSE 'deleted' END,
    'order_number',p_order_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_and_settle_waiting(
  p_record JSONB, p_message_id TEXT, p_received_at TIMESTAMPTZ, p_actor TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.history_payments%ROWTYPE;
  v_number TEXT;
  v_settled JSONB := '[]'::jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(public.waiting_identity_lock_key(
    p_record->>'user_name',p_record->>'company',p_record->>'division'));
  INSERT INTO public.history_payments
    (user_name,company,division,payment_date,whatsapp_message_id,updated_by)
  VALUES(p_record->>'user_name',p_record->>'company',p_record->>'division',
    (p_record->>'payment_date')::date,p_message_id,p_record->>'updated_by')
  ON CONFLICT (whatsapp_message_id) DO NOTHING
  RETURNING * INTO v_payment;
  -- A replay never pays a newer waiting order, including after soft deletion.
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT order_number INTO v_number FROM public.waiting_payments
    WHERE public.normalize_waiting_identity(user_name)=public.normalize_waiting_identity(p_record->>'user_name')
      AND public.normalize_waiting_identity(company)=public.normalize_waiting_identity(p_record->>'company')
      AND public.normalize_waiting_identity(division)=public.normalize_waiting_identity(p_record->>'division')
      AND created_at <= p_received_at;
  IF FOUND THEN
    PERFORM public.settle_waiting_order(v_number,'pay',p_actor);
    UPDATE public.order_payment_status SET history_payment_id=v_payment.id WHERE order_number=v_number;
    v_settled := jsonb_build_array(v_number);
  END IF;
  RETURN to_jsonb(v_payment) || jsonb_build_object('settled_orders',v_settled);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cash_waiting_transition(), public.normalize_waiting_identity(TEXT), public.waiting_identity_lock_key(TEXT,TEXT,TEXT),
  public.create_waiting_order(JSONB,TEXT), public.settle_waiting_order(TEXT,TEXT,TEXT),
  public.record_payment_and_settle_waiting(JSONB,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_cash_waiting_transition(), public.normalize_waiting_identity(TEXT), public.waiting_identity_lock_key(TEXT,TEXT,TEXT),
  public.create_waiting_order(JSONB,TEXT), public.settle_waiting_order(TEXT,TEXT,TEXT),
  public.record_payment_and_settle_waiting(JSONB,TEXT,TIMESTAMPTZ,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- 007: Authorized menu replacement with server pricing, optimistic locking and audit.
-- Run after 001-006. Existing identities, delivery details and payment methods are preserved.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
-- The browser uses Express for menu reads and writes; remove legacy permissive policies.
DROP POLICY IF EXISTS "Full Access on menus" ON public.menus;
DROP POLICY IF EXISTS "Full Access on menu_schedules" ON public.menu_schedules;
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menus,public.menu_schedules FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.menu_schedules_id_seq FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.menus,public.menu_schedules TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.menu_schedules_id_seq TO service_role;
CREATE TABLE IF NOT EXISTS public.order_item_changes (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_number VARCHAR(50) NOT NULL,
  before_items JSONB NOT NULL,
  after_items JSONB NOT NULL,
  before_total INTEGER NOT NULL,
  after_total INTEGER NOT NULL,
  edited_by VARCHAR(255) NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_item_changes_order ON public.order_item_changes(order_id,edited_at DESC);
ALTER TABLE public.order_item_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_item_changes FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.order_item_changes_id_seq FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.order_item_changes TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.order_item_changes_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.bump_order_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS bump_order_revision ON public.orders;
CREATE TRIGGER bump_order_revision BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.bump_order_revision();

CREATE OR REPLACE FUNCTION public.order_employee_period_lock(p_name TEXT,p_company TEXT,p_division TEXT,p_period DATE)
RETURNS BIGINT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(lower(btrim(p_name)),lower(btrim(p_company)),lower(btrim(p_division)),p_period)::text,7);
$$;
-- Serialize edits with monthly payment confirmation and calculate the payment amount under that lock.
CREATE OR REPLACE FUNCTION public.lock_kasbon_payment_amount()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(public.order_employee_period_lock(NEW.user_name,NEW.company,NEW.division,NEW.period_month));
 SELECT COALESCE(sum(o.total_price),0) INTO NEW.kasbon_amount FROM public.orders o
 WHERE lower(btrim(o.user_name))=lower(btrim(NEW.user_name)) AND lower(btrim(o.company))=lower(btrim(NEW.company))
 AND lower(btrim(o.division))=lower(btrim(NEW.division)) AND o.payment_method='Kasbon'
 AND o.order_date>=NEW.period_month AND o.order_date<(NEW.period_month+interval '1 month');
 IF NEW.is_paid AND NEW.kasbon_amount<=0 THEN RAISE EXCEPTION 'ORDER_NO_KASBON'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lock_kasbon_payment_amount ON public.kasbon_payments;
CREATE TRIGGER lock_kasbon_payment_amount BEFORE INSERT OR UPDATE ON public.kasbon_payments
 FOR EACH ROW EXECUTE FUNCTION public.lock_kasbon_payment_amount();

CREATE OR REPLACE FUNCTION public.edit_order_items(p_order_number TEXT,p_expected_revision BIGINT,p_items JSONB,p_actor TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_order public.orders%ROWTYPE; v_menu public.menus%ROWTYPE; v_item JSONB;
 v_items JSONB:='[]'::jsonb; v_total BIGINT:=0; v_qty INTEGER; v_period DATE;
BEGIN
 IF p_actor IS NULL OR char_length(btrim(p_actor)) NOT BETWEEN 1 AND 255 OR p_expected_revision IS NULL OR p_expected_revision<1
 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ORDER_INVALID_ITEMS'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'ORDER_INVALID_ITEMS'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
   OR char_length(v_item->>'id') NOT BETWEEN 1 AND 50
   OR jsonb_typeof(v_item->'qty') IS DISTINCT FROM 'number' OR (v_item->>'qty') !~ '^[0-9]{1,3}$'
   OR (v_item->>'qty')::integer NOT BETWEEN 1 AND 999
   OR jsonb_typeof(v_item->'expectedPrice') IS DISTINCT FROM 'number' OR (v_item->>'expectedPrice') !~ '^[0-9]{1,10}$'
   OR (v_item->>'expectedPrice')::bigint>2147483647 THEN RAISE EXCEPTION 'ORDER_INVALID_ITEMS'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'ORDER_DUPLICATE_MENU'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE order_number=p_order_number;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 v_period:=date_trunc('month',v_order.order_date)::date;
 PERFORM pg_catalog.pg_advisory_xact_lock(public.order_employee_period_lock(v_order.user_name,v_order.company,v_order.division,v_period));
 SELECT * INTO v_order FROM public.orders WHERE order_number=p_order_number FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF v_order.revision<>p_expected_revision THEN RAISE EXCEPTION 'ORDER_EDIT_CONFLICT'; END IF;
 IF v_order.payment_method='Kasbon' AND EXISTS (SELECT 1 FROM public.kasbon_payments k
  WHERE k.period_month=v_period AND k.is_paid AND lower(btrim(k.user_name))=lower(btrim(v_order.user_name))
  AND lower(btrim(k.company))=lower(btrim(v_order.company)) AND lower(btrim(k.division))=lower(btrim(v_order.division))) THEN
  RAISE EXCEPTION 'ORDER_KASBON_ALREADY_PAID'; END IF;
 -- Lock menus in a stable order so price changes cannot race with this save.
 PERFORM 1 FROM public.menus WHERE id IN (SELECT value->>'id' FROM jsonb_array_elements(p_items)) ORDER BY id FOR SHARE;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO v_menu FROM public.menus WHERE id=v_item->>'id';
  IF NOT FOUND OR v_menu.is_active IS FALSE THEN RAISE EXCEPTION 'ORDER_MENU_UNAVAILABLE'; END IF;
  IF v_menu.price<0 OR v_menu.price<>(v_item->>'expectedPrice')::bigint THEN RAISE EXCEPTION 'ORDER_PRICE_CHANGED'; END IF;
  v_qty:=(v_item->>'qty')::integer; v_total:=v_total+v_menu.price::bigint*v_qty;
  IF v_total>2147483647 THEN RAISE EXCEPTION 'ORDER_TOTAL_OVERFLOW'; END IF;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('id',v_menu.id,'name',v_menu.name,'price',v_menu.price,'qty',v_qty,'subtotal',v_menu.price::bigint*v_qty));
 END LOOP;
 INSERT INTO public.order_item_changes(order_id,order_number,before_items,after_items,before_total,after_total,edited_by)
 VALUES(v_order.id,v_order.order_number,v_order.items,v_items,v_order.total_price,v_total::integer,p_actor);
 UPDATE public.orders SET items=v_items,total_price=v_total::integer,updated_by=p_actor WHERE id=v_order.id RETURNING * INTO v_order;
 RETURN to_jsonb(v_order);
END;
$$;
REVOKE ALL ON FUNCTION public.bump_order_revision(),public.order_employee_period_lock(TEXT,TEXT,TEXT,DATE),public.lock_kasbon_payment_amount(),public.edit_order_items(TEXT,BIGINT,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bump_order_revision(),public.order_employee_period_lock(TEXT,TEXT,TEXT,DATE),public.lock_kasbon_payment_amount(),public.edit_order_items(TEXT,BIGINT,JSONB,TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
