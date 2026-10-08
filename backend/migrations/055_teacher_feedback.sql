-- Principal-created, confidential teaching feedback. Responses are never public.
CREATE TABLE teacher_feedback_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  teacher_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  audience varchar(16) NOT NULL CHECK(audience IN ('students','parents')),
  parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='array' AND jsonb_array_length(parameters) BETWEEN 1 AND 10),
  closes_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  CHECK(closes_at>created_at)
);
CREATE INDEX teacher_feedback_campaigns_school_idx ON teacher_feedback_campaigns(school_id,created_at DESC);
CREATE TABLE teacher_feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  respondent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ratings jsonb NOT NULL CHECK(jsonb_typeof(ratings)='object'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,respondent_user_id),
  FOREIGN KEY(school_id,campaign_id) REFERENCES teacher_feedback_campaigns(school_id,id) ON DELETE RESTRICT
);
CREATE TABLE teacher_feedback_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(24) NOT NULL CHECK(action IN ('created','closed','submitted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,campaign_id) REFERENCES teacher_feedback_campaigns(school_id,id) ON DELETE RESTRICT
);
DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['teacher_feedback_campaigns','teacher_feedback_responses','teacher_feedback_audits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
END $$;
