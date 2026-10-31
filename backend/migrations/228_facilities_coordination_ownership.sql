-- The explicitly chosen intake owner remains accountable when a worker is
-- assigned. Worker, coordinator and verifier are independent exact roles.
ALTER TABLE facilities_repairs ADD COLUMN coordinator_person_id uuid;
ALTER TABLE facilities_repairs DISABLE TRIGGER facilities_repair_current_scope;
ALTER TABLE facilities_repairs DISABLE TRIGGER facilities_repair_revision_complete;
UPDATE facilities_repairs repair SET coordinator_person_id=rule.handler_person_id
 FROM facilities_intake_rules rule WHERE rule.school_id=repair.school_id AND rule.id=repair.rule_id;
ALTER TABLE facilities_repairs ENABLE TRIGGER facilities_repair_current_scope;
ALTER TABLE facilities_repairs ENABLE TRIGGER facilities_repair_revision_complete;
ALTER TABLE facilities_repairs ALTER COLUMN coordinator_person_id SET NOT NULL;
ALTER TABLE facilities_repairs ADD CONSTRAINT facilities_repair_coordinator_person_fk
 FOREIGN KEY(coordinator_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT;
CREATE INDEX facilities_repair_coordinator_idx ON facilities_repairs(school_id,coordinator_person_id,state,updated_at DESC,id);
ALTER TABLE facilities_repair_receipts DISABLE TRIGGER facilities_receipt_immutable;
ALTER TABLE facilities_repair_receipts ADD COLUMN coordinator_person_id uuid;
ALTER TABLE facilities_repair_receipts ADD COLUMN previous_coordinator_person_id uuid;
UPDATE facilities_repair_receipts receipt SET coordinator_person_id=repair.coordinator_person_id FROM facilities_repairs repair WHERE repair.id=receipt.repair_id AND repair.school_id=receipt.school_id;
ALTER TABLE facilities_repair_receipts ALTER COLUMN coordinator_person_id SET NOT NULL;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_receipt_coordinator_person_fk FOREIGN KEY(coordinator_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_receipt_previous_coordinator_fk FOREIGN KEY(previous_coordinator_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT;
CREATE INDEX facilities_receipt_coordinator_idx ON facilities_repair_receipts(school_id,coordinator_person_id);
CREATE INDEX facilities_receipt_previous_coordinator_idx ON facilities_repair_receipts(school_id,previous_coordinator_person_id) WHERE previous_coordinator_person_id IS NOT NULL;
ALTER TABLE facilities_repair_receipts ENABLE TRIGGER facilities_receipt_immutable;
DO $$ DECLARE name text;BEGIN
 FOR name IN SELECT conname FROM pg_constraint WHERE conrelid='facilities_repair_receipts'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%previous_handler_person_id%' LOOP
  EXECUTE format('ALTER TABLE facilities_repair_receipts DROP CONSTRAINT %I',name);
 END LOOP;
END $$;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_assignment_exact_target CHECK(
 (action='assigned')=(num_nonnulls(previous_handler_person_id,previous_verifier_person_id,previous_coordinator_person_id)=1)
 AND num_nonnulls(previous_handler_person_id,previous_verifier_person_id,previous_coordinator_person_id)<=1);

CREATE OR REPLACE FUNCTION facilities_repair_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Repairs retain their history.' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordinator_person_id','coordination_receipt'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordinator_person_id','coordination_receipt'])
  OR NEW.revision NOT IN(OLD.revision,OLD.revision+1)
  OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'A repair change needs its next exact operation revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION facilities_repair_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_repair facilities_repairs;
BEGIN
 SELECT * INTO current_repair FROM facilities_repairs WHERE id=NEW.id AND school_id=NEW.school_id;
 IF NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.repair_id=NEW.id AND receipt.revision=NEW.revision
  AND receipt.state=NEW.state AND receipt.wait_reason IS NOT DISTINCT FROM NEW.wait_reason AND receipt.expected_finish_at IS NOT DISTINCT FROM NEW.expected_finish_at
  AND receipt.handler_person_id=NEW.handler_person_id AND receipt.verifier_person_id=NEW.verifier_person_id AND receipt.coordinator_person_id=NEW.coordinator_person_id AND receipt.recorded_at=NEW.updated_at)
 THEN RAISE EXCEPTION 'Every repair revision needs its exact immutable native operation.' USING ERRCODE='23514';END IF;
 IF current_repair.coordination_receipt='{}'::jsonb OR NOT EXISTS(SELECT 1 FROM campus_model_events event
  WHERE event.id::text=current_repair.coordination_receipt->>'event_id' AND event.school_id=current_repair.school_id
   AND event.source_domain='facilities' AND event.source_record_id=current_repair.id::text AND event.source_revision=current_repair.revision
   AND event.source_revision::text=current_repair.coordination_receipt->>'source_revision')
 THEN RAISE EXCEPTION 'A repair needs exact retained coordination evidence.' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND NEW.coordinator_person_id IS DISTINCT FROM(SELECT handler_person_id FROM facilities_intake_rules WHERE id=NEW.rule_id AND school_id=NEW.school_id)
 THEN RAISE EXCEPTION 'The initial repair coordinator must match its explicit intake rule.' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND(NEW.handler_person_id IS DISTINCT FROM OLD.handler_person_id OR NEW.verifier_person_id IS DISTINCT FROM OLD.verifier_person_id OR NEW.coordinator_person_id IS DISTINCT FROM OLD.coordinator_person_id)
  AND NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt WHERE receipt.repair_id=NEW.id AND receipt.school_id=NEW.school_id AND receipt.revision=NEW.revision AND receipt.action='assigned'
   AND(NEW.handler_person_id IS NOT DISTINCT FROM OLD.handler_person_id OR receipt.previous_handler_person_id=OLD.handler_person_id)
   AND(NEW.verifier_person_id IS NOT DISTINCT FROM OLD.verifier_person_id OR receipt.previous_verifier_person_id=OLD.verifier_person_id)
   AND(NEW.coordinator_person_id IS NOT DISTINCT FROM OLD.coordinator_person_id OR receipt.previous_coordinator_person_id=OLD.coordinator_person_id))
 THEN RAISE EXCEPTION 'Responsibility changes need their exact previous/new assignment receipt.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION facilities_repair_next_owner_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN campus_model_agents agent ON agent.school_id=repair.school_id
  AND agent.person_id=CASE WHEN repair.state='awaiting_verification' THEN repair.verifier_person_id ELSE repair.handler_person_id END
  JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account'
  WHERE repair.school_id=tenant AND repair.id=repair_id AND campus_model_account_person_is_active(tenant,endpoint.user_id,agent.person_id,now()))
