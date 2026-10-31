import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { CompiledQuery, Kysely, PostgresDialect, sql, type DatabaseConnection, type Driver, type TransactionSettings } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { CampusModelObservation, CampusTemporalContextQuery } from "../src/campus-model-core/contracts.js";
import type { CampusTemporalAssertion } from "../src/campus-model-core/temporal-context.port.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEMPORAL_BATCH_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/temporal_batch_unused_test";
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.TEMPORAL_BATCH_TEST_TARGET_URL) : "postgresql://invalid.invalid/temporal_batch_target_unused_test";
const labels = new AsyncLocalStorage<string>();
type Subject = CampusTemporalContextQuery["subject"];
type QueryEvent = { label: string; pid: number; sql: string };

/** Observe native loans, and optionally pause before production SQL on a real
 * PostgreSQL advisory barrier. The tested SQL and its results are unchanged. */
class ObservedDriver implements Driver {
  readonly trace: QueryEvent[] = [];
  active = 0;
  peak = 0;
  acquisitions = 0;
  before = async (_event: QueryEvent, _connection: DatabaseConnection) => {};
  private readonly owners = new WeakMap<DatabaseConnection, DatabaseConnection>();
  constructor(private readonly native: Driver) {}
  init() { return this.native.init(); }
  async acquireConnection() {
    const native = await this.native.acquireConnection();
    const pid = (await native.executeQuery<{ pid: number }>(CompiledQuery.raw("SELECT pg_backend_pid() AS pid"))).rows[0]!.pid;
    this.acquisitions += 1;
    this.active += 1; this.peak = Math.max(this.peak, this.active);
    const wrapped: DatabaseConnection = {
      executeQuery: async <R>(query: CompiledQuery) => {
        const event = { label: labels.getStore() ?? "ordinary", pid, sql: query.sql };
        this.trace.push(event);
        await this.before(event, native);
        return native.executeQuery<R>(query);
      },
      streamQuery: (query, chunk) => native.streamQuery(query, chunk),
    };
    this.owners.set(wrapped, native);
    return wrapped;
  }
  private owner(connection: DatabaseConnection) {
    const native = this.owners.get(connection);
    if (!native) throw new Error("Unknown owned temporal test loan.");
    return native;
  }
  beginTransaction(connection: DatabaseConnection, settings: TransactionSettings) { return this.native.beginTransaction(this.owner(connection), settings); }
  commitTransaction(connection: DatabaseConnection) { return this.native.commitTransaction(this.owner(connection)); }
  rollbackTransaction(connection: DatabaseConnection) { return this.native.rollbackTransaction(this.owner(connection)); }
  async releaseConnection(connection: DatabaseConnection) {
    const native = this.owner(connection); this.owners.delete(connection);
    try { await this.native.releaseConnection(native); } finally { this.active -= 1; }
  }
  destroy() { return this.native.destroy(); }
}

function observedDatabase(native: Driver, dialect: PostgresDialect) {
  const driver = new ObservedDriver(native);
  const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => dialect.createAdapter(),
    createQueryCompiler: () => dialect.createQueryCompiler(), createIntrospector: candidate => dialect.createIntrospector(candidate) } });
  return { db, driver, core: new CampusModelCoreService(db as DatabaseService, new ExecutionDataPlaneScope()) };
}
const sourcePool = new Pool({ connectionString: sourceUrl, max: 3, connectionTimeoutMillis: 2_000,
  application_name: "temporal-batch-owned-source", options: "-c statement_timeout=20000 -c lock_timeout=15000" });
const sourceDialect = new PostgresDialect({ pool: sourcePool });
const source = observedDatabase(sourceDialect.createDriver(), sourceDialect);
let observer: Pool | undefined;
const opened: Kysely<Database>[] = [];
const stores: SimulationSnapshotStore[] = [];

