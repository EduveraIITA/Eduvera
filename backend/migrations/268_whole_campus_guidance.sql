-- A resumable starting preference on the existing private workspace. It grants
-- no campus authority, creates no domain records and stores no checklist state.
-- Captured workspace rows retain this non-sensitive historical preference;
-- account preference writers are Live-only and never update it in Simulation.
ALTER TABLE progressive_onboarding_workspaces ADD COLUMN guidance text
  CHECK (guidance IS NULL OR guidance='whole_campus');

ALTER TABLE progressive_onboarding_audits DROP CONSTRAINT progressive_onboarding_audits_action_check;
ALTER TABLE progressive_onboarding_audits ADD CONSTRAINT progressive_onboarding_audits_action_check CHECK(action IN (
  'workspace_provisioned','goals_selected','resume_updated','profile_named','verification_submitted','guidance_selected'
));
