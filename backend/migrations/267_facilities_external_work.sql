-- A neutral identity can join for one explicitly assigned job without acquiring
-- campus browsing. Another independent campus membership remains additive.
ALTER TABLE school_memberships ADD COLUMN access_scope text NOT NULL DEFAULT 'campus'
 CHECK(access_scope IN('campus','assigned_work'));
ALTER TABLE school_memberships ADD CONSTRAINT school_membership_work_scope CHECK(access_scope='campus' OR role='member');
ALTER TABLE school_invitations ADD COLUMN access_scope text NOT NULL DEFAULT 'campus'
 CHECK(access_scope IN('campus','assigned_work'));
ALTER TABLE school_invitations ADD COLUMN work_source_kind text;
ALTER TABLE school_invitations ADD COLUMN work_source_id uuid;
ALTER TABLE school_invitations ADD COLUMN work_access_id uuid;
ALTER TABLE school_invitations ADD CONSTRAINT school_invitation_work_scope CHECK(
 access_scope='campus' AND num_nonnulls(work_source_kind,work_source_id,work_access_id)=0
 OR access_scope='assigned_work' AND role='member' AND source='school' AND person_id IS NOT NULL
  AND work_source_kind='facility_repair' AND work_source_id IS NOT NULL AND work_access_id IS NOT NULL);

CREATE FUNCTION campus_membership_is_work_only(tenant uuid,account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships WHERE school_id=tenant AND user_id=account AND is_active)
  AND NOT EXISTS(SELECT 1 FROM school_memberships WHERE school_id=tenant AND user_id=account AND is_active AND access_scope='campus')
$$;

CREATE TABLE facilities_external_assignments (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,repair_id uuid NOT NULL,source_revision integer NOT NULL CHECK(source_revision>1),
 person_id uuid NOT NULL,person_revision integer NOT NULL CHECK(person_revision>0),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 instructions varchar(2000) NOT NULL CHECK(length(trim(instructions))>=3),shared_photo_ids uuid[] NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK(status IN('granted','ended')),previous_assignment_id uuid,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(id,school_id,repair_id,person_id),UNIQUE(school_id,repair_id,source_revision),UNIQUE(school_id,command_id),
 FOREIGN KEY(repair_id,school_id) REFERENCES facilities_repairs(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(previous_assignment_id,school_id) REFERENCES facilities_external_assignments(id,school_id) ON DELETE RESTRICT,
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '365 days'),CHECK(cardinality(shared_photo_ids)<=20),CHECK(status<>'ended' OR previous_assignment_id IS NOT NULL)
);
CREATE INDEX facilities_external_person_idx ON facilities_external_assignments(school_id,person_id,ends_at,repair_id);
CREATE INDEX facilities_external_actor_idx ON facilities_external_assignments(school_id,actor_person_id);
CREATE INDEX facilities_external_previous_idx ON facilities_external_assignments(school_id,previous_assignment_id) WHERE previous_assignment_id IS NOT NULL;
ALTER TABLE facilities_repairs ADD COLUMN external_assignment_id uuid;
ALTER TABLE facilities_repairs ADD CONSTRAINT facilities_external_current_fk FOREIGN KEY(external_assignment_id,school_id)
 REFERENCES facilities_external_assignments(id,school_id) ON DELETE RESTRICT;
CREATE INDEX facilities_external_current_idx ON facilities_repairs(school_id,external_assignment_id) WHERE external_assignment_id IS NOT NULL;
ALTER TABLE facilities_repair_receipts ADD COLUMN external_assignment_id uuid;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_external_receipt_fk FOREIGN KEY(external_assignment_id,school_id)
 REFERENCES facilities_external_assignments(id,school_id) ON DELETE RESTRICT;
CREATE INDEX facilities_external_receipt_idx ON facilities_repair_receipts(school_id,external_assignment_id) WHERE external_assignment_id IS NOT NULL;
ALTER TABLE school_invitations ADD CONSTRAINT school_invitation_exact_work_fk
 FOREIGN KEY(work_access_id,school_id,work_source_id,person_id)
 REFERENCES facilities_external_assignments(id,school_id,repair_id,person_id) ON DELETE RESTRICT;
CREATE INDEX school_invitation_work_idx ON school_invitations(work_access_id,school_id,work_source_id,person_id) WHERE work_access_id IS NOT NULL;

