-- Retain the original class candidate and archived attendance contracts.
-- Course candidates freeze the exact dated canonical-person enrollment.
ALTER TABLE assessment_sitting_candidates
  ALTER COLUMN student_id DROP NOT NULL, ALTER COLUMN enrollment_id DROP NOT NULL,
  ADD COLUMN person_id uuid, ADD COLUMN offering_id uuid, ADD COLUMN offering_enrollment_id uuid,
  ADD COLUMN offering_enrollment_revision integer, ADD COLUMN roster_on date,
  ADD UNIQUE(school_id,id,sitting_id),
  ADD UNIQUE(sitting_id,person_id),
  ADD FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  ADD FOREIGN KEY(school_id,offering_id,offering_enrollment_id) REFERENCES learning_offering_enrollments(school_id,offering_id,id),
  ADD CONSTRAINT exam_candidate_academic_identity CHECK(
    (student_id IS NOT NULL AND enrollment_id IS NOT NULL AND person_id IS NULL AND offering_id IS NULL
      AND offering_enrollment_id IS NULL AND offering_enrollment_revision IS NULL AND roster_on IS NULL)
    OR (student_id IS NULL AND enrollment_id IS NULL AND roll_number_snapshot IS NULL AND person_id IS NOT NULL
      AND offering_id IS NOT NULL AND offering_enrollment_id IS NOT NULL AND offering_enrollment_revision IS NOT NULL
      AND offering_enrollment_revision>0 AND roster_on IS NOT NULL)
  );

CREATE INDEX exam_candidate_assessment_person ON assessment_sitting_candidates(school_id,assessment_id,person_id);

CREATE FUNCTION guard_exam_candidate_academic_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.offering_id IS NOT NULL OR NEW.offering_id IS NOT NULL) AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'A frozen course candidate retains its original enrollment evidence' USING ERRCODE='23514';
  END IF;
  IF NEW.offering_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM assessments a JOIN assessment_sittings sitting
      ON sitting.school_id=a.school_id AND sitting.assessment_id=a.id AND sitting.id=NEW.sitting_id
    JOIN schools school ON school.id=a.school_id
    JOIN learning_offering_enrollments enrollment ON enrollment.school_id=a.school_id AND enrollment.offering_id=a.offering_id
    WHERE a.school_id=NEW.school_id AND a.id=NEW.assessment_id AND a.offering_id=NEW.offering_id
      AND a.assessment_kind IN ('exam','practical','viva')
      AND NEW.roster_on=(sitting.starts_at AT TIME ZONE school.timezone)::date
      AND enrollment.id=NEW.offering_enrollment_id AND enrollment.person_id=NEW.person_id
      AND enrollment.revision=NEW.offering_enrollment_revision AND enrollment.starts_on<=NEW.roster_on
      AND (enrollment.ends_on IS NULL OR enrollment.ends_on>NEW.roster_on)
  ) THEN
    RAISE EXCEPTION 'A course candidate requires its exact dated sitting enrollment' USING ERRCODE='23514';
  END IF;
  IF NEW.student_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM assessments a WHERE a.school_id=NEW.school_id AND a.id=NEW.assessment_id AND a.offering_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A course sitting requires canonical person candidates' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exam_candidate_academic_source BEFORE INSERT OR UPDATE ON assessment_sitting_candidates
  FOR EACH ROW EXECUTE FUNCTION guard_exam_candidate_academic_source();

CREATE FUNCTION offering_exam_roster_source(candidate assessment_sitting_candidates) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT jsonb_build_object('schema_version',2,'kind','physical_offering_candidate','offering_id',candidate.offering_id,
    'person_id',candidate.person_id,'enrollment_id',candidate.offering_enrollment_id,'enrollment_revision',candidate.offering_enrollment_revision,
    'as_of',candidate.roster_on,'candidate_id',candidate.id,'sitting_id',candidate.sitting_id)
$$;

ALTER TABLE assessment_sitting_incidents DROP CONSTRAINT assessment_sitting_incidents_check,
  ADD CHECK(student_id IS NULL OR candidate_id IS NOT NULL),
  ADD FOREIGN KEY(school_id,candidate_id,sitting_id) REFERENCES assessment_sitting_candidates(school_id,id,sitting_id) ON DELETE RESTRICT;

CREATE OR REPLACE VIEW assessment_candidate_attendance AS
SELECT original.* FROM assessment_candidate_attendance_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_source_contexts link WHERE link.school_id=original.school_id
  AND link.source_kind='examination' AND link.source_id=original.sitting_id::text AND link.state='active')
UNION ALL
SELECT COALESCE(entry.id,candidate.id),candidate.school_id,candidate.sitting_id,candidate.id,candidate.student_id,
  COALESCE(entry.status,'unrecorded'),entry.observed_at,COALESCE(entry.remarks,''),COALESCE(entry.revision,1),
  entry.recorded_by,COALESCE(entry.updated_at,candidate.frozen_at)
