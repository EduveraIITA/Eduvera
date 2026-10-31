-- Member-wide informational dates are not teaching closures, exclusive activities,
-- enrollment, attendance, actual delivery, fee obligations or financial evidence.
CREATE TABLE campus_dates (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 160),description text NOT NULL CHECK(length(description)<=4000),
 starts_on date NOT NULL,ends_on date NOT NULL,category_label text NOT NULL CHECK(length(btrim(category_label)) BETWEEN 2 AND 80),
 academic_term_id uuid,provenance jsonb,state text NOT NULL CHECK(state IN('published','cancelled')),
 revision integer NOT NULL CHECK(revision>0),cancellation_reason text,
 created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,academic_term_id) REFERENCES academic_terms(school_id,id),
 CHECK(starts_on BETWEEN '1900-01-01'::date AND '2200-12-31'::date AND ends_on>=starts_on AND ends_on<=starts_on+366),
 CHECK((state='cancelled' AND length(btrim(cancellation_reason)) BETWEEN 3 AND 1000) OR(state='published' AND cancellation_reason IS NULL)),
 CHECK(provenance IS NULL OR(jsonb_typeof(provenance)='object' AND provenance-ARRAY['fixture_key','source_note']='{}'::jsonb
   AND(NOT provenance?'fixture_key' OR jsonb_typeof(provenance->'fixture_key')='string' AND length(provenance->>'fixture_key') BETWEEN 1 AND 120)
   AND(NOT provenance?'source_note' OR jsonb_typeof(provenance->'source_note')='string' AND length(provenance->>'source_note') BETWEEN 1 AND 1000)))
);
CREATE INDEX campus_dates_overlap ON campus_dates(school_id,starts_on,id) INCLUDE(ends_on);
CREATE INDEX campus_dates_term ON campus_dates(school_id,academic_term_id);
CREATE INDEX campus_dates_creator ON campus_dates(created_by);
CREATE INDEX campus_dates_updater ON campus_dates(updated_by);
CREATE TABLE campus_date_revisions (
 school_id uuid NOT NULL,date_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN('published','corrected','cancelled')),command_id uuid NOT NULL REFERENCES campus_model_commands(id),
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),recorded_at timestamptz NOT NULL,
 CHECK((revision=1 AND action='published') OR(revision>1 AND action IN('corrected','cancelled'))),
 CHECK(snapshot->>'state'=CASE WHEN action='cancelled' THEN 'cancelled' ELSE 'published' END),
 PRIMARY KEY(school_id,date_id,revision),UNIQUE(command_id),
 FOREIGN KEY(school_id,date_id) REFERENCES campus_dates(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX campus_date_revisions_actor ON campus_date_revisions(school_id,actor_person_id,recorded_at);
CREATE INDEX campus_date_revisions_user ON campus_date_revisions(actor_user_id);
CREATE FUNCTION campus_date_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Campus-date publication evidence is immutable' USING ERRCODE='23514';END $$;
CREATE FUNCTION campus_date_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Published campus dates retain their history' USING ERRCODE='23514';END IF;
 IF OLD.state='cancelled' OR NEW.revision<>OLD.revision+1 OR ROW(NEW.id,NEW.school_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Campus-date changes require the next exact native revision' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER campus_date_current_guard BEFORE UPDATE OR DELETE ON campus_dates FOR EACH ROW EXECUTE FUNCTION campus_date_current_guard();
CREATE TRIGGER campus_date_history_immutable BEFORE UPDATE OR DELETE ON campus_date_revisions FOR EACH ROW EXECUTE FUNCTION campus_date_history_immutable();
CREATE TRIGGER campus_date_no_truncate BEFORE TRUNCATE ON campus_dates FOR EACH STATEMENT EXECUTE FUNCTION campus_date_history_immutable();
CREATE TRIGGER campus_date_history_no_truncate BEFORE TRUNCATE ON campus_date_revisions FOR EACH STATEMENT EXECUTE FUNCTION campus_date_history_immutable();
CREATE FUNCTION campus_date_revision_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_date_revisions receipt WHERE receipt.school_id=NEW.school_id AND receipt.date_id=NEW.id AND receipt.revision=NEW.revision
   AND receipt.snapshot->>'id'=NEW.id::text AND receipt.snapshot->>'school_id'=NEW.school_id::text
   AND receipt.snapshot->>'title'=NEW.title AND receipt.snapshot->>'description'=NEW.description
   AND receipt.snapshot->>'starts_on'=NEW.starts_on::text AND receipt.snapshot->>'ends_on'=NEW.ends_on::text
   AND receipt.snapshot->>'category_label'=NEW.category_label AND receipt.snapshot->>'state'=NEW.state
   AND(receipt.snapshot->>'academic_term_id')::uuid IS NOT DISTINCT FROM NEW.academic_term_id
   AND NULLIF(receipt.snapshot->'provenance','null'::jsonb) IS NOT DISTINCT FROM NEW.provenance
   AND(receipt.snapshot->>'revision')::integer=NEW.revision AND receipt.snapshot->>'cancellation_reason' IS NOT DISTINCT FROM NEW.cancellation_reason
   AND(receipt.snapshot->>'updated_at')::timestamptz=NEW.updated_at)
 THEN RAISE EXCEPTION 'Each campus date requires its matching immutable publication revision' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER campus_date_revision_required AFTER INSERT OR UPDATE ON campus_dates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_date_revision_required();
CREATE FUNCTION campus_date_command_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
   JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id
   JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
   JOIN event_outbox event ON event.id=outcome.domain_event_id AND event.school_id=command.school_id
   JOIN campus_model_events journal ON journal.source_outbox_event_id=event.id AND journal.school_id=command.school_id
     AND journal.environment_namespace_id=command.environment_namespace_id AND journal.realm_id=command.realm_id
   WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='campus_dates' AND command.handler_key='campus_dates.commands'
     AND command.handler_version=1 AND command.command_type='campus_dates.'||NEW.action AND command.expected_revision=NEW.revision-1 AND command.state='accepted'
     AND entity.domain='campus_dates' AND entity.domain_id=NEW.date_id::text AND actor.person_id=NEW.actor_person_id AND command.safe_context->>'actor_user_id'=NEW.actor_user_id::text
     AND outcome.status='accepted' AND outcome.resulting_revision=NEW.revision AND outcome.metadata->'result'=NEW.snapshot
     AND event.event_type='campus_dates.'||NEW.action AND event.aggregate_id=NEW.date_id AND event.payload->>'source_command_id'=NEW.command_id::text)
 THEN RAISE EXCEPTION 'Campus-date publication requires its accepted actor command and outcome' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER campus_date_command_required AFTER INSERT ON campus_date_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_date_command_required();
