-- Current actor/owner and signed immutable evidence remain native. Core is the
-- coordination/command kernel, not a second menu, serving or shortage store.
CREATE FUNCTION dining_clock() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE at timestamptz;BEGIN
 IF current_schema()<>'public' THEN EXECUTE 'SELECT simulation_now()' INTO at;RETURN at;END IF;
 RETURN now();
END $$;
CREATE FUNCTION dining_person_available(tenant uuid,person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id AND endpoint.endpoint_kind='account'
 WHERE agent.school_id=tenant AND agent.person_id=person AND campus_model_account_person_is_active(tenant,endpoint.user_id,person,dining_clock()))
$$;
CREATE FUNCTION dining_actor_can_manage(tenant uuid,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
 WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND(membership.role='admin' OR membership.role='staff' AND(
 EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution' AND binding.scope_id=tenant AND binding.status='active' AND binding.role_active AND 'dining.manage'=ANY(binding.permissions) AND campus_permission_date(tenant) BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date))
 OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=tenant AND exception.user_id=actor AND exception.permission='dining.manage' AND exception.scope_kind='institution' AND exception.status='active' AND campus_permission_date(tenant) BETWEEN exception.valid_from AND exception.valid_until))))
$$;
CREATE FUNCTION dining_native_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE source uuid;kind_name text;event_action text;source_row jsonb;prior jsonb;expected_person uuid;valid boolean;BEGIN
 kind_name:=CASE TG_TABLE_NAME WHEN 'dining_service_receipts' THEN 'service' WHEN 'dining_session_receipts' THEN 'session' ELSE 'issue' END;
 source:=(to_jsonb(NEW)->>CASE kind_name WHEN 'service' THEN 'service_id' WHEN 'session' THEN 'session_id' ELSE 'issue_id' END)::uuid;
 event_action:=CASE WHEN kind_name='service' THEN 'saved' ELSE to_jsonb(NEW)->>'action' END;
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id AND actor.person_id=NEW.actor_person_id
  JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id AND entity.domain='dining' AND entity.domain_id=source::text
  WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='dining' AND command.handler_key='dining.commands' AND command.handler_version=1
   AND command.state='accepted' AND command.expected_revision=NEW.revision-1 AND outcome.resulting_revision=NEW.revision AND command.safe_context->>'source_id'=source::text AND command.safe_context->>'source_kind'=kind_name
   AND event.source_domain='dining' AND event.source_record_id=source::text AND event.source_revision=NEW.revision AND event.event_type='dining.'||kind_name||'.'||event_action
   AND event.actor_agent_id=command.actor_agent_id AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'Dining evidence requires its exact accepted DT command and source event.' USING ERRCODE='23514';END IF;
 IF NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at) THEN RAISE EXCEPTION 'Dining evidence requires its current canonical person/account endpoint.' USING ERRCODE='23514';END IF;
 IF kind_name='service' THEN
  SELECT to_jsonb(r) INTO prior FROM dining_service_receipts r WHERE r.school_id=NEW.school_id AND r.service_id=source AND r.revision=NEW.revision-1;
  valid:=dining_actor_can_manage(NEW.school_id,NEW.actor_user_id) OR prior->>'coordinator_person_id'=NEW.actor_person_id::text;
 ELSIF kind_name='session' THEN
  SELECT to_jsonb(r) INTO prior FROM dining_session_receipts r WHERE r.school_id=NEW.school_id AND r.session_id=source AND r.revision=NEW.revision-1;
  IF event_action='created' THEN SELECT EXISTS(SELECT 1 FROM dining_sessions session JOIN dining_services service ON service.school_id=session.school_id AND service.id=session.service_id WHERE session.school_id=NEW.school_id AND session.id=source AND service.revision=session.service_revision AND(service.coordinator_person_id=NEW.actor_person_id OR dining_actor_can_manage(NEW.school_id,NEW.actor_user_id))) INTO valid;
  ELSIF event_action IN('opened','paused','resumed','ended','counted','count_corrected') THEN valid:=prior->>'operator_person_id'=NEW.actor_person_id::text;
  ELSIF event_action='reassigned' THEN valid:=prior->>'coordinator_person_id'=NEW.actor_person_id::text OR dining_actor_can_manage(NEW.school_id,NEW.actor_user_id) AND NOT dining_person_available(NEW.school_id,(prior->>'coordinator_person_id')::uuid);
  ELSE valid:=prior->>'coordinator_person_id'=NEW.actor_person_id::text;END IF;
 ELSE
  SELECT to_jsonb(r) INTO prior FROM dining_issue_receipts r WHERE r.school_id=NEW.school_id AND r.issue_id=source AND r.revision=NEW.revision-1;
  SELECT to_jsonb(issue) INTO source_row FROM dining_issues issue WHERE issue.school_id=NEW.school_id AND issue.id=source;
  IF event_action='reported' THEN SELECT EXISTS(SELECT 1 FROM dining_sessions session WHERE session.school_id=NEW.school_id AND session.id=(source_row->>'session_id')::uuid AND NEW.actor_person_id IN(session.coordinator_person_id,session.operator_person_id) AND session.operations_mode='native' AND session.state NOT IN('draft','cancelled')) INTO valid;
  ELSIF event_action IN('accepted','resolved') THEN valid:=prior->>'handler_person_id'=NEW.actor_person_id::text;
  ELSIF event_action='reopened' THEN valid:=NEW.actor_person_id::text IN(source_row->>'reporter_person_id',source_row->>'coordinator_person_id');
  ELSE valid:=prior->>'coordinator_person_id'=NEW.actor_person_id::text OR dining_actor_can_manage(NEW.school_id,NEW.actor_user_id) AND NOT dining_person_available(NEW.school_id,(prior->>'coordinator_person_id')::uuid);END IF;
 END IF;
 IF NOT coalesce(valid,false) THEN RAISE EXCEPTION 'Dining evidence requires exact current source responsibility.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER dining_service_native_command AFTER INSERT ON dining_service_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_native_receipt_guard();