CREATE FUNCTION school_invitation_work_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.access_scope,NEW.work_source_kind,NEW.work_source_id,NEW.work_access_id,NEW.person_id,NEW.school_id,NEW.email,NEW.created_by,NEW.role,NEW.source,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.access_scope,OLD.work_source_kind,OLD.work_source_id,OLD.work_access_id,OLD.person_id,OLD.school_id,OLD.email,OLD.created_by,OLD.role,OLD.source,OLD.created_at)
  AND (OLD.access_scope='assigned_work' OR NEW.access_scope='assigned_work')
 THEN RAISE EXCEPTION 'An invitation retains its exact work context.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER school_invitation_work_context_immutable BEFORE UPDATE ON school_invitations FOR EACH ROW EXECUTE FUNCTION school_invitation_work_context_guard();

CREATE TRIGGER facilities_external_immutable BEFORE UPDATE OR DELETE ON facilities_external_assignments FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE FUNCTION facilities_external_current(tenant uuid,source uuid,person uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN facilities_external_assignments access
  ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id AND access.repair_id=repair.id
  WHERE repair.school_id=tenant AND repair.id=source AND access.person_id=person AND access.status='granted'
   AND access.starts_at<=at_time AND access.ends_at>at_time)
$$;
CREATE FUNCTION facilities_person_internal_participant(tenant uuid,source uuid,person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair LEFT JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id
  WHERE repair.school_id=tenant AND repair.id=source AND(person IN(repair.reporter_person_id,repair.recorder_person_id,repair.coordinator_person_id,repair.verifier_person_id)
   OR person=repair.handler_person_id AND(access.id IS NULL OR access.person_id<>person)))
$$;
CREATE FUNCTION facilities_person_can_read(tenant uuid,source uuid,person uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT facilities_person_internal_participant(tenant,source,person) OR facilities_external_current(tenant,source,person,at_time)
$$;

-- A source-scoped person cannot be promoted to campus-wide responsibility by
-- assigning a repair. Retained source authority ends at the same date everywhere.
CREATE OR REPLACE FUNCTION facilities_repair_next_owner_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN campus_model_agents agent ON agent.school_id=repair.school_id
  AND agent.person_id=CASE WHEN repair.state='awaiting_verification' THEN repair.verifier_person_id ELSE repair.handler_person_id END
  JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account'
  LEFT JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id
  WHERE repair.school_id=tenant AND repair.id=$2 AND campus_model_account_person_is_active(tenant,endpoint.user_id,agent.person_id,now())
   AND(repair.state='awaiting_verification' OR access.id IS NULL OR access.person_id<>repair.handler_person_id
    OR access.status='granted' AND access.starts_at<=now() AND access.ends_at>now())
   AND(repair.state='awaiting_verification' OR access.id IS NULL OR access.status='ended' OR access.person_id=repair.handler_person_id))
$$;
CREATE OR REPLACE FUNCTION facilities_repair_coordination_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair
  JOIN campus_model_current_account_endpoints(tenant,NULL,now()) coordinator ON coordinator.person_id=repair.coordinator_person_id
  LEFT JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id
  WHERE repair.school_id=tenant AND repair.id=$2 AND(facilities_repair_next_owner_available(tenant,$2)
   OR access.status='granted' AND access.ends_at>now() AND repair.handler_person_id<>access.person_id AND repair.state NOT IN('awaiting_verification','closed')))
$$;
CREATE FUNCTION facilities_external_issuer_valid(tenant uuid,source uuid,actor uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT NOT campus_membership_is_work_only(tenant,actor) AND EXISTS(SELECT 1 FROM facilities_repairs repair
  JOIN campus_model_current_account_endpoints(tenant,actor,at_time) endpoint ON true
  LEFT JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id
  WHERE repair.school_id=tenant AND repair.id=source AND(endpoint.person_id=repair.coordinator_person_id
   OR facilities_actor_can_manage(tenant,actor) AND(
    NOT EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(tenant,NULL,at_time) contact WHERE contact.person_id=repair.coordinator_person_id)
    OR NOT facilities_repair_coordination_available(tenant,source) AND NOT coalesce(access.status='granted' AND access.ends_at>at_time AND repair.handler_person_id<>access.person_id AND repair.state<>'awaiting_verification',false))))
