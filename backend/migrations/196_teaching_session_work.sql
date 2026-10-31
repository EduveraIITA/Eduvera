-- Source associations do not publish assignments, inherit private threads or
-- move ownership. Existing native readers remain the only work action paths.
CREATE TABLE teaching_session_work(
  id uuid PRIMARY KEY,school_id uuid NOT NULL,session_id uuid NOT NULL,work_kind text NOT NULL CHECK(work_kind IN('practice','assignment')),
  work_id uuid NOT NULL,practice_id uuid REFERENCES diary_items(id),assignment_id uuid REFERENCES learning_assignments(id),
  command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
  UNIQUE(school_id,id),UNIQUE(school_id,session_id,work_kind,work_id),FOREIGN KEY(school_id,session_id) REFERENCES teaching_sessions(school_id,id),
  CHECK(work_kind='practice' AND practice_id=work_id AND assignment_id IS NULL OR work_kind='assignment' AND assignment_id=work_id AND practice_id IS NULL)
);
CREATE INDEX teaching_work_source_practice ON teaching_session_work(practice_id);
CREATE INDEX teaching_work_source_assignment ON teaching_session_work(assignment_id);
CREATE INDEX teaching_work_session ON teaching_session_work(school_id,session_id,created_at DESC,id);
CREATE FUNCTION teaching_work_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.work_kind='practice' THEN
    IF NOT EXISTS(SELECT 1 FROM teaching_sessions session JOIN diary_items item ON item.school_id=session.school_id
      AND item.class_section_id=session.class_section_id AND item.subject_id IS NOT DISTINCT FROM session.subject_id
      WHERE session.school_id=NEW.school_id AND session.id=NEW.session_id AND item.id=NEW.work_id
        AND item.item_type='homework' AND item.author_id=NEW.created_by AND item.published_at IS NOT NULL
        AND item.term_id=(session.source_evidence->>'term_id')::uuid)
    THEN RAISE EXCEPTION 'Practice must identify the instructor published source in the same session context'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM teaching_sessions session JOIN learning_assignments item ON item.school_id=session.school_id
      AND item.class_section_id=session.class_section_id AND item.subject_id IS NOT DISTINCT FROM session.subject_id
      WHERE session.school_id=NEW.school_id AND session.id=NEW.session_id AND item.id=NEW.work_id AND item.context_kind='class_term'
        AND item.author_id=NEW.created_by AND item.state='published' AND item.term_id=(session.source_evidence->>'term_id')::uuid)
    THEN RAISE EXCEPTION 'Assignment must identify the instructor published source in the same session context'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_work_scope BEFORE INSERT ON teaching_session_work FOR EACH ROW EXECUTE FUNCTION teaching_work_scope_guard();
CREATE TRIGGER teaching_work_immutable BEFORE UPDATE OR DELETE ON teaching_session_work FOR EACH ROW EXECUTE FUNCTION teaching_evidence_immutable_guard();
CREATE FUNCTION teaching_work_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_entities entity ON entity.id=command.target_entity_id
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
    WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.state='accepted'
      AND command.source_domain='teaching_sessions' AND command.handler_key='learning.sessions' AND command.handler_version=1
      AND command.command_type='learning.session.work.link' AND entity.domain='teaching_sessions' AND entity.kind='learning_work' AND entity.domain_id=NEW.session_id::text
      AND outcome.metadata->>'id'=NEW.session_id::text AND outcome.metadata->>'link_id'=NEW.id::text
      AND outcome.metadata->>'work_kind'=NEW.work_kind AND outcome.metadata->>'work_id'=NEW.work_id::text
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint WHERE endpoint.school_id=command.school_id AND endpoint.agent_id=command.actor_agent_id
        AND endpoint.user_id=NEW.created_by AND endpoint.endpoint_kind='account' AND endpoint.status='active'
        AND endpoint.effective_from<=command.requested_at AND(endpoint.effective_until IS NULL OR endpoint.effective_until>command.requested_at)))
  THEN RAISE EXCEPTION 'Teaching work requires its exact accepted association command'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER teaching_work_command AFTER INSERT ON teaching_session_work DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION teaching_work_command_guard();
ALTER TABLE teaching_session_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE teaching_session_work FROM PUBLIC;
DO $$ DECLARE role_name text;owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='teaching_sessions'::regclass;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE teaching_session_work FROM %I',role_name); END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE teaching_session_work OWNER TO %I',owner_name);
END $$;
