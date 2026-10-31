import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { readDiningReadiness, resolveDiningContinuation } from "../src/institution-onboarding/dining-readiness.js";
import { createDiningFixture, diningServices } from "./dining.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/dining_worlds_unused_test";
const target = process.env.DINING_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const command = (expected_revision: number) => ({ command_id: randomUUID(), expected_revision });
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());

async function session(services: ReturnType<typeof diningServices>, user: AuthUser, school: string, id: string) {
  const row = await services.dining.detail(user, school, id);
  if (!("count_total" in row)) throw new Error("This actor cannot inspect the exact operating record.");
  return row;
}

async function openWorld(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, school: string) {
  const scenario = randomUUID(), run = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: school, scenario_id: scenario, namespace_id: namespace });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
    createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
  const environmentAt = (at: string) => simulationRequestEnvironment({ institution_id: school, scenario_id: scenario, run_id: run,
    virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "dining-actual-cow", checked_at: snapshot.captured_at });
  return { ...diningServices(database), database, namespace,
    run: <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(snapshot.captured_at), fn),
    runAt: <T>(at: string, fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(at), fn) };
}

describe.skipIf(!enabled || !target)("Dining through actual isolated COW worlds", () => {
  it("reuses an open-ended weekly plan while isolating one-date exceptions and non-reserving context", async () => {
    const f = await createDiningFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    const date = new Date(Date.parse(f.now) + 86_400_000).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(f.now) + 2 * 86_400_000).toISOString().slice(0, 10);
    let planId = "", seriesId = "", revision = 0;
    try {
      await f.run(async () => {
        const hall = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
          name: "Fictional weekly dining hall", code: "WEEKLY-HALL", kind: "other" }, resourceLoanRequest(f.user));
        if (typeof hall.id !== "string") throw new Error("Canonical dining place is missing.");
        const topologyBefore = await db.selectFrom("campus_model_entities").select(["domain_id", "source_revision", "metadata"])
          .where("school_id", "=", f.schoolId).where("domain", "=", "campus_topology").orderBy("domain_id").execute();
        const service = await f.dining.saveService(f.user, f.schoolId, { ...command(0), name: "Fictional weekly lunch",
          coordinator_person_id: f.custodianPersonId, space_id: hall.id });
        const saved = await f.dining.savePlan(f.user, f.schoolId, { ...command(0), service_id: service.id,
          service_expected_revision: service.revision, label: "Fictional lunch menu", timezone: "UTC", starts_on: date, ends_on: null,
          days: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, menu_text: `Fictional menu for weekday ${index + 1}`,
            starts_at: "12:00", ends_at: "14:00", end_day_offset: 0, space_id: hall.id, operator_person_id: f.borrowerPersonId,
            start_fold: "reject", end_fold: "reject" })) });
        planId = saved.id;
        const accepted = await f.dining.publishPlan(f.user, f.schoolId, planId, command(saved.revision));
        revision = accepted.revision;
        const plan = await f.dining.plan(f.user, f.schoolId, planId);
        seriesId = plan.series_id;
        const before = await db.selectFrom("dining_sessions").select("id").where("school_id", "=", f.schoolId).execute();
        const view = await f.dining.availability(f.borrower, f.schoolId, { from: date, until: nextDate, page: 1 });
        expect(view.items).toHaveLength(2);
        expect(view.items.every(item => item.availability_only && !item.venue_reserved && item.session_id === null)).toBe(true);
        await f.dining.planDate(f.borrower, f.schoolId, seriesId, date);
        expect(await db.selectFrom("dining_sessions").select("id").where("school_id", "=", f.schoolId).execute()).toEqual(before);
        expect(await db.selectFrom("campus_model_entities").select(["domain_id", "source_revision", "metadata"])
          .where("school_id", "=", f.schoolId).where("domain", "=", "campus_topology").orderBy("domain_id").execute()).toEqual(topologyBefore);
      });
      const snapshot = await store.capture(f.schoolId, f.now);
      for (const table of ["dining_weekly_plans", "dining_weekly_days", "dining_weekly_receipts"])
        expect(snapshot.counts).toHaveProperty(table);
      const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
      opened.push(world.database, sibling.database);
      await world.run(async () => {
        const before = await world.dining.availability(f.borrower, f.schoolId, { from: date, until: nextDate, page: 1 });
        const next = before.items.find(item => item.local_date === nextDate);
        const body = { command_id: randomUUID(), expected_plan_version_id: planId, expected_plan_revision: revision,
          expected_session_revision: 0, action: "publish_changes", menu_text: "Fictional one-date substitution",
          note: "Only this date changes in the isolated scenario" };
        const accepted = await world.dining.actPlanDate(f.user, f.schoolId, seriesId, date, body);
        expect(await world.dining.actPlanDate(f.user, f.schoolId, seriesId, date, body)).toEqual(accepted);
        await expect(world.dining.actPlanDate(f.user, f.schoolId, seriesId, date, { ...body, menu_text: "Changed retry payload" })).rejects.toThrow();
        const changed = await world.dining.availability(f.borrower, f.schoolId, { from: date, until: nextDate, page: 1 });
        expect(changed.items).toHaveLength(2);
        expect(changed.items.find(item => item.local_date === date)).toMatchObject({ menu_text: "Fictional one-date substitution", session_id: accepted.id });
        expect(changed.items.find(item => item.local_date === nextDate)).toEqual(next);
        expect(await world.dining.detail(f.user, f.schoolId, accepted.id)).toMatchObject({ state: "published", count_total: null });
        const projected = await world.database.selectFrom("campus_model_schedule_occurrences").selectAll()
          .where("school_id", "=", f.schoolId).where("claim_kind", "=", "availability").execute();
        expect(projected.length).toBeGreaterThan(0);
        expect(projected.every(row => row.class_entity_id === null && row.responsible_agent_id === null)).toBe(true);
        const people = await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_occurrence_participants person
          JOIN campus_model_schedule_occurrences occurrence ON occurrence.id=person.occurrence_id
          WHERE occurrence.school_id=${f.schoolId}::uuid AND occurrence.claim_kind='availability'`.execute(world.database);
        expect(people.rows[0]!.count).toBe(0);
        const person = await world.database.selectFrom("campus_model_entities").select("id").where("school_id", "=", f.schoolId)
          .where("domain", "=", "people").where("kind", "=", "person").where("domain_id", "=", f.borrowerPersonId).executeTakeFirstOrThrow();
        const first = projected[0]!;
        await expect(world.database.transaction().execute(tx => sql`INSERT INTO campus_model_occurrence_participants(
          school_id,realm_id,environment_namespace_id,occurrence_id,participant_entity_id,role,required,source_ref,source_revision)
          VALUES(${f.schoolId}::uuid,${first.realm_id}::uuid,${world.namespace},${first.id}::uuid,${person.id}::uuid,
            'operator',false,'forged-optional-participation',1)`.execute(tx))).rejects.toThrow(/Availability cannot assign people or attendance/);
        const dateSession = await world.dining.detail(f.user, f.schoolId, accepted.id);
        await world.dining.act(f.user, f.schoolId, accepted.id, { ...command(dateSession.revision), action: "cancel", note: "Fictional one-date closure" });
        const cancelled = await world.dining.availability(f.borrower, f.schoolId, { from: date, until: nextDate, page: 1 });
        expect(cancelled.items.filter(item => item.local_date === date)).toHaveLength(1);
        expect(cancelled.items.find(item => item.local_date === date)).toMatchObject({ session_id: accepted.id, state: "cancelled" });
        expect(cancelled.items.find(item => item.local_date === nextDate)).toEqual(next);
      });
      const unchanged = async (services: ReturnType<typeof diningServices>) => {
        const view = await services.dining.availability(f.borrower, f.schoolId, { from: date, until: nextDate, page: 1 });
        expect(view.items).toHaveLength(2);
        expect(view.items.every(item => item.session_id === null && item.menu_text.startsWith("Fictional menu for weekday"))).toBe(true);
        expect(await services.db.selectFrom("dining_sessions").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
        expect(await services.dining.plan(f.user, f.schoolId, planId)).toMatchObject({ ends_on: null, revision });
      };
      await f.run(() => unchanged(f));
      await sibling.run(() => unchanged(sibling));
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);

  it("preserves one campus structure while agents publish, report, correct and hand off service work only in their branch", async () => {
    const f = await createDiningFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    let serviceId = "", sessionId = "", roomId = "", buildingId = "";
    const ends = new Date(Date.parse(f.now) + 3_600_000).toISOString();
    try {
      await f.run(async () => {
        expect((await readDiningReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("needs_service");
        const building = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
          name: "Fictional shared services building", code: "DINING-BUILDING", kind: "building" }, resourceLoanRequest(f.user));
        if (typeof building.id !== "string") throw new Error("Canonical building identity is missing.");
        buildingId = building.id;
        const room = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, parent_space_id: building.id,
          name: "Fictional dining hall", code: "DINING-HALL", kind: "other" }, resourceLoanRequest(f.user));
        if (typeof room.id !== "string") throw new Error("Canonical room identity is missing.");
        roomId = room.id;
        const holding = await db.selectFrom("campus_resource_holdings").selectAll().where("school_id", "=", f.schoolId)
          .where("id", "=", f.holdingId).executeTakeFirstOrThrow();
        await f.topology.updateAsset(f.user, f.schoolId, holding.id, { campus_id: holding.campus_id, space_id: room.id,
          resource_type_id: holding.resource_type_id, name: holding.name, quantity: holding.quantity, asset_tag: holding.asset_tag,
          state: holding.state, notes: holding.notes, expected_revision: holding.revision }, resourceLoanRequest(f.user));
        const service = await f.dining.saveService(f.user, f.schoolId, { ...command(0), name: "Fictional Riverview lunch",
          coordinator_person_id: f.custodianPersonId, space_id: room.id });
        serviceId = service.id;
        expect((await readDiningReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("ready_to_plan");
        const draft = await f.dining.createSession(f.user, f.schoolId, { ...command(0), service_id: service.id,
          service_expected_revision: service.revision, label: "Fictional lunch", operator_person_id: f.borrowerPersonId,
          space_id: room.id, starts_at: f.now, ends_at: ends, menu_text: "Fictional rice and vegetables" });
        sessionId = draft.id;
        expect((await readDiningReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("draft_recorded");
        await f.dining.act(f.user, f.schoolId, draft.id, { ...command(draft.revision), action: "publish" });
        expect((await readDiningReadiness(db, f.core, f.user, f.schoolId)).operation).toMatchObject({
          state: "menu_published", scope: { kind: "session", id: sessionId }, source_revision: 2 });
      });
      const snapshot = await store.capture(f.schoolId, f.now);
      for (const table of ["dining_services", "dining_service_receipts", "dining_sessions", "dining_session_receipts", "dining_issues", "dining_issue_receipts"])
        expect(snapshot.counts).toHaveProperty(table);
      const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
      opened.push(world.database, sibling.database);
      await world.run(async () => {
        const readiness = (await readDiningReadiness(world.database, world.core, f.user, f.schoolId)).operation;
        expect(readiness).toMatchObject({ state: "menu_published", environment_namespace_id: world.namespace, scope: { kind: "session", id: sessionId } });
        expect(await resolveDiningContinuation(world.database, world.core, f.user, f.schoolId, `/areas/dining?session_id=${sessionId}`)).not.toBeNull();
        const next = (await world.dining.work(f.borrower, f.schoolId)).needs_me.find(item => item.session_id === sessionId);
        expect(next?.message_id).toBeTruthy();
        const beforePeople = snapshot.counts.school_people, beforeSpaces = snapshot.counts.campus_spaces, beforeResources = snapshot.counts.campus_resource_holdings;
        const topology = () => world.database.selectFrom("campus_model_entities")
          .select(["kind", "domain_id", "label", "lifecycle_state", "source_revision", "metadata"])
          .where("school_id", "=", f.schoolId).where("domain", "=", "campus_topology").orderBy("domain_id").execute();
        const beforeTopology = await topology();
        const relationships = () => world.database.selectFrom("campus_model_relationships")
          .select(["relation_type", "source_entity_id", "target_entity_id", "effective_from", "effective_until", "source_revision"])
          .where("school_id", "=", f.schoolId).where("source_domain", "=", "campus_topology").orderBy("id").execute();
        const beforeRelationships = await relationships();
        expect(beforeTopology.length).toBeGreaterThan(2);
        expect(beforeRelationships.some(relation => relation.relation_type === "part_of")).toBe(true);
        expect(beforeRelationships.some(relation => relation.relation_type === "located_in")).toBe(true);
        let current = await session(world, f.borrower, f.schoolId, sessionId);
        const open = { ...command(current.revision), action: "open" };
        const accepted = await world.dining.act(f.borrower, f.schoolId, sessionId, open);
        expect(await world.dining.act(f.borrower, f.schoolId, sessionId, open)).toEqual(accepted);
        await expect(world.dining.act(f.borrower, f.schoolId, sessionId, { ...open, note: "Changed retry" })).rejects.toThrow();
        current = await session(world, f.borrower, f.schoolId, sessionId);
        expect(current).toMatchObject({ state: "open", count_total: null });
        const count = { ...command(current.revision), action: "count", count_total: 12, observed_at: f.now };
        await world.dining.act(f.borrower, f.schoolId, sessionId, count);
        current = await session(world, f.borrower, f.schoolId, sessionId);
        const counted = current.count_receipt_id;
        expect(counted).toBeTruthy();
        await world.dining.act(f.borrower, f.schoolId, sessionId, { ...command(current.revision), action: "correct_count",
          count_total: 10, observed_at: f.now, supersedes_receipt_id: counted!, note: "Two handoffs were entered twice" });
        current = await session(world, f.borrower, f.schoolId, sessionId);
        expect(current.count_total).toBe(10);
        expect(current.history.some(row => row.action === "count_corrected")).toBe(true);
        const issue = await world.dining.reportIssue(f.borrower, f.schoolId, sessionId, { ...command(current.revision),
          title: "Fictional vegetables running short", note: "PRIVATE fictional operator explanation", handler_person_id: f.custodianPersonId });
        expect((await world.dining.work(f.user, f.schoolId)).needs_me.some(item => item.issue_id === issue.id && item.message_id)).toBe(true);
        await expect(world.dining.actIssue(f.borrower, f.schoolId, issue.id, { ...command(1), action: "accept" })).rejects.toThrow();
        await world.dining.actIssue(f.user, f.schoolId, issue.id, { ...command(1), action: "accept" });
        await world.dining.actIssue(f.user, f.schoolId, issue.id, { ...command(2), action: "resolve", note: "Kitchen confirmed an additional prepared batch" });
        expect((await world.dining.work(f.user, f.schoolId)).needs_me.some(item => item.issue_id === issue.id)).toBe(false);
        await world.dining.actIssue(f.borrower, f.schoolId, issue.id, { ...command(3), action: "reopen", note: "The counter still has no replacement batch" });
        await world.dining.actIssue(f.user, f.schoolId, issue.id, { ...command(4), action: "accept" });
        await world.dining.actIssue(f.user, f.schoolId, issue.id, { ...command(5), action: "resolve", note: "Counter now confirms the replacement is available" });
        await world.dining.act(f.user, f.schoolId, sessionId, { ...command(current.revision), action: "publish_changes",
          menu_text: "Fictional rice and revised vegetable dish", note: "Kitchen confirmed today's substitution" });
        for (const [table, expected] of [["school_people", beforePeople], ["campus_spaces", beforeSpaces], ["campus_resource_holdings", beforeResources]] as const) {
          const result = await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${sql.table(table)} WHERE school_id=${f.schoolId}::uuid`.execute(world.database);
          expect(result.rows[0]!.count).toBe(expected);
        }
        expect(await world.database.selectFrom("campus_spaces").select("parent_space_id").where("id", "=", roomId).executeTakeFirstOrThrow()).toEqual({ parent_space_id: buildingId });
        expect(await world.database.selectFrom("campus_resource_holdings").select("space_id").where("id", "=", f.holdingId).executeTakeFirstOrThrow()).toEqual({ space_id: roomId });
        expect(await topology()).toEqual(beforeTopology);
        expect(await relationships()).toEqual(beforeRelationships);
        const events = await world.database.selectFrom("campus_model_events").select(["actor_agent_id", "context_entity_id", "payload", "environment_namespace_id"])
          .where("school_id", "=", f.schoolId).where("source_domain", "=", "dining").execute();
        expect(events.length).toBeGreaterThan(3);
        expect(events.every(event => event.actor_agent_id && event.context_entity_id && event.environment_namespace_id === world.namespace)).toBe(true);
        expect(JSON.stringify(events)).not.toMatch(/PRIVATE fictional|menu_text|count_total/u);
        const contexts = await world.database.selectFrom("campus_model_entities").select(["domain", "domain_id"])
          .where("id", "in", events.map(event => event.context_entity_id!)).execute();
        expect(contexts.every(context => context.domain === "campus_topology" && context.domain_id === roomId)).toBe(true);
      });
      const late = new Date(Date.parse(f.now) + 7_200_000).toISOString();
      await world.runAt(late, async () => {
        const current = await world.dining.detail(f.borrower, f.schoolId, sessionId);
        expect(current.state).toBe("open"); // Passage of time is not observed closure.
        await world.dining.act(f.borrower, f.schoolId, sessionId, { ...command(current.revision), action: "end", note: "Operator confirms service has ended" });
        expect((await world.dining.detail(f.borrower, f.schoolId, sessionId)).state).toBe("ended");
        expect((await world.dining.work(f.borrower, f.schoolId)).needs_me.some(item => item.session_id === sessionId)).toBe(false);
      });
      const unchanged = async (services: ReturnType<typeof diningServices>) => {
        expect(await services.dining.detail(f.borrower, f.schoolId, sessionId)).toMatchObject({ state: "published", revision: 2,
          menu_text: "Fictional rice and vegetables", count_total: null });
        expect(await services.db.selectFrom("dining_issues").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
        expect(await services.db.selectFrom("campus_resource_holdings").select("space_id").where("id", "=", f.holdingId).executeTakeFirstOrThrow()).toEqual({ space_id: roomId });
        expect(await services.dining.service(f.user, f.schoolId, serviceId)).toMatchObject({ revision: 1, menu_mode: "native", operations_mode: "native" });
      };
      await f.run(() => unchanged(f));
      await sibling.run(() => unchanged(sibling));
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