$$;
-- Receipt checks run after the new row is written. Recovery must be evaluated
-- against the retained prior responsibility, not the newly restored handler.
CREATE FUNCTION facilities_receipt_coordinator_valid(tenant uuid,source uuid,prior_revision integer,actor uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT NOT campus_membership_is_work_only(tenant,actor) AND EXISTS(SELECT 1 FROM facilities_repair_receipts prior
  JOIN campus_model_current_account_endpoints(tenant,actor,at_time) signer ON true
  LEFT JOIN facilities_external_assignments access ON access.id=prior.external_assignment_id AND access.school_id=prior.school_id
  WHERE prior.school_id=tenant AND prior.repair_id=source AND prior.revision=prior_revision
   AND(signer.person_id=prior.coordinator_person_id OR facilities_actor_can_manage(tenant,actor) AND(
    NOT EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(tenant,NULL,at_time) contact WHERE contact.person_id=prior.coordinator_person_id)
    OR CASE WHEN access.status='granted' AND prior.handler_person_id<>access.person_id AND prior.state<>'awaiting_verification'
     THEN access.ends_at<=at_time ELSE NOT EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(tenant,NULL,at_time) recipient
      WHERE recipient.person_id=CASE WHEN prior.state='awaiting_verification' THEN prior.verifier_person_id ELSE prior.handler_person_id END
       AND(prior.state='awaiting_verification' OR access.id IS NULL OR access.person_id<>prior.handler_person_id
        OR access.status='granted' AND access.starts_at<=at_time AND access.ends_at>at_time)) END)))
$$;
CREATE OR REPLACE FUNCTION facilities_repair_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Repairs retain their history.' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordinator_person_id','coordination_receipt','external_assignment_id'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','wait_reason','expected_finish_at','revision','updated_at','handler_person_id','verifier_person_id','coordinator_person_id','coordination_receipt','external_assignment_id'])
  OR NEW.revision NOT IN(OLD.revision,OLD.revision+1)
  OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'A repair change needs its next exact operation revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
ALTER TABLE facilities_repair_receipts DROP CONSTRAINT facilities_repair_receipts_action_check;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_repair_receipts_action_check
 CHECK(action IN('reported','accepted','assigned','updated','completed','verified','reopened','photo_added','external_shared','external_ready','external_ended'));
ALTER TABLE facilities_repair_receipts DROP CONSTRAINT facilities_assignment_exact_target;
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_assignment_exact_target CHECK(
 num_nonnulls(previous_handler_person_id,previous_verifier_person_id,previous_coordinator_person_id)<=1
 AND(action IN('assigned','external_ready') AND num_nonnulls(previous_handler_person_id,previous_verifier_person_id,previous_coordinator_person_id)=1
  OR action='external_ended' OR action NOT IN('assigned','external_ready','external_ended') AND num_nonnulls(previous_handler_person_id,previous_verifier_person_id,previous_coordinator_person_id)=0));

