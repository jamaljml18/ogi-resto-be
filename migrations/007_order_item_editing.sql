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