FROM assessment_sitting_candidates candidate
JOIN activity_attendance_source_contexts link ON link.school_id=candidate.school_id AND link.source_kind='examination'
  AND link.source_id=candidate.sitting_id::text AND link.state='active'
JOIN activity_attendance_roster person ON person.register_id=link.register_id AND person.school_id=candidate.school_id
  AND (person.academic_student_id=candidate.student_id OR
    (candidate.person_id IS NOT NULL AND person.person_id=candidate.person_id AND person.source_ref=candidate.id::text))
LEFT JOIN activity_attendance_entries entry ON entry.register_id=link.register_id AND entry.person_id=person.person_id;

CREATE OR REPLACE FUNCTION assessment_learning_context_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.context_kind,NEW.class_section_id,NEW.offering_id,NEW.subject_id,NEW.cycle_id)
    IS DISTINCT FROM (OLD.context_kind,OLD.class_section_id,OLD.offering_id,OLD.subject_id,OLD.cycle_id)
    THEN RAISE EXCEPTION 'An assessment retains its exact academic context'; END IF;
  IF NEW.context_kind='learning_offering' AND NOT EXISTS(
    SELECT 1 FROM learning_offering_academic_contexts binding JOIN assessment_cycles cycle ON cycle.school_id=binding.school_id AND cycle.term_id=binding.term_id
    WHERE binding.school_id=NEW.school_id AND binding.offering_id=NEW.offering_id AND binding.subject_id=NEW.subject_id AND cycle.id=NEW.cycle_id)
    THEN RAISE EXCEPTION 'Offering assessment term and subject do not match its course'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION academic_learner_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
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
      SELECT 1 FROM assessment_sitting_candidates candidate
      JOIN assessment_sittings sitting ON sitting.school_id=candidate.school_id AND sitting.id=candidate.sitting_id
      WHERE candidate.school_id=NEW.school_id AND candidate.assessment_id=NEW.assessment_id
        AND candidate.offering_id=source_offering AND candidate.person_id=NEW.person_id AND sitting.state='completed'
        AND NEW.academic_roster_source=offering_exam_roster_source(candidate)
      UNION ALL
      SELECT 1 FROM learning_offering_enrollments e WHERE e.school_id=NEW.school_id AND e.offering_id=source_offering AND e.person_id=NEW.person_id
        AND e.id::text=NEW.academic_roster_source->>'enrollment_id' AND e.revision=(NEW.academic_roster_source->>'enrollment_revision')::integer
        AND EXISTS(SELECT 1 FROM assessments a WHERE a.school_id=NEW.school_id AND a.id=NEW.assessment_id
          AND a.assessment_kind NOT IN ('exam','practical','viva'))
        AND NEW.academic_roster_source->>'kind'='learning_offering' AND e.starts_on<=(NEW.academic_roster_source->>'as_of')::date
        AND(e.ends_on IS NULL OR e.ends_on>(NEW.academic_roster_source->>'as_of')::date))
      THEN RAISE EXCEPTION 'Offering marks require exact dated enrollment or completed sitting evidence'; END IF;
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

CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE
 WHEN event_name='assessment.updated' AND EXISTS(SELECT 1 FROM assessments a WHERE a.school_id=event_school_id AND a.id::text=event_payload->>'assessment_id' AND a.context_kind='learning_offering') THEN EXISTS(
   SELECT 1 FROM assessments a JOIN schools school ON school.id=a.school_id
   JOIN LATERAL campus_model_current_account_endpoints(event_school_id,candidate_user_id,now()) actor ON actor.school_id=a.school_id
   JOIN school_memberships member ON member.school_id=actor.school_id AND member.user_id=actor.user_id AND member.is_active
   WHERE a.school_id=event_school_id AND a.id::text=event_payload->>'assessment_id' AND a.context_kind='learning_offering'
     AND (member.role='admin' OR(member.role='staff' AND EXISTS(SELECT 1 FROM assessment_staff_assignments staff WHERE staff.school_id=a.school_id AND staff.assessment_id=a.id AND staff.user_id=candidate_user_id) AND staff_has_resource_permission(event_school_id,candidate_user_id,'assessments.view','assessment',a.id))
       OR EXISTS(SELECT 1 FROM assessment_sitting_invigilators assignment
         WHERE assignment.school_id=a.school_id AND assignment.assessment_id=a.id AND assignment.user_id=candidate_user_id
           AND assignment.status IN ('offered','accepted') AND member.role IN ('staff','admin'))
       OR(event_payload->>'action' IN('schedule','cancel') AND EXISTS(SELECT 1 FROM assessment_sitting_candidates candidate
         WHERE candidate.school_id=a.school_id AND candidate.assessment_id=a.id AND candidate.person_id=actor.person_id))
       OR(a.assessment_kind NOT IN ('exam','practical','viva') AND event_payload->>'action' IN('schedule','cancel') AND EXISTS(SELECT 1 FROM learning_offering_enrollments enrollment WHERE enrollment.school_id=a.school_id AND enrollment.offering_id=a.offering_id AND enrollment.person_id=actor.person_id
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
