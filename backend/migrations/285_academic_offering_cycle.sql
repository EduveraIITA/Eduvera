-- Course context is optional. Basic canonical-person learning groups remain usable
-- without school class placement, a programme hierarchy or compatibility students.
CREATE TABLE learning_offering_academic_contexts (
  school_id uuid NOT NULL,offering_id uuid NOT NULL,term_id uuid NOT NULL REFERENCES academic_terms(id),subject_id uuid NOT NULL,
  course_code text NOT NULL CHECK(length(course_code) BETWEEN 2 AND 80),
  credits numeric(10,4) NOT NULL CHECK(credits>0 AND credits<=1000),programme_key text,
  revision integer NOT NULL CHECK(revision>0),created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
  PRIMARY KEY(school_id,offering_id),FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id),
  CHECK(programme_key IS NULL OR length(programme_key) BETWEEN 2 AND 80)
);
CREATE FUNCTION learning_offering_academic_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Course context retains its source history'; END IF;
  IF NOT EXISTS(SELECT 1 FROM academic_terms t WHERE t.school_id=NEW.school_id AND t.id=NEW.term_id)
    THEN RAISE EXCEPTION 'Course term is outside this institution'; END IF;
  IF TG_OP='UPDATE' AND (OLD.school_id,OLD.offering_id) IS DISTINCT FROM (NEW.school_id,NEW.offering_id)
    THEN RAISE EXCEPTION 'Course context identity is immutable'; END IF;
  IF TG_OP='UPDATE' AND (EXISTS(SELECT 1 FROM assessments a WHERE a.school_id=OLD.school_id AND a.offering_id=OLD.offering_id)
    OR EXISTS(SELECT 1 FROM schedule_versions v WHERE v.school_id=OLD.school_id AND v.offering_id=OLD.offering_id AND v.published_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM grading_scheme_offerings s WHERE s.school_id=OLD.school_id AND s.offering_id=OLD.offering_id))
    THEN RAISE EXCEPTION 'A used course context is retained; create an explicit new offering for a different course'; END IF;
  RETURN NEW;
END $$;

ALTER TABLE schedule_versions ADD COLUMN offering_id uuid,
  ADD FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  ADD CONSTRAINT schedule_offering_context CHECK(offering_id IS NULL OR
    (planning_origin='activity' AND activity_purpose='teaching' AND class_section_id IS NULL AND term_id IS NULL));
ALTER TABLE schedule_activity_occurrences ADD COLUMN offering_id uuid,
  ADD FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  ADD CONSTRAINT occurrence_offering_context CHECK(offering_id IS NULL OR (source='activity' AND context_kind='activity'));
ALTER TABLE schedule_plan_roster_sources DROP CONSTRAINT schedule_plan_roster_sources_source_kind_check;
ALTER TABLE schedule_plan_roster_sources ADD CONSTRAINT schedule_plan_roster_sources_source_kind_check
  CHECK(source_kind IN ('person','class','group','team','teaching','learning_offering'));
ALTER TABLE schedule_activity_occurrence_people DROP CONSTRAINT schedule_activity_occurrence_people_source_kind_check;
ALTER TABLE schedule_activity_occurrence_people ADD CONSTRAINT schedule_activity_occurrence_people_source_kind_check
  CHECK(source_kind IN ('person','class','team','group','teaching','event','examination','learning_offering'));

ALTER TABLE assessments ADD COLUMN context_kind text NOT NULL DEFAULT 'class_term',ADD COLUMN offering_id uuid,
  ALTER COLUMN class_section_id DROP NOT NULL,
  ADD FOREIGN KEY(school_id,offering_id) REFERENCES learning_offerings(school_id,id),
  ADD CONSTRAINT assessment_learning_context CHECK(
    context_kind='class_term' AND class_section_id IS NOT NULL AND offering_id IS NULL
    OR context_kind='learning_offering' AND class_section_id IS NULL AND offering_id IS NOT NULL);
