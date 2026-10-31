import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { HumanAgentIdentityPort } from "../src/campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { Database } from "../src/database/types.js";
import { VisitArrangementsService } from "../src/gate/visit-arrangements.service.js";
import { academicScaffoldingCounts } from "./learning-offerings.test-support.js";
import { createResourceLoanFixture, resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/visitor_arrangements_unused_test";
const target = process.env.VISIT_ARRANGEMENTS_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
const command = (expected_revision: number) => ({ command_id: randomUUID(), expected_revision });
const later = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

function visits(database: DatabaseService) {
  const core = new CampusModelCoreService(database, new ExecutionDataPlaneScope());
  return { core, visits: new VisitArrangementsService(database, core, core, core, core, core) };
}

async function fixture() {
  const f = await createResourceLoanFixture(db), services = visits(db);
  const place = await f.run(() => f.topology.createSpace(f.user, f.schoolId, {
    campus_id: f.campusId, name: "Fictional reception room", code: `VISIT-${randomUUID().slice(0, 8)}`, kind: "other",
  }, resourceLoanRequest(f.user)));
  if (typeof place.id !== "string") throw new Error("A visit needs its exact canonical campus place.");
  const contact = await db.selectFrom("school_people").select(["id", "revision"]).where("id", "=", f.borrowerPersonId).executeTakeFirstOrThrow();
  const person = await db.selectFrom("school_people").select(["id", "revision"]).where("id", "=", f.custodianPersonId).executeTakeFirstOrThrow();
  const input = (overrides: Record<string, unknown> = {}) => ({
    ...command(0), person_id: null, person_revision: null, guest_name: "Fictional Hillview school group",
    party_size: 12, title: "Fictional campus tour", starts_at: f.now, ends_at: later(f.now, 60),
    place_id: place.id, contact_person_id: contact.id, contact_revision: contact.revision, ...overrides,
  });
  return { ...f, ...services, placeId: place.id, contact, person, input };
}

async function identityCounts(database: DatabaseService, school: string) {
  return (await sql<{ people: number; endpoints: number; agents: number }>`SELECT
    (SELECT count(*)::int FROM school_people WHERE school_id=${school}::uuid) people,
    (SELECT count(*)::int FROM campus_model_agent_endpoints WHERE school_id=${school}::uuid) endpoints,
    (SELECT count(*)::int FROM campus_model_agents WHERE school_id=${school}::uuid) agents`.execute(database)).rows[0]!;
}

async function openWorld(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, school: string) {
  const scenario = randomUUID(), run = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: school, scenario_id: scenario, namespace_id: namespace });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
    createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
  const environmentAt = (at: string) => simulationRequestEnvironment({ institution_id: school, scenario_id: scenario, run_id: run,
    virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "visitor-arrangements-actual-cow", checked_at: snapshot.captured_at });
  return { ...visits(database), database, namespace,
    run: <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(snapshot.captured_at), fn),
    runAt: <T>(at: string, fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(at), fn) };
}

