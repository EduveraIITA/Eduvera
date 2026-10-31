-- Bounded Dining: availability is not a venue reservation, counts are not named
-- entitlement, consumption, stock or financial evidence. No external API owner.
CREATE TABLE dining_services (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 coordinator_person_id uuid NOT NULL,space_id uuid REFERENCES campus_spaces(id),
 menu_mode text NOT NULL CHECK(menu_mode IN('native','reference')),operations_mode text NOT NULL CHECK(operations_mode IN('native','reference')),
 source_label text NOT NULL DEFAULT '',source_url text,source_reference text NOT NULL DEFAULT '',source_observed_at timestamptz,
 active boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id),
 CHECK((menu_mode='native' AND operations_mode='native') OR length(source_label)>0),
 CHECK(source_url IS NULL OR source_url LIKE 'https://%')
);
CREATE INDEX dining_services_coordinator ON dining_services(school_id,coordinator_person_id,created_at,id);
CREATE INDEX dining_services_place ON dining_services(school_id,space_id);
CREATE TABLE dining_service_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,service_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL REFERENCES campus_model_commands(id),
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL,
 name text NOT NULL,coordinator_person_id uuid NOT NULL,space_id uuid REFERENCES campus_spaces(id),menu_mode text NOT NULL,operations_mode text NOT NULL,
 source_label text NOT NULL,source_url text,source_reference text NOT NULL,source_observed_at timestamptz,active boolean NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(school_id,id),UNIQUE(school_id,service_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(school_id,service_id) REFERENCES dining_services(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX dining_service_receipts_actor ON dining_service_receipts(school_id,actor_person_id,recorded_at);
CREATE INDEX dining_service_receipts_coordinator ON dining_service_receipts(school_id,coordinator_person_id);
CREATE INDEX dining_service_receipts_command ON dining_service_receipts(command_id);
CREATE TABLE dining_sessions (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,service_id uuid NOT NULL,service_revision integer NOT NULL CHECK(service_revision>0),label text NOT NULL CHECK(length(label) BETWEEN 2 AND 100),
 coordinator_person_id uuid NOT NULL,operator_person_id uuid NOT NULL,space_id uuid REFERENCES campus_spaces(id),
 menu_mode text NOT NULL CHECK(menu_mode IN('native','reference')),operations_mode text NOT NULL CHECK(operations_mode IN('native','reference')),
 source_label text NOT NULL,source_url text,source_reference text NOT NULL,source_observed_at timestamptz,menu_text text NOT NULL CHECK(length(menu_text)<=4000),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,state text NOT NULL CHECK(state IN('draft','published','open','paused','ended','cancelled')),
 revision integer NOT NULL CHECK(revision>0),published_at timestamptz,count_total integer NOT NULL DEFAULT 0 CHECK(count_total BETWEEN 0 AND 10000000),current_count_receipt_id uuid,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,coordination_receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,service_id) REFERENCES dining_services(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,operator_person_id) REFERENCES school_people(school_id,id),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),CHECK(menu_mode='native' OR menu_text=''),CHECK(menu_mode='native' OR operations_mode='native')
);
CREATE INDEX dining_sessions_date ON dining_sessions(school_id,starts_at,id);
CREATE INDEX dining_sessions_service ON dining_sessions(school_id,service_id,starts_at,id);
CREATE INDEX dining_sessions_operator ON dining_sessions(school_id,operator_person_id,created_at,id);
CREATE INDEX dining_sessions_coordinator ON dining_sessions(school_id,coordinator_person_id,created_at,id);
CREATE INDEX dining_sessions_place ON dining_sessions(school_id,space_id);
CREATE TABLE dining_session_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,session_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL REFERENCES campus_model_commands(id),action text NOT NULL,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,state text NOT NULL,label text NOT NULL,menu_text text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,space_id uuid REFERENCES campus_spaces(id),
 coordinator_person_id uuid NOT NULL,operator_person_id uuid NOT NULL,count_total integer NOT NULL CHECK(count_total BETWEEN 0 AND 10000000),observed_at timestamptz,supersedes_receipt_id uuid,recorded_at timestamptz NOT NULL,
 UNIQUE(school_id,id),UNIQUE(school_id,session_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(school_id,session_id) REFERENCES dining_sessions(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,operator_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,supersedes_receipt_id) REFERENCES dining_session_receipts(school_id,id)
);
ALTER TABLE dining_sessions ADD FOREIGN KEY(school_id,current_count_receipt_id) REFERENCES dining_session_receipts(school_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX dining_session_receipts_actor ON dining_session_receipts(school_id,actor_person_id,recorded_at);
CREATE INDEX dining_session_receipts_coordinator ON dining_session_receipts(school_id,coordinator_person_id);
CREATE INDEX dining_session_receipts_operator ON dining_session_receipts(school_id,operator_person_id);
CREATE INDEX dining_session_receipts_command ON dining_session_receipts(command_id);
CREATE INDEX dining_session_receipts_previous ON dining_session_receipts(school_id,supersedes_receipt_id);
CREATE INDEX dining_sessions_count_receipt ON dining_sessions(school_id,current_count_receipt_id);
CREATE TABLE dining_issues (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,session_id uuid NOT NULL,reporter_person_id uuid NOT NULL,handler_person_id uuid NOT NULL,coordinator_person_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 160),detail text NOT NULL CHECK(length(detail)<=2000),state text NOT NULL CHECK(state IN('open','accepted','resolved')),revision integer NOT NULL CHECK(revision>0),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,coordination_receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,session_id) REFERENCES dining_sessions(school_id,id),FOREIGN KEY(school_id,reporter_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,handler_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX dining_issues_session ON dining_issues(school_id,session_id,created_at,id);
CREATE INDEX dining_issues_reporter ON dining_issues(school_id,reporter_person_id,created_at,id);
CREATE INDEX dining_issues_handler ON dining_issues(school_id,handler_person_id,created_at,id);
CREATE INDEX dining_issues_coordinator ON dining_issues(school_id,coordinator_person_id,created_at,id);
CREATE TABLE dining_issue_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,issue_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL REFERENCES campus_model_commands(id),action text NOT NULL,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,state text NOT NULL,handler_person_id uuid NOT NULL,coordinator_person_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(school_id,id),UNIQUE(school_id,issue_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(school_id,issue_id) REFERENCES dining_issues(school_id,id),FOREIGN KEY(school_id,actor_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,handler_person_id) REFERENCES school_people(school_id,id),FOREIGN KEY(school_id,coordinator_person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX dining_issue_receipts_actor ON dining_issue_receipts(school_id,actor_person_id,recorded_at);
CREATE INDEX dining_issue_receipts_handler ON dining_issue_receipts(school_id,handler_person_id);
CREATE INDEX dining_issue_receipts_coordinator ON dining_issue_receipts(school_id,coordinator_person_id);
CREATE INDEX dining_issue_receipts_command ON dining_issue_receipts(command_id);
CREATE FUNCTION dining_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Dining evidence and its provenance are immutable.' USING ERRCODE='23514';END $$;
CREATE FUNCTION dining_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dining retains its operating history.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.created_at,OLD.created_by_user_id)
 OR NEW.revision NOT IN(OLD.revision,OLD.revision+1) OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'Dining changes require the next exact native revision.' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='dining_sessions' THEN
 IF ROW(NEW.service_id,NEW.service_revision,NEW.menu_mode,NEW.operations_mode,NEW.source_label,NEW.source_url,NEW.source_reference,NEW.source_observed_at)
   IS DISTINCT FROM ROW(OLD.service_id,OLD.service_revision,OLD.menu_mode,OLD.operations_mode,OLD.source_label,OLD.source_url,OLD.source_reference,OLD.source_observed_at)
 THEN RAISE EXCEPTION 'A dated service retains its exact source ownership and published reference lineage.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='dining_issues' THEN
 IF ROW(NEW.session_id,NEW.reporter_person_id,NEW.title,NEW.detail) IS DISTINCT FROM ROW(OLD.session_id,OLD.reporter_person_id,OLD.title,OLD.detail)
 THEN RAISE EXCEPTION 'A dining report retains its original source and reporter.' USING ERRCODE='23514';END IF;
 ELSE
 IF ROW(NEW.menu_mode,NEW.operations_mode) IS DISTINCT FROM ROW(OLD.menu_mode,OLD.operations_mode) AND EXISTS(SELECT 1 FROM dining_sessions WHERE school_id=OLD.school_id AND service_id=OLD.id)
 THEN RAISE EXCEPTION 'A service with dated records requires a reviewed ownership handover.' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE relation text;owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH relation IN ARRAY ARRAY['dining_services','dining_service_receipts','dining_sessions','dining_session_receipts','dining_issues','dining_issue_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation);EXECUTE format('ALTER TABLE %I OWNER TO %I',relation,owner_name);
  IF relation LIKE '%receipts' THEN EXECUTE format('CREATE TRIGGER dining_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dining_immutable()',relation);
  ELSE EXECUTE format('CREATE TRIGGER dining_current_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dining_current_guard()',relation);END IF;
 END LOOP;
END $$;
