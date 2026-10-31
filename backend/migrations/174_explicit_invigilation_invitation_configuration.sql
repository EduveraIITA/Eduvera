-- No policy, authority, recipient or behavior is installed by this migration.
-- An active administrator explicitly approves and activates each exact version.
CREATE TABLE campus_model_coordination_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  environment_namespace_id text NOT NULL,
  configuration_key varchar(64) NOT NULL,
  source_domain varchar(64) NOT NULL,
  source_record_id varchar(160) NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  configuration_hash varchar(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  operating_rule_ref varchar(240) NOT NULL,
  approval_command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
  activation_command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
  approved_by_agent_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  enabled boolean NOT NULL,
  behaviour_version_id uuid,
  subscription_id uuid,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,source_domain,configuration_key,source_revision),
  FOREIGN KEY(approved_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(behaviour_version_id,school_id) REFERENCES campus_model_behaviour_versions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,school_id) REFERENCES campus_model_event_subscriptions(id,school_id) ON DELETE RESTRICT,
  CHECK(approval_command_id<>activation_command_id),
  CHECK((enabled AND behaviour_version_id IS NOT NULL AND subscription_id IS NOT NULL)
    OR (NOT enabled AND behaviour_version_id IS NULL AND subscription_id IS NULL))
);
CREATE TABLE assessment_invigilation_policy_versions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK(revision>0),
  enabled boolean NOT NULL,
  response_due_minutes integer NOT NULL CHECK(response_due_minutes BETWEEN 1 AND 10080),
  expires_after_minutes integer NOT NULL CHECK(expires_after_minutes BETWEEN 1 AND 43200),
  approved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL,
  approval_note varchar(1000) NOT NULL CHECK(length(btrim(approval_note))>=5),
  configuration_hash varchar(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  core_configuration_id uuid NOT NULL,
  UNIQUE(id,school_id),UNIQUE(school_id,revision),
  FOREIGN KEY(core_configuration_id,school_id) REFERENCES campus_model_coordination_configurations(id,school_id) ON DELETE RESTRICT,
  CHECK(expires_after_minutes>=response_due_minutes)
);
CREATE TABLE assessment_invigilation_policy_recipients (
  school_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  person_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY(policy_version_id,person_id),UNIQUE(policy_version_id,user_id),
  FOREIGN KEY(policy_version_id,school_id) REFERENCES assessment_invigilation_policy_versions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT
);
CREATE TABLE assessment_invigilation_policy_current (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  policy_version_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  FOREIGN KEY(policy_version_id,school_id) REFERENCES assessment_invigilation_policy_versions(id,school_id) ON DELETE RESTRICT
);
CREATE TABLE assessment_invigilation_policy_commands (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  policy_version_id uuid NOT NULL,
  result_body jsonb NOT NULL CHECK(jsonb_typeof(result_body)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,actor_id,idempotency_key),
  FOREIGN KEY(policy_version_id,school_id) REFERENCES assessment_invigilation_policy_versions(id,school_id) ON DELETE RESTRICT
);
CREATE FUNCTION validate_invigilation_policy_current() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM assessment_invigilation_policy_versions version
    WHERE version.id=NEW.policy_version_id AND version.school_id=NEW.school_id AND version.revision=NEW.revision) THEN
    RAISE EXCEPTION 'The current invitation policy must reference its exact institution revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invigilation_policy_current_scope BEFORE INSERT OR UPDATE ON assessment_invigilation_policy_current
  FOR EACH ROW EXECUTE FUNCTION validate_invigilation_policy_current();
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_invigilation_policy;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name IN ('assessment.invigilation_policy.approved','assessment.invigilation_policy.activated') THEN EXISTS(
    SELECT 1 FROM assessment_invigilation_policy_versions version
    JOIN school_memberships membership ON membership.school_id=version.school_id AND membership.user_id=candidate_user_id
      AND membership.role='admin' AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE version.school_id=event_school_id AND version.id::text=event_payload->>'policy_version_id'
      AND version.revision::text=event_payload->>'revision'
      AND campus_model_account_person_is_active(event_school_id,candidate_user_id,NULL,now())
  ) ELSE event_user_is_authorized_before_invigilation_policy(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
CREATE FUNCTION guard_approved_invigilation_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Approved configuration evidence is immutable; approve a new version' USING ERRCODE='23514'; END $$;
CREATE TRIGGER coordination_configuration_immutable BEFORE UPDATE OR DELETE ON campus_model_coordination_configurations
  FOR EACH ROW EXECUTE FUNCTION guard_approved_invigilation_configuration();
CREATE TRIGGER invigilation_policy_version_immutable BEFORE UPDATE OR DELETE ON assessment_invigilation_policy_versions
  FOR EACH ROW EXECUTE FUNCTION guard_approved_invigilation_configuration();
CREATE TRIGGER invigilation_policy_recipients_immutable BEFORE UPDATE OR DELETE ON assessment_invigilation_policy_recipients
  FOR EACH ROW EXECUTE FUNCTION guard_approved_invigilation_configuration();
CREATE TRIGGER invigilation_policy_command_immutable BEFORE UPDATE OR DELETE ON assessment_invigilation_policy_commands
  FOR EACH ROW EXECUTE FUNCTION guard_approved_invigilation_configuration();
CREATE INDEX invigilation_policy_recipients_school ON assessment_invigilation_policy_recipients(school_id,policy_version_id);
ALTER TABLE campus_model_coordination_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_invigilation_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_invigilation_policy_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_invigilation_policy_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_invigilation_policy_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campus_model_coordination_configurations,assessment_invigilation_policy_versions,assessment_invigilation_policy_recipients,
  assessment_invigilation_policy_current,assessment_invigilation_policy_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_approved_invigilation_configuration() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_invigilation_policy_current(),event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE app_owner text; restricted_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='assessment_operation_policies'::regclass;
  EXECUTE format('ALTER TABLE campus_model_coordination_configurations OWNER TO %I',app_owner);
  EXECUTE format('ALTER TABLE assessment_invigilation_policy_versions OWNER TO %I',app_owner);
  EXECUTE format('ALTER TABLE assessment_invigilation_policy_recipients OWNER TO %I',app_owner);
  EXECUTE format('ALTER TABLE assessment_invigilation_policy_current OWNER TO %I',app_owner);
  EXECUTE format('ALTER TABLE assessment_invigilation_policy_commands OWNER TO %I',app_owner);
  EXECUTE format('ALTER FUNCTION guard_approved_invigilation_configuration() OWNER TO %I',app_owner);
  EXECUTE format('ALTER FUNCTION validate_invigilation_policy_current() OWNER TO %I',app_owner);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',app_owner);
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON campus_model_coordination_configurations,assessment_invigilation_policy_versions,assessment_invigilation_policy_recipients,assessment_invigilation_policy_current,assessment_invigilation_policy_commands FROM %I',restricted_role);
      EXECUTE format('REVOKE ALL ON FUNCTION guard_approved_invigilation_configuration() FROM %I',restricted_role);
      EXECUTE format('REVOKE ALL ON FUNCTION validate_invigilation_policy_current(),event_user_is_authorized(uuid,text,jsonb,uuid) FROM %I',restricted_role);
    END IF;
  END LOOP;
END $$;
