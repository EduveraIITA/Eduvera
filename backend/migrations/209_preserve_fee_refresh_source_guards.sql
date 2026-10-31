-- Retain the pre-205 fee-refresh envelope checks as well as the new Finance
-- resource restriction. In particular, an invoice is not proof of an unrelated
-- native_review_id (189), and teaching-session envelopes are diary-only (198).
DO $$
DECLARE previous_body text;
BEGIN
  IF to_regprocedure('event_user_is_authorized_before_teaching_sessions(uuid,text,jsonb,uuid)') IS NULL
    THEN RAISE EXCEPTION 'Missing reviewed pre-205 event dispatcher'; END IF;
  SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
  IF position('event_name NOT IN (' in previous_body)=0
    THEN RAISE EXCEPTION 'Expected typed Finance event allowlist before preserving fee-refresh source guards'; END IF;
  previous_body:=regexp_replace(previous_body,';\s*$','');
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $fee_source_209$
      SELECT CASE WHEN event_name='fees.updated' THEN
        fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)
        AND event_payload->>'source_domain' IS DISTINCT FROM 'teaching_sessions'
        AND event_user_is_authorized_before_teaching_sessions(event_school_id,event_name,event_payload,candidate_user_id)
        ELSE (%s) END
    $fee_source_209$
  $definition$,previous_body);
END $$;
