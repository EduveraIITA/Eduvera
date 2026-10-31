-- Individual learning work. Existing Diary practice/completion is unchanged.
CREATE TABLE learning_assignments (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id),
  class_section_id uuid NOT NULL REFERENCES class_sections(id), term_id uuid NOT NULL REFERENCES academic_terms(id),
  subject_id uuid REFERENCES subjects(id), author_id uuid NOT NULL REFERENCES users(id), reviewer_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180), instructions text NOT NULL CHECK(length(instructions) BETWEEN 1 AND 8000),
  due_at timestamptz, cutoff_at timestamptz, submission_mode text NOT NULL CHECK(submission_mode IN ('text','files','either')),
  max_attempts integer CHECK(max_attempts BETWEEN 1 AND 100), policy_version integer NOT NULL CHECK(policy_version=1),
  resubmission_mode text NOT NULL CHECK(resubmission_mode='on_request'),
  state text NOT NULL CHECK(state IN ('draft','published')), revision integer NOT NULL CHECK(revision>0),
  published_at timestamptz, review_route_version_id uuid, review_subscription_id uuid,
  revision_route_version_id uuid, revision_subscription_id uuid,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE(school_id,id), CHECK((state='published')=(published_at IS NOT NULL)), CHECK(cutoff_at IS NULL OR due_at IS NULL OR cutoff_at>=due_at)
);
CREATE INDEX learning_assignments_author_idx ON learning_assignments(school_id,author_id,class_section_id,updated_at DESC,id);
CREATE INDEX learning_assignments_reviewer_idx ON learning_assignments(school_id,reviewer_id,state,id);
CREATE INDEX learning_assignments_term_idx ON learning_assignments(term_id);
CREATE INDEX learning_assignments_subject_idx ON learning_assignments(subject_id) WHERE subject_id IS NOT NULL;
CREATE TABLE learning_assignment_audience (
  school_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES students(id),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id), enrollment_revision integer NOT NULL CHECK(enrollment_revision>0), created_at timestamptz NOT NULL,
  PRIMARY KEY(school_id,assignment_id,student_id),
  FOREIGN KEY(school_id,assignment_id) REFERENCES learning_assignments(school_id,id)
);
CREATE INDEX learning_assignment_audience_student_idx ON learning_assignment_audience(school_id,student_id,assignment_id);
CREATE INDEX learning_assignment_audience_enrollment_idx ON learning_assignment_audience(enrollment_id);
CREATE TABLE learning_assignment_drafts (
  school_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  body text NOT NULL CHECK(length(body)<=12000), revision integer NOT NULL CHECK(revision>0),
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL,
  PRIMARY KEY(school_id,assignment_id,student_id),
  FOREIGN KEY(school_id,assignment_id,student_id) REFERENCES learning_assignment_audience(school_id,assignment_id,student_id)
);
CREATE TABLE learning_assignment_files (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  storage_key text NOT NULL CHECK(storage_key~'^[a-f0-9-]{36}$'), original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg','text/plain')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880), sha256 char(64) NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  draft_attached boolean NOT NULL, uploaded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  UNIQUE(school_id,assignment_id,student_id,id), UNIQUE(school_id,storage_key),
  FOREIGN KEY(school_id,assignment_id,student_id) REFERENCES learning_assignment_audience(school_id,assignment_id,student_id)
);
CREATE INDEX learning_assignment_files_draft_idx ON learning_assignment_files(school_id,assignment_id,student_id,created_at,id) WHERE draft_attached;
CREATE TABLE learning_assignment_attempts (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number>0), body text NOT NULL CHECK(length(body)<=12000),
  manifest_hash char(64) NOT NULL CHECK(manifest_hash~'^[a-f0-9]{64}$'), submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL, draft_revision integer NOT NULL CHECK(draft_revision>0),
  review_message_id uuid, revision_message_id uuid,
  revision_route_version_id uuid NOT NULL, revision_subscription_id uuid NOT NULL, revision_selector_key text NOT NULL,
  UNIQUE(school_id,assignment_id,student_id,id), UNIQUE(school_id,assignment_id,student_id,attempt_number),
  FOREIGN KEY(school_id,assignment_id,student_id) REFERENCES learning_assignment_audience(school_id,assignment_id,student_id)
);
CREATE INDEX learning_assignment_attempts_review_idx ON learning_assignment_attempts(school_id,assignment_id,submitted_at,id);
CREATE TABLE learning_assignment_attempt_files (
  school_id uuid NOT NULL, attempt_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL, file_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 2), PRIMARY KEY(school_id,attempt_id,file_id), UNIQUE(school_id,attempt_id,ordinal),
  FOREIGN KEY(school_id,assignment_id,student_id,attempt_id) REFERENCES learning_assignment_attempts(school_id,assignment_id,student_id,id),
  FOREIGN KEY(school_id,assignment_id,student_id,file_id) REFERENCES learning_assignment_files(school_id,assignment_id,student_id,id)
);
CREATE INDEX learning_assignment_attempt_files_file_idx ON learning_assignment_attempt_files(school_id,assignment_id,student_id,file_id);
CREATE TABLE learning_assignment_reviews (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, assignment_id uuid NOT NULL, student_id uuid NOT NULL, attempt_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('reviewed','request_changes')), feedback text NOT NULL CHECK(length(feedback) BETWEEN 1 AND 4000),
  reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL,
  UNIQUE(school_id,attempt_id),
  FOREIGN KEY(school_id,assignment_id,student_id,attempt_id) REFERENCES learning_assignment_attempts(school_id,assignment_id,student_id,id)
);
CREATE INDEX learning_assignment_reviews_learner_idx ON learning_assignment_reviews(school_id,assignment_id,student_id,reviewed_at,id);

