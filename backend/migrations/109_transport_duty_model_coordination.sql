-- Model-mediated transport duty change commands. The transport domain remains
-- authoritative; these receipts retain retries and the exact coordination and
-- governance evidence used by each material command.

CREATE TABLE transport_duty_change_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  command_type varchar(16) NOT NULL CHECK(command_type IN ('request','respond','decide')),
  target_swap_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  outbox_event_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  authority_receipt jsonb CHECK(authority_receipt IS NULL OR jsonb_typeof(authority_receipt)='object'),
  coordination_receipt jsonb NOT NULL CHECK(jsonb_typeof(coordination_receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,actor_id,command_id),
  FOREIGN KEY(target_swap_id,school_id)
    REFERENCES transport_duty_swap_requests(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(outbox_event_id,school_id)
    REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id,school_id)
    REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT
);

CREATE INDEX transport_duty_change_commands_swap_idx
  ON transport_duty_change_commands(school_id,target_swap_id,created_at);
CREATE UNIQUE INDEX transport_duty_change_commands_request_idx
  ON transport_duty_change_commands(school_id,target_swap_id)
  WHERE command_type='request';

ALTER TABLE transport_duty_change_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE transport_duty_change_commands FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.transport_duty_swap_requests'::regclass;
  EXECUTE format('ALTER TABLE public.transport_duty_change_commands OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.transport_duty_change_commands FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
