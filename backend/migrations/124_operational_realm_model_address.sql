-- Domain-neutral realm, environment-qualified model identity and separate
-- semantic/protocol/capability registries. Existing school_id remains a
-- compatibility key while domains migrate through reviewed adapters.

CREATE TABLE operational_realms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_kind varchar(40) NOT NULL DEFAULT 'institution'
    CHECK (realm_kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  legacy_school_id uuid UNIQUE REFERENCES schools(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('setup','active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE execution_environment_namespaces (
  namespace_id text PRIMARY KEY CHECK (
    namespace_id ~ '^live:[^:[:space:]]+$'
    OR namespace_id ~ '^scenario:[^:[:space:]]+:run:[^:[:space:]]+$'
  ),
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  environment_kind varchar(16) NOT NULL CHECK (environment_kind IN ('live','simulation')),
  source_namespace_id text REFERENCES execution_environment_namespaces(namespace_id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','closed')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace_id,realm_id),
  CHECK (
    (environment_kind='live' AND source_namespace_id IS NULL AND expires_at IS NULL)
    OR (environment_kind='simulation' AND source_namespace_id IS NOT NULL AND expires_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX execution_environment_one_live_namespace_idx
  ON execution_environment_namespaces(realm_id) WHERE environment_kind='live';

INSERT INTO operational_realms(legacy_school_id,realm_kind,status)
SELECT id,'institution','active' FROM schools
ON CONFLICT(legacy_school_id) DO NOTHING;

INSERT INTO execution_environment_namespaces(namespace_id,realm_id,environment_kind,status)
SELECT 'live:'||realm.legacy_school_id::text,realm.id,'live','active'
FROM operational_realms realm WHERE realm.legacy_school_id IS NOT NULL
ON CONFLICT(namespace_id) DO NOTHING;

CREATE TABLE model_semantic_type_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace varchar(120) NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  type_key varchar(64) NOT NULL CHECK (type_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  definition_kind varchar(24) NOT NULL CHECK (definition_kind IN ('entity','relationship')),
  version integer NOT NULL CHECK (version > 0),
  owning_domain varchar(64) NOT NULL CHECK (owning_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  status varchar(16) NOT NULL CHECK (status IN ('approved','active','deprecated','retired')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  approved_by_authority varchar(160) NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace,type_key,definition_kind,version),
  CHECK ((status='active' AND activated_at IS NOT NULL) OR status<>'active'),
  CHECK ((status='retired' AND retired_at IS NOT NULL) OR status<>'retired')
);

CREATE TABLE model_protocol_schema_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace varchar(120) NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  schema_key varchar(120) NOT NULL CHECK (schema_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  protocol_kind varchar(24) NOT NULL
    CHECK (protocol_kind IN ('event','observation','assertion','message','command','outcome')),
  version integer NOT NULL CHECK (version > 0),
  owning_domain varchar(64) NOT NULL CHECK (owning_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  status varchar(16) NOT NULL CHECK (status IN ('approved','active','deprecated','retired')),
  schema_document jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  approved_by_authority varchar(160) NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace,schema_key,protocol_kind,version),
  CHECK ((status='active' AND activated_at IS NOT NULL) OR status<>'active'),
  CHECK ((status='retired' AND retired_at IS NOT NULL) OR status<>'retired')
);

CREATE TABLE model_capability_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace varchar(120) NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  capability_key varchar(80) NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  version integer NOT NULL CHECK (version > 0),
  status varchar(16) NOT NULL CHECK (status IN ('approved','active','deprecated','retired')),
  adapter_key varchar(160) NOT NULL,
  compatible_core_range varchar(80) NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  approved_by_authority varchar(160) NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace,capability_key,version),
  CHECK ((status='active' AND activated_at IS NOT NULL) OR status<>'active'),
  CHECK ((status='retired' AND retired_at IS NOT NULL) OR status<>'retired')
);

-- Seed only reviewed contract metadata. These records contain no tenant data.
INSERT INTO model_semantic_type_definitions(
  namespace,type_key,definition_kind,version,owning_domain,status,definition,
  content_hash,approved_by_authority,activated_at
) VALUES
  ('thatcampus.people','student','entity',1,'people','active',
    '{"privacy_class":"personal","allowed_scopes":["realm"]}'::jsonb,
    encode(digest('thatcampus.people/student/entity/v1','sha256'),'hex'),'platform-architecture',now()),
  ('thatcampus.academic_structure','class','entity',1,'academic_structure','active',
    '{"privacy_class":"operational","allowed_scopes":["realm"]}'::jsonb,
    encode(digest('thatcampus.academic_structure/class/entity/v1','sha256'),'hex'),'platform-architecture',now())
ON CONFLICT(namespace,type_key,definition_kind,version) DO NOTHING;

INSERT INTO model_protocol_schema_definitions(
  namespace,schema_key,protocol_kind,version,owning_domain,status,schema_document,
  content_hash,approved_by_authority,activated_at
) VALUES (
  'thatcampus.attendance','attendance.status_observed','observation',1,'attendance','active',
  '{"subject_type":"thatcampus.people/student@1","context_type":"thatcampus.academic_structure/class@1"}'::jsonb,
  encode(digest('thatcampus.attendance/attendance.status_observed/observation/v1','sha256'),'hex'),
  'platform-architecture',now()
) ON CONFLICT(namespace,schema_key,protocol_kind,version) DO NOTHING;

INSERT INTO model_capability_manifests(
  namespace,capability_key,version,status,adapter_key,compatible_core_range,manifest,
  content_hash,approved_by_authority,activated_at
) VALUES (
  'thatcampus.attendance','attendance',1,'active','attendance.observation_adapter','>=1 <2',
  '{"semantic_types":["thatcampus.people/student@1","thatcampus.academic_structure/class@1"],"protocol_schemas":["thatcampus.attendance/attendance.status_observed@1"]}'::jsonb,
  encode(digest('thatcampus.attendance/attendance/capability/v1','sha256'),'hex'),
  'platform-architecture',now()
) ON CONFLICT(namespace,capability_key,version) DO NOTHING;

ALTER TABLE campus_model_entities
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;

UPDATE campus_model_entities entity SET
  realm_id=realm.id,
  environment_namespace_id='live:'||entity.school_id::text
FROM operational_realms realm WHERE realm.legacy_school_id=entity.school_id;

ALTER TABLE campus_model_entities
  ALTER COLUMN realm_id SET NOT NULL,
  ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_entities_namespace_realm_fk
    FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_entities_address_unique
    UNIQUE(id,realm_id,environment_namespace_id);

ALTER TABLE campus_model_entities
  DROP CONSTRAINT campus_model_entities_school_id_domain_domain_id_key;
ALTER TABLE campus_model_entities
  ADD CONSTRAINT campus_model_entities_realm_namespace_source_unique
    UNIQUE(realm_id,environment_namespace_id,domain,domain_id);
CREATE INDEX campus_model_entities_realm_namespace_kind_idx
  ON campus_model_entities(realm_id,environment_namespace_id,kind,lifecycle_state,label);

ALTER TABLE campus_model_observations
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;

UPDATE campus_model_observations observation SET
  realm_id=entity.realm_id,
  environment_namespace_id=entity.environment_namespace_id
FROM campus_model_entities entity WHERE entity.id=observation.subject_entity_id;

ALTER TABLE campus_model_observations
  ALTER COLUMN realm_id SET NOT NULL,
  ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_observations_namespace_realm_fk
    FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_observations_subject_address_fk
    FOREIGN KEY(subject_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_observations_context_address_fk
    FOREIGN KEY(context_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;

-- PostgreSQL shortens automatically generated constraint names to 63 bytes and
-- may truncate a different identifier segment across supported versions. Drop
-- the legacy uniqueness constraints by their definition, not by that generated
-- name, so an existing campus database can migrate safely.
DO $$
DECLARE legacy_constraint text;
BEGIN
  FOR legacy_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid='campus_model_observations'::regclass
      AND constraint_record.contype='u'
      AND pg_get_constraintdef(constraint_record.oid) IN (
        'UNIQUE (school_id, source_type, source_record_id)',
        'UNIQUE (school_id, idempotency_key)'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE campus_model_observations DROP CONSTRAINT %I',
      legacy_constraint
    );
  END LOOP;
END $$;
ALTER TABLE campus_model_observations
  ADD CONSTRAINT campus_model_observations_realm_namespace_source_unique
    UNIQUE(realm_id,environment_namespace_id,source_type,source_record_id),
  ADD CONSTRAINT campus_model_observations_realm_namespace_idempotency_unique
    UNIQUE(realm_id,environment_namespace_id,idempotency_key);
CREATE INDEX campus_model_observations_realm_namespace_subject_time_idx
  ON campus_model_observations(realm_id,environment_namespace_id,subject_entity_id,observed_at DESC);

ALTER TABLE operational_realms ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_environment_namespaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_semantic_type_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_protocol_schema_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_capability_manifests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON operational_realms,execution_environment_namespaces,
  model_semantic_type_definitions,model_protocol_schema_definitions,
  model_capability_manifests FROM PUBLIC;

DO $$
DECLARE application_owner text := current_user;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='omnischool_app_owner') THEN
    application_owner := 'omnischool_app_owner';
  END IF;
  EXECUTE format('ALTER TABLE public.operational_realms OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.execution_environment_namespaces OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.model_semantic_type_definitions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.model_protocol_schema_definitions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.model_capability_manifests OWNER TO %I',application_owner);
END $$;
