-- Referential lookup and concurrency indexes for self-service onboarding.
CREATE UNIQUE INDEX schools_one_self_service_coaching_per_creator_idx
  ON schools(created_by_user_id)
  WHERE onboarding_model='self_service_coaching' AND created_by_user_id IS NOT NULL;

CREATE INDEX schools_creator_idx ON schools(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE UNIQUE INDEX institution_onboarding_provisioned_school_idx
  ON institution_onboarding_applications(provisioned_school_id)
  WHERE provisioned_school_id IS NOT NULL;
CREATE INDEX institution_onboarding_reviewer_idx
  ON institution_onboarding_applications(reviewed_by)
  WHERE reviewed_by IS NOT NULL;
CREATE INDEX institution_onboarding_audit_actor_idx
  ON institution_onboarding_audits(actor_id,created_at DESC);

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('ALTER INDEX schools_one_self_service_coaching_per_creator_idx OWNER TO %I',owner_name);
  EXECUTE format('ALTER INDEX schools_creator_idx OWNER TO %I',owner_name);
  EXECUTE format('ALTER INDEX institution_onboarding_provisioned_school_idx OWNER TO %I',owner_name);
  EXECUTE format('ALTER INDEX institution_onboarding_reviewer_idx OWNER TO %I',owner_name);
  EXECUTE format('ALTER INDEX institution_onboarding_audit_actor_idx OWNER TO %I',owner_name);
END $$;
