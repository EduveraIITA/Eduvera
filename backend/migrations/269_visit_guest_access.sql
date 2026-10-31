-- Exact organiser access and private questions extend Gate's accepted plan.
-- They confer no admission, movement, room, directory or campus-wide authority.
CREATE TABLE gate_visit_shares (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,visit_id uuid NOT NULL,root_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),organiser_person_id uuid NOT NULL,organiser_person_revision integer NOT NULL CHECK(organiser_person_revision>0),
 party_person_id uuid,party_guest_name varchar(150),baseline_visit_revision integer NOT NULL CHECK(baseline_visit_revision>0),
 owner_person_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 directions varchar(1000) NOT NULL,status text NOT NULL CHECK(status IN('granted','revoked')),
 action text NOT NULL CHECK(action IN('shared','renewed','revoked','taken_over')),previous_share_id uuid,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 domain_event_id uuid NOT NULL REFERENCES campus_model_events(id) ON DELETE RESTRICT,recorded_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(id,school_id,visit_id,organiser_person_id),UNIQUE(school_id,visit_id,revision),UNIQUE(command_id),
 FOREIGN KEY(visit_id,school_id) REFERENCES gate_visit_arrangements(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(root_id,school_id) REFERENCES gate_visit_shares(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(previous_share_id,school_id) REFERENCES gate_visit_shares(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(organiser_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(party_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK((party_person_id IS NULL)<>(party_guest_name IS NULL))
);
CREATE INDEX gate_visit_share_latest_idx ON gate_visit_shares(school_id,visit_id,revision DESC);
CREATE INDEX gate_visit_share_root_idx ON gate_visit_shares(school_id,root_id,revision DESC);
CREATE INDEX gate_visit_share_organiser_idx ON gate_visit_shares(school_id,organiser_person_id,ends_at,visit_id);
CREATE INDEX gate_visit_share_owner_idx ON gate_visit_shares(owner_person_id,school_id);
CREATE INDEX gate_visit_share_party_idx ON gate_visit_shares(party_person_id,school_id) WHERE party_person_id IS NOT NULL;
CREATE INDEX gate_visit_share_actor_idx ON gate_visit_shares(actor_person_id,school_id);
CREATE INDEX gate_visit_share_account_idx ON gate_visit_shares(actor_user_id);
CREATE INDEX gate_visit_share_event_idx ON gate_visit_shares(domain_event_id);
CREATE UNIQUE INDEX gate_visit_share_next_idx ON gate_visit_shares(previous_share_id,school_id) WHERE previous_share_id IS NOT NULL;

CREATE TABLE gate_visit_questions (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,visit_id uuid NOT NULL,share_root_id uuid NOT NULL,
 organiser_person_id uuid NOT NULL,owner_person_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN('waiting_for_review','answered','withdrawn')),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),
 last_command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 last_domain_event_id uuid NOT NULL REFERENCES campus_model_events(id) ON DELETE RESTRICT,coordination_receipt jsonb,
 UNIQUE(id,school_id),UNIQUE(share_root_id,school_id),
 FOREIGN KEY(share_root_id,school_id,visit_id,organiser_person_id) REFERENCES gate_visit_shares(id,school_id,visit_id,organiser_person_id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX gate_visit_question_visit_idx ON gate_visit_questions(visit_id,school_id);
CREATE INDEX gate_visit_question_owner_idx ON gate_visit_questions(school_id,owner_person_id,state,created_at);
CREATE INDEX gate_visit_question_organiser_idx ON gate_visit_questions(school_id,organiser_person_id,state);
CREATE INDEX gate_visit_question_command_idx ON gate_visit_questions(last_command_id);
CREATE INDEX gate_visit_question_event_idx ON gate_visit_questions(last_domain_event_id);

CREATE TABLE gate_visit_question_entries (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,visit_id uuid NOT NULL,question_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 share_id uuid NOT NULL,action text NOT NULL CHECK(action IN('asked','replied','rerouted','withdrawn')),
 note varchar(2000) NOT NULL,actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_label text NOT NULL,command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
 domain_event_id uuid NOT NULL REFERENCES campus_model_events(id) ON DELETE RESTRICT,recorded_at timestamptz NOT NULL,snapshot jsonb NOT NULL,
 UNIQUE(question_id,revision),UNIQUE(command_id),
 FOREIGN KEY(question_id,school_id) REFERENCES gate_visit_questions(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(share_id,school_id) REFERENCES gate_visit_shares(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(visit_id,school_id) REFERENCES gate_visit_arrangements(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK(action IN('rerouted','withdrawn') AND note='' OR action IN('asked','replied') AND length(btrim(note))>0)
);
CREATE INDEX gate_visit_question_entry_tenant_idx ON gate_visit_question_entries(school_id,question_id,revision DESC);
CREATE INDEX gate_visit_question_entry_share_idx ON gate_visit_question_entries(share_id,school_id);
CREATE INDEX gate_visit_question_entry_visit_idx ON gate_visit_question_entries(visit_id,school_id);
CREATE INDEX gate_visit_question_entry_actor_idx ON gate_visit_question_entries(actor_person_id,school_id);
CREATE INDEX gate_visit_question_entry_account_idx ON gate_visit_question_entries(actor_user_id);
CREATE INDEX gate_visit_question_entry_event_idx ON gate_visit_question_entries(domain_event_id);

CREATE FUNCTION gate_visit_share_party_valid(tenant uuid,share_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_shares share JOIN gate_visit_arrangements visit ON visit.school_id=share.school_id AND visit.id=share.visit_id
  WHERE share.school_id=tenant AND share.id=$2 AND visit.revision>=share.baseline_visit_revision
   AND visit.person_id IS NOT DISTINCT FROM share.party_person_id AND visit.guest_name IS NOT DISTINCT FROM share.party_guest_name
   AND NOT EXISTS(SELECT 1 FROM gate_visit_arrangement_revisions version WHERE version.school_id=share.school_id AND version.visit_id=share.visit_id
    AND version.revision>=share.baseline_visit_revision AND(
     coalesce(version.snapshot->'person_id','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(share.party_person_id),'null'::jsonb)
     OR version.snapshot->>'guest_name' IS DISTINCT FROM share.party_guest_name)))
$$;
CREATE FUNCTION gate_visit_share_current(tenant uuid,visit_id uuid,person_id uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_shares share JOIN school_people person ON person.school_id=share.school_id AND person.id=share.organiser_person_id AND person.retired_at IS NULL
  WHERE share.school_id=tenant AND share.visit_id=$2 AND share.organiser_person_id=$3 AND share.status='granted'
   AND share.starts_at<=at_time AND share.ends_at>at_time AND gate_visit_share_party_valid(tenant,share.id)
   AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=tenant AND later.visit_id=$2 AND later.revision>share.revision))
$$;
CREATE FUNCTION gate_visit_share_owner_available(tenant uuid,share_id uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_shares share
  JOIN campus_model_current_account_endpoints(tenant,NULL,at_time) endpoint ON endpoint.person_id=share.owner_person_id
  WHERE share.school_id=tenant AND share.id=$2 AND gate_visit_actor_can_manage(tenant,endpoint.user_id))
$$;
CREATE FUNCTION gate_visit_share_issuer_valid(tenant uuid,visit_id uuid,share_id uuid,actor_user_id uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_shares share WHERE share.school_id=tenant AND share.visit_id=$2 AND share.id=$3
  AND gate_visit_share_current(tenant,$2,share.organiser_person_id,at_time)
  AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=tenant AND later.visit_id=$2 AND later.revision>share.revision)
  AND campus_model_account_person_is_active(tenant,$4,share.owner_person_id,at_time) AND gate_visit_actor_can_manage(tenant,$4))
$$;
CREATE FUNCTION gate_visit_sharing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Shared visit versions and question entries retain immutable evidence.' USING ERRCODE='23514';END $$;
CREATE TRIGGER gate_visit_share_immutable BEFORE UPDATE OR DELETE ON gate_visit_shares FOR EACH ROW EXECUTE FUNCTION gate_visit_sharing_immutable();
CREATE TRIGGER gate_visit_question_entry_immutable BEFORE UPDATE OR DELETE ON gate_visit_question_entries FOR EACH ROW EXECUTE FUNCTION gate_visit_sharing_immutable();

CREATE FUNCTION gate_visit_share_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prior gate_visit_shares;plan gate_visit_arrangements;root gate_visit_shares;BEGIN
 SELECT * INTO plan FROM gate_visit_arrangements WHERE school_id=NEW.school_id AND id=NEW.visit_id FOR UPDATE;
 SELECT * INTO prior FROM gate_visit_shares WHERE school_id=NEW.school_id AND visit_id=NEW.visit_id ORDER BY revision DESC LIMIT 1;
 IF NOT gate_visit_actor_can_manage(NEW.school_id,NEW.actor_user_id)
  OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at)
  OR NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.previous_share_id IS DISTINCT FROM prior.id
 THEN RAISE EXCEPTION 'Sharing needs the next exact source version and current campus coordinator.' USING ERRCODE='23514';END IF;
 IF NEW.action IN('shared','renewed') THEN
  IF NEW.status<>'granted' OR NEW.starts_at<>NEW.recorded_at OR NEW.ends_at<=NEW.recorded_at
   OR NEW.party_person_id IS DISTINCT FROM plan.person_id OR NEW.party_guest_name IS DISTINCT FROM plan.guest_name
   OR NOT EXISTS(SELECT 1 FROM school_people person WHERE person.school_id=NEW.school_id AND person.id=NEW.organiser_person_id AND person.retired_at IS NULL AND person.revision=NEW.organiser_person_revision)
  THEN RAISE EXCEPTION 'Share the reviewed current party with an exact current organiser and available access dates.' USING ERRCODE='23514';END IF;
  IF NEW.action='renewed' THEN
   IF prior.id IS NULL OR NEW.root_id<>prior.root_id OR NEW.organiser_person_id<>prior.organiser_person_id
    OR NEW.owner_person_id<>prior.owner_person_id OR NEW.baseline_visit_revision<>prior.baseline_visit_revision OR NOT gate_visit_share_party_valid(NEW.school_id,prior.id)
   THEN RAISE EXCEPTION 'Renewal preserves only the same organiser and uninterrupted party context.' USING ERRCODE='23514';END IF;
  ELSIF NEW.root_id<>NEW.id OR NEW.baseline_visit_revision<>plan.revision OR NEW.owner_person_id<>NEW.actor_person_id
   OR prior.id IS NOT NULL AND NEW.organiser_person_id=prior.organiser_person_id AND gate_visit_share_party_valid(NEW.school_id,prior.id)
  THEN RAISE EXCEPTION 'A new sharing root starts only for a distinct organiser or party context.' USING ERRCODE='23514';END IF;
 ELSE
  IF prior.id IS NULL OR prior.status<>'granted'
   OR ROW(NEW.root_id,NEW.organiser_person_id,NEW.organiser_person_revision,NEW.party_person_id,NEW.party_guest_name,NEW.baseline_visit_revision,NEW.starts_at,NEW.ends_at,NEW.directions)
    IS DISTINCT FROM ROW(prior.root_id,prior.organiser_person_id,prior.organiser_person_revision,prior.party_person_id,prior.party_guest_name,prior.baseline_visit_revision,prior.starts_at,prior.ends_at,prior.directions)
   OR NEW.action='revoked' AND(NEW.status<>'revoked' OR NEW.owner_person_id<>prior.owner_person_id)
   OR NEW.action='taken_over' AND(NEW.status<>'granted' OR NEW.owner_person_id<>NEW.actor_person_id
    OR gate_visit_share_owner_available(NEW.school_id,prior.id,NEW.recorded_at)
    OR NOT gate_visit_share_current(NEW.school_id,NEW.visit_id,prior.organiser_person_id,NEW.recorded_at))
  THEN RAISE EXCEPTION 'Ending or taking over a share preserves its exact party, dates and prior responsibility.' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.root_id<>NEW.id THEN
  SELECT * INTO root FROM gate_visit_shares WHERE school_id=NEW.school_id AND id=NEW.root_id;
  IF root.root_id<>root.id OR ROW(root.visit_id,root.organiser_person_id,root.party_person_id,root.party_guest_name,root.baseline_visit_revision)
    IS DISTINCT FROM ROW(NEW.visit_id,NEW.organiser_person_id,NEW.party_person_id,NEW.party_guest_name,NEW.baseline_visit_revision)
  THEN RAISE EXCEPTION 'A private sharing root cannot be retargeted.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_share_source_scope BEFORE INSERT ON gate_visit_shares FOR EACH ROW EXECUTE FUNCTION gate_visit_share_source_guard();

CREATE FUNCTION gate_visit_question_current_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Visit questions retain their evidence.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.visit_id,NEW.share_root_id,NEW.organiser_person_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.visit_id,OLD.share_root_id,OLD.organiser_person_id,OLD.created_at)
  OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'A question change preserves its private source and advances one revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_question_current_scope BEFORE UPDATE OR DELETE ON gate_visit_questions FOR EACH ROW EXECUTE FUNCTION gate_visit_question_current_guard();

CREATE FUNCTION gate_visit_sharing_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_model_commands command
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
  LEFT JOIN gate_visit_shares share ON share.command_id=command.id AND share.school_id=command.school_id
  LEFT JOIN gate_visit_question_entries entry ON entry.command_id=command.id AND entry.school_id=command.school_id
  WHERE command.school_id=tenant AND command.id::text=envelope->>'source_command_id' AND command.source_domain='gate'
   AND command.handler_key='gate.visit-sharing.v1' AND command.handler_version=1 AND command.state='accepted'
   AND target.domain='gate' AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
   AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id AND event.actor_agent_id=command.actor_agent_id
   AND event.event_type=command.command_type AND event.source_domain='gate' AND event.source_record_id=target.domain_id
   AND event.source_revision=outcome.resulting_revision AND command.expected_revision=outcome.resulting_revision-1
   AND command.safe_context->>'visit_id'=envelope->>'visit_id'
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
   AND((share.id IS NOT NULL AND target.kind='gate_visit_sharing' AND target.domain_id=share.visit_id::text
      AND share.domain_event_id=event.id AND share.revision=outcome.resulting_revision
      AND command.command_type='gate.visit_share.'||share.action
      AND envelope- 'refresh'=jsonb_build_object('visit_id',share.visit_id::text,'share_id',share.id::text,'root_id',share.root_id::text,'question_id',NULL,
       'revision',share.revision,'action',share.action,'source_command_id',command.id::text)
      AND(event_name='gate.visit_shared.updated' AND aggregate_kind='gate_visit_shared' AND aggregate=share.visit_id
        OR event_name=command.command_type AND aggregate_kind='gate_visit_share_event' AND aggregate=share.visit_id))
    OR(entry.id IS NOT NULL AND target.kind='gate_visit_question' AND target.domain_id=entry.question_id::text
      AND entry.domain_event_id=event.id AND entry.revision=outcome.resulting_revision
      AND command.command_type='gate.visit_question.'||entry.action
      AND envelope-'refresh'=jsonb_build_object('visit_id',entry.visit_id::text,'share_id',entry.share_id::text,'root_id',entry.snapshot->>'share_root_id','question_id',entry.question_id::text,
       'revision',entry.revision,'action',entry.action,'source_command_id',command.id::text)
      AND(event_name='gate.visit_shared.updated' AND aggregate_kind='gate_visit_shared' AND aggregate=entry.visit_id
        OR event_name=command.command_type AND aggregate_kind='gate_visit_question_event' AND aggregate=entry.question_id)))
   AND(event_name='gate.visit_shared.updated' AND envelope->'refresh'='["gate-visits","workspace","attention"]'::jsonb OR event_name<>'gate.visit_shared.updated' AND NOT envelope?'refresh'))
$$;

CREATE FUNCTION gate_visit_share_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
  JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id AND authority.school_id=command.school_id
  WHERE command.school_id=NEW.school_id AND command.id=NEW.command_id AND command.idempotency_key LIKE 'gate-visit-sharing:'||NEW.actor_user_id::text||':%'
   AND actor.person_id=NEW.actor_person_id AND actor.agent_kind='human' AND command.requested_at=NEW.recorded_at
   AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id
   AND authority.capability='gate.manage' AND authority.decision='allowed'
   AND authority.environment_namespace_id=command.environment_namespace_id AND authority.realm_id=command.realm_id
   AND command.safe_context->'commitment'=jsonb_build_object('share_id',NEW.id::text,'root_id',NEW.root_id::text,
     'organiser_person_id',NEW.organiser_person_id::text,'organiser_person_revision',NEW.organiser_person_revision,
     'party_person_id',NEW.party_person_id::text,'party_guest_name_hash',CASE WHEN NEW.party_guest_name IS NULL THEN NULL ELSE encode(digest(to_jsonb(NEW.party_guest_name)::text,'sha256'),'hex') END,
     'baseline_visit_revision',NEW.baseline_visit_revision,'owner_person_id',NEW.owner_person_id::text,
     'starts_at',command.safe_context->'commitment'->>'starts_at','ends_at',command.safe_context->'commitment'->>'ends_at',
     'directions_hash',encode(digest(to_jsonb(NEW.directions)::text,'sha256'),'hex'),'status',NEW.status,'previous_share_id',NEW.previous_share_id::text)
   AND(command.safe_context->'commitment'->>'starts_at')::timestamptz=NEW.starts_at
   AND(command.safe_context->'commitment'->>'ends_at')::timestamptz=NEW.ends_at
   AND gate_visit_sharing_event_source_valid(NEW.school_id,'gate.visit_share.'||NEW.action,'gate_visit_share_event',NEW.visit_id,
     jsonb_build_object('visit_id',NEW.visit_id::text,'share_id',NEW.id::text,'root_id',NEW.root_id::text,'question_id',NULL,
      'revision',NEW.revision,'action',NEW.action,'source_command_id',NEW.command_id::text)))
 THEN RAISE EXCEPTION 'A shared visit requires its exact accepted command, commitment and event.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_share_native_complete AFTER INSERT ON gate_visit_shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_share_native_guard();

CREATE FUNCTION gate_visit_question_entry_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE question gate_visit_questions;share gate_visit_shares;previous gate_visit_question_entries;BEGIN
 SELECT * INTO question FROM gate_visit_questions WHERE school_id=NEW.school_id AND id=NEW.question_id;
 SELECT * INTO share FROM gate_visit_shares WHERE school_id=NEW.school_id AND id=NEW.share_id;
 SELECT * INTO previous FROM gate_visit_question_entries WHERE school_id=NEW.school_id AND question_id=NEW.question_id ORDER BY revision DESC LIMIT 1;
 IF question.id IS NULL OR share.id IS NULL OR NEW.snapshot<>to_jsonb(question) OR NEW.visit_id<>question.visit_id
  OR NEW.revision<>question.revision OR NEW.revision<>coalesce(previous.revision,0)+1
  OR NEW.command_id<>question.last_command_id OR NEW.domain_event_id<>question.last_domain_event_id OR NEW.recorded_at<>question.updated_at
  OR share.root_id<>question.share_root_id OR share.visit_id<>question.visit_id OR share.organiser_person_id<>question.organiser_person_id
  OR question.owner_person_id<>share.owner_person_id
  OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at)
  OR NOT EXISTS(SELECT 1 FROM school_people person WHERE person.school_id=NEW.school_id AND person.id=NEW.actor_person_id AND NEW.actor_label=btrim(concat(person.first_name,' ',person.last_name)))
 THEN RAISE EXCEPTION 'A visit question entry must retain the exact typed private source and actor.' USING ERRCODE='23514';END IF;
 IF NEW.action='asked' THEN
  IF NEW.actor_person_id<>share.organiser_person_id OR question.state<>'waiting_for_review'
   OR NOT gate_visit_share_current(NEW.school_id,NEW.visit_id,share.organiser_person_id,NEW.recorded_at)
   OR NOT gate_visit_share_owner_available(NEW.school_id,share.id,NEW.recorded_at)
  THEN RAISE EXCEPTION 'Only the current organiser can ask the available exact campus owner.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='replied' THEN
  IF NEW.actor_person_id<>share.owner_person_id OR question.state<>'answered' OR previous.snapshot->>'state'<>'waiting_for_review'
   OR NOT gate_visit_actor_can_manage(NEW.school_id,NEW.actor_user_id)
   OR NOT gate_visit_share_current(NEW.school_id,NEW.visit_id,share.organiser_person_id,NEW.recorded_at)
  THEN RAISE EXCEPTION 'Only the current exact campus owner can answer its pending private question.' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT gate_visit_actor_can_manage(NEW.school_id,NEW.actor_user_id) OR previous.snapshot->>'state'<>'waiting_for_review'
   OR NEW.action='withdrawn' AND question.state<>'withdrawn'
   OR NEW.action='rerouted' AND(question.state<>'waiting_for_review' OR NOT gate_visit_share_current(NEW.school_id,NEW.visit_id,share.organiser_person_id,NEW.recorded_at))
  THEN RAISE EXCEPTION 'Only an explicit source coordinator transition can replace obsolete question routing.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_question_entry_source BEFORE INSERT ON gate_visit_question_entries FOR EACH ROW EXECUTE FUNCTION gate_visit_question_entry_source_guard();

CREATE FUNCTION gate_visit_question_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gate_visit_question_entries entry WHERE entry.school_id=NEW.school_id AND entry.question_id=NEW.id
   AND entry.revision=NEW.revision AND entry.command_id=NEW.last_command_id AND entry.snapshot=to_jsonb(NEW))
 THEN RAISE EXCEPTION 'Every question version retains its exact native entry.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_question_native_complete AFTER INSERT OR UPDATE ON gate_visit_questions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_question_native_guard();
