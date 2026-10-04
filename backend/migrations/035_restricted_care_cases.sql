-- Restricted care and child-protection case workflow.
-- Sensitive narratives are application-encrypted before they reach PostgreSQL.

CREATE TABLE restricted_care_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_kind varchar(32) NOT NULL CHECK (role_kind IN ('designated_lead','deputy_lead','institution_head','counsellor','external_liaison')),
  route_kind varchar(16) NOT NULL CHECK (route_kind IN ('primary','alternate')),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason varchar(1000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,id),
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CHECK ((status='active' AND revoked_at IS NULL AND revoked_by IS NULL) OR
         (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(trim(revocation_reason)) >= 12))
);
CREATE UNIQUE INDEX restricted_care_active_role_idx
  ON restricted_care_role_assignments(school_id,user_id,role_kind,route_kind)
  WHERE status='active';
CREATE INDEX restricted_care_route_lookup_idx
  ON restricted_care_role_assignments(school_id,route_kind,valid_from,valid_until)
  WHERE status='active';

CREATE TABLE restricted_care_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE RESTRICT,
  reported_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intake_route varchar(16) NOT NULL CHECK (intake_route IN ('primary','alternate')),
  source_kind varchar(24) NOT NULL CHECK (source_kind IN ('staff_observation','child_disclosure','guardian_report','student_report','anonymous','other')),
  urgency varchar(12) NOT NULL CHECK (urgency IN ('urgent','priority','routine')),
  concern_category varchar(28) NOT NULL CHECK (concern_category IN ('sexual_safety','physical_safety','emotional_wellbeing','neglect','bullying','cyber_safety','other')),
  safety_state varchar(28) NOT NULL CHECK (safety_state IN ('immediate_action_required','actions_underway','no_immediate_danger','unknown')),
  ordinary_handler_involved boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','triage','active','closed')),
  reporting_state varchar(24) NOT NULL DEFAULT 'assessment_required' CHECK (reporting_state IN ('assessment_required','reporting_required','reported','not_applicable')),
  observed_at timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  retention_review_on date,
  legal_hold boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,id),
  CHECK ((status='closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL) OR
         (status<>'closed' AND closed_at IS NULL AND closed_by IS NULL)),
  CHECK (NOT ordinary_handler_involved OR intake_route='alternate')
);
CREATE INDEX restricted_care_cases_school_state_idx ON restricted_care_cases(school_id,status,last_activity_at DESC);
CREATE INDEX restricted_care_cases_student_idx ON restricted_care_cases(school_id,student_id,last_activity_at DESC) WHERE student_id IS NOT NULL;

CREATE TABLE restricted_care_case_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_role varchar(16) NOT NULL CHECK (assignment_role IN ('reporter','owner','backup','contributor','reviewer')),
  access_level varchar(16) NOT NULL CHECK (access_level IN ('intake_only','full')),
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason varchar(1000) NOT NULL DEFAULT '',
  CONSTRAINT restricted_care_assignment_case_fk FOREIGN KEY (school_id,case_id)
    REFERENCES restricted_care_cases(school_id,id) ON DELETE CASCADE,
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR
         (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(trim(revocation_reason)) >= 12))
);
CREATE UNIQUE INDEX restricted_care_active_case_assignment_idx
  ON restricted_care_case_assignments(case_id,user_id) WHERE revoked_at IS NULL;
CREATE INDEX restricted_care_assignment_user_idx
  ON restricted_care_case_assignments(school_id,user_id,assigned_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE restricted_care_case_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  entry_type varchar(28) NOT NULL CHECK (entry_type IN ('intake_note','safety_action','contact','reporting_decision','case_note','outcome','handover')),
  ciphertext bytea NOT NULL,
  content_iv bytea NOT NULL CHECK (octet_length(content_iv)=12),
  content_tag bytea NOT NULL CHECK (octet_length(content_tag)=16),
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restricted_care_entry_case_fk FOREIGN KEY (school_id,case_id)
    REFERENCES restricted_care_cases(school_id,id) ON DELETE CASCADE
);
CREATE INDEX restricted_care_entries_case_idx ON restricted_care_case_entries(case_id,created_at,id);

CREATE TABLE restricted_care_external_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  authority_type varchar(24) NOT NULL CHECK (authority_type IN ('sjpu','local_police','child_welfare_committee','child_helpline','other')),
  reported_at timestamptz NOT NULL,
  reference_ciphertext bytea NOT NULL,
  reference_iv bytea NOT NULL CHECK (octet_length(reference_iv)=12),
  reference_tag bytea NOT NULL CHECK (octet_length(reference_tag)=16),
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version > 0),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restricted_care_report_case_fk FOREIGN KEY (school_id,case_id)
    REFERENCES restricted_care_cases(school_id,id) ON DELETE CASCADE
);
CREATE INDEX restricted_care_reports_case_idx ON restricted_care_external_reports(case_id,reported_at,id);

