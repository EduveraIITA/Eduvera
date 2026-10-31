-- Correct recording mistakes with new evidence, never by rewriting posted facts.
CREATE TABLE fee_invoice_corrections(
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),created_by uuid NOT NULL REFERENCES users(id),actor_person_id uuid NOT NULL,actor_name varchar(301) NOT NULL,
  command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  reason varchar(1000) NOT NULL CHECK(length(trim(reason))>=3),recording_error_attested boolean NOT NULL CHECK(recording_error_attested),invoice_count integer NOT NULL CHECK(invoice_count BETWEEN 1 AND 500),
  selection jsonb NOT NULL CHECK(COALESCE(jsonb_typeof(selection)='object' AND jsonb_typeof(selection->'invoice_ids')='array',false)),
  change jsonb NOT NULL CHECK(COALESCE(jsonb_typeof(change)='object' AND(change='{"kind":"cancel"}'::jsonb OR change->>'kind'='amend' AND(change-'kind')<>'{}'::jsonb)
    AND(change-ARRAY['kind','amount_paise','description','due_on'])='{}'::jsonb
    AND(NOT(change ? 'amount_paise') OR jsonb_typeof(change->'amount_paise')='number' AND(change->>'amount_paise')::numeric BETWEEN 1 AND 100000000 AND(change->>'amount_paise')::numeric=trunc((change->>'amount_paise')::numeric))
    AND(NOT(change ? 'description') OR jsonb_typeof(change->'description')='string' AND length(trim(change->>'description')) BETWEEN 1 AND 200)
    AND(NOT(change ? 'due_on') OR jsonb_typeof(change->'due_on')='string' AND change->>'due_on' ~ '^\d{4}-\d{2}-\d{2}$'),false)),
  result jsonb NOT NULL,created_at timestamptz NOT NULL,UNIQUE(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id)
);
CREATE TABLE fee_invoice_correction_items(
  school_id uuid NOT NULL,correction_id uuid NOT NULL,invoice_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
  amount_paise integer NOT NULL CHECK(amount_paise>=0),description varchar(200) NOT NULL CHECK(length(trim(description))>0),
  due_on date NOT NULL,charge_state text NOT NULL CHECK(charge_state IN('active','cancelled')),
  PRIMARY KEY(school_id,correction_id,invoice_id),UNIQUE(school_id,invoice_id,revision),
  FOREIGN KEY(school_id,correction_id) REFERENCES fee_invoice_corrections(school_id,id),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),CHECK((amount_paise=0)=(charge_state='cancelled'))
);
CREATE TABLE fee_payment_corrections(
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),invoice_id uuid NOT NULL,payment_id uuid NOT NULL UNIQUE REFERENCES fee_payments(id),
  root_payment_id uuid NOT NULL REFERENCES fee_payments(id),replacement_payment_id uuid UNIQUE REFERENCES fee_payments(id) DEFERRABLE INITIALLY DEFERRED,
  replacement_amount_paise integer,replacement_method text,replacement_reference varchar(120),
  action text NOT NULL CHECK(action IN('reverse','replace')),reason varchar(1000) NOT NULL CHECK(length(trim(reason))>=3),
  recording_error_attested boolean NOT NULL CHECK(recording_error_attested),verified_funds boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),actor_person_id uuid NOT NULL,actor_name varchar(301) NOT NULL,command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at timestamptz NOT NULL,
  UNIQUE(school_id,id),FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id),
  CHECK(COALESCE(action='reverse' AND replacement_payment_id IS NULL AND replacement_amount_paise IS NULL AND replacement_method IS NULL AND replacement_reference IS NULL
    OR action='replace' AND replacement_payment_id IS NOT NULL AND replacement_amount_paise BETWEEN 1 AND 100000000
      AND replacement_method IN('cash','bank_transfer','cheque') AND length(trim(replacement_reference)) BETWEEN 3 AND 120 AND verified_funds,false))
);
CREATE INDEX fee_invoice_correction_current ON fee_invoice_correction_items(school_id,invoice_id,revision DESC);
CREATE INDEX fee_payment_correction_invoice ON fee_payment_corrections(school_id,invoice_id,created_at,id);
CREATE TABLE fee_payment_reference_claims(
  school_id uuid NOT NULL REFERENCES schools(id),method text NOT NULL,normalized_reference text NOT NULL,payment_id uuid NOT NULL UNIQUE REFERENCES fee_payments(id),
  PRIMARY KEY(school_id,method,normalized_reference)
);
-- Fail closed on historical normalized collisions. Never choose a winner or change old money.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM fee_payments GROUP BY school_id,method,lower(trim(reference)) HAVING count(*)>1)
  THEN RAISE EXCEPTION 'Historical payment references have normalized collisions; review them before enabling correction claims. No history has been rewritten.'; END IF;
