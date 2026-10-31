-- Learning owns dated lesson reports and immutable resources, not another schedule
-- or attendance register. No role receives the new capability automatically.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use','learning.sessions.manage']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish','learning.assignments.manage','learning.sessions.manage']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect'] ELSE ARRAY[]::text[] END
$$;

CREATE TABLE teaching_sessions(
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),source_kind text NOT NULL CHECK(source_kind IN('academic','activity')),
  logical_key text NOT NULL CHECK(length(logical_key) BETWEEN 1 AND 200),session_date date NOT NULL,
  class_section_id uuid,subject_id uuid,original_teacher_id uuid REFERENCES users(id),source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_evidence jsonb NOT NULL CHECK(jsonb_typeof(source_evidence)='object'),revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  state text NOT NULL CHECK(state IN('prepared','reported')),preparation varchar(8000) NOT NULL DEFAULT '',topic varchar(180) NOT NULL DEFAULT '',
  learner_notes varchar(8000) NOT NULL DEFAULT '',reported_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
  UNIQUE(school_id,id),UNIQUE(school_id,source_kind,logical_key,session_date),
  CHECK(state<>'reported' OR length(trim(topic))>0 AND reported_at IS NOT NULL),
  FOREIGN KEY(class_section_id) REFERENCES class_sections(id),FOREIGN KEY(subject_id) REFERENCES subjects(id)
);
CREATE INDEX teaching_session_class_history ON teaching_sessions(school_id,class_section_id,subject_id,session_date DESC);
CREATE INDEX teaching_session_date ON teaching_sessions(school_id,session_date,id);
CREATE FUNCTION teaching_session_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.class_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM class_sections WHERE id=NEW.class_section_id AND school_id=NEW.school_id)
    OR NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND school_id=NEW.school_id)
  THEN RAISE EXCEPTION 'A teaching session context must belong to the same campus'; END IF;
  IF TG_OP='UPDATE' AND (NEW.school_id,NEW.id,NEW.source_kind,NEW.logical_key,NEW.session_date,NEW.class_section_id,NEW.subject_id,NEW.original_teacher_id)
    IS DISTINCT FROM (OLD.school_id,OLD.id,OLD.source_kind,OLD.logical_key,OLD.session_date,OLD.class_section_id,OLD.subject_id,OLD.original_teacher_id)
  THEN RAISE EXCEPTION 'Teaching source identity and original instructor are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_session_scope BEFORE INSERT OR UPDATE ON teaching_sessions FOR EACH ROW EXECUTE FUNCTION teaching_session_scope_guard();