describe.skipIf(!enabled)("Arranged visits remain separate from identity, authority and observed movement", () => {
  it("saves a provisional group directly without accounts, individual rosters, arrivals or academic setup", async () => {
    const f = await fixture(), before = await identityCounts(db, f.schoolId), input = f.input();
    const topology = () => db.selectFrom("campus_model_entities").select(["domain_id", "label", "metadata", "source_revision", "revision"])
      .where("school_id", "=", f.schoolId).where("domain", "=", "campus_topology").orderBy("domain_id").execute();
    const beforeTopology = await topology();
    const saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    expect(saved).toMatchObject({ id: input.command_id, revision: 1 });
    expect((await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit).toEqual(saved);
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, { ...input, party_size: 13 }))).rejects.toThrow();
    const detail = await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id));
    expect(detail.visit).toMatchObject({ state: "confirmed", person: null, guest_name: input.guest_name, party_size: 12, last_movement: null,
      place: { id: f.placeId }, contact: { id: f.contact.id } });
    expect(detail).toMatchObject({ can_edit: true, can_cancel: true, can_record_arrival: true, can_record_exit: true });
    expect(await identityCounts(db, f.schoolId)).toEqual(before);
    expect(await topology()).toEqual(beforeTopology);
    expect(await db.selectFrom("campus_model_schedule_occurrences").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
    expect(await db.selectFrom("campus_model_observations").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    expect(await f.run(() => f.visits.confirmation(f.user, f.schoolId, saved.id, input.command_id))).toMatchObject({ state: "accepted" });
    expect(await f.run(() => f.visits.confirmation(f.user, f.schoolId, saved.id, randomUUID()))).toMatchObject({ state: "not_found" });
  }, 60_000);

  it("retains an explicit entire-campus destination, exact history and replay without creating a synthetic room", async () => {
    const f = await fixture(),foreign=await fixture();
    const before = await db.selectFrom('campus_spaces').select('id').where('school_id','=',f.schoolId).execute();
    const topology=()=>db.selectFrom('campus_model_entities').select(['domain_id','kind','label','metadata','source_revision','revision']).where('school_id','=',f.schoolId).where('domain','=','campus_topology').orderBy('domain_id').execute();
    const beforeTopology=await topology();
    const input=f.input({place_id:null,campus_id:f.campusId});
    const saved=await f.run(()=>f.visits.create(f.user,f.schoolId,input));
    expect(saved.visit.place).toMatchObject({id:f.campusId,kind:'campus'});
    expect(saved.history[0]).toMatchObject({place_id:null,campus_id:f.campusId,place_label:saved.visit.place.label});
    expect((await f.run(()=>f.visits.create(f.user,f.schoolId,input))).visit).toEqual(saved.visit);
    await expect(f.run(()=>f.visits.create(f.user,f.schoolId,f.input({place_id:null,campus_id:foreign.campusId})))).rejects.toThrow();
    await expect(f.run(()=>f.visits.create(f.user,f.schoolId,f.input({campus_id:f.campusId})))).rejects.toThrow();
    const changed=await f.run(()=>f.visits.update(f.user,f.schoolId,saved.visit.id,f.input({...command(1),place_id:f.placeId,campus_id:null})));
    expect(changed.visit.place.id).toBe(f.placeId);
    expect(changed.history[1]).toMatchObject({place_id:null,campus_id:f.campusId});
    expect(await db.selectFrom('campus_spaces').select('id').where('school_id','=',f.schoolId).execute()).toEqual(before);
    expect(await topology()).toEqual(beforeTopology);
  },60_000);

  it("uses an explicit current Person, never a name match, and refuses stale or foreign identity/place references", async () => {
    const f = await fixture(), foreign = await fixture(), before = await identityCounts(db, f.schoolId);
    const known = f.input({ person_id: f.person.id, person_revision: f.person.revision, guest_name: null, party_size: 1 });
    const saved = (await f.run(() => f.visits.create(f.user, f.schoolId, known))).visit;
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id))).visit.person).toMatchObject({ id: f.person.id });
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ person_id: f.person.id, person_revision: f.person.revision + 1, guest_name: null })))).rejects.toThrow();
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ person_id: foreign.person.id, person_revision: foreign.person.revision, guest_name: null })))).rejects.toThrow();
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ contact_person_id: foreign.contact.id, contact_revision: foreign.contact.revision })))).rejects.toThrow();
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ place_id: foreign.placeId })))).rejects.toThrow();
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ person_id: f.person.id, person_revision: f.person.revision })))).rejects.toThrow();
    expect(await identityCounts(db, f.schoolId)).toEqual(before);
    expect(await db.selectFrom("gate_visit_arrangements").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(1);
    await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(1), direction: "in", observed_count: 2 }));
    await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(2), direction: "out", observed_count: 1 }));
    const knownObservations = await db.selectFrom("campus_model_observations").select("payload")
      .where("school_id", "=", f.schoolId).where("source_type", "=", "gate.arranged_visit").where("source_ref", "=", saved.id).execute();
    expect(knownObservations).toHaveLength(2);
    expect(knownObservations.map(row => row.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "in", observed_count: 2, person_scope: "provisional_party" }),
      expect.objectContaining({ direction: "out", observed_count: 1, person_scope: "named_person" }),
    ]));
  }, 60_000);

  it("does not turn a receiving contact into a manager or gate operator, and rechecks authority before exact retries", async () => {
    const f = await fixture(), input = f.input(), saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    await expect(f.run(() => f.visits.create(f.borrower, f.schoolId, f.input()))).rejects.toThrow();
    await expect(f.run(() => f.visits.update(f.borrower, f.schoolId, saved.id, { ...input, ...command(1) }))).rejects.toThrow();
    await expect(f.run(() => f.visits.movement(f.borrower, f.schoolId, saved.id, { ...command(1), direction: "in", observed_count: 12 }))).rejects.toThrow();
    await expect(f.run(() => f.visits.detail(f.borrower, f.schoolId, saved.id))).rejects.toThrow();
    await expect(f.run(() => f.visits.detail({ ...f.user, active_school_id: randomUUID() }, f.schoolId, saved.id))).rejects.toThrow();
    await db.updateTable("school_memberships").set({ role: "member" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, input))).rejects.toThrow();
    await expect(f.run(() => f.visits.confirmation(f.user, f.schoolId, saved.id, input.command_id))).rejects.toThrow();
    expect(await db.selectFrom("gate_visit_arrangements").select(["revision", "state"]).where("id", "=", saved.id).executeTakeFirstOrThrow()).toEqual({ revision: 1, state: "confirmed" });
  }, 60_000);

  it("retains exact edits, rejects stale races and leaves cancellation distinct from departure", async () => {
    const f = await fixture(), input = f.input(), saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    const update = { ...input, ...command(1), starts_at: later(f.now, 30), ends_at: later(f.now, 120) };
    const revised = await f.run(() => f.visits.update(f.user, f.schoolId, saved.id, update));
    expect(revised.visit).toMatchObject({ id: saved.id, revision: 2 });
    expect(await f.run(() => f.visits.update(f.user, f.schoolId, saved.id, update))).toEqual(revised);
    const versions = await db.selectFrom("gate_visit_arrangement_revisions").selectAll().where("visit_id", "=", saved.id).orderBy("revision").execute();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ revision: 1, action: "arranged", actor_person_id: f.person.id, actor_user_id: f.user.id,
      snapshot: { guest_name: input.guest_name, title: input.title, place_id: f.placeId, contact_person_id: f.contact.id } });
    expect(versions[1]).toMatchObject({ revision: 2, action: "changed", actor_person_id: f.person.id, actor_user_id: f.user.id,
      snapshot: { party_size: input.party_size } });
    const originalSnapshot = versions[0]!.snapshot as Record<string, unknown>, revisedSnapshot = versions[1]!.snapshot as Record<string, unknown>;
    expect(new Date(String(originalSnapshot.starts_at)).toISOString()).toBe(input.starts_at);
    expect(new Date(String(originalSnapshot.ends_at)).toISOString()).toBe(input.ends_at);
    expect(new Date(String(revisedSnapshot.starts_at)).toISOString()).toBe(update.starts_at);
    expect(new Date(String(revisedSnapshot.ends_at)).toISOString()).toBe(update.ends_at);
    await expect(f.run(() => f.visits.update(f.user, f.schoolId, saved.id, { ...update, title: "Changed exact retry" }))).rejects.toThrow();
    await expect(f.run(() => f.visits.update(f.user, f.schoolId, saved.id, { ...input, ...command(1) }))).rejects.toThrow();
    const competitors = await Promise.allSettled(["First new plan", "Second new plan"].map(title =>
      f.run(() => f.visits.update(f.user, f.schoolId, saved.id, { ...update, ...command(2), title }))));
    expect(competitors.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const cancelled = await f.run(() => f.visits.cancel(f.user, f.schoolId, saved.id, command(3)));
    expect(cancelled.visit).toMatchObject({ revision: 4 });
    const detail = await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id));
    expect(detail.visit).toMatchObject({ state: "cancelled", last_movement: null });
    expect(detail).toMatchObject({ can_edit: false, can_cancel: false, can_record_arrival: false, can_record_exit: true });
    expect(await db.selectFrom("campus_model_observations").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    await expect(f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(4), direction: "in", observed_count: 12 }))).rejects.toThrow();
    const departed = await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(4), direction: "out", observed_count: 15 }));
    expect(departed.visit).toMatchObject({ state: "cancelled", last_movement: { direction: "out", observed_count: 15 } });
    expect((await db.selectFrom("campus_model_observations").select("payload").where("school_id", "=", f.schoolId).execute()).map(row => row.payload))
      .toEqual([expect.objectContaining({ direction: "out", observed_count: 15 })]);
  }, 60_000);

  it("records what was actually observed, including departure first and extra guests, without inventing missing arrivals or rewriting counts", async () => {
    const f = await fixture(), input = f.input(), saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    await expect(f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(1), direction: "in", observed_count: 12, occurred_at: later(f.now, 1) }))).rejects.toThrow();
    await expect(f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(1), direction: "in", observed_count: 5001 }))).rejects.toThrow();
    await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(1), direction: "out", observed_count: 12, occurred_at: f.now }));
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id))).visit.last_movement).toMatchObject({ direction: "out", observed_count: 12 });
    const firstOnly = await db.selectFrom("campus_model_observations").select("payload").where("school_id", "=", f.schoolId).execute();
    expect(firstOnly).toHaveLength(1);
    expect(firstOnly[0]!.payload).toMatchObject({ direction: "out", observed_count: 12 });
    const arrival = { ...command(2), direction: "in", observed_count: 13, occurred_at: f.now };
    const arrived = await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, arrival));
    expect(arrived.visit).toMatchObject({ revision: 3, party_size: 12 });
    expect(await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, arrival))).toEqual(arrived);
    await expect(f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...arrival, observed_count: 7 }))).rejects.toThrow();
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id))).visit).toMatchObject({ state: "confirmed",
      last_movement: { direction: "in", observed_count: 13, occurred_at: f.now } });
    const replanned = await f.run(() => f.visits.update(f.user, f.schoolId, saved.id, { ...input, ...command(3), party_size: 8 }));
    expect(replanned.visit).toMatchObject({ revision: 4, party_size: 8, last_movement: { direction: "in", observed_count: 13 } });
    expect(replanned.history.find(row => row.revision === 3)).toMatchObject({ party_size: 12, last_movement: { observed_count: 13 } });
    await expect(f.run(() => f.visits.update(f.user, f.schoolId, saved.id, { ...input, ...command(4), guest_name: "Different party" }))).rejects.toThrow();
    await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(4), direction: "in", observed_count: 4, occurred_at: f.now }));
    const cancel = command(5);
    await f.run(() => f.visits.cancel(f.user, f.schoolId, saved.id, cancel));
    expect((await f.run(() => f.visits.cancel(f.user, f.schoolId, saved.id, cancel))).visit).toMatchObject({ revision: 6 });
    const detail = await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id));
    expect(detail).toMatchObject({ can_record_arrival: false, can_record_exit: true });
    expect(detail.visit).toMatchObject({ state: "cancelled", last_movement: { direction: "in", observed_count: 4 } });
    await f.run(() => f.visits.movement(f.user, f.schoolId, saved.id, { ...command(6), direction: "out", observed_count: 13, occurred_at: f.now }));
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id))).visit).toMatchObject({ state: "cancelled",
      last_movement: { direction: "out", observed_count: 13 } });
    expect(await db.selectFrom("campus_model_observations").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(4);
  }, 60_000);

  it("requires immutable domain versions and exact typed command evidence, without leaking visit details into refreshes or work", async () => {
    const f = await fixture(), input = f.input({ title: "PRIVATE fictional meeting purpose", guest_name: "PRIVATE fictional guest party" });
    const saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    const current = await db.selectFrom("gate_visit_arrangements").selectAll().where("id", "=", saved.id).executeTakeFirstOrThrow();
    await expect(db.updateTable("gate_visit_arrangements").set({ title: "Bypassed source editor" }).where("id", "=", saved.id).execute()).rejects.toThrow();
    await expect(db.updateTable("gate_visit_arrangements").set({ title: "Bypassed source editor", revision: 2 }).where("id", "=", saved.id).execute()).rejects.toThrow();
    await expect(db.updateTable("gate_visit_arrangement_revisions").set({ action: "changed" }).where("visit_id", "=", saved.id).execute()).rejects.toThrow();
    await expect(db.deleteFrom("gate_visit_arrangement_revisions").where("visit_id", "=", saved.id).execute()).rejects.toThrow();
    expect(await db.selectFrom("gate_visit_arrangements").selectAll().where("id", "=", saved.id).executeTakeFirstOrThrow()).toEqual(current);
    const outbox = await db.selectFrom("event_outbox").selectAll().where("aggregate_id", "=", saved.id)
      .where("event_type", "=", "gate.visit_arrangement.updated").execute();
    expect(outbox).toHaveLength(1);
    const envelope = outbox[0]!.payload as Record<string, unknown>;
    expect(envelope).toEqual({ visit_id: saved.id, revision: 1, action: "arranged", source_command_id: current.last_command_id, refresh: ["gate-visits"] });
    expect(outbox[0]!.notification_user_ids).toEqual([]);
    expect(outbox[0]!.audience_user_ids).not.toContain(f.borrower.id);
    for (const malicious of [{ payload: { ...envelope, private_purpose: input.title }, audience_user_ids: [f.user.id] },
      { payload: envelope, audience_user_ids: [f.borrower.id] }]) {
      await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: "gate.visit_arrangement.updated",
        aggregate_type: "gate_visit_arrangement", aggregate_id: saved.id, idempotency_key: randomUUID(), ...malicious }).execute()).rejects.toThrow();
    }
    const events = await db.selectFrom("campus_model_events").select(["payload", "actor_agent_id", "context_entity_id"])
      .where("school_id", "=", f.schoolId).where("source_domain", "=", "gate").execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_agent_id).toBeTruthy();
    expect(events[0]!.context_entity_id).toBeTruthy();
    expect(JSON.stringify(events)).not.toContain("PRIVATE");
    const trace = (await sql<{ status: string; resulting_revision: number; command_type: string; actor_person_id: string }>`SELECT
      outcome.status,outcome.resulting_revision,command.command_type,actor.person_id actor_person_id
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
      WHERE command.id=${current.last_command_id}::uuid`.execute(db)).rows[0];
    expect(trace).toMatchObject({ status: "accepted", resulting_revision: 1, command_type: "gate.visit_arrangement.arranged", actor_person_id: f.person.id });
    expect(await db.selectFrom("campus_model_operational_messages").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    await expect(f.run(() => f.visits.create(f.user, f.schoolId, f.input({ person_id: null, guest_name: null })))).rejects.toThrow();
    const actor = await f.run(() => db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, {
      school_id: f.schoolId, user_id: f.user.id, at: f.now,
    })));
    if (!actor.acting) throw new Error("The native fixture must retain the founder's actual canonical actor.");
    // Deliberately corrupt only the domain identity adapter. The real gateway
    // independently resolves the signing account; the native proof must refuse
    // a source row pretending that a different Person performed that command.
    const mismatchedIdentity = { resolveAccountEndpoint: () => Promise.resolve({ ...actor, person_id: f.borrowerPersonId }) } as unknown as HumanAgentIdentityPort;
    const badAdapter = new VisitArrangementsService(db, mismatchedIdentity, f.core, f.core, f.core, f.core);
    await expect(f.run(() => badAdapter.create(f.user, f.schoolId, f.input()))).rejects.toThrow();
    expect(await db.selectFrom("gate_visit_arrangements").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(1);
  }, 60_000);
});

