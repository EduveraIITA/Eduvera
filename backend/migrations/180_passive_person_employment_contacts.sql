-- Contact email is descriptive, not identity. Multiple explicitly selected
-- passive employees may have no email; nonblank contact uniqueness is retained.
DROP INDEX staff_profiles_school_email_key;
CREATE UNIQUE INDEX staff_profiles_school_email_key ON staff_profiles(school_id,lower(email)) WHERE btrim(email)<>'';
