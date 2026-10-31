-- A reusable locator permits a verified account to declare its own participation.
-- It is never an entry pass, campus role, organiser conversation or presence fact.
CREATE TABLE gate_visit_onboarding_links(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,visit_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid,
 action text NOT NULL CHECK(action IN('issue','revoke')),token_hash text,
 ends_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),actor_person_id uuid NOT NULL,
 command_id uuid NOT NULL REFERENCES campus_model_commands(id),domain_event_id uuid NOT NULL REFERENCES event_outbox(id),
 UNIQUE(id,school_id,visit_id),UNIQUE(school_id,visit_id,revision),UNIQUE(command_id),
 FOREIGN KEY(visit_id,school_id) REFERENCES gate_visit_arrangements(id,school_id),
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id),
 FOREIGN KEY(previous_id,school_id,visit_id) REFERENCES gate_visit_onboarding_links(id,school_id,visit_id),
 CHECK((action='issue' AND token_hash~'^[0-9a-f]{64}$' AND ends_at>recorded_at) OR(action='revoke' AND token_hash IS NULL))
);
CREATE UNIQUE INDEX gate_visit_onboarding_token ON gate_visit_onboarding_links(token_hash) WHERE token_hash IS NOT NULL;
CREATE TABLE gate_visit_onboarding_registrations(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,visit_id uuid NOT NULL,link_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),person_id uuid NOT NULL,registered_at timestamptz NOT NULL,
 gateway_command_id uuid REFERENCES campus_model_commands(id),domain_event_id uuid REFERENCES event_outbox(id),
 UNIQUE(link_id,user_id),UNIQUE(id,school_id),
 FOREIGN KEY(link_id,school_id,visit_id) REFERENCES gate_visit_onboarding_links(id,school_id,visit_id),
 FOREIGN KEY(person_id,school_id) REFERENCES school_people(id,school_id),
 CHECK((gateway_command_id IS NULL)=(domain_event_id IS NULL))
);
-- Account-plane mailbox proofs are deliberately excluded from scenario capture
-- by the maintained auth_ table boundary. Codes are hashed; no password is stored.
CREATE TABLE auth_visit_onboarding_challenges(
 id uuid PRIMARY KEY,link_id uuid NOT NULL REFERENCES gate_visit_onboarding_links(id),
 email text NOT NULL,code_hash text NOT NULL CHECK(code_hash~'^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX auth_visit_onboarding_challenge_expiry ON auth_visit_onboarding_challenges(link_id,expires_at);
CREATE INDEX auth_visit_onboarding_expired_proofs ON auth_visit_onboarding_challenges(expires_at,id);

CREATE FUNCTION gate_visit_onboarding_clock() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE at_time timestamptz;BEGIN
 IF current_schema()<>'public' THEN EXECUTE 'SELECT simulation_now()' INTO at_time;RETURN at_time;END IF;
 -- A newly linked endpoint can start after transaction start. Acceptance uses
 -- the current statement in Live and the exact selected virtual clock in a run.
 RETURN statement_timestamp();
END $$;

CREATE FUNCTION gate_visit_onboarding_current(tenant uuid,link uuid,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM gate_visit_onboarding_links source JOIN gate_visit_arrangements visit
 ON visit.school_id=source.school_id AND visit.id=source.visit_id
 WHERE source.school_id=tenant AND source.id=link AND source.action='issue' AND source.ends_at>at_time
 AND visit.state='confirmed'
 AND NOT EXISTS(SELECT 1 FROM gate_visit_onboarding_links later WHERE later.school_id=tenant AND later.visit_id=source.visit_id AND later.revision>source.revision)
 AND gate_visit_actor_can_manage(tenant,source.actor_user_id)
 AND campus_model_account_person_is_active(tenant,source.actor_user_id,source.actor_person_id,at_time))
$$;
CREATE FUNCTION gate_visit_onboarding_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prior gate_visit_onboarding_links;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Onboarding link versions retain immutable evidence.' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM gate_visit_arrangements WHERE school_id=NEW.school_id AND id=NEW.visit_id FOR UPDATE;
 SELECT * INTO prior FROM gate_visit_onboarding_links WHERE school_id=NEW.school_id AND visit_id=NEW.visit_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.previous_id IS DISTINCT FROM prior.id
 OR NOT gate_visit_actor_can_manage(NEW.school_id,NEW.actor_user_id)
 OR NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at)
 THEN RAISE EXCEPTION 'Onboarding needs the current exact link version and issuer.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_onboarding_link_immutable BEFORE INSERT OR UPDATE OR DELETE ON gate_visit_onboarding_links FOR EACH ROW EXECUTE FUNCTION gate_visit_onboarding_link_guard();
CREATE FUNCTION gate_visit_onboarding_registration_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.gateway_command_id IS NOT NULL OR NEW.gateway_command_id IS NULL OR NEW.domain_event_id IS NULL
  OR (to_jsonb(NEW)-'gateway_command_id'-'domain_event_id') IS DISTINCT FROM (to_jsonb(OLD)-'gateway_command_id'-'domain_event_id')
  THEN RAISE EXCEPTION 'Visitor registrations retain immutable evidence.' USING ERRCODE='23514';END IF;
 ELSIF TG_OP='DELETE' THEN RAISE EXCEPTION 'Visitor registrations retain immutable evidence.' USING ERRCODE='23514';
 ELSE
  IF NEW.registered_at>gate_visit_onboarding_clock() OR NOT gate_visit_onboarding_current(NEW.school_id,NEW.link_id,NEW.registered_at)
  OR NOT EXISTS(SELECT 1 FROM users account WHERE account.id=NEW.user_id AND account.is_active AND account.email_verified_at IS NOT NULL AND NOT account.onboarding_pending)
  THEN RAISE EXCEPTION 'Self-registration requires the current link and verified account.' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gate_visit_onboarding_registration_immutable BEFORE INSERT OR UPDATE OR DELETE ON gate_visit_onboarding_registrations FOR EACH ROW EXECUTE FUNCTION gate_visit_onboarding_registration_guard();

CREATE FUNCTION gate_visit_onboarding_complete_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE command_ref uuid;event_ref uuid;target_id text;actor_id uuid;person_ref uuid;expected integer;result_revision integer;action_name text;BEGIN
 IF TG_TABLE_NAME='gate_visit_onboarding_links' THEN
  command_ref:=NEW.command_id;event_ref:=NEW.domain_event_id;target_id:=NEW.visit_id::text;actor_id:=NEW.actor_user_id;
  person_ref:=NEW.actor_person_id;expected:=NEW.revision-1;result_revision:=NEW.revision;action_name:=NEW.action;
 ELSE
  SELECT gateway_command_id,domain_event_id INTO command_ref,event_ref FROM gate_visit_onboarding_registrations WHERE id=NEW.id;
  target_id:=NEW.id::text;actor_id:=NEW.user_id;person_ref:=NEW.person_id;expected:=0;result_revision:=1;action_name:='joined';
  IF NOT gate_visit_onboarding_current(NEW.school_id,NEW.link_id,gate_visit_onboarding_clock()) THEN
   RAISE EXCEPTION 'The exact visitor registration source ended before acceptance.' USING ERRCODE='23514';END IF;
 END IF;
 IF command_ref IS NULL OR NOT EXISTS(SELECT 1 FROM campus_model_commands command
 JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
 JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
 JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id AND authority.school_id=command.school_id
 JOIN campus_model_events event ON event.source_outbox_event_id=event_ref AND event.school_id=command.school_id
 JOIN event_outbox source_event ON source_event.id=event_ref AND source_event.school_id=command.school_id
 WHERE command.id=command_ref AND command.school_id=NEW.school_id AND command.source_domain='gate'
 AND command.handler_key='gate.visit-onboarding.v1' AND command.handler_version=1 AND command.state='accepted'
 AND command.command_type='gate.visit_onboarding.'||action_name AND command.expected_revision=expected AND outcome.resulting_revision=result_revision
 AND outcome.domain_event_id=event_ref AND event.actor_agent_id=command.actor_agent_id AND actor.person_id=person_ref
 AND command.safe_context->>'visit_id'=NEW.visit_id::text AND command.safe_context->>'actor_user_id'=actor_id::text
 AND command.safe_context->>'source_id'=NEW.id::text
 AND target.domain='gate' AND target.domain_id=target_id AND target.kind=CASE WHEN action_name='joined' THEN 'gate_visit_registration' ELSE 'gate_visit_onboarding_link' END
 AND authority.actor_agent_id=command.actor_agent_id AND authority.scope_entity_id=command.target_entity_id AND authority.decision='allowed'
 AND authority.capability=CASE WHEN action_name='joined' THEN 'gate.visit.self.register' ELSE 'gate.manage' END
 AND authority.realm_id=command.realm_id AND authority.environment_namespace_id=command.environment_namespace_id
 AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint WHERE endpoint.school_id=NEW.school_id AND endpoint.agent_id=actor.id AND endpoint.user_id=actor_id AND endpoint.endpoint_kind='account')
 AND event.event_type=command.command_type AND event.source_domain='gate' AND event.source_record_id=target_id AND event.source_revision=result_revision
 AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id
 AND target.environment_namespace_id=command.environment_namespace_id AND target.realm_id=command.realm_id
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
 AND source_event.payload=jsonb_build_object('visit_id',NEW.visit_id,'source_id',NEW.id,'revision',result_revision,'action',action_name,'source_command_id',command_ref)
 AND cardinality(source_event.audience_user_ids)=0 AND cardinality(source_event.notification_user_ids)=0 AND source_event.notification_payload IS NULL)
 THEN RAISE EXCEPTION 'Onboarding needs its exact accepted self/issuer command and opaque event.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gate_visit_onboarding_link_complete AFTER INSERT ON gate_visit_onboarding_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_onboarding_complete_guard();
