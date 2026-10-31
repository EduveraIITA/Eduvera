-- Neutral refresh delivery never inherits authority from a cached audience.
-- The internal Core identity boolean is the existing environment-qualified port;
-- Teaching repeats its own current source/participant/appointment rules here.
CREATE FUNCTION teaching_session_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH source AS MATERIALIZED (
    SELECT session.id,session.school_id,session.session_date,school.timezone,
      'academic'::text AS source_kind,current_schedule.class_section_id,current_schedule.term_id,current_schedule.subject_id,
      NULL::uuid AS occurrence_id,NULL::uuid AS lead_person_id,current_schedule.teacher_user_id,
      coalesce(session.original_teacher_id,current_schedule.original_teacher_user_id,planned.teacher_user_id) AS original_teacher_id,
      current_schedule.coverage_status
    FROM teaching_sessions session JOIN schools school ON school.id=session.school_id
    CROSS JOIN LATERAL effective_school_schedule_v4(session.school_id,session.session_date) current_schedule
    LEFT JOIN LATERAL planned_school_schedule_v2(session.school_id,session.session_date) planned ON planned.occurrence_key=current_schedule.occurrence_key
    WHERE session.school_id=event_school_id AND session.id::text=event_payload->>'session_id'
      AND session.session_date::text=event_payload->>'date' AND session.source_kind='academic'
      AND current_schedule.occurrence_key=session.logical_key AND current_schedule.slot_type='class'
    UNION ALL
    SELECT session.id,session.school_id,session.session_date,school.timezone,
      'activity',occurrence.context_ref,occurrence.term_id,occurrence.subject_id,occurrence.id,lead.person_id,
      occurrence.scheduled_teacher_id,occurrence.scheduled_teacher_id,NULL::text
    FROM teaching_sessions session JOIN schools school ON school.id=session.school_id
    JOIN schedule_activity_occurrences occurrence ON occurrence.school_id=session.school_id AND occurrence.id::text=session.logical_key
      AND occurrence.local_date=session.session_date AND occurrence.source='activity' AND occurrence.purpose='teaching'
    LEFT JOIN LATERAL(SELECT person_id FROM schedule_activity_occurrence_people participant
      WHERE participant.school_id=occurrence.school_id AND participant.occurrence_id=occurrence.id AND participant.participation_role='lead'
      ORDER BY participant.label,participant.person_id LIMIT 1) lead ON true
    WHERE session.school_id=event_school_id AND session.id::text=event_payload->>'session_id'
      AND session.session_date::text=event_payload->>'date' AND session.source_kind='activity'
  )
  SELECT EXISTS(SELECT 1 FROM source
    JOIN school_memberships membership ON membership.school_id=source.school_id AND membership.user_id=candidate_user_id AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE event_payload->>'source_domain'='teaching_sessions' AND event_payload->>'audience_scope' IN('shared','staff')
      AND campus_model_account_person_is_active(source.school_id,candidate_user_id,NULL,now())
      AND(
        EXISTS(SELECT 1 FROM staff_role_bindings binding JOIN staff_profiles profile ON profile.school_id=binding.school_id
          AND profile.user_id=binding.user_id AND profile.status='active'
          WHERE binding.school_id=source.school_id AND binding.user_id=candidate_user_id AND binding.status='active' AND binding.role_active
            AND 'learning.sessions.manage'=ANY(binding.permissions)
            AND binding.starts_on<=(now() AT TIME ZONE source.timezone)::date
            AND(binding.ends_on IS NULL OR binding.ends_on>=(now() AT TIME ZONE source.timezone)::date)
            AND campus_model_account_person_is_active(source.school_id,candidate_user_id,profile.person_id,now())
            AND(binding.context_kind='institution' AND binding.scope_id=source.school_id
              OR binding.context_kind='class' AND binding.scope_id=source.class_section_id
                AND(binding.subject_id IS NULL OR binding.subject_id=source.subject_id))
            AND(source.source_kind='activity' AND source.lead_person_id=profile.person_id
              OR source.source_kind='academic' AND(
                source.teacher_user_id=candidate_user_id AND source.coverage_status IN('accepted','not_required')
                OR source.original_teacher_id=candidate_user_id AND(source.coverage_status IN('accepted','not_required')
                  OR source.original_teacher_id IS DISTINCT FROM source.teacher_user_id))))
        OR event_payload->>'audience_scope'='shared' AND(
          source.source_kind='academic' AND EXISTS(SELECT 1 FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
            AND student.school_id=source.school_id
            WHERE enrollment.class_section_id=source.class_section_id AND enrollment.term_id=source.term_id AND enrollment.is_active
              AND enrollment.enrolled_on<=source.session_date AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>source.session_date)
              AND enrollment.enrolled_on<=(now() AT TIME ZONE source.timezone)::date
              AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>(now() AT TIME ZONE source.timezone)::date)
              AND campus_model_account_person_is_active(source.school_id,candidate_user_id,student.person_id,now()))
          OR source.source_kind='activity' AND EXISTS(SELECT 1 FROM schedule_activity_occurrence_people participant
            WHERE participant.school_id=source.school_id AND participant.occurrence_id=source.occurrence_id
              AND(participant.participation_role='participant' OR participant.attendance_expected)
              AND campus_model_account_person_is_active(source.school_id,candidate_user_id,participant.person_id,now()))
        )
      )
  )