CREATE CONSTRAINT TRIGGER dining_session_native_command AFTER INSERT ON dining_session_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_native_receipt_guard();
CREATE CONSTRAINT TRIGGER dining_issue_native_command AFTER INSERT ON dining_issue_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_native_receipt_guard();
CREATE FUNCTION dining_current_evidence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE proof jsonb;valid boolean;BEGIN
 IF TG_TABLE_NAME='dining_services' THEN SELECT to_jsonb(receipt)-ARRAY['id','service_id','command_id','actor_person_id','actor_user_id','reason','recorded_at'] INTO proof FROM dining_service_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.service_id=NEW.id AND receipt.revision=NEW.revision;
  valid:=proof=(to_jsonb(NEW)-'id');
 ELSIF TG_TABLE_NAME='dining_sessions' THEN SELECT EXISTS(SELECT 1 FROM dining_session_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.session_id=NEW.id AND receipt.revision=NEW.revision
  AND ROW(receipt.state,receipt.label,receipt.menu_text,receipt.starts_at,receipt.ends_at,receipt.space_id,receipt.coordinator_person_id,receipt.operator_person_id,receipt.count_total,receipt.recorded_at) IS NOT DISTINCT FROM ROW(NEW.state,NEW.label,NEW.menu_text,NEW.starts_at,NEW.ends_at,NEW.space_id,NEW.coordinator_person_id,NEW.operator_person_id,NEW.count_total,NEW.updated_at)) INTO valid;
 ELSE SELECT EXISTS(SELECT 1 FROM dining_issue_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.issue_id=NEW.id AND receipt.revision=NEW.revision AND ROW(receipt.state,receipt.handler_person_id,receipt.coordinator_person_id,receipt.recorded_at) IS NOT DISTINCT FROM ROW(NEW.state,NEW.handler_person_id,NEW.coordinator_person_id,NEW.updated_at)) INTO valid;END IF;
 IF NOT coalesce(valid,false) THEN RAISE EXCEPTION 'Dining current state needs its exact immutable native revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE FUNCTION dining_canonical_space_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.space_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces space JOIN institution_campuses campus ON campus.school_id=space.school_id AND campus.id=space.campus_id WHERE space.id=NEW.space_id AND space.school_id=NEW.school_id)
 THEN RAISE EXCEPTION 'Dining uses an exact canonical place in this institution.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER dining_service_canonical_space BEFORE INSERT OR UPDATE ON dining_services FOR EACH ROW EXECUTE FUNCTION dining_canonical_space_guard();
