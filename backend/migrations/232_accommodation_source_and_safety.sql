-- Native source, private realtime and physical topology safety for accommodation.
CREATE OR REPLACE FUNCTION accommodation_native_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE source uuid;event_name text;
BEGIN
 IF TG_TABLE_NAME='accommodation_receipts' THEN source:=NEW.stay_id;event_name:='accommodation.stay.'||NEW.action;
 ELSE source:=NEW.source_id;event_name:='accommodation.setup.'||NEW.kind;END IF;
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.person_id=NEW.actor_person_id
  JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id AND entity.domain='accommodation' AND entity.domain_id=source::text
  WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='accommodation' AND command.handler_key='accommodation.commands' AND command.handler_version=1
   AND command.state='accepted' AND outcome.status='accepted' AND command.expected_revision=NEW.revision-1 AND outcome.resulting_revision=NEW.revision
   AND command.safe_context->>'source_id'=source::text AND event.source_domain='accommodation' AND event.source_record_id=source::text AND event.source_revision=NEW.revision AND event.event_type=event_name
   AND event.actor_agent_id=command.actor_agent_id AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'Accommodation evidence requires its exact accepted DT command and event.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE FUNCTION accommodation_actor_can_manage(tenant uuid,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
 WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND(membership.role='admin' OR membership.role='staff' AND(
  EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution' AND binding.scope_id=tenant AND binding.status='active' AND binding.role_active AND 'accommodation.manage'=ANY(binding.permissions) AND campus_permission_date(tenant) BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date))
  OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=tenant AND exception.user_id=actor AND exception.permission='accommodation.manage' AND exception.scope_kind='institution' AND exception.status='active' AND campus_permission_date(tenant) BETWEEN exception.valid_from AND exception.valid_until))))
$$;
CREATE FUNCTION accommodation_person_available(tenant uuid,person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id AND endpoint.endpoint_kind='account'
 WHERE agent.school_id=tenant AND agent.person_id=person AND campus_model_account_person_is_active(tenant,endpoint.user_id,person,now()))
$$;

CREATE FUNCTION accommodation_setup_current_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE kind_name text;valid boolean;
BEGIN
 kind_name:=CASE TG_TABLE_NAME WHEN 'accommodation_room_types' THEN 'room_type' WHEN 'accommodation_rooms' THEN 'room' ELSE 'place' END;
 IF kind_name='room_type' THEN SELECT EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.source_id=NEW.id AND receipt.kind=kind_name AND receipt.revision=NEW.revision AND receipt.name=NEW.name AND receipt.default_capacity=NEW.default_capacity AND receipt.allocation_mode=NEW.allocation_mode AND receipt.active=NEW.active AND receipt.recorded_at=NEW.updated_at) INTO valid;
 ELSIF kind_name='room' THEN SELECT EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.source_id=NEW.id AND receipt.kind=kind_name AND receipt.revision=NEW.revision AND receipt.space_id=NEW.space_id AND receipt.room_type_id=NEW.room_type_id AND receipt.sleeping_capacity=NEW.sleeping_capacity AND receipt.allocation_mode=NEW.allocation_mode AND receipt.active=NEW.active AND receipt.recorded_at=NEW.updated_at) INTO valid;
 ELSE SELECT EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.source_id=NEW.id AND receipt.kind=kind_name AND receipt.revision=NEW.revision AND receipt.name=NEW.label AND receipt.room_id=NEW.room_id AND receipt.holding_id IS NOT DISTINCT FROM NEW.holding_id AND receipt.active=NEW.active AND receipt.recorded_at=NEW.updated_at) INTO valid;END IF;
 IF NOT valid THEN RAISE EXCEPTION 'Residential setup requires its exact typed immutable revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER accommodation_type_evidence AFTER INSERT OR UPDATE ON accommodation_room_types DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_setup_current_guard();
CREATE CONSTRAINT TRIGGER accommodation_room_evidence AFTER INSERT OR UPDATE ON accommodation_rooms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_setup_current_guard();
CREATE CONSTRAINT TRIGGER accommodation_place_evidence AFTER INSERT OR UPDATE ON accommodation_places DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_setup_current_guard();
CREATE FUNCTION accommodation_setup_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT accommodation_actor_can_manage(NEW.school_id,NEW.actor_user_id) OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at)
 THEN RAISE EXCEPTION 'Residential setup needs current explicit institution authority.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER accommodation_setup_authority BEFORE INSERT ON accommodation_setup_receipts FOR EACH ROW EXECUTE FUNCTION accommodation_setup_authority_guard();

