-- Domain-neutral snapshot coverage/provisioning plus environment-local replay
-- recovery. Domain adapters own capture and restore; the Core retains only
-- manifests, content hashes, leases and explanatory outcomes.

CREATE TABLE model_snapshot_adapter_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace varchar(120) NOT NULL,
  adapter_key varchar(120) NOT NULL,
  version integer NOT NULL CHECK(version>0),
  module_id varchar(100) NOT NULL,
  capability_manifest_id uuid NOT NULL REFERENCES model_capability_manifests(id) ON DELETE RESTRICT,
  handler_key varchar(160) NOT NULL,
  capture_schema_version integer NOT NULL CHECK(capture_schema_version>0),
  restore_schema_version integer NOT NULL CHECK(restore_schema_version>0),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  status varchar(16) NOT NULL CHECK(status IN ('approved','active','deprecated','retired')),
  approved_by_authority varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace,adapter_key,version),
  UNIQUE(id,version)
);

CREATE TABLE realm_snapshot_adapter_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  adapter_definition_id uuid NOT NULL REFERENCES model_snapshot_adapter_definitions(id) ON DELETE RESTRICT,
  adapter_version integer NOT NULL,
  module_id varchar(100) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL CHECK(status IN ('active','suspended','retired')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  activated_by_authority varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  UNIQUE(realm_id,module_id,adapter_definition_id,effective_from),
  FOREIGN KEY(adapter_definition_id,adapter_version)
    REFERENCES model_snapshot_adapter_definitions(id,version) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX realm_snapshot_one_active_required_module
  ON realm_snapshot_adapter_activations(realm_id,module_id)
  WHERE status='active' AND required AND effective_until IS NULL;

CREATE TABLE campus_model_snapshot_provisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  source_environment_namespace_id text NOT NULL,
  source_snapshot_ref text NOT NULL,
  state varchar(20) NOT NULL CHECK(state IN ('collecting','blocked','ready','restoring','restored','expired','failed')),
  requested_modules text[] NOT NULL CHECK(cardinality(requested_modules)>0),
  missing_modules text[] NOT NULL DEFAULT '{}'::text[],
  expected_adapter_count integer NOT NULL CHECK(expected_adapter_count>=0),
  coverage_hash char(64) NOT NULL CHECK(coverage_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash char(64),
  source_recorded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_by_agent_id uuid NOT NULL,
  authority_receipt_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz,
  CHECK(expires_at>source_recorded_at),
  UNIQUE(realm_id,source_environment_namespace_id,idempotency_key),
  UNIQUE(realm_id,source_snapshot_ref),
  UNIQUE(id,realm_id,source_environment_namespace_id),
  FOREIGN KEY(source_environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  FOREIGN KEY(requested_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(authority_receipt_id,realm_id,source_environment_namespace_id)
    REFERENCES campus_model_authority_receipts(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_snapshot_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  source_environment_namespace_id text NOT NULL,
  adapter_definition_id uuid NOT NULL REFERENCES model_snapshot_adapter_definitions(id) ON DELETE RESTRICT,
  adapter_version integer NOT NULL,
  module_id varchar(100) NOT NULL,
  artifact_ref text NOT NULL,
  artifact_hash char(64) NOT NULL CHECK(artifact_hash ~ '^[0-9a-f]{64}$'),
  restore_schema_version integer NOT NULL CHECK(restore_schema_version>0),
  record_count bigint NOT NULL CHECK(record_count>=0),
  source_revision_watermark text NOT NULL,
  privacy_transform_ref text NOT NULL,
  capture_schema_version integer NOT NULL CHECK(capture_schema_version>0),
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provision_id,adapter_definition_id),
  FOREIGN KEY(provision_id,realm_id,source_environment_namespace_id)
    REFERENCES campus_model_snapshot_provisions(id,realm_id,source_environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(adapter_definition_id,adapter_version)
    REFERENCES model_snapshot_adapter_definitions(id,version) ON DELETE RESTRICT
);

CREATE TABLE campus_model_snapshot_expected_adapters (
  provision_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  source_environment_namespace_id text NOT NULL,
  adapter_definition_id uuid NOT NULL REFERENCES model_snapshot_adapter_definitions(id) ON DELETE RESTRICT,
  adapter_version integer NOT NULL,
  module_id varchar(100) NOT NULL,
  capture_schema_version integer NOT NULL CHECK(capture_schema_version>0),
  restore_schema_version integer NOT NULL CHECK(restore_schema_version>0),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(provision_id,adapter_definition_id),
  UNIQUE(provision_id,module_id),
  FOREIGN KEY(provision_id,realm_id,source_environment_namespace_id)
    REFERENCES campus_model_snapshot_provisions(id,realm_id,source_environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(adapter_definition_id,adapter_version)
    REFERENCES model_snapshot_adapter_definitions(id,version) ON DELETE RESTRICT
);

CREATE TABLE campus_model_snapshot_restores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id uuid NOT NULL REFERENCES campus_model_snapshot_provisions(id) ON DELETE RESTRICT,
  execution_snapshot_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  target_environment_namespace_id text NOT NULL,
  state varchar(20) NOT NULL CHECK(state IN ('restoring','ready','failed','expired')),
  expected_adapter_count integer NOT NULL CHECK(expected_adapter_count>=0),
  restored_adapter_count integer NOT NULL DEFAULT 0 CHECK(restored_adapter_count>=0),
  manifest_hash char(64) NOT NULL CHECK(manifest_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(realm_id,target_environment_namespace_id),
  UNIQUE(id,realm_id,target_environment_namespace_id),
  FOREIGN KEY(execution_snapshot_id,realm_id,target_environment_namespace_id)
    REFERENCES campus_model_execution_snapshots(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(target_environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE CASCADE
);

CREATE TABLE campus_model_snapshot_restore_contributions (
  restore_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  target_environment_namespace_id text NOT NULL,
  adapter_definition_id uuid NOT NULL REFERENCES model_snapshot_adapter_definitions(id) ON DELETE RESTRICT,
  adapter_version integer NOT NULL,
  artifact_hash char(64) NOT NULL CHECK(artifact_hash ~ '^[0-9a-f]{64}$'),
  restore_schema_version integer NOT NULL CHECK(restore_schema_version>0),
  restored_record_count bigint NOT NULL CHECK(restored_record_count>=0),
  restored_at timestamptz NOT NULL,
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
  PRIMARY KEY(restore_id,adapter_definition_id),
  FOREIGN KEY(restore_id,realm_id,target_environment_namespace_id)
    REFERENCES campus_model_snapshot_restores(id,realm_id,target_environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(adapter_definition_id,adapter_version)
    REFERENCES model_snapshot_adapter_definitions(id,version) ON DELETE RESTRICT
);

CREATE TABLE campus_model_projection_recovery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  consumer varchar(100) NOT NULL,
  mode varchar(16) NOT NULL CHECK(mode IN ('rebuild','replay','verify')),
  state varchar(20) NOT NULL CHECK(state IN ('scheduled','leased','running','retry_scheduled','completed','failed','cancelled','quarantined')),
  from_sequence bigint NOT NULL CHECK(from_sequence>=0),
  through_sequence bigint CHECK(through_sequence IS NULL OR through_sequence>=from_sequence),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 20),
  retry_policy_ref varchar(200) NOT NULL,
  retry_delays_seconds integer[] NOT NULL CHECK(cardinality(retry_delays_seconds)=max_attempts-1),
  available_at timestamptz NOT NULL,
  lease_owner varchar(160),
  lease_until timestamptz,
  last_error_code varchar(100),
  requested_by_agent_id uuid NOT NULL,
  authority_receipt_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
  UNIQUE(realm_id,environment_namespace_id,idempotency_key),
  UNIQUE(id,realm_id,environment_namespace_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE CASCADE,
  FOREIGN KEY(requested_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(authority_receipt_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_authority_receipts(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_projection_replay_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  event_id uuid NOT NULL,
  delivery_sequence bigint NOT NULL CHECK(delivery_sequence>=0),
  error_code varchar(100) NOT NULL,
  schema_ref text,
  safe_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_diagnostics)='object'),
  status varchar(16) NOT NULL CHECK(status IN ('open','released','discarded')),
  quarantined_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by_agent_id uuid,
  UNIQUE(job_id,event_id),
  FOREIGN KEY(job_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_projection_recovery_jobs(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_environment_retention_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  state varchar(20) NOT NULL CHECK(state IN ('scheduled','leased','running','completed','failed','cancelled')),
  delete_after timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  artifact_classes text[] NOT NULL,
  retention_policy_ref varchar(200) NOT NULL,
  scheduled_by_agent_id uuid NOT NULL,
  authority_receipt_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  lease_owner varchar(160),
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 20),
  retry_delays_seconds integer[] NOT NULL CHECK(cardinality(retry_delays_seconds)=max_attempts-1),
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(deleted_counts)='object'),
  last_error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
  UNIQUE(realm_id,environment_namespace_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE CASCADE,
  FOREIGN KEY(scheduled_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(authority_receipt_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_authority_receipts(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION prevent_snapshot_manifest_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Retained snapshot coverage and contribution evidence are immutable'; END $$;
CREATE OR REPLACE FUNCTION guard_snapshot_adapter_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Snapshot adapter definitions cannot be deleted'; END IF;
  IF NEW.namespace IS DISTINCT FROM OLD.namespace OR NEW.adapter_key IS DISTINCT FROM OLD.adapter_key
    OR NEW.version IS DISTINCT FROM OLD.version OR NEW.module_id IS DISTINCT FROM OLD.module_id
    OR NEW.capability_manifest_id IS DISTINCT FROM OLD.capability_manifest_id
    OR NEW.handler_key IS DISTINCT FROM OLD.handler_key
    OR NEW.capture_schema_version IS DISTINCT FROM OLD.capture_schema_version
    OR NEW.restore_schema_version IS DISTINCT FROM OLD.restore_schema_version
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.approved_by_authority IS DISTINCT FROM OLD.approved_by_authority THEN
    RAISE EXCEPTION 'Publish a new snapshot adapter version instead of rewriting reviewed content';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_snapshot_adapter_definitions_immutable BEFORE UPDATE OR DELETE ON model_snapshot_adapter_definitions
  FOR EACH ROW EXECUTE FUNCTION guard_snapshot_adapter_definition();
CREATE OR REPLACE FUNCTION guard_snapshot_adapter_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition_module varchar(100); definition_version integer;
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.realm_id IS DISTINCT FROM OLD.realm_id
    OR NEW.adapter_definition_id IS DISTINCT FROM OLD.adapter_definition_id
    OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
    OR NEW.module_id IS DISTINCT FROM OLD.module_id
    OR NEW.required IS DISTINCT FROM OLD.required
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.activated_by_authority IS DISTINCT FROM OLD.activated_by_authority
  ) THEN RAISE EXCEPTION 'Publish a new adapter activation instead of rewriting its reviewed scope'; END IF;
  SELECT module_id,version INTO definition_module,definition_version
    FROM model_snapshot_adapter_definitions WHERE id=NEW.adapter_definition_id;
  IF definition_module IS NULL OR definition_module<>NEW.module_id OR definition_version<>NEW.adapter_version THEN
    RAISE EXCEPTION 'Snapshot adapter activation does not match its reviewed definition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_snapshot_adapter_activations_guard
  BEFORE INSERT OR UPDATE ON realm_snapshot_adapter_activations
  FOR EACH ROW EXECUTE FUNCTION guard_snapshot_adapter_activation();
CREATE TRIGGER campus_model_snapshot_contributions_immutable BEFORE UPDATE OR DELETE ON campus_model_snapshot_contributions
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_manifest_rewrite();
CREATE TRIGGER campus_model_snapshot_expected_adapters_immutable BEFORE UPDATE OR DELETE ON campus_model_snapshot_expected_adapters
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_manifest_rewrite();
CREATE TRIGGER campus_model_snapshot_restore_contributions_immutable BEFORE UPDATE OR DELETE ON campus_model_snapshot_restore_contributions
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_manifest_rewrite();

CREATE INDEX campus_model_projection_recovery_claim_idx
  ON campus_model_projection_recovery_jobs(state,available_at,lease_until,created_at);
CREATE INDEX campus_model_retention_claim_idx
  ON campus_model_environment_retention_jobs(state,available_at,lease_until,created_at);

ALTER TABLE model_snapshot_adapter_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE realm_snapshot_adapter_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_snapshot_provisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_snapshot_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_snapshot_expected_adapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_snapshot_restores ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_snapshot_restore_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_projection_recovery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_projection_replay_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_environment_retention_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON model_snapshot_adapter_definitions,realm_snapshot_adapter_activations,
  campus_model_snapshot_provisions,campus_model_snapshot_contributions,
  campus_model_snapshot_expected_adapters,
  campus_model_snapshot_restores,campus_model_snapshot_restore_contributions,
  campus_model_projection_recovery_jobs,campus_model_projection_replay_quarantine,
  campus_model_environment_retention_jobs FROM PUBLIC;
