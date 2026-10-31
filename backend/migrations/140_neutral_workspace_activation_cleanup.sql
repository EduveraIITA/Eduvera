-- Migration 040 installed a universal activation trigger whose fallback maps any
-- unrecognised kind to the Indian-school pack.  Progressive private workspaces
-- intentionally have no universal activation gate or inferred institution type.
CREATE OR REPLACE FUNCTION seed_institution_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.institution_kind='unspecified' OR NEW.onboarding_model='progressive_private' THEN
    RETURN NEW;
  END IF;
  INSERT INTO institution_activation_states(school_id,capability_pack)
  VALUES(NEW.id,institution_pack_for_kind(NEW.institution_kind))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DELETE FROM institution_activation_states activation
USING schools institution
WHERE activation.school_id=institution.id
  AND (institution.institution_kind='unspecified' OR institution.onboarding_model='progressive_private');
