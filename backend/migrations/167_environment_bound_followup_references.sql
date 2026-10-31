-- Dynamic identifiers must remain bound to the selected store. Literal
-- public.%I cannot be rebound by the Simulation trigger/function copier.
CREATE OR REPLACE FUNCTION validate_followup_links() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE legacy_valid boolean; store_schema text:=current_schema();
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
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I record JOIN %I.students student ON student.id=record.student_id
      WHERE record.id=$1 AND record.student_id=$2 AND record.date=$3 AND student.school_id=$4)',store_schema,
      CASE WHEN to_regclass(format('%I.%I',store_schema,'attendance_records_legacy_source')) IS NULL
        THEN 'attendance_records' ELSE 'attendance_records_legacy_source' END,store_schema)
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