CREATE CONSTRAINT TRIGGER gate_visit_onboarding_registration_complete AFTER INSERT OR UPDATE ON gate_visit_onboarding_registrations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_visit_onboarding_complete_guard();

-- Preserve every existing accepted invitation condition; add only a verified
-- self-registration source, whose exact command/event completes in this same tx.
DO $$ DECLARE body text;needle text:='  IF NOT EXISTS(SELECT 1 FROM school_invitations invitation';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='guard_explicit_person_account_binding()'::regprocedure;
 IF position(needle in body)=0 THEN RAISE EXCEPTION 'Unexpected explicit identity-binding guard';END IF;
 body:=replace(body,needle,$insert$  IF EXISTS(SELECT 1 FROM gate_visit_onboarding_registrations registration
   JOIN users account ON account.id=registration.user_id
   JOIN school_memberships membership ON membership.school_id=registration.school_id AND membership.user_id=account.id AND membership.is_active
   WHERE registration.school_id=NEW.school_id AND registration.person_id=NEW.id AND registration.user_id=NEW.account_user_id
   AND account.is_active AND account.email_verified_at IS NOT NULL AND NOT account.onboarding_pending
   AND membership.role='member' AND membership.access_scope='assigned_work'
   AND gate_visit_onboarding_current(registration.school_id,registration.link_id,registration.registered_at)) THEN RETURN NEW;END IF;
$insert$||needle);
 EXECUTE format('CREATE OR REPLACE FUNCTION guard_explicit_person_account_binding() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS %L',body);
