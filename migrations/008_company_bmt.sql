-- 008: Canonical company name PT BMT, including older WhatsApp captions.
-- Run after 001-007, with backend and WhatsApp bot stopped temporarily.
-- Transaction rolls back on duplicate waiting identities or monthly payment keys.
BEGIN;
LOCK TABLE public.orders, public.waiting_payments, public.history_payments,
  public.kasbon_payments IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalize_company_name(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN lower(regexp_replace(btrim(p_value),'[[:space:]]+',' ','g'))
    ~ '^pt[.]? (bmt|bright mobile (telecommunication|telecommuncation|telecommunications))$'
    THEN 'PT BMT' ELSE btrim(p_value) END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_payment_company()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.company := public.normalize_company_name(NEW.company);
  RETURN NEW;
END;
$$;

-- Names sort before lock_kasbon_payment_amount so amount checks use the canonical company.
DROP TRIGGER IF EXISTS canonicalize_company ON public.orders;
CREATE TRIGGER canonicalize_company BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_payment_company();
DROP TRIGGER IF EXISTS canonicalize_company ON public.waiting_payments;
CREATE TRIGGER canonicalize_company BEFORE INSERT OR UPDATE ON public.waiting_payments
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_payment_company();
DROP TRIGGER IF EXISTS canonicalize_company ON public.history_payments;
CREATE TRIGGER canonicalize_company BEFORE INSERT OR UPDATE ON public.history_payments
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_payment_company();
DROP TRIGGER IF EXISTS canonicalize_company ON public.kasbon_payments;
CREATE TRIGGER canonicalize_company BEFORE INSERT OR UPDATE ON public.kasbon_payments
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_payment_company();

UPDATE public.orders SET company=public.normalize_company_name(company)
  WHERE company IS DISTINCT FROM public.normalize_company_name(company);
UPDATE public.waiting_payments SET company=public.normalize_company_name(company)
  WHERE company IS DISTINCT FROM public.normalize_company_name(company);
UPDATE public.history_payments SET company=public.normalize_company_name(company)
  WHERE company IS DISTINCT FROM public.normalize_company_name(company);

-- employee_key is SHA-256 of JS JSON.stringify([lower(name),lower(company),lower(division)]).
-- Recompute only renamed companies so existing paid flags remain associated with the employee.
UPDATE public.kasbon_payments SET
  company=public.normalize_company_name(company),
  employee_key=encode(sha256(convert_to(
    '[' || to_json(lower(btrim(user_name)))::text || ',' ||
    to_json(lower(public.normalize_company_name(company)))::text || ',' ||
    to_json(lower(btrim(division)))::text || ']', 'UTF8')), 'hex')
  WHERE company IS DISTINCT FROM public.normalize_company_name(company);

REVOKE ALL ON FUNCTION public.normalize_company_name(TEXT),public.canonicalize_payment_company()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_company_name(TEXT),public.canonicalize_payment_company()
  TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
