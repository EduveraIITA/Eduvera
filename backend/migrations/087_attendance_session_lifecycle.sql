-- Subject-session registers follow the same review/finalization lifecycle as
-- daily registers.  These fields preserve who finalized or reopened a
-- register without conflating a lifecycle decision with attendance evidence.
ALTER TABLE attendance_session_registers
  ADD COLUMN locked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN reopened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reopened_at timestamptz,
  ADD COLUMN reopen_reason varchar(500),
  ADD CONSTRAINT attendance_session_locked_fields_valid CHECK (
    (state <> 'locked') OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)
  ),
  ADD CONSTRAINT attendance_session_reopen_reason_valid CHECK (
    reopen_reason IS NULL OR length(btrim(reopen_reason)) >= 3
  );
