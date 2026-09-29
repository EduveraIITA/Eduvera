-- Coordination records never replace an attendance decision or collection authority.
CREATE UNIQUE INDEX IF NOT EXISTS students_school_identity_idx ON students(school_id, id);
CREATE TABLE attendance_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL,
  attendance_record_id uuid NOT NULL REFERENCES attendance_records(id),
  attendance_date date NOT NULL,
  source_revision integer NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 3 AND 1000),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'awaiting_response' CHECK (state IN ('awaiting_response','in_review','resolved')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  outcome text CHECK (outcome IN ('absence_explained','record_corrected','query_withdrawn')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
  CHECK ((state = 'resolved') = (outcome IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE UNIQUE INDEX attendance_followups_open_idx ON attendance_followups(school_id, attendance_record_id) WHERE state <> 'resolved';
CREATE INDEX attendance_followups_inbox_idx ON attendance_followups(school_id, state, created_at DESC, id DESC);
CREATE INDEX attendance_followups_student_idx ON attendance_followups(student_id, created_at DESC, id DESC);
CREATE INDEX attendance_followups_owner_idx ON attendance_followups(owner_user_id);
CREATE INDEX attendance_followups_record_idx ON attendance_followups(attendance_record_id);

CREATE TABLE attendance_followup_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id uuid NOT NULL REFERENCES attendance_followups(id),
  revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('opened','guardian_reply','assisted_reply','resolved')),
  channel text NOT NULL CHECK (channel IN ('app','phone','paper','in_person')),
  guardian_id uuid REFERENCES parents(id),
  body text NOT NULL CHECK (length(body) BETWEEN 3 AND 1000),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (followup_id, revision),
  CHECK ((kind IN ('guardian_reply','assisted_reply')) = (guardian_id IS NOT NULL)),
  CHECK (kind = 'assisted_reply' OR channel = 'app')
);
CREATE INDEX attendance_followup_entries_actor_idx ON attendance_followup_entries(actor_id);
CREATE INDEX attendance_followup_entries_guardian_idx ON attendance_followup_entries(guardian_id);
CREATE TABLE coordination_commands (
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  followup_id uuid NOT NULL REFERENCES attendance_followups(id),
  result_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idempotency_key)
);
CREATE INDEX coordination_commands_followup_idx ON coordination_commands(followup_id);

CREATE FUNCTION coordination_actor_authorized(school uuid, student uuid, actor uuid, context text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
    JOIN students s ON s.id=student AND s.school_id=m.school_id
    WHERE m.school_id=school AND m.user_id=actor AND m.is_active AND (
      (context='staff' AND (m.role='admin' OR (m.role='staff' AND EXISTS (
        SELECT 1 FROM enrollments e JOIN timetable_slots t
          ON t.class_section_id=e.class_section_id AND t.term_id=e.term_id AND t.teacher_user_id=actor
        WHERE e.student_id=student AND e.is_active
      )))) OR
      (context='guardian' AND m.role='guardian' AND EXISTS (
        SELECT 1 FROM parents p JOIN guardian_relationships g ON g.guardian_id=p.id
        WHERE p.user_id=actor AND g.student_id=student
      ))
    )
  )
$$;

CREATE FUNCTION validate_followup_links() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM attendance_records a JOIN students s ON s.id=a.student_id
    WHERE a.id=NEW.attendance_record_id AND a.student_id=NEW.student_id
      AND a.date=NEW.attendance_date AND s.school_id=NEW.school_id) THEN
    RAISE EXCEPTION 'Follow-up attendance scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM school_memberships WHERE school_id=NEW.school_id AND user_id=NEW.owner_user_id AND role IN ('staff','admin')) THEN
    RAISE EXCEPTION 'Follow-up owner school mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_followup_links BEFORE INSERT OR UPDATE ON attendance_followups FOR EACH ROW EXECUTE FUNCTION validate_followup_links();

CREATE FUNCTION validate_followup_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.guardian_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM attendance_followups f JOIN guardian_relationships g ON g.student_id=f.student_id
    WHERE f.id=NEW.followup_id AND g.guardian_id=NEW.guardian_id
  ) THEN RAISE EXCEPTION 'Follow-up guardian mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_followup_entry_links BEFORE INSERT ON attendance_followup_entries FOR EACH ROW EXECUTE FUNCTION validate_followup_entry();

-- No browser/Data API grants. Domain APIs perform current scoped authorization.
ALTER TABLE attendance_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_followup_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordination_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_followups, attendance_followup_entries, coordination_commands FROM PUBLIC;
