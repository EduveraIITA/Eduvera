-- Durable product Simulation control plane. The source campus remains Live;
-- these rows address isolated run worlds and never contain operational domain
-- records. Domain state lives behind registered Simulation snapshot/data-plane
-- adapters, while this migration retains lifecycle, virtual-time scheduling,
-- checkpoint and comparison provenance.

CREATE TABLE simulation_runs (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL,
  namespace_id text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind varchar(16) NOT NULL CHECK(kind IN ('baseline','scenario')),
  name varchar(120) NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  status varchar(16) NOT NULL CHECK(status IN (
    'preparing','draft','running','paused','stopped','completed','failed'
  )),
  speed numeric(8,3) NOT NULL CHECK(speed>=1 AND speed<=100),
  deterministic_seed varchar(240) NOT NULL CHECK(length(btrim(deterministic_seed))>=8),
  time_zone varchar(100) NOT NULL DEFAULT 'UTC',

  source_snapshot_ref text,
  source_snapshot_hash char(64),
  source_snapshot_at timestamptz,
  source_revisions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_revisions)='object'),
  world_ref text,
  world_revision bigint NOT NULL DEFAULT 0 CHECK(world_revision>=0),
  manifest_ref text,
  manifest_checked_at timestamptz,
  limitations text[] NOT NULL DEFAULT '{}'::text[],

  virtual_started_at timestamptz,
  virtual_now timestamptz,
  simulated_elapsed_ms bigint NOT NULL DEFAULT 0 CHECK(simulated_elapsed_ms>=0),
  end_at timestamptz,
  retention_expires_at timestamptz,
  wall_anchor_at timestamptz,
  virtual_anchor_at timestamptz,
  next_wake_at timestamptz,
  next_event_at timestamptz,
  last_checkpoint_at timestamptz,
  event_count bigint NOT NULL DEFAULT 0 CHECK(event_count>=0),
  checkpoint_count bigint NOT NULL DEFAULT 0 CHECK(checkpoint_count>=0),

  lease_owner varchar(160),
  lease_token uuid,
  lease_until timestamptz,
  lease_fence bigint NOT NULL DEFAULT 0 CHECK(lease_fence>=0),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
  failure_reason varchar(500),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  paused_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,

  CONSTRAINT simulation_runs_namespace_chk CHECK (
    namespace_id='scenario:'||scenario_id::text||':run:'||id::text
  ),
  CONSTRAINT simulation_runs_snapshot_hash_chk CHECK (
    source_snapshot_hash IS NULL OR source_snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT simulation_runs_capture_shape_chk CHECK (
    status IN ('preparing','failed') OR (
      source_snapshot_ref IS NOT NULL AND source_snapshot_hash IS NOT NULL
      AND source_snapshot_at IS NOT NULL AND world_ref IS NOT NULL
      AND manifest_ref IS NOT NULL AND manifest_checked_at IS NOT NULL
      AND virtual_started_at IS NOT NULL AND virtual_now IS NOT NULL
    )
  ),
  CONSTRAINT simulation_runs_end_chk CHECK (
    end_at IS NULL OR virtual_started_at IS NULL OR end_at>virtual_started_at
  ),
  CONSTRAINT simulation_runs_retention_chk CHECK (
    retention_expires_at IS NULL OR retention_expires_at>created_at
  ),
  CONSTRAINT simulation_runs_lease_shape_chk CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT simulation_runs_terminal_time_chk CHECK (
    (status<>'stopped' OR stopped_at IS NOT NULL)
    AND (status<>'completed' OR completed_at IS NOT NULL)
    AND (status<>'failed' OR failure_reason IS NOT NULL)
  ),
  UNIQUE(scenario_id),
  UNIQUE(namespace_id),
  UNIQUE(school_id,created_by_user_id,idempotency_key),
  UNIQUE(id,school_id)
);

CREATE INDEX simulation_runs_recent_idx
  ON simulation_runs(school_id,created_by_user_id,created_at DESC);
CREATE INDEX simulation_runs_due_idx
  ON simulation_runs(next_wake_at,id)
  WHERE status='running';
CREATE INDEX simulation_runs_lease_recovery_idx
  ON simulation_runs(lease_until,id)
  WHERE lease_until IS NOT NULL;
CREATE INDEX simulation_runs_snapshot_compare_idx
  ON simulation_runs(school_id,source_snapshot_hash,created_at DESC);

