-- Two-lane tenant onboarding:
--   1. Formal institutions are provisioned only after company review.
--   2. Small coaching workspaces are self-service and explicitly unverified.

ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_institution_kind_check;
ALTER TABLE schools
  ADD CONSTRAINT schools_institution_kind_check
    CHECK (institution_kind IN ('school','college','coaching','hybrid')),
  ADD COLUMN onboarding_model varchar(32) NOT NULL DEFAULT 'company_managed'
    CHECK (onboarding_model IN ('company_managed','company_verified','self_service_coaching')),
  ADD COLUMN verification_status varchar(24) NOT NULL DEFAULT 'approved'
    CHECK (verification_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN created_by_user_id uuid REFERENCES users(id);

CREATE TABLE institution_onboarding_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid NOT NULL REFERENCES users(id),
  institution_name varchar(180) NOT NULL,
  requested_code varchar(32) NOT NULL,
  institution_kind varchar(24) NOT NULL CHECK (institution_kind IN ('school','college','hybrid')),
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
  state_code varchar(12) NOT NULL,
  district varchar(120) NOT NULL,
  website varchar(240) NOT NULL DEFAULT '',
  applicant_role_title varchar(120) NOT NULL,
  regulator_type varchar(32) NOT NULL CHECK (regulator_type IN ('udise','aishe','board_affiliation','trust_registration','other')),
  regulator_reference varchar(180) NOT NULL,
  declaration_accepted boolean NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','needs_information','approved','rejected','withdrawn')),
  review_note varchar(1000) NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  provisioned_school_id uuid REFERENCES schools(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_code ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  CHECK (declaration_accepted),
  CHECK ((status = 'approved') = (provisioned_school_id IS NOT NULL)),
  CHECK ((status IN ('needs_information','approved','rejected')) = (reviewed_by IS NOT NULL)),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);
CREATE UNIQUE INDEX institution_onboarding_open_code_idx
  ON institution_onboarding_applications(requested_code)
  WHERE status IN ('submitted','needs_information','approved');
CREATE INDEX institution_onboarding_applicant_idx
  ON institution_onboarding_applications(applicant_user_id,created_at DESC);
CREATE INDEX institution_onboarding_review_queue_idx
  ON institution_onboarding_applications(status,submitted_at);

CREATE TABLE institution_onboarding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES institution_onboarding_applications(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(40) NOT NULL CHECK (action IN ('submitted','resubmitted','information_requested','approved','rejected','withdrawn')),
  from_status varchar(24),
  to_status varchar(24) NOT NULL,
  note varchar(1000) NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_onboarding_audit_application_idx
  ON institution_onboarding_audits(application_id,created_at);

ALTER TABLE institution_onboarding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_onboarding_audits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE institution_onboarding_applications,institution_onboarding_audits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE institution_onboarding_applications,institution_onboarding_audits FROM authenticated;
  END IF;
END $$;

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('REVOKE ALL ON TABLE institution_onboarding_applications,institution_onboarding_audits FROM PUBLIC');
  EXECUTE format('ALTER TABLE institution_onboarding_applications OWNER TO %I',owner_name);
  EXECUTE format('ALTER TABLE institution_onboarding_audits OWNER TO %I',owner_name);
END $$;
