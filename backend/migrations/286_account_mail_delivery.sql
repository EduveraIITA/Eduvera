-- Account-control mail is not campus evidence and is never copied into a
-- Simulation world. Tokens and their encrypted delivery intent commit together.
ALTER TABLE auth_account_tokens ADD COLUMN email_at_issue varchar(254);
-- Old proofs did not retain an issuing mailbox. Do not invent that historical
-- binding from today's address; require a fresh request instead.
UPDATE auth_account_tokens SET consumed_at=now() WHERE consumed_at IS NULL;
ALTER TABLE auth_account_tokens ADD CONSTRAINT auth_account_tokens_mailbox_binding
 CHECK(email_at_issue IS NOT NULL OR consumed_at IS NOT NULL);

CREATE TABLE auth_account_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_token_id uuid NOT NULL UNIQUE REFERENCES auth_account_tokens(id) ON DELETE CASCADE,
 recipient_email varchar(254) NOT NULL,
 purpose varchar(24) NOT NULL CHECK(purpose IN ('email_verification','password_reset')),
 encrypted_token text,
 delivery_state text NOT NULL DEFAULT 'queued' CHECK(delivery_state IN ('queued','sending','email_accepted','failed','unknown','cancelled')),
 provider varchar(16) CHECK(provider IN ('smtp','resend')),
 provider_message_id text,
 failure_category varchar(24) CHECK(failure_category IN ('authentication','recipient','connection','provider')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((delivery_state IN ('queued','sending'))=(encrypted_token IS NOT NULL))
);
CREATE INDEX auth_account_email_jobs_pending ON auth_account_email_jobs(created_at) WHERE delivery_state='queued';
CREATE INDEX auth_account_email_jobs_claimed ON auth_account_email_jobs(updated_at) WHERE delivery_state='sending';
ALTER TABLE auth_account_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_account_email_jobs FROM PUBLIC;
DO $$ DECLARE owner_name name; database_role name; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='auth_account_tokens'::regclass;
 EXECUTE format('ALTER TABLE auth_account_email_jobs OWNER TO %I',owner_name);
 FOREACH database_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
   EXECUTE format('REVOKE ALL ON auth_account_email_jobs FROM %I',database_role);
  END IF;
 END LOOP;
END $$;