CREATE TABLE simulation_run_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  school_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK(sequence>=0),
  virtual_from timestamptz NOT NULL,
  virtual_to timestamptz NOT NULL,
  simulated_elapsed_ms bigint NOT NULL CHECK(simulated_elapsed_ms>=0),
  world_checkpoint_ref text NOT NULL,
  world_revision bigint NOT NULL CHECK(world_revision>=0),
  emitted_event_count bigint NOT NULL DEFAULT 0 CHECK(emitted_event_count>=0),
  lease_fence bigint NOT NULL DEFAULT 0 CHECK(lease_fence>=0),
  lease_token uuid,
  next_event_at timestamptz,
  metrics_hash char(64) NOT NULL CHECK(metrics_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK(virtual_to>=virtual_from),
  CHECK((sequence=0 AND lease_fence=0 AND lease_token IS NULL)
    OR (sequence>0 AND lease_fence>0 AND lease_token IS NOT NULL)),
  UNIQUE(run_id,sequence),
  UNIQUE(run_id,simulated_elapsed_ms),
  UNIQUE(run_id,world_checkpoint_ref),
  UNIQUE(id,run_id),
  FOREIGN KEY(run_id,school_id) REFERENCES simulation_runs(id,school_id) ON DELETE CASCADE
);

CREATE INDEX simulation_run_checkpoints_comparison_idx
  ON simulation_run_checkpoints(run_id,simulated_elapsed_ms DESC);

CREATE TABLE simulation_run_metric_samples (
  checkpoint_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  metric_key varchar(120) NOT NULL CHECK(metric_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  label varchar(160),
  unit varchar(80) NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 80),
  value double precision,
  measured_at timestamptz NOT NULL,
  simulated_elapsed_ms bigint NOT NULL CHECK(simulated_elapsed_ms>=0),
  PRIMARY KEY(checkpoint_id,metric_key),
  FOREIGN KEY(checkpoint_id,run_id) REFERENCES simulation_run_checkpoints(id,run_id) ON DELETE CASCADE
);

CREATE INDEX simulation_run_metric_samples_lookup_idx
  ON simulation_run_metric_samples(run_id,simulated_elapsed_ms,metric_key);

CREATE TABLE simulation_run_draft_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  school_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  domain varchar(80) NOT NULL CHECK(domain ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  change_kind varchar(80) NOT NULL CHECK(change_kind ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  target_ref varchar(240),
  summary varchar(500) NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 500),
  source_revision varchar(240) NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,idempotency_key),
  FOREIGN KEY(run_id,school_id) REFERENCES simulation_runs(id,school_id) ON DELETE CASCADE
);

CREATE INDEX simulation_run_draft_changes_run_idx
  ON simulation_run_draft_changes(run_id,recorded_at,id);

CREATE TABLE simulation_run_behaviour_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  school_id uuid NOT NULL,
  behaviour_key varchar(100) NOT NULL,
  configuration_revision integer NOT NULL CHECK(configuration_revision>0),
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
  version_ref varchar(240) NOT NULL,
  configuration_hash char(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  approved_by_agent_id uuid NOT NULL,
  configured_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  configured_at timestamptz NOT NULL,
  UNIQUE(run_id,behaviour_key,configuration_revision),
  UNIQUE(run_id,version_ref),
  FOREIGN KEY(run_id,school_id) REFERENCES simulation_runs(id,school_id) ON DELETE CASCADE
);

CREATE INDEX simulation_run_behaviour_current_idx
  ON simulation_run_behaviour_configurations(run_id,behaviour_key,configuration_revision DESC);

-- Safe wake hints for the control-plane worker. Domain event payloads and
-- operational records remain in the isolated world; this table never becomes a
-- second event journal.
CREATE TABLE simulation_run_scheduled_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  event_key varchar(240) NOT NULL,
  event_kind varchar(100) NOT NULL CHECK(event_kind ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  due_virtual_at timestamptz NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','completed','cancelled','failed')),
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_payload)='object'),
  completed_at timestamptz,
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,event_key)
);

CREATE INDEX simulation_run_scheduled_events_due_idx
  ON simulation_run_scheduled_events(run_id,due_virtual_at,event_key)
  WHERE state='pending';

COMMENT ON TABLE simulation_runs IS
  'Durable lifecycle and virtual-time control for isolated product Simulation runs; contains no Live domain state.';
COMMENT ON COLUMN simulation_runs.end_at IS
  'Optional virtual end. NULL means run until explicitly stopped; it is not a retention expiry.';
COMMENT ON TABLE simulation_run_draft_changes IS
  'Safe provenance receipts for scenario edits performed through normal domain APIs in the isolated draft world.';
