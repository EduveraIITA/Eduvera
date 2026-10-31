-- Correct the delivery helper's local-variable collision without changing the
-- applied 198 contract, source guards, audience rules or historical evidence.
CREATE OR REPLACE FUNCTION teaching_session_event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_source_revision integer;v_action_name text;v_expected_command text;
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
  v_source_revision:=(event_payload->>'revision')::integer;v_action_name:=event_payload->>'action';
  v_expected_command:=CASE v_action_name WHEN 'lesson.prepared' THEN 'learning.session.lesson.save'
    WHEN 'lesson.reported' THEN 'learning.session.lesson.save' WHEN 'lesson.corrected' THEN 'learning.session.lesson.save'
    WHEN 'material.added' THEN 'learning.session.material.add' WHEN 'material.uploaded' THEN 'learning.session.material.upload'
    WHEN 'work.linked' THEN 'learning.session.work.link' ELSE NULL END;
  IF v_expected_command IS NULL THEN RETURN false;END IF;
  RETURN EXISTS(SELECT 1 FROM teaching_sessions AS session_source
    JOIN campus_model_commands AS owning_command ON owning_command.id::text=event_payload->>'command_id'
      AND owning_command.school_id=session_source.school_id AND owning_command.source_domain='teaching_sessions'
      AND owning_command.handler_key='learning.sessions' AND owning_command.handler_version=1
      AND owning_command.command_type=v_expected_command AND owning_command.state='accepted'
    JOIN campus_model_entities AS source_entity ON source_entity.id=owning_command.target_entity_id
      AND source_entity.school_id=session_source.school_id AND source_entity.domain='teaching_sessions'
      AND source_entity.kind='learning_work' AND source_entity.domain_id=session_source.id::text
    JOIN campus_model_command_outcomes AS accepted_outcome ON accepted_outcome.command_id=owning_command.id AND accepted_outcome.status='accepted'
    WHERE session_source.school_id=institution AND session_source.id=aggregate AND session_source.session_date::text=event_payload->>'date'
      AND session_source.revision>=v_source_revision AND accepted_outcome.metadata->>'id'=session_source.id::text
      AND accepted_outcome.metadata->>'date'=session_source.session_date::text AND accepted_outcome.metadata->>'revision'=v_source_revision::text
      AND owning_command.safe_context->>'session_id'=session_source.id::text AND owning_command.safe_context->>'date'=session_source.session_date::text
      AND(
        v_action_name='lesson.prepared' AND event_payload->>'audience_scope'='staff' AND EXISTS(SELECT 1 FROM teaching_session_revisions AS lesson_revision
          WHERE lesson_revision.school_id=session_source.school_id AND lesson_revision.session_id=session_source.id
            AND lesson_revision.command_id=owning_command.id AND lesson_revision.revision=v_source_revision AND lesson_revision.state='prepared')
        OR v_action_name IN('lesson.reported','lesson.corrected') AND event_payload->>'audience_scope'='shared'
          AND EXISTS(SELECT 1 FROM teaching_session_revisions AS lesson_revision WHERE lesson_revision.school_id=session_source.school_id
            AND lesson_revision.session_id=session_source.id AND lesson_revision.command_id=owning_command.id
            AND lesson_revision.revision=v_source_revision AND lesson_revision.state='reported')
        OR v_action_name IN('material.added','material.uploaded') AND EXISTS(SELECT 1 FROM teaching_session_materials AS material_source
          WHERE material_source.school_id=session_source.school_id AND material_source.session_id=session_source.id
            AND material_source.command_id=owning_command.id AND material_source.id::text=accepted_outcome.metadata->>'material_id'
            AND event_payload->>'audience_scope'=CASE WHEN material_source.shared THEN 'shared' ELSE 'staff' END)
        OR v_action_name='work.linked' AND event_payload->>'audience_scope'='shared' AND EXISTS(SELECT 1 FROM teaching_session_work AS linked_source
          WHERE linked_source.school_id=session_source.school_id AND linked_source.session_id=session_source.id
            AND linked_source.command_id=owning_command.id AND linked_source.id::text=accepted_outcome.metadata->>'link_id')
      ));
END $$;
-- Execute the full SQL branch, not only an early malformed-payload return. This
-- harmless absent-source probe catches name-resolution failures during migration.
DO $$ DECLARE absent_id uuid:='00000000-0000-0000-0000-000000000000';BEGIN
  IF teaching_session_event_source_is_valid(absent_id,'diary.updated','teaching_session',absent_id,
    jsonb_build_object('session_id',absent_id::text,'date','2000-01-01','revision',1,'action','lesson.prepared',
      'command_id',absent_id::text,'source_domain','teaching_sessions','audience_scope','staff',
      'refresh',jsonb_build_array('teaching-sessions','workspace'))) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'An absent teaching source must not validate';END IF;
END $$;
