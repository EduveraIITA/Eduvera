-- Focused staff operations: service-record essentials, onboarding and leave.
-- Payroll, salary and performance-surveillance data intentionally do not live here.

CREATE TABLE staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  staff_code varchar(40) NOT NULL,
  first_name varchar(100) NOT NULL,
  last_name varchar(100) NOT NULL DEFAULT '',
  email varchar(254) NOT NULL,
  phone varchar(30) NOT NULL DEFAULT '',
  staff_kind varchar(24) NOT NULL CHECK (staff_kind IN ('teaching','non_teaching')),
  designation varchar(120) NOT NULL,
  department varchar(120) NOT NULL DEFAULT '',
  employment_type varchar(24) NOT NULL CHECK (employment_type IN ('full_time','part_time','contract')),
  joined_on date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','inactive')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, staff_code),
  UNIQUE (school_id, user_id)
);
CREATE UNIQUE INDEX staff_profiles_school_email_key ON staff_profiles(school_id, lower(email));
CREATE INDEX staff_profiles_school_status_idx ON staff_profiles(school_id, status, last_name, first_name);

CREATE TABLE staff_onboarding_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  item_key varchar(40) NOT NULL CHECK (item_key IN ('identity','service_contract','qualifications','emergency_contact','account_access')),
  label varchar(120) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note varchar(500) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_profile_id, item_key)
);
CREATE INDEX staff_onboarding_items_school_profile_idx ON staff_onboarding_items(school_id, staff_profile_id);

CREATE TABLE staff_leave_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year varchar(20) NOT NULL,
  code varchar(24) NOT NULL,
  name varchar(100) NOT NULL,
  annual_allowance numeric(7,2) NOT NULL CHECK (annual_allowance >= 0 AND annual_allowance <= 366),
  carry_forward_limit numeric(7,2) NOT NULL DEFAULT 0 CHECK (carry_forward_limit >= 0 AND carry_forward_limit <= 366),
  requires_document_after_days numeric(7,2) CHECK (requires_document_after_days > 0),
  is_paid boolean NOT NULL DEFAULT true,
  is_statutory boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year, code)
);
CREATE INDEX staff_leave_policies_school_year_idx ON staff_leave_policies(school_id, academic_year, is_active);

CREATE TABLE staff_leave_balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES staff_leave_policies(id) ON DELETE CASCADE,
  days numeric(7,2) NOT NULL CHECK (days <> 0 AND abs(days) <= 366),
  reason varchar(500) NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_leave_adjustments_profile_policy_idx ON staff_leave_balance_adjustments(staff_profile_id, policy_id, created_at);

CREATE TABLE staff_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES staff_leave_policies(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  portion varchar(20) NOT NULL DEFAULT 'full_day' CHECK (portion IN ('full_day','first_half','second_half')),
  requested_days numeric(7,2) NOT NULL CHECK (requested_days > 0 AND requested_days <= 62),
  reason varchar(1000) NOT NULL,
  handover_note varchar(1000) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','withdrawn')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (portion = 'full_day' OR ends_on = starts_on)
);
CREATE INDEX staff_leave_requests_school_status_idx ON staff_leave_requests(school_id, status, starts_on);
CREATE INDEX staff_leave_requests_profile_idx ON staff_leave_requests(staff_profile_id, starts_on DESC);