function entity(kind: string, domain: string, domainId: string, label: string) {
  return { kind, domain, domain_id: domainId, label, lifecycle_state: "active" as const, source_revision: 1, metadata: {} };
}
function observationIds(assertions: CampusTemporalAssertion[]) {
  return assertions.filter(item => item.assertion_type === "direct_observation").map(item => item.assertion_id);
}
async function fixture() {
  const id = randomUUID();
  const account = await source.db.insertInto("users").values({ username: `temporal-${id}`, email: `${id}@example.test`,
    password_hash: "unused-synthetic-temporal-test", first_name: "Synthetic", last_name: "Temporal owner", role: "admin" })
    .returning(["id", "email", "first_name", "last_name"]).executeTakeFirstOrThrow();
  const schoolId = await source.db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(source.core).createForAccount(tx, account, "UTC"));
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const instant = (time: string) => `${day}T${time}:00.000Z`;
  let now = instant("09:00");
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const setNow = (time: string) => { now = instant(time); };
  const roomA = entity("room", "campus_topology", randomUUID(), "Room A");
  const roomB = entity("room", "campus_topology", randomUUID(), "Room B");
  const person = entity("person", "people", randomUUID(), "Synthetic participant");
  // A parameter containing SQL-looking text must stay data through the JSON-set
  // relation and Simulation SQL binding, including quotes and backslashes.
  const quoted = entity("room", "campus_topology", `literal:'\"\\ public.campus_model_observations:${randomUUID()}`, "Quoted fixture");
  const classSection = entity("class", "academic_structure", randomUUID(), "Temporal class");
  const subjectEntity = entity("subject", "academic_structure", randomUUID(), "Temporal subject");
  const scheduleId = randomUUID(), periodId = randomUUID();
  const publish = (revision: number, title: string) => run(() => source.db.transaction().execute(tx => source.core.recordPublishedSchedule(tx, {
    school_id: schoolId, actor_user_id: account.id, schedule_version_id: scheduleId, schedule_revision: revision,
    starts_on: day, ends_on: day, timezone: "UTC", published_at: now, class_section: classSection, correlation_id: randomUUID(), causation_event_id: null,
    periods: [{ period_id: periodId, weekday: new Date(`${day}T12:00:00Z`).getUTCDay() || 7, period_number: 1,
      starts_at: "10:00", ends_at: "11:00", title, slot_type: "class", subject: subjectEntity,
      teacher_user_id: account.id, space: roomA, room_snapshot: roomA.label }],
  })));
  const publication = await publish(1, "Original expected lesson");
  const record = async (marker: string, context: typeof roomA | null, state: CampusModelObservation["state"], observed: string, received: string,
    kind = "test.temporal_point", target = person) => run(async () => {
    const reference = randomUUID();
    const ids = await source.db.transaction().execute(tx => source.core.recordObservations(tx, [{
      school_id: schoolId, actor_user_id: account.id, kind, subject: target, context,
      source_type: "test.temporal", source_ref: reference, source_record_id: reference,
      observed_at: instant(observed), received_at: instant(received), evidence_refs: [], payload: { marker }, schema_version: 1,
      state, idempotency_key: `temporal-test:${reference}`, domain_event_id: null,
    }]));
    return { id: ids[0]!, reference, marker };
  });
  const acceptedA = await record("accepted at A", roomA, "accepted", "10:01", "10:02");
  const pendingB = await record("pending at B", roomB, "pending", "10:03", "10:04");
  const rejectedA = await record("rejected newer A", roomA, "rejected", "10:05", "10:06");
  const quarantined = await record("quarantined", roomA, "quarantined", "10:02", "10:03", "test.quarantine");
  const noContext = await record("no context", null, "accepted", "10:04", "10:05", "test.no_context");
  const late = await record("received too late", roomA, "accepted", "10:01", "10:19", "test.late");
  const future = await record("observed in future", roomA, "accepted", "11:00", "10:02", "test.future");
  const quotedPoint = await record("quoted parameter", null, "accepted", "10:02", "10:03", "test.quoted", quoted);
  const tieA = await record("tie A", roomA, "pending", "10:10", "10:11", "test.tie");
  const tieB = await record("tie B", roomA, "accepted", "10:10", "10:11", "test.tie");
  const stateTie = await record("same timestamp state transition", roomA, "pending", "10:01", "10:02", "test.state_tie");
  setNow("10:02");
  await run(() => source.db.transaction().execute(tx => source.core.transitionObservations(tx, {
    school_id: schoolId, source_type: "test.temporal", source_ref: stateTie.reference, state: "accepted",
  })));
  // Retained evidence whose first known reconciliation state begins after its
  // receipt. The owning immutable-history trigger records that actual boundary.
  const unknownId = (await sql<{ id: string }>`INSERT INTO campus_model_observations(
      school_id,realm_id,environment_namespace_id,kind,subject_entity_id,context_entity_id,captured_by_agent_id,
      source_type,source_ref,source_record_id,observed_at,received_at,state,state_recorded_at,idempotency_key,request_hash,payload)
    SELECT school_id,realm_id,environment_namespace_id,'test.missing_history',subject_entity_id,context_entity_id,captured_by_agent_id,
      'test.temporal',${randomUUID()},${randomUUID()},${instant("10:07")}::timestamptz,${instant("10:08")}::timestamptz,
      'accepted',${instant("10:20")}::timestamptz,${randomUUID()},${"a".repeat(64)},'{"marker":"retained unknown"}'::jsonb
    FROM campus_model_observations WHERE id=${acceptedA.id}::uuid RETURNING id`.execute(source.db)).rows[0]!.id;
  setNow("10:15");
  const entitySubject = (value: typeof roomA): Subject => ({ type: "entity", domain: value.domain, domain_id: value.domain_id });
  const subjects: Subject[] = [entitySubject(roomA), entitySubject(roomB), entitySubject(person),
    { type: "human_agent", user_id: account.id }, { type: "human_agent", user_id: randomUUID() },
    { type: "entity", domain: "campus_topology", domain_id: randomUUID() }, entitySubject(roomA), entitySubject(quoted),
    entitySubject(classSection), entitySubject(subjectEntity), { type: "entity", domain: "timetable", domain_id: scheduleId }];
  const query = { school_id: schoolId, at: instant("10:15"), recorded_as_of: instant("10:15"), subjects };
  return { schoolId, account, day, instant, run, setNow, roomA, roomB, person, scheduleId, subjects, query, publish, publication,
    acceptedA, pendingB, rejectedA, quarantined, noContext, late, future, quotedPoint, tieA, tieB, stateTie, unknownId };
}