CREATE FUNCTION gate_visit_question_coordination_valid(tenant uuid,entry_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_question_entries entry
  JOIN campus_model_commands command ON command.id=entry.command_id AND command.school_id=entry.school_id
  JOIN campus_model_command_outcomes accepted ON accepted.command_id=command.id AND accepted.status='accepted'
  JOIN campus_model_operational_messages message ON message.school_id=entry.school_id
    AND message.id::text=entry.snapshot->'coordination_receipt'->>'message_id'
  JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id AND reaction.school_id=message.school_id
  JOIN campus_model_events requested ON requested.id=reaction.trigger_event_id AND requested.school_id=reaction.school_id
  JOIN campus_model_agents recipient ON recipient.id=message.recipient_agent_id AND recipient.school_id=message.school_id
  JOIN campus_model_coordination_configurations configuration ON configuration.school_id=message.school_id
    AND configuration.behaviour_version_id=reaction.behaviour_version_id AND configuration.subscription_id=reaction.subscription_id
  LEFT JOIN gate_visit_question_entries previous ON previous.school_id=entry.school_id AND previous.question_id=entry.question_id AND previous.revision=entry.revision-1
  WHERE entry.school_id=tenant AND entry.id=$2
   AND message.realm_id=command.realm_id AND message.environment_namespace_id=command.environment_namespace_id
   AND requested.realm_id=command.realm_id AND requested.environment_namespace_id=command.environment_namespace_id
   AND requested.source_domain='gate' AND requested.source_record_id=entry.question_id::text
   AND requested.event_type IN('gate.visit_question.asked','gate.visit_question.rerouted')
   AND message.source_outbox_event_id=requested.source_outbox_event_id AND message.sender_agent_id=requested.actor_agent_id
   AND message.owner_agent_id=message.recipient_agent_id AND message.message_kind='request'
   AND message.subject='Visit question' AND message.summary='Open this shared visit to answer its private question.'
   AND message.correlation_id=entry.question_id AND requested.correlation_id=entry.question_id
   AND recipient.agent_kind='human' AND recipient.person_id::text=entry.snapshot->>'owner_person_id'
   AND reaction.reaction_kind='gate_visit_question' AND configuration.source_domain='gate'
   AND configuration.source_record_id=entry.question_id::text AND configuration.source_revision=requested.source_revision
   AND message.payload=jsonb_build_object('workflow','gate_visit_question','visit_id',entry.visit_id::text,'question_id',entry.question_id::text,
    'share_root_id',entry.snapshot->>'share_root_id','source_revision',requested.source_revision,
    'action_path','/areas/in-out/visits?visit='||entry.visit_id::text||'&shared=1')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(configuration.snapshot->'recipients') selected
    WHERE selected->>'person_id'=recipient.person_id::text AND selected->>'user_id'=entry.snapshot->'coordination_receipt'->>'recipient_user_id')
   AND entry.snapshot->'coordination_receipt'=jsonb_build_object('event_id',requested.id::text,'source_revision',requested.source_revision,
    'event_type',requested.event_type,'message_id',message.id::text,'recipient_user_id',entry.snapshot->'coordination_receipt'->>'recipient_user_id',
    'correlation_id',entry.question_id::text,'behaviour_version_id',configuration.behaviour_version_id::text,
    'subscription_id',configuration.subscription_id::text,'selector_key',configuration.configuration_key)
   AND CASE WHEN entry.action IN('asked','rerouted') THEN
     requested.id=entry.domain_event_id AND requested.source_revision=entry.revision
     AND requested.event_type='gate.visit_question.'||entry.action
    ELSE requested.source_revision=entry.revision-1
     AND previous.snapshot->'coordination_receipt'=entry.snapshot->'coordination_receipt' END
   AND CASE WHEN entry.action='replied' THEN EXISTS(
    SELECT 1 FROM campus_model_operational_message_outcomes response WHERE response.school_id=entry.school_id AND response.message_id=message.id
     AND response.realm_id=command.realm_id AND response.environment_namespace_id=command.environment_namespace_id
     AND response.state='responded' AND response.code='visit_question_answered' AND response.actor_agent_id=command.actor_agent_id
     AND response.source_outbox_event_id=accepted.domain_event_id
     AND response.response=jsonb_build_object('visit_id',entry.visit_id::text,'question_id',entry.question_id::text))
    ELSE true END
   AND CASE WHEN entry.action IN('rerouted','withdrawn') OR entry.action='asked' AND previous.snapshot->>'state'='waiting_for_review' THEN EXISTS(
    SELECT 1 FROM campus_model_operational_messages former
    JOIN campus_model_operational_message_outcomes closure ON closure.message_id=former.id AND closure.school_id=former.school_id
    WHERE former.school_id=entry.school_id AND former.id::text=previous.snapshot->'coordination_receipt'->>'message_id'
     AND former.realm_id=command.realm_id AND former.environment_namespace_id=command.environment_namespace_id
     AND former.correlation_id=entry.question_id AND closure.occurred_at<=entry.recorded_at
     AND(closure.state='cancelled' AND closure.code='owning_domain_source_superseded'
       AND closure.actor_agent_id=command.actor_agent_id AND closure.source_outbox_event_id=accepted.domain_event_id AND closure.response IS NULL
       OR closure.state IN('responded','expired','cancelled','dead_letter') AND closure.source_outbox_event_id IS DISTINCT FROM accepted.domain_event_id))
    ELSE true END)
