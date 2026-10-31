-- 205 tightened Finance resource scope. Keep that restriction without creating
-- a new grant for unknown/future Finance event names that earlier dispatch denied.
-- Do not rename the public function: parsed callers retain this same corrected OID.
DO $$
DECLARE envelope text; previous_body text; marker integer;
BEGIN
  SELECT prosrc INTO STRICT envelope FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
  IF position('SELECT CASE WHEN event_name=''fees.updated'' OR event_name LIKE ''finance.%''' in envelope)=0
    OR position('THEN fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)' in envelope)=0
    OR envelope !~ '\)\s*END\s*;?\s*$'
  THEN RAISE EXCEPTION 'Unreviewed Finance dispatch envelope; refusing to change event authority'; END IF;
  -- This is the exact non-financial fallback embedded by 205, not the broader
  -- 205 decision itself. It retains all reviewed earlier event-name predicates.
  marker:=position('ELSE (' in envelope);
  IF marker=0 THEN RAISE EXCEPTION 'Missing retained Finance dispatch body'; END IF;
  previous_body:=regexp_replace(substr(envelope,marker+6),'\)\s*END\s*;?\s*$','');
  IF previous_body !~* '^\s*SELECT\s' THEN RAISE EXCEPTION 'Unreviewed retained Finance dispatch body'; END IF;
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $finance_dispatch_207$
      SELECT CASE WHEN event_name='fees.updated'
        THEN fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)
        WHEN event_name LIKE 'finance.%%'
        THEN fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id) AND (%s)
        ELSE (%s) END
    $finance_dispatch_207$
  $definition$,previous_body,previous_body);
END $$;