CREATE UNIQUE INDEX assessment_offering_title ON assessments(school_id,cycle_id,offering_id,subject_id,title) WHERE offering_id IS NOT NULL;
CREATE FUNCTION assessment_learning_context_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.context_kind,NEW.class_section_id,NEW.offering_id,NEW.subject_id,NEW.cycle_id)
    IS DISTINCT FROM (OLD.context_kind,OLD.class_section_id,OLD.offering_id,OLD.subject_id,OLD.cycle_id)
    THEN RAISE EXCEPTION 'An assessment retains its exact academic context'; END IF;
  IF NEW.context_kind='learning_offering' AND NOT EXISTS(
    SELECT 1 FROM learning_offering_academic_contexts binding JOIN assessment_cycles cycle ON cycle.school_id=binding.school_id AND cycle.term_id=binding.term_id
    WHERE binding.school_id=NEW.school_id AND binding.offering_id=NEW.offering_id AND binding.subject_id=NEW.subject_id AND cycle.id=NEW.cycle_id)
    THEN RAISE EXCEPTION 'Offering assessment term and subject do not match its course'; END IF;
  IF NEW.context_kind='learning_offering' AND NEW.assessment_kind IN ('exam','practical','viva')
    THEN RAISE EXCEPTION 'Physical offering sittings require the examination candidate integration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_learning_context BEFORE INSERT OR UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION assessment_learning_context_guard();

ALTER TABLE grading_schemes ADD COLUMN context_kind text NOT NULL DEFAULT 'class_term',ALTER COLUMN class_section_id DROP NOT NULL,
  ADD CONSTRAINT grading_scheme_learning_context CHECK(context_kind='class_term' AND class_section_id IS NOT NULL
    OR context_kind='learning_offering' AND class_section_id IS NULL);
CREATE TABLE grading_scheme_offerings (
  school_id uuid NOT NULL,scheme_id uuid NOT NULL,offering_id uuid NOT NULL,
  PRIMARY KEY(school_id,scheme_id,offering_id),
  FOREIGN KEY(school_id,scheme_id) REFERENCES grading_schemes(school_id,id),
  FOREIGN KEY(school_id,offering_id) REFERENCES learning_offering_academic_contexts(school_id,offering_id)
);
CREATE UNIQUE INDEX grading_scheme_offering_code ON grading_schemes(school_id,term_id,code) WHERE context_kind='learning_offering';
ALTER TABLE grading_scheme_subjects ADD COLUMN offering_id uuid,
  ADD FOREIGN KEY(school_id,offering_id) REFERENCES learning_offering_academic_contexts(school_id,offering_id);
ALTER TABLE grading_scheme_subjects DROP CONSTRAINT grading_scheme_subjects_scheme_id_subject_id_key;
CREATE UNIQUE INDEX grading_class_subject_identity ON grading_scheme_subjects(scheme_id,subject_id) WHERE offering_id IS NULL;
CREATE UNIQUE INDEX grading_offering_subject_identity ON grading_scheme_subjects(scheme_id,offering_id) WHERE offering_id IS NOT NULL;
-- Parallel sections may share a course code. One report may include one such
-- offering per course code until reviewed shared-course grouping is available.
CREATE UNIQUE INDEX grading_report_offering_course_code ON grading_scheme_subjects(scheme_id,course_code) WHERE offering_id IS NOT NULL;
DO $$ DECLARE existing_name name; matches integer; BEGIN
  SELECT count(*),min(constraint_row.conname::text)::name INTO matches,existing_name FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid='grading_report_subjects'::regclass AND constraint_row.contype='u'
      AND ARRAY(SELECT attribute.attname FROM unnest(constraint_row.conkey) WITH ORDINALITY key(attnum,position)
        JOIN pg_attribute attribute ON attribute.attrelid=constraint_row.conrelid AND attribute.attnum=key.attnum ORDER BY key.position)
        =ARRAY['batch_id','report_student_id','subject_id']::name[];
  IF matches<>1 THEN RAISE EXCEPTION 'Expected exact prior report subject identity constraint, found %',matches; END IF;
  EXECUTE format('ALTER TABLE grading_report_subjects DROP CONSTRAINT %I',existing_name);
END $$;
ALTER TABLE grading_report_subjects ADD CONSTRAINT grading_report_course_subject_identity UNIQUE(batch_id,report_student_id,scheme_subject_id);
CREATE TRIGGER learning_offering_academic_scope BEFORE INSERT OR UPDATE OR DELETE ON learning_offering_academic_contexts
  FOR EACH ROW EXECUTE FUNCTION learning_offering_academic_scope_guard();