$$;
CREATE FUNCTION gate_visit_question_entry_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
  JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id AND authority.school_id=command.school_id
  JOIN gate_visit_shares share ON share.school_id=NEW.school_id AND share.id=NEW.share_id
  WHERE command.school_id=NEW.school_id AND command.id=NEW.command_id AND command.idempotency_key LIKE 'gate-visit-sharing:'||NEW.actor_user_id::text||':%'
   AND actor.agent_kind='human' AND actor.person_id=NEW.actor_person_id AND command.requested_at=NEW.recorded_at
   AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id AND authority.decision='allowed'
   AND authority.environment_namespace_id=command.environment_namespace_id AND authority.realm_id=command.realm_id
   AND authority.capability=CASE NEW.action WHEN 'asked' THEN 'gate.visit.question.ask' WHEN 'replied' THEN 'gate.visit.question.reply' ELSE 'gate.manage' END
   AND(NEW.action<>'asked' OR authority.valid_until=share.ends_at)
   AND command.safe_context->'commitment'=jsonb_build_object('question_id',NEW.question_id::text,'share_id',NEW.share_id::text,
    'share_root_id',NEW.snapshot->>'share_root_id','note_hash',encode(digest(to_jsonb(NEW.note)::text,'sha256'),'hex'),'owner_person_id',NEW.snapshot->>'owner_person_id')
   AND gate_visit_sharing_event_source_valid(NEW.school_id,'gate.visit_question.'||NEW.action,'gate_visit_question_event',NEW.question_id,
    jsonb_build_object('visit_id',NEW.visit_id::text,'share_id',NEW.share_id::text,'root_id',NEW.snapshot->>'share_root_id','question_id',NEW.question_id::text,
     'revision',NEW.revision,'action',NEW.action,'source_command_id',NEW.command_id::text))
   AND gate_visit_question_coordination_valid(NEW.school_id,NEW.id))
 THEN RAISE EXCEPTION 'A visit question entry requires its exact accepted command, commitment and event.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_question_entry_complete AFTER INSERT ON gate_visit_question_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_question_entry_native_guard();