CREATE TABLE staff_leave_request_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES staff_leave_requests(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(24) NOT NULL CHECK (action IN ('submitted','approved','rejected','withdrawn')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  note varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_leave_audits_request_idx ON staff_leave_request_audits(request_id, created_at);

CREATE OR REPLACE FUNCTION bump_staff_operations_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER staff_profiles_revision_guard BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION bump_staff_operations_revision();
CREATE TRIGGER staff_leave_policies_revision_guard BEFORE UPDATE ON staff_leave_policies
  FOR EACH ROW EXECUTE FUNCTION bump_staff_operations_revision();
CREATE TRIGGER staff_leave_requests_revision_guard BEFORE UPDATE ON staff_leave_requests
  FOR EACH ROW EXECUTE FUNCTION bump_staff_operations_revision();
REVOKE ALL ON FUNCTION bump_staff_operations_revision() FROM PUBLIC;

-- Existing staff accounts become usable immediately. Their pre-existing school
-- access is treated as evidence that the legacy onboarding checks were completed.
INSERT INTO staff_profiles(school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status)
SELECT m.school_id,u.id,'STF-' || upper(substr(replace(u.id::text,'-',''),1,8)),u.first_name,u.last_name,lower(u.email),
  'teaching','Teacher','full_time',m.created_at::date,'active'
FROM school_memberships m JOIN users u ON u.id=m.user_id
WHERE m.role='staff'
ON CONFLICT DO NOTHING;

INSERT INTO staff_onboarding_items(school_id,staff_profile_id,item_key,label,required,completed_at,completed_by)
SELECT profile.school_id,profile.id,item.item_key,item.label,true,now(),profile.user_id
FROM staff_profiles profile CROSS JOIN (VALUES
  ('identity','Identity verified'),('service_contract','Service contract recorded'),
  ('qualifications','Qualifications checked'),('emergency_contact','Emergency contact recorded'),
  ('account_access','School account active')
) AS item(item_key,label)
ON CONFLICT DO NOTHING;

-- Starter policies are editable school configuration, not a legal entitlement.
-- The UI labels them as school-configured and allows leadership to revise them.
INSERT INTO staff_leave_policies(school_id,academic_year,code,name,annual_allowance,requires_document_after_days,is_paid)
SELECT DISTINCT t.school_id,t.academic_year,policy.code,policy.name,policy.allowance,policy.document_after,true
FROM academic_terms t CROSS JOIN (VALUES
  ('CASUAL','Casual leave',12::numeric,NULL::numeric),
  ('MEDICAL','Medical leave',10::numeric,2::numeric)
) AS policy(code,name,allowance,document_after)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION validate_staff_leave_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE profile_school uuid; policy_school uuid;
BEGIN
  SELECT school_id INTO profile_school FROM staff_profiles WHERE id=NEW.staff_profile_id;
  SELECT school_id INTO policy_school FROM staff_leave_policies WHERE id=NEW.policy_id;
  IF profile_school IS NULL OR policy_school IS NULL OR NEW.school_id IS DISTINCT FROM profile_school OR NEW.school_id IS DISTINCT FROM policy_school THEN
    RAISE EXCEPTION 'Staff leave references must belong to one school' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER staff_leave_request_scope_guard AFTER INSERT OR UPDATE ON staff_leave_requests
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_staff_leave_scope();
CREATE CONSTRAINT TRIGGER staff_leave_adjustment_scope_guard AFTER INSERT OR UPDATE ON staff_leave_balance_adjustments
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_staff_leave_scope();
REVOKE ALL ON FUNCTION validate_staff_leave_scope() FROM PUBLIC;

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_onboarding_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_request_audits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE staff_profiles,staff_onboarding_items,staff_leave_policies,staff_leave_balance_adjustments,staff_leave_requests,staff_leave_request_audits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE staff_profiles,staff_onboarding_items,staff_leave_policies,staff_leave_balance_adjustments,staff_leave_requests,staff_leave_request_audits FROM authenticated;
  END IF;
END $$;

-- Runtime tables are owned by the same restricted application role as the
-- established school domain. The migration connection itself may be a DDL-only
-- owner and must not become a hidden production dependency.
DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'staff_profiles','staff_onboarding_items','staff_leave_policies','staff_leave_balance_adjustments',
    'staff_leave_requests','staff_leave_request_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION bump_staff_operations_revision() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_staff_leave_scope() OWNER TO %I',owner_name);
END $$;