CREATE OR REPLACE FUNCTION facilities_repair_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_repair facilities_repairs;
BEGIN
 SELECT * INTO current_repair FROM facilities_repairs WHERE id=NEW.id AND school_id=NEW.school_id;
 IF NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.repair_id=NEW.id AND receipt.revision=NEW.revision
  AND receipt.state=NEW.state AND receipt.wait_reason IS NOT DISTINCT FROM NEW.wait_reason AND receipt.expected_finish_at IS NOT DISTINCT FROM NEW.expected_finish_at
  AND receipt.handler_person_id=NEW.handler_person_id AND receipt.verifier_person_id=NEW.verifier_person_id AND receipt.coordinator_person_id=NEW.coordinator_person_id
  AND receipt.external_assignment_id IS NOT DISTINCT FROM NEW.external_assignment_id AND receipt.recorded_at=NEW.updated_at)
 THEN RAISE EXCEPTION 'Every repair revision needs its exact immutable native operation.' USING ERRCODE='23514';END IF;
 IF current_repair.coordination_receipt='{}'::jsonb OR NOT EXISTS(SELECT 1 FROM campus_model_events event
  WHERE event.id::text=current_repair.coordination_receipt->>'event_id' AND event.school_id=current_repair.school_id
   AND event.source_domain='facilities' AND event.source_record_id=current_repair.id::text AND event.source_revision=current_repair.revision
   AND event.source_revision::text=current_repair.coordination_receipt->>'source_revision')
 THEN RAISE EXCEPTION 'A repair needs exact retained coordination evidence.' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND NEW.coordinator_person_id IS DISTINCT FROM(SELECT handler_person_id FROM facilities_intake_rules WHERE id=NEW.rule_id AND school_id=NEW.school_id)
 THEN RAISE EXCEPTION 'The initial repair coordinator must match its explicit intake rule.' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND(NEW.handler_person_id IS DISTINCT FROM OLD.handler_person_id OR NEW.verifier_person_id IS DISTINCT FROM OLD.verifier_person_id OR NEW.coordinator_person_id IS DISTINCT FROM OLD.coordinator_person_id)
  AND NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt WHERE receipt.repair_id=NEW.id AND receipt.school_id=NEW.school_id AND receipt.revision=NEW.revision
   AND receipt.action IN('assigned','external_ready','external_ended')
   AND(NEW.handler_person_id IS NOT DISTINCT FROM OLD.handler_person_id OR receipt.previous_handler_person_id=OLD.handler_person_id)
   AND(NEW.verifier_person_id IS NOT DISTINCT FROM OLD.verifier_person_id OR receipt.previous_verifier_person_id=OLD.verifier_person_id)
   AND(NEW.coordinator_person_id IS NOT DISTINCT FROM OLD.coordinator_person_id OR receipt.previous_coordinator_person_id=OLD.coordinator_person_id))
 THEN RAISE EXCEPTION 'Responsibility changes need their exact previous/new assignment receipt.' USING ERRCODE='23514';END IF;
 IF NEW.external_assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM facilities_external_assignments access WHERE access.id=NEW.external_assignment_id AND access.school_id=NEW.school_id AND access.repair_id=NEW.id)
 THEN RAISE EXCEPTION 'External work must belong to this exact repair.' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND NEW.external_assignment_id IS DISTINCT FROM OLD.external_assignment_id AND NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt
  WHERE receipt.school_id=NEW.school_id AND receipt.repair_id=NEW.id AND receipt.revision=NEW.revision AND receipt.action IN('external_shared','external_ended'))
 THEN RAISE EXCEPTION 'External access changes need their own immutable operation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION facilities_receipt_participant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE repair facilities_repairs;access facilities_external_assignments;internal_actor boolean;
BEGIN
 SELECT * INTO repair FROM facilities_repairs WHERE school_id=NEW.school_id AND id=NEW.repair_id;
 SELECT * INTO access FROM facilities_external_assignments WHERE id=repair.external_assignment_id AND school_id=repair.school_id;
 internal_actor:=facilities_person_internal_participant(NEW.school_id,NEW.repair_id,NEW.actor_person_id);
 IF NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,now())
  OR NEW.action='reported' AND(NEW.actor_person_id<>repair.recorder_person_id OR campus_membership_is_work_only(NEW.school_id,NEW.actor_user_id)
    OR repair.reporter_person_id<>NEW.actor_person_id AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id))
  OR NEW.action IN('accepted','updated','completed') AND(NEW.actor_person_id<>repair.handler_person_id
   OR access.person_id=NEW.actor_person_id AND NOT facilities_external_current(NEW.school_id,NEW.repair_id,NEW.actor_person_id,now()))
  OR NEW.action='verified' AND(NEW.actor_person_id<>repair.verifier_person_id OR access.person_id=NEW.actor_person_id)
  OR NEW.action='reopened' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.verifier_person_id)
  OR NEW.action IN('assigned','external_shared','external_ended') AND NOT facilities_receipt_coordinator_valid(NEW.school_id,NEW.repair_id,NEW.revision-1,NEW.actor_user_id,now())
  OR NEW.action='external_ready' AND(access.id IS NULL OR access.person_id<>NEW.actor_person_id OR repair.handler_person_id<>NEW.actor_person_id
   OR NOT facilities_external_current(NEW.school_id,NEW.repair_id,NEW.actor_person_id,now()) OR repair.state<>'reported')
  OR NEW.action='photo_added' AND NOT(internal_actor OR facilities_external_current(NEW.school_id,NEW.repair_id,NEW.actor_person_id,now()))
 THEN RAISE EXCEPTION 'A repair operation needs its exact current participant authority.' USING ERRCODE='23514';END IF;
 IF access.person_id=NEW.actor_person_id AND(NEW.action IN('external_ready','accepted','updated','completed') OR NEW.action='photo_added' AND NOT internal_actor)
  AND NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
   WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND authority.valid_until=access.ends_at AND authority.decision='allowed')
 THEN RAISE EXCEPTION 'External command authority must retain the exact source expiry.' USING ERRCODE='23514';END IF;
 IF NEW.action='assigned' AND access.id IS NOT NULL AND(access.person_id=repair.coordinator_person_id OR access.person_id=repair.verifier_person_id
  OR NEW.previous_handler_person_id IS NOT NULL AND(access.status='granted' OR access.person_id=repair.handler_person_id))
 THEN RAISE EXCEPTION 'End external access before changing its responsibility.' USING ERRCODE='23514';END IF;
 IF NEW.action='assigned' AND NOT EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(NEW.school_id,NULL,now()) target
  WHERE target.person_id=CASE WHEN NEW.previous_coordinator_person_id IS NOT NULL THEN NEW.coordinator_person_id
   WHEN NEW.previous_verifier_person_id IS NOT NULL THEN NEW.verifier_person_id ELSE NEW.handler_person_id END
   AND NOT campus_membership_is_work_only(NEW.school_id,target.user_id))
 THEN RAISE EXCEPTION 'Internal repair responsibility needs a current campus-scoped recipient.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE FUNCTION facilities_external_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE repair facilities_repairs;previous facilities_external_assignments;recipient school_people;
