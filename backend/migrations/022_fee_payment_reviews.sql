-- Submissions are claims, never ledger payments. Both claims and decisions are append-only.
CREATE TABLE school_fee_payment_settings (
  school_id uuid PRIMARY KEY REFERENCES schools(id),
  payee_name varchar(120) NOT NULL DEFAULT '',
  upi_id varchar(160) NOT NULL DEFAULT '',
  instructions varchar(2000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fee_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('payment','charge')),
  amount_paise integer,
  method text CHECK(method IN ('cash','bank_transfer','cheque')),
  reference varchar(120),
  note varchar(1000) NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,idempotency_key),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  CHECK((kind='payment' AND amount_paise IS NOT NULL AND amount_paise>0 AND method IS NOT NULL AND reference IS NOT NULL AND length(trim(reference))>0)
    OR (kind='charge' AND amount_paise IS NULL AND method IS NULL AND reference IS NULL AND length(trim(note))>=5))
);
CREATE INDEX fee_review_requests_invoice ON fee_review_requests(school_id,invoice_id,created_at);
CREATE TABLE fee_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  outcome text NOT NULL CHECK(outcome IN ('verified','rejected','answered')),
  response varchar(1000) NOT NULL CHECK(length(trim(response))>=5),
  payment_id uuid REFERENCES fee_payments(id),
  reviewed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,request_id) REFERENCES fee_review_requests(school_id,id),
  CHECK((outcome='verified' AND payment_id IS NOT NULL) OR (outcome<>'verified' AND payment_id IS NULL))
);
CREATE TRIGGER fee_review_requests_immutable BEFORE UPDATE OR DELETE ON fee_review_requests
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
CREATE TRIGGER fee_review_decisions_immutable BEFORE UPDATE OR DELETE ON fee_review_decisions
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();

-- Re-evaluate live/replayed event authority after a guardian link or staff grant changes.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_fee_reviews;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE WHEN event_name='fees.updated' THEN EXISTS (
  SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
  WHERE m.school_id=event_school_id AND m.user_id=candidate_user_id AND m.is_active AND (
   m.role='admin' OR (m.role='staff' AND EXISTS(SELECT 1 FROM school_permission_grants g
    WHERE g.school_id=m.school_id AND g.user_id=m.user_id AND g.permission='fees.manage'))
   OR (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id
    WHERE p.user_id=m.user_id AND gr.school_id=m.school_id AND gr.student_id::text=event_payload->>'student_id'))
   OR (m.role='student' AND EXISTS(SELECT 1 FROM students s WHERE s.school_id=m.school_id
    AND s.user_id=m.user_id AND s.id::text=event_payload->>'student_id'))
  )
 ) ELSE event_user_is_authorized_before_fee_reviews(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; table_name text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
 FOREACH table_name IN ARRAY ARRAY['school_fee_payment_settings','fee_review_requests','fee_review_decisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
 END LOOP;
 EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
