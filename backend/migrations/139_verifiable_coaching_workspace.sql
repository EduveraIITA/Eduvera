-- Organisation verification is optional and happens after a neutral private
-- workspace exists.  A coaching operator must be able to state its real type
-- during that later trust review without creating a separate onboarding lane.
ALTER TABLE institution_onboarding_applications
  DROP CONSTRAINT IF EXISTS institution_onboarding_applications_institution_kind_check;
ALTER TABLE institution_onboarding_applications
  ADD CONSTRAINT institution_onboarding_applications_institution_kind_check
  CHECK (institution_kind IN ('school','college','coaching','hybrid'));
