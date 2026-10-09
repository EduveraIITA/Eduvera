-- Additive agent records; no application data or existing AI history is rewritten.
CREATE TABLE agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  school_id uuid NOT NULL REFERENCES schools(id),
  portal text NOT NULL CHECK (portal IN ('principal','teacher','parent','student')),
  student_id uuid REFERENCES students(id),
  title text NOT NULL DEFAULT 'New conversation',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_threads_owner ON agent_threads(owner_id, school_id, updated_at DESC);
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 4000),
  status text NOT NULL CHECK (status IN ('running','completed','confirmation','failed','cancelled')),
  answer text NOT NULL DEFAULT '',
  progress text NOT NULL DEFAULT 'Thinking',
  provider text NOT NULL,
  model text NOT NULL,
  lease_expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  evidence jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(thread_id, client_id)
);
CREATE UNIQUE INDEX agent_one_active_run ON agent_runs(thread_id) WHERE status='running';
CREATE TABLE agent_tool_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  capability text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('read','proposal','handoff')),
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  snapshot_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_tool_steps_run ON agent_tool_steps(run_id, created_at);
CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  capability text NOT NULL,
  input jsonb NOT NULL,
  basis_step_id uuid NOT NULL REFERENCES agent_tool_steps(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','succeeded','rejected','expired','stale','failed','uncertain')),
  receipt jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(run_id)
);
COMMENT ON TABLE agent_tool_steps IS 'Private, permission-scoped evidence. Never a source of executable instructions.';
COMMENT ON TABLE agent_actions IS 'Immutable preview input; human approval and fresh API validation required. No automatic retry of ambiguous writes.';
