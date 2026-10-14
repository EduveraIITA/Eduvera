-- Public marketing enquiries are company metadata, never student records.
CREATE TABLE marketing_enquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 full_name text NOT NULL CHECK(length(full_name) BETWEEN 2 AND 100),
 institution_name text NOT NULL CHECK(length(institution_name) BETWEEN 2 AND 180),
 institution_type text NOT NULL CHECK(institution_type IN ('school','college','university','other')),
 email text NOT NULL CHECK(length(email)<=254),phone text NOT NULL CHECK(length(phone)<=30),
 location text NOT NULL CHECK(length(location)<=160),student_count integer NOT NULL CHECK(student_count BETWEEN 1 AND 1000000),
 message text NOT NULL DEFAULT '' CHECK(length(message)<=2000),
 consent_version text NOT NULL, fingerprint text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX marketing_enquiries_queue ON marketing_enquiries(status,created_at DESC);
CREATE TABLE marketing_rate_limits(bucket_key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE marketing_notification_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),enquiry_id uuid NOT NULL UNIQUE REFERENCES marketing_enquiries(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),attempted_at timestamptz,finished_at timestamptz
);
-- No anonymous RLS policy. Access is exclusively through server-side credentials.
ALTER TABLE marketing_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_notification_jobs ENABLE ROW LEVEL SECURITY;
-- Match the established migration contract: the application table owner is
-- separate from the migrator login. No public/anonymous policies are added.
DO $$ DECLARE runtime_owner text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_memberships'::regclass;
 EXECUTE format('ALTER TABLE marketing_enquiries OWNER TO %I',runtime_owner);
 EXECUTE format('ALTER TABLE marketing_rate_limits OWNER TO %I',runtime_owner);
 EXECUTE format('ALTER TABLE marketing_notification_jobs OWNER TO %I',runtime_owner);
END $$;
