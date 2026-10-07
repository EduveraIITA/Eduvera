-- Cross-record authority references that cannot be expressed as ordinary
-- composite foreign keys are checked at the database boundary. Application
-- validation remains useful for friendly errors, but is not the security wall.

CREATE OR REPLACE FUNCTION validate_governance_decision_rule_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.authority_source_ids) AS source_id
    LEFT JOIN institution_authority_sources source
      ON source.id=source_id AND source.school_id=NEW.school_id
    WHERE source.id IS NULL
  ) THEN
    RAISE EXCEPTION 'All authority sources must belong to the decision rule institution'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER institution_decision_rule_source_guard
AFTER INSERT OR UPDATE OF school_id,authority_source_ids
ON institution_decision_matter_rules
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION validate_governance_decision_rule_sources();

CREATE OR REPLACE FUNCTION validate_governance_appointment_linked_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  IF NEW.linked_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM school_memberships membership
    WHERE membership.school_id=NEW.school_id
      AND membership.user_id=NEW.linked_user_id
  ) THEN
    RAISE EXCEPTION 'The linked user must belong to the appointment institution'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER institution_governance_appointment_user_guard
AFTER INSERT OR UPDATE OF school_id,linked_user_id
ON institution_governance_appointments
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION validate_governance_appointment_linked_user();

REVOKE ALL ON FUNCTION validate_governance_decision_rule_sources() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_governance_appointment_linked_user() FROM PUBLIC;

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('ALTER FUNCTION validate_governance_decision_rule_sources() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_governance_appointment_linked_user() OWNER TO %I',owner_name);
END $$;