END $$;
INSERT INTO fee_payment_reference_claims(school_id,method,normalized_reference,payment_id)
  SELECT school_id,method,lower(trim(reference)),id FROM fee_payments;
ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_school_id_method_reference_key;

CREATE VIEW fee_effective_payments AS SELECT payment.* FROM fee_payments payment
  WHERE NOT EXISTS(SELECT 1 FROM fee_payment_corrections c WHERE c.school_id=payment.school_id AND c.payment_id=payment.id);
CREATE VIEW fee_effective_invoices AS SELECT invoice.id,invoice.school_id,invoice.student_id,invoice.person_id,invoice.selected_person_revision,
  invoice.reference,coalesce(c.description,invoice.description) AS description,coalesce(c.amount_paise,invoice.amount_paise) AS amount_paise,
  coalesce(c.due_on,invoice.due_on) AS due_on,invoice.created_by,invoice.created_at,invoice.amount_paise AS original_amount_paise,
  invoice.description AS original_description,invoice.due_on AS original_due_on,coalesce(c.charge_state,'active') AS charge_state,
  coalesce(c.revision,0) AS correction_revision,c.correction_id
  FROM fee_invoices invoice LEFT JOIN LATERAL(SELECT * FROM fee_invoice_correction_items c WHERE c.school_id=invoice.school_id
    AND c.invoice_id=invoice.id ORDER BY c.revision DESC LIMIT 1)c ON true;

