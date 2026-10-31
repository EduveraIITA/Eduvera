import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { readAccommodationReadiness, resolveAccommodationContinuation } from "../src/institution-onboarding/accommodation-readiness.js";
import { accommodationServices, createAccommodationFixture } from "./accommodation.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/accommodation_worlds_unused_test";
const target = process.env.ACCOMMODATION_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
const after = (instant: string, days: number) => new Date(Date.parse(instant) + days * 86_400_000).toISOString();
const command = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });

async function openWorld(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, schoolId: string) {
  const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: schoolId,
    scenario_id: scenarioId, namespace_id: namespace });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
    createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
  const environmentAt = (at: string) => simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId,
    virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "accommodation-actual-cow", checked_at: snapshot.captured_at });
  return { ...accommodationServices(database), database, namespace,
    run: <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(snapshot.captured_at), fn),
    runAt: <T>(at: string, fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(at), fn) };
}

describe.skipIf(!enabled || !target)("Accommodation in actual selected COW worlds", () => {
  it("keeps offers, accepted plans, reported occupancy and actual key custody separate in one branch", async () => {
    const f = await createAccommodationFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    let roomId = "", stayId = "", futureId = "", keyId = "";
    const end = after(f.now, 1), extensionEnd = after(f.now, 2), late = after(f.now, 3);
    try {
      await f.run(async () => {
        expect((await readAccommodationReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("needs_rooms");
        const space = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Fictional temporary room",
          code: `TEMP-${randomUUID().slice(0, 8)}`, kind: "residential_room" }, resourceLoanRequest(f.user));
        const type = await f.accommodation.saveRoomType(f.user, f.schoolId, { ...command(0), name: "Single temporary room",
          default_capacity: 1, allocation_mode: "whole_room" });
        const room = await f.accommodation.saveRoom(f.user, f.schoolId, { ...command(0), space_id: space.id,
          room_type_id: type.id, sleeping_capacity: 1, allocation_mode: "whole_room" });
        roomId = room.id;
        expect((await readAccommodationReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("ready_to_offer");
        const key = await f.resources.createItem(f.user, f.schoolId, { command_id: randomUUID(), campus_id: f.campusId,
          name: "Fictional temporary room key", asset_tag: `KEY-${randomUUID().slice(0, 8)}` }, resourceLoanRequest(f.user));
        keyId = key.id;
        const offered = await f.accommodation.offer(f.user, f.schoolId, { ...command(0), resident_person_id: f.borrowerPersonId,
          coordinator_person_id: f.custodianPersonId, recorder_person_id: f.custodianPersonId, room_id: roomId,
          starts_at: f.now, ends_at: end, instructions: "Private fictional access instructions", access_mode: "tracked_required" });
        stayId = offered.id;
        expect((await readAccommodationReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("offer_recorded");
        // Adjacent half-open plans are not a double booking. Neither is occupancy.
        futureId = (await f.accommodation.offer(f.user, f.schoolId, { ...command(0), resident_person_id: f.custodianPersonId,
          coordinator_person_id: f.custodianPersonId, recorder_person_id: f.custodianPersonId, room_id: roomId,
          starts_at: end, ends_at: extensionEnd, access_mode: "no_tracked_item" })).id;
      });
      const snapshot = await store.capture(f.schoolId, f.now);
      for (const name of ["accommodation_room_types", "accommodation_rooms", "accommodation_places", "accommodation_stays",
        "accommodation_receipts", "accommodation_setup_receipts", "accommodation_access_loans"]) expect(snapshot.counts).toHaveProperty(name);
      expect(snapshot.counts.accommodation_stays).toBe(2);
      const world = await openWorld(store, snapshot, f.schoolId); opened.push(world.database);
      const sibling = await openWorld(store, snapshot, f.schoolId); opened.push(sibling.database);
      let revision = 1, loanId = "";
      await world.run(async () => {
        // Inspect the functions actually installed in this captured branch,
        // not merely the source text of the Live migration. Both authority
        // helpers must resolve the same selected clock as domain operations.
        const clockHelpers = (await sql<{ person_helper: string; recipient_helper: string }>`SELECT
          pg_get_functiondef('accommodation_person_available(uuid,uuid)'::regprocedure) AS person_helper,
          pg_get_functiondef('accommodation_event_recipient_valid(uuid,jsonb,uuid)'::regprocedure) AS recipient_helper`
          .execute(world.database)).rows[0]!;
        expect(clockHelpers.person_helper).toContain("simulation_now");
        expect(clockHelpers.recipient_helper).toContain("simulation_now");
        const before = (await world.accommodation.work(f.borrower, f.schoolId)).needs_me.find(item => item.stay_id === stayId)!;
        expect(before).toMatchObject({ action: "respond", revision: 1, due_at: null });
        expect(before.message_id).toBeTruthy();
        await expect(world.accommodation.act(f.user, f.schoolId, stayId, { ...command(revision), action: "accept" })).rejects.toThrow();
        const accept = { ...command(revision), action: "accept" };
        revision = (await world.accommodation.act(f.borrower, f.schoolId, stayId, accept)).revision;
        expect(await world.accommodation.act(f.borrower, f.schoolId, stayId, accept)).toMatchObject({ revision, state: "accepted" });
        await expect(world.accommodation.act(f.borrower, f.schoolId, stayId, { ...accept, note: "Changed retry commitment" })).rejects.toThrow();
        expect(await world.accommodation.detail(f.borrower, f.schoolId, stayId)).toMatchObject({ state: "accepted", actual_move_in_at: null, access_settled: false });
        expect((await readAccommodationReadiness(world.database, world.core, f.borrower, f.schoolId)).operation)
          .toMatchObject({ state: "arrangement_recorded", environment_namespace_id: world.namespace, scope: { kind: "stay", id: stayId } });
        expect(await resolveAccommodationContinuation(world.database, world.core, f.borrower, f.schoolId,
          `/areas/accommodation?stay_id=${stayId}`)).not.toBeNull();
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId,
          { ...command(revision), action: "move_in", observed_at: f.now, method: "in_person" })).revision;
        expect((await world.accommodation.work(f.user, f.schoolId)).needs_me.find(item => item.stay_id === stayId)).toBeUndefined();
        expect((await world.accommodation.work(f.borrower, f.schoolId)).waiting.find(item => item.stay_id === stayId)).toBeUndefined();
        expect(await world.accommodation.detail(f.user, f.schoolId, stayId)).toMatchObject({
          allowed_actions: { move_out: true }, actual_move_out_at: null,
        });
        const issue = { ...command(0), holding_id: keyId, borrower_person_id: f.borrowerPersonId, due_at: end,
          custody_confirmed: true, custody_purpose: "Fictional temporary room access" };
        const loan = await world.resources.issue(f.user, f.schoolId, issue); loanId = loan.id;
        expect(await world.resources.issue(f.user, f.schoolId, issue)).toMatchObject({ id: loanId, revision: 1 });
        const link = { ...command(revision), loan_id: loanId, return_required: true };
        revision = (await world.accommodation.linkAccess(f.user, f.schoolId, stayId, link)).revision;
        expect(await world.accommodation.linkAccess(f.user, f.schoolId, stayId, link)).toMatchObject({ revision });
        await expect(world.accommodation.act(f.user, f.schoolId, stayId,
          { ...command(revision), action: "extend", ends_at: extensionEnd, note: "Fictional repair took longer" })).rejects.toThrow();
        await world.accommodation.act(f.user, f.schoolId, futureId,
          { ...command(1), action: "cancel", note: "Future resident chose another place" });
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId,
          { ...command(revision), action: "extend", ends_at: extensionEnd, note: "Fictional repair took longer" })).revision;
        expect((await world.accommodation.work(f.borrower, f.schoolId)).needs_me.find(item => item.stay_id === stayId))
          .toMatchObject({ action: "respond", revision, due_at: null });
        revision = (await world.accommodation.act(f.borrower, f.schoolId, stayId,
          { ...command(revision), action: "decline_extension" })).revision;
        expect(await world.accommodation.detail(f.borrower, f.schoolId, stayId)).toMatchObject({ state: "accepted", planned_ends_at: end,
          proposed_ends_at: null, actual_move_in_at: f.now, actual_move_out_at: null });
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId,
          { ...command(revision), action: "extend", ends_at: extensionEnd, note: "Resident reviewed a new alternative" })).revision;
        revision = (await world.accommodation.act(f.borrower, f.schoolId, stayId,
          { ...command(revision), action: "accept_extension" })).revision;
      });
      await world.runAt(late, async () => {
        expect((await sql<{ instant: Date }>`SELECT now() AS instant`.execute(world.database)).rows[0]!.instant.toISOString()).toBe(late);
        expect(await world.accommodation.detail(f.borrower, f.schoolId, stayId)).toMatchObject({ state: "accepted", overstayed: true,
          planned_ends_at: extensionEnd, actual_move_out_at: null, access_settled: false });
        expect((await world.accommodation.work(f.user, f.schoolId)).needs_me.find(item => item.stay_id === stayId))
          .toMatchObject({ action: "review_end", due_at: null, detail: "Fictional temporary room" });
        await expect(world.accommodation.offer(f.user, f.schoolId, { ...command(0), resident_person_id: f.custodianPersonId,
          coordinator_person_id: f.custodianPersonId, recorder_person_id: f.custodianPersonId, room_id: roomId,
          starts_at: late, ends_at: after(late, 1), access_mode: "no_tracked_item" })).rejects.toThrow();
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId, { ...command(revision), action: "move_out",
          observed_at: late, method: "in_person", destination_note: "Fictional original room after separate checks" })).revision;
        const departed = await world.accommodation.detail(f.user, f.schoolId, stayId);
        const departureReceipt = departed.history.find(receipt => receipt.action === "moved_out")!;
        expect(departureReceipt.id).toBeTruthy();
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId, { ...command(revision), action: "correct_move",
          movement: "move_out", retract: true, supersedes_receipt_id: departureReceipt.id,
          note: "Wrong departure recorded; resident has not actually left" })).revision;
        const restored = await world.accommodation.detail(f.borrower, f.schoolId, stayId);
        expect(restored).toMatchObject({ state: "accepted", actual_move_in_at: f.now, actual_move_out_at: null,
          overstayed: true, planned_ends_at: extensionEnd, access_settled: false });
        expect(restored.history[0]).toMatchObject({ action: "movement_corrected", movement_kind: "move_out",
          movement_retracted: true, supersedes_receipt_id: departureReceipt.id });
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId, { ...command(revision), action: "move_out",
          observed_at: late, method: "in_person", destination_note: "Fictional original room after actual departure" })).revision;
        await expect(world.accommodation.act(f.user, f.schoolId, stayId, { ...command(revision), action: "close" })).rejects.toThrow();
        let loan = await world.resources.detail(f.user, f.schoolId, loanId);
        loan = await world.resources.recordReturn(f.user, f.schoolId, loanId, { ...command(loan.revision), observed_at: late,
          parts: [{ part_id: loan.parts[0]!.id, quantity: 1, condition: "usable" }] });
        expect(loan).toMatchObject({ state: "returned", outstanding_count: 0 });
        expect(await world.accommodation.detail(f.user, f.schoolId, stayId)).toMatchObject({ access_settled: true });
        expect((await world.accommodation.work(f.user, f.schoolId)).needs_me.find(item => item.stay_id === stayId)?.action).not.toBe("return_access");
        const close = { ...command(revision), action: "close" };
        revision = (await world.accommodation.act(f.user, f.schoolId, stayId, close)).revision;
        expect(await world.accommodation.act(f.user, f.schoolId, stayId, close)).toMatchObject({ state: "closed", revision });
        expect((await world.accommodation.work(f.user, f.schoolId)).needs_me.find(item => item.stay_id === stayId)).toBeUndefined();
        expect((await world.accommodation.work(f.borrower, f.schoolId)).waiting.find(item => item.stay_id === stayId)).toBeUndefined();
        const grants = await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_agent_authorities
          WHERE school_id=${f.schoolId}::uuid AND grant_source='approved_coordination_policy' AND revoked_at IS NULL
            AND constraints->>'source_domain'='accommodation' AND constraints->>'source_record_id'=${stayId}`.execute(world.database);
        expect(grants.rows[0]!.count).toBe(0);
        const updates = await world.database.selectFrom("event_outbox").select("payload").where("school_id", "=", f.schoolId)
          .where("event_type", "=", "accommodation.updated").execute();
        expect(updates.length).toBeGreaterThan(0);
        expect(JSON.stringify(updates)).not.toMatch(/Private fictional|resident_person_id|instructions|actual_move|destination_note/u);
      });
      const unchanged = async (services: ReturnType<typeof accommodationServices>) => {
        expect(await services.accommodation.detail(f.borrower, f.schoolId, stayId)).toMatchObject({ state: "offered", revision: 1,
          planned_ends_at: end, actual_move_in_at: null, actual_move_out_at: null });
        expect(await services.accommodation.detail(f.user, f.schoolId, futureId)).toMatchObject({ state: "offered", revision: 1 });
        expect(await services.db.selectFrom("resource_loans").select("id").where("school_id", "=", f.schoolId)
          .where("holding_id", "=", keyId).execute()).toHaveLength(0);
      };
      await f.run(() => unchanged(f));
      await sibling.run(() => unchanged(sibling));
      expect(await db.selectFrom("accommodation_receipts").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(2);
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);

  it("uses native direct allocation and reasoned end changes in one branch without resident-consent or Live effects", async () => {
    const f = await createAccommodationFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    let roomId = "";
    try {
      await f.run(async () => {
        const space = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
          name: "Fictional direct-allocation room", code: `DIRECT-${randomUUID().slice(0, 8)}`, kind: "residential_room" }, resourceLoanRequest(f.user));
        const type = await f.accommodation.saveRoomType(f.user, f.schoolId, { ...command(0), name: "Fictional direct single",
          default_capacity: 1, allocation_mode: "whole_room" });
        roomId = (await f.accommodation.saveRoom(f.user, f.schoolId, { ...command(0), space_id: space.id,
          room_type_id: type.id, sleeping_capacity: 1, allocation_mode: "whole_room" })).id;
      });
      const snapshot = await store.capture(f.schoolId, f.now), world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
      opened.push(world.database, sibling.database);
      const allocate = { ...command(0), arrangement_basis: "coordinator_allocation", resident_person_id: f.borrowerPersonId,
        coordinator_person_id: f.custodianPersonId, recorder_person_id: f.custodianPersonId, room_id: roomId,
        starts_at: f.now, ends_at: after(f.now, 1), access_mode: "no_tracked_item" };
      await world.run(async () => {
        let stay = await world.accommodation.offer(f.user, f.schoolId, allocate);
        expect(stay).toMatchObject({ state: "accepted", arrangement_basis: "coordinator_allocation", revision: 1,
          accepted_at: f.now, actual_move_in_at: null, history: [{ action: "allocated", response: null, observed_at: null }] });
        expect(await world.accommodation.offer(f.user, f.schoolId, allocate)).toMatchObject({ id: stay.id, revision: 1 });
        await expect(world.accommodation.offer(f.user, f.schoolId, { ...allocate, arrangement_basis: "resident_offer" })).rejects.toThrow();
        expect((await world.accommodation.work(f.borrower, f.schoolId)).needs_me).toEqual([]);
        expect((await readAccommodationReadiness(world.database, world.core, f.user, f.schoolId)).operation)
          .toMatchObject({ state: "arrangement_recorded", environment_namespace_id: world.namespace });
        stay = await world.accommodation.act(f.user, f.schoolId, stay.id, { ...command(1), action: "move_in", observed_at: f.now, method: "in_person" });
        expect(await world.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
        const change = { ...command(stay.revision), action: "change_end", ends_at: after(f.now, 2), note: "Coordinator approved revised planned end" };
        stay = await world.accommodation.act(f.user, f.schoolId, stay.id, change);
        expect(await world.accommodation.act(f.user, f.schoolId, stay.id, change)).toMatchObject({ id: stay.id, revision: 3 });
        expect(stay).toMatchObject({ planned_ends_at: after(f.now, 2), proposed_ends_at: null, actual_move_in_at: f.now,
          actual_move_out_at: null });
        if (!("history" in stay)) throw new Error("The exact coordinator must retain stay access.");
        expect(stay.history[0]).toMatchObject({ action: "end_changed", response: null });
        expect(await world.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
        expect((await world.database.selectFrom("accommodation_receipts").select(["action", "arrangement_basis", "response"])
          .where("school_id", "=", f.schoolId).orderBy("revision").execute())).toEqual([
          { action: "allocated", arrangement_basis: "coordinator_allocation", response: null },
          { action: "moved_in", arrangement_basis: "coordinator_allocation", response: null },
          { action: "end_changed", arrangement_basis: "coordinator_allocation", response: null },
        ]);
      });
      const empty = async (database: DatabaseService) => expect(await database.selectFrom("accommodation_stays").select("id")
        .where("school_id", "=", f.schoolId).execute()).toEqual([]);
      await f.run(() => empty(db));
      await sibling.run(() => empty(sibling.database));
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
