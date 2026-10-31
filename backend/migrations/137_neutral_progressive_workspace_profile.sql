-- The legacy governance compatibility row is created by a school INSERT trigger.
-- A private progressive workspace must retain neutral institution semantics
-- instead of being silently classified as a school.

ALTER TABLE institution_regulatory_profiles
  DROP CONSTRAINT IF EXISTS institution_regulatory_profiles_institution_kind_check;
ALTER TABLE institution_regulatory_profiles
  ADD CONSTRAINT institution_regulatory_profiles_institution_kind_check
  CHECK (institution_kind IN ('unspecified','school','college','coaching','hybrid'));
