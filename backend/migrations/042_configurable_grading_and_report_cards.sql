-- Configurable grading policies and immutable term report publication.
-- Aggregates consume published assessment snapshots only; no online examination or public ranking.

CREATE TABLE grading_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK(length(trim(name)) >= 2),
  code varchar(32) NOT NULL CHECK(length(trim(code)) >= 2),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  absence_treatment varchar(16) NOT NULL DEFAULT 'incomplete' CHECK(absence_treatment IN ('incomplete','zero')),
  review_mode varchar(20) NOT NULL DEFAULT 'independent' CHECK(review_mode IN ('owner_review','independent')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,term_id,class_section_id,code),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  CHECK((activated_by IS NULL)=(activated_at IS NULL)),
  CHECK(status<>'active' OR activated_at IS NOT NULL)
);
CREATE INDEX grading_schemes_school_term_idx ON grading_schemes(school_id,term_id,class_section_id,status);

CREATE TABLE grading_scheme_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  code varchar(24) NOT NULL CHECK(length(trim(code)) >= 1),
  label varchar(80) NOT NULL CHECK(length(trim(label)) >= 1),
  minimum_percentage numeric(5,2) NOT NULL CHECK(minimum_percentage BETWEEN 0 AND 100),
  maximum_percentage numeric(5,2) NOT NULL CHECK(maximum_percentage BETWEEN 0 AND 100),
  display_order integer NOT NULL CHECK(display_order BETWEEN 1 AND 100),
  UNIQUE(school_id,id),
  UNIQUE(scheme_id,code),
  UNIQUE(scheme_id,display_order),
  FOREIGN KEY(school_id,scheme_id) REFERENCES grading_schemes(school_id,id) ON DELETE CASCADE,
  CHECK(maximum_percentage >= minimum_percentage)
);

CREATE TABLE grading_scheme_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  pass_percentage numeric(5,2) CHECK(pass_percentage IS NULL OR pass_percentage BETWEEN 0 AND 100),
  display_order integer NOT NULL DEFAULT 1 CHECK(display_order BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(scheme_id,subject_id),
  FOREIGN KEY(school_id,scheme_id) REFERENCES grading_schemes(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT
);

CREATE TABLE grading_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  scheme_subject_id uuid NOT NULL,
  code varchar(32) NOT NULL CHECK(length(trim(code)) >= 1),
  name varchar(100) NOT NULL CHECK(length(trim(name)) >= 2),
  weight_percentage numeric(5,2) NOT NULL CHECK(weight_percentage > 0 AND weight_percentage <= 100),
  display_order integer NOT NULL CHECK(display_order BETWEEN 1 AND 100),
  UNIQUE(school_id,id),
  UNIQUE(scheme_subject_id,code),
  UNIQUE(scheme_subject_id,display_order),
  FOREIGN KEY(school_id,scheme_subject_id) REFERENCES grading_scheme_subjects(school_id,id) ON DELETE CASCADE
);

CREATE TABLE grading_component_assessments (
  school_id uuid NOT NULL,
  component_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(component_id,assessment_id),
  FOREIGN KEY(school_id,component_id) REFERENCES grading_components(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX grading_component_assessments_school_idx ON grading_component_assessments(school_id,assessment_id);

CREATE TABLE grading_report_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','published','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  source_scheme_revision integer NOT NULL CHECK(source_scheme_revision > 0),
  source_fingerprint varchar(64) NOT NULL CHECK(length(source_fingerprint)=64),
  correction_reason varchar(500) NOT NULL DEFAULT '',
  generated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_note varchar(1000) NOT NULL DEFAULT '',
  published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  publication_note varchar(1000) NOT NULL DEFAULT '',
  UNIQUE(school_id,id),
  UNIQUE(scheme_id,sequence),
  FOREIGN KEY(school_id,scheme_id) REFERENCES grading_schemes(school_id,id) ON DELETE RESTRICT,
  CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),
  CHECK((published_by IS NULL)=(published_at IS NULL)),
  CHECK(status='draft' OR reviewed_at IS NOT NULL OR status='cancelled'),
  CHECK(status<>'published' OR published_at IS NOT NULL),
  CHECK(sequence=1 OR length(trim(correction_reason)) >= 3)
);
CREATE INDEX grading_report_batches_school_status_idx ON grading_report_batches(school_id,status,generated_at DESC);

