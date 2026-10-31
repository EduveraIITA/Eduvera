import { createHash, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
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
  const events = new SchoolEventService(connection, core);
  return { core, events, people: new ParticipationPeopleService(connection, events, core, core, core, core) };
}
async function fixture() {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `create-contact-${suffix}`, email: `create-contact-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Campus", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId }, now = "2037-06-15T12:00:00.000Z";
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now } }), action);
  return { ...context, user, schoolId, run, now };
}
async function counts(database: Kysely<Database>, schoolId: string) {
  return (await sql<Record<string, number>>`SELECT
    (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid) AS people,
    (SELECT count(*)::int FROM school_memberships WHERE school_id=${schoolId}::uuid) AS memberships,
    (SELECT count(*)::int FROM school_invitations WHERE school_id=${schoolId}::uuid) AS invitations,
    (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) AS students,
    (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid) AS staff,
    (SELECT count(*)::int FROM people_participation_commands WHERE school_id=${schoolId}::uuid) AS people_commands,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid) AS core_commands,
    (SELECT count(*)::int FROM campus_model_entities WHERE school_id=${schoolId}::uuid) AS entities,
    (SELECT count(*)::int FROM campus_model_events WHERE school_id=${schoolId}::uuid) AS model_events,
    (SELECT count(*)::int FROM audit_events WHERE school_id=${schoolId}::uuid) AS audits,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS outbox`.execute(database)).rows[0]!;
}

describe.runIf(enabled)("canonical person creation with optional contacts", () => {
  it("saves initial contacts once with the existing command, retains legacy hashes, and keeps contacts out of generic evidence/response", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = { first_name: "Contact Person", contact_email: "Private.Contact@example.test", contact_phone: " +91 90000 11111 ext 2 ", idempotency_key: randomUUID() };
      const before = await counts(db, f.schoolId);
      const person = await f.people.create(request(f.user), f.schoolId, input);
      expect(person).toEqual({ id: expect.any(String), label: "Contact Person", affiliations: [], has_account: false, account_state: "not_linked", is_you: false });
      expect(await f.people.detail(f.user, f.schoolId, person.id)).toMatchObject({ revision: 1,
        profile: { contact_email: input.contact_email, contact_phone: "+91 90000 11111 ext 2" }, has_account: false });
      const after = await counts(db, f.schoolId);
      expect(after).toMatchObject({ people: before.people! + 1, memberships: before.memberships, invitations: before.invitations,
        students: before.students, staff: before.staff, people_commands: before.people_commands! + 1,
        core_commands: before.core_commands! + 1, entities: before.entities! + 1, model_events: before.model_events! + 1,
        audits: before.audits! + 1, outbox: before.outbox! + 1 });
      expect(await f.people.create(request(f.user), f.schoolId, input)).toEqual(person);
      expect(await counts(db, f.schoolId)).toEqual(after);
      await expect(f.people.create(request(f.user), f.schoolId, { ...input, contact_email: "Changed@example.test" })).rejects.toThrow("different people data");
      await expect(f.people.create(request(f.user), f.schoolId, { ...input, contact_phone: "Different number" })).rejects.toThrow("different people data");
      const evidence = (await sql<{ value: unknown }>`SELECT to_jsonb(record) AS value FROM (
        SELECT 'core_command' AS kind,to_jsonb(command) AS data FROM campus_model_commands command WHERE school_id=${f.schoolId}::uuid
        UNION ALL SELECT 'entity',to_jsonb(entity) FROM campus_model_entities entity WHERE school_id=${f.schoolId}::uuid
        UNION ALL SELECT 'model_event',to_jsonb(event) FROM campus_model_events event WHERE school_id=${f.schoolId}::uuid
        UNION ALL SELECT 'outbox',to_jsonb(event) FROM event_outbox event WHERE school_id=${f.schoolId}::uuid
        UNION ALL SELECT 'audit',to_jsonb(event) FROM audit_events event WHERE school_id=${f.schoolId}::uuid
        UNION ALL SELECT 'retained_result',result FROM people_participation_commands WHERE school_id=${f.schoolId}::uuid
      ) record`.execute(db)).rows;
      const serialized = JSON.stringify({ person, evidence });
      expect(serialized).not.toContain(input.contact_email);
      expect(serialized).not.toContain("90000 11111");
      const legacyInput = { first_name: "Legacy name only", idempotency_key: randomUUID() };
      const legacy = await f.people.create(request(f.user), f.schoolId, legacyInput);
      const retained = (await sql<{ request_hash: string }>`SELECT request_hash FROM people_participation_commands
        WHERE school_id=${f.schoolId}::uuid AND actor_id=${f.user.id}::uuid AND idempotency_key=${legacyInput.idempotency_key}::uuid`.execute(db)).rows[0]!;
      expect(retained.request_hash).toBe(createHash("sha256").update(JSON.stringify({ first_name: legacyInput.first_name, last_name: "", idempotency_key: legacyInput.idempotency_key })).digest("hex"));
      expect(await f.people.create(request(f.user), f.schoolId, legacyInput)).toEqual(legacy);
      await expect(f.people.create(request(f.user), f.schoolId, { ...legacyInput, contact_email: "" })).rejects.toThrow("different people data");
      expect(await f.people.detail(f.user, f.schoolId, legacy.id)).toMatchObject({ profile: { contact_email: "", contact_phone: "" } });
      const distinct = await f.people.create(request(f.user), f.schoolId, { ...input, idempotency_key: randomUUID() });
      expect(distinct.id).not.toBe(person.id); // Contact equality is not an identity/linking decision.
    });
  }, 60000);

  it("rejects invalid contacts and current authority failures without partial rows or command evidence", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      const before = await counts(db, f.schoolId), base = { first_name: "Invalid contacts", idempotency_key: randomUUID() };
      for (const fields of [{ contact_email: "invalid" }, { contact_phone: "x".repeat(33) }, { contact_email: null }, { contact_phone: 9000000000 }]) {
        expect(() => f.people.create(request(f.user), f.schoolId, { ...base, ...fields })).toThrow();
      }
      const valid = { ...base, contact_email: "valid@example.test", contact_phone: "0".repeat(32) };
      await expect(f.people.create(request(foreign.user), f.schoolId, valid)).rejects.toThrow("Select this institution");
      await expect(f.people.create(request({ ...foreign.user, active_school_id: f.schoolId }), f.schoolId, valid)).rejects.toThrow("active membership");
      expect(await counts(db, f.schoolId)).toEqual(before);
      const saved = await f.people.create(request(f.user), f.schoolId, valid);
      const after = await counts(db, f.schoolId);
      await expect(f.people.correctProfile(request(f.user), f.schoolId, saved.id, { expected_revision: 1, contact_email: valid.contact_email,
        contact_phone: "x".repeat(33), reason: "Invalid oversized phone", idempotency_key: randomUUID() })).rejects.toThrow();
      expect(await counts(db, f.schoolId)).toEqual(after);
      await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
      await expect(f.people.create(request(f.user), f.schoolId, valid)).rejects.toThrow("active membership");
      expect(await counts(db, f.schoolId)).toEqual(after);
      expect((await sql<{ contact_email: string }>`SELECT contact_email FROM school_people WHERE school_id=${f.schoolId}::uuid AND id=${saved.id}::uuid`.execute(db)).rows[0]?.contact_email).toBe(valid.contact_email);
    });
  }, 60000);

  it("rolls back the person and contacts when the same transaction cannot publish its required event", async () => {
    const f = await fixture();
    await f.run(async () => {
      const input = { first_name: "Atomic contact creation", contact_email: "atomic@example.test", contact_phone: "0012", idempotency_key: randomUUID() };
      const before = await counts(db, f.schoolId);
      const failure = vi.spyOn(f.events, "enqueueUserEvent").mockRejectedValueOnce(new Error("Injected event publication failure"));
      await expect(f.people.create(request(f.user), f.schoolId, input)).rejects.toThrow("Injected event");
      failure.mockRestore();
      expect(await counts(db, f.schoolId)).toEqual(before);
      const saved = await f.people.create(request(f.user), f.schoolId, input);
      expect(await f.people.detail(f.user, f.schoolId, saved.id)).toMatchObject({ revision: 1, profile: { contact_email: input.contact_email, contact_phone: input.contact_phone } });
    });
  }, 30000);

  it.runIf(Boolean(targetUrl))("creates run-local contacts through the same command without changing captured Live or sibling people", async () => {
    const f = await fixture();
    const liveInput = { first_name: "Live contact person", contact_email: "live-private@example.test", contact_phone: "00123", idempotency_key: randomUUID() };
    const original = await f.run(() => f.people.create(request(f.user), f.schoolId, liveInput));
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
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "participant-contact-create-test", checked_at: f.now });
        return { ...services(database), database, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      const sourceBefore = await f.run(() => counts(db, f.schoolId));
      const branchInput = { first_name: "Branch contact person", contact_email: "branch-private@example.test", contact_phone: "00456", idempotency_key: randomUUID() };
      const person = await branch.run(async () => {
        const saved = await branch.people.create(request(f.user), f.schoolId, branchInput);
        expect(await branch.people.create(request(f.user), f.schoolId, branchInput)).toEqual(saved);
        await expect(branch.people.create(request(f.user), f.schoolId, { ...branchInput, contact_phone: "00789" })).rejects.toThrow("different people data");
        expect(await branch.people.detail(f.user, f.schoolId, saved.id)).toMatchObject({ profile: { contact_email: branchInput.contact_email, contact_phone: branchInput.contact_phone } });
        return saved;
      });
      for (const context of [f, sibling]) await context.run(async () => {
        await expect(context.people.detail(f.user, f.schoolId, person.id)).rejects.toThrow("not found");
        expect(await context.people.detail(f.user, f.schoolId, original.id)).toMatchObject({ profile: { contact_email: liveInput.contact_email, contact_phone: liveInput.contact_phone } });
      });
      expect(await f.run(() => counts(db, f.schoolId))).toEqual(sourceBefore);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120000);
});
