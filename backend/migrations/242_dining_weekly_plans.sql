-- Native weekly intent, typed day content and immutable command evidence.
-- Reads never materialize a dated service. Availability is not a room/person claim.
CREATE TABLE dining_weekly_plans (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),series_id uuid NOT NULL,service_id uuid NOT NULL,service_revision integer NOT NULL CHECK(service_revision>0),
 version_number integer NOT NULL CHECK(version_number>0),label text NOT NULL CHECK(length(label) BETWEEN 2 AND 100),timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80),starts_on date NOT NULL,ends_on date,
 coordinator_person_id uuid NOT NULL,menu_mode text NOT NULL CHECK(menu_mode IN('native','reference')),operations_mode text NOT NULL CHECK(operations_mode IN('native','reference')),
 source_label text NOT NULL,source_url text,source_reference text NOT NULL,source_observed_at timestamptz,
 state text NOT NULL CHECK(state IN('draft','published','stopped')),revision integer NOT NULL CHECK(revision>0),replaces_plan_id uuid,replaces_revision integer,stop_from date,published_at timestamptz,
 projection_receipt jsonb NOT NULL DEFAULT '{}'::jsonb,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 UNIQUE(school_id,id),UNIQUE(school_id,series_id,version_number),FOREIGN KEY(school_id,series_id) REFERENCES dining_weekly_plans(school_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(school_id,service_id) REFERENCES dining_services(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,replaces_plan_id) REFERENCES dining_weekly_plans(school_id,id),
 CHECK(ends_on IS NULL OR ends_on>=starts_on),CHECK((replaces_plan_id IS NULL)=(replaces_revision IS NULL)),CHECK((state='draft')=(published_at IS NULL)),CHECK(state<>'stopped' OR stop_from IS NOT NULL),CHECK(menu_mode='native' OR operations_mode='native')
);
CREATE UNIQUE INDEX dining_weekly_one_draft ON dining_weekly_plans(school_id,series_id) WHERE state='draft';
CREATE INDEX dining_weekly_service ON dining_weekly_plans(school_id,service_id,created_at,id);
CREATE INDEX dining_weekly_effective ON dining_weekly_plans(school_id,series_id,version_number DESC) WHERE published_at IS NOT NULL;
CREATE INDEX dining_weekly_coordinator ON dining_weekly_plans(school_id,coordinator_person_id,published_at,id);
CREATE INDEX dining_weekly_previous ON dining_weekly_plans(school_id,replaces_plan_id);
CREATE TABLE dining_weekly_days (
 school_id uuid NOT NULL,plan_id uuid NOT NULL,weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 7),menu_text text NOT NULL CHECK(length(menu_text)<=4000),
 starts_at text NOT NULL CHECK(starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),ends_at text NOT NULL CHECK(ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),end_day_offset smallint NOT NULL CHECK(end_day_offset IN(0,1)),
 space_id uuid REFERENCES campus_spaces(id),operator_person_id uuid NOT NULL,start_fold text NOT NULL CHECK(start_fold IN('reject','earlier','later')),end_fold text NOT NULL CHECK(end_fold IN('reject','earlier','later')),
 PRIMARY KEY(school_id,plan_id,weekday),FOREIGN KEY(school_id,plan_id) REFERENCES dining_weekly_plans(school_id,id),FOREIGN KEY(school_id,operator_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id),
 CHECK((ends_at::time-starts_at::time)+end_day_offset*interval '1 day'>interval '0' AND (ends_at::time-starts_at::time)+end_day_offset*interval '1 day'<=interval '24 hours')
);
CREATE INDEX dining_weekly_days_operator ON dining_weekly_days(school_id,operator_person_id,plan_id);
CREATE INDEX dining_weekly_days_space ON dining_weekly_days(school_id,space_id);
CREATE TABLE dining_weekly_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,plan_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL REFERENCES campus_model_commands(id),action text NOT NULL,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL,exception_date date,date_session_id uuid,
 UNIQUE(school_id,plan_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(school_id,plan_id) REFERENCES dining_weekly_plans(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id),CHECK((exception_date IS NULL)=(date_session_id IS NULL)),CHECK((action='date_cancelled')=(exception_date IS NOT NULL))
);
CREATE INDEX dining_weekly_receipts_command ON dining_weekly_receipts(command_id);
CREATE INDEX dining_weekly_receipts_actor ON dining_weekly_receipts(school_id,actor_person_id,recorded_at);
CREATE INDEX dining_weekly_receipts_date ON dining_weekly_receipts(school_id,exception_date,plan_id) WHERE exception_date IS NOT NULL;
ALTER TABLE dining_sessions ADD weekly_plan_id uuid,ADD weekly_series_id uuid,ADD weekly_date date,ADD weekly_exception boolean NOT NULL DEFAULT false,
 ADD FOREIGN KEY(school_id,weekly_plan_id) REFERENCES dining_weekly_plans(school_id,id),ADD FOREIGN KEY(school_id,weekly_series_id) REFERENCES dining_weekly_plans(school_id,id),
 ADD CHECK((weekly_plan_id IS NULL AND weekly_series_id IS NULL AND weekly_date IS NULL AND NOT weekly_exception) OR (weekly_plan_id IS NOT NULL AND weekly_series_id IS NOT NULL AND weekly_date IS NOT NULL));