CREATE TABLE grading_report_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  student_id uuid NOT NULL,
  outcome varchar(16) NOT NULL CHECK(outcome IN ('complete','incomplete','withheld')),
  overall_percentage numeric(5,2),
  overall_grade varchar(24) NOT NULL DEFAULT '',
  class_teacher_comment varchar(1000) NOT NULL DEFAULT '',
  principal_comment varchar(1000) NOT NULL DEFAULT '',
  comment_revision integer NOT NULL DEFAULT 1 CHECK(comment_revision > 0),
  comment_updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  comment_updated_at timestamptz,
  UNIQUE(school_id,id),
  UNIQUE(school_id,batch_id,id),
  UNIQUE(batch_id,student_id),
  FOREIGN KEY(school_id,batch_id) REFERENCES grading_report_batches(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='complete' AND overall_percentage IS NOT NULL) OR (outcome<>'complete' AND overall_percentage IS NULL)),
  CHECK((comment_updated_by IS NULL)=(comment_updated_at IS NULL))
);
CREATE INDEX grading_report_students_student_idx ON grading_report_students(school_id,student_id,batch_id);

CREATE TABLE grading_report_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  report_student_id uuid NOT NULL,
  scheme_subject_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  outcome varchar(16) NOT NULL CHECK(outcome IN ('complete','incomplete','exempt','withheld')),
  percentage numeric(5,2),
  grade varchar(24) NOT NULL DEFAULT '',
  pass_percentage numeric(5,2),
  passed boolean,
  UNIQUE(school_id,id),
  UNIQUE(school_id,batch_id,id),
  UNIQUE(batch_id,report_student_id,subject_id),
  FOREIGN KEY(school_id,batch_id) REFERENCES grading_report_batches(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,batch_id,report_student_id) REFERENCES grading_report_students(school_id,batch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,scheme_subject_id) REFERENCES grading_scheme_subjects(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='complete' AND percentage IS NOT NULL) OR (outcome<>'complete' AND percentage IS NULL)),
  CHECK((pass_percentage IS NULL AND passed IS NULL) OR (pass_percentage IS NOT NULL AND (outcome<>'complete' OR passed IS NOT NULL)))
);

CREATE TABLE grading_report_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  report_subject_id uuid NOT NULL,
  component_id uuid NOT NULL,
  component_name varchar(100) NOT NULL,
  weight_percentage numeric(5,2) NOT NULL CHECK(weight_percentage > 0 AND weight_percentage <= 100),
  outcome varchar(16) NOT NULL CHECK(outcome IN ('complete','incomplete','exempt')),
  percentage numeric(5,2),
  weighted_points numeric(7,4),
  source_assessment_count integer NOT NULL CHECK(source_assessment_count >= 0),
  UNIQUE(school_id,id),
  UNIQUE(school_id,batch_id,id),
  UNIQUE(report_subject_id,component_id),
  FOREIGN KEY(school_id,batch_id) REFERENCES grading_report_batches(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,batch_id,report_subject_id) REFERENCES grading_report_subjects(school_id,batch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,component_id) REFERENCES grading_components(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='complete' AND percentage IS NOT NULL AND weighted_points IS NOT NULL) OR (outcome<>'complete' AND percentage IS NULL AND weighted_points IS NULL))
);

CREATE TABLE grading_report_assessment_sources (
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  report_component_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  student_id uuid NOT NULL,
  outcome varchar(20) NOT NULL CHECK(outcome IN ('scored','absent','exempt','withheld','not_evaluated')),
  marks numeric(8,2),
  maximum_marks numeric(8,2) NOT NULL CHECK(maximum_marks > 0),
  normalized_percentage numeric(5,2),
  PRIMARY KEY(report_component_id,assessment_id),
  FOREIGN KEY(school_id,batch_id) REFERENCES grading_report_batches(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,batch_id,report_component_id) REFERENCES grading_report_components(school_id,batch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,publication_id) REFERENCES assessment_publications(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='scored' AND marks IS NOT NULL AND normalized_percentage IS NOT NULL) OR (outcome<>'scored' AND marks IS NULL AND normalized_percentage IS NULL))
);

CREATE TABLE grading_report_audits (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  scheme_id uuid,
  batch_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(64) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,scheme_id) REFERENCES grading_schemes(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,batch_id) REFERENCES grading_report_batches(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX grading_report_audits_context_idx ON grading_report_audits(school_id,scheme_id,batch_id,created_at DESC);

ALTER TABLE school_custom_roles DROP CONSTRAINT IF EXISTS school_custom_roles_permissions_check;
ALTER TABLE school_custom_roles ADD CONSTRAINT school_custom_roles_permissions_check CHECK (
  permissions <@ ARRAY['members.invite','sis.manage','fees.manage','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','assessments.view','assessments.mark','assessments.moderate','reports.comment','ai.use']::text[]
);

DO $$
DECLARE
  application_owner text;
  table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'grading_schemes','grading_scheme_bands','grading_scheme_subjects','grading_components',
    'grading_component_assessments','grading_report_batches','grading_report_students',
    'grading_report_subjects','grading_report_components','grading_report_assessment_sources',
    'grading_report_audits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
  IF to_regclass('public.grading_report_audits_id_seq') IS NOT NULL THEN
    EXECUTE format('ALTER SEQUENCE public.grading_report_audits_id_seq OWNER TO %I',application_owner);
  END IF;
END $$;
