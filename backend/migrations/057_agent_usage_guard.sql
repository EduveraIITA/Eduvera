-- Private durable reservations shared by all accounts and application replicas.
CREATE TABLE agent_model_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  input_tokens integer NOT NULL CHECK (input_tokens BETWEEN 0 AND 24000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens = 2048),
  reserved_micros integer NOT NULL CHECK (reserved_micros > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_model_usage_period ON agent_model_usage(created_at);
CREATE INDEX agent_model_usage_run ON agent_model_usage(run_id);
CREATE INDEX agent_runs_recent ON agent_runs(created_at,thread_id);
ALTER TABLE agent_model_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_model_usage FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON agent_model_usage FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON agent_model_usage FROM authenticated; END IF;
END $$;
COMMENT ON TABLE agent_model_usage IS 'Conservative pre-call USD micro-unit reservations; never refunded, even on timeout. Not an invoice or a Google billing cap.';