CREATE FUNCTION fee_recording_correction_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE source_invoice uuid; source_school uuid; source_root uuid;
BEGIN
  source_invoice:=CASE WHEN TG_TABLE_NAME='fee_payment_corrections' THEN NEW.invoice_id ELSE NEW.invoice_id END;
  SELECT school_id INTO source_school FROM fee_invoices WHERE id=source_invoice AND school_id=NEW.school_id FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM campus_event_participants p WHERE p.school_id=NEW.school_id AND p.fee_invoice_id=source_invoice)
  THEN RAISE EXCEPTION 'Event invoices retain their owning reconciliation; correction must identify an ordinary same-campus invoice'; END IF;
  IF TG_TABLE_NAME='fee_invoice_correction_items' THEN
    IF NOT EXISTS(SELECT 1 FROM fee_invoice_corrections h JOIN campus_model_commands c ON c.id=h.command_id
      WHERE h.school_id=NEW.school_id AND h.id=NEW.correction_id AND c.school_id=h.school_id AND c.state='pending'
        AND c.source_domain='finance' AND c.handler_key='finance.charge_correction' AND c.command_type='finance.charge_correction.apply' AND c.handler_version=1
        AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(h.selection->'invoice_ids') s WHERE s=NEW.invoice_id::text)
        AND(NOT(h.selection ? 'batch_id') OR EXISTS(SELECT 1 FROM fee_charge_batch_items b WHERE b.school_id=h.school_id
          AND b.batch_id=(h.selection->>'batch_id')::uuid AND b.invoice_id=NEW.invoice_id)))
    THEN RAISE EXCEPTION 'Charge correction requires its pending owning command'; END IF;
    IF NEW.revision<>1+coalesce((SELECT max(revision) FROM fee_invoice_correction_items WHERE school_id=NEW.school_id AND invoice_id=NEW.invoice_id),0)
    THEN RAISE EXCEPTION 'Charge correction revision changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM fee_invoice_corrections h JOIN fee_effective_invoices prior_invoice ON prior_invoice.school_id=h.school_id AND prior_invoice.id=NEW.invoice_id
      WHERE h.school_id=NEW.school_id AND h.id=NEW.correction_id
        AND NEW.amount_paise=CASE WHEN h.change->>'kind'='cancel' THEN 0 ELSE coalesce((h.change->>'amount_paise')::integer,prior_invoice.amount_paise) END
        AND NEW.description=coalesce(h.change->>'description',prior_invoice.description) AND NEW.due_on=coalesce((h.change->>'due_on')::date,prior_invoice.due_on))
    THEN RAISE EXCEPTION 'Charge correction fields must match the reviewed change'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM fee_payments p WHERE p.id=NEW.payment_id AND p.school_id=NEW.school_id AND p.invoice_id=NEW.invoice_id
      AND p.method IN('cash','bank_transfer','cheque')) OR EXISTS(SELECT 1 FROM fee_gateway_orders g WHERE g.school_id=NEW.school_id AND g.payment_id=NEW.payment_id)
    THEN RAISE EXCEPTION 'Receipt correction must identify an ordinary manual payment in this same invoice'; END IF;
    SELECT coalesce((SELECT c.root_payment_id FROM fee_payment_corrections c WHERE c.replacement_payment_id=NEW.payment_id),NEW.payment_id) INTO source_root;
    IF NEW.root_payment_id<>source_root THEN RAISE EXCEPTION 'Replacement must retain its original receipt lineage'; END IF;
    IF NOT EXISTS(SELECT 1 FROM fee_payments p WHERE p.school_id=NEW.school_id AND p.invoice_id=NEW.invoice_id AND p.id=NEW.root_payment_id)
      OR NEW.replacement_payment_id=NEW.payment_id THEN RAISE EXCEPTION 'Receipt lineage must remain in the same invoice'; END IF;
    IF NEW.action='replace' AND EXISTS(SELECT 1 FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.school_id=d.school_id AND r.id=d.review_id
      WHERE d.school_id=NEW.school_id AND d.payment_id=NEW.root_payment_id AND(r.submitted_by=NEW.created_by OR r.submitter_person_id=NEW.actor_person_id))
    THEN RAISE EXCEPTION 'The payment claimant cannot verify their own replacement'; END IF;
    IF NEW.action='replace' AND EXISTS(SELECT 1 FROM fee_review_decisions d JOIN fee_review_requests r ON r.school_id=d.school_id AND r.id=d.request_id
      WHERE d.school_id=NEW.school_id AND d.payment_id=NEW.root_payment_id)
    THEN RAISE EXCEPTION 'Legacy reported receipt lacks retained canonical claimant identity; reverse and use a fresh independently verified report'; END IF;
    IF NOT EXISTS(SELECT 1 FROM campus_model_commands c WHERE c.id=NEW.command_id AND c.school_id=NEW.school_id
      AND c.source_domain='finance' AND c.handler_key='finance.payment_correction' AND c.command_type='finance.payment_correction.apply' AND c.handler_version=1 AND c.state='pending')
    THEN RAISE EXCEPTION 'Receipt correction requires its pending owning command'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_charge_correction_source BEFORE INSERT ON fee_invoice_correction_items FOR EACH ROW EXECUTE FUNCTION fee_recording_correction_source_guard();
CREATE TRIGGER fee_payment_correction_source BEFORE INSERT ON fee_payment_corrections FOR EACH ROW EXECUTE FUNCTION fee_recording_correction_source_guard();

