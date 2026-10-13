-- Attendance is configured on independent axes: the academic register scope,
-- campus-presence tracking, and the evidence channels accepted for each.  A
-- biometric gate event must never silently become evidence for every lesson.
ALTER TABLE institution_operating_rules
  ADD COLUMN attendance_academic_mode varchar(24) NOT NULL DEFAULT 'scheduled_session'
    CHECK (attendance_academic_mode IN ('daily_class','scheduled_session','none')),
  ADD COLUMN attendance_campus_mode varchar(24) NOT NULL DEFAULT 'none'
    CHECK (attendance_campus_mode IN ('none','entry_only','entry_exit')),
  ADD COLUMN attendance_academic_channels text[] NOT NULL DEFAULT ARRAY['staff_roll_call']::text[],
  ADD COLUMN attendance_campus_channels text[] NOT NULL DEFAULT ARRAY['staff_entry']::text[],
  ADD COLUMN attendance_self_check_in_mode varchar(24) NOT NULL DEFAULT 'staff_review'
    CHECK (attendance_self_check_in_mode IN ('disabled','staff_review','automatic')),
  ADD COLUMN attendance_session_open_before_minutes integer NOT NULL DEFAULT 10
    CHECK (attendance_session_open_before_minutes BETWEEN 0 AND 240),
  ADD COLUMN attendance_session_close_after_minutes integer NOT NULL DEFAULT 30
    CHECK (attendance_session_close_after_minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT attendance_academic_channels_valid CHECK (
    cardinality(attendance_academic_channels) > 0 AND
    attendance_academic_channels <@ ARRAY['staff_roll_call','student_qr','camera_assisted','biometric_device','offline_paper']::text[]
  ),
  ADD CONSTRAINT attendance_campus_channels_valid CHECK (
    cardinality(attendance_campus_channels) > 0 AND
    attendance_campus_channels <@ ARRAY['staff_entry','student_qr','camera_assisted','biometric_device']::text[]
  );

CREATE TABLE attendance_session_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL REFERENCES class_sections(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  schedule_slot_id uuid NOT NULL,
  session_date date NOT NULL,
  period_number smallint NOT NULL CHECK (period_number > 0),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  title varchar(160) NOT NULL,
  room varchar(80) NOT NULL DEFAULT '',
  scheduled_teacher_id uuid REFERENCES users(id) ON DELETE SET NULL,
  state varchar(16) NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','locked')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  auto_finalize_at timestamptz,
  finalization_policy_revision integer,
  finalization_source varchar(16) CHECK (finalization_source IS NULL OR finalization_source IN ('manual','automatic')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((submitted_at IS NULL) = (submitted_by IS NULL)),
  UNIQUE (school_id, session_date, schedule_slot_id)
);
CREATE INDEX attendance_session_registers_day_idx
  ON attendance_session_registers(school_id,session_date,starts_at,class_section_id);
CREATE INDEX attendance_session_registers_finalize_idx
  ON attendance_session_registers(auto_finalize_at,id)
  WHERE state='submitted' AND auto_finalize_at IS NOT NULL;

CREATE TABLE attendance_session_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('present','absent','late','excused')),
  remarks varchar(500) NOT NULL DEFAULT '',
  capture_channel varchar(24) NOT NULL CHECK (capture_channel IN ('staff_roll_call','student_qr','camera_assisted','biometric_device','offline_paper')),
  observed_at timestamptz NOT NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id,student_id)
);
CREATE INDEX attendance_session_entries_student_idx
  ON attendance_session_entries(student_id,session_id);

CREATE TABLE attendance_session_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  request_id uuid NOT NULL,
  register_revision integer NOT NULL CHECK (register_revision > 0),
  records_count integer NOT NULL CHECK (records_count > 0),
  changed_count integer NOT NULL CHECK (changed_count >= 0 AND changed_count <= records_count),
  result_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,submitted_by,idempotency_key)
);

CREATE TABLE attendance_session_entry_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES attendance_session_entries(id) ON DELETE RESTRICT,
  submission_id uuid REFERENCES attendance_session_submissions(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  previous_status varchar(16) CHECK (previous_status IS NULL OR previous_status IN ('present','absent','late','excused')),
  new_status varchar(16) NOT NULL CHECK (new_status IN ('present','absent','late','excused')),
  previous_remarks varchar(500),
  new_remarks varchar(500) NOT NULL DEFAULT '',
  capture_channel varchar(24) NOT NULL,
  reason varchar(500) NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  register_revision integer NOT NULL CHECK (register_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(reason)) >= 3)
);
CREATE INDEX attendance_session_entry_revisions_session_idx
  ON attendance_session_entry_revisions(session_id,register_revision,id);

CREATE TABLE attendance_session_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  capture_channel varchar(24) NOT NULL CHECK (capture_channel IN ('student_qr','camera_assisted','biometric_device')),
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
  observed_at timestamptz NOT NULL,
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_reference varchar(160) NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_session_evidence_review_idx
  ON attendance_session_evidence(session_id,state,created_at);
CREATE UNIQUE INDEX attendance_session_evidence_active_idx
  ON attendance_session_evidence(session_id,student_id,capture_channel)
  WHERE state<>'rejected';

CREATE TABLE attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  issued_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE attendance_session_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES attendance_session_registers(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(48) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Relationships are also validated in transactions, but these constraints keep
-- accidental cross-institution writes out even in future maintenance scripts.
CREATE FUNCTION validate_attendance_session_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE related_school uuid;
BEGIN
  IF TG_TABLE_NAME='attendance_session_registers' THEN
    SELECT school_id INTO related_school FROM class_sections WHERE id=NEW.class_section_id;
    IF related_school IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Attendance session class belongs to another institution' USING ERRCODE='23514'; END IF;
    SELECT school_id INTO related_school FROM academic_terms WHERE id=NEW.term_id;
    IF related_school IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Attendance session term belongs to another institution' USING ERRCODE='23514'; END IF;
    SELECT school_id INTO related_school FROM subjects WHERE id=NEW.subject_id;
    IF related_school IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Attendance session subject belongs to another institution' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME IN ('attendance_session_entries','attendance_session_evidence') THEN
    SELECT school_id INTO related_school FROM attendance_session_registers WHERE id=NEW.session_id;
    IF related_school IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Attendance evidence belongs to another institution' USING ERRCODE='23514'; END IF;
    SELECT school_id INTO related_school FROM students WHERE id=NEW.student_id;
    IF related_school IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Attendance student belongs to another institution' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_session_register_scope BEFORE INSERT OR UPDATE ON attendance_session_registers FOR EACH ROW EXECUTE FUNCTION validate_attendance_session_scope();
CREATE TRIGGER attendance_session_entry_scope BEFORE INSERT OR UPDATE ON attendance_session_entries FOR EACH ROW EXECUTE FUNCTION validate_attendance_session_scope();
CREATE TRIGGER attendance_session_evidence_scope BEFORE INSERT OR UPDATE ON attendance_session_evidence FOR EACH ROW EXECUTE FUNCTION validate_attendance_session_scope();
