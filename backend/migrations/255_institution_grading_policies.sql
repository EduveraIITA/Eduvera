-- Institution-owned grading rules. Existing marks and published releases retain
-- their original interpretation; a NULL policy denotes the legacy contract.
CREATE TABLE academic_grading_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL CHECK(length(trim(code))>=2),
  version integer NOT NULL CHECK(version>0),
  name varchar(120) NOT NULL CHECK(length(trim(name))>=2),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object' AND configuration->>'schema_version'='1'),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  UNIQUE(school_id,id), UNIQUE(school_id,code,version),
  CHECK((activated_by IS NULL)=(activated_at IS NULL)),
  CHECK(status<>'active' OR activated_at IS NOT NULL)
);
CREATE FUNCTION protect_active_grading_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='active' THEN RAISE EXCEPTION 'Retained grading policy versions are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academic_grading_policy_immutable BEFORE UPDATE OR DELETE ON academic_grading_policies
  FOR EACH ROW EXECUTE FUNCTION protect_active_grading_policy();

ALTER TABLE grading_schemes ADD COLUMN grading_policy_id uuid,
  ADD COLUMN result_policy jsonb,
  ADD COLUMN programme_key varchar(80),
  ADD COLUMN term_index integer CHECK(term_index>0),
  ADD FOREIGN KEY(school_id,grading_policy_id) REFERENCES academic_grading_policies(school_id,id) ON DELETE RESTRICT,
  ADD CHECK((grading_policy_id IS NULL)=(result_policy IS NULL)),
  ADD CHECK((programme_key IS NULL)=(term_index IS NULL));
CREATE INDEX grading_schemes_programme_idx ON grading_schemes(school_id,programme_key,term_index) WHERE programme_key IS NOT NULL;
ALTER TABLE grading_scheme_subjects ADD COLUMN credits numeric(10,4) CHECK(credits>0 AND credits<=1000), ADD COLUMN course_code varchar(80);
ALTER TABLE grading_report_batches ADD COLUMN result_policy jsonb;
ALTER TABLE grading_report_subjects ADD COLUMN grade_points numeric(10,4) CHECK(grade_points>=0),
  ADD COLUMN credits numeric(10,4) CHECK(credits>0), ADD COLUMN course_code varchar(80);
ALTER TABLE grading_report_students ADD COLUMN gpa numeric(10,4), ADD COLUMN cgpa numeric(10,4),
  ADD COLUMN credit_total numeric(14,4), ADD COLUMN credit_points numeric(22,8),
  ADD COLUMN cumulative_credits numeric(14,4), ADD COLUMN cumulative_credit_points numeric(22,8),
  ADD COLUMN cumulative_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(cumulative_sources)='array'),
  ADD COLUMN gpa_unavailable_reason varchar(40), ADD COLUMN cgpa_unavailable_reason varchar(80);

ALTER TABLE assessments ADD COLUMN grading_policy_id uuid, ADD COLUMN result_policy jsonb,
  ADD FOREIGN KEY(school_id,grading_policy_id) REFERENCES academic_grading_policies(school_id,id) ON DELETE RESTRICT,
  ADD CHECK((grading_policy_id IS NULL)=(result_policy IS NULL));
ALTER TABLE assessment_publications ADD COLUMN result_policy jsonb;
ALTER TABLE assessment_publication_results ADD COLUMN percentage numeric(8,2) CHECK(percentage BETWEEN 0 AND 100),
  ADD COLUMN grade_points numeric(10,4) CHECK(grade_points>=0);

ALTER TABLE academic_grading_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academic_grading_policies FROM PUBLIC;
DO $$ DECLARE table_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid='public.grading_schemes'::regclass;
  EXECUTE format('ALTER TABLE academic_grading_policies OWNER TO %I',table_owner);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON academic_grading_policies FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON academic_grading_policies FROM authenticated; END IF;
END $$;
