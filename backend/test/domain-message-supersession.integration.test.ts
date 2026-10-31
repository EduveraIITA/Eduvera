import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { DomainMessageSupersessionInput } from "../src/campus-model-core/coordination-runtime.port.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createFinanceArrangementsFixture } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({
  connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/supersession_unused_test", max: 2,
}) }) }) as DatabaseService;
afterAll(() => database.destroy());

describe.runIf(enabled)("source-qualified owning-domain message supersession", () => {
  it("does not turn a durable pending receipt or its replay into current transaction authority", async () => {
    const f = await createFinanceArrangementsFixture(database), request = await f.run(() => f.input());
    await f.run(() => f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, request));
    const retained = await f.run(() => database.transaction().execute(async tx => {
      const trace = await f.core.findExactTrace(tx, { school_id: f.schoolId, source_domain: "finance", source_record_id: request.request_id,
        source_revision: 1, event_type: "finance.instalment.requested" });
      if (!trace) throw new Error("The ordinary Finance proposal must retain its invitation.");
      const subject = { kind: "fee_instalment_request", domain: "finance", domain_id: request.request_id,
        label: "Instalment request", lifecycle_state: "active" as const, source_revision: 1, metadata: {} };
      const commandInput = { school_id: f.schoolId, actor_user_id: f.guardian.id, command_type: "finance.instalment.withdraw",
        handler_key: "finance.instalment", handler_version: 1, source_domain: "finance", target: subject,
        current_revision: 1, expected_revision: 1, capability: "fees.view", purpose: "withdraw_own_proposal_fixture",
        requested_at: f.now, correlation_id: trace.correlation_id, causation_id: trace.event_id,
        idempotency_key: `stale-preparation:${randomUUID()}`, operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "finance", decision: "allowed" as const, reason_codes: ["own_linked_guardian_proposal"],
          authority_source_refs: [], operating_rule_refs: [], valid_until: null }, safe_context: {} };
      const prepared = await f.core.prepareDomainCommand(tx, commandInput);
      if (prepared.status !== "ready") throw new Error("The fresh fixture command must be prepared.");
      const source = await tx.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: "finance.instalment.withdrawn",
        aggregate_type: "fee_instalment_request", aggregate_id: request.request_id, audience_user_ids: [], payload: {},
        idempotency_key: `stale-source:${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const event = await f.core.recordAcceptedEvent(tx, { school_id: f.schoolId, source_outbox_event_id: source.id,
        event_type: "finance.instalment.withdrawn", subject: { ...subject, source_revision: 2 }, context: null,
        actor_user_id: f.guardian.id, audience_user_ids: [], occurred_at: f.now, effective_from: f.now, effective_until: null,
        source_domain: "finance", source_record_id: request.request_id, source_revision: 2, correlation_id: trace.correlation_id,
        causation_event_id: trace.event_id, idempotency_key: `stale-event:${randomUUID()}`, payload: { source_command_id: prepared.command_id } });
      return { commandInput, input: { school_id: f.schoolId, command_id: prepared.command_id, message_id: trace.message_id,
        previous_event_id: trace.event_id, resulting_event_id: event.event_id, required_capability: "fees.view", occurred_at: f.now,
        idempotency_key: `stale-outcome:${randomUUID()}` } };
    }));
    const rollback = new Error("Rollback stale-authority adversarial fixture mutations");
    try { await f.run(() => database.transaction().execute(async tx => {
      await expect(f.core.verifyPreparedDomainCommand(tx,{school_id:f.schoolId,actor_user_id:f.guardian.id,command_id:retained.input.command_id,
        correlation_id:retained.commandInput.correlation_id,source_domain:'finance',required_capability:'fees.view',allowed_command_types:['finance.instalment.withdraw']}))
        .rejects.toThrow("freshly authorized command");
      await expect(f.core.supersedeDomainMessage(tx, retained.input)).rejects.toThrow("freshly authorized command");
      expect(await f.core.prepareDomainCommand(tx, retained.commandInput)).toMatchObject({ status: "ready", replayed: true });
      await expect(f.core.supersedeDomainMessage(tx, retained.input)).rejects.toThrow("freshly authorized command");
      await tx.updateTable("users").set({ is_active: false }).where("id", "=", f.guardian.id).execute();
      await expect(f.core.supersedeDomainMessage(tx, retained.input)).rejects.toThrow("supersession lacks");
      expect(await tx.selectFrom("campus_model_operational_message_outcomes").select("id")
        .where("message_id", "=", retained.input.message_id).execute()).toHaveLength(0);
      throw rollback;
    })); } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);

  it("requires the exact command, domain, revision, source fact, actor and selected world, retaining only a cancellation", async () => {
    const f = await createFinanceArrangementsFixture(database);
    const request = await f.run(() => f.input());
    await f.run(() => f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, request));
    const rollback = new Error("Rollback source-qualified supersession fixture");
    try { await f.run(() => database.transaction().execute(async tx => {
      const trace = await f.core.findExactTrace(tx, { school_id: f.schoolId, source_domain: "finance", source_record_id: request.request_id,
        source_revision: 1, event_type: "finance.instalment.requested" });
      if (!trace) throw new Error("The ordinary Finance service must create one configured invitation.");
      const subject = { kind: "fee_instalment_request", domain: "finance", domain_id: request.request_id,
        label: "Instalment request", lifecycle_state: "active" as const, source_revision: 1, metadata: {} };
      const prepared = await f.core.prepareDomainCommand(tx, { school_id: f.schoolId, actor_user_id: f.guardian.id,
        command_type: "finance.instalment.withdraw", handler_key: "finance.instalment", handler_version: 1,
        source_domain: "finance", target: subject, current_revision: 1, expected_revision: 1, capability: "fees.view",
        purpose: "withdraw_own_proposal_fixture", requested_at: f.now, correlation_id: trace.correlation_id, causation_id: trace.event_id,
        idempotency_key: `supersession-command:${randomUUID()}`, operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["own_linked_guardian_proposal"],
          authority_source_refs: [{ request_id: request.request_id, actor_user_id: f.guardian.id }], operating_rule_refs: [], valid_until: null },
        safe_context: { fixture: "source_qualified_supersession", request_id: request.request_id } });
      if (prepared.status !== "ready") throw new Error("The fresh fixture command must be prepared.");
      const eventType = "finance.instalment.withdrawn";
      const verification={school_id:f.schoolId,actor_user_id:f.guardian.id,command_id:prepared.command_id,
        correlation_id:trace.correlation_id,source_domain:'finance',required_capability:'fees.view',allowed_command_types:['finance.instalment.withdraw']};
      expect(await f.core.verifyPreparedDomainCommand(tx,verification)).toMatchObject({command_type:'finance.instalment.withdraw',expected_revision:1,
        safe_context:{fixture:'source_qualified_supersession',request_id:request.request_id}});
      for(const changed of [{required_capability:'fees.manage'},{allowed_command_types:['finance.instalment.approve']},
        {correlation_id:randomUUID()},{source_domain:'people'},{actor_user_id:f.owner.id}])
        await expect(f.core.verifyPreparedDomainCommand(tx,{...verification,...changed})).rejects.toThrow('does not match');
      const outbox = await tx.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: eventType,
        aggregate_type: "fee_instalment_request", aggregate_id: request.request_id, audience_user_ids: [], payload: { revision: 2 },
        idempotency_key: `supersession-source:${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const event = { school_id: f.schoolId, source_outbox_event_id: outbox.id, event_type: eventType,
        subject: { ...subject, source_revision: 2 }, context: null, actor_user_id: f.guardian.id, audience_user_ids: [],
        occurred_at: f.now, effective_from: f.now, effective_until: null, source_domain: "finance", source_record_id: request.request_id,
        source_revision: 2, correlation_id: trace.correlation_id, causation_event_id: trace.event_id,
        idempotency_key: `supersession-event:${randomUUID()}`, payload: { source_command_id: prepared.command_id } };
      const accepted = await f.core.recordAcceptedEvent(tx, event);
      const input: DomainMessageSupersessionInput = { school_id: f.schoolId, command_id: prepared.command_id, message_id: trace.message_id,
        previous_event_id: trace.event_id, resulting_event_id: accepted.event_id, required_capability: "fees.view",
        occurred_at: f.now, idempotency_key: `supersession-result:${randomUUID()}` };
      for (const altered of [
        { command_id: randomUUID() }, { previous_event_id: randomUUID() }, { resulting_event_id: trace.event_id },
        { message_id: randomUUID() }, { required_capability: "fees.manage" },
      ]) await expect(f.core.supersedeDomainMessage(tx, { ...input, ...altered })).rejects.toThrow("supersession lacks");

      // Even an honestly journalled typed source event is insufficient if it
      // does not identify the prepared command or exact next source revision.
      const unboundSource = await tx.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: eventType,
        aggregate_type: "fee_instalment_request", aggregate_id: request.request_id, audience_user_ids: [], payload: {},
        idempotency_key: `unbound-source:${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const unbound = await f.core.recordAcceptedEvent(tx, { ...event, source_outbox_event_id: unboundSource.id,
        idempotency_key: `unbound:${randomUUID()}`, payload: {} });
      await expect(f.core.supersedeDomainMessage(tx, { ...input, resulting_event_id: unbound.event_id })).rejects.toThrow("supersession lacks");
      const otherSource = await tx.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: eventType,
        aggregate_type: "fee_instalment_request", aggregate_id: randomUUID(), audience_user_ids: [], payload: {},
        idempotency_key: `other-source:${randomUUID()}` }).returning(["id", "aggregate_id"]).executeTakeFirstOrThrow();
      const unrelated = await f.core.recordAcceptedEvent(tx, { ...event, subject: { ...event.subject, domain_id: otherSource.aggregate_id },
        source_record_id: otherSource.aggregate_id, source_outbox_event_id: otherSource.id, idempotency_key: `unrelated:${randomUUID()}` });
      await expect(f.core.supersedeDomainMessage(tx, { ...input, resulting_event_id: unrelated.event_id })).rejects.toThrow("supersession lacks");

      const otherEnvironment = createLiveExecutionEnvironment({ institution_id: randomUUID(), clock: f.environment.clock });
      await expect(executionEnvironmentStorage.run(otherEnvironment, () => f.core.supersedeDomainMessage(tx, input))).rejects.toThrow("another operational realm");
      await sql`SELECT set_config('thatcampus.namespace_id',${`scenario:${randomUUID()}:run:${randomUUID()}`},true)`.execute(tx);
      await expect(f.core.supersedeDomainMessage(tx, input)).rejects.toThrow("selected execution data plane");
      await expect(f.core.verifyPreparedDomainCommand(tx,verification)).rejects.toThrow('selected execution data plane');
      await sql`SELECT set_config('thatcampus.namespace_id','',true)`.execute(tx);
      await tx.updateTable("users").set({ is_active: false }).where("id", "=", f.guardian.id).execute();
      await expect(f.core.supersedeDomainMessage(tx, input)).rejects.toThrow("supersession lacks");
      await expect(f.core.verifyPreparedDomainCommand(tx,verification)).rejects.toThrow('current campus identity');
      await tx.updateTable("users").set({ is_active: true }).where("id", "=", f.guardian.id).execute();
      expect((await tx.selectFrom("campus_model_operational_message_outcomes").select("id").where("message_id", "=", trace.message_id).execute())).toHaveLength(0);

      const retained = await f.core.supersedeDomainMessage(tx, input);
      expect(retained).toMatchObject({ message_id: trace.message_id, state: "cancelled", replayed: false });
      await f.core.completeDomainCommand(tx, { school_id: f.schoolId, command_id: prepared.command_id, terminal_state: "accepted",
        code: "fixture_withdrawal_accepted", explanation: "The owning source transition was accepted in this test transaction.",
        resulting_revision: 2, domain_event_id: outbox.id, metadata: {}, completed_at: f.now });
      await expect(f.core.verifyPreparedDomainCommand(tx,verification)).rejects.toThrow('does not match');
      expect(await f.core.supersedeDomainMessage(tx, input)).toMatchObject({ ...retained, replayed: true });
      await expect(f.core.supersedeDomainMessage(tx, { ...input, required_capability: "fees.manage" })).rejects.toThrow();
      const outcomes = await tx.selectFrom("campus_model_operational_message_outcomes").select(["state", "actor_agent_id", "source_outbox_event_id", "response", "explanation"])
        .where("message_id", "=", trace.message_id).execute();
      expect(outcomes).toEqual([{ state: "cancelled", actor_agent_id: prepared.actor_agent_id, source_outbox_event_id: outbox.id,
        response: null, explanation: expect.stringContaining(`command ${prepared.command_id} superseded event ${trace.event_id} with event ${accepted.event_id}`) }]);
      expect(await tx.selectFrom("campus_model_operational_messages").select(["state", "responded_at"]).where("id", "=", trace.message_id)
        .executeTakeFirstOrThrow()).toEqual({ state: "cancelled", responded_at: null });
      throw rollback;
    })); } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
