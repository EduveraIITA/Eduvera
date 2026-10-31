-- The observation payload is retained evidence; reconciliation state has its
-- own recorded-time history. Existing rows only establish what is known at this
-- migration, never an invented pending/accepted history before that boundary.
ALTER TABLE campus_model_observations ADD COLUMN state_recorded_at timestamptz;
UPDATE campus_model_observations SET state_recorded_at=clock_timestamp();
ALTER TABLE campus_model_observations ALTER COLUMN state_recorded_at SET NOT NULL,
  ALTER COLUMN state_recorded_at SET DEFAULT clock_timestamp(),
  ADD CONSTRAINT observation_history_address UNIQUE(id,school_id,realm_id,environment_namespace_id);

CREATE TABLE campus_model_observation_states (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observation_id uuid NOT NULL,
  school_id uuid NOT NULL,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','accepted','rejected','quarantined','superseded')),
  recorded_at timestamptz NOT NULL,
  basis text NOT NULL CHECK(basis IN ('ingress','domain_transition','migration_current_state')),
  FOREIGN KEY(observation_id,school_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_observations(id,school_id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(environment_namespace_id,realm_id) REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT
);
CREATE INDEX observation_state_recorded_lookup ON campus_model_observation_states
  (realm_id,environment_namespace_id,observation_id,recorded_at DESC,sequence DESC);
INSERT INTO campus_model_observation_states(observation_id,school_id,realm_id,environment_namespace_id,state,recorded_at,basis)
  SELECT id,school_id,realm_id,environment_namespace_id,state,state_recorded_at,'migration_current_state'
  FROM campus_model_observations;

CREATE FUNCTION date_campus_observation_state() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.state_recorded_at IS NOT DISTINCT FROM OLD.state_recorded_at THEN
    NEW.state_recorded_at:=GREATEST(clock_timestamp(),OLD.state_recorded_at);
  END IF;
  IF TG_OP='UPDATE' AND NEW.state_recorded_at<OLD.state_recorded_at THEN
    RAISE EXCEPTION 'Observation state cannot be recorded before its retained predecessor';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION retain_campus_observation_state() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
  INSERT INTO campus_model_observation_states(observation_id,school_id,realm_id,environment_namespace_id,state,recorded_at,basis)
    VALUES(NEW.id,NEW.school_id,NEW.realm_id,NEW.environment_namespace_id,NEW.state,
      NEW.state_recorded_at,
      CASE WHEN TG_OP='INSERT' THEN 'ingress' ELSE 'domain_transition' END);
  RETURN NEW;
END $$;
CREATE TRIGGER campus_observation_state_clock BEFORE INSERT OR UPDATE OF state ON campus_model_observations
  FOR EACH ROW EXECUTE FUNCTION date_campus_observation_state();
CREATE TRIGGER campus_observation_state_history AFTER INSERT OR UPDATE OF state ON campus_model_observations
  FOR EACH ROW EXECUTE FUNCTION retain_campus_observation_state();
CREATE TRIGGER campus_observation_states_immutable BEFORE UPDATE OR DELETE ON campus_model_observation_states
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
ALTER TABLE campus_model_observation_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE campus_model_observation_states FROM PUBLIC;
REVOKE ALL ON FUNCTION retain_campus_observation_state(),date_campus_observation_state() FROM PUBLIC;
DO $$ DECLARE owner_name text;role_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='campus_model_observations'::regclass;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE campus_model_observation_states FROM %I',role_name);
    END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE campus_model_observation_states OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION retain_campus_observation_state() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION date_campus_observation_state() OWNER TO %I',owner_name);
END $$;