describe.skipIf(!enabled || !target)("Visitor arrangements through actual selected COW worlds", () => {
  it("creates, changes, records and cancels only one branch, retaining virtual time and unchanged Live and sibling state", async () => {
    const f = await fixture(), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    const input = f.input({ title: "PRIVATE fictional meeting reason" });
    const saved = (await f.run(() => f.visits.create(f.user, f.schoolId, input))).visit;
    const original = await f.run(() => f.visits.detail(f.user, f.schoolId, saved.id));
    const originalIdentity = await identityCounts(db, f.schoolId);
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      expect(snapshot.counts.gate_visit_arrangements).toBe(1);
      const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
      opened.push(world.database, sibling.database);
      const at = later(f.now, 30);
      await world.runAt(at, async () => {
        expect(await world.visits.detail(f.user, f.schoolId, saved.id)).toEqual(original);
        const change = { ...input, ...command(1), title: "PRIVATE revised fictional meeting reason", place_id:null,campus_id:f.campusId, ends_at: later(f.now, 180) };
        const changed = await world.visits.update(f.user, f.schoolId, saved.id, change);
        expect(await world.visits.update(f.user, f.schoolId, saved.id, change)).toEqual(changed);
        expect(changed.visit.place).toMatchObject({id:f.campusId,kind:"campus"});
        expect(changed.history[0]).toMatchObject({place_id:null,campus_id:f.campusId});
        await expect(world.visits.update(f.user, f.schoolId, saved.id, { ...change, title: "Changed exact retry" })).rejects.toThrow();
        expect((await world.visits.detail(f.user, f.schoolId, saved.id)).visit.updated_at).toBe(at);
        const observe = { ...command(2), direction: "out", observed_count: 14 };
        const departure = await world.visits.movement(f.user, f.schoolId, saved.id, observe);
        expect(await world.visits.movement(f.user, f.schoolId, saved.id, observe)).toEqual(departure);
        expect((await world.visits.detail(f.user, f.schoolId, saved.id)).visit.last_movement).toMatchObject({ direction: "out", observed_count: 14, occurred_at: at });
        const replan = await world.visits.update(f.user, f.schoolId, saved.id, { ...change, ...command(3), party_size: 8 });
        expect(replan.visit).toMatchObject({ party_size: 8, last_movement: { direction: "out", observed_count: 14 } });
        expect(replan.history.find(row => row.revision === 3)).toMatchObject({ party_size: 12, last_movement: { direction: "out", observed_count: 14 } });
        await world.visits.cancel(f.user, f.schoolId, saved.id, command(4));
        const newInput = f.input({ title: "PRIVATE scenario-only meeting", guest_name: "Fictional scenario-only party", party_size: 2 });
        const created = await world.visits.create(f.user, f.schoolId, newInput);
        expect(await world.visits.create(f.user, f.schoolId, newInput)).toEqual(created);
        expect(await world.database.selectFrom("gate_visit_arrangements").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(2);
        expect(await identityCounts(world.database, f.schoolId)).toEqual(originalIdentity);
        expect((await world.visits.detail(f.user, f.schoolId, saved.id)).visit).toMatchObject({ revision: 5, state: "cancelled" });
        const observations = await world.database.selectFrom("campus_model_observations").select("payload").where("school_id", "=", f.schoolId).execute();
        expect(observations).toHaveLength(1);
        expect(observations[0]!.payload).toMatchObject({ direction: "out", observed_count: 14, person_scope: "provisional_party" });
        const events = await world.database.selectFrom("campus_model_events").select(["payload", "environment_namespace_id"])
          .where("school_id", "=", f.schoolId).where("environment_namespace_id", "=", world.namespace).execute();
        expect(events.length).toBeGreaterThan(0);
        expect(JSON.stringify(events)).not.toContain("PRIVATE");
        expect(JSON.stringify(events)).not.toContain(newInput.guest_name);
      });
      await f.run(async () => {
        expect(await f.visits.detail(f.user, f.schoolId, saved.id)).toEqual(original);
        expect(await db.selectFrom("gate_visit_arrangements").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(1);
        expect(await db.selectFrom("campus_model_observations").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
      });
      await sibling.run(async () => {
        expect(await sibling.visits.detail(f.user, f.schoolId, saved.id)).toEqual(original);
        expect(await sibling.database.selectFrom("gate_visit_arrangements").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(1);
        expect(await sibling.database.selectFrom("campus_model_observations").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
      });
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
