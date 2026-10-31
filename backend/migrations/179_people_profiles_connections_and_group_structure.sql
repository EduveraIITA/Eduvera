-- Canonical contact corrections and descriptive connections. No app access,
-- guardian authority, enrollment or inherited membership is created here.
CREATE TABLE person_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id),
  source_person_id uuid NOT NULL, target_person_id uuid NOT NULL,
  connection_type varchar(32) NOT NULL CHECK(connection_type='mentor_of'),
  starts_on date NOT NULL, ends_on date, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by uuid NOT NULL REFERENCES users(id), recorded_at timestamptz NOT NULL,
  FOREIGN KEY(school_id,source_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,target_person_id) REFERENCES school_people(school_id,id),
  CHECK(source_person_id<>target_person_id), CHECK(ends_on IS NULL OR ends_on>=starts_on),
  UNIQUE(school_id,id)
);
CREATE INDEX person_connections_source_idx ON person_connections(school_id,source_person_id,starts_on,id);
CREATE INDEX person_connections_target_idx ON person_connections(school_id,target_person_id,starts_on,id);
CREATE TABLE participation_group_parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id),
  group_id uuid NOT NULL, parent_group_id uuid NOT NULL, starts_on date NOT NULL, ends_on date,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL REFERENCES users(id), recorded_at timestamptz NOT NULL,
  FOREIGN KEY(school_id,group_id) REFERENCES participation_groups(school_id,id),
  FOREIGN KEY(school_id,parent_group_id) REFERENCES participation_groups(school_id,id),
  CHECK(group_id<>parent_group_id), CHECK(ends_on IS NULL OR ends_on>=starts_on),
  UNIQUE(school_id,group_id,starts_on)
);
CREATE INDEX participation_group_parents_effective_idx ON participation_group_parents(school_id,group_id,starts_on,ends_on);
CREATE INDEX participation_group_parents_reverse_idx ON participation_group_parents(school_id,parent_group_id,starts_on,ends_on);
-- Immutable correction/move receipts preserve recorded-time and effective-time.
CREATE TABLE people_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL REFERENCES schools(id),person_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),previous_value jsonb NOT NULL,current_value jsonb NOT NULL,
  reason varchar(500) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL,
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id), UNIQUE(school_id,person_id,revision)
);
CREATE TABLE people_relationship_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL REFERENCES schools(id),
  source_kind varchar(32) NOT NULL CHECK(source_kind IN ('mentor','group_parent','group_members')),
  source_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),effective_on date NOT NULL,
  reason varchar(500) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL,
  details jsonb NOT NULL, UNIQUE(school_id,source_kind,source_id,revision)
);
CREATE INDEX people_relationship_history_source_idx ON people_relationship_history(school_id,source_kind,source_id,revision DESC);
CREATE FUNCTION people_retained_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'People correction history is immutable; record a new revision'; END $$;
CREATE TRIGGER people_profile_history_immutable BEFORE UPDATE OR DELETE ON people_profile_history
  FOR EACH ROW EXECUTE FUNCTION people_retained_history_immutable();
CREATE TRIGGER people_relationship_history_immutable BEFORE UPDATE OR DELETE ON people_relationship_history
  FOR EACH ROW EXECUTE FUNCTION people_retained_history_immutable();
CREATE TABLE campus_model_people_projection_receipts (
  command_id uuid PRIMARY KEY REFERENCES campus_model_commands(id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES schools(id),realm_id uuid NOT NULL REFERENCES operational_realms(id),
  environment_namespace_id text NOT NULL,payload_hash char(64) NOT NULL,relationship_ids uuid[] NOT NULL,
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY(environment_namespace_id,realm_id) REFERENCES execution_environment_namespaces(namespace_id,realm_id)
);
CREATE INDEX campus_model_people_projection_owner_idx ON campus_model_relationships(
  realm_id,environment_namespace_id,source_domain,source_record_id,relation_type
) WHERE source_domain='people';
INSERT INTO model_semantic_type_definitions(namespace,type_key,definition_kind,version,owning_domain,status,definition,
  content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.people.relationships',kind,'relationship',1,'people','active',definition,
  encode(digest(definition::text,'sha256'),'hex'),'platform-architecture-2026-10-20',now()
FROM (VALUES
  ('member_of','{"source_kind":"person","target_kind":"participation_group","cardinality":"many_to_many","inverse":"has_member","authority":false,"descendant_membership":false}'::jsonb),
  ('mentor_of','{"source_kind":"person","target_kind":"person","cardinality":"many_to_many","inverse":"mentored_by","authority":false}'::jsonb),
  ('part_of','{"source_kind":"participation_group","target_kind":"participation_group","cardinality":"one_effective_parent","inverse":"contains","cycle_free":true,"authority":false,"descendant_membership":false}'::jsonb)
) reviewed(kind,definition);
INSERT INTO realm_model_contract_activations(realm_id,contract_kind,contract_key,contract_id,contract_version,status,effective_from,activated_by_authority)
SELECT realm.id,'semantic_type',definition.namespace||'/'||definition.type_key,definition.id,definition.version,'active',
  '1970-01-01T00:00:00Z','platform-architecture-2026-10-20'
FROM operational_realms realm CROSS JOIN model_semantic_type_definitions definition
WHERE realm.status IN ('setup','active') AND definition.namespace='thatcampus.people.relationships' AND definition.version=1;
-- Direct clients do not own these writes. Normal selected-world server services do.
DO $$ DECLARE item text; role_name text; BEGIN
  FOREACH item IN ARRAY ARRAY['person_connections','participation_group_parents','people_profile_history','people_relationship_history','campus_model_people_projection_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,role_name); END IF;
    END LOOP;
  END LOOP;
END $$;