CREATE TABLE teaching_session_revisions(
  school_id uuid NOT NULL,session_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),state text NOT NULL CHECK(state IN('prepared','reported')),
  preparation varchar(8000) NOT NULL,topic varchar(180) NOT NULL,learner_notes varchar(8000) NOT NULL,reason varchar(500) NOT NULL,
  source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),source_evidence jsonb NOT NULL,
  command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),actor_id uuid NOT NULL REFERENCES users(id),actor_person_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,PRIMARY KEY(school_id,session_id,revision),
  FOREIGN KEY(school_id,session_id) REFERENCES teaching_sessions(school_id,id),
  FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id)
);
CREATE TABLE teaching_session_materials(
  id uuid PRIMARY KEY,school_id uuid NOT NULL,session_id uuid NOT NULL,title varchar(180) NOT NULL CHECK(length(trim(title))>0),
  kind text NOT NULL CHECK(kind IN('link','text','file')),url varchar(1000) NOT NULL DEFAULT '',body varchar(20000) NOT NULL DEFAULT '',
  shared boolean NOT NULL,replaces_material_id uuid,storage_key uuid,original_name varchar(200),content_type varchar(100),size_bytes integer,
  sha256 char(64),command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
  UNIQUE(school_id,id),UNIQUE(school_id,session_id,id),FOREIGN KEY(school_id,session_id) REFERENCES teaching_sessions(school_id,id),
  FOREIGN KEY(school_id,session_id,replaces_material_id) REFERENCES teaching_session_materials(school_id,session_id,id),
  CHECK(replaces_material_id IS DISTINCT FROM id),
  CHECK(kind<>'file' OR storage_key=id AND size_bytes BETWEEN 1 AND 5242880 AND sha256 ~ '^[a-f0-9]{64}$' AND original_name IS NOT NULL AND content_type IS NOT NULL),
  CHECK(kind='file' OR storage_key IS NULL AND original_name IS NULL AND content_type IS NULL AND size_bytes IS NULL AND sha256 IS NULL),
  CHECK(kind<>'link' OR url ~ '^https?://' AND body=''),CHECK(kind<>'text' OR length(body)>0 AND url='')
);
CREATE INDEX teaching_material_session ON teaching_session_materials(school_id,session_id,created_at DESC,id);
CREATE INDEX teaching_material_replacement ON teaching_session_materials(school_id,session_id,replaces_material_id);
CREATE FUNCTION teaching_evidence_immutable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Teaching evidence is append-only; record a new version'; END $$;
CREATE TRIGGER teaching_revision_immutable BEFORE UPDATE OR DELETE ON teaching_session_revisions FOR EACH ROW EXECUTE FUNCTION teaching_evidence_immutable_guard();
CREATE TRIGGER teaching_material_immutable BEFORE UPDATE OR DELETE ON teaching_session_materials FOR EACH ROW EXECUTE FUNCTION teaching_evidence_immutable_guard();
CREATE FUNCTION teaching_evidence_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_entities entity ON entity.id=command.target_entity_id
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
    WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.state='accepted'
      AND command.source_domain='teaching_sessions' AND command.handler_key='learning.sessions' AND command.handler_version=1
      AND entity.domain='teaching_sessions' AND entity.kind='learning_work' AND entity.domain_id=NEW.session_id::text
      AND outcome.metadata->>'id'=NEW.session_id::text)
  THEN RAISE EXCEPTION 'Teaching evidence requires its exact accepted owning command'; END IF;
  IF TG_TABLE_NAME='teaching_session_revisions' THEN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
    JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
    WHERE command.id=NEW.command_id AND command.command_type='learning.session.lesson.save'
      AND outcome.metadata->>'revision'=NEW.revision::text AND actor.person_id=NEW.actor_person_id
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint WHERE endpoint.school_id=command.school_id AND endpoint.agent_id=actor.id
        AND endpoint.user_id=NEW.actor_id AND endpoint.endpoint_kind='account' AND endpoint.status='active'
        AND endpoint.effective_from<=command.requested_at AND(endpoint.effective_until IS NULL OR endpoint.effective_until>command.requested_at)))
  THEN RAISE EXCEPTION 'Lesson revision must match its exact instructor command and version'; END IF;
  END IF;
  IF TG_TABLE_NAME='teaching_session_materials' THEN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
    WHERE command.id=NEW.command_id AND command.command_type=CASE WHEN NEW.kind='file' THEN 'learning.session.material.upload' ELSE 'learning.session.material.add' END
      AND outcome.metadata->>'material_id'=NEW.id::text
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint WHERE endpoint.school_id=command.school_id AND endpoint.agent_id=command.actor_agent_id
        AND endpoint.user_id=NEW.created_by AND endpoint.endpoint_kind='account' AND endpoint.status='active'
        AND endpoint.effective_from<=command.requested_at AND(endpoint.effective_until IS NULL OR endpoint.effective_until>command.requested_at)))
  THEN RAISE EXCEPTION 'Class resource must match its exact instructor command and identity'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER teaching_revision_command AFTER INSERT ON teaching_session_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION teaching_evidence_command_guard();
CREATE CONSTRAINT TRIGGER teaching_material_command AFTER INSERT ON teaching_session_materials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION teaching_evidence_command_guard();
DO $$ DECLARE item text;role_name text;owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='diary_items'::regclass;
  FOREACH item IN ARRAY ARRAY['teaching_sessions','teaching_session_revisions','teaching_session_materials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',item);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',item,role_name); END IF;
    END LOOP;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,owner_name);
  END LOOP;
END $$;
