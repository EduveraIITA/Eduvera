-- Future-only examination revisions. A published amendment explicitly withdraws
-- readiness until current duty acceptances and conflicts have been rechecked.
CREATE TABLE assessment_schedule_revisions (
 school_id uuid NOT NULL,assessment_id uuid NOT NULL,sitting_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),actor_user_id uuid NOT NULL REFERENCES users(id),
 command_id uuid NOT NULL REFERENCES campus_model_commands(id),command_key uuid NOT NULL,
 action text NOT NULL CHECK(action IN('amended','confirmed')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 previous_snapshot jsonb NOT NULL CHECK(jsonb_typeof(previous_snapshot)='object'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(school_id,sitting_id,revision),UNIQUE(command_id),
 FOREIGN KEY(school_id,sitting_id,assessment_id) REFERENCES assessment_sittings(school_id,id,assessment_id),
 CHECK((snapshot->>'revision')::integer=revision),
 CHECK(snapshot->>'assessment_id'=assessment_id::text AND snapshot->>'sitting_id'=sitting_id::text)
);
CREATE INDEX assessment_schedule_revision_assessment ON assessment_schedule_revisions(school_id,assessment_id,revision DESC);
CREATE INDEX assessment_schedule_revision_actor ON assessment_schedule_revisions(actor_user_id);
CREATE FUNCTION assessment_schedule_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published examination schedule revisions retain immutable history' USING ERRCODE='23514';END $$;
CREATE TRIGGER assessment_schedule_revision_immutable BEFORE UPDATE OR DELETE ON assessment_schedule_revisions
 FOR EACH ROW EXECUTE FUNCTION assessment_schedule_revision_immutable();
CREATE TRIGGER assessment_schedule_revision_no_truncate BEFORE TRUNCATE ON assessment_schedule_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION assessment_schedule_revision_immutable();
ALTER TABLE assessment_schedule_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON assessment_schedule_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment_schedule_revision_immutable() FROM PUBLIC;
DO $$ DECLARE owner_name name;database_role text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='assessments'::regclass;
 EXECUTE format('ALTER TABLE assessment_schedule_revisions OWNER TO %I',owner_name);
 EXECUTE format('ALTER FUNCTION assessment_schedule_revision_immutable() OWNER TO %I',owner_name);
 FOREACH database_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
   EXECUTE format('REVOKE ALL ON assessment_schedule_revisions FROM %I',database_role);
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION assessment_schedule_revision_command_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.realm_id=command.realm_id AND outcome.environment_namespace_id=command.environment_namespace_id
   JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
   JOIN LATERAL campus_model_current_account_endpoints(NEW.school_id,NEW.actor_user_id,NEW.recorded_at) actor ON actor.agent_id=command.actor_agent_id AND actor.school_id=command.school_id
   WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='assessments'
     AND command.handler_key='assessments.schedule_amendments' AND command.handler_version=1
     AND command.command_type=CASE WHEN NEW.action='amended' THEN 'examination.sitting.amend' ELSE 'examination.sitting.confirm' END
     AND command.expected_revision=NEW.revision-1 AND command.state='accepted' AND outcome.status='accepted' AND outcome.resulting_revision=NEW.revision
     AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
     AND target.domain='assessments' AND target.domain_id=NEW.sitting_id::text AND actor.user_id=NEW.actor_user_id
     AND command.safe_context->>'assessment_id'=NEW.assessment_id::text AND command.safe_context->>'sitting_id'=NEW.sitting_id::text
     AND outcome.metadata->>'domain_command_key'=NEW.command_key::text)
 THEN RAISE EXCEPTION 'An examination schedule revision requires its exact accepted source command' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER assessment_schedule_revision_command_required AFTER INSERT ON assessment_schedule_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_schedule_revision_command_required();
REVOKE ALL ON FUNCTION assessment_schedule_revision_command_required() FROM PUBLIC;
DO $$ DECLARE owner_name name;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='assessments'::regclass;
 EXECUTE format('ALTER FUNCTION assessment_schedule_revision_command_required() OWNER TO %I',owner_name);END $$;

-- Cache invalidations for a revised schedule follow the retained frozen cohort,
-- with current membership/relationship checks. This reveals no marks or private prose.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_exam_amendments;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT event_user_is_authorized_before_exam_amendments(event_school_id,event_name,event_payload,candidate_user_id)
 OR(event_name='assessment.updated' AND event_payload->>'action'='schedule' AND EXISTS(
   SELECT 1 FROM assessments assessment JOIN assessment_sittings sitting ON sitting.assessment_id=assessment.id AND sitting.school_id=assessment.school_id
   JOIN assessment_sitting_candidates candidate ON candidate.sitting_id=sitting.id AND candidate.school_id=assessment.school_id
   JOIN students student ON student.id=candidate.student_id AND student.school_id=assessment.school_id
   JOIN school_memberships member ON member.school_id=assessment.school_id AND member.user_id=candidate_user_id AND member.is_active
   JOIN users account ON account.id=member.user_id AND account.is_active
   WHERE assessment.school_id=event_school_id AND assessment.id::text=event_payload->>'assessment_id'
   AND assessment.status='scheduled' AND(
     (member.role='student' AND student.user_id=candidate_user_id AND campus_model_account_person_is_active(event_school_id,candidate_user_id,student.person_id,now()))
     OR(member.role='guardian' AND EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
       JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=parent.id
       WHERE relationship.school_id=assessment.school_id AND relationship.student_id=student.id AND parent.user_id=candidate_user_id AND campus_model_account_person_is_active(event_school_id,candidate_user_id,profile.person_id,now()))))))
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid),event_user_is_authorized_before_exam_amendments(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name name;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='event_outbox'::regclass;
 EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);END $$;
