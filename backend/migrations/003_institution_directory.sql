CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE institution_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(180) NOT NULL CHECK (length(trim(name)) > 0),
  institution_type text NOT NULL CHECK (institution_type IN ('school','college','university','standalone','other')),
  source text NOT NULL CHECK (source IN ('UDISE','AISHE','MANUAL')),
  source_code text,
  state text NOT NULL DEFAULT '',
  district text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  is_verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_code IS NULL OR (source_code = upper(trim(source_code)) AND length(source_code) > 0)),
  CHECK ((source = 'MANUAL' AND source_code IS NULL AND NOT is_verified) OR (source <> 'MANUAL' AND source_code IS NOT NULL)),
  UNIQUE (source, source_code)
);
CREATE INDEX directory_name_trgm ON institution_directory USING gin (lower(name) gin_trgm_ops);
CREATE INDEX directory_code_trgm ON institution_directory USING gin (lower(source_code) gin_trgm_ops);
CREATE INDEX directory_city_trgm ON institution_directory USING gin (lower(city) gin_trgm_ops);
CREATE INDEX directory_district_trgm ON institution_directory USING gin (lower(district) gin_trgm_ops);
CREATE INDEX directory_filters ON institution_directory (lower(state), institution_type);
CREATE INDEX directory_type ON institution_directory (institution_type);
CREATE INDEX directory_name_prefix ON institution_directory (lower(name) text_pattern_ops);

-- Company authority is separate from school-admin membership and cannot be self-granted.
CREATE TABLE company_operators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No changes to schools. A directory identity can belong to exactly one tenant.
CREATE TABLE institution_onboarding (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  directory_id uuid NOT NULL UNIQUE REFERENCES institution_directory(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'setup_in_progress' CHECK (status IN ('setup_in_progress','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Existing school codes are internal, not presumed to be UDISE/AISHE identifiers.
INSERT INTO institution_directory (id, name, institution_type, source, metadata)
SELECT id, name, 'other', 'MANUAL', jsonb_build_object('legacy_school_id', id) FROM schools;
INSERT INTO institution_onboarding (school_id, directory_id, status)
SELECT id, id, 'active' FROM schools;

CREATE TABLE institution_admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX institution_pending_admin ON institution_admin_invitations(school_id)
WHERE accepted_at IS NULL AND revoked_at IS NULL;