CREATE UNIQUE INDEX dining_weekly_date ON dining_sessions(school_id,weekly_series_id,weekly_date) WHERE weekly_series_id IS NOT NULL;
CREATE INDEX dining_weekly_session_plan ON dining_sessions(school_id,weekly_plan_id);
CREATE FUNCTION dining_weekly_snapshot(tenant uuid,source uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT (to_jsonb(plan)-'projection_receipt')||jsonb_build_object('days',coalesce((SELECT jsonb_agg(to_jsonb(day) ORDER BY weekday) FROM dining_weekly_days day WHERE day.school_id=tenant AND day.plan_id=source),'[]'::jsonb)) FROM dining_weekly_plans plan WHERE plan.school_id=tenant AND plan.id=source
$$;
CREATE FUNCTION dining_weekly_current_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Published dining intent retains its history.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.series_id,NEW.service_id,NEW.service_revision,NEW.version_number,NEW.menu_mode,NEW.operations_mode,NEW.source_label,NEW.source_url,NEW.source_reference,NEW.source_observed_at,NEW.replaces_plan_id,NEW.replaces_revision,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.series_id,OLD.service_id,OLD.service_revision,OLD.version_number,OLD.menu_mode,OLD.operations_mode,OLD.source_label,OLD.source_url,OLD.source_reference,OLD.source_observed_at,OLD.replaces_plan_id,OLD.replaces_revision,OLD.created_at,OLD.created_by_user_id)
 OR NEW.revision NOT IN(OLD.revision,OLD.revision+1) OR NEW.revision=OLD.revision AND (to_jsonb(NEW)-'projection_receipt') IS DISTINCT FROM (to_jsonb(OLD)-'projection_receipt')
 OR OLD.state<>'draft' AND ROW(NEW.label,NEW.timezone,NEW.starts_on,NEW.ends_on,NEW.published_at) IS DISTINCT FROM ROW(OLD.label,OLD.timezone,OLD.starts_on,OLD.ends_on,OLD.published_at)
 THEN RAISE EXCEPTION 'Weekly dining changes require exact revision and immutable publication lineage.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER dining_weekly_current BEFORE UPDATE OR DELETE ON dining_weekly_plans FOR EACH ROW EXECUTE FUNCTION dining_weekly_current_guard();
CREATE FUNCTION dining_weekly_day_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE row_plan dining_weekly_plans;data jsonb;BEGIN
 data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 SELECT * INTO row_plan FROM dining_weekly_plans WHERE school_id=(data->>'school_id')::uuid AND id=(data->>'plan_id')::uuid;
 IF row_plan.state<>'draft' THEN RAISE EXCEPTION 'Published weekday content is immutable; revise future weeks.' USING ERRCODE='23514';END IF;
 IF TG_OP<>'DELETE' AND NEW.space_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces WHERE school_id=NEW.school_id AND id=NEW.space_id) THEN RAISE EXCEPTION 'Dining uses a canonical place in this institution.' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER dining_weekly_day BEFORE INSERT OR UPDATE OR DELETE ON dining_weekly_days FOR EACH ROW EXECUTE FUNCTION dining_weekly_day_guard();
