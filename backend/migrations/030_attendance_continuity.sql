-- Attendance continuity: immutable field observations, bounded offline capture,
-- and an explicit reconciliation queue before an observation becomes a fact.

CREATE TABLE attendance_capture_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL REFERENCES class_sections(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  date date NOT NULL,
  source varchar(24) NOT NULL CHECK (source IN ('live_app','offline_device','paper','office')),
  source_reference varchar(160) NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_id varchar(128),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  roster_fingerprint char(64) NOT NULL,
  roster_count integer NOT NULL CHECK (roster_count > 0),
  expected_register_revision integer NOT NULL CHECK (expected_register_revision >= 0),
  observed_at timestamptz NOT NULL,
  roster_expires_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','quarantined','rejected')),
  accepted_submission_id uuid REFERENCES attendance_submissions(id) ON DELETE RESTRICT,
  accepted_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((accepted_at IS NULL) = (accepted_submission_id IS NULL)),
  CHECK (resolution_note IS NULL OR length(btrim(resolution_note)) >= 3),
  UNIQUE (school_id, recorded_by, idempotency_key)
);

CREATE INDEX attendance_capture_batches_school_queue_idx
  ON attendance_capture_batches(school_id, status, date DESC, received_at DESC);
CREATE INDEX attendance_capture_batches_class_date_idx
  ON attendance_capture_batches(class_section_id, date DESC, received_at DESC);

CREATE TABLE attendance_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES attendance_capture_batches(id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL REFERENCES class_sections(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  date date NOT NULL,
  observed_status varchar(16) NOT NULL
    CHECK (observed_status IN ('present','absent','late','excused','half_day')),
  remarks varchar(500) NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source varchar(24) NOT NULL CHECK (source IN ('live_app','offline_device','paper','office')),
  UNIQUE (batch_id, student_id)
);

CREATE INDEX attendance_observations_student_date_idx
  ON attendance_observations(student_id, date DESC, recorded_at DESC);

CREATE TABLE attendance_reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL UNIQUE REFERENCES attendance_capture_batches(id) ON DELETE RESTRICT,
  reason_code varchar(40) NOT NULL CHECK (reason_code IN (
    'snapshot_expired','roster_changed','register_changed','permission_revoked',
    'assignment_changed','invalid_observation_time','source_requires_review','write_conflict'
  )),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) >= 3),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  state varchar(16) NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','rejected')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note varchar(500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  CHECK (decision_note IS NULL OR length(btrim(decision_note)) >= 3)
);

CREATE INDEX attendance_reconciliation_cases_school_state_idx
  ON attendance_reconciliation_cases(school_id, state, opened_at DESC);

ALTER TABLE attendance_submissions
  ADD COLUMN capture_batch_id uuid REFERENCES attendance_capture_batches(id) ON DELETE RESTRICT,
  ADD COLUMN capture_source varchar(24) NOT NULL DEFAULT 'live_app'
    CHECK (capture_source IN ('live_app','offline_device','paper','office','photo')),
  ADD COLUMN observed_at timestamptz;

CREATE UNIQUE INDEX attendance_submissions_capture_batch_idx
  ON attendance_submissions(capture_batch_id) WHERE capture_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_attendance_capture_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  class_school uuid;
  term_school uuid;
  student_school uuid;
  batch_row attendance_capture_batches%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'attendance_capture_batches' THEN
    SELECT school_id INTO class_school FROM class_sections WHERE id=NEW.class_section_id;
    SELECT school_id INTO term_school FROM academic_terms WHERE id=NEW.term_id;
    IF NEW.school_id IS DISTINCT FROM class_school OR NEW.school_id IS DISTINCT FROM term_school THEN
      RAISE EXCEPTION 'Attendance capture class and term must belong to its school' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_observations' THEN
    SELECT * INTO batch_row FROM attendance_capture_batches WHERE id=NEW.batch_id;
    SELECT school_id INTO student_school FROM students WHERE id=NEW.student_id;
    IF batch_row.id IS NULL OR student_school IS NULL
      OR batch_row.school_id IS DISTINCT FROM NEW.school_id
      OR batch_row.class_section_id IS DISTINCT FROM NEW.class_section_id
      OR batch_row.term_id IS DISTINCT FROM NEW.term_id
      OR batch_row.date IS DISTINCT FROM NEW.date
      OR batch_row.recorded_by IS DISTINCT FROM NEW.recorded_by
      OR batch_row.source IS DISTINCT FROM NEW.source
      OR NEW.school_id IS DISTINCT FROM student_school THEN
      RAISE EXCEPTION 'Attendance observation does not match its capture batch' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_reconciliation_cases' THEN
    SELECT * INTO batch_row FROM attendance_capture_batches WHERE id=NEW.batch_id;
    IF batch_row.id IS NULL OR batch_row.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Attendance reconciliation case does not match its capture batch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER validate_attendance_capture_batch_scope
  AFTER INSERT OR UPDATE ON attendance_capture_batches
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_attendance_capture_scope();
CREATE CONSTRAINT TRIGGER validate_attendance_observation_scope
  AFTER INSERT OR UPDATE ON attendance_observations
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_attendance_capture_scope();
CREATE CONSTRAINT TRIGGER validate_attendance_reconciliation_scope
  AFTER INSERT OR UPDATE ON attendance_reconciliation_cases
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_attendance_capture_scope();

CREATE OR REPLACE FUNCTION prevent_attendance_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Attendance observations are append-only' USING ERRCODE='55000';
END $$;

CREATE TRIGGER attendance_observations_append_only
  BEFORE UPDATE OR DELETE ON attendance_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();

REVOKE ALL ON FUNCTION validate_attendance_capture_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_attendance_observation_mutation() FROM PUBLIC;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'attendance_capture_batches','attendance_observations','attendance_reconciliation_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END $$;
