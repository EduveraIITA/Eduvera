CREATE TABLE invitation_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invitation_id uuid NOT NULL REFERENCES school_invitations(id) ON DELETE CASCADE,
 token_hash text NOT NULL,
 encrypted_token text,
 delivery_state text NOT NULL DEFAULT 'queued' CHECK(delivery_state IN ('queued','sending','email_accepted','failed','unknown','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invitation_id, token_hash)
);
CREATE INDEX invitation_email_jobs_pending ON invitation_email_jobs(created_at) WHERE delivery_state='queued';
DO $$ DECLARE owner_name text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_invitations'::regclass;
 ALTER TABLE invitation_email_jobs ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON invitation_email_jobs FROM PUBLIC;
 EXECUTE format('ALTER TABLE invitation_email_jobs OWNER TO %I',owner_name);
END $$;
