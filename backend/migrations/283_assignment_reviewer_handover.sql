-- Explicit assignment-review responsibility changes; submitted content and original signatures remain immutable.
CREATE TABLE learning_assignment_review_handovers (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, assignment_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>1), previous_revision integer NOT NULL CHECK(previous_revision>0 AND source_revision=previous_revision+1),
  previous_reviewer_id uuid NOT NULL REFERENCES users(id), previous_reviewer_person_id uuid,
  reviewer_id uuid NOT NULL REFERENCES users(id), reviewer_person_id uuid,
  review_route_version_id uuid NOT NULL, review_subscription_id uuid NOT NULL,
  command_id uuid NOT NULL REFERENCES campus_model_commands(id), assigned_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), created_at timestamptz NOT NULL,
  CHECK(previous_reviewer_id<>reviewer_id), UNIQUE(school_id,assignment_id,source_revision), UNIQUE(school_id,assignment_id,id), UNIQUE(school_id,assignment_id,id,source_revision),
  FOREIGN KEY(school_id,assignment_id) REFERENCES learning_assignments(school_id,id),
  FOREIGN KEY(school_id,previous_reviewer_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id)
);
CREATE TABLE learning_assignment_handover_messages (
  school_id uuid NOT NULL, assignment_id uuid NOT NULL, handover_id uuid NOT NULL, attempt_id uuid NOT NULL, learner_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('review','revision')), source_revision integer NOT NULL CHECK(source_revision>1),
  previous_message_id uuid, message_id uuid NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(school_id,handover_id,attempt_id,kind),
  FOREIGN KEY(school_id,assignment_id,handover_id,source_revision) REFERENCES learning_assignment_review_handovers(school_id,assignment_id,id,source_revision),
  FOREIGN KEY(school_id,assignment_id,learner_id,attempt_id) REFERENCES learning_assignment_attempts(school_id,assignment_id,learner_id,id)
);
CREATE INDEX learning_assignment_handover_current ON learning_assignment_handover_messages(school_id,assignment_id,attempt_id,kind,source_revision DESC);
CREATE TRIGGER learning_assignment_review_handover_immutable BEFORE UPDATE OR DELETE ON learning_assignment_review_handovers
  FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER learning_assignment_handover_message_immutable BEFORE UPDATE OR DELETE ON learning_assignment_handover_messages
  FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
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
    IF TG_OP='UPDATE' AND OLD.state='published' THEN
      IF (to_jsonb(NEW)-ARRAY['reviewer_id','reviewer_person_id','review_route_version_id','review_subscription_id','revision','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reviewer_id','reviewer_person_id','review_route_version_id','review_subscription_id','revision','updated_at'])
        OR NEW.revision<>OLD.revision+1 OR NEW.reviewer_id=OLD.reviewer_id
        OR NOT EXISTS(SELECT 1 FROM learning_assignment_review_handovers h WHERE h.school_id=OLD.school_id AND h.assignment_id=OLD.id
          AND h.source_revision=NEW.revision AND h.previous_revision=OLD.revision AND h.previous_reviewer_id=OLD.reviewer_id
          AND h.previous_reviewer_person_id IS NOT DISTINCT FROM OLD.reviewer_person_id AND h.reviewer_id=NEW.reviewer_id
          AND h.reviewer_person_id IS NOT DISTINCT FROM NEW.reviewer_person_id AND h.review_route_version_id=NEW.review_route_version_id
          AND h.review_subscription_id=NEW.review_subscription_id AND h.created_at=NEW.updated_at)
      THEN RAISE EXCEPTION 'Published instructions are immutable; reviewer changes require the exact retained handover'; END IF;
    END IF;
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

DO $$ DECLARE item text; role_name text; owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='learning_assignments'::regclass;
  FOREACH item IN ARRAY ARRAY['learning_assignment_review_handovers','learning_assignment_handover_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',item);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',item,role_name); END IF;
    END LOOP;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,owner_name);
  END LOOP;
END $$;

-- Version the two new event schemas without broadening historical source/learner checks.
CREATE OR REPLACE FUNCTION validate_learning_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.payload ? 'assignment_id' AND NEW.payload ? 'offering_id' THEN RAISE EXCEPTION 'Learning event must identify one owning source'; END IF;
  IF NEW.event_type LIKE 'learning.offering.%' OR NEW.event_type='diary.updated' AND NEW.payload ? 'offering_id' AND NOT NEW.payload ? 'assignment_id' THEN
    IF NEW.payload ? 'assignment_id' OR NEW.event_type NOT IN ('learning.offering.created','learning.offering.enrolled','learning.offering.enrollment_ended','learning.offering.instructor_ended','learning.offering.instructor_appointed','diary.updated')
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

-- Responsibility provenance must commit with the exact accepted owning command.
CREATE FUNCTION learning_assignment_handover_command_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      AND outcome.realm_id=command.realm_id AND outcome.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
      AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_current_account_endpoints(NEW.school_id,NEW.assigned_by,NEW.created_at) actor ON actor.agent_id=command.actor_agent_id AND actor.school_id=command.school_id
    WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='learning_assignments'
      AND command.handler_key='learning.assignments' AND command.handler_version=1 AND command.command_type='learning.assignment.reviewer.handover'
      AND command.expected_revision=NEW.previous_revision AND command.state='accepted' AND outcome.status='accepted' AND outcome.resulting_revision=NEW.source_revision
      AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
      AND target.domain='learning_assignments' AND target.domain_id=NEW.assignment_id::text AND actor.user_id=NEW.assigned_by
      AND outcome.metadata->>'id'=NEW.assignment_id::text AND outcome.metadata->>'handover_id'=NEW.id::text
      AND outcome.metadata->>'reviewer_id'=NEW.reviewer_id::text)
  THEN RAISE EXCEPTION 'An assignment handover requires its exact accepted owning command' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER learning_assignment_handover_command_required AFTER INSERT ON learning_assignment_review_handovers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION learning_assignment_handover_command_required();
CREATE TRIGGER learning_assignment_handover_no_truncate BEFORE TRUNCATE ON learning_assignment_review_handovers
  FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER learning_assignment_handover_message_no_truncate BEFORE TRUNCATE ON learning_assignment_handover_messages
  FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();
REVOKE ALL ON FUNCTION learning_assignment_handover_command_required() FROM PUBLIC;
DO $$ DECLARE owner_name name; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='learning_assignments'::regclass;
  EXECUTE format('ALTER FUNCTION learning_assignment_handover_command_required() OWNER TO %I',owner_name);
END $$;