CREATE FUNCTION dining_weekly_evidence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE proof dining_weekly_receipts;source dining_weekly_plans;prior dining_weekly_receipts;valid boolean;BEGIN
 IF TG_TABLE_NAME='dining_weekly_plans' THEN
  SELECT * INTO proof FROM dining_weekly_receipts WHERE school_id=NEW.school_id AND plan_id=NEW.id AND revision=NEW.revision;
  IF proof.id IS NULL OR proof.snapshot IS DISTINCT FROM dining_weekly_snapshot(NEW.school_id,NEW.id) THEN RAISE EXCEPTION 'Weekly dining state requires exact signed native evidence.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 SELECT * INTO source FROM dining_weekly_plans WHERE school_id=NEW.school_id AND id=NEW.plan_id;
 SELECT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
 JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id AND actor.person_id=NEW.actor_person_id
 JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id AND entity.domain='dining' AND entity.domain_id=NEW.plan_id::text
 WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='dining' AND command.handler_key='dining.commands' AND command.state='accepted'
 AND command.expected_revision=NEW.revision-1 AND outcome.resulting_revision=NEW.revision AND command.safe_context->>'source_id'=NEW.plan_id::text AND command.safe_context->>'source_kind'='plan'
 AND event.source_domain='dining' AND event.source_record_id=NEW.plan_id::text AND event.source_revision=NEW.revision AND event.event_type='dining.plan.'||NEW.action
 AND event.actor_agent_id=command.actor_agent_id AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)) INTO valid;
 SELECT * INTO prior FROM dining_weekly_receipts WHERE school_id=NEW.school_id AND plan_id=NEW.plan_id AND revision=NEW.revision-1;
 IF NOT coalesce(valid,false) OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at)
 OR NOT(NEW.revision=1 AND(NEW.actor_person_id=source.coordinator_person_id OR dining_actor_can_manage(NEW.school_id,NEW.actor_user_id)) OR NEW.revision>1 AND(NEW.actor_person_id=(prior.snapshot->>'coordinator_person_id')::uuid OR NEW.action='recovered' AND dining_actor_can_manage(NEW.school_id,NEW.actor_user_id) AND NOT dining_person_available(NEW.school_id,(prior.snapshot->>'coordinator_person_id')::uuid)))
 OR prior.id IS NOT NULL AND NEW.action<>'recovered' AND prior.snapshot->>'coordinator_person_id' IS DISTINCT FROM NEW.snapshot->>'coordinator_person_id'
 THEN RAISE EXCEPTION 'Weekly dining requires its exact current actor and accepted DT command.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER dining_weekly_evidence AFTER INSERT OR UPDATE ON dining_weekly_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_weekly_evidence_guard();
CREATE CONSTRAINT TRIGGER dining_weekly_command AFTER INSERT ON dining_weekly_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dining_weekly_evidence_guard();
CREATE TRIGGER dining_weekly_receipt_immutable BEFORE UPDATE OR DELETE ON dining_weekly_receipts FOR EACH ROW EXECUTE FUNCTION dining_immutable();
CREATE FUNCTION dining_weekly_lineage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE plan dining_weekly_plans;BEGIN
 IF TG_TABLE_NAME='dining_services' THEN
 IF ROW(NEW.menu_mode,NEW.operations_mode) IS DISTINCT FROM ROW(OLD.menu_mode,OLD.operations_mode) AND EXISTS(SELECT 1 FROM dining_weekly_plans WHERE school_id=OLD.school_id AND service_id=OLD.id) THEN RAISE EXCEPTION 'A weekly source requires explicit capability handover.' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.weekly_plan_id,NEW.weekly_series_id,NEW.weekly_date) IS DISTINCT FROM ROW(OLD.weekly_plan_id,OLD.weekly_series_id,OLD.weekly_date) THEN RAISE EXCEPTION 'A dated exception retains exact weekly provenance.' USING ERRCODE='23514';END IF;
 IF NEW.weekly_plan_id IS NOT NULL THEN SELECT * INTO plan FROM dining_weekly_plans WHERE school_id=NEW.school_id AND id=NEW.weekly_plan_id;
 IF plan.published_at IS NULL OR plan.series_id<>NEW.weekly_series_id OR plan.service_id<>NEW.service_id OR plan.service_revision<>NEW.service_revision OR plan.menu_mode<>NEW.menu_mode OR plan.operations_mode<>NEW.operations_mode THEN RAISE EXCEPTION 'A dated service must retain its exact accepted weekly source.' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END $$;
