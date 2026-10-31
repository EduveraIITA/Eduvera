-- One Finance review owner. Guardian queue routing remains distinct from an
-- explicitly addressed person-native review; migration never invents a recipient,
-- canonical signer, historic authority, ledger basis or Core command.
ALTER TABLE fee_native_review_requests
  ADD COLUMN route_kind text NOT NULL DEFAULT 'named' CHECK(route_kind IN('named','guardian_queue')),
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_hash char(64),
  ADD COLUMN correction_watermark jsonb,
  ADD COLUMN import_provenance jsonb,
  ALTER COLUMN submitter_person_id DROP NOT NULL,
  ALTER COLUMN reviewer_user_id DROP NOT NULL,
  ALTER COLUMN reviewer_person_id DROP NOT NULL,
  ALTER COLUMN reviewer_basis DROP NOT NULL,
  ALTER COLUMN ledger_basis DROP NOT NULL,
  ALTER COLUMN basis_hash DROP NOT NULL,
  ALTER COLUMN coordination_receipt DROP NOT NULL,
  ALTER COLUMN command_id DROP NOT NULL,
  DROP CONSTRAINT fee_native_review_requests_check,
  DROP CONSTRAINT fee_native_review_requests_check2,
  ADD CONSTRAINT fee_review_route_evidence CHECK(coalesce(
    route_kind='named' AND submitter_person_id IS NOT NULL AND reviewer_user_id IS NOT NULL AND reviewer_person_id IS NOT NULL
      AND reviewer_basis IS NOT NULL AND ledger_basis IS NOT NULL AND basis_hash IS NOT NULL AND coordination_receipt IS NOT NULL
      AND command_id IS NOT NULL AND submitted_by<>reviewer_user_id AND submitter_person_id<>reviewer_person_id
      AND idempotency_key IS NULL AND request_hash IS NULL AND import_provenance IS NULL
    OR route_kind='guardian_queue' AND submitter_relationship='guardian' AND entitlement_id IS NULL
      AND reviewer_user_id IS NULL AND reviewer_person_id IS NULL AND reviewer_basis IS NULL AND coordination_receipt IS NULL
      AND ledger_basis IS NULL AND basis_hash IS NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL
      AND(request_hash ~ '^[a-f0-9]{64}$')
      AND((command_id IS NOT NULL AND submitter_person_id IS NOT NULL AND import_provenance IS NULL)
        OR(command_id IS NULL AND import_provenance->>'source_table'='fee_review_requests')),false)),
  ADD CONSTRAINT fee_review_claim_shape CHECK(coalesce(
    kind='payment' AND amount_paise>0 AND method IS NOT NULL AND reference IS NOT NULL
      AND length(trim(reference))>=CASE WHEN route_kind='named' THEN 3 ELSE 1 END
      AND(route_kind='guardian_queue' OR amount_paise<=100000000)
    OR kind='charge' AND amount_paise IS NULL AND method IS NULL AND reference IS NULL
      AND length(trim(note))>=CASE WHEN route_kind='named' THEN 3 ELSE 5 END,false)),
  ADD CONSTRAINT fee_review_correction_watermark_shape CHECK(correction_watermark IS NULL OR
    coalesce(jsonb_typeof(correction_watermark)='object' AND(correction_watermark-ARRAY['invoice_revision','payment_correction_count'])='{}'::jsonb
      AND jsonb_typeof(correction_watermark->'invoice_revision')='number' AND jsonb_typeof(correction_watermark->'payment_correction_count')='number'
      AND(correction_watermark->>'invoice_revision')::numeric>=0 AND(correction_watermark->>'invoice_revision')::numeric=trunc((correction_watermark->>'invoice_revision')::numeric)
      AND(correction_watermark->>'payment_correction_count')::numeric>=0 AND(correction_watermark->>'payment_correction_count')::numeric=trunc((correction_watermark->>'payment_correction_count')::numeric),false));