-- Retain every existing student key and issued value. Canonical-person offerings
-- use distinct learner/person keys; no person UUID is inserted into students.
ALTER TABLE assessment_publication_results DROP CONSTRAINT assessment_publication_results_pkey;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['assessment_results','assessment_result_revisions','assessment_evidence','assessment_publication_results',
    'grading_report_students','grading_report_assessment_sources'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN learner_id uuid,ADD COLUMN person_id uuid',name);
    EXECUTE format('UPDATE %I entry SET learner_id=entry.student_id,person_id=s.person_id FROM students s WHERE s.id=entry.student_id AND s.school_id=entry.school_id',name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN learner_id SET NOT NULL,ALTER COLUMN person_id SET NOT NULL,ALTER COLUMN student_id DROP NOT NULL',name);
    EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),ADD CHECK(student_id IS NOT NULL AND learner_id=student_id OR student_id IS NULL AND learner_id=person_id)',name);
  END LOOP;
END $$;
ALTER TABLE assessment_results ADD UNIQUE(school_id,assessment_id,id,learner_id,person_id),
  ADD UNIQUE(assessment_id,learner_id),ADD UNIQUE(assessment_id,person_id);
ALTER TABLE assessment_publication_results ADD PRIMARY KEY(publication_id,learner_id),ADD UNIQUE(publication_id,student_id),
  ADD UNIQUE(school_id,publication_id,assessment_id,learner_id,person_id),ADD UNIQUE(publication_id,person_id);
ALTER TABLE grading_report_students ADD UNIQUE(batch_id,learner_id),ADD UNIQUE(batch_id,person_id);
ALTER TABLE assessment_result_revisions ADD FOREIGN KEY(school_id,assessment_id,result_id,learner_id,person_id)
  REFERENCES assessment_results(school_id,assessment_id,id,learner_id,person_id);
ALTER TABLE assessment_evidence ADD FOREIGN KEY(school_id,assessment_id,result_id,learner_id,person_id)
  REFERENCES assessment_results(school_id,assessment_id,id,learner_id,person_id);
ALTER TABLE assessment_publication_results ADD FOREIGN KEY(school_id,assessment_id,source_result_id,learner_id,person_id)
  REFERENCES assessment_results(school_id,assessment_id,id,learner_id,person_id);
-- An enrolled learner missing one selected component is truthfully incomplete;
-- its retained source points to the publication, not a fabricated result row.
ALTER TABLE assessment_publications ADD UNIQUE(school_id,id,assessment_id);
ALTER TABLE grading_report_assessment_sources ADD FOREIGN KEY(school_id,publication_id,assessment_id)
  REFERENCES assessment_publications(school_id,id,assessment_id);

CREATE FUNCTION academic_learner_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE linked_person uuid; source_context text; source_offering uuid; parent_record record;
BEGIN
  IF NEW.student_id IS NOT NULL THEN
    SELECT person_id INTO linked_person FROM students WHERE school_id=NEW.school_id AND id=NEW.student_id;
    IF linked_person IS NULL THEN RAISE EXCEPTION 'Academic learner has no canonical campus person'; END IF;
    NEW.learner_id:=COALESCE(NEW.learner_id,NEW.student_id);NEW.person_id:=COALESCE(NEW.person_id,linked_person);
    IF NEW.learner_id<>NEW.student_id OR NEW.person_id<>linked_person THEN RAISE EXCEPTION 'Academic student and person identity differ'; END IF;
  ELSIF NEW.learner_id IS NULL OR NEW.person_id IS NULL OR NEW.learner_id<>NEW.person_id THEN
    RAISE EXCEPTION 'Offering evidence requires its exact canonical person learner';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.school_id,OLD.learner_id,OLD.person_id,OLD.student_id)
    IS DISTINCT FROM (NEW.school_id,NEW.learner_id,NEW.person_id,NEW.student_id)
    THEN RAISE EXCEPTION 'Recorded academic learner identity is immutable'; END IF;
  IF TG_TABLE_NAME='assessment_results' THEN
    SELECT context_kind,offering_id INTO source_context,source_offering FROM assessments WHERE school_id=NEW.school_id AND id=NEW.assessment_id;
    IF source_context='class_term' AND NEW.student_id IS NULL OR source_context='learning_offering' AND NEW.student_id IS NOT NULL
      THEN RAISE EXCEPTION 'Academic evidence identity does not match its owning assessment'; END IF;
    IF TG_OP='INSERT' AND source_context='learning_offering' AND NOT EXISTS(
      SELECT 1 FROM learning_offering_enrollments e WHERE e.school_id=NEW.school_id AND e.offering_id=source_offering AND e.person_id=NEW.person_id
        AND e.id::text=NEW.academic_roster_source->>'enrollment_id' AND e.revision=(NEW.academic_roster_source->>'enrollment_revision')::integer
        AND NEW.academic_roster_source->>'kind'='learning_offering' AND e.starts_on<=(NEW.academic_roster_source->>'as_of')::date
        AND(e.ends_on IS NULL OR e.ends_on>(NEW.academic_roster_source->>'as_of')::date))
      THEN RAISE EXCEPTION 'Offering marks require an exact dated enrollment source'; END IF;
  ELSIF TG_TABLE_NAME='grading_report_students' THEN
    SELECT s.context_kind INTO source_context FROM grading_report_batches b JOIN grading_schemes s ON s.id=b.scheme_id AND s.school_id=b.school_id
      WHERE b.school_id=NEW.school_id AND b.id=NEW.batch_id;
    IF source_context='class_term' AND NEW.student_id IS NULL OR source_context='learning_offering' AND NEW.student_id IS NOT NULL
      THEN RAISE EXCEPTION 'Report learner identity does not match its owning scheme'; END IF;
  ELSIF TG_TABLE_NAME='grading_report_assessment_sources' THEN
    SELECT learner.learner_id,learner.person_id,learner.student_id INTO parent_record
      FROM grading_report_components component
      JOIN grading_report_subjects subject ON subject.school_id=component.school_id AND subject.batch_id=component.batch_id AND subject.id=component.report_subject_id
      JOIN grading_report_students learner ON learner.school_id=subject.school_id AND learner.batch_id=subject.batch_id AND learner.id=subject.report_student_id
      WHERE component.school_id=NEW.school_id AND component.batch_id=NEW.batch_id AND component.id=NEW.report_component_id;
    IF NOT FOUND OR (NEW.learner_id,NEW.person_id,NEW.student_id) IS DISTINCT FROM (parent_record.learner_id,parent_record.person_id,parent_record.student_id)
      THEN RAISE EXCEPTION 'Report component source must retain its exact owning learner'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['assessment_results','assessment_result_revisions','assessment_evidence','assessment_publication_results',
    'grading_report_students','grading_report_assessment_sources'] LOOP
    EXECUTE format('CREATE TRIGGER academic_learner_identity BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION academic_learner_identity_guard()',name);
  END LOOP;