-- Invitations form a reviewed two-variant native union. Keep the existing
-- Facilities composite FK: its nullable access column is unused for visits.
ALTER TABLE school_invitations ADD COLUMN work_visit_access_id uuid;
ALTER TABLE school_invitations DROP CONSTRAINT school_invitation_work_scope;
ALTER TABLE school_invitations ADD CONSTRAINT school_invitation_work_scope CHECK(
 access_scope='campus' AND num_nonnulls(work_source_kind,work_source_id,work_access_id,work_visit_access_id)=0
 OR access_scope='assigned_work' AND role='member' AND source='school' AND person_id IS NOT NULL AND work_source_id IS NOT NULL AND(
  work_source_kind='facility_repair' AND work_access_id IS NOT NULL AND work_visit_access_id IS NULL
  OR work_source_kind='visit_arrangement' AND work_access_id IS NULL AND work_visit_access_id IS NOT NULL));
ALTER TABLE school_invitations ADD CONSTRAINT school_invitation_exact_visit_fk
 FOREIGN KEY(work_visit_access_id,school_id,work_source_id,person_id)
 REFERENCES gate_visit_shares(id,school_id,visit_id,organiser_person_id) ON DELETE RESTRICT;
CREATE INDEX school_invitation_visit_idx ON school_invitations(work_visit_access_id,school_id,work_source_id,person_id) WHERE work_visit_access_id IS NOT NULL;
CREATE OR REPLACE FUNCTION school_invitation_work_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.access_scope,NEW.work_source_kind,NEW.work_source_id,NEW.work_access_id,NEW.work_visit_access_id,NEW.person_id,NEW.school_id,NEW.email,NEW.created_by,NEW.role,NEW.source,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.access_scope,OLD.work_source_kind,OLD.work_source_id,OLD.work_access_id,OLD.work_visit_access_id,OLD.person_id,OLD.school_id,OLD.email,OLD.created_by,OLD.role,OLD.source,OLD.created_at)
  AND(OLD.access_scope='assigned_work' OR NEW.access_scope='assigned_work')
 THEN RAISE EXCEPTION 'An invitation retains its exact source context.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION school_invitation_work_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE access facilities_external_assignments;repair facilities_repairs;share gate_visit_shares;access_id uuid;BEGIN
 IF NEW.access_scope<>'assigned_work' THEN RETURN NEW;END IF;
 access_id:=CASE WHEN NEW.work_source_kind='visit_arrangement' THEN NEW.work_visit_access_id ELSE NEW.work_access_id END;
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
   AND command.safe_context->'work_context'=jsonb_build_object('kind',NEW.work_source_kind,'source_id',NEW.work_source_id::text,'access_id',access_id::text)
   AND command.safe_context->>'person_id'=NEW.person_id::text AND person.kind='person' AND person.domain='people' AND person.domain_id=NEW.person_id::text
   AND(NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL OR campus_model_account_person_is_active(NEW.school_id,NEW.created_by,issuer.person_id,statement_timestamp())))
 THEN RAISE EXCEPTION 'A source invitation needs its exact accepted People command.' USING ERRCODE='23514';END IF;
 IF NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL THEN RETURN NEW;END IF;
 IF NEW.work_source_kind='visit_arrangement' THEN
  SELECT * INTO share FROM gate_visit_shares WHERE school_id=NEW.school_id AND id=NEW.work_visit_access_id;
  IF share.organiser_person_id IS DISTINCT FROM NEW.person_id OR share.visit_id IS DISTINCT FROM NEW.work_source_id
   OR NOT gate_visit_share_issuer_valid(NEW.school_id,NEW.work_source_id,share.id,NEW.created_by,statement_timestamp())
   OR NEW.accepted_at IS NOT NULL AND NOT campus_model_account_person_is_active(NEW.school_id,NEW.accepted_by_user_id,NEW.person_id,statement_timestamp())
  THEN RAISE EXCEPTION 'This visit invitation needs its current exact share and recipient.' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO repair FROM facilities_repairs WHERE id=NEW.work_source_id AND school_id=NEW.school_id;
  SELECT * INTO access FROM facilities_external_assignments WHERE id=NEW.work_access_id AND school_id=NEW.school_id;
  IF repair.external_assignment_id IS DISTINCT FROM access.id OR access.status<>'granted' OR access.person_id<>NEW.person_id OR access.ends_at<=statement_timestamp()
   OR NOT facilities_external_issuer_valid(NEW.school_id,repair.id,NEW.created_by,statement_timestamp())
   OR NEW.accepted_at IS NOT NULL AND NOT campus_model_account_person_is_active(NEW.school_id,NEW.accepted_by_user_id,NEW.person_id,statement_timestamp())
  THEN RAISE EXCEPTION 'This work invitation needs its current exact source and recipient.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION school_membership_work_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.access_scope='assigned_work' AND NOT EXISTS(SELECT 1 FROM school_invitations invitation
  WHERE invitation.school_id=NEW.school_id AND invitation.role='member' AND invitation.access_scope='assigned_work'
   AND invitation.accepted_by_user_id=NEW.user_id AND invitation.accepted_at IS NOT NULL AND invitation.revoked_at IS NULL
   AND invitation.expires_at>invitation.accepted_at
   AND campus_model_account_person_is_active(NEW.school_id,NEW.user_id,invitation.person_id,statement_timestamp()) AND(
    invitation.work_source_kind='facility_repair' AND EXISTS(SELECT 1 FROM facilities_repairs repair
     JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id AND access.repair_id=repair.id
     WHERE repair.school_id=invitation.school_id AND repair.id=invitation.work_source_id AND access.id=invitation.work_access_id
      AND access.person_id=invitation.person_id AND access.status='granted' AND access.ends_at>statement_timestamp())
    OR invitation.work_source_kind='visit_arrangement' AND EXISTS(SELECT 1 FROM gate_visit_shares share
     WHERE share.school_id=invitation.school_id AND share.id=invitation.work_visit_access_id AND share.visit_id=invitation.work_source_id
      AND share.organiser_person_id=invitation.person_id
      AND gate_visit_share_current(share.school_id,share.visit_id,share.organiser_person_id,statement_timestamp())
      AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=share.school_id AND later.visit_id=share.visit_id AND later.revision>share.revision))))
 THEN RAISE EXCEPTION 'Assigned-work membership needs its exact accepted source invitation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE FUNCTION gate_visit_shared_recipient_valid(tenant uuid,envelope jsonb,account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_shares share
  JOIN campus_model_current_account_endpoints(tenant,account,statement_timestamp()) endpoint ON true
  WHERE share.school_id=tenant AND share.visit_id::text=envelope->>'visit_id' AND share.id::text=envelope->>'share_id'
   AND((gate_visit_share_current(tenant,share.visit_id,share.organiser_person_id,statement_timestamp())
      AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=tenant AND later.visit_id=share.visit_id AND later.revision>share.revision)
      AND(endpoint.person_id=share.organiser_person_id OR endpoint.person_id=share.owner_person_id AND gate_visit_actor_can_manage(tenant,account)))
    OR envelope->>'action'='revoked' AND share.action='revoked' AND endpoint.person_id IN(share.organiser_person_id,share.owner_person_id)
    OR envelope->>'action'='shared' AND EXISTS(SELECT 1 FROM gate_visit_shares previous WHERE previous.school_id=tenant AND previous.id=share.previous_share_id AND previous.organiser_person_id=endpoint.person_id)
    OR envelope->>'action'='taken_over' AND share.action='taken_over' AND EXISTS(SELECT 1 FROM gate_visit_shares previous WHERE previous.school_id=tenant AND previous.id=share.previous_share_id AND previous.owner_person_id=endpoint.person_id)
    OR envelope->>'action'='withdrawn' AND endpoint.person_id IN(share.organiser_person_id,share.owner_person_id)
    OR share.actor_user_id=account AND envelope->>'source_command_id'=share.command_id::text))
