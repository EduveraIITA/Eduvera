import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const pool = new Pool({
  connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
  max: 1,
});

beforeAll(async () => {
  const installed = (await pool.query<{ trigger_exists: boolean }>(`SELECT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='schools'::regclass AND tgname='school_operational_realm_provision'
      AND NOT tgisinternal
  ) trigger_exists`)).rows[0]!.trigger_exists;
  expect(installed).toBe(true);
});

afterAll(async () => {
  await pool.end();
});

describe("operational realm provisioning invariant", () => {
  it("creates exactly one Live namespace atomically with every new institution", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const school = (await client.query<{ id: string }>(`INSERT INTO schools(
          name,code,timezone,institution_kind
        ) VALUES('Realm invariant test','realm-invariant-'||substr(gen_random_uuid()::text,1,8),
          'Asia/Kolkata','coaching') RETURNING id`)).rows[0]!;
      const address = (await client.query<{
        realm_id: string; legacy_school_id: string; namespace_id: string; environment_kind: string;
      }>(`SELECT realm.id realm_id,realm.legacy_school_id,namespace.namespace_id,namespace.environment_kind
        FROM operational_realms realm
        JOIN execution_environment_namespaces namespace ON namespace.realm_id=realm.id
        WHERE realm.legacy_school_id=$1`, [school.id])).rows;
      expect(address).toEqual([expect.objectContaining({
        legacy_school_id: school.id,
        namespace_id: `live:${school.id}`,
        environment_kind: "live",
      })]);
      const contractKinds = (await client.query<{ contract_kind: string }>(
        `SELECT DISTINCT contract_kind FROM realm_model_contract_activations
         WHERE realm_id=$1 AND status='active' ORDER BY contract_kind`,
        [address[0]!.realm_id],
      )).rows.map((row) => row.contract_kind);
      expect(contractKinds).toEqual(["capability_manifest", "protocol_schema", "semantic_type"]);
      expect((await client.query(
        `SELECT 1 FROM campus_model_entities
         WHERE realm_id=$1 AND environment_namespace_id=$2
           AND domain='institutions' AND domain_id=$3`,
        [address[0]!.realm_id, address[0]!.namespace_id, school.id],
      )).rowCount).toBe(1);
      await client.query("ROLLBACK");
      expect((await client.query("SELECT 1 FROM operational_realms WHERE legacy_school_id=$1", [school.id])).rowCount)
        .toBe(0);
    } finally {
      client.release();
    }
  });

  it("removes an empty institution with its owned realm and namespace", async () => {
    const school = (await pool.query<{ id: string }>(`INSERT INTO schools(
        name,code,timezone,institution_kind
      ) VALUES('Realm lifecycle test','realm-lifecycle-'||substr(gen_random_uuid()::text,1,8),
        'Asia/Kolkata','coaching') RETURNING id`)).rows[0]!;
    const realm = (await pool.query<{ id: string }>(
      "SELECT id FROM operational_realms WHERE legacy_school_id=$1",
      [school.id],
    )).rows[0]!;

    await pool.query("DELETE FROM schools WHERE id=$1", [school.id]);

    expect((await pool.query("SELECT 1 FROM operational_realms WHERE id=$1", [realm.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM execution_environment_namespaces WHERE realm_id=$1", [realm.id])).rowCount).toBe(0);
  });
});
