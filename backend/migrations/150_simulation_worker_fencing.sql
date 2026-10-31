-- Forward-only rollout for durable Simulation worker fencing. Migration 149
-- creates these fields for a fresh installation; this migration also upgrades
-- installations that applied the earlier 149 shape before fencing was added.

ALTER TABLE simulation_runs
  ADD COLUMN IF NOT EXISTS lease_fence bigint;

UPDATE simulation_runs
SET lease_fence = 0
WHERE lease_fence IS NULL;

ALTER TABLE simulation_runs
  ALTER COLUMN lease_fence SET DEFAULT 0,
  ALTER COLUMN lease_fence SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'simulation_runs'::regclass
      AND conname = 'simulation_runs_lease_fence_chk'
  ) THEN
    ALTER TABLE simulation_runs
      ADD CONSTRAINT simulation_runs_lease_fence_chk CHECK (lease_fence >= 0);
  END IF;
END
$$;

ALTER TABLE simulation_run_checkpoints
  ADD COLUMN IF NOT EXISTS lease_fence bigint,
  ADD COLUMN IF NOT EXISTS lease_token uuid;

-- Earlier checkpoints predate fencing. Give each completed advance a stable,
-- non-authoritative provenance token; sequence zero remains the capture point.
UPDATE simulation_run_checkpoints
SET lease_fence = CASE WHEN sequence = 0 THEN 0 ELSE sequence END,
    lease_token = CASE
      WHEN sequence = 0 THEN NULL
      ELSE COALESCE(lease_token, gen_random_uuid())
    END
WHERE lease_fence IS NULL
   OR (sequence = 0 AND lease_token IS NOT NULL)
   OR (sequence > 0 AND lease_token IS NULL);

ALTER TABLE simulation_run_checkpoints
  ALTER COLUMN lease_fence SET DEFAULT 0,
  ALTER COLUMN lease_fence SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'simulation_run_checkpoints'::regclass
      AND conname = 'simulation_run_checkpoints_lease_fence_chk'
  ) THEN
    ALTER TABLE simulation_run_checkpoints
      ADD CONSTRAINT simulation_run_checkpoints_lease_fence_chk
      CHECK (lease_fence >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'simulation_run_checkpoints'::regclass
      AND conname = 'simulation_run_checkpoints_lease_shape_chk'
  ) THEN
    ALTER TABLE simulation_run_checkpoints
      ADD CONSTRAINT simulation_run_checkpoints_lease_shape_chk CHECK (
        (sequence = 0 AND lease_fence = 0 AND lease_token IS NULL)
        OR (sequence > 0 AND lease_fence > 0 AND lease_token IS NOT NULL)
      );
  END IF;
END
$$;
