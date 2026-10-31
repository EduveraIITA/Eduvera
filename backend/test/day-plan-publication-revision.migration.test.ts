import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { buildSimulationSnapshotCompatibility, simulationSnapshotCompatibilityIssues } from "../src/simulation/simulation-runtime-compatibility.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/pub_revision_unused_test", max: 1 });
afterAll(() => pool.end());
const migration = await readFile(new URL("../migrations/260_day_plan_published_revision.sql", import.meta.url), "utf8");

it("rejects a retained pre-publication-column snapshot through the schema compatibility gate", () => {
  const identity = { template_schema: "dt_template_prior", catalogue: { tables: [{ name: "day_plan_versions", columns: ["plan_id", "version", "state"] }] } };
  const oldSchema = `sha256:${"a".repeat(64)}`, currentSchema = `sha256:${"c".repeat(64)}`;
  const captured = buildSimulationSnapshotCompatibility(identity, { platform_schema_fingerprint: oldSchema,
    conformance_manifest_version: "simulation-platform/v1", conformance_fingerprint: `sha256:${"b".repeat(64)}` });
  expect(simulationSnapshotCompatibilityIssues({ ...captured, identity, supported_platform_schema_fingerprints: [currentSchema] }))
    .toContain("platform_schema_fingerprint_unsupported");
});

/** Exercise the actual migration's data upgrade/guards in rollback-owned schemas.
 * The complete function is compiled/executed by the full-schema owner/COW tests. */
async function fixture(run: (client: PoolClient, sql: string, ids: { school: string; plan: string; correlation: string }) => Promise<void>) {
  const client = await pool.connect(), schema = `pubrev_${randomUUID().replaceAll("-", "")}`;
  const ids = { school: randomUUID(), plan: randomUUID(), correlation: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path="${schema}",public; SET LOCAL check_function_bodies=off;
      CREATE TABLE day_plan_versions(school_id uuid,plan_id uuid,version integer,state text);
      CREATE TABLE audit_events(school_id uuid,target_type text,target_id uuid,action text,metadata jsonb,request_id uuid);
      CREATE TABLE campus_model_events(school_id uuid,source_domain text,source_record_id text,event_type text,payload jsonb,correlation_id uuid,source_revision integer);
      CREATE TABLE staff_timetable_substitutions(school_id uuid,source_record_id uuid,source_version integer,source_kind text,state text,source_revision integer);`);
    await client.query("INSERT INTO day_plan_versions VALUES($1,$2,1,'published'),($1,$2,2,'draft')", [ids.school, ids.plan]);
    await run(client, migration.replaceAll("public.", `"${schema}".`).replaceAll("SET search_path=public", `SET search_path="${schema}"`), ids);
  } finally { await client.query("ROLLBACK"); client.release(); }
}
async function evidence(client: PoolClient, ids: { school: string; plan: string; correlation: string }, revisions = [3]) {
  await client.query("INSERT INTO audit_events VALUES($1,'day_plan',$2,'day_plan.published','{\"version\":1}',$3)", [ids.school, ids.plan, ids.correlation]);
  for (const revision of revisions) await client.query("INSERT INTO campus_model_events VALUES($1,'day_plan',$2,'timetable.day_plan_published','{\"version\":1}',$3,$4)", [ids.school, ids.plan, ids.correlation, revision]);
}

describe.skipIf(!enabled)("immutable day-plan publication revision upgrade", () => {
  it("backfills the exact correlated publication and leaves the unpublished draft unknown", () => fixture(async (client, sql, ids) => {
    await evidence(client, ids); await client.query(sql);
    expect((await client.query("SELECT version,published_revision FROM day_plan_versions ORDER BY version")).rows)
      .toEqual([{ version: 1, published_revision: 3 }, { version: 2, published_revision: null }]);
    await expect(client.query("UPDATE day_plan_versions SET published_revision=4 WHERE version=1")).rejects.toThrow("immutable");
  }));
  it("rejects missing or unrelated publication evidence", () => fixture(async (client, sql, ids) => {
    await evidence(client, { ...ids, correlation: randomUUID() });
    await client.query("UPDATE campus_model_events SET correlation_id=$1", [ids.correlation]);
    await expect(client.query(sql)).rejects.toThrow("missing or conflicting provenance");
  }));
  it("rejects conflicting exact source revisions instead of picking a convenient value", () => fixture(async (client, sql, ids) => {
    await evidence(client, ids, [3, 4]);
    await expect(client.query(sql)).rejects.toThrow("missing or conflicting provenance");
  }));
  it("refuses to detach a retained accepted cover with different historical source evidence", () => fixture(async (client, sql, ids) => {
    await evidence(client, ids);
    await client.query("INSERT INTO staff_timetable_substitutions VALUES($1,$2,1,'daily_plan','effective',4)", [ids.school, ids.plan]);
    await expect(client.query(sql)).rejects.toThrow("different retained source revision");
  }));
});