END $$;

ALTER TABLE learning_offering_academic_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_scheme_offerings ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE item text; restricted text; app_owner text; fn regprocedure; BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='learning_offerings'::regclass;
  FOREACH item IN ARRAY ARRAY['learning_offering_academic_contexts','grading_scheme_offerings'] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);EXECUTE format('ALTER TABLE %I OWNER TO %I',item,app_owner);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted)
      THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,restricted); END IF; END LOOP;
  END LOOP;
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('learning_offering_academic_scope_guard','assessment_learning_context_guard','academic_learner_identity_guard') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',fn,app_owner);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted)
      THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,restricted); END IF; END LOOP;
  END LOOP;
END $$;

-- Extend the exact existing Learning event validator; retain assignment handover checks.
CREATE OR REPLACE FUNCTION validate_learning_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.payload ? 'assignment_id' AND NEW.payload ? 'offering_id' THEN RAISE EXCEPTION 'Learning event must identify one owning source'; END IF;
  IF NEW.event_type LIKE 'learning.offering.%' OR NEW.event_type='diary.updated' AND NEW.payload ? 'offering_id' AND NOT NEW.payload ? 'assignment_id' THEN
    IF NEW.payload ? 'assignment_id' OR NEW.event_type NOT IN ('learning.offering.created','learning.offering.enrolled','learning.offering.enrollment_ended','learning.offering.instructor_ended','learning.offering.instructor_appointed','learning.offering.academic_configured','learning.offering.elective_transferred','learning.offering.elective_received','diary.updated')
      OR NEW.aggregate_type<>'learning_offering' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'offering_id'
      OR NOT EXISTS(SELECT 1 FROM learning_offerings o WHERE o.school_id=NEW.school_id AND o.id=NEW.aggregate_id)
    THEN RAISE EXCEPTION 'Offering event does not match its source'; END IF;
  ELSIF NEW.event_type LIKE 'learning.assignment.%' OR NEW.event_type='diary.updated' AND NEW.payload ? 'assignment_id' THEN
    IF NEW.event_type NOT IN ('learning.assignment.draft_saved','learning.assignment.published','learning.assignment.submitted','learning.assignment.changes_requested','learning.assignment.reviewed','learning.assignment.review_handover','learning.assignment.reviewer_reassigned','diary.updated')
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
    IF NEW.event_type IN ('learning.assignment.review_handover','learning.assignment.reviewer_reassigned') AND NOT EXISTS(
      SELECT 1 FROM learning_assignment_review_handovers h JOIN learning_assignments a ON a.school_id=h.school_id AND a.id=h.assignment_id
      WHERE h.school_id=NEW.school_id AND h.assignment_id::text=NEW.payload->>'assignment_id'
        AND h.source_revision::text=NEW.payload->>'revision' AND a.revision=h.source_revision AND a.reviewer_id=h.reviewer_id
        AND(NEW.event_type='learning.assignment.reviewer_reassigned' OR h.id::text=NEW.payload->>'handover_id'))
    THEN RAISE EXCEPTION 'Assignment handover event does not match its retained responsibility transition'; END IF;
    IF NEW.event_type='diary.updated' AND(NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id')
      OR NEW.event_type<>'diary.updated' AND NEW.payload ? 'attempt_id' AND(NEW.aggregate_type<>'learning_assignment_attempt' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'attempt_id')
      OR NEW.event_type<>'diary.updated' AND NOT NEW.payload ? 'attempt_id' AND(NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id')
    THEN RAISE EXCEPTION 'Assignment event aggregate does not match its source'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION grading_course_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE owner_scheme grading_schemes%ROWTYPE; binding learning_offering_academic_contexts%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Course report mappings retain their history'; END IF;
  SELECT * INTO owner_scheme FROM grading_schemes WHERE school_id=NEW.school_id AND id=NEW.scheme_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report scheme is outside this institution'; END IF;
  IF TG_TABLE_NAME='grading_scheme_offerings' THEN
    IF owner_scheme.context_kind<>'learning_offering' OR owner_scheme.status<>'draft' THEN RAISE EXCEPTION 'Only draft course reports accept course mappings'; END IF;
    SELECT * INTO binding FROM learning_offering_academic_contexts WHERE school_id=NEW.school_id AND offering_id=NEW.offering_id;
    IF NOT FOUND OR binding.term_id<>owner_scheme.term_id OR(binding.programme_key IS NOT NULL AND owner_scheme.programme_key IS NOT NULL AND binding.programme_key<>owner_scheme.programme_key)
      THEN RAISE EXCEPTION 'Report course and term or programme differ'; END IF;
  ELSIF owner_scheme.context_kind='learning_offering' THEN
    SELECT context.* INTO binding FROM learning_offering_academic_contexts context JOIN grading_scheme_offerings selected
      ON selected.school_id=context.school_id AND selected.offering_id=context.offering_id
      WHERE selected.school_id=NEW.school_id AND selected.scheme_id=NEW.scheme_id AND selected.offering_id=NEW.offering_id;
    IF NOT FOUND OR (binding.subject_id,binding.term_id,binding.course_code,binding.credits) IS DISTINCT FROM (NEW.subject_id,owner_scheme.term_id,NEW.course_code,NEW.credits)
      THEN RAISE EXCEPTION 'Report subject must use its exact selected course context'; END IF;
  ELSIF NEW.offering_id IS NOT NULL THEN RAISE EXCEPTION 'Class subject plans do not use an offering'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grading_scheme_course_scope BEFORE INSERT OR UPDATE OR DELETE ON grading_scheme_offerings FOR EACH ROW EXECUTE FUNCTION grading_course_scope_guard();
CREATE TRIGGER grading_subject_course_scope BEFORE INSERT OR UPDATE ON grading_scheme_subjects FOR EACH ROW EXECUTE FUNCTION grading_course_scope_guard();

-- Offering refresh signals use the same current canonical identity as the API.
-- The legacy branch remains the unchanged owner for class/student workflows.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_offering_academics;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE
 WHEN event_name='assessment.updated' AND EXISTS(SELECT 1 FROM assessments a WHERE a.school_id=event_school_id AND a.id::text=event_payload->>'assessment_id' AND a.context_kind='learning_offering') THEN EXISTS(
   SELECT 1 FROM assessments a JOIN schools school ON school.id=a.school_id
   JOIN LATERAL campus_model_current_account_endpoints(event_school_id,candidate_user_id,now()) actor ON actor.school_id=a.school_id
   JOIN school_memberships member ON member.school_id=actor.school_id AND member.user_id=actor.user_id AND member.is_active
   WHERE a.school_id=event_school_id AND a.id::text=event_payload->>'assessment_id' AND a.context_kind='learning_offering'
     AND (member.role='admin' OR(member.role='staff' AND EXISTS(SELECT 1 FROM assessment_staff_assignments staff WHERE staff.school_id=a.school_id AND staff.assessment_id=a.id AND staff.user_id=candidate_user_id) AND staff_has_resource_permission(event_school_id,candidate_user_id,'assessments.view','assessment',a.id))
       OR(event_payload->>'action' IN('schedule','cancel') AND EXISTS(SELECT 1 FROM learning_offering_enrollments enrollment WHERE enrollment.school_id=a.school_id AND enrollment.offering_id=a.offering_id AND enrollment.person_id=actor.person_id
         AND enrollment.starts_on<=(a.scheduled_at AT TIME ZONE school.timezone)::date AND(enrollment.ends_on IS NULL OR enrollment.ends_on>(a.scheduled_at AT TIME ZONE school.timezone)::date)))
       OR(event_payload->>'action'='publish' AND a.status='published' AND EXISTS(SELECT 1 FROM assessment_publications publication JOIN assessment_publication_results result
         ON result.school_id=publication.school_id AND result.publication_id=publication.id WHERE publication.school_id=a.school_id AND publication.assessment_id=a.id AND result.person_id=actor.person_id))))
 WHEN event_name='academic_report.updated' AND EXISTS(SELECT 1 FROM grading_report_batches b JOIN grading_schemes s ON s.school_id=b.school_id AND s.id=b.scheme_id WHERE b.school_id=event_school_id AND b.id::text=event_payload->>'report_batch_id' AND s.context_kind='learning_offering') THEN EXISTS(
   SELECT 1 FROM grading_report_batches b JOIN grading_schemes s ON s.school_id=b.school_id AND s.id=b.scheme_id
   JOIN LATERAL campus_model_current_account_endpoints(event_school_id,candidate_user_id,now()) actor ON actor.school_id=b.school_id
   JOIN school_memberships member ON member.school_id=actor.school_id AND member.user_id=actor.user_id AND member.is_active
   WHERE b.school_id=event_school_id AND b.id::text=event_payload->>'report_batch_id' AND s.context_kind='learning_offering'
     AND(member.role='admin' OR(event_payload->>'action'='publish' AND b.status='published' AND EXISTS(SELECT 1 FROM grading_report_students learner WHERE learner.school_id=b.school_id AND learner.batch_id=b.id AND learner.person_id=actor.person_id))))
 ELSE event_user_is_authorized_before_offering_academics(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION grading_course_scope_guard(),event_user_is_authorized(uuid,text,jsonb,uuid),event_user_is_authorized_before_offering_academics(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name name;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='grading_schemes'::regclass;
 EXECUTE format('ALTER FUNCTION grading_course_scope_guard() OWNER TO %I',owner_name);
 EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;

-- Canonical self/history reads and offering-local scheduling must not scan the
-- whole institution as terms accumulate. These new lookup columns have no
-- useful leading index in the retained student/class indexes.
CREATE INDEX assessment_result_person_history ON assessment_results(school_id,person_id,assessment_id);
CREATE INDEX assessment_publication_person_history ON assessment_publication_results(school_id,person_id,publication_id);
CREATE INDEX grading_report_person_history ON grading_report_students(school_id,person_id,batch_id);
CREATE INDEX grading_scheme_offering_lookup ON grading_scheme_offerings(school_id,offering_id,scheme_id);
CREATE INDEX schedule_offering_version_lookup ON schedule_versions(school_id,offering_id,starts_on) WHERE offering_id IS NOT NULL;
CREATE INDEX schedule_offering_occurrence_lookup ON schedule_activity_occurrences(school_id,offering_id,local_date) WHERE offering_id IS NOT NULL;
