-- Student Pulse contains operational check-in metadata, never clinical narratives.
CREATE FUNCTION student_pulse_actor_authorized(tenant uuid,student uuid,section uuid,actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT coordination_actor_authorized(tenant,student,actor,'staff') AND (
    EXISTS(SELECT 1 FROM school_memberships WHERE school_id=tenant AND user_id=actor AND is_active AND role='admin')
    OR staff_has_class_permission(tenant,actor,'followups.manage',section))
$$;
REVOKE ALL ON FUNCTION student_pulse_actor_authorized(uuid,uuid,uuid,uuid) FROM PUBLIC;
CREATE TABLE student_pulse_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL, class_id uuid NOT NULL, term_id uuid NOT NULL, subject_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK(state IN ('check_in','monitoring','resolved')),
  action text NOT NULL CHECK(action IN ('private_check_in','academic_support','classroom_review','timetable_review','verify_records')),
  due_on date NOT NULL,
  outcome text CHECK(outcome IN ('support_agreed','records_corrected','review_complete')),
  baseline_held integer NOT NULL, baseline_attended integer NOT NULL, baseline_excused integer NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,student_id,term_id,subject_id), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES academic_terms(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id),
  CHECK(baseline_held >= 0 AND baseline_attended >= 0 AND baseline_excused >= 0 AND baseline_attended + baseline_excused <= baseline_held),
  CHECK((state='resolved') = (outcome IS NOT NULL))
);
CREATE INDEX student_pulse_open_due_idx ON student_pulse_followups(school_id,due_on) WHERE state <> 'resolved';
CREATE TABLE student_pulse_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL, followup_id uuid NOT NULL,
  revision integer NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL, action text NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id),
  due_on date NOT NULL, outcome text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,followup_id) REFERENCES student_pulse_followups(school_id,id),
  UNIQUE(followup_id,revision)
);
CREATE FUNCTION validate_student_pulse_links() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM enrollments WHERE student_id=NEW.student_id AND class_section_id=NEW.class_id AND term_id=NEW.term_id) THEN
    RAISE EXCEPTION 'Student Pulse enrollment mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT student_pulse_actor_authorized(NEW.school_id,NEW.student_id,NEW.class_id,NEW.owner_user_id) THEN
    RAISE EXCEPTION 'Student Pulse owner lacks current follow-up access' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.school_id,NEW.student_id,NEW.class_id,NEW.term_id,NEW.subject_id,
    NEW.baseline_held,NEW.baseline_attended,NEW.baseline_excused,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.school_id,OLD.student_id,OLD.class_id,OLD.term_id,OLD.subject_id,
    OLD.baseline_held,OLD.baseline_attended,OLD.baseline_excused,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'Student Pulse identity and baseline are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_pulse_scope BEFORE INSERT OR UPDATE ON student_pulse_followups FOR EACH ROW EXECUTE FUNCTION validate_student_pulse_links();
CREATE FUNCTION protect_student_pulse_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Student Pulse history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER student_pulse_history_immutable BEFORE UPDATE OR DELETE ON student_pulse_history FOR EACH ROW EXECUTE FUNCTION protect_student_pulse_history();
ALTER TABLE student_pulse_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_pulse_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_pulse_followups,student_pulse_history FROM PUBLIC;
DO $$ DECLARE actor text; BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=actor) THEN
      EXECUTE format('REVOKE ALL ON student_pulse_followups,student_pulse_history FROM %I',actor);
    END IF;
  END LOOP;
END $$;
