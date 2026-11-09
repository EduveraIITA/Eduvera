-- Several rooms can share one examination window and frozen marking roster.
CREATE TABLE assessment_sitting_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  space_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 1 AND 12),
  planned_candidates integer NOT NULL CHECK(planned_candidates BETWEEN 1 AND 10000),
  active boolean NOT NULL DEFAULT true,
  UNIQUE(school_id,sitting_id,id),
  UNIQUE(sitting_id,space_id),
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(space_id,school_id,campus_id) REFERENCES campus_spaces(id,school_id,campus_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX assessment_sitting_rooms_position ON assessment_sitting_rooms(sitting_id,position) WHERE active;
CREATE INDEX assessment_sitting_rooms_space ON assessment_sitting_rooms(school_id,space_id,sitting_id) WHERE active;
ALTER TABLE assessment_sitting_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON assessment_sitting_rooms FROM PUBLIC;

ALTER TABLE assessment_sitting_candidates ADD COLUMN room_id uuid,
  ADD FOREIGN KEY(school_id,sitting_id,room_id) REFERENCES assessment_sitting_rooms(school_id,sitting_id,id),
  ADD UNIQUE(school_id,sitting_id,id,room_id);
ALTER TABLE assessment_sitting_invigilators ADD COLUMN room_id uuid,
  ADD FOREIGN KEY(school_id,sitting_id,room_id) REFERENCES assessment_sitting_rooms(school_id,sitting_id,id);
ALTER TABLE assessment_sitting_incidents ADD COLUMN room_id uuid,
  ADD FOREIGN KEY(school_id,sitting_id,room_id) REFERENCES assessment_sitting_rooms(school_id,sitting_id,id),
  ADD FOREIGN KEY(school_id,sitting_id,candidate_id,room_id) REFERENCES assessment_sitting_candidates(school_id,sitting_id,id,room_id);
CREATE INDEX assessment_sitting_candidates_room ON assessment_sitting_candidates(school_id,sitting_id,room_id) WHERE room_id IS NOT NULL;

CREATE FUNCTION guard_exam_room_arrangement() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM assessment_sittings sitting WHERE sitting.school_id=NEW.school_id
    AND sitting.id=NEW.sitting_id AND (sitting.roster_frozen_at IS NOT NULL OR sitting.state<>'planning')) THEN
    RAISE EXCEPTION 'Frozen exam room arrangements cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.school_id,NEW.sitting_id,NEW.space_id,NEW.campus_id)
    IS DISTINCT FROM (OLD.school_id,OLD.sitting_id,OLD.space_id,OLD.campus_id) THEN
    RAISE EXCEPTION 'Exam room identity cannot change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exam_room_arrangement_guard BEFORE INSERT OR UPDATE ON assessment_sitting_rooms
  FOR EACH ROW EXECUTE FUNCTION guard_exam_room_arrangement();

CREATE FUNCTION guard_exam_candidate_room() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    RAISE EXCEPTION 'A frozen candidate retains the assigned room' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND (
    (NEW.room_id IS NULL AND EXISTS(SELECT 1 FROM assessment_sitting_rooms room
      WHERE room.school_id=NEW.school_id AND room.sitting_id=NEW.sitting_id AND room.active))
    OR (NEW.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assessment_sitting_rooms room
      WHERE room.school_id=NEW.school_id AND room.sitting_id=NEW.sitting_id AND room.id=NEW.room_id AND room.active))
  ) THEN
    RAISE EXCEPTION 'A split candidate requires a current assigned room' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exam_candidate_room_guard BEFORE INSERT OR UPDATE ON assessment_sitting_candidates
  FOR EACH ROW EXECUTE FUNCTION guard_exam_candidate_room();

CREATE OR REPLACE VIEW assessment_candidate_attendance AS
SELECT original.* FROM assessment_candidate_attendance_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_source_contexts link WHERE link.school_id=original.school_id
  AND link.source_kind='examination' AND link.source_id=original.sitting_id::text AND link.state='active')
UNION ALL
SELECT COALESCE(entry.id,candidate.id),candidate.school_id,candidate.sitting_id,candidate.id,candidate.student_id,
  COALESCE(entry.status,'unrecorded'),entry.observed_at,COALESCE(entry.remarks,''),COALESCE(entry.revision,1),
  entry.recorded_by,COALESCE(entry.updated_at,candidate.frozen_at)
FROM assessment_sitting_candidates candidate
JOIN activity_attendance_source_contexts link ON link.school_id=candidate.school_id AND link.source_kind='examination'
  AND link.source_id=COALESCE(candidate.room_id,candidate.sitting_id)::text AND link.state='active'
JOIN activity_attendance_roster person ON person.register_id=link.register_id AND person.school_id=candidate.school_id
  AND (person.academic_student_id=candidate.student_id OR
    (candidate.person_id IS NOT NULL AND person.person_id=candidate.person_id AND person.source_ref=candidate.id::text))
LEFT JOIN activity_attendance_entries entry ON entry.register_id=link.register_id AND entry.person_id=person.person_id;

DO $$ DECLARE owner_name name; database_role name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='assessment_sittings'::regclass;
  EXECUTE format('ALTER TABLE assessment_sitting_rooms OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION guard_exam_room_arrangement() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION guard_exam_candidate_room() OWNER TO %I',owner_name);
  FOREACH database_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
      EXECUTE format('REVOKE ALL ON assessment_sitting_rooms FROM %I',database_role);
    END IF;
  END LOOP;
END $$;
