import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const pool = new Pool({
  connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
  max: 1,
});

afterAll(async () => {
  await pool.end();
});

describe("seeded Campus Model Core integrity", () => {
  it("gives the Cambridge realm one Live address and one structural institution identity", async () => {
    const rows = (await pool.query<{
      school_id: string; realm_id: string; namespace_id: string; institution_count: number;
    }>(`SELECT school.id school_id,realm.id realm_id,namespace.namespace_id,
          count(entity.id)::int institution_count
        FROM schools school
        JOIN operational_realms realm ON realm.legacy_school_id=school.id
        JOIN execution_environment_namespaces namespace
          ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
          AND namespace.status='active'
        LEFT JOIN campus_model_entities entity
          ON entity.realm_id=realm.id AND entity.environment_namespace_id=namespace.namespace_id
          AND entity.domain='institutions' AND entity.domain_id=school.id::text
        WHERE school.code='cis'
        GROUP BY school.id,realm.id,namespace.namespace_id`)).rows;
    expect(rows).toEqual([expect.objectContaining({
      namespace_id: `live:${rows[0]!.school_id}`,
      institution_count: 1,
    })]);
  });

  it("pins every currently active reviewed model contract exactly once", async () => {
    const missing = (await pool.query(`WITH realm AS (
          SELECT operational.id FROM operational_realms operational
          JOIN schools school ON school.id=operational.legacy_school_id WHERE school.code='cis'
        ), expected AS (
          SELECT 'semantic_type'::text kind,namespace||'/'||type_key key,id,version
          FROM model_semantic_type_definitions WHERE status='active'
          UNION ALL
          SELECT 'protocol_schema',namespace||'/'||schema_key,id,version
          FROM model_protocol_schema_definitions WHERE status='active'
          UNION ALL
          SELECT 'capability_manifest',namespace||'/'||capability_key,id,version
          FROM model_capability_manifests WHERE status='active'
        ) SELECT expected.* FROM realm CROSS JOIN expected
        LEFT JOIN realm_model_contract_activations activation
          ON activation.realm_id=realm.id AND activation.contract_kind=expected.kind
          AND activation.contract_key=expected.key AND activation.contract_id=expected.id
          AND activation.contract_version=expected.version AND activation.status='active'
          AND activation.effective_from<=now()
          AND (activation.effective_until IS NULL OR activation.effective_until>now())
        WHERE activation.id IS NULL`)).rows;
    expect(missing).toHaveLength(0);
  });

  it("maps each active Cambridge account to one current retained human-agent endpoint", async () => {
    const unresolved = (await pool.query(`SELECT membership.user_id,count(endpoint.id)::int endpoint_count
        FROM school_memberships membership
        JOIN schools school ON school.id=membership.school_id AND school.code='cis'
        JOIN users account ON account.id=membership.user_id AND account.is_active
        LEFT JOIN campus_model_agent_endpoints endpoint
          ON endpoint.school_id=membership.school_id AND endpoint.user_id=membership.user_id
          AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
          AND endpoint.status='active' AND endpoint.effective_until IS NULL
        WHERE membership.is_active
        GROUP BY membership.user_id HAVING count(endpoint.id)<>1`)).rows;
    expect(unresolved).toHaveLength(0);
  });

  it("has no cross-address entity, relationship, observation or execution-trace rows", async () => {
    const invalid = (await pool.query<{ kind: string; count: number }>(`WITH failures AS (
        SELECT 'entity'::text kind,entity.id FROM campus_model_entities entity
          LEFT JOIN operational_realms realm ON realm.id=entity.realm_id
          LEFT JOIN execution_environment_namespaces namespace
            ON namespace.realm_id=entity.realm_id
            AND namespace.namespace_id=entity.environment_namespace_id
          WHERE realm.legacy_school_id<>entity.school_id OR namespace.namespace_id IS NULL
        UNION ALL
        SELECT 'relationship',relationship.id FROM campus_model_relationships relationship
          JOIN campus_model_entities source ON source.id=relationship.source_entity_id
          JOIN campus_model_entities target ON target.id=relationship.target_entity_id
          WHERE (source.realm_id,source.environment_namespace_id)
            IS DISTINCT FROM (relationship.realm_id,relationship.environment_namespace_id)
             OR (target.realm_id,target.environment_namespace_id)
            IS DISTINCT FROM (relationship.realm_id,relationship.environment_namespace_id)
        UNION ALL
        SELECT 'observation',observation.id FROM campus_model_observations observation
          JOIN campus_model_entities subject ON subject.id=observation.subject_entity_id
          WHERE (subject.realm_id,subject.environment_namespace_id)
            IS DISTINCT FROM (observation.realm_id,observation.environment_namespace_id)
        UNION ALL
        SELECT 'event',event.id FROM campus_model_events event
          JOIN campus_model_entities subject ON subject.id=event.subject_entity_id
          WHERE (subject.realm_id,subject.environment_namespace_id)
            IS DISTINCT FROM (event.realm_id,event.environment_namespace_id)
      ) SELECT kind,count(*)::int count FROM failures GROUP BY kind`)).rows;
    expect(invalid).toHaveLength(0);
  });

  it("never retains a partially certified attendance observation", async () => {
    const partial = (await pool.query(`SELECT observation.id
        FROM campus_model_observations observation
        JOIN schools school ON school.id=observation.school_id AND school.code='cis'
        WHERE observation.kind='attendance.status_observed'
          AND num_nonnulls(
            observation.protocol_schema_definition_id,
            observation.protocol_schema_version,
            observation.capability_manifest_id,
            observation.capability_manifest_version
          ) NOT IN (0,4)`)).rows;
    expect(partial).toHaveLength(0);
  });
});
