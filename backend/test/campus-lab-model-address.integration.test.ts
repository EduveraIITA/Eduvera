import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { seedCampusLab } from "../src/database/seed-campus-lab.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const pool = new Pool({
  connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
  max: 1,
});

afterAll(async () => {
  await pool.end();
});

describe("Campus Lab model-address convergence", () => {
  it("writes and replays only address-consistent Live topology relationships", async () => {
    const options = { demoMode: true, explicitOptIn: true, environment: "test" } as const;
    await seedCampusLab(pool, options);
    const before = (await pool.query<{ ids: string[] }>(`SELECT ARRAY(
      SELECT relationship.id::text
      FROM campus_model_relationships relationship
      JOIN schools school ON school.id=relationship.school_id AND school.code='cis'
      WHERE relationship.source_domain='campus_topology'
      ORDER BY relationship.id
    ) ids`)).rows[0]!.ids;
    expect(before.length).toBeGreaterThan(0);

    await seedCampusLab(pool, options);
    const after = (await pool.query<{ ids: string[]; violations: string }>(`SELECT
      ARRAY(
        SELECT relationship.id::text
        FROM campus_model_relationships relationship
        JOIN schools school ON school.id=relationship.school_id AND school.code='cis'
        WHERE relationship.source_domain='campus_topology'
        ORDER BY relationship.id
      ) ids,
      (SELECT count(*)::text
        FROM campus_model_relationships relationship
        JOIN schools school ON school.id=relationship.school_id AND school.code='cis'
        JOIN campus_model_entities source ON source.id=relationship.source_entity_id
        JOIN campus_model_entities target ON target.id=relationship.target_entity_id
        WHERE relationship.source_domain='campus_topology' AND (
          relationship.realm_id<>source.realm_id
          OR relationship.environment_namespace_id<>source.environment_namespace_id
          OR relationship.realm_id<>target.realm_id
          OR relationship.environment_namespace_id<>target.environment_namespace_id
          OR relationship.environment_namespace_id<>'live:'||relationship.school_id::text
        )) violations`)).rows[0]!;
    expect(after.ids).toEqual(before);
    expect(after.violations).toBe("0");
  });
});
