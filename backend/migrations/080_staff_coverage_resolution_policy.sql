-- A coverage deadline closes the planning queue without pretending that an
-- unattended class was covered. Schools configure the prospective fallback;
-- tasks found only after their period ended retain an explicit unconfirmed outcome.

CREATE TABLE staff_coverage_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  deadline_minutes_before smallint NOT NULL DEFAULT 30
    CHECK (deadline_minutes_before BETWEEN 0 AND 1440),
  fallback_kind varchar(32) NOT NULL DEFAULT 'independent_study'
    CHECK (fallback_kind IN ('independent_study','physical_activity','library_period','merge_class','cancelled_period')),
  fallback_label varchar(120) NOT NULL DEFAULT 'Independent study',
  supervisor_staff_profile_id uuid REFERENCES staff_profiles(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO staff_coverage_policies(school_id,updated_by)
SELECT school.id,membership.user_id
FROM schools school
JOIN LATERAL (
  SELECT user_id FROM school_memberships
  WHERE school_id=school.id AND role='admin' AND is_active
  ORDER BY created_at,id LIMIT 1
) membership ON true
ON CONFLICT DO NOTHING;

CREATE TRIGGER staff_coverage_policy_revision_guard
  BEFORE UPDATE ON staff_coverage_policies
  FOR EACH ROW EXECUTE FUNCTION bump_staff_assignment_revision();

ALTER TABLE staff_coverage_tasks
  DROP CONSTRAINT IF EXISTS staff_coverage_tasks_status_check;
ALTER TABLE staff_coverage_tasks
  ADD CONSTRAINT staff_coverage_tasks_status_check
  CHECK (status IN ('open','offered','accepted','declined','completed','cancelled','fallback_applied','expired_unconfirmed'));
ALTER TABLE staff_coverage_tasks
  ADD COLUMN fallback_kind varchar(32),
  ADD COLUMN fallback_label varchar(120) NOT NULL DEFAULT '',
  ADD COLUMN fallback_supervisor_staff_profile_id uuid REFERENCES staff_profiles(id),
  ADD COLUMN resolution_policy_revision integer,
  ADD COLUMN resolved_at timestamptz;
ALTER TABLE staff_coverage_tasks
  ADD CONSTRAINT staff_coverage_tasks_fallback_kind_check
  CHECK (fallback_kind IS NULL OR fallback_kind IN ('independent_study','physical_activity','library_period','merge_class','cancelled_period','unconfirmed'));

ALTER TABLE staff_coverage_task_audits
  DROP CONSTRAINT IF EXISTS staff_coverage_task_audits_action_check;
ALTER TABLE staff_coverage_task_audits
  ADD CONSTRAINT staff_coverage_task_audits_action_check
  CHECK (action IN ('created','offered','accepted','declined','reassigned','completed','cancelled','fallback_applied','expired_unconfirmed'));
ALTER TABLE staff_coverage_task_audits
  ADD COLUMN automated boolean NOT NULL DEFAULT false;

CREATE INDEX staff_coverage_pending_deadline_idx
  ON staff_coverage_tasks(school_id,duty_date,starts_at,ends_at)
  WHERE status IN ('open','offered','declined');

CREATE OR REPLACE FUNCTION validate_staff_coverage_policy_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE profile_school uuid; profile_status varchar;
BEGIN
  IF NEW.supervisor_staff_profile_id IS NOT NULL THEN
    SELECT school_id,status INTO profile_school,profile_status
    FROM staff_profiles WHERE id=NEW.supervisor_staff_profile_id;
    IF profile_school IS DISTINCT FROM NEW.school_id OR profile_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Fallback supervisor must be active in the same school' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER staff_coverage_policy_scope_guard
  AFTER INSERT OR UPDATE ON staff_coverage_policies
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION validate_staff_coverage_policy_scope();

ALTER TABLE staff_coverage_policies ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE staff_coverage_policies FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE staff_coverage_policies FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON TABLE staff_coverage_policies FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_staff_coverage_policy_scope() FROM PUBLIC;

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('ALTER TABLE staff_coverage_policies OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_staff_coverage_policy_scope() OWNER TO %I',owner_name);
END $$;