CREATE TABLE restricted_care_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  case_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restricted_care_audit_case_fk FOREIGN KEY (school_id,case_id)
    REFERENCES restricted_care_cases(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX restricted_care_audit_case_idx ON restricted_care_audits(school_id,case_id,created_at DESC);

CREATE OR REPLACE FUNCTION bump_restricted_care_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER restricted_care_role_revision BEFORE UPDATE ON restricted_care_role_assignments
  FOR EACH ROW EXECUTE FUNCTION bump_restricted_care_revision();
CREATE TRIGGER restricted_care_case_revision BEFORE UPDATE ON restricted_care_cases
  FOR EACH ROW EXECUTE FUNCTION bump_restricted_care_revision();
REVOKE ALL ON FUNCTION bump_restricted_care_revision() FROM PUBLIC;

CREATE OR REPLACE FUNCTION validate_restricted_care_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE active_member boolean; student_school uuid; subject_user uuid;
BEGIN
  subject_user := COALESCE(
    NULLIF(to_jsonb(NEW)->>'user_id','')::uuid,
    NULLIF(to_jsonb(NEW)->>'reported_by','')::uuid
  );
  SELECT EXISTS(
    SELECT 1 FROM school_memberships
    WHERE school_id=NEW.school_id AND user_id=subject_user
      AND role IN ('admin','staff') AND is_active
  ) INTO active_member;
  IF NOT active_member THEN
    RAISE EXCEPTION 'Restricted care access requires an active staff membership' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='restricted_care_cases' AND NULLIF(to_jsonb(NEW)->>'student_id','') IS NOT NULL THEN
    SELECT school_id INTO student_school FROM students WHERE id=(to_jsonb(NEW)->>'student_id')::uuid;
    IF student_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Restricted care student must belong to the same institution' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER restricted_care_role_scope_guard AFTER INSERT OR UPDATE ON restricted_care_role_assignments
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_restricted_care_scope();
CREATE CONSTRAINT TRIGGER restricted_care_case_scope_guard AFTER INSERT OR UPDATE ON restricted_care_cases
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_restricted_care_scope();
CREATE CONSTRAINT TRIGGER restricted_care_assignment_scope_guard AFTER INSERT OR UPDATE ON restricted_care_case_assignments
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_restricted_care_scope();
REVOKE ALL ON FUNCTION validate_restricted_care_scope() FROM PUBLIC;

-- Existing institutions receive one explicit primary route holder so intake does not silently
-- fall back to every administrator. Institutions should configure a distinct alternate route.
INSERT INTO restricted_care_role_assignments(school_id,user_id,role_kind,route_kind,created_by)
SELECT school_id,user_id,'institution_head','primary',user_id
FROM (
  SELECT school_id,user_id,row_number() OVER (PARTITION BY school_id ORDER BY created_at,id) AS position
  FROM school_memberships WHERE role='admin' AND is_active
) ranked
WHERE position=1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_first_restricted_care_route()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.role='admin' AND NEW.is_active AND NOT EXISTS (
    SELECT 1 FROM restricted_care_role_assignments
    WHERE school_id=NEW.school_id AND route_kind='primary' AND status='active'
  ) THEN
    INSERT INTO restricted_care_role_assignments(school_id,user_id,role_kind,route_kind,created_by)
    VALUES(NEW.school_id,NEW.user_id,'institution_head','primary',NEW.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER school_membership_restricted_care_seed
  AFTER INSERT OR UPDATE OF is_active,role ON school_memberships
  FOR EACH ROW EXECUTE FUNCTION seed_first_restricted_care_route();
REVOKE ALL ON FUNCTION seed_first_restricted_care_route() FROM PUBLIC;

ALTER TABLE restricted_care_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_care_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_care_case_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_care_case_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_care_external_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_care_audits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE restricted_care_role_assignments,restricted_care_cases,restricted_care_case_assignments,
      restricted_care_case_entries,restricted_care_external_reports,restricted_care_audits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE restricted_care_role_assignments,restricted_care_cases,restricted_care_case_assignments,
      restricted_care_case_entries,restricted_care_external_reports,restricted_care_audits FROM authenticated;
  END IF;
END $$;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'restricted_care_role_assignments','restricted_care_cases','restricted_care_case_assignments',
    'restricted_care_case_entries','restricted_care_external_reports','restricted_care_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION bump_restricted_care_revision() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_restricted_care_scope() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION seed_first_restricted_care_route() OWNER TO %I',owner_name);
END $$;
