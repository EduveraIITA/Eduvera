-- One native repair owner, governed through the shared Model Core runtime.
ALTER TABLE campus_spaces ADD CONSTRAINT campus_spaces_id_school_facilities_unique UNIQUE(id,school_id);
CREATE TABLE facilities_intake_rules (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),revision integer NOT NULL CHECK(revision>0),
 handler_person_id uuid NOT NULL,verifier_mode varchar(12) NOT NULL CHECK(verifier_mode IN('reporter','handler','named')),
 verifier_person_id uuid,emergency_contact varchar(300) NOT NULL DEFAULT'',created_by_person_id uuid NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),command_id uuid NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(school_id,revision),UNIQUE(school_id,command_id),
 FOREIGN KEY(handler_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(verifier_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(created_by_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK((verifier_mode='named')=(verifier_person_id IS NOT NULL))
);
CREATE INDEX facilities_rule_handler_idx ON facilities_intake_rules(school_id,handler_person_id);
CREATE INDEX facilities_rule_verifier_idx ON facilities_intake_rules(school_id,verifier_person_id) WHERE verifier_person_id IS NOT NULL;
CREATE INDEX facilities_rule_actor_idx ON facilities_intake_rules(school_id,created_by_person_id);

CREATE TABLE facilities_repairs (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),rule_id uuid NOT NULL,problem varchar(2000) NOT NULL CHECK(length(trim(problem))>=3),
 space_id uuid,holding_id uuid,location_note varchar(300) NOT NULL DEFAULT'',reporter_person_id uuid NOT NULL,recorder_person_id uuid NOT NULL,
 handler_person_id uuid NOT NULL,verifier_person_id uuid NOT NULL,urgent boolean NOT NULL DEFAULT false,
 state varchar(24) NOT NULL CHECK(state IN('reported','accepted','in_progress','waiting','awaiting_verification','closed')),
 wait_reason varchar(16) CHECK(wait_reason IN('parts','contractor','approval','access','other')),expected_finish_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 coordination_receipt jsonb NOT NULL DEFAULT'{}',UNIQUE(id,school_id),
 FOREIGN KEY(rule_id,school_id) REFERENCES facilities_intake_rules(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(holding_id,school_id) REFERENCES campus_resource_holdings(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(reporter_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(recorder_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(handler_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(verifier_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK(space_id IS NOT NULL OR holding_id IS NOT NULL OR length(trim(location_note))>=3),
 CHECK((state='waiting')=(wait_reason IS NOT NULL)),CHECK(updated_at>=created_at)
);
CREATE INDEX facilities_repair_rule_idx ON facilities_repairs(school_id,rule_id);
CREATE INDEX facilities_repair_reporter_idx ON facilities_repairs(school_id,reporter_person_id,updated_at DESC,id);
CREATE INDEX facilities_repair_recorder_idx ON facilities_repairs(school_id,recorder_person_id);
CREATE INDEX facilities_repair_handler_idx ON facilities_repairs(school_id,handler_person_id,state,updated_at DESC,id);
CREATE INDEX facilities_repair_verifier_idx ON facilities_repairs(school_id,verifier_person_id,state,updated_at DESC,id);
CREATE INDEX facilities_repair_space_idx ON facilities_repairs(school_id,space_id) WHERE space_id IS NOT NULL;
CREATE INDEX facilities_repair_holding_idx ON facilities_repairs(school_id,holding_id) WHERE holding_id IS NOT NULL;
CREATE INDEX facilities_repair_workspace_idx ON facilities_repairs(school_id,state,updated_at DESC,id);

CREATE FUNCTION facilities_actor_can_manage(tenant uuid,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
  WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND(membership.role='admin' OR membership.role='staff' AND(
   EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution'
    AND binding.scope_id=tenant AND binding.status='active' AND binding.role_active AND 'facilities.manage'=ANY(binding.permissions)
    AND campus_permission_date(tenant) BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date))
   OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=tenant AND exception.user_id=actor AND exception.permission='facilities.manage'
    AND exception.scope_kind='institution' AND exception.status='active' AND campus_permission_date(tenant) BETWEEN exception.valid_from AND exception.valid_until))))
$$;
CREATE FUNCTION facilities_repair_next_owner_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN school_people person ON person.school_id=repair.school_id
  AND person.id=CASE WHEN repair.state='awaiting_verification' THEN repair.verifier_person_id ELSE repair.handler_person_id END
  JOIN users account ON account.id=person.account_user_id AND account.is_active
  JOIN school_memberships membership ON membership.school_id=repair.school_id AND membership.user_id=account.id AND membership.is_active
  WHERE repair.school_id=tenant AND repair.id=repair_id AND campus_model_account_person_is_active(tenant,account.id,person.id,now())
   AND(repair.state='awaiting_verification' OR facilities_actor_can_manage(tenant,account.id)))
$$;

CREATE TABLE facilities_repair_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,repair_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL,
 action varchar(16) NOT NULL CHECK(action IN('reported','accepted','assigned','updated','completed','verified','reopened','photo_added')),
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),note varchar(2000) NOT NULL DEFAULT'',
 state varchar(24) NOT NULL CHECK(state IN('reported','accepted','in_progress','waiting','awaiting_verification','closed')),
 wait_reason varchar(16) CHECK(wait_reason IN('parts','contractor','approval','access','other')),expected_finish_at timestamptz,
 handler_person_id uuid NOT NULL,previous_handler_person_id uuid,verifier_person_id uuid NOT NULL,previous_verifier_person_id uuid,recorded_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(repair_id,school_id,revision),UNIQUE(school_id,command_id),
 FOREIGN KEY(repair_id,school_id) REFERENCES facilities_repairs(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(handler_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(previous_handler_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(verifier_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(previous_verifier_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK((state='waiting')=(wait_reason IS NOT NULL)),CHECK(action NOT IN('assigned','updated','completed','reopened') OR length(trim(note))>=3),
 CHECK((action='assigned')=(previous_handler_person_id IS NOT NULL OR previous_verifier_person_id IS NOT NULL)),
 CHECK(previous_handler_person_id IS NULL OR previous_verifier_person_id IS NULL)
);
CREATE INDEX facilities_receipt_actor_idx ON facilities_repair_receipts(school_id,actor_person_id);
CREATE INDEX facilities_receipt_handler_idx ON facilities_repair_receipts(school_id,handler_person_id);
CREATE INDEX facilities_receipt_previous_handler_idx ON facilities_repair_receipts(school_id,previous_handler_person_id) WHERE previous_handler_person_id IS NOT NULL;
CREATE INDEX facilities_receipt_verifier_idx ON facilities_repair_receipts(school_id,verifier_person_id);
CREATE INDEX facilities_receipt_previous_verifier_idx ON facilities_repair_receipts(school_id,previous_verifier_person_id) WHERE previous_verifier_person_id IS NOT NULL;
CREATE TABLE facilities_repair_photos (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,repair_id uuid NOT NULL,receipt_revision integer NOT NULL,
 file_name varchar(180) NOT NULL,content_type varchar(12) NOT NULL CHECK(content_type IN('image/jpeg','image/png')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 char(64) NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 created_by_person_id uuid NOT NULL,created_at timestamptz NOT NULL,UNIQUE(id,school_id,repair_id),UNIQUE(repair_id,school_id,receipt_revision),
 FOREIGN KEY(repair_id,school_id,receipt_revision) REFERENCES facilities_repair_receipts(repair_id,school_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(created_by_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX facilities_photo_actor_idx ON facilities_repair_photos(school_id,created_by_person_id);

CREATE FUNCTION facilities_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Facilities evidence is append-only; record a new operation.' USING ERRCODE='23514';END $$;
CREATE TRIGGER facilities_rule_immutable BEFORE UPDATE OR DELETE ON facilities_intake_rules FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE TRIGGER facilities_receipt_immutable BEFORE UPDATE OR DELETE ON facilities_repair_receipts FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE TRIGGER facilities_photo_immutable BEFORE UPDATE OR DELETE ON facilities_repair_photos FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE FUNCTION facilities_repair_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Repairs retain their history.' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordination_receipt'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordination_receipt'])
  OR NEW.revision NOT IN(OLD.revision,OLD.revision+1)
  OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'A repair change needs its next exact operation revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER facilities_repair_current_scope BEFORE UPDATE OR DELETE ON facilities_repairs FOR EACH ROW EXECUTE FUNCTION facilities_repair_current_guard();

CREATE FUNCTION facilities_repair_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_repair facilities_repairs;
BEGIN
 SELECT * INTO current_repair FROM facilities_repairs WHERE id=NEW.id AND school_id=NEW.school_id;
 IF NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.repair_id=NEW.id AND receipt.revision=NEW.revision
  AND receipt.state=NEW.state AND receipt.wait_reason IS NOT DISTINCT FROM NEW.wait_reason AND receipt.expected_finish_at IS NOT DISTINCT FROM NEW.expected_finish_at
  AND receipt.handler_person_id=NEW.handler_person_id AND receipt.verifier_person_id=NEW.verifier_person_id AND receipt.recorded_at=NEW.updated_at)
 THEN RAISE EXCEPTION 'Every repair revision needs its exact immutable native operation.' USING ERRCODE='23514';END IF;
 IF current_repair.coordination_receipt='{}'::jsonb THEN RAISE EXCEPTION 'A repair needs retained coordination evidence.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER facilities_repair_revision_complete AFTER INSERT OR UPDATE ON facilities_repairs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facilities_repair_revision_guard();

CREATE FUNCTION facilities_event_source_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof(event_payload)='object' AND event_payload ?& ARRAY['repair_id','revision','action','source_command_id']
  AND(event_payload-CASE WHEN event_name='facilities.updated' THEN ARRAY['repair_id','revision','action','source_command_id','refresh'] ELSE ARRAY['repair_id','revision','action','source_command_id'] END)='{}'::jsonb
  AND(event_name<>'facilities.updated' OR event_payload->'refresh'='["facilities","workspace","attention"]'::jsonb)
  AND aggregate_kind=CASE WHEN event_name='facilities.updated' THEN 'facility_repair' ELSE 'facility_repair_event' END
  AND EXISTS(SELECT 1 FROM facilities_repair_receipts receipt JOIN facilities_repairs repair ON repair.id=receipt.repair_id AND repair.school_id=receipt.school_id
   JOIN campus_model_commands command ON command.id=receipt.command_id AND command.school_id=receipt.school_id AND command.source_domain='facilities'
    AND command.handler_key='facilities.commands' AND command.handler_version=1 AND command.state='accepted'
    AND command.expected_revision=receipt.revision-1 AND command.safe_context->>'repair_id'=repair.id::text
    AND command.command_type='facilities.'||receipt.action
   JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted' AND outcome.resulting_revision=receipt.revision
   JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=repair.school_id AND entity.domain='facilities' AND entity.kind='facility_repair' AND entity.domain_id=repair.id::text
   JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=repair.school_id AND event.source_domain='facilities'
    AND event.source_record_id=repair.id::text AND event.source_revision=receipt.revision AND event.actor_agent_id=command.actor_agent_id
    AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
   JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.person_id=receipt.actor_person_id
   WHERE receipt.school_id=institution AND repair.id=aggregate AND receipt.revision::text=event_payload->>'revision'
    AND repair.id::text=event_payload->>'repair_id' AND receipt.action=event_payload->>'action' AND receipt.command_id::text=event_payload->>'source_command_id'
    AND(event_name='facilities.updated' OR event_name='facilities.'||receipt.action)
    AND event.event_type='facilities.'||receipt.action AND event.payload=event_payload-'refresh'
    AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||institution::text END))
$$;
CREATE FUNCTION facilities_receipt_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(facilities_event_source_valid(NEW.school_id,'facilities.'||NEW.action,'facility_repair_event',NEW.repair_id,
  jsonb_build_object('repair_id',NEW.repair_id::text,'revision',NEW.revision,'action',NEW.action,'source_command_id',NEW.command_id::text)),false)
 THEN RAISE EXCEPTION 'A repair operation requires its exact accepted DT command and event.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER facilities_receipt_command_complete AFTER INSERT ON facilities_repair_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facilities_receipt_command_guard();
CREATE FUNCTION facilities_receipt_participant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE repair facilities_repairs;
BEGIN
 SELECT * INTO repair FROM facilities_repairs WHERE school_id=NEW.school_id AND id=NEW.repair_id;
 IF NEW.action='reported' AND(NEW.actor_person_id<>repair.recorder_person_id OR repair.reporter_person_id<>NEW.actor_person_id AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id))
  OR NEW.action IN('accepted','updated','completed') AND(NEW.actor_person_id<>repair.handler_person_id OR NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id))
  OR NEW.action='verified' AND NEW.actor_person_id<>repair.verifier_person_id
  OR NEW.action='reopened' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.verifier_person_id)
  OR NEW.action='assigned' AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id)
  OR NEW.action='photo_added' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.recorder_person_id,repair.handler_person_id,repair.verifier_person_id)
 THEN RAISE EXCEPTION 'A repair operation needs its exact current participant authority.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER facilities_receipt_participant_scope BEFORE INSERT ON facilities_repair_receipts FOR EACH ROW EXECUTE FUNCTION facilities_receipt_participant_guard();
CREATE FUNCTION facilities_rule_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id AND event.source_domain='facilities'
  WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='facilities' AND command.command_type='facilities.rule_configured'
   AND command.state='accepted' AND command.expected_revision=NEW.revision-1 AND outcome.status='accepted' AND outcome.resulting_revision=NEW.revision
   AND event.source_record_id=NEW.school_id::text AND event.source_revision=NEW.revision
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'An intake rule needs its exact accepted configuration command.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER facilities_rule_command_complete AFTER INSERT ON facilities_intake_rules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facilities_rule_command_guard();
CREATE FUNCTION facilities_photo_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt JOIN campus_model_commands command ON command.id=receipt.command_id AND command.state='pending'
  WHERE receipt.repair_id=NEW.repair_id AND receipt.school_id=NEW.school_id AND receipt.revision=NEW.receipt_revision AND receipt.action='photo_added'
   AND receipt.actor_person_id=NEW.created_by_person_id AND receipt.recorded_at=NEW.created_at)
 THEN RAISE EXCEPTION 'A repair photo needs its exact pending attachment operation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER facilities_photo_command_scope BEFORE INSERT ON facilities_repair_photos FOR EACH ROW EXECUTE FUNCTION facilities_photo_command_guard();

CREATE FUNCTION facilities_event_recipient_valid(tenant uuid,payload jsonb,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair WHERE repair.school_id=tenant AND repair.id::text=payload->>'repair_id'
  AND(campus_model_account_person_is_active(tenant,actor,repair.reporter_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.recorder_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.handler_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.verifier_person_id,now())))
$$;
DO $$ DECLARE previous_body text; BEGIN
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $facilities_recipient_224$
  SELECT CASE WHEN event_name LIKE 'facilities.%%' THEN event_name='facilities.updated' AND facilities_event_recipient_valid(event_school_id,event_payload,candidate_user_id)
   ELSE (%s) END $facilities_recipient_224$
 $definition$,previous_body);
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
  RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $facilities_source_224$
  SELECT CASE WHEN event_name='facilities.updated' OR aggregate_kind='facility_repair' THEN event_name='facilities.updated' AND facilities_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload)
   ELSE (%s) END $facilities_source_224$
 $definition$,previous_body);
