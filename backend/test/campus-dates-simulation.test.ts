import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { executionRealtimeBinding, type ExecutionRealtimeBinding } from "../src/school/execution-realtime.js";
import { createCampusDatesFixture } from "./campus-dates.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/campus_dates_simulation_unused_test";
const target = process.env.CAMPUS_DATES_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 4 }) }) }) as DatabaseService;
afterAll(() => db.destroy());

function replayProbe(service: SchoolEventService, binding: ExecutionRealtimeBinding, userId: string) {
  const frames: string[] = [];
  const client = { id: randomUUID(), userId, sessionHash: "fixture-replay-no-auth-credential", binding,
    reply: { raw: { destroyed: false, writableEnded: false, write: (frame: string) => { frames.push(frame); return true; }, end() {}, destroy() {} } },
    lastSequence: 0, replaying: false, replayOverflow: false, pendingEvents: new Map(), closed: false };
  const publisher = service as unknown as { publishPendingInSelectedEnvironment(health: boolean): Promise<void>; replay(selected: typeof client, after: number): Promise<void> };
  return { frames, client, publisher, replay: () => publisher.replay(client, 0) };
}

describe.skipIf(!enabled || !target)("Campus Dates through the same owner in actual isolated COW worlds", () => {
  it("preserves term-linked public plans while branch-only correction, publication, cancellation and identity loss never change Live or a sibling", async () => {
    const f = await createCampusDatesFixture(db);
    const term = await db.insertInto("academic_terms").values({ school_id: f.schoolId, academic_year: "2026-27",
      name: "Fictional retained academic period", starts_on: "2026-08-11", ends_on: "2026-12-31",
      is_active: true, attendance_threshold: "0", updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    const originalBody = f.input({ title: "Fictional final assessment information window", starts_on: "2026-11-25", ends_on: "2026-12-04",
      academic_term_id: term.id, provenance: { fixture_key: "campus-dates-cow-window", source_note: "Fictional plans only; exact sittings stay in Assessments." } });
    const original = await f.run(() => f.service.publish(f.owner, f.schoolId, originalBody));
    const currentRows = (store: DatabaseService) => store.selectFrom("campus_dates").selectAll().where("school_id", "=", f.schoolId).orderBy("id").execute();
    const historyRows = (store: DatabaseService) => store.selectFrom("campus_date_revisions").selectAll().where("school_id", "=", f.schoolId).orderBy("date_id").orderBy("revision").execute();
    const before = await currentRows(db), historyBefore = await historyRows(db);
    const structuralState = async (store: DatabaseService) => ({
      periods: await store.selectFrom("academic_terms").selectAll().where("school_id", "=", f.schoolId).orderBy("id").execute(),
      operatingOverrides: await store.selectFrom("school_calendar_days").selectAll().where("school_id", "=", f.schoolId).orderBy("date").execute(),
      assessmentIds: await store.selectFrom("assessments").select("id").where("school_id", "=", f.schoolId).orderBy("id").execute(),
      spaces: await store.selectFrom("campus_spaces").select(["id", "revision"]).where("school_id", "=", f.schoolId).orderBy("id").execute(),
    });
    const structureBefore = await structuralState(db);
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 4), opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      expect(snapshot.counts.campus_dates).toBe(1);
      expect(snapshot.counts.campus_date_revisions).toBe(1);
      const capturedDates = snapshot.catalogue.tables.find(table => table.name === "campus_dates")!;
      const capturedHistory = snapshot.catalogue.tables.find(table => table.name === "campus_date_revisions")!;
      expect(capturedDates.foreign_keys.some(key => key.referenced_table === "academic_terms")).toBe(true);
      expect(capturedDates.trigger_functions).toContain("campus_date_revision_required");
      expect(capturedHistory.trigger_functions).toContain("campus_date_history_immutable");

      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const virtualNow = new Date(Date.parse(f.now) + 15 * 60_000).toISOString();
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: virtualNow, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "campus-dates-actual-cow", checked_at: f.now });
        return { db: database, ...f.services(database), namespace, virtualNow, environment,
          run: <T>(work: () => Promise<T>) => f.scope.run(environment, () => executionEnvironmentStorage.run(environment, work)) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        expect((await world.service.list(f.member, f.schoolId, { from: "2026-11-01", until: "2026-11-30" })).items).toEqual([original]);
        const fields = { title: originalBody.title, description: originalBody.description, category_label: originalBody.category_label,
          starts_on: originalBody.starts_on, ends_on: originalBody.ends_on };
        const correction = { ...fields, idempotency_key: randomUUID(), expected_revision: 1, starts_on: "2026-11-26", ends_on: "2026-12-05",
          reason: "Fictional branch-only planning window correction; exact examinations remain unchanged." };
        const revised = await world.service.correct(f.owner, f.schoolId, original.id, correction);
        expect(revised).toMatchObject({ starts_on: correction.starts_on, ends_on: correction.ends_on, academic_term_id: term.id,
          provenance: originalBody.provenance, revision: 2, updated_at: world.virtualNow });
        expect(await world.service.correct(f.owner, f.schoolId, original.id, correction)).toEqual(revised);
        await expect(world.service.correct(f.owner, f.schoolId, original.id, { ...correction, reason: "Changed retry intent" })).rejects.toThrow(/different campus-date/);
        await expect(world.service.correct(f.owner, f.schoolId, original.id, { ...correction, idempotency_key: randomUUID() })).rejects.toThrow(/latest revision/);
        await expect(world.service.publish(f.staff, f.schoolId, f.input())).rejects.toThrow(/Institution-scoped/);

        const branchBody = f.input({ title: "Fictional branch-only programme information", starts_on: "2026-12-08", ends_on: "2026-12-10", academic_term_id: term.id });
        const branchOnly = await world.service.publish(f.owner, f.schoolId, branchBody);
        expect(await world.service.publish(f.owner, f.schoolId, branchBody)).toEqual(branchOnly);
        const cancellation = { idempotency_key: randomUUID(), expected_revision: 2, reason: "Fictional updated programme replaces this branch planning window." };
        const cancelled = await world.service.cancel(f.owner, f.schoolId, original.id, cancellation);
        expect(cancelled).toMatchObject({ state: "cancelled", revision: 3, cancellation_reason: cancellation.reason });
        expect(await world.service.cancel(f.owner, f.schoolId, original.id, cancellation)).toEqual(cancelled);
        expect(await world.service.publish(f.owner, f.schoolId, originalBody)).toEqual(original);
        expect(await world.service.correct(f.owner, f.schoolId, original.id, correction)).toEqual(revised);
        expect((await world.service.list(f.member, f.schoolId, { from: "2026-12-01", until: "2026-12-31" })).items)
          .toEqual([cancelled, branchOnly]);

        const retained = await historyRows(world.db);
        expect(retained.filter(row => row.date_id === original.id).map(row => row.action)).toEqual(["published", "corrected", "cancelled"]);
        expect(retained.find(row => row.date_id === original.id && row.revision === 1)).toEqual(historyBefore[0]);
        await expect(world.db.updateTable("campus_date_revisions").set({ reason: "Attempted rewrite" }).where("date_id", "=", original.id).execute()).rejects.toThrow(/immutable/);
        await expect(world.db.deleteFrom("campus_dates").where("id", "=", branchOnly.id).execute()).rejects.toThrow(/history/);
        await expect(sql`TRUNCATE campus_date_revisions`.execute(world.db)).rejects.toThrow(/immutable/);

        const traces = await sql<{ namespace: string; state: string; actor_mode: string; source_snapshot_ref: string; requested_at: Date }>`
          SELECT command.environment_namespace_id AS namespace,command.state,binding.actor_mode,snapshot.source_snapshot_ref,command.requested_at
          FROM campus_model_commands command JOIN campus_model_authority_receipts authority ON authority.id=command.authority_receipt_id
          JOIN campus_model_execution_actor_bindings binding ON binding.execution_actor_id=authority.execution_actor_id
            AND binding.source_agent_id=command.actor_agent_id AND binding.environment_namespace_id=command.environment_namespace_id
          JOIN campus_model_execution_snapshots snapshot ON snapshot.id=binding.snapshot_id
          WHERE command.school_id=${f.schoolId}::uuid AND command.source_domain='campus_dates'
            AND command.requested_at>${f.now}::timestamptz`.execute(world.db);
        expect(traces.rows).toHaveLength(3);
        expect(traces.rows.every(row => row.namespace === world.namespace && row.state === "accepted" && row.actor_mode === "simulation_counterpart"
          && row.source_snapshot_ref === `sha256:${snapshot.content_hash}` && row.requested_at.toISOString() === world.virtualNow)).toBe(true);
        expect(await structuralState(world.db)).toEqual(structureBefore);

        const envelopes = await world.db.selectFrom("event_outbox").selectAll().where("school_id", "=", f.schoolId)
          .where("event_type", "like", "campus_dates.%").execute();
        expect(envelopes).toHaveLength(4);
        expect(envelopes.every(row => row.audience_user_ids.includes(f.member.id) && row.notification_user_ids.length === 0 && row.notification_payload === null)).toBe(true);
        const valid = async (event: typeof envelopes[number], payload: unknown = event.payload, aggregate = event.aggregate_id) =>
          (await sql<{ valid: boolean }>`SELECT event_source_is_valid(${f.schoolId}::uuid,${event.event_type},'campus_date',
            ${aggregate}::uuid,${JSON.stringify(payload)}::jsonb) AS valid`.execute(world.db)).rows[0]!.valid;
        for (const envelope of envelopes) expect(await valid(envelope)).toBe(true);
        const latest = envelopes.find(row => row.event_type === "campus_dates.cancelled")!;
        expect(await valid(latest, { ...(latest.payload as object), revision: 999 })).toBe(false);
        expect(await valid(latest, { ...(latest.payload as object), source_command_id: randomUUID() })).toBe(false);
        expect(await valid(latest, { ...(latest.payload as object), private_note: "Never in a refresh payload" })).toBe(false);
        expect(await valid(latest, latest.payload, randomUUID())).toBe(false);
        expect((await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,${latest.event_type},
          ${JSON.stringify(latest.payload)}::jsonb,${f.member.id}::uuid) AS allowed`.execute(world.db)).rows[0]!.allowed).toBe(true);
        await expect(world.db.updateTable("event_outbox").set({ payload: { ...(latest.payload as object), revision: 999 } })
          .where("id", "=", latest.id).execute()).rejects.toThrow(/immutable/);

        // Exercise the actual ordinary publisher + replay query + final SSE
        // serializer against the branch, without starting workers or a broker.
        // Authentication/real network handshakes remain a separate HTTP gate.
        const eventService = new SchoolEventService(world.db, world.kernel, undefined, f.scope);
        const realtime = replayProbe(eventService, executionRealtimeBinding(world.environment), f.member.id);
        const notificationsBefore = await world.db.selectFrom("notifications").select("id").execute();
        await realtime.publisher.publishPendingInSelectedEnvironment(false);
        await realtime.replay();
        const calendarFrames = realtime.frames.filter(frame => /event: campus_dates\./.test(frame));
        expect(calendarFrames).toHaveLength(4);
        expect(calendarFrames.every(frame => frame.includes(world.namespace) && frame.includes('"refresh":["calendar"]'))).toBe(true);
        expect(calendarFrames.join("\n")).not.toMatch(/Fictional final assessment|source_note|actor_person_id|private_note|description/);
        expect(await world.db.selectFrom("notifications").select("id").execute()).toEqual(notificationsBefore);
        expect((await world.db.selectFrom("event_outbox").select(["published_at", "delivery_sequence"])
          .where("id", "=", latest.id).executeTakeFirstOrThrow()).delivery_sequence).not.toBeNull();
        await expect(realtime.publisher.replay({ ...realtime.client, binding: executionRealtimeBinding(sibling.environment) }, 0))
          .rejects.toThrow(/cannot cross/);

        const endpoint = await world.db.selectFrom("campus_model_agent_endpoints").select(["id", "revision"])
          .where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).where("endpoint_kind", "=", "account").executeTakeFirstOrThrow();
        await world.db.transaction().execute(tx => world.kernel.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: endpoint.id,
          actor_user_id: f.owner.id, expected_revision: endpoint.revision, effective_at: world.virtualNow, disposition: "revoked",
          reason: "Fictional branch-only account endpoint revocation", source_domain: "people", source_record_id: endpoint.id,
          source_revision: 1, idempotency_key: `campus-date-revoke:${randomUUID()}` }));
        await expect(world.service.publish(f.owner, f.schoolId, originalBody)).rejects.toThrow(/linked campus-person/);
        expect((await world.service.detail(f.member, f.schoolId, original.id)).item).toEqual(cancelled);
        await world.db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.member.id).execute();
        await expect(world.service.detail(f.member, f.schoolId, original.id)).rejects.toThrow(/membership/);
        expect((await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,${latest.event_type},
          ${JSON.stringify(latest.payload)}::jsonb,${f.member.id}::uuid) AS allowed`.execute(world.db)).rows[0]!.allowed).toBe(false);
        const revoked = replayProbe(eventService, executionRealtimeBinding(world.environment), f.member.id);
        await revoked.replay();
        expect(revoked.frames.filter(frame => /event: campus_dates\./.test(frame))).toEqual([]);
      });

      expect(await currentRows(db)).toEqual(before);
      expect(await historyRows(db)).toEqual(historyBefore);
      expect(await structuralState(db)).toEqual(structureBefore);
      await f.run(async () => {
        expect(await f.service.publish(f.owner, f.schoolId, originalBody)).toEqual(original);
        expect((await f.service.detail(f.member, f.schoolId, original.id)).item).toEqual(original);
        expect((await db.selectFrom("event_outbox").select("published_at").where("aggregate_id", "=", original.id).executeTakeFirstOrThrow()).published_at).toBeNull();
        const replay = replayProbe(new SchoolEventService(db, f.services(db).kernel, undefined, f.scope), executionRealtimeBinding(f.environment), f.member.id);
        await replay.replay(); expect(replay.frames.filter(frame => /event: campus_dates\./.test(frame))).toEqual([]);
      });
      await sibling.run(async () => {
        expect(await currentRows(sibling.db)).toEqual(before);
        expect(await historyRows(sibling.db)).toEqual(historyBefore);
        expect(await structuralState(sibling.db)).toEqual(structureBefore);
        expect((await sibling.service.detail(f.member, f.schoolId, original.id)).item).toEqual(original);
        expect((await sibling.db.transaction().execute(tx => sibling.kernel.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: f.owner.id, at: sibling.virtualNow }))).acting).toBe(true);
        const replay = replayProbe(new SchoolEventService(sibling.db, sibling.kernel, undefined, f.scope), executionRealtimeBinding(sibling.environment), f.member.id);
        await replay.replay(); expect(replay.frames.filter(frame => /event: campus_dates\./.test(frame))).toEqual([]);
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
