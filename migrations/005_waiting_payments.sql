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
