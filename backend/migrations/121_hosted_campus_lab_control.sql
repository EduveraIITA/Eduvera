-- Stage-development control for the synthetic Cambridge actor harness. This is
-- not an institution operating rule and must never be enabled for customer data.
CREATE TABLE hosted_campus_lab_controls (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled IN (true, false))
);
ALTER TABLE hosted_campus_lab_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hosted_campus_lab_controls FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON hosted_campus_lab_controls FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON hosted_campus_lab_controls FROM authenticated; END IF;
END $$;
COMMENT ON TABLE hosted_campus_lab_controls IS 'Stage-only durable start/stop state for the synthetic Cambridge Campus Lab runner.';
