-- Purpose-first workspaces have not claimed an institution category yet, so the
-- compatibility governance profile must not infer school levels or capability packs.
ALTER TABLE institution_regulatory_profiles
  DROP CONSTRAINT IF EXISTS institution_regulatory_profiles_education_levels_check;
ALTER TABLE institution_regulatory_profiles
  DROP CONSTRAINT IF EXISTS institution_regulatory_profiles_capability_packs_check;

-- Normalize workspaces created while migration 136 was already present before
-- installing the stricter conditional constraints.
UPDATE institution_regulatory_profiles
SET education_levels=ARRAY[]::text[],capability_packs=ARRAY[]::text[],updated_at=now()
WHERE institution_kind='unspecified';

ALTER TABLE institution_regulatory_profiles
  ADD CONSTRAINT institution_regulatory_profiles_education_levels_check
  CHECK (
    (institution_kind='unspecified' AND cardinality(education_levels)=0)
    OR (institution_kind<>'unspecified' AND cardinality(education_levels)>0)
  );

ALTER TABLE institution_regulatory_profiles
  ADD CONSTRAINT institution_regulatory_profiles_capability_packs_check
  CHECK (
    (institution_kind='unspecified' AND cardinality(capability_packs)=0)
    OR (institution_kind<>'unspecified' AND cardinality(capability_packs)>0)
  );

UPDATE progressive_onboarding_goal_catalog SET
  description=CASE goal_key
    WHEN 'attendance' THEN 'Know who''s here, without the paperwork.'
    WHEN 'gate' THEN 'Record visitors, arrivals and departures.'
    WHEN 'timetable' THEN 'Plan classes and recurring sessions.'
    WHEN 'examinations' THEN 'Plan assessments and coordinate exam day.'
    WHEN 'performance' THEN 'Follow learner results and progress.'
    WHEN 'staff' THEN 'Organise people and their responsibilities.'
    WHEN 'messages' THEN 'Keep staff and families in the loop.'
    ELSE description
  END,
  destination=CASE goal_key
    WHEN 'attendance' THEN '/principal/get-started?task=attendance'
    WHEN 'gate' THEN '/principal/get-started?task=gate'
    WHEN 'timetable' THEN '/principal/get-started?task=timetable'
    WHEN 'examinations' THEN '/principal/get-started?task=examinations'
    WHEN 'staff' THEN '/principal/get-started?task=staff'
    WHEN 'messages' THEN '/principal/get-started?task=messages'
    ELSE destination
  END;
