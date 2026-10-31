-- Make model catalogues executable: reviewed definitions are immutable,
-- OperationalRealms explicitly pin versions, and certified model records retain
-- the exact definitions used. Legacy records remain identifiable by null refs.

CREATE TABLE realm_model_contract_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE CASCADE,
  contract_kind varchar(24) NOT NULL
    CHECK (contract_kind IN ('semantic_type','protocol_schema','capability_manifest')),
  contract_key varchar(241) NOT NULL,
  contract_id uuid NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  status varchar(16) NOT NULL CHECK (status IN ('active','suspended','retired')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  activated_by_authority varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE(realm_id,contract_kind,contract_key,contract_version,effective_from)
);
CREATE UNIQUE INDEX realm_model_contract_one_current_activation_idx
  ON realm_model_contract_activations(realm_id,contract_kind,contract_key)
  WHERE status='active' AND effective_until IS NULL;

INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,activated_by_authority
)
SELECT realm.id,'semantic_type',definition.namespace||'/'||definition.type_key,
  definition.id,definition.version,'active','platform-migration'
FROM operational_realms realm CROSS JOIN model_semantic_type_definitions definition
WHERE realm.status IN ('setup','active') AND definition.status='active'
ON CONFLICT DO NOTHING;

-- The polymorphic catalogue reference is kept generic so new contract kinds do
-- not force domain branches into the kernel. This trigger supplies the FK-like
-- integrity and prevents two effective active pins from overlapping.
CREATE OR REPLACE FUNCTION validate_realm_model_contract_activation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE definition_exists boolean := false;
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.realm_id IS DISTINCT FROM OLD.realm_id
    OR NEW.contract_kind IS DISTINCT FROM OLD.contract_kind
    OR NEW.contract_key IS DISTINCT FROM OLD.contract_key
    OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.activated_by_authority IS DISTINCT FROM OLD.activated_by_authority
  ) THEN
    RAISE EXCEPTION 'Contract activation identity is immutable; close it and activate another version';
  END IF;

  IF NEW.contract_kind='semantic_type' THEN
    SELECT EXISTS(SELECT 1 FROM model_semantic_type_definitions
      WHERE id=NEW.contract_id AND version=NEW.contract_version
        AND namespace||'/'||type_key=NEW.contract_key
        AND status IN ('approved','active','deprecated')) INTO definition_exists;
  ELSIF NEW.contract_kind='protocol_schema' THEN
    SELECT EXISTS(SELECT 1 FROM model_protocol_schema_definitions
      WHERE id=NEW.contract_id AND version=NEW.contract_version
        AND namespace||'/'||schema_key=NEW.contract_key
        AND status IN ('approved','active','deprecated')) INTO definition_exists;
  ELSIF NEW.contract_kind='capability_manifest' THEN
    SELECT EXISTS(SELECT 1 FROM model_capability_manifests
      WHERE id=NEW.contract_id AND version=NEW.contract_version
        AND namespace||'/'||capability_key=NEW.contract_key
        AND status IN ('approved','active','deprecated')) INTO definition_exists;
  END IF;
  IF NOT definition_exists THEN
    RAISE EXCEPTION 'Contract activation must reference one reviewed definition and exact version';
  END IF;

  IF NEW.status='active' AND EXISTS(
    SELECT 1 FROM realm_model_contract_activations existing
    WHERE existing.realm_id=NEW.realm_id
      AND existing.contract_kind=NEW.contract_kind
      AND existing.contract_key=NEW.contract_key
      AND existing.status='active'
      AND existing.id<>NEW.id
      AND tstzrange(existing.effective_from,existing.effective_until,'[)')
        && tstzrange(NEW.effective_from,NEW.effective_until,'[)')
  ) THEN
    RAISE EXCEPTION 'A realm cannot activate overlapping versions of one contract';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_model_contract_activation_guard
  BEFORE INSERT OR UPDATE ON realm_model_contract_activations
  FOR EACH ROW EXECUTE FUNCTION validate_realm_model_contract_activation();

INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,activated_by_authority
)
SELECT realm.id,'protocol_schema',definition.namespace||'/'||definition.schema_key,
  definition.id,definition.version,'active','platform-migration'
FROM operational_realms realm CROSS JOIN model_protocol_schema_definitions definition
WHERE realm.status IN ('setup','active') AND definition.status='active'
ON CONFLICT DO NOTHING;

INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,activated_by_authority
)
SELECT realm.id,'capability_manifest',manifest.namespace||'/'||manifest.capability_key,
  manifest.id,manifest.version,'active','platform-migration'
