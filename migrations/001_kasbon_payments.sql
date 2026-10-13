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
