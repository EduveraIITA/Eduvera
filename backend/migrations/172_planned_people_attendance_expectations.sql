-- A required physical commitment is not necessarily a candidate roll-call row.
-- Accepted invigilators retain the same canonical planned-person identity while
-- the examination candidate register stays eligibility-scoped by its adapter.
ALTER TABLE schedule_activity_occurrence_people
  ADD COLUMN attendance_expected boolean NOT NULL DEFAULT true;
CREATE INDEX participation_history_entry_revision
  ON activity_attendance_entry_revisions(entry_id,register_revision DESC,id DESC);
