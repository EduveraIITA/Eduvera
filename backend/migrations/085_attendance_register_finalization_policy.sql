ALTER TABLE institution_operating_rules
  ADD COLUMN attendance_finalization_mode varchar(24) NOT NULL DEFAULT 'automatic'
    CHECK (attendance_finalization_mode IN ('automatic', 'principal_review')),
  ADD COLUMN attendance_auto_finalize_minutes integer NOT NULL DEFAULT 30
    CHECK (attendance_auto_finalize_minutes BETWEEN 0 AND 1440);

ALTER TABLE attendance_registers
  ADD COLUMN auto_finalize_at timestamptz,
  ADD COLUMN finalization_policy_revision integer,
  ADD COLUMN finalization_source varchar(16)
    CHECK (finalization_source IS NULL OR finalization_source IN ('manual', 'automatic'));

UPDATE attendance_registers
SET finalization_source='manual'
WHERE state='locked' AND finalization_source IS NULL;

CREATE INDEX attendance_registers_auto_finalize_idx
  ON attendance_registers(auto_finalize_at, id)
  WHERE state='submitted' AND auto_finalize_at IS NOT NULL;

INSERT INTO event_maintenance_leases(task_name, last_claimed_at)
VALUES ('attendance_register_auto_finalize', NULL)
ON CONFLICT(task_name) DO NOTHING;