END $$;
CREATE FUNCTION facilities_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'facilities.%' OR NEW.event_type LIKE 'facilities.%') THEN
  IF ROW(NEW.id,NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Facilities event envelopes retain immutable source evidence.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'facilities.%' THEN
  IF cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
   OR NEW.event_type<>'facilities.updated' AND cardinality(NEW.audience_user_ids)>0
   OR NEW.event_type='facilities.updated' AND NOT coalesce(facilities_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
   OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT coalesce(facilities_event_recipient_valid(NEW.school_id,NEW.payload,actor),false))
  THEN RAISE EXCEPTION 'Facilities updates need neutral accepted evidence and exact participants.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER facilities_event_scope BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION facilities_event_guard();
CREATE FUNCTION facilities_event_completion_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.event_type LIKE 'facilities.%' AND NEW.event_type<>'facilities.rule_configured'
  AND NOT coalesce(facilities_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
 THEN RAISE EXCEPTION 'Facilities event requires its exact accepted owning operation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER facilities_event_complete AFTER INSERT ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facilities_event_completion_guard();

ALTER TABLE facilities_intake_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_repair_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_repair_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON facilities_intake_rules,facilities_repairs,facilities_repair_receipts,facilities_repair_photos FROM PUBLIC;
DO $$ DECLARE owner_name text;role_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH role_name IN ARRAY ARRAY['facilities_intake_rules','facilities_repairs','facilities_repair_receipts','facilities_repair_photos'] LOOP
  EXECUTE format('ALTER TABLE %I OWNER TO %I',role_name,owner_name);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['facilities_history_immutable()','facilities_repair_current_guard()','facilities_repair_revision_guard()',
  'facilities_event_source_valid(uuid,text,text,uuid,jsonb)','facilities_receipt_command_guard()','facilities_rule_command_guard()','facilities_photo_command_guard()',
  'facilities_actor_can_manage(uuid,uuid)','facilities_repair_next_owner_available(uuid,uuid)','facilities_receipt_participant_guard()',
  'facilities_event_recipient_valid(uuid,jsonb,uuid)','facilities_event_guard()','facilities_event_completion_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
COMMENT ON TABLE facilities_repairs IS 'Facilities-owned repair operations, linked to canonical people/place/item. Reported completion is distinct from verifier acceptance; no procurement, custody or occupancy inference.';
