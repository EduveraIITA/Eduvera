CREATE TABLE auth_session_execution_environments (
  token_hash text PRIMARY KEY
    REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
  school_id uuid NOT NULL
    REFERENCES schools(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL,
  run_id uuid NOT NULL,
  namespace_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  bound_by uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_session_execution_environment_namespace_chk CHECK (
    namespace_id = 'scenario:' || scenario_id::text || ':run:' || run_id::text
  ),
  CONSTRAINT auth_session_execution_environment_expiry_chk CHECK (expires_at > bound_at)
);

CREATE INDEX auth_session_execution_environments_expiry_idx
  ON auth_session_execution_environments(expires_at);

CREATE INDEX auth_session_execution_environments_school_run_idx
  ON auth_session_execution_environments(school_id, run_id);

COMMENT ON TABLE auth_session_execution_environments IS
  'Server-authoritative authenticated-session selection of one transient Simulation fork. Absence means Live.';

COMMENT ON COLUMN auth_session_execution_environments.namespace_id IS
  'Verified run namespace; callers cannot select an environment through a request header.';
