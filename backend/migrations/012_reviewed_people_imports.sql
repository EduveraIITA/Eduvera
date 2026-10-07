CREATE UNIQUE INDEX academic_terms_school_identity_idx ON academic_terms(school_id,id);
CREATE TABLE people_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  filename varchar(150) NOT NULL,
  upload_key uuid NOT NULL,
  source_digest char(64) NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','committed','cancelled','expired')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 500),
  receipt jsonb,
  commit_token char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  committed_at timestamptz,
  UNIQUE(school_id,id),
  UNIQUE(school_id,created_by,upload_key),
  FOREIGN KEY(school_id,term_id) REFERENCES academic_terms(school_id,id) ON DELETE RESTRICT,
  CHECK((state='committed')=(receipt IS NOT NULL AND commit_token IS NOT NULL AND committed_at IS NOT NULL))
);
CREATE INDEX people_imports_school_history_idx ON people_imports(school_id,created_at DESC,id DESC);
CREATE INDEX people_imports_creator_idx ON people_imports(created_by);
CREATE INDEX people_imports_term_idx ON people_imports(term_id);
CREATE INDEX people_imports_expiry_idx ON people_imports(expires_at) WHERE state='draft';
CREATE TABLE people_import_rows (
  school_id uuid NOT NULL,
  import_id uuid NOT NULL,
  row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 501),
  raw_values jsonb NOT NULL,
  decision text NOT NULL DEFAULT 'include' CHECK(decision IN ('include','skip')),
  guardian_choice jsonb NOT NULL DEFAULT '{"mode":"new"}',
  student_id uuid,
  PRIMARY KEY(import_id,row_number),
  FOREIGN KEY(school_id,import_id) REFERENCES people_imports(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX people_import_rows_school_idx ON people_import_rows(school_id,import_id);
CREATE INDEX people_import_rows_student_idx ON people_import_rows(school_id,student_id) WHERE student_id IS NOT NULL;
CREATE INDEX school_people_phone_identity_idx ON school_people(school_id,(regexp_replace(contact_phone,'[^0-9]','','g')));
CREATE INDEX school_people_name_identity_idx ON school_people(school_id,(lower(first_name||' '||last_name)));
ALTER TABLE people_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON people_imports,people_import_rows FROM PUBLIC;
DO $$ DECLARE school_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO school_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['people_imports','people_import_rows'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,school_owner);
  END LOOP;
END $$;
