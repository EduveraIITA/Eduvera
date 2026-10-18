-- Staff campus-boundary movements are separate from classroom attendance.
CREATE TABLE gate_staff_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  direction varchar(4) NOT NULL CHECK (direction IN ('in','out')),
  gate varchar(80) NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'gatekeeper',
  recorded_by uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL UNIQUE,
  FOREIGN KEY (school_id,staff_profile_id) REFERENCES staff_profiles(school_id,id) ON DELETE CASCADE
);

CREATE INDEX gate_staff_school_time_idx ON gate_staff_events(school_id,occurred_at DESC,id DESC);
CREATE INDEX gate_staff_profile_time_idx ON gate_staff_events(school_id,staff_profile_id,occurred_at DESC,id DESC);

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='gate_events'::regclass;
  EXECUTE format('ALTER TABLE gate_staff_events OWNER TO %I',owner_name);
  REVOKE ALL ON TABLE gate_staff_events FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE gate_staff_events FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE gate_staff_events FROM authenticated; END IF;
  ALTER TABLE gate_staff_events ENABLE ROW LEVEL SECURITY;
END $$;
