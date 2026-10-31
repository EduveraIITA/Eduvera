-- Preserve archival attendance foreign keys while new accepted decisions use
-- the shared participation store. Never manufacture an academic archive row to
-- satisfy an old reference: observations and follow-ups retain their owner.
ALTER TABLE photo_attendance_sessions
  ADD COLUMN participation_register_id uuid REFERENCES activity_attendance_registers(id) ON DELETE RESTRICT,
  ADD COLUMN applied_participation_command_id uuid REFERENCES activity_attendance_commands(id) ON DELETE RESTRICT;
ALTER TABLE photo_attendance_sessions DROP CONSTRAINT photo_attendance_sessions_applied_valid;
ALTER TABLE photo_attendance_sessions ADD CONSTRAINT photo_attendance_sessions_applied_valid CHECK (
  (state <> 'applied' AND applied_at IS NULL AND num_nonnulls(applied_submission_id,applied_session_submission_id,applied_participation_command_id)=0)
  OR (state='applied' AND applied_at IS NOT NULL AND num_nonnulls(applied_submission_id,applied_session_submission_id,applied_participation_command_id)=1)
);

ALTER TABLE attendance_capture_batches
  ADD COLUMN participation_register_id uuid REFERENCES activity_attendance_registers(id) ON DELETE RESTRICT,
  ADD COLUMN accepted_participation_command_id uuid REFERENCES activity_attendance_commands(id) ON DELETE RESTRICT,
  ADD COLUMN accepted_result_body jsonb;
ALTER TABLE attendance_capture_batches DROP CONSTRAINT attendance_capture_batches_check;
ALTER TABLE attendance_capture_batches ADD CONSTRAINT attendance_capture_acceptance_valid CHECK (
  (accepted_at IS NULL AND num_nonnulls(accepted_submission_id,accepted_participation_command_id)=0)
  OR (accepted_at IS NOT NULL AND num_nonnulls(accepted_submission_id,accepted_participation_command_id)=1)
);
CREATE UNIQUE INDEX attendance_capture_participation_command_idx ON attendance_capture_batches(accepted_participation_command_id)
  WHERE accepted_participation_command_id IS NOT NULL;

ALTER TABLE attendance_followups
  ALTER COLUMN attendance_record_id DROP NOT NULL,
  ADD COLUMN participation_entry_id uuid REFERENCES activity_attendance_entries(id) ON DELETE RESTRICT,
  ADD CONSTRAINT attendance_followup_decision_reference CHECK(num_nonnulls(attendance_record_id,participation_entry_id)=1);
CREATE UNIQUE INDEX attendance_followups_participation_open_idx ON attendance_followups(school_id,participation_entry_id)
  WHERE state<>'resolved' AND participation_entry_id IS NOT NULL;
CREATE INDEX attendance_followups_participation_entry_idx ON attendance_followups(participation_entry_id)
  WHERE participation_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_participation_continuity_reference()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  register_ref uuid;
  command_ref uuid;
  source_context jsonb;
  source_kind text;
  source_school uuid;
  command_register uuid;
  command_school uuid;
BEGIN
  register_ref:=NEW.participation_register_id;
  IF TG_TABLE_NAME='photo_attendance_sessions' THEN
    command_ref:=NEW.applied_participation_command_id;
  ELSE
    command_ref:=NEW.accepted_participation_command_id;
  END IF;
  IF command_ref IS NOT NULL THEN
    SELECT school_id,register_id INTO command_school,command_register FROM activity_attendance_commands WHERE id=command_ref;
    IF command_school IS DISTINCT FROM NEW.school_id OR command_register IS DISTINCT FROM register_ref THEN
      RAISE EXCEPTION 'Participation acceptance does not match its school and register' USING ERRCODE='23514';
    END IF;
  END IF;
  IF register_ref IS NOT NULL THEN
    SELECT link.school_id,link.source_kind,link.context_snapshot->'context'
      INTO source_school,source_kind,source_context FROM activity_attendance_legacy_links link
      WHERE link.register_id=register_ref;
    IF source_school IS DISTINCT FROM NEW.school_id
      OR (source_context->>'class_id')::uuid IS DISTINCT FROM NEW.class_section_id
      OR (source_context->>'term_id')::uuid IS DISTINCT FROM NEW.term_id
      OR (source_context->>'date')::date IS DISTINCT FROM NEW.date THEN
      RAISE EXCEPTION 'Participation evidence does not match its academic context' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='photo_attendance_sessions' THEN
      IF (NEW.attendance_session_id IS NULL AND source_kind<>'daily_class')
        OR (NEW.attendance_session_id IS NOT NULL AND (source_kind<>'scheduled_session'
          OR (source_context->>'legacy_register_id')::uuid IS DISTINCT FROM NEW.attendance_session_id)) THEN
        RAISE EXCEPTION 'Photo evidence does not match its exact participation session' USING ERRCODE='23514';
      END IF;
    ELSIF source_kind<>'daily_class' THEN
      RAISE EXCEPTION 'Daily offline capture cannot target a different participation context' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER photo_participation_reference BEFORE INSERT OR UPDATE ON photo_attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION validate_participation_continuity_reference();
CREATE TRIGGER capture_participation_reference BEFORE INSERT OR UPDATE ON attendance_capture_batches
  FOR EACH ROW EXECUTE FUNCTION validate_participation_continuity_reference();

CREATE OR REPLACE FUNCTION validate_followup_links() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE legacy_valid boolean;
BEGIN
  IF NEW.participation_entry_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM activity_attendance_entries entry
      JOIN activity_attendance_legacy_links link ON link.register_id=entry.register_id AND link.school_id=entry.school_id
      JOIN activity_attendance_legacy_people person ON person.register_id=entry.register_id AND person.person_id=entry.person_id
      WHERE entry.id=NEW.participation_entry_id AND entry.school_id=NEW.school_id AND person.student_id=NEW.student_id
        AND link.state='active' AND link.source_kind='daily_class'
        AND (link.context_snapshot->'context'->>'date')::date=NEW.attendance_date) THEN
      RAISE EXCEPTION 'Follow-up participation scope mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    -- This migration also works before the separately verified read-projection
    -- cutover. Afterwards the historical FK still points to the renamed table.
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I record JOIN public.students student ON student.id=record.student_id
      WHERE record.id=$1 AND record.student_id=$2 AND record.date=$3 AND student.school_id=$4)',
      CASE WHEN to_regclass('public.attendance_records_legacy_source') IS NULL THEN 'attendance_records' ELSE 'attendance_records_legacy_source' END)
      INTO legacy_valid USING NEW.attendance_record_id,NEW.student_id,NEW.attendance_date,NEW.school_id;
    IF NOT legacy_valid THEN
      RAISE EXCEPTION 'Follow-up attendance scope mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM school_memberships WHERE school_id=NEW.school_id AND user_id=NEW.owner_user_id AND role IN ('staff','admin')) THEN
    RAISE EXCEPTION 'Follow-up owner school mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION validate_participation_continuity_reference() FROM PUBLIC;