$$;
CREATE OR REPLACE FUNCTION gate_visit_event_recipient_valid(tenant uuid,envelope jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_arrangements visit
  JOIN campus_model_current_account_endpoints(tenant,actor,statement_timestamp()) endpoint ON true
  WHERE visit.school_id=tenant AND visit.id::text=envelope->>'visit_id' AND(
   gate_visit_actor_can_manage(tenant,actor)
   OR envelope->>'action' IN('changed','cancelled') AND EXISTS(SELECT 1 FROM gate_visit_shares share
    WHERE share.school_id=tenant AND share.visit_id=visit.id
     AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=tenant AND later.visit_id=visit.id AND later.revision>share.revision)
     AND(endpoint.person_id=share.organiser_person_id OR endpoint.person_id=share.owner_person_id AND gate_visit_actor_can_manage(tenant,actor)) AND(
      gate_visit_share_current(tenant,visit.id,share.organiser_person_id,statement_timestamp())
      OR envelope->>'action'='changed' AND share.status='granted' AND EXISTS(
       SELECT 1 FROM gate_visit_arrangement_revisions version WHERE version.school_id=tenant AND version.visit_id=visit.id
        AND version.revision::text=envelope->>'revision' AND version.revision>share.baseline_visit_revision
        AND version.recorded_at>=share.starts_at AND version.recorded_at<share.ends_at
        AND(coalesce(version.snapshot->'person_id','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(share.party_person_id),'null'::jsonb)
         OR version.snapshot->>'guest_name' IS DISTINCT FROM share.party_guest_name)
        AND NOT EXISTS(SELECT 1 FROM gate_visit_arrangement_revisions earlier WHERE earlier.school_id=tenant AND earlier.visit_id=visit.id
         AND earlier.revision>=share.baseline_visit_revision AND earlier.revision<version.revision AND(
          coalesce(earlier.snapshot->'person_id','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(share.party_person_id),'null'::jsonb)
          OR earlier.snapshot->>'guest_name' IS DISTINCT FROM share.party_guest_name)))))))
$$;
CREATE FUNCTION gate_visit_sharing_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'gate.visit_share.%' OR OLD.event_type LIKE 'gate.visit_question.%' OR OLD.event_type='gate.visit_shared.updated'
   OR NEW.event_type LIKE 'gate.visit_share.%' OR NEW.event_type LIKE 'gate.visit_question.%' OR NEW.event_type='gate.visit_shared.updated') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Shared visit event envelopes are immutable.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF(NEW.event_type LIKE 'gate.visit_share.%' OR NEW.event_type LIKE 'gate.visit_question.%' OR NEW.event_type='gate.visit_shared.updated') AND(
  cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
  OR NEW.event_type<>'gate.visit_shared.updated' AND cardinality(NEW.audience_user_ids)>0
  OR NOT coalesce(gate_visit_sharing_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) account WHERE NOT gate_visit_shared_recipient_valid(NEW.school_id,NEW.payload,account)))
 THEN RAISE EXCEPTION 'Shared visit refreshes require exact accepted source evidence and current private recipients.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_sharing_event_source AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_sharing_event_guard();
