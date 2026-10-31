-- An agreement changes collection dates, never the posted charge or money received.
CREATE TABLE fee_invoice_self_payer_entitlements (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  student_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  person_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL CHECK(valid_until >= valid_from),
  adult_self_payer_attested boolean NOT NULL CHECK(adult_self_payer_attested),
  approved_by uuid NOT NULL REFERENCES users(id),
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision > 0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,id,invoice_id,student_id), UNIQUE(school_id,id,invoice_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id,student_id) REFERENCES fee_invoices(school_id,id,student_id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE TABLE fee_invoice_self_payer_revocations (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  revoked_by uuid NOT NULL REFERENCES users(id),
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision > 0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,entitlement_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  FOREIGN KEY(school_id,entitlement_id,invoice_id) REFERENCES fee_invoice_self_payer_entitlements(school_id,id,invoice_id)
);
CREATE TABLE fee_instalment_requests (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  student_id uuid NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitter_person_id uuid NOT NULL,
  submitter_relationship text NOT NULL CHECK(submitter_relationship IN ('guardian','self')),
  entitlement_id uuid,
  note varchar(1000) NOT NULL DEFAULT '',
  schedule jsonb NOT NULL CHECK(jsonb_typeof(schedule)='array' AND jsonb_array_length(schedule) BETWEEN 1 AND 12),
  ledger_basis jsonb NOT NULL CHECK(jsonb_typeof(ledger_basis)='object'),
  basis_hash char(64) NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  reviewer_person_id uuid NOT NULL,
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  coordination_receipt jsonb NOT NULL CHECK(jsonb_typeof(coordination_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision > 0),
  command_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,id,invoice_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id,student_id) REFERENCES fee_invoices(school_id,id,student_id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
  FOREIGN KEY(school_id,submitter_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,entitlement_id,invoice_id,student_id) REFERENCES fee_invoice_self_payer_entitlements(school_id,id,invoice_id,student_id),
  CHECK((submitter_relationship='self') = (entitlement_id IS NOT NULL))
);
CREATE TABLE fee_instalment_decisions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  request_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  response varchar(1000) NOT NULL DEFAULT '',
  decided_by uuid NOT NULL REFERENCES users(id),
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  stream_revision integer NOT NULL CHECK(stream_revision > 0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,request_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  FOREIGN KEY(school_id,request_id,invoice_id) REFERENCES fee_instalment_requests(school_id,id,invoice_id),
  CHECK(decision='approved' OR length(trim(response))>=3)
);
CREATE TABLE fee_instalment_withdrawals (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  request_id uuid NOT NULL,
  withdrawn_by uuid NOT NULL REFERENCES users(id),
  stream_revision integer NOT NULL CHECK(stream_revision > 0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,request_id), UNIQUE(school_id,invoice_id,stream_revision),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  FOREIGN KEY(school_id,request_id,invoice_id) REFERENCES fee_instalment_requests(school_id,id,invoice_id)
);
CREATE INDEX fee_instalment_requests_account ON fee_instalment_requests(school_id,invoice_id,created_at DESC,id);
CREATE INDEX fee_instalment_requests_reviewer ON fee_instalment_requests(school_id,reviewer_user_id,created_at,id);
CREATE INDEX fee_instalment_requests_sender ON fee_instalment_requests(school_id,submitted_by,created_at,id);
CREATE INDEX fee_self_payer_account ON fee_invoice_self_payer_entitlements(school_id,invoice_id,valid_from,valid_until);
CREATE INDEX fee_self_payer_student ON fee_invoice_self_payer_entitlements(school_id,student_id);
CREATE INDEX fee_self_payer_person ON fee_invoice_self_payer_entitlements(school_id,person_id);
CREATE INDEX fee_self_payer_user ON fee_invoice_self_payer_entitlements(user_id);
CREATE INDEX fee_self_payer_approver ON fee_invoice_self_payer_entitlements(approved_by);
CREATE INDEX fee_self_payer_revoker ON fee_invoice_self_payer_revocations(revoked_by);
CREATE INDEX fee_instalment_student ON fee_instalment_requests(school_id,student_id);
CREATE INDEX fee_instalment_submitter_person ON fee_instalment_requests(school_id,submitter_person_id);
CREATE INDEX fee_instalment_reviewer_person ON fee_instalment_requests(school_id,reviewer_person_id);
CREATE INDEX fee_instalment_entitlement ON fee_instalment_requests(school_id,entitlement_id,invoice_id,student_id);
CREATE INDEX fee_instalment_submitter_user ON fee_instalment_requests(submitted_by);
CREATE INDEX fee_instalment_reviewer_user ON fee_instalment_requests(reviewer_user_id);
CREATE INDEX fee_instalment_decider ON fee_instalment_decisions(decided_by);
CREATE INDEX fee_instalment_withdrawer ON fee_instalment_withdrawals(withdrawn_by);

DO $$ DECLARE relation_name text; owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  FOREACH relation_name IN ARRAY ARRAY['fee_invoice_self_payer_entitlements','fee_invoice_self_payer_revocations',
    'fee_instalment_requests','fee_instalment_decisions','fee_instalment_withdrawals'] LOOP
    EXECUTE format('CREATE TRIGGER finance_arrangement_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_fee_record()',relation_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',relation_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',relation_name); END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',relation_name,owner_name);
  END LOOP;
END $$;

-- Realtime carries neutral source identifiers only. Every replay uses current fee access.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_finance_arrangements;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT event_user_is_authorized_before_finance_arrangements(event_school_id,
    CASE WHEN event_name IN ('finance.instalment.requested','finance.instalment.decided','finance.instalment.withdrawn',
      'finance.self_payer.enabled','finance.self_payer.revoked') THEN 'fees.updated' ELSE event_name END,event_payload,candidate_user_id)
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