CREATE OR REPLACE FUNCTION accommodation_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accommodation retains its operating history.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.created_at)
  OR NEW.revision NOT IN(OLD.revision,OLD.revision+1) OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'Accommodation changes require the next exact revision.' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='accommodation_stays' THEN
  IF ROW(NEW.resident_person_id,NEW.room_id,NEW.place_id,NEW.recorded_by_user_id,NEW.repair_id,NEW.origin_space_id,NEW.origin_note,NEW.instructions,NEW.access_mode)
   IS DISTINCT FROM ROW(OLD.resident_person_id,OLD.room_id,OLD.place_id,OLD.recorded_by_user_id,OLD.repair_id,OLD.origin_space_id,OLD.origin_note,OLD.instructions,OLD.access_mode)
  THEN RAISE EXCEPTION 'A stay retains its original resident, physical place and offer commitment.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='accommodation_rooms' THEN
  IF NEW.space_id<>OLD.space_id THEN RAISE EXCEPTION 'A residential room retains its canonical physical identity.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='accommodation_places' THEN
  IF NEW.room_id<>OLD.room_id THEN RAISE EXCEPTION 'A named place retains its physical room.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION accommodation_receipt_authority_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE stay accommodation_stays;previous accommodation_receipts;
BEGIN
 SELECT * INTO STRICT stay FROM accommodation_stays WHERE school_id=NEW.school_id AND id=NEW.stay_id;
 SELECT * INTO previous FROM accommodation_receipts WHERE school_id=NEW.school_id AND stay_id=NEW.stay_id AND revision=NEW.revision-1;
 IF NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at) THEN RAISE EXCEPTION 'A stay action requires current canonical app access.' USING ERRCODE='23514';END IF;
 IF NEW.action='offered' THEN
  IF NEW.revision<>1 OR stay.state<>'offered' OR NOT accommodation_actor_can_manage(NEW.school_id,NEW.actor_user_id) OR NEW.actor_user_id<>stay.recorded_by_user_id THEN RAISE EXCEPTION 'A stay offer requires current explicit authority.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action IN('accepted','declined','extension_accepted','extension_declined') THEN
  IF NEW.actor_person_id<>stay.resident_person_id THEN RAISE EXCEPTION 'Only the exact resident may give an authenticated response.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action IN('moved_in','moved_out','movement_corrected') THEN
  IF NEW.actor_person_id<>previous.recorder_person_id THEN RAISE EXCEPTION 'Only the exact current recorder may record a physical move.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='reassigned' THEN
  IF NEW.actor_person_id<>previous.coordinator_person_id AND NOT(accommodation_actor_can_manage(NEW.school_id,NEW.actor_user_id) AND(NOT accommodation_person_available(NEW.school_id,previous.coordinator_person_id) OR NOT accommodation_person_available(NEW.school_id,previous.recorder_person_id))) THEN RAISE EXCEPTION 'Handover requires the current coordinator or explicit orphan recovery.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='access_linked' THEN
  IF NEW.actor_person_id NOT IN(previous.coordinator_person_id,previous.recorder_person_id) THEN RAISE EXCEPTION 'Only the current stay responsibility can link its custody evidence.' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.actor_person_id<>previous.coordinator_person_id THEN RAISE EXCEPTION 'This action requires the current exact coordinator.' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.action='response_recorded' AND NEW.actor_person_id=stay.resident_person_id THEN RAISE EXCEPTION 'Assisted response must retain a separate recorder, never impersonate the resident.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER accommodation_receipt_authority BEFORE INSERT ON accommodation_receipts FOR EACH ROW EXECUTE FUNCTION accommodation_receipt_authority_guard();

CREATE FUNCTION accommodation_physical_topology_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('accommodation-capacity:'||OLD.school_id::text,0));
 IF TG_TABLE_NAME='campus_spaces' THEN
  IF EXISTS(SELECT 1 FROM accommodation_rooms WHERE school_id=OLD.school_id AND space_id=OLD.id AND active) AND(NEW.status<>'active' OR NEW.kind='virtual' OR NEW.campus_id<>OLD.campus_id) THEN RAISE EXCEPTION 'End residential use before inactivating or relocating this canonical room.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='institution_campuses' THEN
  IF NEW.status<>'active' AND EXISTS(SELECT 1 FROM accommodation_rooms room JOIN campus_spaces space ON space.id=room.space_id AND space.school_id=room.school_id WHERE space.campus_id=OLD.id AND room.school_id=OLD.school_id AND room.active) THEN RAISE EXCEPTION 'This campus still has active residential rooms.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='campus_resource_holdings' THEN
  IF EXISTS(SELECT 1 FROM accommodation_places WHERE school_id=OLD.school_id AND holding_id=OLD.id AND active) AND ROW(NEW.space_id,NEW.campus_id,NEW.resource_type_id,NEW.state) IS DISTINCT FROM ROW(OLD.space_id,OLD.campus_id,OLD.resource_type_id,OLD.state) THEN RAISE EXCEPTION 'End or correct the named-place furniture link before relocating, retyping or retiring that holding.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='campus_resource_types' THEN
  IF (NEW.tracking_mode<>'individual' OR NOT NEW.is_active) AND EXISTS(SELECT 1 FROM accommodation_places place JOIN campus_resource_holdings holding ON holding.id=place.holding_id AND holding.school_id=place.school_id WHERE place.school_id=OLD.school_id AND holding.resource_type_id=OLD.id AND place.active) THEN RAISE EXCEPTION 'This resource type still identifies active named-place furniture.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER accommodation_space_use_guard BEFORE UPDATE ON campus_spaces FOR EACH ROW EXECUTE FUNCTION accommodation_physical_topology_guard();
