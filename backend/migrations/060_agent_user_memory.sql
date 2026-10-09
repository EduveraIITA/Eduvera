-- Bounded, user-visible long-term personalization. These rows are never school
-- record evidence, action authority, or a replacement for a fresh domain read.
CREATE TABLE agent_user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('principal','teacher','parent','student')),
  category text NOT NULL CHECK (category IN (
    'communication_preference','workflow_preference','app_knowledge'
  )),
  topic text NOT NULL CHECK (topic ~ '^[a-z0-9][a-z0-9_-]{1,47}$'),
  content text NOT NULL CHECK (length(content) BETWEEN 2 AND 280),
  token_count integer NOT NULL CHECK (token_count BETWEEN 1 AND 128),
  source_kind text NOT NULL DEFAULT 'explicit_user'
    CHECK (source_kind = 'explicit_user'),
  source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, school_id, portal, category, topic)
);

CREATE INDEX agent_user_memories_scope
  ON agent_user_memories(owner_id, school_id, portal, updated_at DESC);
CREATE INDEX agent_user_memories_expiry ON agent_user_memories(expires_at);

COMMENT ON TABLE agent_user_memories IS
  'Small, inspectable user-authored preferences and app familiarity. Memory is untrusted personalization data, never authorization, action intent, identity proof, or school-record evidence.';
COMMENT ON COLUMN agent_user_memories.token_count IS
  'Conservative application estimate used to enforce the configured prompt-memory budget.';

-- Match the private backend-only storage posture of the other agent tables.
DO $$
DECLARE application_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
    FROM pg_class WHERE oid='public.students'::regclass;
  ALTER TABLE public.agent_user_memories ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.agent_user_memories FROM PUBLIC;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.agent_user_memories FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.agent_user_memories FROM authenticated;
  END IF;
  EXECUTE format('ALTER TABLE public.agent_user_memories OWNER TO %I',application_owner);
END $$;
