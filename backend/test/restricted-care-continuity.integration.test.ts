import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { createRestrictedCareContinuityFixture } from "./restricted-care-continuity.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/restricted_care_unused_test";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy()); afterEach(() => vi.restoreAllMocks());
const fixture = () => createRestrictedCareContinuityFixture(database);

describe.runIf(enabled)("restricted care exact intake and confidential continuity", () => {
  it("recovers a committed lost response exactly once, refuses changed intent and keeps protected content out of Core/outbox", async () => {
    const f = await fixture(), input = f.intake();
    // The real native transaction commits; only its caller's response is lost.
    await expect(f.run(async () => { await f.service.openCase(f.reporter, f.schoolId, input); throw new Error("Injected response loss after commit"); })).rejects.toThrow(/after commit/);
    const confirmed = await f.run(() => f.service.confirm(f.reporter, f.schoolId, input.command_id));
    expect(confirmed).toMatchObject({ state: "accepted", result: { id: input.command_id, revision: 1 } });
    const retried = await f.run(() => f.service.openCase(f.reporter, f.schoolId, input));
    expect(retried).toMatchObject({ id: input.command_id, revision: 1 });
    expect(await database.selectFrom("restricted_care_cases").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(1);
    expect(await database.selectFrom("restricted_care_case_entries").select("id").where("case_id", "=", input.command_id).execute()).toHaveLength(1);
    await expect(f.run(() => f.service.openCase(f.reporter, f.schoolId, { ...input, details: `${input.details} Changed.` }))).rejects.toThrow(/different protected work/);
    const core = await sql`SELECT command.safe_context,outcome.metadata FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id WHERE command.school_id=${f.schoolId}::uuid AND command.source_domain='restricted_care'`.execute(database);
    const events = await database.selectFrom("event_outbox").select(["payload", "notification_payload"]).where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify({ core: core.rows, events })).not.toContain(input.details);
    expect(core.rows).toHaveLength(1); expect((core.rows[0] as any).metadata).toEqual({ case_id: input.command_id, receipt_id: retried.receipt_id });
    expect((await f.run(() => f.service.caseDetail(f.reporter, f.schoolId, input.command_id))).access.access_level).toBe("intake_only");
    await expect(f.run(() => f.service.caseDetail(f.admin, f.schoolId, input.command_id))).rejects.toThrow(/not found/);
    await database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.reporter.id).execute();
    await expect(f.run(() => f.service.confirm(f.reporter, f.schoolId, input.command_id))).rejects.toThrow(/Active staff/);
  });

  it("hands over exact confidential access, retains reporter receipt, preserves team revocation semantics and rejects stale/revoked successors", async () => {
    const f = await fixture(), input = f.intake(), opened = await f.run(() => f.service.openCase(f.owner, f.schoolId, input));
    const primary = await database.selectFrom("restricted_care_role_assignments").selectAll().where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).where("role_kind", "=", "designated_lead").executeTakeFirstOrThrow();
    await f.run(() => f.service.revokeTeamMember(f.admin, f.schoolId, primary.id, { expected_revision: primary.revision, reason: "Synthetic intake rota changed; existing case remains assigned." }));
    expect((await f.run(() => f.service.caseDetail(f.owner, f.schoolId, opened.id))).access.access_level).toBe("full");
    expect((await f.run(() => f.service.orphanedCases(f.admin, f.schoolId))).total).toBe(0);
    const handover = { command_id: randomUUID(), expected_revision: opened.revision, action: "reassign", owner_user_id: f.successor.id, note: "Synthetic confidential handover note remains encrypted in its owning care record." };
    const accepted = await f.run(() => f.service.act(f.owner, f.schoolId, opened.id, handover));
    expect(accepted.revision).toBe(2);
    expect((await f.run(() => f.service.caseDetail(f.owner, f.schoolId, opened.id))).access.access_level).toBe("intake_only");
    expect((await f.run(() => f.service.caseDetail(f.successor, f.schoolId, opened.id))).entries.some(entry => entry.note === handover.note)).toBe(true);
    expect(await f.run(() => f.service.act(f.owner, f.schoolId, opened.id, handover))).toEqual(accepted);
    await expect(f.run(() => f.service.act(f.successor, f.schoolId, opened.id, { command_id: randomUUID(), action: "add_entry", expected_revision: 1, entry_type: "case_note", note: "Synthetic stale source note." }))).rejects.toMatchObject({ response: { code: "care_command_refused", fields: { care_command_refused: { reason: "stream_advanced", receipt_state: "absent" } } } });
    await expect(f.run(() => f.service.act(f.successor, f.schoolId, opened.id, { ...handover, command_id: randomUUID(), expected_revision: 2, owner_user_id: f.alternate.id }))).rejects.toMatchObject({ response: { code: "care_command_refused" } });
    const assigned = await database.selectFrom("restricted_care_case_assignments").selectAll().where("case_id", "=", opened.id).where("revoked_at", "is", null).execute();
    expect(assigned.filter(row => row.assignment_role === "owner")).toHaveLength(1);
    expect(JSON.stringify(assigned)).not.toContain(handover.note);
  });

  it("recovers a departed owner without exposing protected content to administrators; list is finite and exact", async () => {
    const f = await fixture();
    for (let index = 0; index < 11; index++) await f.run(() => f.service.openCase(f.reporter, f.schoolId, f.intake()));
    await database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
    const first = await f.run(() => f.service.orphanedCases(f.admin, f.schoolId)), second = await f.run(() => f.service.orphanedCases(f.admin, f.schoolId, 2));
    expect(first).toMatchObject({ total: 11, pages: 2, page: 1 }); expect(first.cases).toHaveLength(10); expect(second.cases).toHaveLength(1);
    const item = second.cases[0]!;
    expect(Object.keys(item).sort()).toEqual(["candidates", "id", "intake_route", "owner_name", "revision"]);
    await expect(f.run(() => f.service.orphanedCases(f.reporter, f.schoolId))).rejects.toThrow(/administrator/);
    const input = { command_id: randomUUID(), expected_revision: item.revision, owner_user_id: f.successor.id, note: "Synthetic routing-only recovery after original responsible staff departed." };
    const accepted = await f.run(() => f.service.recoverOwner(f.admin, f.schoolId, item.id, input));
    expect(await f.run(() => f.service.recoverOwner(f.admin, f.schoolId, item.id, input))).toEqual(accepted);
    await expect(f.run(() => f.service.caseDetail(f.admin, f.schoolId, item.id))).rejects.toThrow(/not found/);
    expect((await f.run(() => f.service.caseDetail(f.successor, f.schoolId, item.id))).access.assignment_role).toBe("owner");
    const event = await database.selectFrom("event_outbox").select(["audience_user_ids", "notification_user_ids"]).where("aggregate_id", "=", item.id).where("event_type", "=", "restricted_care.case.recovered").executeTakeFirstOrThrow();
    expect(event.audience_user_ids).not.toContain(f.owner.id); expect(event.notification_user_ids).not.toContain(f.admin.id);
    await expect(database.updateTable("restricted_care_case_assignments").set({ user_id: f.alternate.id }).where("case_id", "=", item.id).where("revoked_at", "is not", null).execute()).rejects.toThrow(/subject cannot be changed/);
  }, 60_000);

  it("retains an actual past reporting time separately from recording time and rejects future reports", async () => {
    const f = await fixture(), opened = await f.run(() => f.service.openCase(f.reporter, f.schoolId, f.intake()));
    expect(await f.run(() => f.service.discovery(f.owner, f.schoolId))).toEqual({ can_report: true, can_manage_team: true, has_assignments: true });
    expect(await f.run(() => f.service.discovery(f.reporter, f.schoolId))).toEqual({ can_report: true, can_manage_team: false, has_assignments: true });
    const reportedAt = new Date(Date.parse(f.now) - 86_400_000).toISOString();
    const input = { command_id: randomUUID(), action: "external_report", expected_revision: 1, authority_type: "local_police", reported_at: reportedAt, reference: "Synthetic private prior-day reference" };
    await expect(f.run(() => f.service.act(f.owner, f.schoolId, opened.id, { ...input, reported_at: new Date(Date.parse(f.now) + 60000).toISOString() }))).rejects.toThrow(/cannot be later/);
    await f.run(() => f.service.act(f.owner, f.schoolId, opened.id, input));
    const detail = await f.run(() => f.service.caseDetail(f.owner, f.schoolId, opened.id));
    expect(new Date(detail.external_reports[0]!.reported_at).toISOString()).toBe(reportedAt);
    expect(new Date(detail.external_reports[0]!.created_at).toISOString()).toBe(f.now);
    expect(JSON.stringify(await database.selectFrom("event_outbox").selectAll().where("aggregate_id", "=", opened.id).execute())).not.toContain(input.reference);
  });

  it("requires current canonical endpoints for handlers, actors, intake routing and orphan recovery", async () => {
    const f = await fixture(), opened = await f.run(() => f.service.openCase(f.reporter, f.schoolId, f.intake()));
    const close = async (userId: string) => f.run(() => database.transaction().execute(async tx => {
      const core = f.services(database).kernel, identity = await core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: userId, at: f.now });
      if (!identity.acting) throw new Error("Synthetic endpoint must initially be active.");
      return core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: identity.endpoint_id, actor_user_id: f.admin.id, expected_revision: 1, effective_at: f.now,
        disposition: "revoked", reason: "Synthetic canonical app access ended for continuity regression.", source_domain: "staff_operations", source_record_id: userId, source_revision: 1, idempotency_key: `care-test-close:${userId}` });
    }));
    await close(f.successor.id);
    expect((await f.run(() => f.service.caseDetail(f.owner, f.schoolId, opened.id))).handover_candidates.map(item => item.id)).not.toContain(f.successor.id);
    expect((await f.run(() => f.service.workspace(f.admin, f.schoolId))).candidates.map(item => item.id)).not.toContain(f.successor.id);
    await expect(f.run(() => f.service.act(f.owner, f.schoolId, opened.id, { command_id: randomUUID(), action: "reassign", expected_revision: 1, owner_user_id: f.successor.id, note: "Synthetic handover must refuse an endpoint-revoked successor." }))).rejects.toMatchObject({ response: { code: "care_command_refused" } });
    await f.run(() => f.service.assignTeamMember(f.admin, f.schoolId, { user_id: f.admin.id, role_kind: "deputy_lead", route_kind: "primary", valid_from: f.now.slice(0, 10), valid_until: null }));
    await close(f.owner.id);
    expect((await database.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).executeTakeFirstOrThrow()).is_active).toBe(true);
    await expect(f.run(() => f.service.caseDetail(f.owner, f.schoolId, opened.id))).rejects.toThrow(/Active staff/);
    await expect(f.run(() => f.service.workspace(f.owner, f.schoolId))).rejects.toThrow(/Active staff/);
    expect(await f.run(() => f.service.discovery(f.owner, f.schoolId))).toEqual({ can_report: false, can_manage_team: false, has_assignments: false });
    await expect(f.run(() => f.service.confirm(f.owner, f.schoolId, randomUUID()))).rejects.toThrow(/Active staff/);
    expect((await f.run(() => f.service.orphanedCases(f.admin, f.schoolId))).cases.map(item => item.id)).toContain(opened.id);
    const next = await f.run(() => f.service.openCase(f.reporter, f.schoolId, f.intake()));
    expect((await database.selectFrom("restricted_care_cases").select("owner_user_id").where("id", "=", next.id).executeTakeFirstOrThrow()).owner_user_id).toBe(f.admin.id);
    await f.run(() => f.service.recoverOwner(f.admin, f.schoolId, opened.id, { command_id: randomUUID(), expected_revision: 1, owner_user_id: f.admin.id, note: "Synthetic explicit routing recovery to a separately configured eligible lead." }));
    expect((await f.run(() => f.service.caseDetail(f.admin, f.schoolId, opened.id))).access.assignment_role).toBe("owner");
  });

  it("serializes two confidential handovers and does not confuse identical new narratives with retry identity", async () => {
    const f = await fixture(), input = f.intake(), first = await f.run(() => f.service.openCase(f.reporter, f.schoolId, input));
    expect((await f.run(() => f.service.openCase(f.reporter, f.schoolId, { ...input, command_id: randomUUID() }))).id).not.toBe(first.id);
    const inputAction = { action: "reassign", expected_revision: 1, owner_user_id: f.successor.id, note: "Synthetic explicit confidential handover for concurrent request testing." };
    const results = await Promise.allSettled([f.run(() => f.service.act(f.owner, f.schoolId, first.id, { ...inputAction, command_id: randomUUID() })), f.run(() => f.service.act(f.owner, f.schoolId, first.id, { ...inputAction, command_id: randomUUID() }))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await database.selectFrom("restricted_care_case_entries").select("id").where("case_id", "=", first.id).where("entry_type", "=", "handover").execute()).toHaveLength(1);
  });

  it.runIf(Boolean(process.env.RESTRICTED_CARE_SIMULATION_TEST_TARGET_URL))("uses real COW commands for new private intake and same-route recovery without changing Live or sibling; captured narratives remain omitted", async () => {
    const f = await fixture(), original = await f.run(() => f.service.openCase(f.reporter, f.schoolId, f.intake()));
    const before = await database.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", f.schoolId).execute();
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(process.env.RESTRICTED_CARE_SIMULATION_TEST_TARGET_URL), 4), opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: value => compiler.createIntrospector(value) } }) as DatabaseService;
        opened.push(db); const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "restricted-care-continuity", checked_at: f.now });
        return { db, service: f.services(db).service, run: <T>(work: () => Promise<T>) => f.scope.run(environment, () => executionEnvironmentStorage.run(environment, work)) };
      };
      const world = await open(), sibling = await open(), input = f.intake({ details: "Synthetic new branch-only protected note. It must never be copied back into Live or another branch." });
      await world.run(async () => {
        expect(await world.service.caseDetail(f.owner, f.schoolId, original.id)).toMatchObject({ entries: [], source_content_omitted: true });
        const accepted = await world.service.openCase(f.reporter, f.schoolId, input);
        expect(await world.service.discovery(f.owner, f.schoolId)).toEqual({ can_report: true, can_manage_team: true, has_assignments: true });
        expect((await world.service.caseDetail(f.owner, f.schoolId, accepted.id)).entries[0]!.note).toBe(input.details);
        expect(await world.service.openCase(f.reporter, f.schoolId, input)).toEqual(accepted);
        await world.db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).execute();
        expect(await world.service.discovery(f.owner, f.schoolId)).toEqual({ can_report: false, can_manage_team: false, has_assignments: false });
        const recovery = { command_id: randomUUID(), expected_revision: 1, owner_user_id: f.successor.id, note: "Synthetic branch-only responsibility restoration; not a real safeguarding decision." };
        await world.service.recoverOwner(f.admin, f.schoolId, accepted.id, recovery);
        expect((await world.service.caseDetail(f.successor, f.schoolId, accepted.id)).access.assignment_role).toBe("owner");
        expect(await world.service.confirm(f.admin, f.schoolId, recovery.command_id)).toMatchObject({ state: "accepted", result: { id: accepted.id, revision: 2 } });
      });
      expect(await database.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", f.schoolId).execute()).toEqual(before);
      expect((await database.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId).where("user_id", "=", f.owner.id).executeTakeFirstOrThrow()).is_active).toBe(true);
      expect(await f.run(() => f.service.discovery(f.owner, f.schoolId))).toEqual({ can_report: true, can_manage_team: true, has_assignments: true });
      await sibling.run(async () => {
        expect(await sibling.db.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", f.schoolId).execute()).toEqual(before);
        expect((await sibling.service.confirm(f.reporter, f.schoolId, input.command_id)).state).toBe("not_found");
      });
    } finally { await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 120_000);
});
