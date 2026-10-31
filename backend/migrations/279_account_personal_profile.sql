-- Self-managed global account details; never a canonical campus-person correction.
CREATE TABLE auth_personal_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  contact_phone varchar(24) NOT NULL DEFAULT '',
  phone_verified_at timestamptz,
  education_background varchar(1000) NOT NULL DEFAULT '',
  photo_override boolean NOT NULL DEFAULT false,
  photo_bytes bytea,
  last_change_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_phone = '' OR contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (phone_verified_at IS NULL OR contact_phone <> ''),
  CHECK (photo_bytes IS NULL OR octet_length(photo_bytes) <= 524288)
);
CREATE TABLE auth_phone_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_revision integer NOT NULL,
  phone varchar(24) NOT NULL,
  session_hash text NOT NULL,
  code_hash char(64) NOT NULL,
  state varchar(24) NOT NULL CHECK (state IN ('pending','sent','delivery_unknown','verified','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX auth_phone_challenges_actor_time ON auth_phone_challenges(user_id,created_at DESC);
CREATE INDEX auth_phone_challenges_number_time ON auth_phone_challenges(phone,created_at DESC);