FROM operational_realms realm CROSS JOIN model_capability_manifests manifest
WHERE realm.status IN ('setup','active') AND manifest.status='active'
ON CONFLICT DO NOTHING;

ALTER TABLE campus_model_entities
  ADD COLUMN semantic_type_definition_id uuid REFERENCES model_semantic_type_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN semantic_type_version integer,
  ADD CONSTRAINT campus_model_entities_semantic_contract_pair_check CHECK (
    (semantic_type_definition_id IS NULL AND semantic_type_version IS NULL)
    OR (semantic_type_definition_id IS NOT NULL AND semantic_type_version IS NOT NULL AND semantic_type_version > 0)
  );

ALTER TABLE campus_model_relationships
  ADD COLUMN semantic_type_definition_id uuid REFERENCES model_semantic_type_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN semantic_type_version integer,
  ADD CONSTRAINT campus_model_relationships_semantic_contract_pair_check CHECK (
    (semantic_type_definition_id IS NULL AND semantic_type_version IS NULL)
    OR (semantic_type_definition_id IS NOT NULL AND semantic_type_version IS NOT NULL AND semantic_type_version > 0)
  );

ALTER TABLE campus_model_observations
  ADD COLUMN protocol_schema_definition_id uuid REFERENCES model_protocol_schema_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN protocol_schema_version integer,
  ADD COLUMN capability_manifest_id uuid REFERENCES model_capability_manifests(id) ON DELETE RESTRICT,
  ADD COLUMN capability_manifest_version integer,
  ADD CONSTRAINT campus_model_observations_certified_contract_pair_check CHECK (
    (
      protocol_schema_definition_id IS NULL AND protocol_schema_version IS NULL
      AND capability_manifest_id IS NULL AND capability_manifest_version IS NULL
    ) OR (
      protocol_schema_definition_id IS NOT NULL AND protocol_schema_version IS NOT NULL AND protocol_schema_version > 0
      AND capability_manifest_id IS NOT NULL AND capability_manifest_version IS NOT NULL AND capability_manifest_version > 0
    )
  );

CREATE OR REPLACE FUNCTION prevent_semantic_definition_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.namespace IS DISTINCT FROM OLD.namespace
    OR NEW.type_key IS DISTINCT FROM OLD.type_key
    OR NEW.definition_kind IS DISTINCT FROM OLD.definition_kind
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.owning_domain IS DISTINCT FROM OLD.owning_domain
    OR NEW.definition IS DISTINCT FROM OLD.definition
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.approved_by_authority IS DISTINCT FROM OLD.approved_by_authority THEN
    RAISE EXCEPTION 'Reviewed semantic definitions are immutable; publish a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_semantic_type_definitions_immutable
  BEFORE UPDATE ON model_semantic_type_definitions
  FOR EACH ROW EXECUTE FUNCTION prevent_semantic_definition_rewrite();

CREATE OR REPLACE FUNCTION prevent_protocol_definition_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.namespace IS DISTINCT FROM OLD.namespace
    OR NEW.schema_key IS DISTINCT FROM OLD.schema_key
    OR NEW.protocol_kind IS DISTINCT FROM OLD.protocol_kind
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.owning_domain IS DISTINCT FROM OLD.owning_domain
    OR NEW.schema_document IS DISTINCT FROM OLD.schema_document
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.approved_by_authority IS DISTINCT FROM OLD.approved_by_authority THEN
    RAISE EXCEPTION 'Reviewed protocol definitions are immutable; publish a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_protocol_schema_definitions_immutable
  BEFORE UPDATE ON model_protocol_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION prevent_protocol_definition_rewrite();

CREATE OR REPLACE FUNCTION prevent_capability_manifest_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.namespace IS DISTINCT FROM OLD.namespace
    OR NEW.capability_key IS DISTINCT FROM OLD.capability_key
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.adapter_key IS DISTINCT FROM OLD.adapter_key
    OR NEW.compatible_core_range IS DISTINCT FROM OLD.compatible_core_range
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.approved_by_authority IS DISTINCT FROM OLD.approved_by_authority THEN
    RAISE EXCEPTION 'Reviewed capability manifests are immutable; publish a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_capability_manifests_immutable
  BEFORE UPDATE ON model_capability_manifests
  FOR EACH ROW EXECUTE FUNCTION prevent_capability_manifest_rewrite();

ALTER TABLE realm_model_contract_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON realm_model_contract_activations FROM PUBLIC;

DO $$
DECLARE application_owner text := current_user;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='omnischool_app_owner') THEN
    application_owner := 'omnischool_app_owner';
  END IF;
  EXECUTE format('ALTER TABLE public.realm_model_contract_activations OWNER TO %I',application_owner);
END $$;
