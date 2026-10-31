-- Optional reviewed canonical event locations. Never infer identity from venue text.
ALTER TABLE campus_events ADD COLUMN space_id uuid;
ALTER TABLE campus_event_sessions ADD COLUMN space_id uuid;
ALTER TABLE campus_event_sessions ADD COLUMN use_event_space boolean NOT NULL DEFAULT false;
ALTER TABLE campus_events ADD CONSTRAINT campus_event_place_scope
 FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id) ON DELETE RESTRICT;
ALTER TABLE campus_event_sessions ADD CONSTRAINT campus_event_session_place_scope
 FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id) ON DELETE RESTRICT;
ALTER TABLE campus_event_sessions ADD CONSTRAINT campus_event_session_location_choice
 CHECK(NOT use_event_space OR space_id IS NULL);
CREATE INDEX campus_event_place_idx ON campus_events(school_id,space_id) WHERE space_id IS NOT NULL;
CREATE INDEX campus_event_session_place_idx ON campus_event_sessions(school_id,space_id) WHERE space_id IS NOT NULL;
COMMENT ON COLUMN campus_event_sessions.use_event_space IS 'Explicit inheritance. False plus null is an unmapped venue. Legacy sessions remain unmapped; no matching by venue name.';
CREATE FUNCTION campus_event_place_current(tenant uuid,place uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT place IS NULL OR EXISTS(SELECT 1 FROM campus_spaces space
 JOIN institution_campuses campus ON campus.id=space.campus_id AND campus.school_id=space.school_id
 WHERE space.school_id=tenant AND space.id=place AND space.status='active' AND campus.status='active')
$$;
CREATE FUNCTION campus_event_location_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE event campus_events; chosen uuid;BEGIN
 IF TG_TABLE_NAME='campus_events' THEN
  IF TG_OP='UPDATE' AND OLD.space_id IS DISTINCT FROM NEW.space_id AND OLD.status<>'draft'
  THEN RAISE EXCEPTION 'Published event locations retain their accepted definition.' USING ERRCODE='23514';END IF;
  IF TG_OP='INSERT' OR OLD.space_id IS DISTINCT FROM NEW.space_id OR OLD.status='draft' AND NEW.status='published' THEN
   IF NOT campus_event_place_current(NEW.school_id,NEW.space_id)
   THEN RAISE EXCEPTION 'Choose a current canonical place in this institution.' USING ERRCODE='23514';END IF;
   IF NEW.status='published' AND EXISTS(SELECT 1 FROM campus_event_sessions session WHERE session.school_id=NEW.school_id AND session.event_id=NEW.id
     AND NOT campus_event_place_current(NEW.school_id,CASE WHEN session.use_event_space THEN NEW.space_id ELSE session.space_id END))
   THEN RAISE EXCEPTION 'Review the current location of every event session before publishing.' USING ERRCODE='23514';END IF;
  END IF;
 ELSE
  SELECT * INTO STRICT event FROM campus_events WHERE id=NEW.event_id AND school_id=NEW.school_id;
  IF TG_OP='INSERT' OR ROW(OLD.space_id,OLD.use_event_space) IS DISTINCT FROM ROW(NEW.space_id,NEW.use_event_space) THEN
   IF event.status<>'draft' THEN RAISE EXCEPTION 'Published event session locations retain their accepted definition.' USING ERRCODE='23514';END IF;
   chosen:=CASE WHEN NEW.use_event_space THEN event.space_id ELSE NEW.space_id END;
   IF NOT campus_event_place_current(NEW.school_id,chosen)
   THEN RAISE EXCEPTION 'Choose a current canonical session place in this institution.' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campus_event_location_scope BEFORE INSERT OR UPDATE ON campus_events FOR EACH ROW EXECUTE FUNCTION campus_event_location_guard();
CREATE TRIGGER campus_event_session_location_scope BEFORE INSERT OR UPDATE ON campus_event_sessions FOR EACH ROW EXECUTE FUNCTION campus_event_location_guard();
DO $$ DECLARE owner_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH signature IN ARRAY ARRAY['campus_event_place_current(uuid,uuid)','campus_event_location_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
