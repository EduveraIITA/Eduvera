-- Bounded, multi-instance lifecycle management for durable Simulation worlds.
-- Virtual end_at remains independent from wall-clock retention: only terminal
-- runs receive a retention expiry, and pinned evidence remains retained.

ALTER TABLE simulation_runs
  ADD COLUMN resource_reservation_bytes bigint NOT NULL DEFAULT 104857600,
  ADD COLUMN observed_storage_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN storage_measured_at timestamptz,
  ADD COLUMN resource_paused_at timestamptz,
  ADD COLUMN resource_pause_reason varchar(240),
  ADD COLUMN lease_recovery_count integer NOT NULL DEFAULT 0,
  ADD COLUMN retention_policy_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN retention_started_at timestamptz,
  ADD COLUMN pinned_at timestamptz,
  ADD COLUMN pinned_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN gc_state varchar(16) NOT NULL DEFAULT 'retained',
  ADD COLUMN gc_lease_owner varchar(160),
  ADD COLUMN gc_lease_token uuid,
  ADD COLUMN gc_lease_until timestamptz,
  ADD COLUMN gc_lease_fence bigint NOT NULL DEFAULT 0,
  ADD COLUMN gc_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN gc_failure_reason varchar(500),
  ADD COLUMN gc_next_attempt_at timestamptz,
  ADD COLUMN world_discarded_at timestamptz;

UPDATE simulation_runs
SET retention_started_at = COALESCE(stopped_at, completed_at, updated_at),
    retention_expires_at = COALESCE(
      retention_expires_at,
      COALESCE(stopped_at, completed_at, updated_at) + interval '30 days'
    )
WHERE status IN ('stopped','completed','failed');

ALTER TABLE simulation_runs
  ADD CONSTRAINT simulation_runs_resource_reservation_chk
    CHECK(resource_reservation_bytes >= 0),
  ADD CONSTRAINT simulation_runs_observed_storage_chk
    CHECK(observed_storage_bytes >= 0),
  ADD CONSTRAINT simulation_runs_retention_policy_version_chk
    CHECK(retention_policy_version > 0),
  ADD CONSTRAINT simulation_runs_resource_pause_shape_chk CHECK (
    (resource_paused_at IS NULL AND resource_pause_reason IS NULL)
    OR (status='paused' AND resource_paused_at IS NOT NULL AND resource_pause_reason IS NOT NULL)
  ),
  ADD CONSTRAINT simulation_runs_lease_recovery_count_chk CHECK(lease_recovery_count>=0),
  ADD CONSTRAINT simulation_runs_pin_shape_chk CHECK (
    (pinned_at IS NULL AND pinned_by_user_id IS NULL)
    OR (pinned_at IS NOT NULL AND pinned_by_user_id IS NOT NULL
      AND status IN ('stopped','completed','failed') AND world_discarded_at IS NULL)
  ),
  ADD CONSTRAINT simulation_runs_gc_state_chk
    CHECK(gc_state IN ('retained','deleting','deleted','failed')),
  ADD CONSTRAINT simulation_runs_gc_lease_shape_chk CHECK (
    (gc_state='deleting' AND gc_lease_owner IS NOT NULL
      AND gc_lease_token IS NOT NULL AND gc_lease_until IS NOT NULL)
    OR (gc_state<>'deleting' AND gc_lease_owner IS NULL
      AND gc_lease_token IS NULL AND gc_lease_until IS NULL)
  ),
  ADD CONSTRAINT simulation_runs_gc_fence_chk CHECK(gc_lease_fence >= 0),
  ADD CONSTRAINT simulation_runs_gc_failure_count_chk CHECK(gc_failure_count >= 0),
  ADD CONSTRAINT simulation_runs_discard_shape_chk CHECK (
    world_discarded_at IS NULL
    OR (gc_state='deleted' AND status IN ('stopped','completed','failed'))
  ),
  ADD CONSTRAINT simulation_runs_terminal_retention_chk CHECK (
    status NOT IN ('stopped','completed','failed')
    OR retention_started_at IS NOT NULL
  );

-- A narrow row lock serializes admission and worker capacity decisions for one
-- institution without maintaining drift-prone cached counters.
CREATE TABLE simulation_institution_resource_states (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO simulation_institution_resource_states(school_id)
SELECT DISTINCT school_id FROM simulation_runs
ON CONFLICT(school_id) DO NOTHING;

CREATE INDEX simulation_runs_school_lifecycle_idx
  ON simulation_runs(school_id,status,created_at,id)
  WHERE gc_state<>'deleted';

CREATE INDEX simulation_runs_tenant_due_idx
  ON simulation_runs(school_id,next_wake_at,id)
  WHERE status='running';

CREATE INDEX simulation_runs_tenant_active_lease_idx
  ON simulation_runs(school_id,lease_until,id)
  WHERE status='running' AND lease_token IS NOT NULL;

CREATE INDEX simulation_runs_gc_due_idx
  ON simulation_runs(retention_expires_at,gc_next_attempt_at,id)
  WHERE status IN ('stopped','completed','failed')
    AND pinned_at IS NULL AND world_discarded_at IS NULL;

CREATE INDEX simulation_runs_gc_lease_recovery_idx
  ON simulation_runs(gc_lease_until,id)
  WHERE gc_state='deleting';

CREATE TABLE simulation_run_gc_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE RESTRICT,
  school_id uuid NOT NULL,
  gc_lease_fence bigint NOT NULL CHECK(gc_lease_fence>0),
  outcome varchar(16) NOT NULL CHECK(outcome IN ('completed','failed','deferred')),
  reason varchar(80) NOT NULL CHECK(reason ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  source_snapshot_ref text,
  source_snapshot_hash char(64),
  world_ref text,
  adapter_receipt_ref text,
  accounted_bytes bigint NOT NULL CHECK(accounted_bytes>=0),
  released_bytes bigint NOT NULL DEFAULT 0 CHECK(released_bytes>=0),
  retained_shared_snapshot boolean,
  failure_reason varchar(500),
  attempted_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  CHECK(source_snapshot_hash IS NULL OR source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  CHECK((outcome='failed' AND failure_reason IS NOT NULL)
    OR (outcome<>'failed' AND failure_reason IS NULL)),
  UNIQUE(run_id,gc_lease_fence),
  FOREIGN KEY(run_id,school_id) REFERENCES simulation_runs(id,school_id) ON DELETE RESTRICT
);

CREATE INDEX simulation_run_gc_receipts_school_idx
  ON simulation_run_gc_receipts(school_id,completed_at DESC,id);

COMMENT ON COLUMN simulation_runs.resource_reservation_bytes IS
  'Conservative admission charge reserved before capture; it is not a storage usage measurement.';
COMMENT ON COLUMN simulation_runs.retention_expires_at IS
  'Wall-clock retained-world expiry assigned only after a run becomes terminal. It never limits virtual execution.';
COMMENT ON COLUMN simulation_runs.pinned_at IS
  'A privileged retention hold for a terminal world. Pinned worlds have no retention_expires_at.';
COMMENT ON TABLE simulation_run_gc_receipts IS
  'Append-only privileged evidence for retained-world cleanup attempts; operational domain records never live here.';