CREATE FUNCTION fee_correction_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE handler text;
BEGIN
  handler:=CASE WHEN TG_TABLE_NAME='fee_invoice_corrections' THEN 'finance.charge_correction' ELSE 'finance.payment_correction' END;
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands c JOIN campus_model_entities e ON e.id=c.target_entity_id
    JOIN campus_model_command_outcomes o ON o.command_id=c.id AND o.status='accepted'
    JOIN campus_model_agents actor ON actor.id=c.actor_agent_id AND actor.school_id=c.school_id
    WHERE c.id=NEW.command_id AND c.school_id=NEW.school_id AND c.state='accepted' AND c.source_domain='finance' AND c.handler_key=handler
      AND c.command_type=handler||'.apply' AND c.handler_version=1 AND actor.person_id=NEW.actor_person_id
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints ep WHERE ep.school_id=c.school_id AND ep.agent_id=actor.id AND ep.user_id=NEW.created_by
        AND ep.endpoint_kind='account' AND ep.status='active' AND ep.effective_from<=c.requested_at AND(ep.effective_until IS NULL OR ep.effective_until>c.requested_at))
      AND e.domain='finance' AND e.domain_id=NEW.id::text AND e.kind=CASE WHEN TG_TABLE_NAME='fee_invoice_corrections' THEN 'fee_charge_correction' ELSE 'fee_payment_correction' END
      AND c.safe_context->>'payload_hash'=NEW.request_hash AND c.safe_context->>'snapshot_hash'=NEW.snapshot_hash AND o.metadata->>'correction_id'=NEW.id::text
      AND NEW.result->>'correction_id'=NEW.id::text AND NEW.result->>'id'=NEW.id::text AND NEW.result->>'revision'='1')
  THEN RAISE EXCEPTION 'Correction requires its exact accepted command'; END IF;
  IF TG_TABLE_NAME='fee_invoice_corrections' THEN
    IF jsonb_array_length(NEW.selection->'invoice_ids')<>NEW.invoice_count
      OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.selection->'invoice_ids'))<>NEW.invoice_count
      OR NEW.result->'invoice_ids' IS DISTINCT FROM NEW.selection->'invoice_ids'
      OR(SELECT count(*) FROM fee_invoice_correction_items WHERE school_id=NEW.school_id AND correction_id=NEW.id)<>NEW.invoice_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.selection->'invoice_ids') selected WHERE NOT EXISTS(
        SELECT 1 FROM fee_invoice_correction_items i WHERE i.school_id=NEW.school_id AND i.correction_id=NEW.id AND i.invoice_id::text=selected))
    THEN RAISE EXCEPTION 'Every exact selected invoice must be corrected atomically'; END IF;
  ELSIF NEW.result->>'invoice_id' IS DISTINCT FROM NEW.invoice_id::text OR NEW.result->>'payment_id' IS DISTINCT FROM NEW.payment_id::text
    OR NEW.result->>'action' IS DISTINCT FROM NEW.action OR NEW.result->>'replacement_payment_id' IS DISTINCT FROM NEW.replacement_payment_id::text
    OR NEW.action='replace' AND NOT EXISTS(SELECT 1 FROM fee_payments p WHERE p.id=NEW.replacement_payment_id AND p.school_id=NEW.school_id
    AND p.invoice_id=NEW.invoice_id AND p.amount_paise=NEW.replacement_amount_paise AND p.method=NEW.replacement_method
    AND p.reference=NEW.replacement_reference AND p.recorded_by=NEW.created_by)
  THEN RAISE EXCEPTION 'Replacement must match its exact reviewed receipt'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER fee_charge_correction_complete AFTER INSERT ON fee_invoice_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fee_correction_completion_guard();
CREATE CONSTRAINT TRIGGER fee_payment_correction_complete AFTER INSERT ON fee_payment_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fee_correction_completion_guard();

CREATE FUNCTION fee_payment_active_reference_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  INSERT INTO fee_payment_reference_claims(school_id,method,normalized_reference,payment_id) VALUES(NEW.school_id,NEW.method,lower(trim(NEW.reference)),NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER fee_payment_active_reference AFTER INSERT ON fee_payments FOR EACH ROW EXECUTE FUNCTION fee_payment_active_reference_guard();
CREATE FUNCTION release_corrected_payment_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN DELETE FROM fee_payment_reference_claims WHERE school_id=NEW.school_id AND payment_id=NEW.payment_id; RETURN NEW; END $$;
CREATE TRIGGER fee_payment_correction_release AFTER INSERT ON fee_payment_corrections FOR EACH ROW EXECUTE FUNCTION release_corrected_payment_reference();
CREATE FUNCTION fee_payment_claim_mutation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM fee_payments p WHERE p.id=NEW.payment_id AND p.school_id=NEW.school_id AND p.method=NEW.method AND lower(trim(p.reference))=NEW.normalized_reference
      AND NOT EXISTS(SELECT 1 FROM fee_payment_corrections r WHERE r.school_id=p.school_id AND r.payment_id=p.id))
    THEN RAISE EXCEPTION 'Active reference must match its exact effective payment'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP<>'DELETE' OR NOT EXISTS(SELECT 1 FROM fee_payment_corrections WHERE school_id=OLD.school_id AND payment_id=OLD.payment_id)
  THEN RAISE EXCEPTION 'An active payment reference can only be released by its retained reversal'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER fee_payment_claim_mutation BEFORE UPDATE OR DELETE ON fee_payment_reference_claims FOR EACH ROW EXECUTE FUNCTION fee_payment_claim_mutation_guard();
CREATE TRIGGER fee_payment_claim_source BEFORE INSERT ON fee_payment_reference_claims FOR EACH ROW EXECUTE FUNCTION fee_payment_claim_mutation_guard();

