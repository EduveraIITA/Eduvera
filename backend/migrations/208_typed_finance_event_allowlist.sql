-- Re-audit hardening: the original compatibility dispatcher accepted unknown
-- names for otherwise-related members. A new Finance event must receive explicit
-- contract review, not inherit an older generic relationship fallback.
-- Inventory: FeeLedgerService; FeeChargeBatchService; FeeCorrectionsService;
-- NativeFeeReviewsModel.event; FinanceArrangementsService/Bridge. The browser
-- refresh catalogue continues to consume their separate fees.updated envelopes.
DO $$
DECLARE previous_body text;
BEGIN
  SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
  IF position('fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id) AND (' in previous_body)=0
    THEN RAISE EXCEPTION 'Expected reviewed Finance dispatch before applying typed-event allowlist'; END IF;
  previous_body:=regexp_replace(previous_body,';\s*$','');
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $finance_types_208$
      SELECT CASE WHEN event_name LIKE 'finance.%%' AND event_name NOT IN (
        'finance.charge.issued','finance.charge_batch.issued','finance.charge.corrected','finance.payment.corrected',
        'finance.payment_review.reported','finance.payment_review.decided','finance.payment_review.withdrawn',
        'finance.instalment.requested','finance.instalment.decided','finance.instalment.withdrawn',
        'finance.self_payer.enabled','finance.self_payer.revoked'
      ) THEN false ELSE (%s) END
    $finance_types_208$
  $definition$,previous_body);
END $$;
