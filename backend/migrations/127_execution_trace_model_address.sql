-- Qualify the event -> reaction -> message execution trace and the temporal
-- projection by ModelAddress. Realm-shared agent/configuration definitions are
-- intentionally not duplicated here; mutable execution records are.

ALTER TABLE campus_model_events
  ADD COLUMN realm_id uuid REFERENCES operational_realms(id) ON DELETE RESTRICT,
  ADD COLUMN environment_namespace_id text;
UPDATE campus_model_events event SET
  realm_id=entity.realm_id,environment_namespace_id=entity.environment_namespace_id
FROM campus_model_entities entity WHERE entity.id=event.subject_entity_id;
ALTER TABLE campus_model_events
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_events_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_events_subject_address_fk FOREIGN KEY(subject_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_events_context_address_fk FOREIGN KEY(context_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_events_address_unique UNIQUE(id,realm_id,environment_namespace_id);
DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT constraint_record.conname INTO legacy_constraint
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid='campus_model_events'::regclass
    AND constraint_record.contype='u'
    AND pg_get_constraintdef(constraint_record.oid)='UNIQUE (school_id, idempotency_key)';
  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE campus_model_events DROP CONSTRAINT %I',legacy_constraint);
  END IF;
END $$;
ALTER TABLE campus_model_events ADD CONSTRAINT campus_model_events_address_idempotency_unique
  UNIQUE(realm_id,environment_namespace_id,idempotency_key);
ALTER TABLE campus_model_events
  ADD CONSTRAINT campus_model_events_causation_address_fk FOREIGN KEY(causation_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_events_supersedes_address_fk FOREIGN KEY(supersedes_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;

ALTER TABLE campus_model_schedule_occurrences ADD COLUMN realm_id uuid, ADD COLUMN environment_namespace_id text;
-- This is a one-time address backfill, not an operational occurrence revision.
-- Temporarily suspend the append-only runtime guard while the migration owns the
-- table lock, then restore it before any application write can proceed.
ALTER TABLE campus_model_schedule_occurrences DISABLE TRIGGER campus_model_occurrence_lineage_guard;
UPDATE campus_model_schedule_occurrences occurrence SET
  realm_id=event.realm_id,environment_namespace_id=event.environment_namespace_id
FROM campus_model_events event WHERE event.id=occurrence.source_event_id;
ALTER TABLE campus_model_schedule_occurrences ENABLE TRIGGER campus_model_occurrence_lineage_guard;
ALTER TABLE campus_model_schedule_occurrences
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_occurrences_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_source_event_address_fk FOREIGN KEY(source_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE CASCADE,
  ADD CONSTRAINT campus_model_occurrences_schedule_address_fk FOREIGN KEY(schedule_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_period_address_fk FOREIGN KEY(period_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_class_address_fk FOREIGN KEY(class_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_subject_address_fk FOREIGN KEY(subject_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_space_address_fk FOREIGN KEY(space_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrences_address_unique UNIQUE(id,realm_id,environment_namespace_id);

ALTER TABLE campus_model_reactions ADD COLUMN realm_id uuid, ADD COLUMN environment_namespace_id text;
UPDATE campus_model_reactions reaction SET realm_id=event.realm_id,environment_namespace_id=event.environment_namespace_id
FROM campus_model_events event WHERE event.id=reaction.trigger_event_id;
ALTER TABLE campus_model_reactions
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_reactions_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_reactions_trigger_address_fk FOREIGN KEY(trigger_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_reactions_causation_address_fk FOREIGN KEY(causation_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_reactions_address_unique UNIQUE(id,realm_id,environment_namespace_id);
DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT constraint_record.conname INTO legacy_constraint
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid='campus_model_reactions'::regclass
    AND constraint_record.contype='u'
    AND pg_get_constraintdef(constraint_record.oid)='UNIQUE (school_id, idempotency_key)';
  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE campus_model_reactions DROP CONSTRAINT %I',legacy_constraint);
  END IF;
END $$;
ALTER TABLE campus_model_reactions ADD CONSTRAINT campus_model_reactions_address_idempotency_unique
  UNIQUE(realm_id,environment_namespace_id,idempotency_key);

ALTER TABLE campus_model_coordination_exceptions ADD COLUMN realm_id uuid, ADD COLUMN environment_namespace_id text;
UPDATE campus_model_coordination_exceptions exception SET realm_id=event.realm_id,environment_namespace_id=event.environment_namespace_id
FROM campus_model_events event WHERE event.id=exception.trigger_event_id;
ALTER TABLE campus_model_coordination_exceptions
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_exceptions_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_exceptions_trigger_address_fk FOREIGN KEY(trigger_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_exceptions_address_unique UNIQUE(id,realm_id,environment_namespace_id);

ALTER TABLE campus_model_operational_messages ADD COLUMN realm_id uuid, ADD COLUMN environment_namespace_id text;
UPDATE campus_model_operational_messages message SET realm_id=reaction.realm_id,environment_namespace_id=reaction.environment_namespace_id
FROM campus_model_reactions reaction WHERE reaction.id=message.reaction_id;
ALTER TABLE campus_model_operational_messages
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_messages_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_messages_reaction_address_fk FOREIGN KEY(reaction_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_reactions(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_messages_causation_address_fk FOREIGN KEY(causation_event_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_events(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_messages_address_unique UNIQUE(id,realm_id,environment_namespace_id);

ALTER TABLE campus_model_operational_message_outcomes ADD COLUMN realm_id uuid, ADD COLUMN environment_namespace_id text;
UPDATE campus_model_operational_message_outcomes outcome SET realm_id=message.realm_id,environment_namespace_id=message.environment_namespace_id
FROM campus_model_operational_messages message WHERE message.id=outcome.message_id;
ALTER TABLE campus_model_operational_message_outcomes
  ALTER COLUMN realm_id SET NOT NULL, ALTER COLUMN environment_namespace_id SET NOT NULL,
  ADD CONSTRAINT campus_model_message_outcomes_namespace_realm_fk FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_message_outcomes_message_address_fk FOREIGN KEY(message_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_operational_messages(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;
DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT constraint_record.conname INTO legacy_constraint
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid='campus_model_operational_message_outcomes'::regclass
    AND constraint_record.contype='u'
    AND pg_get_constraintdef(constraint_record.oid)='UNIQUE (school_id, idempotency_key)';
  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE campus_model_operational_message_outcomes DROP CONSTRAINT %I',
      legacy_constraint
    );
  END IF;
END $$;
ALTER TABLE campus_model_operational_message_outcomes ADD CONSTRAINT campus_model_message_outcomes_address_idempotency_unique
  UNIQUE(realm_id,environment_namespace_id,idempotency_key);

-- Existing writers cannot choose an environment. Each execution record inherits
-- it from its already-addressed parent; mismatches and address changes fail.
CREATE OR REPLACE FUNCTION inherit_campus_model_execution_address() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_realm uuid; parent_namespace text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.realm_id IS DISTINCT FROM OLD.realm_id OR NEW.environment_namespace_id IS DISTINCT FROM OLD.environment_namespace_id THEN
      RAISE EXCEPTION 'Execution ModelAddress is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='campus_model_events' THEN
    SELECT realm_id,environment_namespace_id INTO parent_realm,parent_namespace
    FROM campus_model_entities WHERE id=NEW.subject_entity_id;
  ELSIF TG_TABLE_NAME='campus_model_schedule_occurrences' THEN
    SELECT realm_id,environment_namespace_id INTO parent_realm,parent_namespace
    FROM campus_model_events WHERE id=NEW.source_event_id;
  ELSIF TG_TABLE_NAME IN ('campus_model_reactions','campus_model_coordination_exceptions') THEN
    SELECT realm_id,environment_namespace_id INTO parent_realm,parent_namespace
    FROM campus_model_events WHERE id=NEW.trigger_event_id;
  ELSIF TG_TABLE_NAME='campus_model_operational_messages' THEN
    SELECT realm_id,environment_namespace_id INTO parent_realm,parent_namespace
    FROM campus_model_reactions WHERE id=NEW.reaction_id;
  ELSIF TG_TABLE_NAME='campus_model_operational_message_outcomes' THEN
    SELECT realm_id,environment_namespace_id INTO parent_realm,parent_namespace
    FROM campus_model_operational_messages WHERE id=NEW.message_id;
  END IF;
  IF parent_realm IS NULL OR parent_namespace IS NULL THEN RAISE EXCEPTION 'Execution parent has no ModelAddress'; END IF;
  IF NEW.realm_id IS NOT NULL AND (NEW.realm_id<>parent_realm OR NEW.environment_namespace_id<>parent_namespace) THEN
    RAISE EXCEPTION 'Execution record cannot cross a ModelAddress boundary';
  END IF;
  NEW.realm_id:=parent_realm; NEW.environment_namespace_id:=parent_namespace;
  RETURN NEW;
END $$;

CREATE TRIGGER campus_model_events_address_guard BEFORE INSERT OR UPDATE ON campus_model_events
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
CREATE TRIGGER campus_model_occurrences_address_guard BEFORE INSERT OR UPDATE ON campus_model_schedule_occurrences
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
CREATE TRIGGER campus_model_reactions_address_guard BEFORE INSERT OR UPDATE ON campus_model_reactions
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
CREATE TRIGGER campus_model_exceptions_address_guard BEFORE INSERT OR UPDATE ON campus_model_coordination_exceptions
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
CREATE TRIGGER campus_model_messages_address_guard BEFORE INSERT OR UPDATE ON campus_model_operational_messages
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
CREATE TRIGGER campus_model_message_outcomes_address_guard BEFORE INSERT OR UPDATE ON campus_model_operational_message_outcomes
  FOR EACH ROW EXECUTE FUNCTION inherit_campus_model_execution_address();
