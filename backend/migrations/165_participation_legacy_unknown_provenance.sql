-- Preserve unknown historical observation time and signer without inventing
-- a physical report or attributing a new human decision during import.
ALTER TABLE activity_attendance_entries ALTER COLUMN observed_at DROP NOT NULL;
ALTER TABLE activity_attendance_entry_revisions ALTER COLUMN observed_at DROP NOT NULL;
ALTER TABLE activity_attendance_entries ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT participation_signer_or_legacy_source
  CHECK(recorded_by IS NOT NULL OR legacy_source_ref IS NOT NULL);
ALTER TABLE activity_attendance_entries DROP CONSTRAINT activity_attendance_entries_capture_channel_check;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT activity_attendance_entries_capture_channel_check
  CHECK(capture_channel IN ('human_roll_call','offline_paper','self_check_in','camera_assisted','registered_device','legacy_import'));
