-- Native Finance review is source-owned work, separate from retained legacy reviews.
-- A reported payment is never ledger money until an independent verifier accepts it.
CREATE TABLE fee_native_review_requests (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('payment','charge')),
  amount_paise integer,
  method text CHECK(method IN ('cash','bank_transfer','cheque')),
  reference varchar(120),
  note varchar(1000) NOT NULL DEFAULT '',
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitter_person_id uuid NOT NULL,
  submitter_relationship text NOT NULL CHECK(submitter_relationship IN ('self','guardian','assisted')),
  entitlement_id uuid,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  reviewer_person_id uuid NOT NULL,
  reviewer_basis jsonb NOT NULL CHECK(jsonb_typeof(reviewer_basis)='object'),
  ledger_basis jsonb NOT NULL CHECK(jsonb_typeof(ledger_basis)='object'),
  basis_hash char(64) NOT NULL,
  coordination_receipt jsonb NOT NULL CHECK(jsonb_typeof(coordination_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision>0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,id,invoice_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  FOREIGN KEY(school_id,submitter_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,entitlement_id,invoice_id) REFERENCES fee_invoice_self_payer_entitlements(school_id,id,invoice_id),
  CHECK(submitted_by<>reviewer_user_id AND submitter_person_id<>reviewer_person_id),
  CHECK((submitter_relationship='self')=(entitlement_id IS NOT NULL)),
  CHECK((kind='payment' AND amount_paise IS NOT NULL AND amount_paise BETWEEN 1 AND 100000000 AND method IS NOT NULL AND reference IS NOT NULL AND length(trim(reference))>=3)
    OR (kind='charge' AND amount_paise IS NULL AND method IS NULL AND reference IS NULL AND length(trim(note))>=3))
);
CREATE TABLE fee_native_review_decisions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  review_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('verified','rejected','answered')),
  response varchar(1000) NOT NULL CHECK(length(trim(response))>=3),
  payment_id uuid REFERENCES fee_payments(id),
  reviewed_by uuid NOT NULL REFERENCES users(id),
  reviewer_person_id uuid NOT NULL,
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision>0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,review_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,review_id,invoice_id) REFERENCES fee_native_review_requests(school_id,id,invoice_id),
  FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id),
  CHECK((outcome='verified')=(payment_id IS NOT NULL))
);
CREATE TABLE fee_native_review_withdrawals (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  review_id uuid NOT NULL,
  withdrawn_by uuid NOT NULL REFERENCES users(id),
  stream_revision integer NOT NULL CHECK(stream_revision>0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,review_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,review_id,invoice_id) REFERENCES fee_native_review_requests(school_id,id,invoice_id)
);
CREATE INDEX fee_native_review_account ON fee_native_review_requests(school_id,invoice_id,created_at DESC,id);
CREATE INDEX fee_native_review_sender ON fee_native_review_requests(school_id,submitted_by,created_at,id);
CREATE INDEX fee_native_review_recipient ON fee_native_review_requests(school_id,reviewer_user_id,created_at,id);
CREATE INDEX fee_native_review_submitter_person ON fee_native_review_requests(school_id,submitter_person_id);
CREATE INDEX fee_native_review_reviewer_person ON fee_native_review_requests(school_id,reviewer_person_id);
CREATE INDEX fee_native_review_entitlement ON fee_native_review_requests(school_id,entitlement_id,invoice_id);
CREATE INDEX fee_native_review_submitter_user ON fee_native_review_requests(submitted_by);
CREATE INDEX fee_native_review_reviewer_user ON fee_native_review_requests(reviewer_user_id);
CREATE INDEX fee_native_review_decider ON fee_native_review_decisions(reviewed_by);
CREATE INDEX fee_native_review_decision_person ON fee_native_review_decisions(school_id,reviewer_person_id);
CREATE INDEX fee_native_review_payment ON fee_native_review_decisions(payment_id);
CREATE INDEX fee_native_review_withdrawer ON fee_native_review_withdrawals(withdrawn_by);