CREATE TRIGGER accommodation_campus_use_guard BEFORE UPDATE ON institution_campuses FOR EACH ROW EXECUTE FUNCTION accommodation_physical_topology_guard();
CREATE TRIGGER accommodation_furniture_guard BEFORE UPDATE ON campus_resource_holdings FOR EACH ROW EXECUTE FUNCTION accommodation_physical_topology_guard();
CREATE TRIGGER accommodation_furniture_type_guard BEFORE UPDATE ON campus_resource_types FOR EACH ROW EXECUTE FUNCTION accommodation_physical_topology_guard();

CREATE FUNCTION accommodation_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof(payload)='object' AND EXISTS(
 SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id AND entity.domain='accommodation'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id AND event.source_domain='accommodation' AND event.source_record_id=aggregate::text AND event.source_revision=outcome.resulting_revision
 WHERE command.school_id=tenant AND command.id::text=payload->>'source_command_id' AND command.source_domain='accommodation' AND command.handler_key='accommodation.commands' AND command.state='accepted'
 AND command.safe_context->>'source_id'=aggregate::text AND entity.domain_id=aggregate::text AND outcome.resulting_revision::text=payload->>'revision' AND command.expected_revision=outcome.resulting_revision-1
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
 AND(event_name='accommodation.updated' AND aggregate_kind='accommodation_stay' AND payload=jsonb_build_object('source_id',aggregate::text,'revision',outcome.resulting_revision,'source_command_id',command.id::text,'refresh',jsonb_build_array('accommodation','workspace','attention'))
  OR event_name LIKE 'accommodation.stay.%' AND aggregate_kind='accommodation_stay_event' AND EXISTS(SELECT 1 FROM accommodation_receipts receipt WHERE receipt.school_id=tenant AND receipt.stay_id=aggregate AND receipt.command_id=command.id AND event_name='accommodation.stay.'||receipt.action AND payload=jsonb_build_object('stay_id',aggregate::text,'revision',receipt.revision,'action',receipt.action,'source_command_id',command.id::text))
  OR event_name LIKE 'accommodation.setup.%' AND aggregate_kind='accommodation_setup' AND EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=tenant AND receipt.source_id=aggregate AND receipt.command_id=command.id AND event_name='accommodation.setup.'||receipt.kind AND payload=jsonb_build_object('source_id',aggregate::text,'kind',receipt.kind,'revision',receipt.revision,'source_command_id',command.id::text)))
 AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id)
$$;
CREATE FUNCTION accommodation_event_recipient_valid(tenant uuid,payload jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.id::text=payload->>'source_id' AND EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id AND endpoint.endpoint_kind='account' WHERE agent.school_id=tenant AND agent.person_id IN(stay.resident_person_id,stay.coordinator_person_id,stay.recorder_person_id) AND endpoint.user_id=actor AND campus_model_account_person_is_active(tenant,actor,agent.person_id,now())))
 OR EXISTS(SELECT 1 FROM accommodation_setup_receipts receipt WHERE receipt.school_id=tenant AND receipt.source_id::text=payload->>'source_id' AND receipt.revision::text=payload->>'revision' AND receipt.command_id::text=payload->>'source_command_id' AND receipt.actor_user_id=actor AND accommodation_actor_can_manage(tenant,actor))
$$;
DO $$ DECLARE previous_body text;BEGIN
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $accommodation_recipient_232$
 SELECT CASE WHEN event_name LIKE 'accommodation.%%' THEN event_name='accommodation.updated' AND accommodation_event_recipient_valid(event_school_id,event_payload,candidate_user_id) ELSE (%s) END $accommodation_recipient_232$ $definition$,previous_body);
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $accommodation_source_232$
 SELECT CASE WHEN event_name='accommodation.updated' OR aggregate_kind='accommodation_stay' THEN event_name='accommodation.updated' AND accommodation_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $accommodation_source_232$ $definition$,previous_body);
END $$;
CREATE FUNCTION accommodation_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'accommodation.%' OR NEW.event_type LIKE 'accommodation.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at) THEN RAISE EXCEPTION 'Accommodation source envelopes are immutable.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'accommodation.%' AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL OR NEW.event_type<>'accommodation.updated' AND cardinality(NEW.audience_user_ids)>0 OR NEW.event_type='accommodation.updated' AND NOT coalesce(accommodation_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false) OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT coalesce(accommodation_event_recipient_valid(NEW.school_id,NEW.payload,actor),false))) THEN RAISE EXCEPTION 'Accommodation updates require neutral native evidence and exact current participants.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER accommodation_outbox_scope BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION accommodation_event_guard();
CREATE FUNCTION accommodation_event_complete_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN IF NEW.event_type LIKE 'accommodation.%' AND NOT coalesce(accommodation_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false) THEN RAISE EXCEPTION 'Accommodation source events require their accepted exact native operation.' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER accommodation_outbox_complete AFTER INSERT ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_event_complete_guard();
