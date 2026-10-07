-- Institution activation and account trust.
-- A newly provisioned tenant remains a draft until its real operating records
-- satisfy the selected capability pack and a verified, MFA-protected admin
-- publishes a fresh readiness decision.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Accounts that existed before this release have already passed the legacy
-- account/invitation path. New registrations have no default and must verify.
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at);

CREATE TABLE auth_account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(24) NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_account_tokens_user_purpose_idx
  ON auth_account_tokens(user_id,purpose,created_at DESC);

CREATE TABLE auth_mfa_factors (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret bytea NOT NULL,
  secret_iv bytea NOT NULL,
  secret_tag bytea NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  confirmed_at timestamptz,
  last_used_step bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='active') = (confirmed_at IS NOT NULL))
);

CREATE TABLE auth_mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,code_hash)
);

CREATE TABLE auth_mfa_login_challenges (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_mfa_login_challenges_user_idx
  ON auth_mfa_login_challenges(user_id,created_at DESC);

CREATE TABLE institution_capability_packs (
  code varchar(64) PRIMARY KEY,
  label varchar(120) NOT NULL,
  description varchar(500) NOT NULL,
  institution_kinds text[] NOT NULL,
  cohort_label varchar(48) NOT NULL,
  learner_label varchar(48) NOT NULL,
  default_subject_names text[] NOT NULL,
  requires_staff boolean NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  CHECK (cardinality(institution_kinds)>0),
  CHECK (cardinality(default_subject_names)>0)
);

INSERT INTO institution_capability_packs
  (code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff)
VALUES
  ('india_school_core','Indian school core','Daily school operations with classes, guardian-aware enrolment and staff-owned attendance.',ARRAY['school','hybrid'], 'Class or section','Student',ARRAY['English','Mathematics','Science','Social Science'],true),
  ('india_college_core','Indian college core','Term, cohort and course readiness for a college or higher-education institution.',ARRAY['college','hybrid'], 'Cohort or section','Learner',ARRAY['Communication Skills','Core Course','Elective'],true),
  ('coaching_core','Coaching workspace','A low-friction batch, learner, schedule and attendance setup for tutors and coaching groups.',ARRAY['coaching'], 'Batch','Learner',ARRAY['Core Subject'],false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE institution_activation_requirements (
  capability_pack varchar(64) NOT NULL REFERENCES institution_capability_packs(code),
  requirement_key varchar(48) NOT NULL,
  label varchar(140) NOT NULL,
  description varchar(500) NOT NULL,
  target_path varchar(180) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  PRIMARY KEY(capability_pack,requirement_key),
  CHECK (requirement_key ~ '^[a-z][a-z0-9_]{2,47}$')
);

INSERT INTO institution_activation_requirements
  (capability_pack,requirement_key,label,description,target_path,required,sort_order)
SELECT pack.code, requirement.key, requirement.label, requirement.description, requirement.path,
  CASE WHEN requirement.key='staff_owner' THEN pack.requires_staff ELSE requirement.required END,
  requirement.sort_order
FROM institution_capability_packs pack
CROSS JOIN (VALUES
  ('owner_email','Verify owner email','Confirm the administrator contact before institution activation.','/account/security',true,10),
  ('owner_mfa','Protect privileged access','Activate two-step verification for the administrator publishing this workspace.','/account/security',true,20),
  ('institution_profile','Confirm institution profile','Review institution type, capability pack and operating profile.','/principal/governance',true,30),
  ('fallback_contact','Add a fallback contact','Record a phone or email staff can use when the digital workflow is unavailable.','/principal/administration',true,40),
  ('academic_term','Create an active term','Set the real academic year and operating dates.','/principal/administration',true,50),
  ('cohort','Create a class or batch','Create at least one current teaching group.','/principal/administration',true,60),
  ('subject','Add subjects or courses','Add at least one subject used by the timetable and attendance views.','/principal/administration',true,70),
  ('attendance_policy','Set attendance rules','Record the minimum attendance and document threshold for the active term.','/principal/administration',true,80),
  ('staff_owner','Assign teaching staff','Activate or invite at least one staff member who can own a register.','/principal/invitations',true,90),
  ('learner','Enrol a learner','Create a real learner record with an active term enrolment.','/principal/students',true,100),
  ('schedule','Publish a baseline schedule','Add at least one timetable period for the active term.','/principal/timetable/weekly',true,110)
) AS requirement(key,label,description,path,required,sort_order)
ON CONFLICT DO NOTHING;

CREATE TABLE institution_activation_states (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  capability_pack varchar(64) NOT NULL REFERENCES institution_capability_packs(code),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','active')),
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  activated_by uuid REFERENCES users(id),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_activation_review_check CHECK (status='draft' OR reviewed_at IS NOT NULL),
  CONSTRAINT institution_activation_publish_check CHECK (status<>'active' OR activated_at IS NOT NULL)
);

CREATE TABLE institution_activation_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(40) NOT NULL CHECK (action IN ('quick_start_applied','readiness_reviewed','activated')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_activation_audits_school_idx
  ON institution_activation_audits(school_id,created_at DESC);

CREATE OR REPLACE FUNCTION institution_pack_for_kind(kind text)
RETURNS varchar LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE kind
    WHEN 'college' THEN 'india_college_core'
    WHEN 'coaching' THEN 'coaching_core'
    ELSE 'india_school_core'
  END::varchar
$$;
REVOKE ALL ON FUNCTION institution_pack_for_kind(text) FROM PUBLIC;

INSERT INTO institution_activation_states(school_id,capability_pack,status,readiness_snapshot,reviewed_at,activated_at)
SELECT school.id,
  COALESCE(profile.capability_packs[1],institution_pack_for_kind(school.institution_kind)),
  CASE WHEN EXISTS(SELECT 1 FROM academic_terms term WHERE term.school_id=school.id)
    AND EXISTS(SELECT 1 FROM class_sections section WHERE section.school_id=school.id)
    AND EXISTS(SELECT 1 FROM subjects subject WHERE subject.school_id=school.id)
    AND EXISTS(SELECT 1 FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id WHERE student.school_id=school.id AND enrollment.is_active)
    AND EXISTS(SELECT 1 FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id WHERE section.school_id=school.id)
    THEN 'active' ELSE 'draft' END,
  CASE WHEN EXISTS(SELECT 1 FROM academic_terms term WHERE term.school_id=school.id)
    THEN jsonb_build_object('source','legacy_migration','reviewed_at',now()) ELSE '{}'::jsonb END,
  CASE WHEN EXISTS(SELECT 1 FROM academic_terms term WHERE term.school_id=school.id) THEN now() END,
  CASE WHEN EXISTS(SELECT 1 FROM academic_terms term WHERE term.school_id=school.id)
    AND EXISTS(SELECT 1 FROM class_sections section WHERE section.school_id=school.id)
    AND EXISTS(SELECT 1 FROM subjects subject WHERE subject.school_id=school.id)
    AND EXISTS(SELECT 1 FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id WHERE student.school_id=school.id AND enrollment.is_active)
    AND EXISTS(SELECT 1 FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id WHERE section.school_id=school.id)
    THEN now() END
FROM schools school
LEFT JOIN institution_regulatory_profiles profile ON profile.school_id=school.id
ON CONFLICT (school_id) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_institution_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO institution_activation_states(school_id,capability_pack)
  VALUES(NEW.id,institution_pack_for_kind(NEW.institution_kind))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER schools_institution_activation AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION seed_institution_activation();
REVOKE ALL ON FUNCTION seed_institution_activation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION bump_institution_activation_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER institution_activation_revision_guard
  BEFORE UPDATE ON institution_activation_states
  FOR EACH ROW EXECUTE FUNCTION bump_institution_activation_revision();
REVOKE ALL ON FUNCTION bump_institution_activation_revision() FROM PUBLIC;

ALTER TABLE auth_account_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_login_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_capability_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_activation_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_activation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_activation_audits ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE object_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH object_name IN ARRAY ARRAY[
    'auth_account_tokens','auth_mfa_factors','auth_mfa_recovery_codes','auth_mfa_login_challenges',
    'institution_capability_packs','institution_activation_requirements','institution_activation_states','institution_activation_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',object_name); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',object_name); END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',object_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION institution_pack_for_kind(text) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION seed_institution_activation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION bump_institution_activation_revision() OWNER TO %I',owner_name);
END $$;
