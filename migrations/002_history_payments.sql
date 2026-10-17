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