END $$;
-- Technical assigned-work membership still requires an accepted exact source;
-- self-onboarding is a second reviewed source, never a campus-wide membership.
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='school_membership_work_source_guard()'::regprocedure;
 IF position('IF NEW.access_scope=''assigned_work'' AND NOT EXISTS' in body)=0 THEN RAISE EXCEPTION 'Unexpected assigned-work membership guard';END IF;
 body:=replace(body,'BEGIN', $insert$BEGIN
 IF NEW.access_scope='assigned_work' AND NEW.role='member' AND EXISTS(SELECT 1 FROM gate_visit_onboarding_registrations registration
  JOIN campus_model_commands command ON command.id=registration.gateway_command_id AND command.school_id=registration.school_id
  JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  WHERE registration.school_id=NEW.school_id AND registration.user_id=NEW.user_id
   AND command.command_type='gate.visit_onboarding.joined' AND command.handler_key='gate.visit-onboarding.v1' AND command.state='accepted'
   AND command.safe_context->>'actor_user_id'=NEW.user_id::text AND command.safe_context->>'source_id'=registration.id::text
   AND outcome.domain_event_id=registration.domain_event_id AND gate_visit_onboarding_current(registration.school_id,registration.link_id,gate_visit_onboarding_clock())
   AND campus_model_account_person_is_active(registration.school_id,registration.user_id,registration.person_id,registration.registered_at)) THEN RETURN NEW;END IF;
$insert$);
 EXECUTE format('CREATE OR REPLACE FUNCTION school_membership_work_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS %L',body);
END $$;
DO $$ DECLARE owner_name text;table_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH table_name IN ARRAY ARRAY['gate_visit_onboarding_links','gate_visit_onboarding_registrations','auth_visit_onboarding_challenges'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['gate_visit_onboarding_clock()','gate_visit_onboarding_current(uuid,uuid,timestamptz)','gate_visit_onboarding_link_guard()','gate_visit_onboarding_registration_guard()','gate_visit_onboarding_complete_guard()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);
 END LOOP;
END $$;
