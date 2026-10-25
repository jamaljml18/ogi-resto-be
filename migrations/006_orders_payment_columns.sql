-- Repair legacy orders installations after migration 005.
-- Safe to re-run. Existing orders and waiting payments are preserved.
BEGIN;

-- Older installations may still use the original orders table without these fields.
-- Add them before installing the Cash transition trigger; existing rows are preserved.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.orders ALTER COLUMN order_day TYPE VARCHAR(100);

NOTIFY pgrst, 'reload schema';
COMMIT;
