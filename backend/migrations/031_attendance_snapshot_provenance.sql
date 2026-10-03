-- Persist the exact server-issued roster snapshot time used by the signed
-- attendance continuity token. Existing pending development captures fall
-- back to the bounded expiry window before the column becomes required.

ALTER TABLE attendance_capture_batches
  ADD COLUMN roster_captured_at timestamptz;

UPDATE attendance_capture_batches
SET roster_captured_at = roster_expires_at - interval '18 hours'
WHERE roster_captured_at IS NULL;

ALTER TABLE attendance_capture_batches
  ALTER COLUMN roster_captured_at SET NOT NULL;

