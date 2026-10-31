-- Assignment events retain a routing audience, but replay always checks current source access.
CREATE FUNCTION learning_assignment_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM learning_assignments assignment JOIN schools school ON school.id=assignment.school_id
    JOIN school_memberships member ON member.school_id=assignment.school_id AND member.user_id=candidate_user_id AND member.is_active
    JOIN users account ON account.id=member.user_id AND account.is_active
    WHERE assignment.school_id=event_school_id AND assignment.id::text=event_payload->>'assignment_id'
      AND campus_model_account_person_is_active(event_school_id,candidate_user_id,NULL,now())
      AND (NOT event_payload ? 'student_id' OR EXISTS(SELECT 1 FROM learning_assignment_audience audience
        WHERE audience.school_id=assignment.school_id AND audience.assignment_id=assignment.id AND audience.student_id::text=event_payload->>'student_id'))
      AND (NOT event_payload ? 'attempt_id' OR EXISTS(
        SELECT 1 FROM learning_assignment_attempts attempt WHERE attempt.school_id=assignment.school_id
          AND attempt.assignment_id=assignment.id AND attempt.id::text=event_payload->>'attempt_id'
          AND attempt.student_id::text=event_payload->>'student_id'))
      AND (
        -- Private attempt details go only to the appointed reviewer, not every class teacher/administrator.
        ((assignment.reviewer_id=candidate_user_id AND assignment.state='published'
          OR assignment.author_id=candidate_user_id AND NOT event_payload ? 'student_id')
          AND EXISTS(SELECT 1 FROM staff_role_bindings binding JOIN staff_profiles staff
            ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id AND staff.status='active'
            WHERE binding.school_id=assignment.school_id AND binding.user_id=candidate_user_id
              AND binding.context_kind='class' AND binding.scope_id=assignment.class_section_id
              AND binding.role_active AND binding.status='active' AND 'learning.assignments.manage'=ANY(binding.permissions)
              AND (binding.subject_id IS NULL OR binding.subject_id=assignment.subject_id)
              AND (now() AT TIME ZONE school.timezone)::date>=binding.starts_on
              AND (binding.ends_on IS NULL OR (now() AT TIME ZONE school.timezone)::date<=binding.ends_on)
              AND campus_model_account_person_is_active(event_school_id,candidate_user_id,staff.person_id,now())))
        OR (assignment.state='published' AND EXISTS(
          SELECT 1 FROM learning_assignment_audience audience JOIN students student
            ON student.id=audience.student_id AND student.school_id=audience.school_id
          WHERE audience.school_id=assignment.school_id AND audience.assignment_id=assignment.id
            AND (NOT event_payload ? 'student_id' OR student.id::text=event_payload->>'student_id')
            AND (
              member.role='student' AND student.user_id=candidate_user_id
                AND campus_model_account_person_is_active(event_school_id,candidate_user_id,student.person_id,now())
              OR member.role='guardian' AND EXISTS(
                SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
                JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=parent.id
                WHERE relationship.school_id=assignment.school_id AND relationship.student_id=student.id
                  AND parent.user_id=candidate_user_id
                  AND campus_model_account_person_is_active(event_school_id,candidate_user_id,profile.person_id,now()))
            )
        ))
      )
  )
$$;
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_assignments;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name LIKE 'learning.assignment.%' THEN event_name IN ('learning.assignment.draft_saved','learning.assignment.published',
      'learning.assignment.submitted','learning.assignment.changes_requested','learning.assignment.reviewed')
      AND learning_assignment_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    WHEN event_name='diary.updated' AND event_payload ? 'assignment_id' THEN learning_assignment_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE event_user_is_authorized_before_assignments(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
CREATE FUNCTION validate_assignment_event_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.event_type='diary.updated' AND NEW.payload ? 'assignment_id' OR NEW.event_type LIKE 'learning.assignment.%' THEN
    IF NEW.event_type LIKE 'learning.assignment.%' AND NEW.event_type NOT IN ('learning.assignment.draft_saved','learning.assignment.published',
      'learning.assignment.submitted','learning.assignment.changes_requested','learning.assignment.reviewed') THEN
      RAISE EXCEPTION 'Unknown assignment event schema' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM learning_assignments assignment WHERE assignment.school_id=NEW.school_id
      AND assignment.id::text=NEW.payload->>'assignment_id') THEN
      RAISE EXCEPTION 'Assignment event does not match its source' USING ERRCODE='23514';
    END IF;
    IF NEW.payload ? 'student_id' AND NOT EXISTS(SELECT 1 FROM learning_assignment_audience audience
      WHERE audience.school_id=NEW.school_id AND audience.assignment_id::text=NEW.payload->>'assignment_id'
        AND audience.student_id::text=NEW.payload->>'student_id') THEN
      RAISE EXCEPTION 'Assignment event learner is outside its source' USING ERRCODE='23514';
    END IF;
    IF NEW.event_type='diary.updated' THEN
      IF NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id' THEN
        RAISE EXCEPTION 'Assignment refresh does not match its source' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.payload ? 'attempt_id' THEN
      IF NEW.aggregate_type<>'learning_assignment_attempt' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'attempt_id'
        OR NOT EXISTS(SELECT 1 FROM learning_assignment_attempts attempt WHERE attempt.school_id=NEW.school_id
          AND attempt.id=NEW.aggregate_id AND attempt.assignment_id::text=NEW.payload->>'assignment_id'
          AND attempt.student_id::text=NEW.payload->>'student_id') THEN
        RAISE EXCEPTION 'Assignment attempt event does not match its source' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.aggregate_type<>'learning_assignment' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'assignment_id' THEN
      RAISE EXCEPTION 'Assignment event does not match its source' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_event_source_scope BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION validate_assignment_event_source();
REVOKE ALL ON FUNCTION learning_assignment_event_is_authorized(uuid,jsonb,uuid),event_user_is_authorized(uuid,text,jsonb,uuid),validate_assignment_event_source() FROM PUBLIC;
DO $$ DECLARE app_owner text; restricted_role text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='learning_assignments'::regclass;
  EXECUTE format('ALTER FUNCTION learning_assignment_event_is_authorized(uuid,jsonb,uuid) OWNER TO %I',app_owner);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',app_owner);
  EXECUTE format('ALTER FUNCTION validate_assignment_event_source() OWNER TO %I',app_owner);
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION learning_assignment_event_is_authorized(uuid,jsonb,uuid),event_user_is_authorized(uuid,text,jsonb,uuid),validate_assignment_event_source() FROM %I',restricted_role);
    END IF;
  END LOOP;
END $$;
