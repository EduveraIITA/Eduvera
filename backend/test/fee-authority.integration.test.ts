import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { FeeAuthorityService } from "../src/governance/fee-authority.service.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { classPracticeServices } from "./class-practice.test-support.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createFeeAuthorityMandateFixture } from "./fee-authority.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/authority_unused_test";
const targetUrl = process.env.FEE_AUTHORITY_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
async function fixture(conditions: Record<string, unknown> = {}) {
  const f = await createClassPracticeFixture(db);
  const governance = new GovernanceService(db, f.events, f.core);
  const authority = new FeeAuthorityService(db, f.core, f.core, f.core, governance, new CoordinationConfigurationService(f.core), f.core);
  const mandate = await createFeeAuthorityMandateFixture(db, f.core, f.schoolId, f.owner, conditions);
  const input = async () => ({ command_id: randomUUID(), mandate_id: mandate.mandateId, expected: (await authority.workspace(f.owner, f.schoolId)).candidates[0]!.expected, attestation: true });
  return { ...f, ...mandate, governance, authority, input };
}

describe.skipIf(!enabled)("existing Finance authority adoption through real selected-world Core", () => {
  it("confirms only pre-existing power, retains immutable evidence and replays one accepted action", async () => {
    const f = await fixture({ max_amount_inr: 30000 }), input = await f.input();
    expect((await f.authority.workspace(f.owner, f.schoolId, input.command_id)).confirmation).toEqual({ state: "not_found" });
    expect((await f.authority.workspace(f.owner, f.schoolId)).route.state).toBe("missing");
    const before = await db.selectFrom("institution_authority_mandates").selectAll().where("id", "=", f.mandateId).executeTakeFirstOrThrow();
    const accepted = await f.authority.confirm(f.owner, f.schoolId, JSON.parse(JSON.stringify(input)));
    expect((await f.authority.workspace(f.owner, f.schoolId, input.command_id)).confirmation).toMatchObject({ state: "accepted", adoption_id: accepted.adoption_id });
    expect(await f.authority.confirm(f.owner, f.schoolId, input)).toEqual({ ...accepted, replayed: true });
    await expect(f.authority.confirm(f.owner, f.schoolId, { ...input, expected: { ...input.expected, office_revision: 99 } })).rejects.toThrow("different authority");
    const receipt = await db.transaction().execute(tx => f.governance.assertDecisionAuthority(tx, f.schoolId, "fee_instalment_decision", f.owner.id, new Date()));
    expect(receipt.fee_instalment_basis).toMatchObject({ mandate_id: f.mandateId, max_amount_paise: 3_000_000 });
    expect((await f.authority.workspace(f.owner, f.schoolId)).route).toMatchObject({ state: "ready", reviewer: { user_id: f.owner.id } });
    const revision = Number(accepted.revision);
    await expect(f.authority.confirm(f.owner, f.schoolId, { ...input, command_id: randomUUID(), expected: { ...input.expected, rule_revision: revision } }))
      .rejects.toThrow("already confirmed");
    expect(await db.selectFrom("institution_authority_mandates").selectAll().where("id", "=", f.mandateId).executeTakeFirstOrThrow()).toEqual(before);
    expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(1);
    await expect(sql`UPDATE fee_authority_adoptions SET attestation=false WHERE school_id=${f.schoolId}::uuid`.execute(db)).rejects.toThrow();
  });
  it("does not let an administrator confirm someone else's mandate, a stale version or unknown limits", async () => {
    const f = await fixture(), input = await f.input();
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: f.otherTeacher.id, role: "admin" }).execute();
    expect((await f.authority.workspace(f.otherTeacher, f.schoolId, input.command_id)).confirmation).toEqual({ state: "not_found" });
    expect((await f.authority.workspace(f.otherTeacher, f.schoolId)).candidates).toEqual([]);
    expect((await f.authority.workspace(f.otherTeacher, f.schoolId)).other_holders).toEqual([{ name: expect.any(String), office_title: "Finance approvals" }]);
    await expect(f.authority.confirm(f.otherTeacher, f.schoolId, input)).rejects.toThrow("Only the current holder");
    await db.updateTable("institution_authority_mandates").set({ conditions: { max_amount_inr: 5000 } }).where("id", "=", f.mandateId).execute();
    await expect(f.authority.confirm(f.owner, f.schoolId, input)).rejects.toThrow("authority changed");
    await db.updateTable("institution_authority_mandates").set({ conditions: { private_unimplemented_rule: true } }).where("id", "=", f.mandateId).execute();
    expect((await f.authority.workspace(f.owner, f.schoolId)).candidates).toEqual([]);
    await expect(f.authority.confirm(f.owner, f.schoolId, await f.input().catch(() => input))).rejects.toThrow("Only the current holder");
    expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
  });
  it("rechecks mandate and source changes after adoption and rolls back failed outcomes", async () => {
    const f = await fixture(), input = await f.input();
    const failure = vi.spyOn(f.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected authority outcome failure"));
    await expect(f.authority.confirm(f.owner, f.schoolId, input)).rejects.toThrow("Injected authority outcome failure");
    failure.mockRestore();
    expect(await db.selectFrom("institution_decision_matter_rules").select("id").where("school_id", "=", f.schoolId).where("code", "=", "fee_instalment_decision").execute()).toEqual([]);
    await f.authority.confirm(f.owner, f.schoolId, input);
    await db.updateTable("institution_authority_mandates").set({ status: "revoked" }).where("id", "=", f.mandateId).execute();
    await expect(db.transaction().execute(tx => f.governance.resolveDecisionOwner(tx, f.schoolId, "fee_instalment_decision", new Date()))).rejects.toThrow("authority changed");
    await expect(f.authority.confirm(f.owner, f.schoolId, input)).rejects.toThrow("Only the current holder");
  });
  it("repairs explicitly disabled review routing without adopting new power or bumping the rule", async () => {
    const f = await fixture(), first = await f.authority.confirm(f.owner, f.schoolId, await f.input());
    await sql`UPDATE campus_model_behaviour_versions SET status='retired',retired_at=now(),effective_until=GREATEST(now(),effective_from+interval '1 microsecond')
      WHERE school_id=${f.schoolId}::uuid AND behaviour_key='fee_instalment_review'`.execute(db);
    expect((await f.authority.workspace(f.owner, f.schoolId)).route.state).toBe("unavailable");
    const repaired = await f.authority.confirm(f.owner, f.schoolId, await f.input());
    expect(repaired).toEqual({ ...first, replayed: false });
    expect((await f.authority.workspace(f.owner, f.schoolId)).route.state).toBe("ready");
    expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(1);
    expect((await sql`SELECT revision FROM fee_authority_route_approvals WHERE school_id=${f.schoolId}::uuid ORDER BY revision`.execute(db)).rows).toEqual([{ revision: 1 }, { revision: 2 }]);
  });
  it("returns exact current-actor pending and rejected confirmation receipts, not an authorization to repeat", async () => {
    const f = await fixture(), commandId = randomUUID();
    const prepared = await db.transaction().execute(tx => f.core.prepareDomainCommand(tx, { school_id: f.schoolId, actor_user_id: f.owner.id,
      source_domain: "governance", command_type: "governance.fee_authority.confirm", handler_key: "governance.fee_authority", handler_version: 1,
      target: { kind: "finance_authority", domain: "governance", domain_id: f.mandateId, label: "Synthetic pending confirmation", lifecycle_state: "active", source_revision: 1, metadata: {} },
      current_revision: 1, expected_revision: 1, capability: "fees.manage", purpose: "synthetic_pending_confirmation", requested_at: new Date().toISOString(),
      correlation_id: commandId, causation_id: null, idempotency_key: `fee-authority:${f.owner.id}:${commandId}`, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "governance", decision: "allowed", reason_codes: ["synthetic_existing_mandate_fixture"],
        authority_source_refs: [{ mandate_id: f.mandateId }], operating_rule_refs: [], valid_until: null }, safe_context: { payload_hash: "0".repeat(64) } }));
    expect((await f.authority.workspace(f.owner, f.schoolId, commandId)).confirmation).toEqual({ state: "pending" });
    await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: f.otherTeacher.id, role: "admin" }).execute();
    expect((await f.authority.workspace(f.otherTeacher, f.schoolId, commandId)).confirmation).toEqual({ state: "not_found" });
    await db.transaction().execute(tx => f.core.completeDomainCommand(tx, { school_id: f.schoolId, command_id: prepared.command_id,
      terminal_state: "rejected", code: "synthetic_confirmation_rejected", explanation: "The synthetic pending confirmation was rejected without a native effect.",
      resulting_revision: null, domain_event_id: null, metadata: {}, completed_at: new Date().toISOString() }));
    expect((await f.authority.workspace(f.owner, f.schoolId, commandId)).confirmation).toEqual({ state: "not_accepted" });
    expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
  });
  it("blocks identity-ended recovery and authority decisions even while account and membership remain active", async () => {
    const f = await fixture(), input = await f.input();
    await f.authority.confirm(f.owner, f.schoolId, input);
    const endpoint = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString() }));
    if (!endpoint.acting) throw new Error("Expected the fixture's linked owner endpoint.");
    await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: endpoint.endpoint_id,
      actor_user_id: f.owner.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "ended", reason: "Synthetic current identity gate",
      source_domain: "people", source_record_id: endpoint.person_id, source_revision: 1, idempotency_key: `fee-authority-end:${randomUUID()}` }));
    await expect(f.authority.workspace(f.owner, f.schoolId, input.command_id)).rejects.toThrow("person/account link");
    await expect(f.authority.confirm(f.owner, f.schoolId, input)).rejects.toThrow("person/account link");
    await expect(db.transaction().execute(tx => f.governance.resolveDecisionOwner(tx, f.schoolId, "fee_instalment_decision", new Date()))).rejects.toThrow("authority changed");
  });
  it.runIf(Boolean(targetUrl))("reconfirms a changed mandate only inside one COW world, preserving Live and sibling authority", async () => {
    const f = await fixture({ max_amount_inr: 30000 });
    await f.authority.confirm(f.owner, f.schoolId, await f.input());
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(targetUrl), 2), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const context = classPracticeServices(database), governance = new GovernanceService(database, context.events, context.core);
        const authority = new FeeAuthorityService(database, context.core, context.core, context.core, governance, new CoordinationConfigurationService(context.core), context.core);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "fee-authority-test", checked_at: now });
        return { database, namespace, authority, governance, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const world = await open(), sibling = await open(), commandId = randomUUID();
      await world.run(async () => {
        await world.database.updateTable("institution_authority_mandates").set({ conditions: { max_amount_inr: 5000 } }).where("id", "=", f.mandateId).execute();
        expect((await world.authority.workspace(f.owner, f.schoolId)).route.state).toBe("unavailable");
        const candidate = (await world.authority.workspace(f.owner, f.schoolId)).candidates[0]!;
        const accepted = await world.authority.confirm(f.owner, f.schoolId, { command_id: commandId, mandate_id: f.mandateId, expected: candidate.expected, attestation: true });
        expect(accepted.replayed).toBe(false);
        const receipt = await world.database.transaction().execute(tx => world.governance.resolveDecisionOwner(tx, f.schoolId, "fee_instalment_decision", new Date(now)));
        expect(receipt.fee_instalment_basis?.max_amount_paise).toBe(500_000);
        expect((await world.authority.workspace(f.owner, f.schoolId, commandId)).confirmation?.state).toBe("accepted");
        const commands = await world.database.selectFrom("campus_model_commands").select("environment_namespace_id").where("correlation_id", "=", commandId).execute();
        expect(commands).toHaveLength(3);
        expect(commands.every(command => command.environment_namespace_id === world.namespace)).toBe(true);
      });
      const original = await db.transaction().execute(tx => f.governance.resolveDecisionOwner(tx, f.schoolId, "fee_instalment_decision", new Date(now)));
      expect(original.fee_instalment_basis?.max_amount_paise).toBe(3_000_000);
      expect((await f.authority.workspace(f.owner, f.schoolId, commandId)).confirmation).toEqual({ state: "not_found" });
      await sibling.run(async () => {
        const receipt = await sibling.database.transaction().execute(tx => sibling.governance.resolveDecisionOwner(tx, f.schoolId, "fee_instalment_decision", new Date(now)));
        expect(receipt.fee_instalment_basis?.max_amount_paise).toBe(3_000_000);
        expect((await sibling.authority.workspace(f.owner, f.schoolId, commandId)).confirmation).toEqual({ state: "not_found" });
        expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(sibling.database)).rows).toHaveLength(1);
      });
      expect((await sql`SELECT id FROM fee_authority_adoptions WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(1);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
