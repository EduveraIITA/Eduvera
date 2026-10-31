-- Domain-neutral pre-execution command envelope. Owning domains retain business
-- invariants and records; the Core retains identity, authority and outcome lineage.

ALTER TABLE campus_model_commands
  ADD COLUMN request_hash char(64),
  ADD COLUMN handler_key varchar(120),
  ADD COLUMN handler_version integer,
  ADD COLUMN configuration_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN execution_started_at timestamptz,
  ADD COLUMN completed_at timestamptz;

UPDATE campus_model_commands SET
  request_hash=encode(digest(concat_ws('|',realm_id::text,environment_namespace_id,idempotency_key,command_type),'sha256'),'hex'),
  handler_key=concat('legacy.',source_domain),handler_version=1,
  execution_started_at=COALESCE(effective_at,requested_at),
  completed_at=CASE WHEN state<>'pending' THEN updated_at END
WHERE request_hash IS NULL;

ALTER TABLE campus_model_commands
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN handler_key SET NOT NULL,
  ALTER COLUMN handler_version SET NOT NULL,
  ADD CONSTRAINT campus_model_commands_request_hash_chk CHECK(request_hash~'^[0-9a-f]{64}$'),
  ADD CONSTRAINT campus_model_commands_handler_key_chk CHECK(handler_key~'^[a-z][a-z0-9_.-]{2,119}$'),
  ADD CONSTRAINT campus_model_commands_handler_version_chk CHECK(handler_version>0),
  ADD CONSTRAINT campus_model_commands_configuration_refs_chk CHECK(jsonb_typeof(configuration_refs)='array'),
  ADD CONSTRAINT campus_model_commands_completion_chk CHECK(
    (state='pending' AND completed_at IS NULL)
    OR (state<>'pending' AND completed_at IS NOT NULL)
  );

ALTER TABLE campus_model_commands DROP CONSTRAINT campus_model_commands_state_check;
ALTER TABLE campus_model_commands ADD CONSTRAINT campus_model_commands_state_check
  CHECK(state IN ('pending','review_required','accepted','rejected','conflicted','expired','failed','uncertain','cancelled'));

ALTER TABLE campus_model_command_outcomes DROP CONSTRAINT campus_model_command_outcomes_status_check;
ALTER TABLE campus_model_command_outcomes ADD CONSTRAINT campus_model_command_outcomes_status_check
  CHECK(status IN ('review_required','accepted','rejected','conflicted','expired','failed','uncertain','cancelled'));

CREATE OR REPLACE FUNCTION guard_domain_command_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id<>OLD.school_id OR NEW.realm_id<>OLD.realm_id
    OR NEW.environment_namespace_id<>OLD.environment_namespace_id
    OR NEW.command_type<>OLD.command_type OR NEW.target_entity_id IS DISTINCT FROM OLD.target_entity_id
    OR NEW.actor_agent_id<>OLD.actor_agent_id OR NEW.requested_at<>OLD.requested_at
    OR NEW.expected_revision IS DISTINCT FROM OLD.expected_revision
    OR NEW.authority_receipt_id IS DISTINCT FROM OLD.authority_receipt_id
    OR NEW.operating_rule_version_ref IS DISTINCT FROM OLD.operating_rule_version_ref
    OR NEW.correlation_id<>OLD.correlation_id OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
    OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.source_domain<>OLD.source_domain
    OR NEW.request_hash<>OLD.request_hash OR NEW.handler_key<>OLD.handler_key
    OR NEW.handler_version<>OLD.handler_version OR NEW.configuration_refs<>OLD.configuration_refs
    OR NEW.safe_context<>OLD.safe_context THEN
    RAISE EXCEPTION 'A retained domain command envelope is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER campus_model_commands_envelope_immutable
  BEFORE UPDATE ON campus_model_commands FOR EACH ROW
  EXECUTE FUNCTION guard_domain_command_envelope();
