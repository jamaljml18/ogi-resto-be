-- Jalankan setelah 002_history_payments.sql pada database yang sudah ada.
ALTER TABLE public.history_payments
  ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_payments_whatsapp_message
  ON public.history_payments (whatsapp_message_id);
-- Berlaku untuk insert baru saja; data lama tetap menggunakan tanggal aslinya.
ALTER TABLE public.history_payments
  ALTER COLUMN payment_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE);