BEGIN
 SELECT * INTO repair FROM facilities_repairs WHERE id=NEW.repair_id AND school_id=NEW.school_id;
 SELECT * INTO recipient FROM school_people WHERE id=NEW.person_id AND school_id=NEW.school_id;
 IF NOT FOUND OR NEW.status='granted' AND(recipient.retired_at IS NOT NULL OR recipient.revision<>NEW.person_revision)
  OR NEW.person_id IN(repair.coordinator_person_id,repair.verifier_person_id)
  OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,now())
  OR NOT facilities_external_issuer_valid(NEW.school_id,NEW.repair_id,NEW.actor_user_id,now())
  OR NEW.source_revision<>repair.revision+1 OR NEW.status='granted' AND repair.state IN('closed','awaiting_verification')
  OR NEW.ends_at<=NEW.recorded_at AND NEW.status='granted'
  OR EXISTS(SELECT 1 FROM unnest(NEW.shared_photo_ids) photo WHERE NOT EXISTS(SELECT 1 FROM facilities_repair_photos source WHERE source.id=photo AND source.school_id=NEW.school_id AND source.repair_id=NEW.repair_id))
  OR cardinality(NEW.shared_photo_ids)<>(SELECT count(DISTINCT photo) FROM unnest(NEW.shared_photo_ids) photo)
 THEN RAISE EXCEPTION 'External access needs its exact current coordinator, person, dates and selected evidence.' USING ERRCODE='23514';END IF;
 IF NEW.previous_assignment_id IS DISTINCT FROM repair.external_assignment_id THEN RAISE EXCEPTION 'External access must retain the prior source version.' USING ERRCODE='23514';END IF;
 SELECT * INTO previous FROM facilities_external_assignments WHERE id=NEW.previous_assignment_id AND school_id=NEW.school_id;
 IF NEW.status='granted' AND(NEW.person_id=repair.handler_person_id OR previous.person_id=repair.handler_person_id)
 THEN RAISE EXCEPTION 'End the existing worker scope before replacing its identity.' USING ERRCODE='23514';END IF;
 IF NEW.status='ended' THEN
  IF previous.status<>'granted' OR ROW(NEW.person_id,NEW.starts_at,NEW.ends_at,NEW.instructions,NEW.shared_photo_ids)
   IS DISTINCT FROM ROW(previous.person_id,previous.starts_at,previous.ends_at,previous.instructions,previous.shared_photo_ids)
  THEN RAISE EXCEPTION 'Ending access retains the accepted grant.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER facilities_external_source_scope BEFORE INSERT ON facilities_external_assignments FOR EACH ROW EXECUTE FUNCTION facilities_external_source_guard();
