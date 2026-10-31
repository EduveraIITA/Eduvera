-- Purpose-first progressive onboarding.
--
-- Account possession, a private operational workspace, selected starting outcomes
-- and organisation verification are intentionally separate.  The internal school
-- compatibility record remains required while OperationalRealm migration proceeds,
-- but an unnamed private workspace is not a public institution claim.

ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_institution_kind_check;
ALTER TABLE schools ADD CONSTRAINT schools_institution_kind_check
  CHECK (institution_kind IN ('unspecified','school','college','coaching','hybrid'));

ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_onboarding_model_check;
ALTER TABLE schools ADD CONSTRAINT schools_onboarding_model_check
  CHECK (onboarding_model IN ('progressive_private','company_managed','company_verified','self_service_coaching'));

ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_verification_status_check;
ALTER TABLE schools ADD CONSTRAINT schools_verification_status_check
  CHECK (verification_status IN ('not_verified','not_required','pending','approved','rejected'));

CREATE TABLE progressive_onboarding_goal_catalog (
  goal_key varchar(40) PRIMARY KEY,
  label varchar(100) NOT NULL,
  description varchar(500) NOT NULL,
  destination varchar(180) NOT NULL,
  setup_capability varchar(40),
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CHECK (goal_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  CHECK (setup_capability IS NULL OR setup_capability ~ '^[a-z][a-z0-9_]{1,39}$')
);

INSERT INTO progressive_onboarding_goal_catalog
  (goal_key,label,description,destination,setup_capability,sort_order)
VALUES
  ('attendance','Attendance','Create and submit registers for the groups you run.','/principal/get-started/attendance','attendance',10),
  ('gate','Entry & exit','Record accepted arrivals and departures at a real entry point.','/principal/get-started/gate','gate',20),
  ('timetable','Timetable & classes','Plan groups, people, places and recurring sessions.','/principal/get-started/timetable','timetable',30),
  ('examinations','Examinations','Create and coordinate a valid examination plan.','/principal/get-started/examinations','examinations',40),
  ('performance','Student performance','Track assessments, reports and learner progress.','/principal/results',NULL,50),
  ('staff','Staff coordination','Coordinate people, responsibilities, availability and cover.','/principal/get-started/staff','staff',60),
  ('messages','Messages & family communication','Reach the right audience through governed communication.','/principal/get-started/messages','messages',70)
ON CONFLICT (goal_key) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  destination=EXCLUDED.destination,
  setup_capability=EXCLUDED.setup_capability,
  sort_order=EXCLUDED.sort_order,
  is_active=true;

CREATE TABLE progressive_onboarding_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provisioned_for_account_id uuid UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  profile_named boolean NOT NULL DEFAULT false,
  status varchar(24) NOT NULL DEFAULT 'purpose_required'
    CHECK (status IN ('purpose_required','ready')),
  resume_step varchar(24) NOT NULL DEFAULT 'purpose'
    CHECK (resume_step IN ('purpose','first_use','operating')),
  resume_goal_key varchar(40) REFERENCES progressive_onboarding_goal_catalog(goal_key),
  resume_path varchar(180) NOT NULL DEFAULT '/onboarding/start',
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (resume_path LIKE '/%')
);

CREATE TABLE progressive_onboarding_goal_selections (
  workspace_id uuid NOT NULL REFERENCES progressive_onboarding_workspaces(id) ON DELETE CASCADE,
  goal_key varchar(40) NOT NULL REFERENCES progressive_onboarding_goal_catalog(goal_key),
  priority integer NOT NULL CHECK (priority>0),
  selected_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,goal_key),
  UNIQUE(workspace_id,priority)
);

CREATE TABLE progressive_onboarding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES progressive_onboarding_workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(40) NOT NULL CHECK(action IN (
    'workspace_provisioned','goals_selected','resume_updated','profile_named','verification_submitted'
  )),
  revision integer NOT NULL CHECK(revision>0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX progressive_onboarding_audits_workspace_idx
  ON progressive_onboarding_audits(workspace_id,created_at DESC);

-- An organisation-verification application is attached to the already-existing
-- private workspace from submission onward.  Approval updates that workspace; it
-- cannot manufacture a second tenant.
ALTER TABLE institution_onboarding_applications
  ADD COLUMN workspace_school_id uuid REFERENCES schools(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX institution_onboarding_open_workspace_idx
  ON institution_onboarding_applications(workspace_school_id)
  WHERE status IN ('submitted','needs_information');

ALTER TABLE progressive_onboarding_goal_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE progressive_onboarding_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE progressive_onboarding_goal_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE progressive_onboarding_audits ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE object_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH object_name IN ARRAY ARRAY[
    'progressive_onboarding_goal_catalog','progressive_onboarding_workspaces',
    'progressive_onboarding_goal_selections','progressive_onboarding_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',object_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',object_name);
    END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',object_name,owner_name);
  END LOOP;
END $$;
