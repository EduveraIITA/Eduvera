-- Provider-independent calendar subscriptions. The URL token is a bearer
-- secret: only its SHA-256 digest and a short non-secret hint are retained.
CREATE TABLE calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('principal','teacher','parent','student')),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  token_hint varchar(8) NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_fetched_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((portal IN ('parent','student')) = (student_id IS NOT NULL))
);

CREATE UNIQUE INDEX calendar_subscriptions_active_scope
  ON calendar_subscriptions(owner_id,school_id,portal,COALESCE(student_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state='active';
CREATE INDEX calendar_subscriptions_owner ON calendar_subscriptions(owner_id,created_at DESC);

COMMENT ON TABLE calendar_subscriptions IS
  'Revocable, role-scoped iCalendar projections. Edura remains authoritative and external calendars receive no write access.';

DO $$
DECLARE application_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
    FROM pg_class WHERE oid='public.students'::regclass;
  ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.calendar_subscriptions FROM PUBLIC;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.calendar_subscriptions FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.calendar_subscriptions FROM authenticated;
  END IF;
  EXECUTE format('ALTER TABLE public.calendar_subscriptions OWNER TO %I',application_owner);
END $$;
