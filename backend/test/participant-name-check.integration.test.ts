import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_PEOPLE_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) });
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
afterAll(() => db.destroy());

function services(database: Kysely<Database>) {
  const connection = database as DatabaseService, core = new CampusModelCoreService(connection, new ExecutionDataPlaneScope());
  return { core, people: new ParticipationPeopleService(connection, new SchoolEventService(connection, core), core, core, core, core) };
}

async function fixture() {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `name-check-${suffix}`, email: `name-check-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Campus", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "Pacific/Auckland"));
  const user: AuthUser = { ...account, active_school_id: schoolId }, now = "2037-06-15T20:00:00.000Z"; // 16 June in the campus.
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now } }), action);
  const person = (name: string) => context.people.create(request(user), schoolId, { first_name: name, idempotency_key: randomUUID() });
  return { ...context, user, schoolId, run, person, now };
}

async function receipts(database: Kysely<Database>, schoolId: string) {
  return (await sql<Record<string, number>>`SELECT
    (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) AS people,
    (SELECT count(*)::int FROM users) AS accounts,
    (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) AS students,
    (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) AS staff,
    (SELECT count(*)::int FROM people_participation_commands WHERE school_id=${schoolId}::uuid) AS people_commands,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid) AS core_commands,
    (SELECT count(*)::int FROM audit_events WHERE school_id=${schoolId}::uuid) AS audits,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS outbox`.execute(database)).rows[0]!;
}

describe.runIf(enabled)("bounded participant name collision preview with PostgreSQL", () => {
  it("matches case/Unicode whitespace without merging names, caps candidates but retains truthful totals, and is read-only", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      const names = ["Aarav Sharma", "AARAV SHARMA", "Aarav\tSharma", "Aarav\u00a0Sharma", "Aarav  Sharma", "aarav sharma", "Aarav\u2009Sharma"];
      const people = await db.insertInto("school_people").values(names.map(first_name => ({ school_id: f.schoolId, first_name, last_name: "" })))
        .returning(["id", "first_name", "revision"]).execute();
      const ordered = [...people].sort((left, right) => left.id.localeCompare(right.id));
      await sql`INSERT INTO person_affiliations(school_id,person_id,affiliation,starts_on,ends_on,created_by) VALUES
        (${f.schoolId}::uuid,${ordered[0]!.id}::uuid,'worker','2037-06-16',NULL,${f.user.id}::uuid),
        (${f.schoolId}::uuid,${ordered[0]!.id}::uuid,'visitor','2037-06-17',NULL,${f.user.id}::uuid),
        (${f.schoolId}::uuid,${ordered[0]!.id}::uuid,'other','2037-06-14','2037-06-15',${f.user.id}::uuid)`.execute(db);
      await sql`INSERT INTO school_people(school_id,first_name,last_name,retired_at)
        VALUES(${f.schoolId}::uuid,'Aarav Sharma','',${f.now}::timestamptz)`.execute(db);
      await db.insertInto("school_people").values({ school_id: foreign.schoolId, first_name: "Aarav Sharma", last_name: "" }).execute();
      const literal = await f.person("Literal_%"), length150 = await f.person("x".repeat(150));
      const before = await receipts(db, f.schoolId);
      const input = { names: [
        { row_id: "row-1", name: "  aarav\u3000SHARMA  " }, { row_id: "row-2", name: "Aarav Sharma" },
        { row_id: "row-3", name: "Literal_%" }, { row_id: "row-4", name: "Nobody matching" },
        { row_id: "row-5", name: "x".repeat(150) },
      ] };
      const preview = await f.people.nameCheck(f.user, f.schoolId, input);
      const expectedMatches = ordered.slice(0, 5).map((person, index) => ({ id: person.id, label: person.first_name, revision: 1,
        affiliations: index === 0 ? ["worker"] : [] }));
      expect(preview.results).toEqual([
        { row_id: "row-1", name: "aarav\u3000SHARMA", normalized_name: "aarav sharma", matches: expectedMatches, total: 7, truncated: true },
        { row_id: "row-2", name: "Aarav Sharma", normalized_name: "aarav sharma", matches: expectedMatches, total: 7, truncated: true },
        { row_id: "row-3", name: "Literal_%", normalized_name: "literal_%", matches: [{ id: literal.id, label: "Literal_%", revision: 1, affiliations: [] }], total: 1, truncated: false },
        { row_id: "row-4", name: "Nobody matching", normalized_name: "nobody matching", matches: [], total: 0, truncated: false },
        { row_id: "row-5", name: "x".repeat(150), normalized_name: "x".repeat(150), matches: [{ id: length150.id, label: "x".repeat(150), revision: 1, affiliations: [] }], total: 1, truncated: false },
      ]);
      expect(await f.people.nameCheck(f.user, f.schoolId, input)).toEqual(preview);
      expect(await receipts(db, f.schoolId)).toEqual(before);
      expect(await db.selectFrom("school_people").select(["id", "first_name", "revision"]).where("id", "in", people.map(person => person.id)).orderBy("id").execute()).toEqual(ordered);
      expect((await f.people.nameCheck(f.user, f.schoolId, { names: Array.from({ length: 100 }, (_, index) => ({ row_id: `row-${index}`, name: "Nobody matching" })) })).results).toHaveLength(100);
    });
  }, 60000);

  it("rechecks current campus authority before parsing a malformed request and exposes no other campus matches", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      await foreign.run(() => foreign.person("Private foreign person"));
      expect((await f.people.nameCheck(f.user, f.schoolId, { names: [{ row_id: "one", name: "Private foreign person" }] })).results[0])
        .toMatchObject({ matches: [], total: 0, truncated: false });
      await expect(f.people.nameCheck(foreign.user, f.schoolId, {})).rejects.toThrow("Select this institution");
      await expect(f.people.nameCheck({ ...foreign.user, active_school_id: f.schoolId }, f.schoolId, {})).rejects.toThrow("active membership");
      await sql`UPDATE school_memberships SET role='member' WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
      await expect(f.people.nameCheck(f.user, f.schoolId, {})).rejects.toThrow("sis.manage");
      await sql`UPDATE school_memberships SET role='admin',is_active=false WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
      await expect(f.people.nameCheck(f.user, f.schoolId, { names: [{ row_id: "one", name: "Campus Owner" }] })).rejects.toThrow("active membership");
    });
  }, 30000);

  it.runIf(Boolean(targetUrl))("reads changed name candidates only from the selected COW world, with unchanged Live and sibling results", async () => {
    const f = await fixture();
    const original = await f.run(() => f.person("Captured person"));
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId,
          namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "participant-name-check-test", checked_at: f.now });
        return { ...services(database), database, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      const query = { names: [{ row_id: "captured", name: "Captured person" }, { row_id: "branch", name: "Branch-only person" }, { row_id: "late", name: "Late Live person" }] };
      await branch.run(async () => {
        await branch.people.correctName(request(f.user), f.schoolId, original.id, { first_name: "Branch-only person", expected_revision: 1,
          reason: "Run-local spelling correction", idempotency_key: randomUUID() });
        const before = await receipts(branch.database, f.schoolId);
        expect((await branch.people.nameCheck(f.user, f.schoolId, query)).results).toEqual([
          expect.objectContaining({ row_id: "captured", matches: [], total: 0 }),
          expect.objectContaining({ row_id: "branch", matches: [{ id: original.id, label: "Branch-only person", revision: 2, affiliations: [] }], total: 1 }),
          expect.objectContaining({ row_id: "late", matches: [], total: 0 }),
        ]);
        expect(await receipts(branch.database, f.schoolId)).toEqual(before);
      });
      await f.run(() => f.person("Late Live person"));
      for (const context of [f, sibling]) await context.run(async () => {
        const results = (await context.people.nameCheck(f.user, f.schoolId, query)).results;
        expect(results[0]).toMatchObject({ matches: [{ id: original.id, label: "Captured person", revision: 1, affiliations: [] }], total: 1 });
        expect(results[1]).toMatchObject({ matches: [], total: 0 });
        expect(results[2]?.total).toBe(context === f ? 1 : 0);
      });
      await branch.run(async () => expect((await branch.people.nameCheck(f.user, f.schoolId, query)).results[2]).toMatchObject({ matches: [], total: 0 }));
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120000);
});