CREATE UNIQUE INDEX fee_review_guardian_command ON fee_native_review_requests(school_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE fee_native_review_decisions
  ALTER COLUMN reviewer_person_id DROP NOT NULL,
  ALTER COLUMN authority_receipt DROP NOT NULL,
  ALTER COLUMN command_id DROP NOT NULL,
  ADD COLUMN import_provenance jsonb,
  ADD CONSTRAINT fee_review_decision_evidence CHECK(coalesce(
    command_id IS NOT NULL AND reviewer_person_id IS NOT NULL AND authority_receipt IS NOT NULL AND import_provenance IS NULL
    OR command_id IS NULL AND import_provenance->>'source_table'='fee_review_decisions',false));

-- Imported positions append after each existing native stream. These are storage
-- positions, not a fabricated chronology; the exact original timestamps survive.
CREATE TEMP TABLE fee_review_import_positions ON COMMIT DROP AS
  WITH existing AS(SELECT school_id,invoice_id,max(stream_revision) AS revision FROM(
    SELECT school_id,invoice_id,stream_revision FROM fee_native_review_requests
    UNION ALL SELECT school_id,invoice_id,stream_revision FROM fee_native_review_decisions
    UNION ALL SELECT school_id,invoice_id,stream_revision FROM fee_native_review_withdrawals) s GROUP BY school_id,invoice_id),
  source AS(SELECT r.school_id,r.invoice_id,r.id,'request' AS kind,r.created_at FROM fee_review_requests r
    UNION ALL SELECT d.school_id,r.invoice_id,d.id,'decision',d.created_at FROM fee_review_decisions d
      JOIN fee_review_requests r ON r.school_id=d.school_id AND r.id=d.request_id)
  SELECT s.*,coalesce(e.revision,0)+row_number() OVER(PARTITION BY s.school_id,s.invoice_id ORDER BY s.created_at,s.kind DESC,s.id) AS revision
    FROM source s LEFT JOIN existing e USING(school_id,invoice_id);
ALTER TABLE fee_native_review_requests DISABLE TRIGGER fee_native_review_request_source;
ALTER TABLE fee_native_review_decisions DISABLE TRIGGER fee_native_review_decision_source;
INSERT INTO fee_native_review_requests(id,school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,submitter_person_id,
  submitter_relationship,route_kind,idempotency_key,request_hash,correction_watermark,import_provenance,stream_revision,created_at)
  SELECT r.id,r.school_id,r.invoice_id,r.kind,r.amount_paise,r.method,r.reference,r.note,r.submitted_by,NULL,
    'guardian','guardian_queue',r.idempotency_key,r.request_hash,r.correction_watermark,
    jsonb_build_object('source_table','fee_review_requests','migration',215,'identity_evidence','not_retained'),p.revision,r.created_at
  FROM fee_review_requests r JOIN fee_review_import_positions p ON p.id=r.id AND p.kind='request';
INSERT INTO fee_native_review_decisions(id,school_id,invoice_id,review_id,outcome,response,payment_id,reviewed_by,stream_revision,created_at,import_provenance)
  SELECT d.id,d.school_id,r.invoice_id,d.request_id,d.outcome,d.response,d.payment_id,d.reviewed_by,p.revision,d.created_at,
    jsonb_build_object('source_table','fee_review_decisions','migration',215,'authority_evidence','not_retained')
  FROM fee_review_decisions d JOIN fee_review_requests r ON r.school_id=d.school_id AND r.id=d.request_id
    JOIN fee_review_import_positions p ON p.id=d.id AND p.kind='decision';
ALTER TABLE fee_native_review_requests ENABLE TRIGGER fee_native_review_request_source;
ALTER TABLE fee_native_review_decisions ENABLE TRIGGER fee_native_review_decision_source;

CREATE OR REPLACE FUNCTION fee_native_review_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.import_provenance IS NOT NULL THEN RAISE EXCEPTION 'Historic Finance imports cannot be created by the running application'; END IF;
  IF NEW.submitter_relationship='self' AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e
    WHERE e.school_id=NEW.school_id AND e.id=NEW.entitlement_id AND e.invoice_id=NEW.invoice_id
      AND e.user_id=NEW.submitted_by AND e.person_id=NEW.submitter_person_id)
  THEN RAISE EXCEPTION 'Self fee work requires the same person account and invoice entitlement'; END IF;
  IF NEW.route_kind='guardian_queue' AND NOT EXISTS(SELECT 1 FROM fee_invoices i
    JOIN guardian_relationships g ON g.school_id=i.school_id AND g.student_id=i.student_id JOIN parents p ON p.id=g.guardian_id
    JOIN guardian_school_profiles profile ON profile.school_id=i.school_id AND profile.guardian_id=p.id
    JOIN school_memberships m ON m.school_id=i.school_id AND m.user_id=p.user_id AND m.role='guardian' AND m.is_active
    WHERE i.id=NEW.invoice_id AND i.school_id=NEW.school_id AND p.user_id=NEW.submitted_by AND profile.person_id=NEW.submitter_person_id)
  THEN RAISE EXCEPTION 'Guardian fee work requires its current canonical linked guardian'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION fee_native_review_decision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.import_provenance IS NOT NULL THEN RAISE EXCEPTION 'Historic Finance imports cannot be created by the running application'; END IF;
  IF NEW.outcome='verified' AND EXISTS(SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=NEW.school_id AND r.id=NEW.review_id AND r.submitter_person_id IS NULL)
  THEN RAISE EXCEPTION 'A retained report with unknown canonical claimant requires rejection and a fresh report before verification'; END IF;
  IF NOT EXISTS(SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=NEW.school_id AND r.id=NEW.review_id AND r.invoice_id=NEW.invoice_id
    AND r.submitted_by<>NEW.reviewed_by AND(r.submitter_person_id IS NULL OR r.submitter_person_id<>NEW.reviewer_person_id)
    AND(r.route_kind='guardian_queue' OR(r.reviewer_user_id=NEW.reviewed_by AND r.reviewer_person_id=NEW.reviewer_person_id))
    AND((r.kind='charge' AND NEW.outcome='answered') OR(r.kind='payment' AND NEW.outcome IN('verified','rejected'))))
  THEN RAISE EXCEPTION 'Fee review decision must match its independent retained reviewer and kind'; END IF;
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fee_payments p JOIN fee_native_review_requests r ON r.school_id=p.school_id AND r.invoice_id=p.invoice_id
    WHERE r.id=NEW.review_id AND r.school_id=NEW.school_id AND p.id=NEW.payment_id AND p.amount_paise=r.amount_paise
      AND p.method=r.method AND p.reference=r.reference AND p.recorded_by=NEW.reviewed_by)
  THEN RAISE EXCEPTION 'Fee review receipt must match its own verified ledger payment'; END IF;
  IF EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=NEW.school_id AND w.review_id=NEW.review_id)
  THEN RAISE EXCEPTION 'Withdrawn fee work cannot be decided'; END IF;
  RETURN NEW;
