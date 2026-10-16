-- Durable command receipts for staff leave mutations. A client command UUID is
-- scoped to one institution and actor, and retains the exact material result
-- plus the domain event that was committed with it.

ALTER TABLE staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_id_school_unique UNIQUE(id,school_id);

CREATE TABLE staff_leave_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  command_type varchar(24) NOT NULL CHECK(command_type IN ('submit','decide','withdraw')),
  target_request_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  outbox_event_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  coordination_receipt jsonb NOT NULL CHECK(jsonb_typeof(coordination_receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,actor_id,command_id),
  FOREIGN KEY(target_request_id,school_id)
    REFERENCES staff_leave_requests(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(outbox_event_id,school_id)
    REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id,school_id)
    REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT
);

CREATE INDEX staff_leave_commands_request_idx
  ON staff_leave_commands(school_id,target_request_id,created_at);
CREATE UNIQUE INDEX staff_leave_commands_submission_idx
  ON staff_leave_commands(school_id,target_request_id)
  WHERE command_type='submit';

ALTER TABLE staff_leave_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE staff_leave_commands FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.staff_leave_requests'::regclass;
  EXECUTE format('ALTER TABLE public.staff_leave_commands OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.staff_leave_commands FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
