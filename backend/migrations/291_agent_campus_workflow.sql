-- PostgresSaver 1.1.4, schema versions 0–5. Create storage with the normal
-- migrator instead of requiring runtime schema privileges. Each private
-- checkpoint belongs to an existing Assistant run and cascades with it.
CREATE SCHEMA agent_campus_workflow;
REVOKE ALL ON SCHEMA agent_campus_workflow FROM PUBLIC;

CREATE TABLE agent_campus_workflow.checkpoint_migrations (
  v integer PRIMARY KEY
);
INSERT INTO agent_campus_workflow.checkpoint_migrations(v) VALUES (0),(1),(2),(3),(4),(5);

CREATE TABLE agent_campus_workflow.checkpoints (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  run_id uuid GENERATED ALWAYS AS (thread_id::uuid) STORED REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id,checkpoint_ns,checkpoint_id)
);
CREATE TABLE agent_campus_workflow.checkpoint_blobs (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  channel text NOT NULL,
  version text NOT NULL,
  type text NOT NULL,
  blob bytea,
  run_id uuid GENERATED ALWAYS AS (thread_id::uuid) STORED REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id,checkpoint_ns,channel,version)
);
CREATE TABLE agent_campus_workflow.checkpoint_writes (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  idx integer NOT NULL,
  channel text NOT NULL,
  type text,
  blob bytea NOT NULL,
  task_path text NOT NULL DEFAULT '',
  run_id uuid GENERATED ALWAYS AS (thread_id::uuid) STORED REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id,checkpoint_ns,checkpoint_id,task_id,idx)
);
CREATE INDEX agent_campus_workflow_checkpoints_run ON agent_campus_workflow.checkpoints(run_id);
CREATE INDEX agent_campus_workflow_checkpoint_blobs_run ON agent_campus_workflow.checkpoint_blobs(run_id);
CREATE INDEX agent_campus_workflow_checkpoint_writes_run ON agent_campus_workflow.checkpoint_writes(run_id);

DO $$
DECLARE application_owner text; table_name text; browser_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO STRICT application_owner FROM pg_class WHERE oid='public.agent_runs'::regclass;
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA agent_campus_workflow FROM %I',browser_role);
    END IF;
  END LOOP;
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA agent_campus_workflow TO %I',application_owner);
  FOREACH table_name IN ARRAY ARRAY['checkpoint_migrations','checkpoints','checkpoint_blobs','checkpoint_writes'] LOOP
    EXECUTE format('ALTER TABLE agent_campus_workflow.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE agent_campus_workflow.%I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE agent_campus_workflow.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
  EXECUTE format('REVOKE CREATE ON SCHEMA agent_campus_workflow FROM %I',application_owner);
END $$;
