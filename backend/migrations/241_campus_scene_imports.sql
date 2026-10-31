-- Import proposals and cloud allowance reservations; authoritative places and
-- published scenes are changed only by the scene command workflow.
CREATE TABLE campus_scene_import_runs (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), campus_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN('lookup','image','location','geojson')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('running','completed','failed')),
 result jsonb, error_message text,
 input_tokens integer CHECK(input_tokens BETWEEN 0 AND 24000),
 max_output_tokens integer CHECK(max_output_tokens BETWEEN 1 AND 8192),
 reserved_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),
 created_at timestamptz NOT NULL, finished_at timestamptz,
 FOREIGN KEY(campus_id,school_id) REFERENCES institution_campuses(id,school_id),
 CHECK(result IS NULL OR octet_length(result::text)<=3145728),
 CHECK((status='running' AND result IS NULL AND finished_at IS NULL) OR
       (status='completed' AND result IS NOT NULL AND finished_at IS NOT NULL) OR
       (status='failed' AND result IS NULL AND finished_at IS NOT NULL)),
 CHECK(error_message IS NULL OR length(error_message)<=500)
);
CREATE INDEX campus_scene_import_scope ON campus_scene_import_runs(school_id,campus_id,created_at);
CREATE INDEX campus_scene_import_budget ON campus_scene_import_runs(created_at) WHERE reserved_micros>0;
CREATE INDEX campus_scene_import_actor ON campus_scene_import_runs(actor_user_id,created_at);
CREATE FUNCTION campus_scene_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'running' OR
 ROW(NEW.id,NEW.school_id,NEW.campus_id,NEW.actor_user_id,NEW.kind,NEW.request_hash,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.campus_id,OLD.actor_user_id,OLD.kind,OLD.request_hash,OLD.created_at)
 OR (OLD.reserved_micros>0 AND ROW(NEW.reserved_micros,NEW.input_tokens,NEW.max_output_tokens) IS DISTINCT FROM ROW(OLD.reserved_micros,OLD.input_tokens,OLD.max_output_tokens))
 THEN RAISE EXCEPTION 'Campus import identity, completed results and cloud reservations are immutable.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campus_scene_import_immutable BEFORE UPDATE OR DELETE ON campus_scene_import_runs FOR EACH ROW EXECUTE FUNCTION campus_scene_import_guard();
ALTER TABLE campus_scene_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE campus_scene_import_runs FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 EXECUTE format('ALTER TABLE campus_scene_import_runs OWNER TO %I',owner_name);
 EXECUTE format('ALTER FUNCTION campus_scene_import_guard() OWNER TO %I',owner_name);
END $$;
REVOKE ALL ON FUNCTION campus_scene_import_guard() FROM PUBLIC;
COMMENT ON TABLE campus_scene_import_runs IS 'Bounded, private import proposals and nonrefundable cloud allowance reservations. Isolated worlds use captured proposals or explicit local tracing, never Live providers.';
