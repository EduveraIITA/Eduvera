-- Planned physical meetings are not gate admissions, activity attendance,
-- room reservations, account grants or evidence of continuous presence.
CREATE TABLE gate_visit_arrangements (
 id uuid PRIMARY KEY,
 school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 person_id uuid,
 guest_name varchar(150),
 party_size integer NOT NULL CHECK(party_size BETWEEN 1 AND 5000),
 title varchar(160) NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 place_id uuid NOT NULL,
 contact_person_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('confirmed','cancelled')),
 revision integer NOT NULL CHECK(revision>0),
 created_by_person_id uuid NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_person_id uuid NOT NULL,
 updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),
 cancelled_at timestamptz,
 last_movement_direction text CHECK(last_movement_direction IN('in','out')),
 last_movement_at timestamptz,
 last_movement_count integer CHECK(last_movement_count BETWEEN 1 AND 5000),
 last_movement_command_id uuid REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 last_command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 last_domain_event_id uuid REFERENCES campus_model_events(id) ON DELETE RESTRICT,
 UNIQUE(id,school_id),
 FOREIGN KEY(person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(contact_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(created_by_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(updated_by_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(place_id,school_id) REFERENCES campus_spaces(id,school_id) ON DELETE RESTRICT,
 CHECK((person_id IS NOT NULL AND guest_name IS NULL) OR(person_id IS NULL AND guest_name IS NOT NULL AND length(btrim(guest_name)) BETWEEN 1 AND 150)),
 CHECK((state='cancelled')=(cancelled_at IS NOT NULL)),
 CHECK(num_nonnulls(last_movement_direction,last_movement_at,last_movement_count,last_movement_command_id) IN(0,4)),
 CHECK(last_movement_at IS NULL OR last_movement_at<=updated_at)
);
CREATE INDEX gate_visit_window_idx ON gate_visit_arrangements(school_id,state,ends_at,starts_at,id);
CREATE INDEX gate_visit_person_idx ON gate_visit_arrangements(person_id,school_id) WHERE person_id IS NOT NULL;
CREATE INDEX gate_visit_contact_idx ON gate_visit_arrangements(contact_person_id,school_id);
CREATE INDEX gate_visit_place_idx ON gate_visit_arrangements(place_id,school_id);
CREATE INDEX gate_visit_creator_idx ON gate_visit_arrangements(created_by_person_id,school_id);
CREATE INDEX gate_visit_updater_idx ON gate_visit_arrangements(updated_by_person_id,school_id);
CREATE INDEX gate_visit_creator_account_idx ON gate_visit_arrangements(created_by_user_id);
CREATE INDEX gate_visit_updater_account_idx ON gate_visit_arrangements(updated_by_user_id);
CREATE INDEX gate_visit_last_command_idx ON gate_visit_arrangements(last_command_id);
CREATE INDEX gate_visit_last_movement_command_idx ON gate_visit_arrangements(last_movement_command_id) WHERE last_movement_command_id IS NOT NULL;
CREATE INDEX gate_visit_last_event_idx ON gate_visit_arrangements(last_domain_event_id) WHERE last_domain_event_id IS NOT NULL;

-- Version snapshots belong to this typed native aggregate, never the broad
-- event stream. Equality to the typed source below prevents arbitrary JSON data.
CREATE TABLE gate_visit_arrangement_revisions (
 school_id uuid NOT NULL,
 visit_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN('arranged','changed','cancelled','movement_recorded')),
 command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 actor_person_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL,
 guest_label text NOT NULL CHECK(length(btrim(guest_label)) BETWEEN 1 AND 500),
 place_label text NOT NULL CHECK(length(btrim(place_label)) BETWEEN 1 AND 500),
 contact_label text NOT NULL CHECK(length(btrim(contact_label)) BETWEEN 1 AND 500),
 actor_label text NOT NULL CHECK(length(btrim(actor_label)) BETWEEN 1 AND 500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 PRIMARY KEY(visit_id,revision),
 UNIQUE(command_id),
 FOREIGN KEY(visit_id,school_id) REFERENCES gate_visit_arrangements(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX gate_visit_revision_actor_person_idx ON gate_visit_arrangement_revisions(actor_person_id,school_id);
CREATE INDEX gate_visit_revision_actor_account_idx ON gate_visit_arrangement_revisions(actor_user_id);
CREATE INDEX gate_visit_revision_tenant_idx ON gate_visit_arrangement_revisions(school_id,visit_id,revision DESC);
CREATE FUNCTION gate_visit_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Visit versions are immutable.' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM gate_visit_arrangements visit
  LEFT JOIN school_people guest ON guest.id=visit.person_id AND guest.school_id=visit.school_id
  JOIN school_people contact ON contact.id=visit.contact_person_id AND contact.school_id=visit.school_id
  JOIN school_people actor ON actor.id=visit.updated_by_person_id AND actor.school_id=visit.school_id
  JOIN campus_spaces place ON place.id=visit.place_id AND place.school_id=visit.school_id
  WHERE visit.school_id=NEW.school_id AND visit.id=NEW.visit_id AND visit.revision=NEW.revision
  AND visit.last_command_id=NEW.command_id AND visit.updated_by_person_id=NEW.actor_person_id AND visit.updated_by_user_id=NEW.actor_user_id
  AND visit.updated_at=NEW.recorded_at AND NEW.snapshot=to_jsonb(visit)-'last_domain_event_id'
  AND NEW.guest_label=CASE WHEN visit.person_id IS NOT NULL THEN btrim(concat(guest.first_name,' ',guest.last_name)) ELSE visit.guest_name END
  AND NEW.place_label=place.name AND NEW.contact_label=btrim(concat(contact.first_name,' ',contact.last_name))
  AND NEW.actor_label=btrim(concat(actor.first_name,' ',actor.last_name)))
 THEN RAISE EXCEPTION 'A visit version must retain its exact typed source state and actor.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_revision_immutable BEFORE INSERT OR UPDATE OR DELETE ON gate_visit_arrangement_revisions FOR EACH ROW EXECUTE FUNCTION gate_visit_revision_guard();

CREATE FUNCTION gate_visit_clock() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE at timestamptz;BEGIN
 IF current_schema()<>'public' THEN EXECUTE 'SELECT simulation_now()' INTO at;RETURN at;END IF;
 RETURN now();
END $$;
CREATE FUNCTION gate_visit_actor_can_manage(tenant uuid,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
  JOIN schools school ON school.id=membership.school_id
  WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND(
   membership.role='admin' OR membership.role='staff' AND EXISTS(SELECT 1 FROM staff_role_bindings binding
    WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution' AND binding.scope_id=tenant
    AND binding.status='active' AND binding.role_active AND 'gate.manage'=ANY(binding.permissions)
    AND binding.starts_on<=(gate_visit_clock() AT TIME ZONE school.timezone)::date
    AND(binding.ends_on IS NULL OR binding.ends_on>=(gate_visit_clock() AT TIME ZONE school.timezone)::date))))
$$;
CREATE FUNCTION gate_visit_current_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Visit arrangements retain accepted records.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.created_at,NEW.created_by_person_id,NEW.created_by_user_id)
  IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.created_at,OLD.created_by_person_id,OLD.created_by_user_id)
 OR NEW.revision NOT IN(OLD.revision,OLD.revision+1)
 OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'last_domain_event_id') IS DISTINCT FROM(to_jsonb(OLD)-'last_domain_event_id')
 OR OLD.state='cancelled' AND NEW.state<>'cancelled'
 OR OLD.last_movement_command_id IS NOT NULL AND ROW(NEW.person_id,NEW.guest_name) IS DISTINCT FROM ROW(OLD.person_id,OLD.guest_name)
 THEN RAISE EXCEPTION 'A visit change needs its next exact command and preserves observed identity.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_current_scope BEFORE UPDATE OR DELETE ON gate_visit_arrangements FOR EACH ROW EXECUTE FUNCTION gate_visit_current_guard();

CREATE FUNCTION gate_visit_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT((event_name='gate.visit_arrangement.updated' AND aggregate_kind='gate_visit_arrangement')
  OR(event_name='gate.visit_arrangement.'||(envelope->>'action') AND aggregate_kind='gate_visit_arrangement_event')) AND jsonb_typeof(envelope)='object'
 AND EXISTS(SELECT 1 FROM campus_model_commands command
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
  JOIN gate_visit_arrangements visit ON visit.school_id=command.school_id AND visit.id=aggregate
  WHERE command.school_id=tenant AND command.id::text=envelope->>'source_command_id'
  AND command.source_domain='gate' AND command.handler_key='gate.visit-arrangements.v1' AND command.handler_version=1 AND command.state='accepted'
  AND command.command_type='gate.visit_arrangement.'||(envelope->>'action')
  AND envelope->>'action' IN('arranged','changed','cancelled','movement_recorded')
  AND command.safe_context->>'visit_id'=aggregate::text AND command.expected_revision=outcome.resulting_revision-1
  AND outcome.resulting_revision<=visit.revision AND outcome.resulting_revision::text=envelope->>'revision'
  AND event.event_type=command.command_type AND event.source_domain='gate' AND event.source_record_id=aggregate::text AND event.source_revision=outcome.resulting_revision
  AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id
  AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
  AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
  AND target.domain='gate' AND target.kind='gate_visit_arrangement' AND target.domain_id=aggregate::text
  AND envelope=jsonb_build_object('visit_id',aggregate::text,'revision',outcome.resulting_revision,'action',envelope->>'action','source_command_id',command.id::text,'refresh',jsonb_build_array('gate-visits')))
$$;
CREATE FUNCTION gate_visit_event_recipient_valid(tenant uuid,envelope jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT gate_visit_actor_can_manage(tenant,actor)
 AND EXISTS(SELECT 1 FROM gate_visit_arrangements visit WHERE visit.school_id=tenant AND visit.id::text=envelope->>'visit_id')
 AND EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id AND endpoint.endpoint_kind='account'
  WHERE agent.school_id=tenant AND endpoint.user_id=actor AND campus_model_account_person_is_active(tenant,actor,agent.person_id,gate_visit_clock()))
$$;
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $visit_recipient_261$ SELECT CASE WHEN event_name LIKE 'gate.visit_arrangement.%%' THEN event_name='gate.visit_arrangement.updated' AND gate_visit_event_recipient_valid(event_school_id,event_payload,candidate_user_id) ELSE (%s) END $visit_recipient_261$ $definition$,body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $visit_source_261$ SELECT CASE WHEN event_name='gate.visit_arrangement.updated' OR aggregate_kind='gate_visit_arrangement' THEN gate_visit_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $visit_source_261$ $definition$,body);
END $$;
CREATE FUNCTION gate_visit_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE current_visit gate_visit_arrangements;BEGIN
 SELECT * INTO current_visit FROM gate_visit_arrangements WHERE school_id=NEW.school_id AND id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM gate_visit_arrangement_revisions version
  WHERE version.school_id=NEW.school_id AND version.visit_id=NEW.id AND version.revision=NEW.revision
  AND version.command_id=NEW.last_command_id AND version.snapshot=to_jsonb(NEW)-'last_domain_event_id')
 THEN RAISE EXCEPTION 'Every visit change retains its exact immutable native version.' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
  JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id AND authority.school_id=command.school_id
  WHERE command.school_id=NEW.school_id AND command.id=NEW.last_command_id AND command.source_domain='gate' AND command.handler_key='gate.visit-arrangements.v1' AND command.handler_version=1
   AND command.state='accepted' AND command.safe_context->>'visit_id'=NEW.id::text AND command.expected_revision=NEW.revision-1 AND outcome.resulting_revision=NEW.revision
   AND event.source_domain='gate' AND event.source_record_id=NEW.id::text AND event.source_revision=NEW.revision
   AND EXISTS(SELECT 1 FROM gate_visit_arrangement_revisions version WHERE version.school_id=NEW.school_id AND version.visit_id=NEW.id AND version.revision=NEW.revision AND command.command_type='gate.visit_arrangement.'||version.action)
   AND(NEW.revision<current_visit.revision OR event.id=current_visit.last_domain_event_id)
   AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id
   AND event.realm_id=command.realm_id AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
   AND target.domain='gate' AND target.kind='gate_visit_arrangement' AND target.domain_id=NEW.id::text
   AND actor.agent_kind='human' AND actor.person_id=NEW.updated_by_person_id
   AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id AND authority.capability='gate.manage' AND authority.decision='allowed'
   AND authority.realm_id=command.realm_id AND authority.environment_namespace_id=command.environment_namespace_id
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'Every visit revision requires its exact accepted command and event.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_native_complete AFTER INSERT OR UPDATE ON gate_visit_arrangements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_native_guard();
CREATE FUNCTION gate_visit_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'gate.visit_arrangement.%' OR NEW.event_type LIKE 'gate.visit_arrangement.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Visit source envelopes are immutable.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'gate.visit_arrangement.%' AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
  OR NEW.event_type<>'gate.visit_arrangement.updated' AND cardinality(NEW.audience_user_ids)>0
  OR NOT coalesce(gate_visit_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT gate_visit_event_recipient_valid(NEW.school_id,NEW.payload,actor)))
 THEN RAISE EXCEPTION 'Visit refreshes require exact accepted source evidence and current managers.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_event_source_guard AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_event_guard();
DO $$ DECLARE owner_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 ALTER TABLE gate_visit_arrangements ENABLE ROW LEVEL SECURITY;
 ALTER TABLE gate_visit_arrangement_revisions ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON TABLE gate_visit_arrangements FROM PUBLIC;
 REVOKE ALL ON TABLE gate_visit_arrangement_revisions FROM PUBLIC;
 EXECUTE format('ALTER TABLE gate_visit_arrangements OWNER TO %I',owner_name);
 EXECUTE format('ALTER TABLE gate_visit_arrangement_revisions OWNER TO %I',owner_name);
 FOREACH signature IN ARRAY ARRAY['gate_visit_clock()','gate_visit_actor_can_manage(uuid,uuid)','gate_visit_current_guard()','gate_visit_revision_guard()','gate_visit_event_source_valid(uuid,text,text,uuid,jsonb)','gate_visit_event_recipient_valid(uuid,jsonb,uuid)','gate_visit_native_guard()','gate_visit_event_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
