-- Privacy-safe participation links for ordinary domain events. Chat content remains
-- in the Messaging domain; the Model Core retains only who participated in the
-- accepted event and its typed, non-content metadata.

CREATE TABLE campus_model_event_agent_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL,
  environment_namespace_id text NOT NULL,
  event_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  participation_kind varchar(24) NOT NULL CHECK(participation_kind IN ('audience','owner','witness')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(realm_id,environment_namespace_id,event_id,agent_id,participation_kind),
  FOREIGN KEY(event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE CASCADE
);

CREATE INDEX campus_model_event_agent_participants_agent_idx
  ON campus_model_event_agent_participants(realm_id,environment_namespace_id,agent_id,recorded_at DESC);

ALTER TABLE campus_model_event_agent_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE campus_model_event_agent_participants FROM PUBLIC;

DO $$
DECLARE application_owner text;
BEGIN
  SELECT tableowner INTO application_owner
  FROM pg_tables WHERE schemaname='public' AND tablename='campus_model_events';
  IF application_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.campus_model_event_agent_participants OWNER TO %I',application_owner);
  END IF;
END $$;
