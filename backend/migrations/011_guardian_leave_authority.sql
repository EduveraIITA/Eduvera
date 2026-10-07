-- Leave-signing authority is distinct from the enduring family relationship.
ALTER TABLE guardian_relationships
  ADD COLUMN authority_revision integer NOT NULL DEFAULT 1 CHECK(authority_revision>0),
  ADD COLUMN leave_valid_from date,
  ADD COLUMN leave_valid_until date,
  ADD COLUMN authority_source text NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT guardian_leave_dates CHECK(leave_valid_until IS NULL OR leave_valid_from IS NULL OR leave_valid_until>=leave_valid_from),
  ADD CONSTRAINT guardian_authority_source CHECK(authority_source IN ('legacy','enrollment','reviewed')),
  ADD CONSTRAINT guardian_school_relationship_unique UNIQUE(school_id,id);
ALTER TABLE guardian_relationships ALTER COLUMN authority_source SET DEFAULT 'enrollment';

CREATE TABLE guardian_leave_authority_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  input jsonb NOT NULL,
  previous jsonb NOT NULL,
  result jsonb NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,relationship_id) REFERENCES guardian_relationships(school_id,id) ON DELETE CASCADE,
  UNIQUE(school_id,actor_id,command_key)
);
CREATE INDEX guardian_leave_authority_history_idx ON guardian_leave_authority_commands(school_id,relationship_id,recorded_at DESC);
CREATE INDEX guardian_leave_authority_actor_idx ON guardian_leave_authority_commands(actor_id);
ALTER TABLE guardian_leave_authority_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guardian_leave_authority_commands FROM PUBLIC;
DO $$ DECLARE school_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO school_owner FROM pg_class WHERE oid='public.students'::regclass;
  EXECUTE format('ALTER TABLE public.guardian_leave_authority_commands OWNER TO %I',school_owner);
END $$;

-- Re-evaluated on every read/command; expiry needs no polling or scheduled write.
CREATE FUNCTION guardian_may_sign_leave(g guardian_relationships, school_today date)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT g.can_authorize_leave
    AND (g.leave_valid_from IS NULL OR g.leave_valid_from<=school_today)
    AND (g.leave_valid_until IS NULL OR g.leave_valid_until>=school_today)
$$;