-- Source snapshot and submission integrity are native invariants, not UI conventions.
CREATE FUNCTION learning_assignment_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='learning_assignments' THEN
    IF NOT EXISTS(SELECT 1 FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      WHERE c.id=NEW.class_section_id AND t.id=NEW.term_id AND c.school_id=NEW.school_id)
      OR NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects s WHERE s.id=NEW.subject_id AND s.school_id=NEW.school_id) THEN
      RAISE EXCEPTION 'Assignment scope is outside its campus';
    END IF;
    IF TG_OP='UPDATE' AND OLD.state='published' THEN RAISE EXCEPTION 'Published instructions are immutable'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM students s JOIN enrollments e ON e.student_id=s.id JOIN learning_assignments a ON a.id=NEW.assignment_id AND a.school_id=s.school_id
      WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id AND e.id=NEW.enrollment_id AND e.class_section_id=a.class_section_id AND e.term_id=a.term_id) THEN
      RAISE EXCEPTION 'Assignment audience is outside its source';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Supported choice only; no existing role or account gains assignment access.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish','learning.assignments.manage']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect']
    ELSE ARRAY[]::text[] END
$$;
CREATE TRIGGER learning_assignment_scope BEFORE INSERT OR UPDATE ON learning_assignments FOR EACH ROW EXECUTE FUNCTION learning_assignment_scope_guard();
CREATE FUNCTION learning_assignment_source_delete_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.state='published' THEN RAISE EXCEPTION 'Published instructions are immutable'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER learning_assignment_source_delete BEFORE DELETE ON learning_assignments FOR EACH ROW EXECUTE FUNCTION learning_assignment_source_delete_guard();
CREATE TRIGGER learning_assignment_audience_scope BEFORE INSERT ON learning_assignment_audience FOR EACH ROW EXECUTE FUNCTION learning_assignment_scope_guard();
CREATE FUNCTION learning_assignment_immutable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Published learning evidence is immutable'; END $$;
CREATE TRIGGER learning_assignment_audience_immutable BEFORE UPDATE OR DELETE ON learning_assignment_audience FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER learning_assignment_manifest_immutable BEFORE UPDATE OR DELETE ON learning_assignment_attempt_files FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER learning_assignment_review_immutable BEFORE UPDATE OR DELETE ON learning_assignment_reviews FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE FUNCTION learning_assignment_file_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'draft_attached') IS DISTINCT FROM (to_jsonb(OLD)-'draft_attached') THEN
    RAISE EXCEPTION 'Learning file content metadata is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_assignment_file_immutable BEFORE UPDATE OR DELETE ON learning_assignment_files FOR EACH ROW EXECUTE FUNCTION learning_assignment_file_guard();
CREATE FUNCTION learning_assignment_attempt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'review_message_id'-'revision_message_id') IS DISTINCT FROM (to_jsonb(OLD)-'review_message_id'-'revision_message_id')
    OR OLD.review_message_id IS NOT NULL AND NEW.review_message_id IS DISTINCT FROM OLD.review_message_id
    OR OLD.revision_message_id IS NOT NULL AND NEW.revision_message_id IS DISTINCT FROM OLD.revision_message_id THEN
    RAISE EXCEPTION 'Submitted learning evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_assignment_attempt_immutable BEFORE UPDATE OR DELETE ON learning_assignment_attempts FOR EACH ROW EXECUTE FUNCTION learning_assignment_attempt_guard();
DO $$ DECLARE item text; role_name text; owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='diary_items'::regclass;
  FOREACH item IN ARRAY ARRAY['learning_assignments','learning_assignment_audience','learning_assignment_drafts','learning_assignment_files','learning_assignment_attempts','learning_assignment_attempt_files','learning_assignment_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',item);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',item,role_name); END IF;
    END LOOP;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,owner_name);
  END LOOP;
END $$;
