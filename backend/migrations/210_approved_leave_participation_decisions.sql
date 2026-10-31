-- School-approved leave is an administrative exemption, not a physical report.
-- Keep one participation writer and preserve all existing observation provenance.
ALTER TABLE activity_attendance_entries DROP CONSTRAINT activity_attendance_entries_capture_channel_check;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT activity_attendance_entries_capture_channel_check
  CHECK(capture_channel IN ('human_roll_call','offline_paper','self_check_in','camera_assisted','registered_device','legacy_import','approved_leave'));
ALTER TABLE activity_attendance_entries ADD CONSTRAINT participation_leave_exemption_not_observation
  CHECK(capture_channel<>'approved_leave' OR (status IS NOT DISTINCT FROM 'excused' AND observed_at IS NULL));
ALTER TABLE activity_attendance_entry_revisions ADD CONSTRAINT participation_leave_revision_not_observation
  CHECK(capture_channel<>'approved_leave' OR (new_status IS NOT DISTINCT FROM 'excused' AND observed_at IS NULL));
ALTER TABLE activity_attendance_commands DROP CONSTRAINT activity_attendance_commands_operation_check;
ALTER TABLE activity_attendance_commands ADD CONSTRAINT activity_attendance_commands_operation_check CHECK(operation IN
  ('marks','submit','finalize','reopen','evidence','evidence_review','automatic_finalize','self_report','automatic_evidence','approved_leave'));
