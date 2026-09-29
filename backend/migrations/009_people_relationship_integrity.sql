-- Every guardian link has an explicit tenant-scoped identity on both sides.
ALTER TABLE guardian_relationships ADD COLUMN school_id uuid;
UPDATE guardian_relationships g SET school_id=s.school_id FROM students s WHERE s.id=g.student_id;
ALTER TABLE guardian_relationships ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE guardian_relationships ADD CONSTRAINT guardian_relationship_student_scope_fk
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE guardian_relationships ADD CONSTRAINT guardian_relationship_profile_scope_fk
  FOREIGN KEY(school_id,guardian_id) REFERENCES guardian_school_profiles(school_id,guardian_id) DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX guardian_relationships_school_guardian_idx ON guardian_relationships(school_id,guardian_id);
CREATE UNIQUE INDEX students_school_admission_ci_idx ON students(school_id,lower(admission_number));
CREATE INDEX people_intakes_expiry_idx ON people_intakes(expires_at) WHERE committed_student_id IS NULL;

CREATE OR REPLACE FUNCTION ensure_guardian_school_person() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE school uuid; person uuid;
BEGIN
  SELECT school_id INTO school FROM students WHERE id=NEW.student_id;
  IF NEW.school_id IS NOT NULL AND NEW.school_id<>school THEN
    RAISE EXCEPTION 'Guardian relationship school mismatch' USING ERRCODE='23514';
  END IF;
  NEW.school_id=school;
  PERFORM id FROM parents WHERE id=NEW.guardian_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM guardian_school_profiles WHERE school_id=school AND guardian_id=NEW.guardian_id) THEN
    INSERT INTO school_people(school_id,first_name,last_name,contact_phone,contact_email)
      SELECT school,u.first_name,u.last_name,p.phone,u.email FROM parents p JOIN users u ON u.id=p.user_id WHERE p.id=NEW.guardian_id
      RETURNING id INTO person;
    IF person IS NULL THEN RAISE EXCEPTION 'Guardian needs an explicit school profile' USING ERRCODE='23514'; END IF;
    INSERT INTO guardian_school_profiles VALUES(school,NEW.guardian_id,person);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER guardian_person_before_write ON guardian_relationships;
CREATE TRIGGER guardian_person_before_write BEFORE INSERT OR UPDATE ON guardian_relationships
  FOR EACH ROW EXECUTE FUNCTION ensure_guardian_school_person();
