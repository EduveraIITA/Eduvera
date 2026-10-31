-- Persist an exact checkpoint target before entering the separate world store.
-- A reclaimed lease must finish that target, including after the world commit
-- succeeded but measurement/control-plane completion did not.
ALTER TABLE simulation_runs
  ADD COLUMN pending_advance_from timestamptz,
  ADD COLUMN pending_advance_to timestamptz,
  ADD COLUMN pending_advance_world_revision bigint;
ALTER TABLE simulation_runs ADD CONSTRAINT simulation_pending_advance_shape CHECK (
  (pending_advance_from IS NULL AND pending_advance_to IS NULL AND pending_advance_world_revision IS NULL)
  OR (pending_advance_from IS NOT NULL AND pending_advance_to IS NOT NULL
    AND pending_advance_world_revision IS NOT NULL AND pending_advance_to>pending_advance_from
    AND pending_advance_world_revision>0 AND pending_advance_from=virtual_now
    AND pending_advance_world_revision=world_revision)
);
COMMENT ON COLUMN simulation_runs.pending_advance_to IS
  'Exact retry target retained until its separate world receipt is committed to this control plane.';
