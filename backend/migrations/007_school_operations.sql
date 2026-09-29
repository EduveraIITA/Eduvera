ALTER TABLE auth_sessions ADD COLUMN active_school_id uuid REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN onboarding_pending boolean NOT NULL DEFAULT false;

CREATE TABLE school_permission_grants (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('sis.manage', 'fees.manage')),
  PRIMARY KEY (school_id, user_id, permission)
);

CREATE TABLE school_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'guardian', 'staff', 'admin')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_operations_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_operations_audit_school ON school_operations_audit(school_id, created_at DESC);

CREATE TABLE fee_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL REFERENCES students(id),
  reference varchar(80) NOT NULL,
  description varchar(200) NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  due_on date NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, reference)
);
CREATE INDEX fee_invoices_student ON fee_invoices(school_id, student_id, due_on);

CREATE TABLE fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  invoice_id uuid NOT NULL REFERENCES fee_invoices(id),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque')),
  reference varchar(120) NOT NULL,
  idempotency_key uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, idempotency_key),
  UNIQUE (school_id, method, reference)
);

-- Financial records are append-only. Corrections require a future credit/refund
-- workflow; never silently edit a posted invoice or receipt.
CREATE FUNCTION protect_fee_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted fee records cannot be updated or deleted';
END;
$$;
CREATE TRIGGER fee_invoices_immutable BEFORE UPDATE OR DELETE ON fee_invoices
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
CREATE TRIGGER fee_payments_immutable BEFORE UPDATE OR DELETE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
