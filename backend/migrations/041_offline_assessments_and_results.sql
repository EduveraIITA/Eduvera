-- Offline assessment operations and immutable result publication.
-- This module deliberately does not deliver or proctor online examinations.

CREATE TABLE assessment_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL CHECK(length(trim(name)) >= 2),
  code varchar(32) NOT NULL CHECK(length(trim(code)) >= 2),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','archived')),
  result_label varchar(80) NOT NULL DEFAULT 'Result',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,term_id,code),
  CHECK(ends_on >= starts_on)
);
CREATE INDEX assessment_cycles_school_term_idx ON assessment_cycles(school_id,term_id,starts_on);

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  cycle_id uuid NOT NULL,
  class_section_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  title varchar(160) NOT NULL CHECK(length(trim(title)) >= 2),
  assessment_kind varchar(24) NOT NULL CHECK(assessment_kind IN ('exam','class_test','quiz','assignment','practical','viva','project','other')),
  maximum_marks numeric(8,2) NOT NULL CHECK(maximum_marks > 0 AND maximum_marks <= 100000),
  weight_percent numeric(5,2) CHECK(weight_percent IS NULL OR (weight_percent > 0 AND weight_percent <= 100)),
  scheduled_at timestamptz,
  duration_minutes integer CHECK(duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  venue varchar(160) NOT NULL DEFAULT '',
  instructions varchar(2000) NOT NULL DEFAULT '',
  evidence_requirement varchar(12) NOT NULL DEFAULT 'optional' CHECK(evidence_requirement IN ('none','optional','required')),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','marking','submitted','moderated','published','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  moderation_note varchar(1000) NOT NULL DEFAULT '',
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  moderated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  moderated_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,cycle_id,class_section_id,subject_id,title),
  FOREIGN KEY(school_id,cycle_id) REFERENCES assessment_cycles(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT,
  CHECK((submitted_at IS NULL) = (submitted_by IS NULL)),
  CHECK((moderated_at IS NULL) = (moderated_by IS NULL)),
  CHECK((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CHECK(status <> 'cancelled' OR length(trim(cancellation_reason)) >= 3)
);
CREATE INDEX assessments_school_state_idx ON assessments(school_id,status,scheduled_at,id);

CREATE TABLE assessment_staff_assignments (
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(16) NOT NULL CHECK(role IN ('examiner','moderator')),
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(assessment_id,role),
  UNIQUE(assessment_id,user_id),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE CASCADE
);
CREATE INDEX assessment_staff_user_idx ON assessment_staff_assignments(school_id,user_id,role,assessment_id);

CREATE TABLE assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  outcome varchar(20) NOT NULL DEFAULT 'unrecorded' CHECK(outcome IN ('unrecorded','scored','absent','exempt','withheld','not_evaluated')),
  marks numeric(8,2),
  grade varchar(24) NOT NULL DEFAULT '',
  feedback varchar(1000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(assessment_id,student_id),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='scored' AND marks IS NOT NULL) OR (outcome<>'scored' AND marks IS NULL)),
  CHECK((recorded_at IS NULL)=(recorded_by IS NULL)),
  CHECK(outcome='unrecorded' OR recorded_at IS NOT NULL)
);
CREATE INDEX assessment_results_assessment_outcome_idx ON assessment_results(assessment_id,outcome,student_id);

CREATE TABLE assessment_result_revisions (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  result_id uuid NOT NULL,
  student_id uuid NOT NULL,
  revision integer NOT NULL,
  previous_outcome varchar(20),
  outcome varchar(20) NOT NULL,
  previous_marks numeric(8,2),
  marks numeric(8,2),
  previous_grade varchar(24) NOT NULL DEFAULT '',
  grade varchar(24) NOT NULL DEFAULT '',
  previous_feedback varchar(1000) NOT NULL DEFAULT '',
  feedback varchar(1000) NOT NULL DEFAULT '',
  reason varchar(500) NOT NULL CHECK(length(trim(reason)) >= 3),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,result_id) REFERENCES assessment_results(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  UNIQUE(result_id,revision)
);

CREATE TABLE assessment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  result_id uuid NOT NULL,
  student_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  original_name varchar(255) NOT NULL,
  content_type varchar(100) NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,result_id) REFERENCES assessment_results(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX assessment_evidence_result_idx ON assessment_evidence(result_id,uploaded_at);

CREATE TABLE assessment_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  source_revision integer NOT NULL CHECK(source_revision > 0),
  reason varchar(500) NOT NULL CHECK(length(trim(reason)) >= 3),
  published_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(assessment_id,sequence),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT
);

CREATE TABLE assessment_publication_results (
  school_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  source_result_id uuid NOT NULL,
  source_result_revision integer NOT NULL,
  outcome varchar(20) NOT NULL CHECK(outcome IN ('scored','absent','exempt','withheld','not_evaluated')),
  marks numeric(8,2),
  grade varchar(24) NOT NULL DEFAULT '',
  feedback varchar(1000) NOT NULL DEFAULT '',
  PRIMARY KEY(publication_id,student_id),
  FOREIGN KEY(school_id,publication_id) REFERENCES assessment_publications(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,source_result_id) REFERENCES assessment_results(school_id,id) ON DELETE RESTRICT,
  CHECK((outcome='scored' AND marks IS NOT NULL) OR (outcome<>'scored' AND marks IS NULL))
);
CREATE INDEX assessment_publication_student_idx ON assessment_publication_results(school_id,student_id,publication_id);

CREATE TABLE assessment_audits (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  assessment_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(64) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX assessment_audits_assessment_idx ON assessment_audits(school_id,assessment_id,created_at DESC);

ALTER TABLE school_custom_roles DROP CONSTRAINT IF EXISTS school_custom_roles_permissions_check;
ALTER TABLE school_custom_roles ADD CONSTRAINT school_custom_roles_permissions_check CHECK (
  permissions <@ ARRAY['members.invite','sis.manage','fees.manage','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','assessments.view','assessments.mark','assessments.moderate','ai.use']::text[]
);

DO $$
DECLARE
  application_owner text;
  table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['assessment_cycles','assessments','assessment_staff_assignments','assessment_results','assessment_result_revisions','assessment_evidence','assessment_publications','assessment_publication_results','assessment_audits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
  IF to_regclass('public.assessment_result_revisions_id_seq') IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE public.assessment_result_revisions_id_seq OWNER TO %I',application_owner); END IF;
  IF to_regclass('public.assessment_audits_id_seq') IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE public.assessment_audits_id_seq OWNER TO %I',application_owner); END IF;
END $$;
