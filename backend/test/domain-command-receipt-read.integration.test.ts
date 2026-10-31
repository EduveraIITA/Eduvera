import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { PrepareDomainCommandInput } from "../src/campus-model-core/domain-command-gateway.port.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 2 }) }) });
const core = new CampusModelCoreService(database as DatabaseService);
afterAll(() => database.destroy());

async function fixture(work: (input: {
  tx: Transaction<Database>; schoolId: string; ownerId: string; otherId: string;
  command: PrepareDomainCommandInput; advance: () => void;
}) => Promise<void>) {
  const rollback = new Error("receipt-read fixture complete; roll back all fixture data");
  try {
    await database.transaction().execute(async tx => {
      const account = async (name: string) => tx.insertInto("users").values({
        username: `receipt-${name}-${randomUUID()}`, email: `receipt-${name}-${randomUUID()}@example.test`,
        password_hash: "isolated-test-only", first_name: name, last_name: "Synthetic", role: "admin",
      }).returning(["id", "email", "first_name", "last_name"]).executeTakeFirstOrThrow();
      const owner = await account("Owner"), other = await account("Other");
      const schoolId = await new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, owner, "UTC");
      let now = new Date().toISOString();
      const environment = createLiveExecutionEnvironment({ institution_id: schoolId,
        clock: { now: () => new Date(now), nowIso: () => now } });
      await tx.insertInto("school_memberships").values({ school_id: schoolId, user_id: other.id, role: "admin" }).execute();
      const person = await tx.insertInto("school_people").values({ school_id: schoolId, first_name: "Other", last_name: "Synthetic" }).returning("id").executeTakeFirstOrThrow();
      await sql`WITH staff_fixture_input(school_id,person_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) AS (VALUES (${schoolId}::uuid,${person.id}::uuid,${other.id}::uuid,${`R-${randomUUID().slice(0, 12)}`},'Other','Synthetic',${other.email},'non_teaching','Synthetic administrator','full_time',${now}::timestamptz::date,'active',${owner.id}::uuid,${owner.id}::uuid)) INSERT INTO staff_profiles(school_id,person_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) SELECT input.school_id::uuid,input.person_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input`.execute(tx);
      await core.linkAccountEndpoint(tx, { school_id: schoolId, user_id: other.id, person_id: person.id,
        actor_user_id: owner.id, effective_from: now, effective_until: null, source_domain: "receipt_test",
        source_record_id: person.id, source_revision: 1, metadata: {} });
      const command: PrepareDomainCommandInput = {
        school_id: schoolId, actor_user_id: owner.id, source_domain: "receipt_test", command_type: "receipt.test.record",
        handler_key: "receipt.test.record", handler_version: 1, idempotency_key: randomUUID(),
        target: { domain: "receipt_test", domain_id: randomUUID(), kind: "practice", label: "Synthetic receipt source",
          lifecycle_state: "active", source_revision: 1, metadata: {} },
        current_revision: 1, expected_revision: 1, capability: "receipt_test:record", purpose: "receipt_test",
        requested_at: now, correlation_id: randomUUID(), causation_id: null, operating_rule_version_ref: null,
        configuration_refs: [], authority_attestation: { evaluator_domain: "receipt_test", decision: "allowed",
          reason_codes: ["explicit_test_source_authority"], authority_source_refs: [{ school_id: schoolId }],
          operating_rule_refs: [], valid_until: null }, safe_context: { payload_hash: "a".repeat(64) },
      };
      await executionEnvironmentStorage.run(environment, () => work({ tx, schoolId, ownerId: owner.id, otherId: other.id, command,
        advance: () => { now = new Date(Date.parse(command.requested_at) + 86_400_000).toISOString(); } }));
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

function lookup(command: PrepareDomainCommandInput) {
  return { school_id: command.school_id, actor_user_id: command.actor_user_id, source_domain: command.source_domain,
    handler_key: command.handler_key, handler_version: command.handler_version, idempotency_key: command.idempotency_key };
}

describe.runIf(enabled)("current-identity domain receipt discovery on real PostgreSQL", () => {
  it("returns completed receipts at the current clock without re-preparing or mutating evidence", async () => fixture(async ({ tx, command, advance }) => {
    expect(await core.readDomainCommandReceipt(tx, lookup(command))).toBeNull();
    const prepared = await core.prepareDomainCommand(tx, command);
    expect(prepared.status).toBe("ready");
    await core.completeDomainCommand(tx, { school_id: command.school_id, command_id: prepared.command_id,
      terminal_state: "accepted", code: "receipt_test_accepted", explanation: "The source change was saved.",
      resulting_revision: 2, domain_event_id: null, metadata: { source_id: command.target.domain_id }, completed_at: command.requested_at });
    const before = await sql`SELECT command.*,row_to_json(outcome) AS outcome FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id WHERE command.id=${prepared.command_id}::uuid`.execute(tx);
    advance();
    const retained = await core.readDomainCommandReceipt(tx, lookup(command));
    expect(retained).toMatchObject({ state: "completed", command_type: command.command_type, target: {
      kind: "practice", domain: "receipt_test", domain_id: command.target.domain_id }, expected_revision: 1,
      safe_context: { payload_hash: "a".repeat(64) }, receipt: { command_id: prepared.command_id,
        terminal_state: "accepted", resulting_revision: 2, replayed: true, metadata: { source_id: command.target.domain_id } } });
    const after = await sql`SELECT command.*,row_to_json(outcome) AS outcome FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id WHERE command.id=${prepared.command_id}::uuid`.execute(tx);
    expect(after.rows).toEqual(before.rows);
  }));

  it("qualifies receipts by the exact actor, source, handler/version and key; pending never becomes completed", async () => fixture(async ({ tx, command, otherId }) => {
    const prepared = await core.prepareDomainCommand(tx, command);
    expect(await core.readDomainCommandReceipt(tx, lookup(command))).toMatchObject({ state: "pending", receipt: null });
    for (const changed of [{ actor_user_id: otherId }, { source_domain: "another_domain" },
      { handler_key: "another.handler" }, { handler_version: 2 }, { idempotency_key: randomUUID() }]) {
      expect(await core.readDomainCommandReceipt(tx, { ...lookup(command), ...changed })).toBeNull();
    }
    await expect(core.readDomainCommandReceipt(tx, { ...lookup(command), school_id: randomUUID() })).rejects.toThrow();
    const pending = await tx.selectFrom("campus_model_commands").select("state").where("id", "=", prepared.command_id).executeTakeFirstOrThrow();
    expect(pending.state).toBe("pending");
  }));

  it("refuses replay discovery after the acting endpoint ends, even when the original request time was valid", async () => fixture(async ({ tx, command, ownerId, schoolId, advance }) => {
    const prepared = await core.prepareDomainCommand(tx, command);
    await core.completeDomainCommand(tx, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted",
      code: "receipt_test_accepted", explanation: "Saved before the endpoint ended.", resulting_revision: 2,
      domain_event_id: null, metadata: {}, completed_at: command.requested_at });
    const identity = await core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: ownerId, at: command.requested_at });
    if (!identity.acting) throw new Error("Fixture owner must act before its endpoint ends.");
    const endpoint = await tx.selectFrom("campus_model_agent_endpoints").select("revision").where("id", "=", identity.endpoint_id).executeTakeFirstOrThrow();
    await core.closeAccountEndpoint(tx, { school_id: schoolId, endpoint_id: identity.endpoint_id, actor_user_id: ownerId,
      expected_revision: endpoint.revision, effective_at: new Date(Date.parse(command.requested_at) + 3_600_000).toISOString(), disposition: "ended",
      reason: "Synthetic endpoint lifecycle test", source_domain: "receipt_test", source_record_id: identity.endpoint_id,
      source_revision: 2, idempotency_key: randomUUID() });
    advance();
    expect((await core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: ownerId, at: command.requested_at })).acting).toBe(true);
    await expect(core.readDomainCommandReceipt(tx, lookup(command))).rejects.toThrow(/not active at this time/i);
  }));
});