describe.runIf(enabled)("batched temporal assertions against PostgreSQL17 and native Simulation COW", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.EVENT_DATABASE_URL) {
      throw new Error("All source test owners must address the exact disposable target.");
    }
    const sourceName = process.env.TEMPORAL_BATCH_EXPECT_DATABASE;
    const targetName = process.env.TEMPORAL_BATCH_EXPECT_TARGET_DATABASE;
    if (!sourceName || !/^temporal_batch_test_\d{8}_[a-f0-9]{8}$/u.test(sourceName)
      || !targetName || !/^temporal_batch_target_test_\d{8}_[a-f0-9]{8}$/u.test(targetName)) {
      throw new Error("Explicit owned source and Simulation temporal test database names are required.");
    }
    observer = new Pool({ connectionString: targetUrl, max: 2, application_name: "temporal-batch-owned-observer" });
    for (const [pool, expected] of [[sourcePool, sourceName], [observer, targetName]] as const) {
      const current = (await pool.query<{ name: string; version: number }>("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0]!;
      expect(current.name).toBe(expected); expect(current.version).toBeGreaterThanOrEqual(170000); expect(current.version).toBeLessThan(180000);
    }
  });
  afterAll(async () => {
    await Promise.all(opened.map(db => db.destroy()));
    await Promise.all(stores.map(store => store.pool.end()));
    await observer?.end(); await source.db.destroy();
  });

  it("keeps mixed subjects, positional duplicates, absence, source and observation history identical to point reads", async () => {
    const f = await fixture();
    await f.run(async () => {
      const before = source.driver.trace.length;
      const groups = await source.core.resolveAtBatch(f.query);
      expect(source.driver.trace.length - before).toBe(2);
      expect(groups).toHaveLength(f.subjects.length);
      expect(groups).toEqual(await Promise.all(f.subjects.map(subject => source.core.resolveAt({
        school_id: f.schoolId, at: f.query.at, recorded_as_of: f.query.recorded_as_of, subject,
      }))));
      expect(groups[4]).toEqual([]); expect(groups[5]).toEqual([]); expect(groups[6]).toEqual(groups[0]);
      const room = groups[0]!;
      expect(room[0]).toMatchObject({ dimension: "expected", assertion_type: "scheduled_context", certainty: "planned", freshness: "current",
        context: { title: "Original expected lesson", period_number: 1 }, source: { event_id: f.publication.event_id,
          source_record_id: f.scheduleId, source_revision: 1, change: { event_id: f.publication.event_id, change_kind: "published" }, condition: null } });
      expect(groups[3]).toHaveLength(1); expect(groups[3]![0]).toMatchObject({ assertion_type: "scheduled_context", subject: { type: "human_agent" } });
      for (const index of [8, 9, 10]) expect(groups[index]![0]).toMatchObject({ dimension: "expected", context: { title: "Original expected lesson" } });
      expect(observationIds(room)).toContain(f.acceptedA.id); expect(observationIds(room)).not.toContain(f.pendingB.id);
      expect(observationIds(groups[1]!)).toEqual([f.pendingB.id]);
      // The person query sees the latest eligible point across both contexts;
      // each room query independently selects its latest eligible point.
      expect(groups[2]!.find(item => item.assertion_type === "direct_observation" && item.observation.kind === "test.temporal_point")?.assertion_id).toBe(f.pendingB.id);
      expect(observationIds(groups[2]!)).toContain(f.noContext.id); expect(observationIds(room)).not.toContain(f.noContext.id);
      expect(room.find(item => item.assertion_id === f.unknownId)).toMatchObject({ dimension: "observed", certainty: "unverified",
        observation: { state: "unknown", state_recorded_at: null, state_basis: "history_unavailable" } });
      expect(room.find(item => item.assertion_id === f.quarantined.id)).toMatchObject({ dimension: "observed", certainty: "unverified", observation: { state: "quarantined" } });
      expect(room.find(item => item.assertion_id === f.stateTie.id)).toMatchObject({ dimension: "accepted", observation: { state: "accepted", state_basis: "domain_transition" } });
      expect(room.find(item => item.assertion_type === "direct_observation" && item.observation.kind === "test.tie")?.assertion_id).toBe([f.tieA.id, f.tieB.id].sort().at(-1));
      for (const excluded of [f.rejectedA.id, f.late.id, f.future.id]) expect(observationIds(room)).not.toContain(excluded);
      expect(observationIds(groups[7]!)).toEqual([f.quotedPoint.id]);
      const points = room.filter(item => item.assertion_type === "direct_observation");
      expect(points.map(item => item.observation.kind)).toEqual([...points.map(item => item.observation.kind)].sort());
      expect(await source.core.resolveAtBatch({ school_id: f.schoolId, at: f.query.at, subjects: f.subjects })).toEqual(groups);
      const count = source.driver.trace.length;
      expect(await source.core.resolveAtBatch({ ...f.query, subjects: [] })).toEqual([]);
      await expect(source.core.resolveAtBatch({ ...f.query, subjects: Array.from({ length: 65 }, () => f.subjects[0]!) })).rejects.toThrow();
      await expect(source.core.resolveAtBatch({ ...f.query, recorded_as_of: null } as never)).rejects.toThrow();
      await expect(source.core.resolveAtBatch({ ...f.query, school_id: randomUUID() })).rejects.toThrow("another operational realm");
      expect(source.driver.trace.length).toBe(count);
      const maximum = await source.core.resolveAtBatch({ ...f.query, subjects: Array.from({ length: 64 }, () => f.subjects[5]!) });
      expect(maximum).toEqual(Array.from({ length: 64 }, () => []));
      f.setNow("10:16");
      await source.db.transaction().execute(tx => source.core.transitionObservations(tx, { school_id: f.schoolId,
        source_type: "test.temporal", source_ref: f.acceptedA.reference, state: "superseded" }));
      expect(await source.core.resolveAtBatch(f.query)).toEqual(groups);
      const later = await source.core.resolveAtBatch({ ...f.query, recorded_as_of: f.instant("10:17") });
      expect(observationIds(later[0]!)).not.toContain(f.acceptedA.id);
      // Valid-time intervals remain half open, independently of recorded time.
      expect((await source.core.resolveAtBatch({ ...f.query, at: f.instant("11:00") }))[3]).toEqual([]);
    });
  }, 60_000);

  it("returns the exact retained plan revision at its recorded boundary", async () => {
    const f = await fixture();
    const boundary = async (eventId: string) => (await sql<{ at: string }>`SELECT
      to_char(recorded_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM campus_model_schedule_occurrences WHERE school_id=${f.schoolId}::uuid AND basis_event_id=${eventId}::uuid`.execute(source.db)).rows[0]!.at;
    const firstCutoff = await boundary(f.publication.event_id);
    const replacement = await f.publish(2, "Revised expected lesson");
    const secondCutoff = await boundary(replacement.event_id);
    await f.run(async () => {
      const before = await source.core.resolveAtBatch({ ...f.query, recorded_as_of: firstCutoff });
      const after = await source.core.resolveAtBatch({ ...f.query, recorded_as_of: secondCutoff });
      for (const index of [0, 3, 6, 8, 9, 10]) {
        expect(before[index]).toEqual([expect.objectContaining({ context: expect.objectContaining({ title: "Original expected lesson" }),
          source: expect.objectContaining({ event_id: f.publication.event_id, source_revision: 1 }) })]);
        expect(after[index]).toEqual([expect.objectContaining({ context: expect.objectContaining({ title: "Revised expected lesson" }),
          source: expect.objectContaining({ event_id: replacement.event_id, source_revision: 2 }) })]);
        expect(before[index]![0]!.assertion_id).not.toBe(after[index]![0]!.assertion_id);
      }
    });
  }, 60_000);

  it("routes JSON-set reads through two captured COW worlds and leaves a third native pool loan available", async () => {
    const f = await fixture();
    const baseline = await f.run(() => source.core.resolveAtBatch(f.query));
    const store = new SimulationSnapshotStore(sourceUrl, targetUrl, 3); stores.push(store);
    const snapshot = await store.capture(f.schoolId, f.query.recorded_as_of);
    const open = async () => {
      const runId = randomUUID(), scenarioId = randomUUID();
      const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId,
        scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
      const dialect = new PostgresDialect({ pool: store.pool });
      const current = observedDatabase(new SimulationBranchDriver(store.pool, branch, snapshot), dialect); opened.push(current.db);
      const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
        virtual_now: f.instant("10:16"), source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "temporal-batch-owned-test", checked_at: f.instant("10:16") });
      return { ...current, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
    };
    const first = await open(), sibling = await open();
    for (const current of [first, sibling]) expect(await current.run(() => current.core.resolveAtBatch(f.query))).toEqual(baseline);
    // Quantify native driver work at the observed campus size. Repeated known
    // and missing entities also check positional reconstruction across chunks;
    // fixed meaningful evidence expectations are asserted in the first case.
    const entitySubjects = f.subjects.filter(subject => subject.type === "entity");
    const largeSubjects = Array.from({ length: 217 }, (_, index) => entitySubjects[index % entitySubjects.length]!);
    const pointStart = { loans: first.driver.acquisitions, queries: first.driver.trace.length };
    const scalar: CampusTemporalAssertion[][] = [];
    for (const subject of largeSubjects) scalar.push(await first.run(() => first.core.resolveAt({
      school_id: f.schoolId, at: f.query.at, recorded_as_of: f.query.recorded_as_of, subject,
    })));
    const pointWork = { loans: first.driver.acquisitions - pointStart.loans, queries: first.driver.trace.length - pointStart.queries };
    const batchStart = { loans: first.driver.acquisitions, queries: first.driver.trace.length };
    const batched: CampusTemporalAssertion[][] = [];
    for (let offset = 0; offset < largeSubjects.length; offset += 64) batched.push(...await first.run(() => first.core.resolveAtBatch({
      ...f.query, subjects: largeSubjects.slice(offset, offset + 64),
    })));
    const batchWork = { loans: first.driver.acquisitions - batchStart.loans, queries: first.driver.trace.length - batchStart.queries };
    expect(scalar).toHaveLength(217); expect(batched).toEqual(scalar);
    expect(pointWork).toEqual({ loans: 434, queries: 434 });
    expect(batchWork).toEqual({ loans: 8, queries: 8 });
    console.info("TEMPORAL_BATCH_PG_WORK_RECEIPT", JSON.stringify({ requested_positions: 217, batch_bound: 64,
      point_reads: pointWork, batched_reads: batchWork, same_result_and_order: true, native_simulation_driver: true }));
    f.setNow("10:16");
    await f.run(() => source.db.transaction().execute(tx => source.core.transitionObservations(tx, { school_id: f.schoolId,
      source_type: "test.temporal", source_ref: f.acceptedA.reference, state: "superseded" })));
    await first.run(() => first.db.transaction().execute(tx => first.core.transitionObservations(tx, { school_id: f.schoolId,
      source_type: "test.temporal", source_ref: f.pendingB.reference, state: "accepted" })));
    const query = { ...f.query, recorded_as_of: f.instant("10:17") };
    const changed = await first.run(() => first.core.resolveAtBatch(query));
    const unchanged = await sibling.run(() => sibling.core.resolveAtBatch(query));
    const live = await f.run(() => source.core.resolveAtBatch(query));
    expect(changed[1]![0]).toMatchObject({ assertion_id: f.pendingB.id, dimension: "accepted", observation: { state: "accepted" } });
    expect(unchanged[1]![0]).toMatchObject({ assertion_id: f.pendingB.id, dimension: "observed", observation: { state: "pending" } });
    expect(live[1]![0]).toMatchObject({ assertion_id: f.pendingB.id, dimension: "observed", observation: { state: "pending" } });
    expect(observationIds(changed[0]!)).toContain(f.acceptedA.id); expect(observationIds(unchanged[0]!)).toContain(f.acceptedA.id);
    expect(observationIds(live[0]!)).not.toContain(f.acceptedA.id);
    expect(await first.run(() => first.core.resolveAtBatch(f.query))).toEqual(baseline);
    // A directly bound bigint avoids the driver's deliberate hashtextextended
    // namespace remapping: both owned branches must wait on this one test gate.
    const key = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 15)}`).toString();
    const blocker = await observer!.connect();
    const gatePids = new Set<number>(), gatedLabels = new Set<string>();
    const gate = async (event: QueryEvent, connection: DatabaseConnection) => {
      if (!event.label.startsWith("capacity-") || gatedLabels.has(event.label)) return;
      gatedLabels.add(event.label); gatePids.add(event.pid);
      await connection.executeQuery(CompiledQuery.raw("SELECT pg_advisory_lock_shared($1::bigint)", [key]));
      await connection.executeQuery(CompiledQuery.raw("SELECT pg_advisory_unlock_shared($1::bigint)", [key]));
    };
    first.driver.before = gate; sibling.driver.before = gate; first.driver.peak = 0; sibling.driver.peak = 0;
    let calls: Promise<CampusTemporalAssertion[][]>[] = [];
    try {
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [key]);
      calls = [labels.run("capacity-first", () => first.run(() => first.core.resolveAtBatch(query))),
        labels.run("capacity-sibling", () => sibling.run(() => sibling.core.resolveAtBatch(query)))];
      for (const call of calls) void call.catch(() => undefined);
      const until = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < until) {
        if (gatePids.size === 2) {
          const state = await blocker.query<{ blocked: number }>("SELECT count(*)::int AS blocked FROM unnest($1::int[]) pid WHERE cardinality(pg_blocking_pids(pid))>0", [[...gatePids]]);
          if (state.rows[0]?.blocked === 2) { blocked = true; break; }
        }
        await setTimeout(10); // Observe PostgreSQL wait state; time does not choose the schedule.
      }
      expect(blocked).toBe(true);
      expect(first.driver.active + sibling.driver.active).toBe(2);
      // Same store.pool, same native BranchDriver: this must finish while both
      // temporal reads still hold real server-blocked loans.
      expect(await first.run(async () => (await sql<{ school_id: string; state: string }>`SELECT school_id::text,
        state FROM campus_model_observations WHERE id=${f.pendingB.id}::uuid`.execute(first.db)).rows[0])).toEqual({ school_id: f.schoolId, state: "accepted" });
      expect(first.driver.active + sibling.driver.active).toBe(2);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [key]); blocker.release();
      first.driver.before = async () => {}; sibling.driver.before = async () => {};
      await Promise.allSettled(calls);
    }
    expect(await calls[0]).toEqual(changed); expect(await calls[1]).toEqual(unchanged);
    expect(first.driver.active + sibling.driver.active).toBe(0);
    expect(await f.run(() => source.core.resolveAtBatch(query))).toEqual(live);
  }, 180_000);
});
