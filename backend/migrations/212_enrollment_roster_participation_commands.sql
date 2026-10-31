-- A reviewed People decision changes academic expectations through the same
-- participation kernel. It is neither a physical observation nor another mark.
ALTER TABLE activity_attendance_commands DROP CONSTRAINT activity_attendance_commands_operation_check;
ALTER TABLE activity_attendance_commands ADD CONSTRAINT activity_attendance_commands_operation_check CHECK(operation IN
  ('marks','submit','finalize','reopen','evidence','evidence_review','automatic_finalize','self_report','automatic_evidence','approved_leave','roster_change'));
