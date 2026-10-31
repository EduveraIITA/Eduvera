-- Qualify the envelope argument: the journal also owns a payload column.
CREATE OR REPLACE FUNCTION accommodation_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof($5)='object' AND EXISTS(
 SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id AND entity.domain='accommodation'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id AND event.source_domain='accommodation' AND event.source_record_id=aggregate::text AND event.source_revision=outcome.resulting_revision
 WHERE command.school_id=tenant AND command.id::text=$5->>'source_command_id' AND command.source_domain='accommodation' AND command.handler_key='accommodation.commands' AND command.state='accepted'
 AND command.safe_context->>'source_id'=aggregate::text AND entity.domain_id=aggregate::text AND outcome.resulting_revision::text=$5->>'revision' AND command.expected_revision=outcome.resulting_revision-1
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
 AND(event_name='accommodation.updated' AND aggregate_kind='accommodation_stay' AND $5=jsonb_build_object('source_id',aggregate::text,'revision',outcome.resulting_revision,'source_command_id',command.id::text,'refresh',jsonb_build_array('accommodation','workspace','attention'))
  OR event_name LIKE 'accommodation.stay.%' AND aggregate_kind='accommodation_stay_event' AND EXISTS(SELECT 1 FROM accommodation_receipts receipt WHERE receipt.school_id=tenant AND receipt.stay_id=aggregate AND receipt.command_id=command.id AND event_name='accommodation.stay.'||receipt.action AND $5=jsonb_build_object('stay_id',aggregate::text,'revision',receipt.revision,'action',receipt.action,'source_command_id',command.id::text))
  OR event_name LIKE 'accommodation.setup.%' AND aggregate_kind='accommodation_setup' AND EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=tenant AND receipt.source_id=aggregate AND receipt.command_id=command.id AND event_name='accommodation.setup.'||receipt.kind AND $5=jsonb_build_object('source_id',aggregate::text,'kind',receipt.kind,'revision',receipt.revision,'source_command_id',command.id::text)))
 AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id)
$$;
