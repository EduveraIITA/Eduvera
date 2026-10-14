-- Provider-neutral assistant transport. External identities are linked only by
-- a signed-in user consuming a short-lived, single-use token in the provider.
CREATE TABLE agent_channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('principal','teacher','parent','student')),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('telegram','whatsapp')),
  external_user_id text NOT NULL CHECK (length(external_user_id) BETWEEN 1 AND 160),
  external_chat_id text NOT NULL CHECK (length(external_chat_id) BETWEEN 1 AND 160),
  agent_thread_id uuid NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'linked' CHECK (state IN ('linked','revoked')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE UNIQUE INDEX agent_channel_external_linked
  ON agent_channel_connections(provider,external_user_id) WHERE state='linked';
CREATE UNIQUE INDEX agent_channel_owner_linked
  ON agent_channel_connections(owner_id,provider) WHERE state='linked';
CREATE INDEX agent_channel_connections_owner
  ON agent_channel_connections(owner_id,linked_at DESC);

CREATE TABLE agent_channel_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('principal','teacher','parent','student')),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('telegram','whatsapp')),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_channel_link_token_expiry ON agent_channel_link_tokens(expires_at);

-- Durable normalized inbox. Raw provider updates and secrets are never stored.
-- Text exists only until the worker has copied the turn into the authorized
-- agent thread, then it is erased from this transport queue.
CREATE TABLE agent_channel_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('telegram','whatsapp')),
  provider_update_id text NOT NULL,
  external_user_id text NOT NULL,
  external_chat_id text NOT NULL,
  provider_message_id text NOT NULL,
  sender_label text NOT NULL DEFAULT '',
  message_text text CHECK (message_text IS NULL OR length(message_text) BETWEEN 1 AND 4000),
  link_token_hash char(64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed','ignored')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  connection_id uuid REFERENCES agent_channel_connections(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  last_error_code text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider,provider_update_id)
);
CREATE INDEX agent_channel_updates_work
  ON agent_channel_updates(status,next_attempt_at,received_at)
  WHERE status IN ('pending','processing');

-- Metadata-only delivery ledger. Message content lives in the existing scoped
-- agent thread, not in a second unbounded external transcript.
CREATE TABLE agent_channel_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES agent_channel_connections(id) ON DELETE CASCADE,
  update_id uuid REFERENCES agent_channel_updates(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider_message_id text NOT NULL DEFAULT '',
  content_hash char(64) NOT NULL,
  character_count integer NOT NULL CHECK (character_count >= 0),
  delivery_state text NOT NULL CHECK (delivery_state IN ('accepted','sent','failed')),
  error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_channel_deliveries_connection
  ON agent_channel_deliveries(connection_id,created_at DESC);

COMMENT ON TABLE agent_channel_connections IS
  'Verified external transport binding. Provider identifiers locate a linked app account but never independently grant school authorization.';
COMMENT ON TABLE agent_channel_updates IS
  'Idempotent normalized webhook queue; raw link tokens are never stored and transport text is erased after terminal processing.';

DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
    FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'agent_channel_connections','agent_channel_link_tokens',
    'agent_channel_updates','agent_channel_deliveries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
END $$;
