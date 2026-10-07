-- A school person is an operational identity, not a login or a matching heuristic.
CREATE TABLE school_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  first_name varchar(150) NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name varchar(150) NOT NULL DEFAULT '',
  contact_phone varchar(32) NOT NULL DEFAULT '',
  contact_email varchar(254) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,id)
);
CREATE INDEX school_people_school_name_idx ON school_people(school_id,first_name,last_name,id);
-- Shared phone numbers are deliberately NOT unique and never identify a person.
CREATE INDEX school_people_school_phone_idx ON school_people(school_id,contact_phone) WHERE contact_phone<>'';

ALTER TABLE students ADD COLUMN person_id uuid;
INSERT INTO school_people(id,school_id,first_name,last_name)
SELECT s.id,s.school_id,u.first_name,u.last_name FROM students s JOIN users u ON u.id=s.user_id;
UPDATE students SET person_id=id;
ALTER TABLE students ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE students ADD CONSTRAINT students_person_scope_fk FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id);
ALTER TABLE students ADD CONSTRAINT students_person_unique UNIQUE(person_id);
ALTER TABLE students ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE parents ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE guardian_school_profiles (
  school_id uuid NOT NULL REFERENCES schools(id),
  guardian_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL UNIQUE,
  PRIMARY KEY(school_id,guardian_id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX guardian_school_profiles_guardian_idx ON guardian_school_profiles(guardian_id);
DO $$ DECLARE g record; person uuid;
BEGIN
  FOR g IN SELECT DISTINCT s.school_id,p.id,p.phone,u.first_name,u.last_name,u.email
    FROM guardian_relationships r JOIN students s ON s.id=r.student_id
    JOIN parents p ON p.id=r.guardian_id JOIN users u ON u.id=p.user_id
  LOOP
    INSERT INTO school_people(school_id,first_name,last_name,contact_phone,contact_email)
      VALUES(g.school_id,g.first_name,g.last_name,g.phone,g.email) RETURNING id INTO person;
    INSERT INTO guardian_school_profiles VALUES(g.school_id,g.id,person);
  END LOOP;
END $$;

-- Keep existing seed/import writers compatible while new intake writes explicit people.
CREATE FUNCTION ensure_student_person() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.person_id IS NULL THEN
    SELECT person_id INTO NEW.person_id FROM students
      WHERE (NEW.user_id IS NOT NULL AND user_id=NEW.user_id)
        OR (school_id=NEW.school_id AND admission_number=NEW.admission_number) LIMIT 1;
  END IF;
  IF NEW.person_id IS NULL THEN
    INSERT INTO school_people(school_id,first_name,last_name)
      SELECT NEW.school_id,first_name,last_name FROM users WHERE id=NEW.user_id
      RETURNING id INTO NEW.person_id;
    IF NEW.person_id IS NULL THEN RAISE EXCEPTION 'Student needs an explicit school person' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_person_before_write BEFORE INSERT ON students FOR EACH ROW EXECUTE FUNCTION ensure_student_person();

CREATE FUNCTION ensure_guardian_school_person() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE school uuid; person uuid;
BEGIN
  SELECT school_id INTO school FROM students WHERE id=NEW.student_id;
  -- Serializes legacy links for a guardian shared by siblings.
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
CREATE TRIGGER guardian_person_before_write BEFORE INSERT OR UPDATE OF guardian_id,student_id ON guardian_relationships
  FOR EACH ROW EXECUTE FUNCTION ensure_guardian_school_person();

ALTER TABLE enrollments ADD COLUMN enrolled_on date;
UPDATE enrollments e SET enrolled_on=t.starts_on FROM academic_terms t WHERE t.id=e.term_id;
ALTER TABLE enrollments ALTER COLUMN enrolled_on SET NOT NULL;
CREATE FUNCTION ensure_enrollment_start() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE term_start date; term_end date;
BEGIN
  SELECT starts_on,ends_on INTO term_start,term_end FROM academic_terms WHERE id=NEW.term_id;
  NEW.enrolled_on=COALESCE(NEW.enrolled_on,term_start);
  IF NEW.enrolled_on NOT BETWEEN term_start AND term_end THEN
    RAISE EXCEPTION 'Enrollment start must be within its term' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_start_before_write BEFORE INSERT OR UPDATE OF enrolled_on,term_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION ensure_enrollment_start();

CREATE TABLE people_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  created_by uuid NOT NULL REFERENCES users(id),
  input jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  committed_student_id uuid REFERENCES students(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CHECK ((committed_student_id IS NULL)=(committed_at IS NULL))
);
CREATE INDEX people_intakes_actor_idx ON people_intakes(created_by,created_at DESC);
CREATE INDEX people_intakes_school_idx ON people_intakes(school_id,created_at DESC);
CREATE INDEX people_intakes_student_idx ON people_intakes(committed_student_id);
ALTER TABLE school_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_school_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_people,guardian_school_profiles,people_intakes FROM PUBLIC;