DO $$ DECLARE relation text;owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH relation IN ARRAY ARRAY['campus_dates','campus_date_revisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation);EXECUTE format('ALTER TABLE %I OWNER TO %I',relation,owner_name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION campus_date_history_immutable(),campus_date_current_guard(),campus_date_revision_required(),campus_date_command_required() FROM PUBLIC;

-- The new publication capability is assignable only at institution scope.
-- No role, template or default staff account gains it through this migration.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE context
  WHEN 'institution' THEN ARRAY['calendar.manage','gate.manage','members.invite','sis.manage','fees.manage','resources.manage','facilities.manage','accommodation.manage','dining.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use','learning.sessions.manage']
  WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish','learning.assignments.manage','learning.sessions.manage']
  WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
  WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
  WHEN 'trip' THEN ARRAY['departure.collect'] ELSE ARRAY[]::text[] END
$$;
ALTER TABLE school_access_exceptions DROP CONSTRAINT school_access_exceptions_permission_check;
ALTER TABLE school_access_exceptions ADD CONSTRAINT school_access_exceptions_permission_check CHECK(permission=ANY(ARRAY[
 'calendar.manage','members.invite','sis.manage','fees.manage','resources.manage','facilities.manage','accommodation.manage','dining.manage','attendance.view','attendance.record','photo.use',
 'timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance',
 'assessments.view','assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use']::text[]));
ALTER TABLE school_access_exceptions ADD CONSTRAINT campus_date_exception_institution_scope CHECK(permission<>'calendar.manage' OR scope_kind='institution');

-- Public cache invalidations contain only exact native source references, never
-- prose, Tasks, inbox notifications or operational consequences.
CREATE FUNCTION campus_date_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof(envelope)='object' AND aggregate_kind='campus_date' AND event_name IN('campus_dates.published','campus_dates.corrected','campus_dates.cancelled')
 AND EXISTS(SELECT 1 FROM campus_dates source JOIN campus_date_revisions receipt ON receipt.school_id=source.school_id AND receipt.date_id=source.id
 JOIN campus_model_commands command ON command.id=receipt.command_id AND command.school_id=receipt.school_id
 JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_events journal ON journal.source_outbox_event_id=outcome.domain_event_id AND journal.school_id=command.school_id
 JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=command.school_id
 WHERE source.school_id=tenant AND source.id=aggregate AND source.revision>=receipt.revision AND receipt.revision::text=envelope->>'revision'
   AND command.id::text=envelope->>'source_command_id' AND command.source_domain='campus_dates' AND command.handler_key='campus_dates.commands' AND command.handler_version=1
   AND command.state='accepted' AND command.command_type=event_name AND command.expected_revision=receipt.revision-1
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
   AND entity.domain='campus_dates' AND entity.domain_id=source.id::text AND entity.environment_namespace_id=command.environment_namespace_id AND entity.realm_id=command.realm_id
   AND outcome.resulting_revision=receipt.revision AND outcome.metadata->'result'=receipt.snapshot AND event_name='campus_dates.'||receipt.action
   AND journal.source_domain='campus_dates' AND journal.source_record_id=source.id::text AND journal.source_revision=receipt.revision AND journal.event_type=event_name
   AND journal.actor_agent_id=command.actor_agent_id AND journal.environment_namespace_id=command.environment_namespace_id AND journal.realm_id=command.realm_id
   AND envelope=jsonb_build_object('date_id',source.id::text,'revision',receipt.revision,'action',receipt.action,'source_command_id',command.id::text,'refresh',jsonb_build_array('calendar')))
$$;
CREATE FUNCTION campus_date_event_recipient_valid(tenant uuid,event_name text,envelope jsonb,actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_dates source JOIN school_memberships member ON member.school_id=source.school_id
  JOIN users account ON account.id=member.user_id WHERE source.school_id=tenant AND source.id::text=envelope->>'date_id'
   AND member.user_id=actor AND member.is_active AND account.is_active
   AND campus_date_event_source_valid(tenant,event_name,'campus_date',source.id,envelope))
$$;
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_date_recipient_277$
 SELECT CASE WHEN event_name LIKE 'campus_dates.%%' THEN campus_date_event_recipient_valid(event_school_id,event_name,event_payload,candidate_user_id) ELSE (%s) END $campus_date_recipient_277$ $definition$,body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_date_source_277$
 SELECT CASE WHEN event_name LIKE 'campus_dates.%%' OR aggregate_kind='campus_date' THEN campus_date_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $campus_date_source_277$ $definition$,body);
