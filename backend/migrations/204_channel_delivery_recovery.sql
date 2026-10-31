-- Durable per-part acknowledgement. Never store a second external transcript.
CREATE TABLE agent_channel_outbound_parts (
  update_id uuid NOT NULL REFERENCES agent_channel_updates(id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK(part_index>=0),
  part_count integer NOT NULL CHECK(part_count BETWEEN 1 AND 100),
  content_hash char(64) NOT NULL,
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','sending','sent','rejected','uncertain')),
  provider_message_id text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(update_id,part_index),
  CHECK(part_index<part_count),
  CHECK(state<>'sent' OR length(provider_message_id)>0)
);
ALTER TABLE agent_channel_updates DROP CONSTRAINT agent_channel_updates_status_check;
ALTER TABLE agent_channel_updates ADD CONSTRAINT agent_channel_updates_status_check
  CHECK(status IN ('pending','processing','delivered','failed','ignored','uncertain'));
CREATE INDEX agent_channel_updates_connection_attention ON agent_channel_updates(connection_id,received_at DESC)
  WHERE status='uncertain';
ALTER TABLE agent_channel_outbound_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_channel_outbound_parts FROM PUBLIC;
DO $$ DECLARE application_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.agent_channel_updates'::regclass;
  EXECUTE format('ALTER TABLE agent_channel_outbound_parts OWNER TO %I',application_owner);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON agent_channel_outbound_parts FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON agent_channel_outbound_parts FROM authenticated; END IF;
END $$;
COMMENT ON TABLE agent_channel_outbound_parts IS 'Live-only provider delivery checkpoints. Sending without a durable acknowledgement is uncertain, not retryable. Simulation excludes external agent transport tables.';
