-- Google subject is stable; email is only used for the first authoritative link.
CREATE TABLE auth_google_identities (
  subject text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_google_nonces (
  nonce_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_google_nonces_expiry ON auth_google_nonces(expires_at);
ALTER TABLE auth_google_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_google_nonces ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE object_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='users'::regclass;
  FOREACH object_name IN ARRAY ARRAY['auth_google_identities','auth_google_nonces'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',object_name); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',object_name); END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',object_name,owner_name);
  END LOOP;
END $$;