CREATE FUNCTION fee_native_review_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.submitter_relationship='self' AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e
    WHERE e.school_id=NEW.school_id AND e.id=NEW.entitlement_id AND e.invoice_id=NEW.invoice_id
      AND e.user_id=NEW.submitted_by AND e.person_id=NEW.submitter_person_id)
  THEN RAISE EXCEPTION 'Self fee work requires the same person account and invoice entitlement'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_native_review_request_source BEFORE INSERT ON fee_native_review_requests FOR EACH ROW EXECUTE FUNCTION fee_native_review_request_guard();

CREATE FUNCTION fee_native_review_decision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=NEW.school_id AND r.id=NEW.review_id
    AND r.invoice_id=NEW.invoice_id AND r.reviewer_user_id=NEW.reviewed_by AND r.reviewer_person_id=NEW.reviewer_person_id
    AND r.submitted_by<>NEW.reviewed_by AND r.submitter_person_id<>NEW.reviewer_person_id
    AND ((r.kind='charge' AND NEW.outcome='answered') OR (r.kind='payment' AND NEW.outcome IN ('verified','rejected'))))
  THEN RAISE EXCEPTION 'Fee review decision must match its independent retained reviewer and kind'; END IF;
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fee_payments p JOIN fee_native_review_requests r ON r.school_id=p.school_id
    AND r.invoice_id=p.invoice_id WHERE r.id=NEW.review_id AND r.school_id=NEW.school_id AND p.id=NEW.payment_id
    AND p.amount_paise=r.amount_paise AND p.method=r.method AND p.reference=r.reference AND p.recorded_by=NEW.reviewed_by)
  THEN RAISE EXCEPTION 'Fee review receipt must match its own verified ledger payment'; END IF;
  IF EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=NEW.school_id AND w.review_id=NEW.review_id)
  THEN RAISE EXCEPTION 'Withdrawn fee work cannot be decided'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_native_review_decision_source BEFORE INSERT ON fee_native_review_decisions FOR EACH ROW EXECUTE FUNCTION fee_native_review_decision_guard();
CREATE FUNCTION fee_native_review_withdrawal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=NEW.school_id AND r.id=NEW.review_id
    AND r.invoice_id=NEW.invoice_id AND r.submitted_by=NEW.withdrawn_by)
    OR EXISTS(SELECT 1 FROM fee_native_review_decisions d WHERE d.school_id=NEW.school_id AND d.review_id=NEW.review_id)
  THEN RAISE EXCEPTION 'Only the sender can withdraw pending fee work'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_native_review_withdrawal_source BEFORE INSERT ON fee_native_review_withdrawals FOR EACH ROW EXECUTE FUNCTION fee_native_review_withdrawal_guard();

DO $$ DECLARE relation_name text; owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  FOREACH relation_name IN ARRAY ARRAY['fee_native_review_requests','fee_native_review_decisions','fee_native_review_withdrawals'] LOOP
    EXECUTE format('CREATE TRIGGER fee_native_review_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_fee_record()',relation_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',relation_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',relation_name); END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',relation_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION fee_native_review_decision_guard() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION fee_native_review_withdrawal_guard() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION fee_native_review_request_guard() OWNER TO %I',owner_name);
END $$;
REVOKE ALL ON FUNCTION fee_native_review_request_guard(),fee_native_review_decision_guard(),fee_native_review_withdrawal_guard() FROM PUBLIC;

-- Native review cache refreshes never broaden the current account entitlement,
-- and a guessed review ID cannot name a different invoice or beneficiary.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_native_fee_reviews;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_payload ? 'native_review_id' OR event_name IN ('finance.payment_review.reported','finance.payment_review.decided','finance.payment_review.withdrawn')
    THEN event_name IN ('fees.updated','finance.payment_review.reported','finance.payment_review.decided','finance.payment_review.withdrawn')
      AND EXISTS(SELECT 1 FROM fee_native_review_requests request WHERE request.school_id=event_school_id
        AND request.id::text=event_payload->>'native_review_id' AND request.invoice_id::text=event_payload->>'invoice_id')
      AND fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE event_user_is_authorized_before_native_fee_reviews(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; restricted_role text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION fee_native_review_request_guard(),fee_native_review_decision_guard(),fee_native_review_withdrawal_guard(),event_user_is_authorized(uuid,text,jsonb,uuid) FROM %I',restricted_role);
    END IF;
  END LOOP;
END $$;
