-- A second native Learning context. No student/class/term/staff records are manufactured.
CREATE TABLE learning_offerings (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
  state text NOT NULL CHECK(state IN ('active','closed')),revision integer NOT NULL CHECK(revision>0),
  created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(school_id,id)
);
CREATE INDEX learning_offerings_list ON learning_offerings(school_id,state,name,id);
CREATE TABLE learning_offering_enrollments (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,offering_id uuid NOT NULL,person_id uuid NOT NULL,selected_person_revision integer NOT NULL CHECK(selected_person_revision>0),
  starts_on date NOT NULL,ends_on date,revision integer NOT NULL CHECK(revision>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
  ended_by uuid REFERENCES users(id),ended_at timestamptz,end_reason text,
  UNIQUE(school_id,offering_id,id),FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),CHECK(ends_on IS NULL OR ends_on>=starts_on),
  CHECK((ends_on IS NULL AND ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
    OR(ends_on IS NOT NULL AND ended_by IS NOT NULL AND ended_at IS NOT NULL AND length(end_reason) BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX learning_offering_one_open_enrollment ON learning_offering_enrollments(school_id,offering_id,person_id) WHERE ends_on IS NULL;
CREATE INDEX learning_offering_enrollment_person ON learning_offering_enrollments(school_id,person_id,offering_id,id);
CREATE TABLE learning_offering_teaching_assignments (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,offering_id uuid NOT NULL,person_id uuid NOT NULL,selected_person_revision integer NOT NULL CHECK(selected_person_revision>0),
  can_publish boolean NOT NULL,can_review boolean NOT NULL,CHECK(can_publish OR can_review),
  starts_on date NOT NULL,ends_on date,revision integer NOT NULL CHECK(revision>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
  ended_by uuid REFERENCES users(id),ended_at timestamptz,end_reason text,
  UNIQUE(school_id,offering_id,id),FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),CHECK(ends_on IS NULL OR ends_on>=starts_on),
  CHECK((ends_on IS NULL AND ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
    OR(ends_on IS NOT NULL AND ended_by IS NOT NULL AND ended_at IS NOT NULL AND length(end_reason) BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX learning_offering_one_open_teacher ON learning_offering_teaching_assignments(school_id,offering_id,person_id) WHERE ends_on IS NULL;
CREATE INDEX learning_offering_teacher_person ON learning_offering_teaching_assignments(school_id,person_id,offering_id,id);

-- Existing learner keys remain the legacy student UUID. New offering keys are the canonical person UUID.
-- The context disambiguates these domains; no person UUID is inserted into students.
ALTER TABLE learning_assignments ADD COLUMN context_kind text NOT NULL DEFAULT 'class_term' CHECK(context_kind IN ('class_term','learning_offering'));
ALTER TABLE learning_assignments ADD COLUMN offering_id uuid;
ALTER TABLE learning_assignments ADD COLUMN author_person_id uuid;
ALTER TABLE learning_assignments ADD COLUMN reviewer_person_id uuid;
ALTER TABLE learning_assignments ALTER COLUMN class_section_id DROP NOT NULL,ALTER COLUMN term_id DROP NOT NULL;
ALTER TABLE learning_assignments ADD FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id);
ALTER TABLE learning_assignments ADD FOREIGN KEY(school_id,author_person_id) REFERENCES school_people(school_id,id);
ALTER TABLE learning_assignments ADD FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id);
ALTER TABLE learning_assignments ADD CONSTRAINT learning_assignment_typed_context CHECK(
  context_kind='class_term' AND class_section_id IS NOT NULL AND term_id IS NOT NULL AND offering_id IS NULL
  OR context_kind='learning_offering' AND offering_id IS NOT NULL AND class_section_id IS NULL AND term_id IS NULL AND subject_id IS NULL
    AND author_person_id IS NOT NULL AND reviewer_person_id IS NOT NULL);
CREATE INDEX learning_assignment_offering ON learning_assignments(school_id,offering_id,updated_at DESC,id) WHERE offering_id IS NOT NULL;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM learning_assignment_audience a LEFT JOIN students s ON s.id=a.student_id AND s.school_id=a.school_id
    LEFT JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Assignment history has an unresolved canonical person; review before migrating';
  END IF;
END $$;
ALTER TABLE learning_assignment_audience DISABLE TRIGGER learning_assignment_audience_immutable;
ALTER TABLE learning_assignment_files DISABLE TRIGGER learning_assignment_file_immutable;
ALTER TABLE learning_assignment_attempts DISABLE TRIGGER learning_assignment_attempt_immutable;
ALTER TABLE learning_assignment_attempt_files DISABLE TRIGGER learning_assignment_manifest_immutable;
ALTER TABLE learning_assignment_reviews DISABLE TRIGGER learning_assignment_review_immutable;
DO $$ DECLARE item text; guard record; BEGIN
  FOR guard IN SELECT conrelid::regclass AS relation,conname FROM pg_constraint WHERE contype='f'
    AND conrelid IN ('learning_assignment_drafts'::regclass,'learning_assignment_files'::regclass,'learning_assignment_attempts'::regclass,
      'learning_assignment_attempt_files'::regclass,'learning_assignment_reviews'::regclass)
    AND confrelid IN ('learning_assignment_audience'::regclass,'learning_assignment_files'::regclass,'learning_assignment_attempts'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',guard.relation,guard.conname); END LOOP;
  FOREACH item IN ARRAY ARRAY['learning_assignment_audience','learning_assignment_drafts','learning_assignment_files','learning_assignment_attempts','learning_assignment_attempt_files','learning_assignment_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN learner_id uuid',item);
    EXECUTE format('UPDATE %I SET learner_id=student_id',item);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN learner_id SET NOT NULL',item);
  END LOOP;
END $$;
ALTER TABLE learning_assignment_audience ADD COLUMN person_id uuid;
UPDATE learning_assignment_audience a SET person_id=s.person_id FROM students s WHERE s.id=a.student_id AND s.school_id=a.school_id;
ALTER TABLE learning_assignment_audience ALTER COLUMN person_id SET NOT NULL,ADD COLUMN offering_enrollment_id uuid;
ALTER TABLE learning_assignment_audience DROP CONSTRAINT learning_assignment_audience_pkey;
ALTER TABLE learning_assignment_drafts DROP CONSTRAINT learning_assignment_drafts_pkey;
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['learning_assignment_audience','learning_assignment_drafts','learning_assignment_files','learning_assignment_attempts','learning_assignment_attempt_files','learning_assignment_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN student_id DROP NOT NULL',item);
  END LOOP;
END $$;
ALTER TABLE learning_assignment_audience ALTER COLUMN enrollment_id DROP NOT NULL;
ALTER TABLE learning_assignment_audience ADD PRIMARY KEY(school_id,assignment_id,learner_id),ADD UNIQUE(school_id,assignment_id,student_id),
  ADD UNIQUE(school_id,assignment_id,person_id),ADD FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  ADD FOREIGN KEY(offering_enrollment_id) REFERENCES learning_offering_enrollments(id),
  ADD CHECK(student_id IS NOT NULL AND enrollment_id IS NOT NULL AND offering_enrollment_id IS NULL AND learner_id=student_id
    OR student_id IS NULL AND enrollment_id IS NULL AND offering_enrollment_id IS NOT NULL AND learner_id=person_id);
CREATE INDEX learning_assignment_audience_person ON learning_assignment_audience(school_id,person_id,assignment_id);
CREATE INDEX learning_assignment_audience_offering_enrollment ON learning_assignment_audience(offering_enrollment_id) WHERE offering_enrollment_id IS NOT NULL;
ALTER TABLE learning_assignment_drafts ADD PRIMARY KEY(school_id,assignment_id,learner_id),
  ADD FOREIGN KEY(school_id,assignment_id,learner_id) REFERENCES learning_assignment_audience(school_id,assignment_id,learner_id);
ALTER TABLE learning_assignment_files ADD UNIQUE(school_id,assignment_id,learner_id,id),
  ADD FOREIGN KEY(school_id,assignment_id,learner_id) REFERENCES learning_assignment_audience(school_id,assignment_id,learner_id);
CREATE INDEX learning_assignment_files_learner ON learning_assignment_files(school_id,assignment_id,learner_id,created_at,id) WHERE draft_attached;
ALTER TABLE learning_assignment_attempts ADD UNIQUE(school_id,assignment_id,learner_id,id),ADD UNIQUE(school_id,assignment_id,learner_id,attempt_number),
  ADD FOREIGN KEY(school_id,assignment_id,learner_id) REFERENCES learning_assignment_audience(school_id,assignment_id,learner_id);
ALTER TABLE learning_assignment_attempt_files ADD FOREIGN KEY(school_id,assignment_id,learner_id,attempt_id) REFERENCES learning_assignment_attempts(school_id,assignment_id,learner_id,id),
  ADD FOREIGN KEY(school_id,assignment_id,learner_id,file_id) REFERENCES learning_assignment_files(school_id,assignment_id,learner_id,id);
CREATE INDEX learning_assignment_manifest_learner ON learning_assignment_attempt_files(school_id,assignment_id,learner_id,file_id);
ALTER TABLE learning_assignment_reviews ADD FOREIGN KEY(school_id,assignment_id,learner_id,attempt_id) REFERENCES learning_assignment_attempts(school_id,assignment_id,learner_id,id);
CREATE INDEX learning_assignment_reviews_person ON learning_assignment_reviews(school_id,assignment_id,learner_id,reviewed_at,id);
ALTER TABLE learning_assignment_audience ENABLE TRIGGER learning_assignment_audience_immutable;
ALTER TABLE learning_assignment_files ENABLE TRIGGER learning_assignment_file_immutable;
ALTER TABLE learning_assignment_attempts ENABLE TRIGGER learning_assignment_attempt_immutable;
ALTER TABLE learning_assignment_attempt_files ENABLE TRIGGER learning_assignment_manifest_immutable;
ALTER TABLE learning_assignment_reviews ENABLE TRIGGER learning_assignment_review_immutable;

CREATE OR REPLACE FUNCTION learning_assignment_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='learning_assignments' THEN
    IF NEW.context_kind='class_term' THEN
      IF NOT EXISTS(SELECT 1 FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
        WHERE c.id=NEW.class_section_id AND t.id=NEW.term_id AND c.school_id=NEW.school_id)
        OR NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects s WHERE s.id=NEW.subject_id AND s.school_id=NEW.school_id)
      THEN RAISE EXCEPTION 'Assignment scope is outside its campus'; END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM learning_offerings o WHERE o.id=NEW.offering_id AND o.school_id=NEW.school_id) THEN
      RAISE EXCEPTION 'Assignment offering is outside its campus';
    END IF;
    IF TG_OP='UPDATE' AND OLD.state='published' THEN RAISE EXCEPTION 'Published instructions are immutable'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM learning_assignments a WHERE a.id=NEW.assignment_id AND a.school_id=NEW.school_id AND (
      a.context_kind='class_term' AND EXISTS(SELECT 1 FROM students s JOIN enrollments e ON e.student_id=s.id
        WHERE s.id=NEW.student_id AND s.person_id=NEW.person_id AND s.school_id=NEW.school_id AND e.id=NEW.enrollment_id
          AND e.class_section_id=a.class_section_id AND e.term_id=a.term_id AND e.revision=NEW.enrollment_revision)
      OR a.context_kind='learning_offering' AND EXISTS(SELECT 1 FROM learning_offering_enrollments e
        WHERE e.id=NEW.offering_enrollment_id AND e.school_id=a.school_id AND e.offering_id=a.offering_id
          AND e.person_id=NEW.person_id AND e.revision=NEW.enrollment_revision))) THEN
      RAISE EXCEPTION 'Assignment audience is outside its source';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION learning_assignment_work_person_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM learning_assignment_audience a WHERE a.school_id=NEW.school_id AND a.assignment_id=NEW.assignment_id
    AND a.learner_id=NEW.learner_id AND a.student_id IS NOT DISTINCT FROM NEW.student_id) THEN
    RAISE EXCEPTION 'Assignment learner identity is outside its frozen audience';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['learning_assignment_drafts','learning_assignment_files','learning_assignment_attempts','learning_assignment_attempt_files','learning_assignment_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER learning_work_person BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION learning_assignment_work_person_guard()',item);
  END LOOP;
END $$;
CREATE FUNCTION learning_offering_registration_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Learning registrations retain their history'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'ends_on'-'revision'-'ended_by'-'ended_at'-'end_reason') IS DISTINCT FROM
    (to_jsonb(OLD)-'ends_on'-'revision'-'ended_by'-'ended_at'-'end_reason') OR OLD.ends_on IS NOT NULL OR NEW.ends_on IS NULL OR NEW.revision<>OLD.revision+1)
  THEN RAISE EXCEPTION 'End an exact registration; rejoining creates a new registration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_offering_enrollment_history BEFORE UPDATE OR DELETE ON learning_offering_enrollments FOR EACH ROW EXECUTE FUNCTION learning_offering_registration_guard();
CREATE TRIGGER learning_offering_teacher_history BEFORE UPDATE OR DELETE ON learning_offering_teaching_assignments FOR EACH ROW EXECUTE FUNCTION learning_offering_registration_guard();

CREATE FUNCTION learning_offering_person_can_teach(school_uuid uuid,offering_uuid uuid,user_uuid uuid,person_uuid uuid,required_action text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM learning_offering_teaching_assignments a JOIN schools s ON s.id=a.school_id
    JOIN learning_offerings o ON o.id=a.offering_id AND o.school_id=a.school_id AND o.state='active'
    JOIN school_memberships m ON m.school_id=a.school_id AND m.user_id=user_uuid AND m.is_active JOIN users u ON u.id=m.user_id AND u.is_active
    WHERE a.school_id=school_uuid AND a.offering_id=offering_uuid AND(person_uuid IS NULL OR a.person_id=person_uuid)
      AND a.starts_on<=(evaluated_at AT TIME ZONE s.timezone)::date
      AND(a.ends_on IS NULL OR a.ends_on>(evaluated_at AT TIME ZONE s.timezone)::date)
      AND(required_action='publish' AND a.can_publish OR required_action='review' AND a.can_review)
      AND campus_model_account_person_is_active(a.school_id,user_uuid,a.person_id,evaluated_at))
$$;
CREATE FUNCTION learning_offering_teacher_is_current(school_uuid uuid,offering_uuid uuid,user_uuid uuid,required_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT learning_offering_person_can_teach(school_uuid,offering_uuid,user_uuid,NULL,required_action,now())
$$;
ALTER FUNCTION learning_assignment_event_is_authorized(uuid,jsonb,uuid) RENAME TO learning_assignment_class_event_is_authorized;
CREATE FUNCTION learning_assignment_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM learning_assignments a WHERE a.id::text=event_payload->>'assignment_id'
      AND a.school_id=event_school_id AND a.context_kind='class_term') THEN learning_assignment_class_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE EXISTS(SELECT 1 FROM learning_assignments a JOIN school_memberships m ON m.school_id=a.school_id AND m.user_id=candidate_user_id AND m.is_active
      JOIN users u ON u.id=m.user_id AND u.is_active
      WHERE a.id::text=event_payload->>'assignment_id' AND a.school_id=event_school_id AND a.context_kind='learning_offering'
        AND NOT event_payload ? 'student_id'
        AND(NOT event_payload ? 'person_id' OR EXISTS(SELECT 1 FROM learning_assignment_audience x WHERE x.school_id=a.school_id AND x.assignment_id=a.id AND x.person_id::text=event_payload->>'person_id'))
        AND(NOT event_payload ? 'attempt_id' OR EXISTS(SELECT 1 FROM learning_assignment_attempts t WHERE t.school_id=a.school_id AND t.assignment_id=a.id
          AND t.id::text=event_payload->>'attempt_id' AND t.learner_id::text=event_payload->>'person_id'))
        AND(a.reviewer_id=candidate_user_id AND a.state='published' AND campus_model_account_person_is_active(a.school_id,candidate_user_id,a.reviewer_person_id,now())
            AND learning_offering_teacher_is_current(a.school_id,a.offering_id,candidate_user_id,'review')
          OR a.author_id=candidate_user_id AND NOT event_payload ? 'person_id' AND campus_model_account_person_is_active(a.school_id,candidate_user_id,a.author_person_id,now())
            AND learning_offering_teacher_is_current(a.school_id,a.offering_id,candidate_user_id,'publish')
          OR a.state='published' AND EXISTS(SELECT 1 FROM learning_assignment_audience x WHERE x.school_id=a.school_id AND x.assignment_id=a.id
            AND(NOT event_payload ? 'person_id' OR x.person_id::text=event_payload->>'person_id')
            AND campus_model_account_person_is_active(a.school_id,candidate_user_id,x.person_id,now())))) END
$$;
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_learning_offerings;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name LIKE 'learning.offering.%' OR event_name='diary.updated' AND event_payload ? 'offering_id' AND NOT event_payload ? 'assignment_id' THEN
    NOT event_payload ? 'assignment_id' AND event_name IN ('learning.offering.created','learning.offering.enrolled','learning.offering.enrollment_ended','learning.offering.instructor_ended','learning.offering.instructor_appointed','diary.updated')
      AND EXISTS(SELECT 1 FROM learning_offerings o JOIN school_memberships m ON m.school_id=o.school_id AND m.user_id=candidate_user_id AND m.is_active
        JOIN users u ON u.id=m.user_id AND u.is_active JOIN schools campus ON campus.id=o.school_id
        WHERE o.school_id=event_school_id AND o.id::text=event_payload->>'offering_id' AND o.state='active'
          AND campus_model_account_person_is_active(o.school_id,candidate_user_id,NULL,now())
          AND(m.role='admin' OR learning_offering_teacher_is_current(o.school_id,o.id,candidate_user_id,'publish')
            OR learning_offering_teacher_is_current(o.school_id,o.id,candidate_user_id,'review') OR EXISTS(SELECT 1 FROM learning_offering_enrollments e
              WHERE e.school_id=o.school_id AND e.offering_id=o.id AND e.starts_on<=(now() AT TIME ZONE campus.timezone)::date
                AND(e.ends_on IS NULL OR e.ends_on>(now() AT TIME ZONE campus.timezone)::date)
                AND campus_model_account_person_is_active(o.school_id,candidate_user_id,e.person_id,now()))))
    WHEN event_name LIKE 'learning.assignment.%' THEN event_name IN ('learning.assignment.draft_saved','learning.assignment.published','learning.assignment.submitted','learning.assignment.changes_requested','learning.assignment.reviewed')
      AND learning_assignment_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    WHEN event_name='diary.updated' AND event_payload ? 'assignment_id' THEN learning_assignment_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE event_user_is_authorized_before_learning_offerings(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
-- Preserve the original event validator and add exact person/offering validation first.
ALTER FUNCTION validate_assignment_event_source() RENAME TO validate_assignment_class_event_source;
DROP TRIGGER assignment_event_source_scope ON event_outbox;
CREATE FUNCTION validate_learning_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.payload ? 'assignment_id' AND NEW.payload ? 'offering_id' THEN RAISE EXCEPTION 'Learning event must identify one owning source'; END IF;
  IF NEW.event_type LIKE 'learning.offering.%' OR NEW.event_type='diary.updated' AND NEW.payload ? 'offering_id' AND NOT NEW.payload ? 'assignment_id' THEN
    IF NEW.payload ? 'assignment_id' OR NEW.event_type NOT IN ('learning.offering.created','learning.offering.enrolled','learning.offering.enrollment_ended','learning.offering.instructor_ended','learning.offering.instructor_appointed','diary.updated')
      OR NEW.aggregate_type<>'learning_offering' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'offering_id'
      OR NOT EXISTS(SELECT 1 FROM learning_offerings o WHERE o.school_id=NEW.school_id AND o.id=NEW.aggregate_id)
    THEN RAISE EXCEPTION 'Offering event does not match its source'; END IF;
  ELSIF NEW.event_type LIKE 'learning.assignment.%' OR NEW.event_type='diary.updated' AND NEW.payload ? 'assignment_id' THEN
    IF NEW.event_type NOT IN ('learning.assignment.draft_saved','learning.assignment.published','learning.assignment.submitted','learning.assignment.changes_requested','learning.assignment.reviewed','diary.updated')
    THEN RAISE EXCEPTION 'Unknown assignment event schema'; END IF;
    IF NOT EXISTS(SELECT 1 FROM learning_assignments a WHERE a.school_id=NEW.school_id AND a.id::text=NEW.payload->>'assignment_id')
    THEN RAISE EXCEPTION 'Assignment event does not match its source'; END IF;
    IF NEW.payload ? 'person_id' AND NOT EXISTS(SELECT 1 FROM learning_assignment_audience x WHERE x.school_id=NEW.school_id
      AND x.assignment_id::text=NEW.payload->>'assignment_id' AND x.person_id::text=NEW.payload->>'person_id' AND x.student_id IS NULL)
      OR NEW.payload ? 'student_id' AND NOT EXISTS(SELECT 1 FROM learning_assignment_audience x WHERE x.school_id=NEW.school_id
        AND x.assignment_id::text=NEW.payload->>'assignment_id' AND x.student_id::text=NEW.payload->>'student_id')
    THEN RAISE EXCEPTION 'Assignment event learner is outside its source'; END IF;
    IF NEW.payload ? 'attempt_id' THEN
      IF NOT EXISTS(SELECT 1 FROM learning_assignment_attempts t WHERE t.school_id=NEW.school_id AND t.id::text=NEW.payload->>'attempt_id'
        AND t.assignment_id::text=NEW.payload->>'assignment_id' AND(t.student_id::text=NEW.payload->>'student_id' OR t.student_id IS NULL AND t.learner_id::text=NEW.payload->>'person_id'))
      THEN RAISE EXCEPTION 'Assignment attempt event does not match its source'; END IF;
    END IF;
    IF NEW.event_type='diary.updated' AND(NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id')
      OR NEW.event_type<>'diary.updated' AND NEW.payload ? 'attempt_id' AND(NEW.aggregate_type<>'learning_assignment_attempt' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'attempt_id')
      OR NEW.event_type<>'diary.updated' AND NOT NEW.payload ? 'attempt_id' AND(NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id')
    THEN RAISE EXCEPTION 'Assignment event aggregate does not match its source'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_event_source_scope BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION validate_learning_event_source();
DO $$ DECLARE item text; restricted text; app_owner text; fn regprocedure; BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='learning_assignments'::regclass;
  FOREACH item IN ARRAY ARRAY['learning_offerings','learning_offering_enrollments','learning_offering_teaching_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,app_owner);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,restricted);END IF;END LOOP;
  END LOOP;
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('learning_assignment_work_person_guard','learning_offering_registration_guard','learning_offering_person_can_teach','learning_offering_teacher_is_current','learning_assignment_event_is_authorized','event_user_is_authorized','validate_learning_event_source')
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I',fn,app_owner);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,restricted);END IF;END LOOP;
  END LOOP;
END $$;