CREATE TRIGGER dining_weekly_modes BEFORE UPDATE ON dining_services FOR EACH ROW EXECUTE FUNCTION dining_weekly_lineage_guard();
CREATE TRIGGER dining_weekly_lineage BEFORE INSERT OR UPDATE ON dining_sessions FOR EACH ROW EXECUTE FUNCTION dining_weekly_lineage_guard();
-- Extend the existing native command guard only for explicit first materialization.
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='dining_native_receipt_guard()'::regprocedure;
 IF position('IF event_action=''created'' THEN SELECT EXISTS' IN body)=0 THEN RAISE EXCEPTION 'The native Dining command guard changed; review its weekly extension.';END IF;
 body:=replace(body,'IF event_action=''created'' THEN SELECT EXISTS','IF event_action=''created'' AND EXISTS(SELECT 1 FROM dining_sessions s WHERE s.school_id=NEW.school_id AND s.id=source AND s.weekly_plan_id IS NOT NULL) THEN SELECT EXISTS(SELECT 1 FROM dining_sessions s JOIN dining_weekly_plans p ON p.school_id=s.school_id AND p.id=s.weekly_plan_id WHERE s.school_id=NEW.school_id AND s.id=source AND p.published_at IS NOT NULL AND ((s.state=''open'' AND p.operations_mode=''native'' AND NEW.actor_person_id=s.operator_person_id) OR (s.state IN(''published'',''cancelled'') AND NEW.actor_person_id=p.coordinator_person_id))) INTO valid; ELSIF event_action=''created'' THEN SELECT EXISTS');
 EXECUTE 'CREATE OR REPLACE FUNCTION dining_native_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS '||quote_literal(body);
END $$;
CREATE OR REPLACE FUNCTION dining_event_recipient_valid(tenant uuid,envelope jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account' WHERE agent.school_id=tenant AND endpoint.user_id=actor AND campus_model_account_person_is_active(tenant,actor,agent.person_id,dining_clock()) AND(
 envelope->>'source_kind'='service' AND EXISTS(SELECT 1 FROM dining_services service WHERE service.school_id=tenant AND service.id::text=envelope->>'source_id' AND(service.coordinator_person_id=agent.person_id OR dining_actor_can_manage(tenant,actor)))
 OR envelope->>'source_kind'='session' AND EXISTS(SELECT 1 FROM dining_sessions session WHERE session.school_id=tenant AND session.id::text=envelope->>'source_id' AND(session.published_at IS NOT NULL OR agent.person_id IN(session.coordinator_person_id,session.operator_person_id)))
 OR envelope->>'source_kind'='issue' AND EXISTS(SELECT 1 FROM dining_issues issue WHERE issue.school_id=tenant AND issue.id::text=envelope->>'source_id' AND agent.person_id IN(issue.reporter_person_id,issue.handler_person_id,issue.coordinator_person_id))
 OR envelope->>'source_kind'='plan' AND EXISTS(SELECT 1 FROM dining_weekly_plans plan WHERE plan.school_id=tenant AND plan.id::text=envelope->>'source_id' AND(plan.published_at IS NOT NULL OR plan.coordinator_person_id=agent.person_id))))
$$;
DO $$ DECLARE relation text;owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH relation IN ARRAY ARRAY['dining_weekly_plans','dining_weekly_days','dining_weekly_receipts'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation);EXECUTE format('ALTER TABLE %I OWNER TO %I',relation,owner_name);END LOOP;
END $$;