DO $$ DECLARE previous_body text;BEGIN
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
  RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $visit_source_269$
  SELECT CASE WHEN event_name='gate.visit_shared.updated'
   THEN gate_visit_sharing_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $visit_source_269$ $definition$,previous_body);
 SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
 previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $visit_recipient_269$
  SELECT CASE WHEN event_name='gate.visit_shared.updated' THEN gate_visit_shared_recipient_valid(event_school_id,event_payload,candidate_user_id)
   WHEN event_name='gate.visit_arrangement.updated' THEN gate_visit_event_recipient_valid(event_school_id,event_payload,candidate_user_id)
   WHEN event_name LIKE 'gate.visit_share.%%' OR event_name LIKE 'gate.visit_question.%%' THEN false
   ELSE (%s) END $visit_recipient_269$ $definition$,previous_body);
END $$;

DO $$ DECLARE owner_name text;signature text;table_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='gate_visit_arrangements'::regclass;
 FOREACH table_name IN ARRAY ARRAY['gate_visit_shares','gate_visit_questions','gate_visit_question_entries'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['gate_visit_share_party_valid(uuid,uuid)','gate_visit_share_current(uuid,uuid,uuid,timestamptz)',
  'gate_visit_share_owner_available(uuid,uuid,timestamptz)','gate_visit_share_issuer_valid(uuid,uuid,uuid,uuid,timestamptz)',
  'gate_visit_sharing_immutable()','gate_visit_share_source_guard()','gate_visit_question_current_guard()',
  'gate_visit_sharing_event_source_valid(uuid,text,text,uuid,jsonb)','gate_visit_share_native_guard()',
  'gate_visit_question_entry_source_guard()','gate_visit_question_native_guard()','gate_visit_question_coordination_valid(uuid,uuid)','gate_visit_question_entry_native_guard()',
  'gate_visit_shared_recipient_valid(uuid,jsonb,uuid)','gate_visit_sharing_event_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