END $$;
CREATE FUNCTION campus_date_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'campus_dates.%' OR NEW.event_type LIKE 'campus_dates.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Campus-date source envelopes are immutable' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF(NEW.event_type LIKE 'campus_dates.%' OR NEW.aggregate_type='campus_date') AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
  OR NOT coalesce(campus_date_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT campus_date_event_recipient_valid(NEW.school_id,NEW.event_type,NEW.payload,actor)))
 THEN RAISE EXCEPTION 'Campus-date updates require exact accepted source evidence and current member recipients' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER campus_date_event_source_guard AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_date_event_guard();
-- The legacy Participation BEFORE trigger checks every outbox family. A native
-- date command writes its outbox before journal/outcome completion in the SAME
-- transaction. Defer this exact family to the constraint trigger above; the
-- shared delivery predicate still requires the completed source proof.
DO $$ DECLARE body text;anchor text:='IF NOT COALESCE(event_source_is_valid';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='validate_participation_event_source()'::regprocedure;
 IF position(anchor in body)=0 THEN RAISE EXCEPTION 'Review the shared outbox insertion guard before adding Campus Dates';END IF;
 body:=replace(body,anchor,'IF NEW.event_type LIKE ''campus_dates.%'' OR NEW.aggregate_type=''campus_date'' THEN RETURN NEW;END IF;
  '||anchor);
 EXECUTE format('CREATE OR REPLACE FUNCTION validate_participation_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS %L',body);
END $$;
REVOKE ALL ON FUNCTION campus_date_event_source_valid(uuid,text,text,uuid,jsonb),campus_date_event_recipient_valid(uuid,text,jsonb,uuid),campus_date_event_guard() FROM PUBLIC;
DO $$ DECLARE owner_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH signature IN ARRAY ARRAY['campus_date_history_immutable()','campus_date_current_guard()','campus_date_revision_required()','campus_date_command_required()',
  'campus_date_event_source_valid(uuid,text,text,uuid,jsonb)','campus_date_event_recipient_valid(uuid,text,jsonb,uuid)','campus_date_event_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);
 END LOOP;
END $$;
