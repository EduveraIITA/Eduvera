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
SELECT id, name, CASE WHEN institution_kind IN ('school','college') THEN institution_kind ELSE 'other' END, 'MANUAL', jsonb_build_object('legacy_school_id', id) FROM schools;
INSERT INTO institution_onboarding (school_id, directory_id, status)
SELECT s.id, s.id, CASE WHEN a.status='active' THEN 'active' ELSE 'setup_in_progress' END FROM schools s LEFT JOIN institution_activation_states a ON a.school_id=s.id;


-- All existing provisioning paths remain visible in the master directory.
CREATE FUNCTION register_manual_institution_directory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO institution_directory(id,name,institution_type,source)
    VALUES(NEW.id,NEW.name,CASE WHEN NEW.institution_kind IN ('school','college') THEN NEW.institution_kind ELSE 'other' END,'MANUAL');
  INSERT INTO institution_onboarding(school_id,directory_id) VALUES(NEW.id,NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER schools_directory AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION register_manual_institution_directory();

CREATE FUNCTION sync_directory_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE institution_onboarding SET status=CASE WHEN NEW.status='active' THEN 'active' ELSE 'setup_in_progress' END,updated_at=now()
    WHERE school_id=NEW.school_id AND status <> 'suspended';
  RETURN NEW;
END $$;
CREATE TRIGGER directory_activation AFTER UPDATE OF status ON institution_activation_states FOR EACH ROW EXECUTE FUNCTION sync_directory_activation();

CREATE FUNCTION remove_manual_directory_on_tenant_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE directory uuid;
BEGIN
  SELECT directory_id INTO directory FROM institution_onboarding WHERE school_id=OLD.id;
  DELETE FROM institution_onboarding WHERE school_id=OLD.id;
  DELETE FROM institution_directory WHERE id=directory AND source='MANUAL';
  RETURN OLD;
END $$;
CREATE TRIGGER schools_directory_cleanup BEFORE DELETE ON schools FOR EACH ROW EXECUTE FUNCTION remove_manual_directory_on_tenant_delete();

-- Only the runtime owner may access these tables; browsers use the bounded API.
ALTER TABLE institution_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_onboarding ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE runtime_owner text; restricted_role text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_memberships'::regclass;
  EXECUTE format('ALTER TABLE institution_directory OWNER TO %I',runtime_owner);
  EXECUTE format('ALTER TABLE institution_onboarding OWNER TO %I',runtime_owner);
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON institution_directory,institution_onboarding FROM %I',restricted_role);
    END IF;
  END LOOP;
END $$;
