-- Bind reviewed photo analyses to one scheduled subject register and retain the
-- exact capture source on its immutable submission/audit path.
ALTER TABLE photo_attendance_sessions
  ADD COLUMN attendance_session_id uuid REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  ADD COLUMN applied_session_submission_id uuid REFERENCES attendance_session_submissions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE photo_attendance_sessions DROP CONSTRAINT photo_attendance_sessions_check;
ALTER TABLE photo_attendance_sessions ADD CONSTRAINT photo_attendance_sessions_applied_valid CHECK (
  (state <> 'applied' AND applied_at IS NULL AND applied_submission_id IS NULL AND applied_session_submission_id IS NULL)
  OR
  (state = 'applied' AND applied_at IS NOT NULL AND num_nonnulls(applied_submission_id,applied_session_submission_id)=1)
);
CREATE INDEX photo_attendance_sessions_subject_idx
  ON photo_attendance_sessions(attendance_session_id,created_at DESC)
  WHERE attendance_session_id IS NOT NULL;

ALTER TABLE attendance_session_submissions
  ADD COLUMN capture_source varchar(24) NOT NULL DEFAULT 'staff_roll_call'
    CHECK(capture_source IN ('staff_roll_call','camera_assisted','offline_paper')),
  ADD COLUMN source_photo_session_id uuid REFERENCES photo_attendance_sessions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX attendance_session_submission_photo_idx
  ON attendance_session_submissions(source_photo_session_id)
  WHERE source_photo_session_id IS NOT NULL;