$$;
CREATE FUNCTION facilities_repair_coordination_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT facilities_repair_next_owner_available(tenant,repair_id) AND EXISTS(SELECT 1 FROM facilities_repairs repair
  JOIN campus_model_agents agent ON agent.school_id=repair.school_id AND agent.person_id=repair.coordinator_person_id
  JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account'
  WHERE repair.school_id=tenant AND repair.id=repair_id AND campus_model_account_person_is_active(tenant,endpoint.user_id,agent.person_id,now()))
$$;
CREATE OR REPLACE FUNCTION facilities_receipt_participant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE repair facilities_repairs;
BEGIN
 SELECT * INTO repair FROM facilities_repairs WHERE school_id=NEW.school_id AND id=NEW.repair_id;
 IF NEW.action='reported' AND(NEW.actor_person_id<>repair.recorder_person_id OR repair.reporter_person_id<>NEW.actor_person_id AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id))
  OR NEW.action IN('accepted','updated','completed') AND NEW.actor_person_id<>repair.handler_person_id
  OR NEW.action='verified' AND NEW.actor_person_id<>repair.verifier_person_id
  OR NEW.action='reopened' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.verifier_person_id)
  OR NEW.action='assigned' AND NEW.actor_person_id IS DISTINCT FROM repair.coordinator_person_id AND NEW.actor_person_id IS DISTINCT FROM NEW.previous_coordinator_person_id AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id)
  OR NEW.action='photo_added' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.recorder_person_id,repair.handler_person_id,repair.verifier_person_id,repair.coordinator_person_id)
 THEN RAISE EXCEPTION 'A repair operation needs its exact current participant authority.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION facilities_event_recipient_valid(tenant uuid,payload jsonb,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair WHERE repair.school_id=tenant AND repair.id::text=payload->>'repair_id'
  AND(campus_model_account_person_is_active(tenant,actor,repair.reporter_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.recorder_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.handler_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.verifier_person_id,now())
   OR campus_model_account_person_is_active(tenant,actor,repair.coordinator_person_id,now())))
$$;
REVOKE ALL ON FUNCTION facilities_repair_coordination_available(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='facilities_repairs'::regclass;
 EXECUTE format('ALTER FUNCTION facilities_repair_coordination_available(uuid,uuid) OWNER TO %I',owner_name);
END $$;