$$;

CREATE FUNCTION teaching_session_event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE source_revision integer;action_name text;expected_command text;expected_scope text;
BEGIN
  IF event_name<>'diary.updated' OR aggregate_kind<>'teaching_session' OR jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
    OR event_payload->>'source_domain' IS DISTINCT FROM 'teaching_sessions'
    OR NOT(event_payload ?& ARRAY['session_id','date','revision','action','command_id','source_domain','audience_scope','refresh'])
    OR (event_payload-ARRAY['session_id','date','revision','action','command_id','source_domain','audience_scope','refresh'])<>'{}'::jsonb
    OR aggregate::text IS DISTINCT FROM event_payload->>'session_id'
    OR jsonb_typeof(event_payload->'revision') IS DISTINCT FROM 'number'
    OR coalesce(event_payload->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(event_payload->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(event_payload->'date') IS DISTINCT FROM 'string'
    OR jsonb_typeof(event_payload->'command_id') IS DISTINCT FROM 'string'
    OR event_payload->'refresh' IS DISTINCT FROM '["teaching-sessions","workspace"]'::jsonb
    OR event_payload->>'audience_scope' NOT IN('shared','staff')
  THEN RETURN false;END IF;
  source_revision:=(event_payload->>'revision')::integer;action_name:=event_payload->>'action';
  expected_command:=CASE action_name WHEN 'lesson.prepared' THEN 'learning.session.lesson.save'
    WHEN 'lesson.reported' THEN 'learning.session.lesson.save' WHEN 'lesson.corrected' THEN 'learning.session.lesson.save'
    WHEN 'material.added' THEN 'learning.session.material.add' WHEN 'material.uploaded' THEN 'learning.session.material.upload'
    WHEN 'work.linked' THEN 'learning.session.work.link' ELSE NULL END;
  IF expected_command IS NULL THEN RETURN false;END IF;
  RETURN EXISTS(SELECT 1 FROM teaching_sessions session
    JOIN campus_model_commands command ON command.id::text=event_payload->>'command_id' AND command.school_id=session.school_id
      AND command.source_domain='teaching_sessions' AND command.handler_key='learning.sessions' AND command.handler_version=1
      AND command.command_type=expected_command AND command.state='accepted'
    JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=session.school_id
      AND entity.domain='teaching_sessions' AND entity.kind='learning_work' AND entity.domain_id=session.id::text
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
    WHERE session.school_id=institution AND session.id=aggregate AND session.session_date::text=event_payload->>'date'
      AND session.revision>=source_revision AND outcome.metadata->>'id'=session.id::text
      AND outcome.metadata->>'date'=session.session_date::text AND outcome.metadata->>'revision'=source_revision::text
      AND command.safe_context->>'session_id'=session.id::text AND command.safe_context->>'date'=session.session_date::text
      AND(
        action_name='lesson.prepared' AND event_payload->>'audience_scope'='staff' AND EXISTS(SELECT 1 FROM teaching_session_revisions revision
          WHERE revision.school_id=session.school_id AND revision.session_id=session.id AND revision.command_id=command.id AND revision.revision=source_revision AND revision.state='prepared')
        OR action_name IN('lesson.reported','lesson.corrected') AND event_payload->>'audience_scope'='shared' AND EXISTS(SELECT 1 FROM teaching_session_revisions revision
          WHERE revision.school_id=session.school_id AND revision.session_id=session.id AND revision.command_id=command.id AND revision.revision=source_revision AND revision.state='reported')
        OR action_name IN('material.added','material.uploaded') AND EXISTS(SELECT 1 FROM teaching_session_materials material
          WHERE material.school_id=session.school_id AND material.session_id=session.id AND material.command_id=command.id
            AND material.id::text=outcome.metadata->>'material_id'
            AND event_payload->>'audience_scope'=CASE WHEN material.shared THEN 'shared' ELSE 'staff' END)
        OR action_name='work.linked' AND event_payload->>'audience_scope'='shared' AND EXISTS(SELECT 1 FROM teaching_session_work linked
          WHERE linked.school_id=session.school_id AND linked.session_id=session.id AND linked.command_id=command.id
            AND linked.id::text=outcome.metadata->>'link_id')
      ));
END $$;

ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_teaching_sessions;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_payload->>'source_domain'='teaching_sessions' THEN event_name='diary.updated'
    AND teaching_session_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE event_user_is_authorized_before_teaching_sessions(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
ALTER FUNCTION event_source_is_valid(uuid,text,text,uuid,jsonb) RENAME TO event_source_is_valid_before_teaching_sessions;
CREATE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='diary.updated' AND(aggregate_kind='teaching_session' OR event_payload->>'source_domain'='teaching_sessions')
    THEN teaching_session_event_source_is_valid(institution,event_name,aggregate_kind,aggregate,event_payload)
    ELSE event_source_is_valid_before_teaching_sessions(institution,event_name,aggregate_kind,aggregate,event_payload) END
$$;
CREATE FUNCTION validate_teaching_session_refresh() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.event_type='diary.updated' AND(OLD.aggregate_type='teaching_session' OR OLD.payload->>'source_domain'='teaching_sessions') THEN
    IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,
        NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,
        OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
    THEN RAISE EXCEPTION 'Teaching refresh envelopes are immutable; publish a new source event' USING ERRCODE='23514';END IF;
    -- Delivery claim/quarantine updates retain old invalid source evidence. It
    -- remains undeliverable through the source-integrity predicate above.
    RETURN NEW;
  END IF;
  IF NEW.event_type='diary.updated' AND(NEW.aggregate_type='teaching_session' OR NEW.payload->>'source_domain'='teaching_sessions') THEN
    IF NOT coalesce(teaching_session_event_source_is_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
      OR cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
    THEN RAISE EXCEPTION 'Teaching refresh must match neutral, accepted source evidence' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_session_refresh_scope BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION validate_teaching_session_refresh();
REVOKE ALL ON FUNCTION teaching_session_event_is_authorized(uuid,jsonb,uuid),teaching_session_event_source_is_valid(uuid,text,text,uuid,jsonb),
  event_user_is_authorized(uuid,text,jsonb,uuid),event_source_is_valid(uuid,text,text,uuid,jsonb),validate_teaching_session_refresh() FROM PUBLIC;
DO $$ DECLARE owner_name text;role_name text;signature text;BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='teaching_sessions'::regclass;
  FOREACH signature IN ARRAY ARRAY['teaching_session_event_is_authorized(uuid,jsonb,uuid)','teaching_session_event_source_is_valid(uuid,text,text,uuid,jsonb)',
    'event_user_is_authorized(uuid,text,jsonb,uuid)','event_source_is_valid(uuid,text,text,uuid,jsonb)','validate_teaching_session_refresh()'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);END IF;
    END LOOP;
  END LOOP;
END $$;