CREATE FUNCTION facilities_external_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facilities_repair_receipts receipt JOIN facilities_repairs repair ON repair.id=receipt.repair_id AND repair.school_id=receipt.school_id
  JOIN campus_model_commands command ON command.id=receipt.command_id AND command.school_id=receipt.school_id
  WHERE receipt.school_id=NEW.school_id AND receipt.repair_id=NEW.repair_id AND receipt.revision=NEW.source_revision AND receipt.command_id=NEW.command_id
   AND receipt.external_assignment_id=NEW.id AND receipt.actor_person_id=NEW.actor_person_id AND receipt.actor_user_id=NEW.actor_user_id
   AND receipt.recorded_at=NEW.recorded_at AND receipt.action=CASE WHEN NEW.status='granted' THEN 'external_shared' ELSE 'external_ended' END
   AND command.safe_context->'external_scope'=jsonb_build_object('person_id',NEW.person_id::text,'person_revision',NEW.person_revision,
    'starts_ms',(extract(epoch FROM NEW.starts_at)*1000)::bigint,'ends_ms',(extract(epoch FROM NEW.ends_at)*1000)::bigint,
    'instructions_hash',encode(digest(NEW.instructions,'sha256'),'hex'),'shared_photo_ids',to_jsonb(NEW.shared_photo_ids),
    'status',NEW.status,'previous_assignment_id',NEW.previous_assignment_id)
   AND facilities_event_source_valid(NEW.school_id,'facilities.repair.'||receipt.action,'facility_repair_event',NEW.repair_id,
    jsonb_build_object('repair_id',NEW.repair_id::text,'revision',NEW.source_revision,'action',receipt.action,'source_command_id',NEW.command_id::text)))
 THEN RAISE EXCEPTION 'External access needs its exact accepted native command and event.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER facilities_external_command_complete AFTER INSERT ON facilities_external_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facilities_external_command_guard();

CREATE FUNCTION school_invitation_work_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE access facilities_external_assignments;repair facilities_repairs;
BEGIN
 IF NEW.access_scope<>'assigned_work' THEN RETURN NEW;END IF;
 IF current_schema()<>'public' OR NOT EXISTS(SELECT 1 FROM campus_model_commands command
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_entities person ON person.id=command.target_entity_id AND person.school_id=command.school_id
  JOIN campus_model_agents issuer ON issuer.id=command.actor_agent_id AND issuer.school_id=command.school_id
  WHERE command.school_id=NEW.school_id AND command.command_type='people.account.invite' AND command.source_domain='people'
   AND command.handler_key='people.app_access' AND command.handler_version=1 AND command.state='accepted'
   AND command.correlation_id=NEW.id AND outcome.metadata->>'invitation_id'=NEW.id::text
   AND command.idempotency_key LIKE 'person-invite:'||NEW.created_by::text||':%'
   AND command.safe_context->>'recipient_email_hash'=encode(digest('people-invite:'||NEW.id::text||':'||NEW.email,'sha256'),'hex')
   AND command.environment_namespace_id='live:'||NEW.school_id::text
   AND command.safe_context->'work_context'=jsonb_build_object('kind','facility_repair','source_id',NEW.work_source_id::text,'access_id',NEW.work_access_id::text)
   AND command.safe_context->>'person_id'=NEW.person_id::text AND person.kind='person' AND person.domain='people' AND person.domain_id=NEW.person_id::text
   AND(NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL OR campus_model_account_person_is_active(NEW.school_id,NEW.created_by,issuer.person_id,statement_timestamp())))
 THEN RAISE EXCEPTION 'A work invitation needs its exact accepted People command.' USING ERRCODE='23514';END IF;
 IF NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO repair FROM facilities_repairs WHERE id=NEW.work_source_id AND school_id=NEW.school_id;
 SELECT * INTO access FROM facilities_external_assignments WHERE id=NEW.work_access_id AND school_id=NEW.school_id;
 IF repair.external_assignment_id IS DISTINCT FROM access.id OR access.status<>'granted' OR access.person_id<>NEW.person_id OR access.ends_at<=statement_timestamp()
  OR NOT facilities_external_issuer_valid(NEW.school_id,repair.id,NEW.created_by,statement_timestamp())
  OR NEW.accepted_at IS NOT NULL AND NOT campus_model_account_person_is_active(NEW.school_id,NEW.accepted_by_user_id,NEW.person_id,statement_timestamp())
 THEN RAISE EXCEPTION 'This work invitation needs its current exact source and recipient.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER school_invitation_work_native_complete AFTER INSERT OR UPDATE ON school_invitations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_invitation_work_native_guard();
