import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createFinanceArrangementsFixture } from "./finance-arrangements.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/trace_unused_test";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 2 }) }) }) as DatabaseService;
afterAll(() => database.destroy());

describe.runIf(enabled)("exact-source coordination protocol eligibility", () => {
  it("uses current message state and selected-clock expiry, not response due, without hiding ambiguity", async () => {
    const f = await createFinanceArrangementsFixture(database), account = await f.run(() => f.account());
    const input = { ...await f.run(() => f.input()), basis_revision: account.basis_revision };
    await f.run(() => f.arrangements.request(f.guardian, f.schoolId, f.invoiceId, input));
    const lookup = { school_id: f.schoolId, source_domain: "finance", source_record_id: input.request_id,
      event_type: "finance.instalment.requested", source_revision: 1 };
    const at = new Date(Date.parse(f.now) + 3_600_000), environment = createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => at, nowIso: () => at.toISOString() } });
    const rollback = new Error("Rollback exact-trace protocol test mutations");
    try { await executionEnvironmentStorage.run(environment, () => database.transaction().execute(async tx => {
      const initial = await f.core.findExactTrace(tx, lookup);
      expect(initial).toMatchObject({ message_state: "queued", message_open: true });
      if (!initial) throw new Error("The ordinary proposal must retain one exact message.");
      const beforeNow = new Date(at.getTime() - 1000), afterNow = new Date(at.getTime() + 1000);
      // Test-only protocol states stay inside this rolled-back transaction. No
      // native Finance state or authority is inferred from protocol eligibility.
      for (const state of ["queued", "delivered", "acknowledged", "responded", "expired", "cancelled", "dead_letter"] as const) {
        await tx.updateTable("campus_model_operational_messages").set({ state, expires_at: null,
          response_due_at: new Date(Date.parse(f.now) + 1000) }).where("id", "=", initial.message_id).execute();
        expect(await f.core.findExactTrace(tx, lookup)).toMatchObject({ message_state: state,
          message_open: ["queued", "delivered", "acknowledged"].includes(state) });
      }
      for (const [expiresAt, open] of [[beforeNow, false], [at, false], [afterNow, true]] as const) {
        await tx.updateTable("campus_model_operational_messages").set({ state: "queued", expires_at: expiresAt })
          .where("id", "=", initial.message_id).execute();
        expect(await f.core.findExactTrace(tx, lookup)).toMatchObject({ message_state: "queued", message_open: open });
      }
      expect(await f.core.findExactTrace(tx, { ...lookup, source_revision: 2 })).toBeNull();
      await expect(f.core.findExactTrace(tx, { ...lookup, school_id: randomUUID() })).rejects.toThrow("execution environment");

      // A closed duplicate is still ambiguous evidence. Filtering closed rows
      // out before cardinality checks could incorrectly resurrect the first one.
      const message = await tx.selectFrom("campus_model_operational_messages").selectAll().where("id", "=", initial.message_id).executeTakeFirstOrThrow();
      const reaction = await tx.selectFrom("campus_model_reactions").selectAll().where("id", "=", message.reaction_id).executeTakeFirstOrThrow();
      const event = await tx.selectFrom("campus_model_events").selectAll().where("id", "=", reaction.trigger_event_id).executeTakeFirstOrThrow();
      const eventId = randomUUID(), reactionId = randomUUID();
      const outbox = await tx.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: lookup.event_type,
        aggregate_type: "fee_arrangement", aggregate_id: lookup.source_record_id, audience_user_ids: [], payload: {},
        idempotency_key: `ambiguous-trace:${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const duplicateEvent = { ...event, id: eventId, source_outbox_event_id: outbox.id, idempotency_key: `ambiguous-trace:${randomUUID()}` };
      Reflect.deleteProperty(duplicateEvent, "journal_sequence");
      await tx.insertInto("campus_model_events").values(duplicateEvent).execute();
      await tx.insertInto("campus_model_reactions").values({ ...reaction, id: reactionId, trigger_event_id: eventId,
        idempotency_key: `ambiguous-trace:${randomUUID()}` }).execute();
      const duplicateMessageId = randomUUID();
      await tx.insertInto("campus_model_operational_messages").values({ ...message, id: duplicateMessageId, reaction_id: reactionId, state: "cancelled" }).execute();
      expect(await f.core.findExactTrace(tx, lookup)).toBeNull();
      expect(await f.core.findExactTrace(tx, { ...lookup, message_id: initial.message_id })).toMatchObject({
        event_id: initial.event_id, message_id: initial.message_id, message_state: "queued", message_open: true });
      expect(await f.core.findExactTrace(tx, { ...lookup, message_id: duplicateMessageId })).toMatchObject({
        event_id: eventId, message_id: duplicateMessageId, message_state: "cancelled", message_open: false });
      expect(await f.core.findExactTrace(tx, { ...lookup, message_id: randomUUID() })).toBeNull();
      expect(await f.core.findExactTrace(tx, { ...lookup, message_id: initial.message_id, source_revision: 2 })).toBeNull();
      throw rollback;
    })); } catch (error) { if (error !== rollback) throw error; }
    expect((await sql<{ state: string }>`SELECT message.state FROM campus_model_operational_messages message
      JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
      JOIN campus_model_events event ON event.id=reaction.trigger_event_id
      WHERE event.school_id=${f.schoolId}::uuid AND event.source_record_id=${input.request_id}`.execute(database)).rows).toEqual([{ state: "queued" }]);
  }, 30_000);
});
