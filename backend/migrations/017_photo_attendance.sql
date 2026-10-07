CREATE TABLE photo_attendance_class_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  provider_class_id varchar(80) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,class_section_id),
  UNIQUE(provider_class_id),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT
);

CREATE TABLE photo_attendance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  student_id uuid NOT NULL,
  provider_class_id varchar(80) NOT NULL,
  provider_student_id varchar(80) NOT NULL,
  sample_count smallint NOT NULL DEFAULT 0 CHECK(sample_count BETWEEN 0 AND 10),
  model_id varchar(160),
  authorization_reference varchar(500) NOT NULL CHECK(length(trim(authorization_reference))>=3),
  enrolled_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(school_id,id),
  UNIQUE(school_id,class_section_id,student_id),
  UNIQUE(provider_student_id),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX photo_attendance_profiles_student_idx ON photo_attendance_profiles(school_id,student_id);

CREATE TABLE photo_attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  term_id uuid NOT NULL,
  date date NOT NULL,
  period varchar(100) NOT NULL,
  provider_session_id varchar(80) NOT NULL UNIQUE,
  captured_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  capture_authorization_reference varchar(500) NOT NULL CHECK(length(trim(capture_authorization_reference))>=3),
  state varchar(20) NOT NULL DEFAULT 'analyzed' CHECK(state IN ('analyzed','applied','discarded','expired')),
  roster_count smallint NOT NULL CHECK(roster_count BETWEEN 1 AND 200),
  detected_faces smallint NOT NULL DEFAULT 0 CHECK(detected_faces>=0),
  proposed_present smallint NOT NULL DEFAULT 0 CHECK(proposed_present>=0),
  model_id varchar(160) NOT NULL,
  analysis_summary jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  applied_at timestamptz,
  applied_submission_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,term_id) REFERENCES academic_terms(school_id,id) ON DELETE RESTRICT,
  CHECK((state='applied')=(applied_at IS NOT NULL AND applied_submission_id IS NOT NULL))
);
CREATE INDEX photo_attendance_sessions_class_date_idx ON photo_attendance_sessions(school_id,class_section_id,date,created_at DESC);
CREATE INDEX photo_attendance_sessions_expiry_idx ON photo_attendance_sessions(expires_at) WHERE state='analyzed';

ALTER TABLE attendance_submissions ADD COLUMN source_photo_session_id uuid;
ALTER TABLE attendance_submissions ADD CONSTRAINT attendance_submission_photo_session_fk
  FOREIGN KEY(school_id,source_photo_session_id)
  REFERENCES photo_attendance_sessions(school_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX attendance_submission_photo_session_idx
  ON attendance_submissions(source_photo_session_id)
  WHERE source_photo_session_id IS NOT NULL;
ALTER TABLE photo_attendance_sessions ADD CONSTRAINT photo_attendance_applied_submission_fk
  FOREIGN KEY(applied_submission_id) REFERENCES attendance_submissions(id) DEFERRABLE INITIALLY DEFERRED;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['photo_attendance_class_bindings','photo_attendance_profiles','photo_attendance_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
END $$;