END $$;

-- Retain every installed authorization wrapper and its security/ownership. Replace
-- only the two retired table references and their exact FK column references.
DO $$ DECLARE item record; definition text; BEGIN
  FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND(p.prosrc LIKE '%fee_review_requests%' OR p.prosrc LIKE '%fee_review_decisions%')
      AND p.proname NOT IN('fee_native_review_request_guard','fee_native_review_decision_guard')
  LOOP
    definition:=pg_get_functiondef(item.oid);
    definition:=replace(replace(definition,'fee_review_requests','fee_native_review_requests'),'fee_review_decisions','fee_native_review_decisions');
    definition:=replace(replace(definition,'decision.request_id','decision.review_id'),'d.request_id','d.review_id');
    IF definition LIKE '%WHEN ''fee_review_decision''%' THEN
      definition:=replace(definition,'AND request.submitted_by=notification.recipient_id',
        'AND request.route_kind=''guardian_queue'' AND request.submitted_by=notification.recipient_id');
    END IF;
    -- Unknown historic claimant identity keeps the conservative replacement gate.
    IF definition LIKE '%Legacy reported receipt lacks retained canonical claimant identity%' THEN
      definition:=replace(definition,'AND d.payment_id=NEW.root_payment_id)','AND d.payment_id=NEW.root_payment_id AND r.submitter_person_id IS NULL)');
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;
DROP TABLE fee_review_decisions;
DROP TABLE fee_review_requests;
COMMENT ON TABLE fee_native_review_requests IS 'Authoritative Finance payment claims and charge questions; route_kind preserves named versus linked-guardian queue authority. Imported facts retain original IDs and explicit missing-evidence provenance.';

-- New guardian API actions are no longer commandless legacy writes. At commit,
-- require the same actor/world/source/action accepted by the ordinary Core port.
CREATE FUNCTION fee_guardian_review_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE signer uuid; review_identity uuid; action_name text; BEGIN
  IF NEW.import_provenance IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='fee_native_review_requests' THEN
    IF NEW.route_kind<>'guardian_queue' THEN RETURN NEW; END IF;
    signer:=NEW.submitted_by; review_identity:=NEW.id; action_name:='report';
  ELSE
    IF NOT EXISTS(SELECT 1 FROM fee_native_review_requests WHERE id=NEW.review_id AND school_id=NEW.school_id AND route_kind='guardian_queue') THEN RETURN NEW; END IF;
    signer:=NEW.reviewed_by; review_identity:=NEW.review_id; action_name:='decide';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands c JOIN campus_model_command_outcomes o ON o.command_id=c.id AND o.status='accepted'
    JOIN campus_model_entities e ON e.id=c.target_entity_id JOIN campus_model_agents a ON a.id=c.actor_agent_id AND a.school_id=c.school_id
    WHERE c.school_id=NEW.school_id AND c.source_domain='finance' AND c.handler_key='finance.payment_review' AND c.handler_version=1
      AND c.command_type='finance.payment_review.'||action_name AND c.state='accepted'
      AND c.idempotency_key='native-fee-review:'||signer::text||':'||NEW.command_id::text
      AND c.safe_context->>'review_id'=review_identity::text AND e.kind='fee_invoice' AND e.domain='finance' AND e.domain_id=NEW.invoice_id::text
      AND o.metadata->>'id'=review_identity::text AND o.metadata->>'invoice_id'=NEW.invoice_id::text
      AND a.person_id=CASE WHEN TG_TABLE_NAME='fee_native_review_requests' THEN to_jsonb(NEW)->>'submitter_person_id' ELSE to_jsonb(NEW)->>'reviewer_person_id' END::uuid
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints ep WHERE ep.school_id=c.school_id AND ep.agent_id=a.id AND ep.user_id=signer
        AND ep.endpoint_kind='account' AND ep.status='active' AND ep.effective_from<=c.requested_at AND(ep.effective_until IS NULL OR ep.effective_until>c.requested_at)))
  THEN RAISE EXCEPTION 'Guardian Finance review requires its exact accepted current-actor Core command'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER fee_guardian_review_command AFTER INSERT ON fee_native_review_requests DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_guardian_review_completion_guard();
CREATE CONSTRAINT TRIGGER fee_guardian_review_command AFTER INSERT ON fee_native_review_decisions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_guardian_review_completion_guard();
REVOKE ALL ON FUNCTION fee_guardian_review_completion_guard() FROM PUBLIC;
