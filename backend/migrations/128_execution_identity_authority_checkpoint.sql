-- Realm-shared identities/configuration are referenced by immutable execution
-- snapshots. Mutable authority decisions and projection cursors remain local to
-- one Live or Simulation namespace.

CREATE TABLE campus_model_execution_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  environment_namespace_id text NOT NULL,
  snapshot_kind varchar(24) NOT NULL CHECK(snapshot_kind IN ('live_activation','simulation_fork','rehearsal')),
  source_snapshot_ref text NOT NULL,
  core_contract_version varchar(40) NOT NULL,
  configuration_hash char(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  source_recorded_at timestamptz NOT NULL,
  sealed_at timestamptz NOT NULL,
  sealed_by_authority varchar(160) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(realm_id,environment_namespace_id,source_snapshot_ref),
  UNIQUE(id,realm_id,environment_namespace_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_execution_snapshot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  item_kind varchar(32) NOT NULL CHECK(item_kind IN (
    'operating_rule','behaviour','domain_configuration','semantic_contract',
    'protocol_contract','capability_manifest','terminology'
  )),
  item_key varchar(241) NOT NULL,
  version_ref varchar(200) NOT NULL,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  source_ref text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  UNIQUE(snapshot_id,item_kind,item_key),
  FOREIGN KEY(snapshot_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_execution_snapshots(id,realm_id,environment_namespace_id) ON DELETE CASCADE
);

CREATE TABLE campus_model_execution_actor_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  source_agent_id uuid NOT NULL,
  execution_actor_id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_mode varchar(32) NOT NULL CHECK(actor_mode IN ('live_agent','simulation_counterpart','delegate')),
  binding_key varchar(160) NOT NULL,
  snapshot_id uuid,
  behaviour_policy_version_ref text,
  authority_snapshot_ref text,
  status varchar(16) NOT NULL CHECK(status IN ('active','suspended','revoked')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  CHECK((actor_mode='live_agent' AND snapshot_id IS NULL AND behaviour_policy_version_ref IS NULL)
    OR (actor_mode<>'live_agent' AND snapshot_id IS NOT NULL)),
  UNIQUE(realm_id,environment_namespace_id,binding_key),
  UNIQUE(execution_actor_id,realm_id,environment_namespace_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(snapshot_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_execution_snapshots(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_authority_snapshot_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  school_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  source_authority_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  capability varchar(120) NOT NULL,
  scope_entity_id uuid,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  operating_rule_version_ref text,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  UNIQUE(snapshot_id,source_authority_id),
  FOREIGN KEY(snapshot_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_execution_snapshots(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(scope_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

CREATE TABLE campus_model_authority_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  actor_agent_id uuid NOT NULL,
  execution_actor_id uuid,
  capability varchar(120) NOT NULL,
  purpose varchar(120) NOT NULL,
  scope_entity_id uuid,
  decision varchar(16) NOT NULL CHECK(decision IN ('allowed','denied')),
  reason_codes text[] NOT NULL,
  authority_source_refs jsonb NOT NULL CHECK(jsonb_typeof(authority_source_refs)='array'),
  operating_rule_refs jsonb NOT NULL CHECK(jsonb_typeof(operating_rule_refs)='array'),
  evaluated_at timestamptz NOT NULL,
  valid_until timestamptz,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(valid_until IS NULL OR valid_until>evaluated_at),
  UNIQUE(realm_id,environment_namespace_id,idempotency_key),
  UNIQUE(id,realm_id,environment_namespace_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(execution_actor_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_execution_actor_bindings(execution_actor_id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(scope_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);

ALTER TABLE campus_model_commands ADD COLUMN authority_receipt_id uuid;
ALTER TABLE campus_model_commands ADD CONSTRAINT campus_model_commands_authority_receipt_address_fk
  FOREIGN KEY(authority_receipt_id,realm_id,environment_namespace_id)
  REFERENCES campus_model_authority_receipts(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;

CREATE TABLE campus_model_environment_projection_checkpoints (
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  consumer varchar(100) NOT NULL,
  last_delivery_sequence bigint NOT NULL DEFAULT 0 CHECK(last_delivery_sequence>=0),
  last_event_id uuid,
  state varchar(16) NOT NULL DEFAULT 'active' CHECK(state IN ('active','rebuilding','failed','paused')),
  lease_owner varchar(160),
  lease_until timestamptz,
  last_error_code varchar(80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(realm_id,environment_namespace_id,consumer),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE CASCADE,
  FOREIGN KEY(last_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  CHECK((lease_owner IS NULL)=(lease_until IS NULL))
);

CREATE OR REPLACE FUNCTION prevent_execution_snapshot_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Sealed execution snapshots and authority evidence are immutable'; END $$;
CREATE TRIGGER campus_model_execution_snapshots_immutable BEFORE UPDATE OR DELETE ON campus_model_execution_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_execution_snapshot_rewrite();
CREATE TRIGGER campus_model_execution_snapshot_items_immutable BEFORE UPDATE OR DELETE ON campus_model_execution_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION prevent_execution_snapshot_rewrite();
CREATE TRIGGER campus_model_authority_snapshot_grants_immutable BEFORE UPDATE OR DELETE ON campus_model_authority_snapshot_grants
  FOR EACH ROW EXECUTE FUNCTION prevent_execution_snapshot_rewrite();
CREATE TRIGGER campus_model_authority_receipts_immutable BEFORE UPDATE OR DELETE ON campus_model_authority_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_execution_snapshot_rewrite();

CREATE OR REPLACE FUNCTION guard_execution_actor_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE namespace_kind varchar(16);
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.realm_id IS DISTINCT FROM OLD.realm_id
    OR NEW.environment_namespace_id IS DISTINCT FROM OLD.environment_namespace_id
    OR NEW.source_agent_id IS DISTINCT FROM OLD.source_agent_id
    OR NEW.execution_actor_id IS DISTINCT FROM OLD.execution_actor_id
    OR NEW.actor_mode IS DISTINCT FROM OLD.actor_mode OR NEW.binding_key IS DISTINCT FROM OLD.binding_key
    OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
    OR NEW.behaviour_policy_version_ref IS DISTINCT FROM OLD.behaviour_policy_version_ref
    OR NEW.authority_snapshot_ref IS DISTINCT FROM OLD.authority_snapshot_ref
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  ) THEN RAISE EXCEPTION 'Execution actor identity and captured configuration are immutable'; END IF;
  SELECT environment_kind INTO namespace_kind FROM execution_environment_namespaces
    WHERE namespace_id=NEW.environment_namespace_id AND realm_id=NEW.realm_id;
  IF namespace_kind='live' AND NEW.actor_mode<>'live_agent' THEN
    RAISE EXCEPTION 'Only a live agent can bind in a Live namespace';
  ELSIF namespace_kind='simulation' AND NEW.actor_mode='live_agent' THEN
    RAISE EXCEPTION 'A Live agent cannot act inside a Simulation namespace';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_model_execution_actor_bindings_guard
  BEFORE INSERT OR UPDATE ON campus_model_execution_actor_bindings
  FOR EACH ROW EXECUTE FUNCTION guard_execution_actor_binding();

ALTER TABLE campus_model_execution_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_execution_snapshot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_execution_actor_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_authority_snapshot_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_authority_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_environment_projection_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campus_model_execution_snapshots,campus_model_execution_snapshot_items,
  campus_model_execution_actor_bindings,campus_model_authority_snapshot_grants,
  campus_model_authority_receipts,campus_model_environment_projection_checkpoints FROM PUBLIC;
