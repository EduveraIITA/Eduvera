ALTER TABLE auth_sessions
  ADD COLUMN is_public_demo boolean NOT NULL DEFAULT false;

CREATE INDEX auth_sessions_public_demo_expiry_idx
  ON auth_sessions(expires_at)
  WHERE is_public_demo;

ALTER TABLE marketing_enquiries
  DROP CONSTRAINT marketing_enquiries_full_name_check,
  DROP CONSTRAINT marketing_enquiries_institution_name_check,
  DROP CONSTRAINT marketing_enquiries_institution_type_check,
  DROP CONSTRAINT marketing_enquiries_student_count_check,
  ALTER COLUMN full_name SET DEFAULT '',
  ALTER COLUMN institution_name SET DEFAULT '',
  ALTER COLUMN institution_type SET DEFAULT '',
  ALTER COLUMN email SET DEFAULT '',
  ALTER COLUMN phone SET DEFAULT '',
  ALTER COLUMN location SET DEFAULT '',
  ALTER COLUMN student_count DROP NOT NULL;

ALTER TABLE marketing_enquiries
  ADD CONSTRAINT marketing_enquiries_contact_check
    CHECK (length(email) > 0 OR length(phone) > 0),
  ADD CONSTRAINT marketing_enquiries_full_name_check
    CHECK (length(full_name) <= 100),
  ADD CONSTRAINT marketing_enquiries_institution_name_check
    CHECK (length(institution_name) <= 180),
  ADD CONSTRAINT marketing_enquiries_institution_type_check
    CHECK (length(institution_type) <= 20),
  ADD CONSTRAINT marketing_enquiries_student_count_check
    CHECK (student_count IS NULL OR student_count BETWEEN 1 AND 1000000);
