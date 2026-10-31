import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { simulationFunctionDefinition, type SimulationBranch } from "../src/database/simulation-branch.driver.js";
import { RolesService } from "../src/roles/roles.service.js";
import { accessRoleCatalogue, staffRoleAssignments } from "../src/roles/access-roles.service.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/authority_dates_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
describe.skipIf(!enabled)("institution-local permission dates", () => {
  it("executes the captured helper against its selected-world clock rather than wall time", async () => {
    const namespace = `audit_permission_date_${randomUUID().replaceAll("-", "")}`, schoolId = randomUUID();
    const rollback = new Error("Rollback selected-world date fixture");
    try {
      await db.transaction().execute(async tx => {
        await sql.raw(`CREATE SCHEMA ${namespace}; CREATE TABLE ${namespace}.schools(id uuid,timezone text);
          CREATE FUNCTION ${namespace}.simulation_now() RETURNS timestamptz LANGUAGE sql STABLE AS
          $clock$ SELECT current_setting('thatcampus.virtual_now')::timestamptz $clock$;`).execute(tx);
        await sql`INSERT INTO ${sql.table(`${namespace}.schools`)} VALUES(${schoolId}::uuid,'Asia/Kolkata')`.execute(tx);
        const source = (await sql<{ definition: string }>`SELECT pg_get_functiondef('campus_permission_date(uuid,timestamptz)'::regprocedure) AS definition`.execute(tx)).rows[0]!.definition;
        await sql.raw(simulationFunctionDefinition(source, { schema_name: namespace } as SimulationBranch)).execute(tx);
        await sql`SET LOCAL TIME ZONE 'Pacific/Honolulu'`.execute(tx);
        for (const [instant, expected] of [["2031-12-31T18:29:59Z", "2031-12-31"], ["2031-12-31T18:30:00Z", "2032-01-01"]]) {
          await sql`SELECT set_config('thatcampus.virtual_now',${instant},true)`.execute(tx);
          const result = (await sql<{ day: string }>`SELECT ${sql.raw(`${namespace}.campus_permission_date`)}(${schoolId}::uuid)::text AS day`.execute(tx)).rows[0]!;
          expect(result.day).toBe(expected);
        }
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  it("converts east/west midnight and DST boundaries independently of the connection timezone", async () => {
    const f = await createClassPracticeFixture(db);
    const cases = [
      ["Asia/Kolkata", "2026-10-23T18:29:59Z", "2026-10-23"], ["Asia/Kolkata", "2026-10-23T18:30:00Z", "2026-10-24"],
      ["America/Los_Angeles", "2026-10-24T06:59:59Z", "2026-10-23"], ["America/Los_Angeles", "2026-10-24T07:00:00Z", "2026-10-24"],
      ["America/New_York", "2026-03-08T04:59:59Z", "2026-03-07"], ["America/New_York", "2026-03-08T05:00:00Z", "2026-03-08"],
    ];
    for (const [zone, instant, expected] of cases) await db.transaction().execute(async tx => {
      await sql`SET LOCAL TIME ZONE 'Pacific/Honolulu'`.execute(tx);
      await tx.updateTable("schools").set({ timezone: zone! }).where("id", "=", f.schoolId).execute();
      const result = (await sql<{ day: string }>`SELECT campus_permission_date(${f.schoolId}::uuid,${instant}::timestamptz)::text AS day`.execute(tx)).rows[0]!;
      expect(result.day).toBe(expected);
    });
  });
  it("uses the campus day for current resource authority rather than connection CURRENT_DATE", async () => {
    const f = await createClassPracticeFixture(db);
    await db.transaction().execute(async tx => {
      // Opposite offsets guarantee different calendar days at every instant.
      await sql`SET LOCAL TIME ZONE 'Etc/GMT+12'`.execute(tx);
      await tx.updateTable("schools").set({ timezone: "Pacific/Kiritimati" }).where("id", "=", f.schoolId).execute();
      await sql`UPDATE staff_responsibility_assignments SET starts_on=campus_permission_date(${f.schoolId}::uuid),
        ends_on=campus_permission_date(${f.schoolId}::uuid) WHERE id=${f.assignmentId}::uuid`.execute(tx);
      const result = (await sql<{ allowed: boolean; different_day: boolean }>`SELECT staff_has_resource_permission(${f.schoolId}::uuid,
        ${f.teacher.id}::uuid,'learning.work.publish','class',${f.classId}::uuid) AS allowed,
        campus_permission_date(${f.schoolId}::uuid)<>CURRENT_DATE AS different_day`.execute(tx)).rows[0]!;
      expect(result.different_day).toBe(true); expect(result.allowed).toBe(true);
      const effective = await new RolesService(db).effective(f.teacher, f.schoolId, tx);
      expect(effective.permissions).toContain("learning.work.publish");
      expect(effective.work_profiles.some(profile => profile.id === f.roleId)).toBe(true);
      const assignments = await staffRoleAssignments(tx, f.schoolId, f.teacher.id);
      expect(assignments.find(assignment => assignment.source_id === f.assignmentId)?.display_status).toBe("active");
      const catalogue = await accessRoleCatalogue(tx, f.schoolId);
      expect(catalogue.find(role => role.id === f.roleId)?.assignment_count).toBeGreaterThan(0);
    });
    const remaining = (await sql<{ name: string }>`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND (p.proname LIKE 'event_user_is_authorized%'
        OR p.proname IN('fee_invoice_event_is_authorized','staff_has_class_permission','staff_has_resource_permission','notification_chat_report_is_current_reviewer')
        OR p.proname LIKE 'notification_attention_is_currently_authorized%') AND position('current_date' in lower(p.prosrc))>0`.execute(db)).rows;
    expect(remaining).toEqual([]);
  });
});
