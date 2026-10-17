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