CREATE FUNCTION school_membership_work_scope_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.access_scope IS DISTINCT FROM OLD.access_scope THEN RAISE EXCEPTION 'Campus membership scope needs its owning transition, not an in-place promotion.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER school_membership_work_scope_immutable BEFORE UPDATE ON school_memberships FOR EACH ROW EXECUTE FUNCTION school_membership_work_scope_guard();
CREATE FUNCTION school_membership_work_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.access_scope='assigned_work' AND NOT EXISTS(SELECT 1 FROM school_invitations invitation
  JOIN facilities_repairs repair ON repair.id=invitation.work_source_id AND repair.school_id=invitation.school_id
  JOIN facilities_external_assignments access ON access.id=invitation.work_access_id AND access.school_id=invitation.school_id AND access.repair_id=repair.id
  WHERE invitation.school_id=NEW.school_id AND invitation.role='member' AND invitation.access_scope='assigned_work'
   AND invitation.accepted_by_user_id=NEW.user_id AND invitation.accepted_at IS NOT NULL AND invitation.revoked_at IS NULL
   AND invitation.expires_at>invitation.accepted_at AND repair.external_assignment_id=access.id AND access.person_id=invitation.person_id
   AND access.status='granted' AND access.ends_at>statement_timestamp()
   AND campus_model_account_person_is_active(NEW.school_id,NEW.user_id,access.person_id,statement_timestamp()))
 THEN RAISE EXCEPTION 'Assigned-work membership needs its exact accepted source invitation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER school_membership_work_source_complete AFTER INSERT ON school_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_membership_work_source_guard();

CREATE OR REPLACE FUNCTION facilities_event_recipient_valid(tenant uuid,payload jsonb,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN campus_model_agents agent ON agent.school_id=repair.school_id
  JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account' AND endpoint.user_id=actor
  WHERE repair.school_id=tenant AND repair.id::text=payload->>'repair_id' AND campus_model_account_person_is_active(tenant,actor,agent.person_id,now())
   AND(facilities_person_can_read(tenant,repair.id,agent.person_id,now()) OR payload->>'action'='external_ended' AND EXISTS(
    SELECT 1 FROM facilities_repair_receipts receipt JOIN facilities_external_assignments access ON access.id=receipt.external_assignment_id AND access.school_id=receipt.school_id
    WHERE receipt.school_id=tenant AND receipt.repair_id=repair.id AND receipt.revision::text=payload->>'revision' AND receipt.action='external_ended' AND access.person_id=agent.person_id)))
$$;
DO $$ DECLARE previous_body text;BEGIN
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $work_only_267$
  SELECT CASE WHEN campus_membership_is_work_only(event_school_id,candidate_user_id)
   THEN event_name='facilities.updated' AND facilities_event_recipient_valid(event_school_id,event_payload,candidate_user_id)
   ELSE (%s) END $work_only_267$ $definition$,previous_body);
END $$;

ALTER TABLE facilities_external_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON facilities_external_assignments FROM PUBLIC;
DO $$ DECLARE owner_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='facilities_repairs'::regclass;
 EXECUTE format('ALTER TABLE facilities_external_assignments OWNER TO %I',owner_name);
 FOREACH signature IN ARRAY ARRAY['campus_membership_is_work_only(uuid,uuid)','school_invitation_work_context_guard()',
  'facilities_external_current(uuid,uuid,uuid,timestamptz)','facilities_person_internal_participant(uuid,uuid,uuid)',
  'facilities_person_can_read(uuid,uuid,uuid,timestamptz)','facilities_external_issuer_valid(uuid,uuid,uuid,timestamptz)',
  'facilities_receipt_coordinator_valid(uuid,uuid,integer,uuid,timestamptz)',
  'facilities_external_source_guard()','facilities_external_command_guard()','school_invitation_work_native_guard()',
  'school_membership_work_scope_guard()','school_membership_work_source_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
COMMENT ON TABLE facilities_external_assignments IS 'Immutable exact-person repair access versions. Shared instructions/photos are explicit; identity joining is not acceptance and source expiry is not physical movement.';
