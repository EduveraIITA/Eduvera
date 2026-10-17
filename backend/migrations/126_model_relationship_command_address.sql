-- Extend ModelAddress isolation through relationship and command traces. These
-- are environment state, not realm-shared configuration. Existing records are
-- Live; future writes must name the server-selected namespace explicitly.

ALTER TABLE campus_model_relationships
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;

UPDATE campus_model_relationships relationship SET
  realm_id=entity.realm_id,
  environment_namespace_id=entity.environment_namespace_id
FROM campus_model_entities entity WHERE entity.id=relationship.source_entity_id;

ALTER TABLE campus_model_relationships
  ALTER COLUMN realm_id SET NOT NULL,
  ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_relationships_namespace_realm_fk
    FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_relationships_source_address_fk
    FOREIGN KEY(source_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  ADD CONSTRAINT campus_model_relationships_target_address_fk
    FOREIGN KEY(target_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE CASCADE;

DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT constraint_record.conname INTO legacy_constraint
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid='campus_model_relationships'::regclass
    AND constraint_record.contype='u'
    AND pg_get_constraintdef(constraint_record.oid)=
      'UNIQUE (school_id, relation_type, source_entity_id, target_entity_id, effective_from)';
  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE campus_model_relationships DROP CONSTRAINT %I',legacy_constraint);
  END IF;
END $$;
ALTER TABLE campus_model_relationships
  ADD CONSTRAINT campus_model_relationships_address_source_unique
    UNIQUE(realm_id,environment_namespace_id,relation_type,source_entity_id,target_entity_id,effective_from),
  ADD CONSTRAINT campus_model_relationships_address_unique
    UNIQUE(id,realm_id,environment_namespace_id);
CREATE INDEX campus_model_relationships_address_current_idx
  ON campus_model_relationships(realm_id,environment_namespace_id,source_entity_id,relation_type,effective_from DESC)
  WHERE effective_until IS NULL;

ALTER TABLE campus_model_commands
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;

UPDATE campus_model_commands command SET
  realm_id=entity.realm_id,
  environment_namespace_id=entity.environment_namespace_id
FROM campus_model_entities entity WHERE entity.id=command.target_entity_id;

UPDATE campus_model_commands command SET
  realm_id=realm.id,
  environment_namespace_id='live:'||command.school_id::text
FROM operational_realms realm
WHERE command.realm_id IS NULL AND realm.legacy_school_id=command.school_id;

ALTER TABLE campus_model_commands
  ALTER COLUMN realm_id SET NOT NULL,
  ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_commands_namespace_realm_fk
    FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_commands_target_address_fk
    FOREIGN KEY(target_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_commands_address_unique
    UNIQUE(id,realm_id,environment_namespace_id);

DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT constraint_record.conname INTO legacy_constraint
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid='campus_model_commands'::regclass
    AND constraint_record.contype='u'
    AND pg_get_constraintdef(constraint_record.oid)='UNIQUE (school_id, idempotency_key)';
  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE campus_model_commands DROP CONSTRAINT %I',legacy_constraint);
  END IF;
END $$;
ALTER TABLE campus_model_commands
  ADD CONSTRAINT campus_model_commands_address_idempotency_unique
    UNIQUE(realm_id,environment_namespace_id,idempotency_key);
CREATE INDEX campus_model_commands_address_target_time_idx
  ON campus_model_commands(realm_id,environment_namespace_id,target_entity_id,requested_at DESC);

ALTER TABLE campus_model_command_outcomes
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;

UPDATE campus_model_command_outcomes outcome SET
  realm_id=command.realm_id,
  environment_namespace_id=command.environment_namespace_id
FROM campus_model_commands command WHERE command.id=outcome.command_id;

ALTER TABLE campus_model_command_outcomes
  ALTER COLUMN realm_id SET NOT NULL,
  ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_command_outcomes_namespace_realm_fk
    FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_command_outcomes_command_address_fk
    FOREIGN KEY(command_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_commands(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  ADD CONSTRAINT campus_model_command_outcomes_result_address_fk
    FOREIGN KEY(resulting_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;
