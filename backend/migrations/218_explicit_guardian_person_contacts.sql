-- A global guardian/account wrapper does not own campus contact details. Preserve
-- its retired intake copy as migration-time evidence without inventing history.
INSERT INTO audit_events(action,school_id,target_type,target_id,request_id,metadata)
SELECT 'database.guardian_contact_copy_retired',profile.school_id,'guardian',guardian.id,gen_random_uuid(),
  jsonb_build_object('migration',218,'person_id',profile.person_id,'retired_intake_phone',guardian.phone,
    'current_owner','school_people','knowledge_boundary','recorded_at_migration_not_original_effective_time')
FROM parents guardian LEFT JOIN guardian_school_profiles profile ON profile.guardian_id=guardian.id;

-- The old trigger constructed campus identities from account names/global phone.
-- A current writer must create or explicitly select the canonical profile first.
DROP TRIGGER guardian_person_before_write ON guardian_relationships;
DROP FUNCTION ensure_guardian_school_person();
CREATE FUNCTION validate_explicit_guardian_school_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE institution uuid;
BEGIN
  SELECT school_id INTO institution FROM students WHERE id=NEW.student_id FOR KEY SHARE;
  IF institution IS NULL THEN RAISE EXCEPTION 'Guardian relationship needs an existing learner' USING ERRCODE='23514'; END IF;
  IF NEW.school_id IS NOT NULL AND NEW.school_id<>institution THEN
    RAISE EXCEPTION 'Guardian relationship school mismatch' USING ERRCODE='23514';
  END IF;
  NEW.school_id:=institution;
  PERFORM id FROM parents WHERE id=NEW.guardian_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guardian record does not exist' USING ERRCODE='23514'; END IF;
  PERFORM profile.person_id FROM guardian_school_profiles profile JOIN school_people person
    ON person.school_id=profile.school_id AND person.id=profile.person_id
    WHERE profile.school_id=institution AND profile.guardian_id=NEW.guardian_id FOR SHARE OF profile,person;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an explicit canonical guardian profile from this institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guardian_person_before_write BEFORE INSERT OR UPDATE ON guardian_relationships
  FOR EACH ROW EXECUTE FUNCTION validate_explicit_guardian_school_profile();
REVOKE ALL ON FUNCTION validate_explicit_guardian_school_profile() FROM PUBLIC;
ALTER TABLE parents DROP COLUMN phone;
COMMENT ON TABLE parents IS 'Guardian relationship/account wrapper. Canonical campus identity and current contact details are owned by guardian_school_profiles -> school_people.';
