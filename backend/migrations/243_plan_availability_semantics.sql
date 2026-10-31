-- Availability is published information, not an exclusive space/person claim.
-- Existing accepted plans keep their original exclusive interpretation.
ALTER TABLE campus_model_schedule_occurrences
  ADD COLUMN claim_kind varchar(16) NOT NULL DEFAULT 'exclusive'
    CHECK (claim_kind IN ('exclusive','availability')),
  ADD CONSTRAINT availability_has_no_assigned_attendance_claim
    CHECK (claim_kind <> 'availability' OR
      (class_entity_id IS NULL AND subject_entity_id IS NULL AND responsible_agent_id IS NULL));

CREATE FUNCTION guard_availability_participants() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campus_model_schedule_occurrences occurrence
    WHERE occurrence.id=NEW.occurrence_id AND occurrence.school_id=NEW.school_id
      AND occurrence.realm_id=NEW.realm_id
      AND occurrence.environment_namespace_id=NEW.environment_namespace_id
      AND occurrence.claim_kind='availability'
  ) THEN
    RAISE EXCEPTION 'Availability cannot assign people or attendance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER availability_participants_guard BEFORE INSERT ON campus_model_occurrence_participants
  FOR EACH ROW EXECUTE FUNCTION guard_availability_participants();
REVOKE ALL ON FUNCTION guard_availability_participants() FROM PUBLIC;