CREATE FUNCTION fee_correction_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.event_type IN('finance.charge.corrected','finance.payment.corrected') THEN
    IF NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'correction_id' OR NEW.payload->>'revision' IS DISTINCT FROM '1'
      OR(NEW.payload-ARRAY['correction_id','revision'])<>'{}'::jsonb
      OR(NEW.event_type='finance.charge.corrected' AND(NEW.aggregate_type<>'fee_charge_correction'
        OR NOT EXISTS(SELECT 1 FROM fee_invoice_corrections h WHERE h.school_id=NEW.school_id AND h.id=NEW.aggregate_id)))
      OR(NEW.event_type='finance.payment.corrected' AND(NEW.aggregate_type<>'fee_payment_correction'
        OR NOT EXISTS(SELECT 1 FROM fee_payment_corrections h WHERE h.school_id=NEW.school_id AND h.id=NEW.aggregate_id)))
    THEN RAISE EXCEPTION 'Correction event must identify its exact immutable source'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_correction_event_source BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION fee_correction_event_guard();

CREATE OR REPLACE FUNCTION serialize_fee_payment_against_invoice() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE invoice_amount integer; credited_amount bigint; paid_amount bigint; refunded_amount bigint; replacement_original_amount integer; allowed_net bigint;
BEGIN
  PERFORM 1 FROM fee_invoices WHERE school_id=NEW.school_id AND id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment invoice does not exist in this school' USING ERRCODE='23503'; END IF;
  SELECT amount_paise INTO invoice_amount FROM fee_effective_invoices WHERE school_id=NEW.school_id AND id=NEW.invoice_id;
  SELECT coalesce(sum(amount_paise),0) INTO credited_amount FROM fee_invoice_credits WHERE school_id=NEW.school_id AND invoice_id=NEW.invoice_id;
  SELECT coalesce(sum(amount_paise),0) INTO paid_amount FROM fee_effective_payments WHERE school_id=NEW.school_id AND invoice_id=NEW.invoice_id;
  SELECT coalesce(sum(amount_paise),0) INTO refunded_amount FROM fee_refunds WHERE school_id=NEW.school_id AND invoice_id=NEW.invoice_id;
  SELECT p.amount_paise INTO replacement_original_amount FROM fee_payment_corrections r JOIN fee_payments p ON p.id=r.payment_id AND p.school_id=r.school_id AND p.invoice_id=r.invoice_id
    JOIN campus_model_commands command ON command.id=r.command_id AND command.school_id=r.school_id AND command.state='pending'
    AND command.handler_key='finance.payment_correction' AND command.command_type='finance.payment_correction.apply' AND command.source_domain='finance'
    WHERE r.school_id=NEW.school_id AND r.invoice_id=NEW.invoice_id AND r.replacement_payment_id=NEW.id AND r.action='replace'
      AND r.replacement_amount_paise=NEW.amount_paise AND r.replacement_method=NEW.method AND r.replacement_reference=NEW.reference AND r.created_by=NEW.recorded_by;
  allowed_net:=invoice_amount-credited_amount;
  IF replacement_original_amount IS NOT NULL THEN allowed_net:=greatest(allowed_net,paid_amount-refunded_amount+replacement_original_amount); END IF;
  IF paid_amount-refunded_amount+NEW.amount_paise>allowed_net
  THEN RAISE EXCEPTION 'Payment exceeds the reconciled invoice balance' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE item text; fn regprocedure; restricted text; app_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='fee_invoices'::regclass;
  FOREACH item IN ARRAY ARRAY['fee_invoice_corrections','fee_invoice_correction_items','fee_payment_corrections','fee_payment_reference_claims'] LOOP
    IF item<>'fee_payment_reference_claims' THEN EXECUTE format('CREATE TRIGGER fee_correction_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_fee_record()',item); END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item); EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item); EXECUTE format('ALTER TABLE %I OWNER TO %I',item,app_owner);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,restricted);END IF;END LOOP;
  END LOOP;
  FOREACH item IN ARRAY ARRAY['fee_effective_invoices','fee_effective_payments'] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);EXECUTE format('ALTER VIEW %I OWNER TO %I',item,app_owner);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,restricted);END IF;END LOOP;
  END LOOP;
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('fee_recording_correction_source_guard','fee_correction_completion_guard','fee_payment_active_reference_guard','release_corrected_payment_reference','fee_payment_claim_mutation_guard','fee_correction_event_guard','serialize_fee_payment_against_invoice')
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I',fn,app_owner);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,restricted);END IF;END LOOP;
  END LOOP;
END $$;