CREATE TRIGGER dining_session_canonical_space BEFORE INSERT OR UPDATE ON dining_sessions FOR EACH ROW EXECUTE FUNCTION dining_canonical_space_guard();
CREATE CONSTRAINT TRIGGER dining_service_evidence AFTER INSERT OR UPDATE ON dining_services DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_current_evidence_guard();
CREATE CONSTRAINT TRIGGER dining_session_evidence AFTER INSERT OR UPDATE ON dining_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_current_evidence_guard();
CREATE CONSTRAINT TRIGGER dining_issue_evidence AFTER INSERT OR UPDATE ON dining_issues DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_current_evidence_guard();
CREATE FUNCTION dining_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof($5)='object' AND EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id AND event.source_domain='dining' AND event.source_record_id=aggregate::text AND event.source_revision=outcome.resulting_revision
 WHERE command.school_id=tenant AND command.id::text=$5->>'source_command_id' AND command.source_domain='dining' AND command.handler_key='dining.commands' AND command.state='accepted' AND command.safe_context->>'source_id'=aggregate::text
 AND outcome.resulting_revision::text=$5->>'revision' AND command.expected_revision=outcome.resulting_revision-1 AND command.safe_context->>'source_kind'=$5->>'source_kind'
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
 AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id
 AND((event_name='dining.updated' AND aggregate_kind='dining_'||($5->>'source_kind') AND $5=jsonb_build_object('source_id',aggregate::text,'source_kind',command.safe_context->>'source_kind','revision',outcome.resulting_revision,'source_command_id',command.id::text,'refresh',jsonb_build_array('dining','workspace','attention')))
 OR(event_name='dining.'||($5->>'source_kind')||'.'||($5->>'action') AND aggregate_kind='dining_'||($5->>'source_kind')||'_event' AND $5=jsonb_build_object('source_id',aggregate::text,'source_kind',command.safe_context->>'source_kind','revision',outcome.resulting_revision,'action',$5->>'action','source_command_id',command.id::text))))
$$;
CREATE FUNCTION dining_event_recipient_valid(tenant uuid,envelope jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account' WHERE agent.school_id=tenant AND endpoint.user_id=actor AND campus_model_account_person_is_active(tenant,actor,agent.person_id,dining_clock()) AND(
  envelope->>'source_kind'='service' AND EXISTS(SELECT 1 FROM dining_services service WHERE service.school_id=tenant AND service.id::text=envelope->>'source_id' AND(service.coordinator_person_id=agent.person_id OR dining_actor_can_manage(tenant,actor)))
  OR envelope->>'source_kind'='session' AND EXISTS(SELECT 1 FROM dining_sessions session WHERE session.school_id=tenant AND session.id::text=envelope->>'source_id' AND(session.state<>'draft' OR agent.person_id IN(session.coordinator_person_id,session.operator_person_id)))
  OR envelope->>'source_kind'='issue' AND EXISTS(SELECT 1 FROM dining_issues issue WHERE issue.school_id=tenant AND issue.id::text=envelope->>'source_id' AND agent.person_id IN(issue.reporter_person_id,issue.handler_person_id,issue.coordinator_person_id))))
$$;
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $dining_recipient_236$ SELECT CASE WHEN event_name LIKE 'dining.%%' THEN event_name='dining.updated' AND dining_event_recipient_valid(event_school_id,event_payload,candidate_user_id) ELSE (%s) END $dining_recipient_236$ $definition$,body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $dining_source_236$ SELECT CASE WHEN event_name='dining.updated' OR aggregate_kind IN('dining_service','dining_session','dining_issue') THEN event_name='dining.updated' AND dining_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $dining_source_236$ $definition$,body);
END $$;
CREATE FUNCTION dining_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'dining.%' OR NEW.event_type LIKE 'dining.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at) THEN RAISE EXCEPTION 'Dining source envelopes are immutable.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'dining.%' AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL OR NEW.event_type<>'dining.updated' AND cardinality(NEW.audience_user_ids)>0 OR NOT coalesce(dining_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false) OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT dining_event_recipient_valid(NEW.school_id,NEW.payload,actor)))
 THEN RAISE EXCEPTION 'Dining updates require exact native source evidence and current recipients.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER dining_event_source_guard AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_event_guard();
