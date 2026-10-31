-- A versioned neutral temporal projection in the existing Model Core spine.
-- Academic compatibility columns remain, but are not universal requirements.
ALTER TABLE campus_model_schedule_occurrences
  ALTER COLUMN class_entity_id DROP NOT NULL,
  ALTER COLUMN period_number DROP NOT NULL,
  ADD COLUMN context_entity_id uuid,
  ADD COLUMN time_zone varchar(80),
  ADD COLUMN projection_hash char(64),
  ADD CONSTRAINT campus_model_occurrence_context_address_fk
    FOREIGN KEY(context_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT;

CREATE TABLE campus_model_occurrence_participants (
  school_id uuid NOT NULL REFERENCES schools(id),
  realm_id uuid NOT NULL,
  environment_namespace_id varchar(200) NOT NULL,
  occurrence_id uuid NOT NULL,
  participant_entity_id uuid NOT NULL,
  role varchar(40) NOT NULL CHECK(role ~ '^[a-z][a-z0-9_]{1,39}$'),
  required boolean NOT NULL,
  source_ref varchar(240) NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  PRIMARY KEY(realm_id,environment_namespace_id,occurrence_id,participant_entity_id,role),
  FOREIGN KEY(occurrence_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_schedule_occurrences(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(participant_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(occurrence_id,school_id) REFERENCES campus_model_schedule_occurrences(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(participant_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_occurrence_participant_lookup
  ON campus_model_occurrence_participants(realm_id,environment_namespace_id,participant_entity_id,occurrence_id);

CREATE TABLE campus_model_occurrence_resources (
  school_id uuid NOT NULL REFERENCES schools(id),
  realm_id uuid NOT NULL,
  environment_namespace_id varchar(200) NOT NULL,
  occurrence_id uuid NOT NULL,
  resource_entity_id uuid NOT NULL,
  PRIMARY KEY(realm_id,environment_namespace_id,occurrence_id,resource_entity_id),
  FOREIGN KEY(occurrence_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_schedule_occurrences(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(resource_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT,
  FOREIGN KEY(occurrence_id,school_id) REFERENCES campus_model_schedule_occurrences(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(resource_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT
);

CREATE FUNCTION protect_neutral_occurrence_references() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Occurrence reference history is immutable; append a new occurrence revision' USING ERRCODE='23514';
END $$;

-- Reviewed participant-neutral evidence contracts. Legacy student evidence keeps
-- its original certified schema; it is never relabelled as new observations.
INSERT INTO model_semantic_type_definitions(namespace,type_key,definition_kind,version,owning_domain,status,definition,content_hash,approved_by_authority,activated_at)
SELECT namespace,type_key,'entity',1,owning_domain,'active',definition,
  encode(digest(namespace||'/'||type_key||'/entity/v1','sha256'),'hex'),'platform-architecture',now()
FROM (VALUES
 ('thatcampus.people','person','people','{"privacy_class":"personal","allowed_scopes":["realm"]}'::jsonb),
 ('thatcampus.attendance','attendance_register','attendance','{"privacy_class":"operational","allowed_scopes":["realm"]}'::jsonb)
) definitions(namespace,type_key,owning_domain,definition)
ON CONFLICT(namespace,type_key,definition_kind,version) DO NOTHING;
INSERT INTO model_protocol_schema_definitions(namespace,schema_key,protocol_kind,version,owning_domain,status,schema_document,content_hash,approved_by_authority,activated_at)
VALUES('thatcampus.attendance','attendance.participation_observed','observation',1,'attendance','active',
  '{"subject_type":"thatcampus.people/person@1","context_type":"thatcampus.attendance/attendance_register@1","privacy_class":"personal","claim":"reported_participation_not_continuous_presence"}'::jsonb,
  encode(digest('thatcampus.attendance/attendance.participation_observed/observation/v1','sha256'),'hex'),'platform-architecture',now())
ON CONFLICT(namespace,schema_key,protocol_kind,version) DO NOTHING;
INSERT INTO model_capability_manifests(namespace,capability_key,version,status,adapter_key,compatible_core_range,manifest,content_hash,approved_by_authority,activated_at)
VALUES('thatcampus.attendance','participation_attendance',1,'active','attendance.participation_adapter','>=1 <2',
  '{"semantic_types":["thatcampus.people/person@1","thatcampus.attendance/attendance_register@1"],"protocol_schemas":["thatcampus.attendance/attendance.participation_observed@1"]}'::jsonb,
  encode(digest('thatcampus.attendance/participation_attendance/capability/v1','sha256'),'hex'),'platform-architecture',now())
ON CONFLICT(namespace,capability_key,version) DO NOTHING;
INSERT INTO realm_model_contract_activations(realm_id,contract_kind,contract_key,contract_id,contract_version,status,activated_by_authority)
SELECT realm.id,definition.kind,definition.contract_key,definition.id,1,'active','platform-migration-156'
FROM operational_realms realm CROSS JOIN (
  SELECT 'semantic_type' AS kind,namespace||'/'||type_key AS contract_key,id FROM model_semantic_type_definitions
    WHERE version=1 AND (namespace,type_key) IN (('thatcampus.people','person'),('thatcampus.attendance','attendance_register'))
  UNION ALL SELECT 'protocol_schema',namespace||'/'||schema_key,id FROM model_protocol_schema_definitions
    WHERE namespace='thatcampus.attendance' AND schema_key='attendance.participation_observed' AND version=1
  UNION ALL SELECT 'capability_manifest',namespace||'/'||capability_key,id FROM model_capability_manifests
    WHERE namespace='thatcampus.attendance' AND capability_key='participation_attendance' AND version=1
) definition WHERE realm.status IN ('setup','active') ON CONFLICT DO NOTHING;
CREATE TRIGGER neutral_occurrence_participants_immutable
  BEFORE UPDATE OR DELETE ON campus_model_occurrence_participants FOR EACH ROW EXECUTE FUNCTION protect_neutral_occurrence_references();
CREATE TRIGGER neutral_occurrence_resources_immutable
  BEFORE UPDATE OR DELETE ON campus_model_occurrence_resources FOR EACH ROW EXECUTE FUNCTION protect_neutral_occurrence_references();
ALTER TABLE campus_model_occurrence_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_occurrence_resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campus_model_occurrence_participants,campus_model_occurrence_resources FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_neutral_occurrence_references() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON campus_model_occurrence_participants,campus_model_occurrence_resources FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
