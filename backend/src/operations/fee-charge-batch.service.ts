import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { feeChargeAudienceCatalogue, feeChargeAudienceSnapshot, feeChargeSelectionSchema, type FeeChargeAudienceScope } from "../people/fee-charge-audience.js";
import { schoolPermission } from "../roles/authorization.js";
import { retainFeeBatchContinuation, retainFeesContinuation } from "../institution-onboarding/operating-resume.js";
import { financeHash } from "./finance-arrangements.store.js";
import { operationalFeeAccess, type OperationalFeeAccess } from "./operational-fee-access.js";

export const feeChargeBatchSchema = z.object({ command_id: z.uuid(), batch_id: z.uuid(), selection: feeChargeSelectionSchema,
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/), reference: z.string().trim().min(1).max(74),
  description: z.string().trim().min(1).max(200), amount_paise: z.number().int().min(1).max(100_000_000), due_on: z.iso.date() }).strict();
const batchReceipt = z.object({ id: z.uuid(), batch_id: z.uuid(), revision: z.literal(1) }).strict();
export interface FeeChargeBatchResult {
  id: string; batch_id: string; reference: string; description: string; amount_paise: number; due_on: string;
  person_count: number; total_amount_paise: number; revision: 1; replayed: boolean;
  invoices: Array<{ person_id: string; invoice_id: string; reference: string; name: string }>;
}

/** Domain-qualified deterministic identities; neither names nor mutable group order participate. */
export function feeChargeBatchInvoiceId(batchId: string, personId: string) {
  const bytes = createHash("sha256").update(`thatcampus:finance:charge-batch:v1:${batchId}:${personId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

@Injectable()
export class FeeChargeBatchService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}

  private async campus(db: Transaction<Database>, user: AuthUser, schoolId: string, lock = false) {
    z.uuid().parse(schoolId);
    if (!user.is_active || user.active_school_id !== schoolId) throw new ForbiddenException("Choose this campus before opening fees.");
    const selected = executionEnvironmentStorage.getStore();
    if (selected && selected.institution_id !== schoolId) throw new ForbiddenException("Fees must belong to the selected campus and world.");
    const school = await db.selectFrom("schools").select(["id", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new NotFoundException("This campus is unavailable.");
    const now = executionNow(), actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: now.toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your current campus person/account link is unavailable.");
    const technical = await operationalFeeAccess(db, user.id, schoolId, lock);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(now);
    const scope: FeeChargeAudienceScope = { school_id: schoolId, today, environment_namespace_id: selected?.namespace_id ?? `live:${schoolId}`,
      organization_visible: technical.role === "admin", purpose: "fee_charge_issue" };
    return { ...school, actor, technical, today, scope };
  }
  private key(user: AuthUser, commandId: string) { return `finance-charge-batch:${user.id}:${commandId}`; }
  private receipt(db: Transaction<Database>, user: AuthUser, schoolId: string, commandId: string) {
    return this.receipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id, source_domain: "finance",
      handler_key: "finance.charge_batch", handler_version: 1, idempotency_key: this.key(user, commandId) });
  }
  private prepare(db: Transaction<Database>, user: AuthUser, schoolId: string, data: z.infer<typeof feeChargeBatchSchema>, payloadHash: string, technical: OperationalFeeAccess) {
    return this.commands.prepareDomainCommand(db, { school_id: schoolId, actor_user_id: user.id,
      command_type: "finance.charge_batch.issue", handler_key: "finance.charge_batch", handler_version: 1, source_domain: "finance",
      target: { kind: "fee_charge_batch", domain: "finance", domain_id: data.batch_id, label: "Charge collection", lifecycle_state: "planned", source_revision: 1, metadata: {} },
      current_revision: 0, expected_revision: 0, capability: "finance.charge.issue", purpose: "fee_charge_batch_issue", requested_at: executionNow().toISOString(), correlation_id: data.command_id,
      causation_id: null, idempotency_key: this.key(user, data.command_id), operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["current_fee_recording_access"], authority_source_refs: [technical], operating_rule_refs: [], valid_until: null },
      safe_context: { batch_id: data.batch_id, payload_hash: payloadHash, audience_hash: data.snapshot_hash } });
  }
  private async writeSnapshot<T>(execute: (db: Transaction<Database>) => Promise<T>): Promise<T> {
    // A waiter may have opened its RR snapshot before an identical writer commits.
    // PostgreSQL rolls back serialization/unique conflicts completely; retry the SAME
    // command in a fresh coherent snapshot so exact accepted receipts win.
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.transaction().setIsolationLevel("repeatable read").execute(execute); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (attempt >= 2 || (code !== "40001" && code !== "23505")) throw error;
      }
    }
  }
  async catalogue(user: AuthUser, schoolId: string, raw: unknown) {
    const data = z.object({ kind: z.enum(["people", "groups"]), search: z.string().trim().max(150).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(raw);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const campus = await this.campus(db, user, schoolId);
      let canAddPeople = false;
      try { await schoolPermission(db, user, schoolId, "sis.manage"); canAddPeople = true; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      return { ...await feeChargeAudienceCatalogue(db, campus.scope, data), page: data.page, page_size: 25, can_add_people: canAddPeople };
    });
  }
  async preview(user: AuthUser, schoolId: string, raw: unknown) {
    const data = z.object({ selection: feeChargeSelectionSchema }).strict().parse(raw);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const campus = await this.campus(db, user, schoolId), snapshot = await feeChargeAudienceSnapshot(db, campus.scope, data.selection);
      const { evidence, selection: _selection, ...result } = snapshot; void _selection;
      return { ...result, snapshot_hash: financeHash(evidence) };
    });
  }
  private async result(db: Transaction<Database>, schoolId: string, batchId: string, replayed: boolean): Promise<FeeChargeBatchResult> {
    const header = await db.selectFrom("fee_charge_batches").select(["id", "reference", "description", "amount_paise", "due_on", "person_count", "total_amount_paise"])
      .where("school_id", "=", schoolId).where("id", "=", batchId).executeTakeFirst();
    if (!header) throw new NotFoundException("This charge collection is unavailable.");
    const invoices = await db.selectFrom("fee_charge_batch_items").select(["person_id", "invoice_id", "reference", "name"])
      .where("school_id", "=", schoolId).where("batch_id", "=", batchId).orderBy("ordinal").limit(501).execute();
    if (header.person_count > 500 || invoices.length > 500 || invoices.length !== header.person_count) throw new ConflictException("This charge collection's retained invoices are unavailable. Do not record it again.");
    return { ...header, batch_id: header.id, due_on: String(header.due_on), total_amount_paise: Number(header.total_amount_paise), invoices, revision: 1, replayed };
  }
  async detail(user: AuthUser, schoolId: string, batchId: string) {
    z.uuid().parse(batchId);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      await this.campus(db, user, schoolId); return this.result(db, schoolId, batchId, false);
    });
  }
  async confirmation(user: AuthUser, schoolId: string, batchId: string, commandId: string) {
    z.uuid().parse(batchId); z.uuid().parse(commandId);
    return this.db.transaction().execute(async db => {
      const campus = await this.campus(db, user, schoolId, true);
      const retained = await this.receipt(db, user, schoolId, commandId), base = { handler: "finance.charge_batch" as const,
        source_id: batchId, command_id: commandId, action: "issue" as const };
      if (!retained) return { ...base, state: "not_found" as const };
      if (retained.actor_agent_id !== campus.actor.agent_id || retained.target.domain_id !== batchId || retained.target.kind !== "fee_charge_batch" || retained.target.domain !== "finance" || retained.command_type !== "finance.charge_batch.issue")
        throw new ConflictException("This command does not belong to this charge collection.");
      if (retained.state === "pending") return { ...base, state: "pending" as const };
      if (retained.receipt.terminal_state !== "accepted") return { ...base, state: "not_accepted" as const };
      const receipt = batchReceipt.parse(retained.receipt.metadata);
      if (receipt.batch_id !== batchId || receipt.id !== batchId) throw new ConflictException("This charge collection receipt is unavailable.");
      return { ...base, state: "accepted" as const, result: await this.result(db, schoolId, batchId, false) };
    });
  }
  async issue(user: AuthUser, schoolId: string, raw: unknown) {
    const data = feeChargeBatchSchema.parse(raw), payloadHash = financeHash(data);
    const outcome = await this.writeSnapshot(async db => {
      const campus = await this.campus(db, user, schoolId, true);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      // Exact acceptance wins before current group, date, person or reference validation.
      const retained = await this.receipt(db, user, schoolId, data.command_id);
      if (retained) {
        if (retained.actor_agent_id !== campus.actor.agent_id || retained.target.domain_id !== data.batch_id || retained.target.domain !== "finance"
          || retained.target.kind !== "fee_charge_batch" || retained.command_type !== "finance.charge_batch.issue" || retained.safe_context.payload_hash !== payloadHash)
          throw new ConflictException("This command was already used for different fee work.");
        if (retained.state === "pending") throw new ConflictException("This charge collection is awaiting confirmation. Keep the same command while checking its receipt.");
        if (retained.receipt.terminal_state !== "accepted") throw new ConflictException("This charge collection was not accepted. Review the current account.");
        const receipt = batchReceipt.parse(retained.receipt.metadata);
        if (receipt.batch_id !== data.batch_id || receipt.id !== data.batch_id) throw new ConflictException("This charge collection receipt is unavailable.");
        return this.result(db, schoolId, data.batch_id, true);
      }
      let snapshot: Awaited<ReturnType<typeof feeChargeAudienceSnapshot>>;
      try {
        snapshot = await feeChargeAudienceSnapshot(db, campus.scope, data.selection, true);
        if (financeHash(snapshot.evidence) !== data.snapshot_hash) throw new BadRequestException({ code: "finance.charge_audience_changed",
          message: "The selected people or group membership changed. Review the audience again before recording charges." });
        if (await db.selectFrom("fee_charge_batches").select("id").where("id", "=", data.batch_id).executeTakeFirst())
          throw new BadRequestException("This charge collection identifier is already in use. No new charges were recorded.");
        const references = snapshot.people.map((_, index) => `${data.reference}/${String(index + 1).padStart(3, "0")}`);
        const collision = await db.selectFrom("fee_invoices").select("id").where(eb => eb.or([
          eb("id", "in", snapshot.people.map(person => feeChargeBatchInvoiceId(data.batch_id, person.person_id))),
          eb.and([eb("school_id", "=", schoolId), eb("reference", "in", references)]),
        ])).executeTakeFirst();
        if (collision) throw new BadRequestException({ message: "A charge reference or identifier is already in use. No new charges were recorded.",
          fields: { reference: "Choose a different collection reference or check the existing charges." } });
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        // Retain a terminal outcome rather than claiming a reversible group hash is
        // permanently obsolete. Even if the audience changes back, this key cannot post.
        const rejected = await this.prepare(db, user, schoolId, data, payloadHash, campus.technical);
        if (rejected.status !== "ready") throw new ConflictException("This charge collection already has a terminal outcome. Check its exact confirmation.");
        if (rejected.actor_agent_id !== campus.actor.agent_id) throw new ForbiddenException("Your account link changed. Refresh before continuing.");
        const response = error.getResponse(), changedAudience = typeof response === "object" && "code" in response && response.code === "finance.charge_audience_changed";
        await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: rejected.command_id, terminal_state: "rejected", code: changedAudience ? "fee_charge_audience_changed" : "fee_charge_validation_rejected",
          explanation: "The charge collection was not recorded. Review the current audience and charge details before using a new command.", resulting_revision: null,
          domain_event_id: null, metadata: { id: data.batch_id, batch_id: data.batch_id, revision: 1 }, completed_at: executionNow().toISOString() });
        return { rejected: error };
      }
      const items = snapshot.people.map((person, index) => ({ ...person, ordinal: index + 1, invoice_id: feeChargeBatchInvoiceId(data.batch_id, person.person_id),
        reference: `${data.reference}/${String(index + 1).padStart(3, "0")}` }));
      const at = executionNow().toISOString(), prepared = await this.prepare(db, user, schoolId, data, payloadHash, campus.technical);
      if (prepared.status === "completed") return this.result(db, schoolId, data.batch_id, true);
      if (prepared.actor_agent_id !== campus.actor.agent_id) throw new ForbiddenException("Your account link changed. Refresh before continuing.");
      await db.insertInto("fee_charge_batches").values({ id: data.batch_id, school_id: schoolId, created_by: user.id, command_id: prepared.command_id,
        request_hash: payloadHash, audience_hash: data.snapshot_hash, audience_snapshot: snapshot.evidence, reference: data.reference, description: data.description,
        amount_paise: data.amount_paise, due_on: data.due_on, person_count: items.length, total_amount_paise: data.amount_paise * items.length, created_at: executionNow() }).execute();
      for (const item of items) {
        await db.insertInto("fee_invoices").values({ id: item.invoice_id, school_id: schoolId, student_id: null, person_id: item.person_id, selected_person_revision: item.revision,
          reference: item.reference, description: data.description, amount_paise: data.amount_paise, due_on: data.due_on, created_by: user.id, created_at: executionNow() }).execute();
        await db.insertInto("fee_charge_batch_items").values({ school_id: schoolId, batch_id: data.batch_id, ordinal: item.ordinal, invoice_id: item.invoice_id,
          person_id: item.person_id, selected_person_revision: item.revision, reference: item.reference, name: item.name }).execute();
        await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES(${schoolId}::uuid,${user.id}::uuid,'fee.invoice_posted',${item.invoice_id}::uuid,
          ${JSON.stringify({ command_id: prepared.command_id, batch_id: data.batch_id, beneficiary_person_id: item.person_id })}::jsonb)`.execute(db);
        const payload = { invoice_id: item.invoice_id, person_id: item.person_id, revision: 1, refresh: ["fees", "attention", "workspace"] };
        const audience = (await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active
          AND event_user_is_authorized(${schoolId}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db)).rows.map(row => row.user_id);
        const event = await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "finance.charge.issued", aggregate_type: "fee_invoice", aggregate_id: item.invoice_id,
          audience_user_ids: audience, payload, idempotency_key: `fee-batch-charge:${prepared.command_id}:${item.person_id}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
        await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_invoice", aggregate_id: item.invoice_id,
          audience_user_ids: audience, payload, idempotency_key: `fee-batch-refresh:${prepared.command_id}:${item.person_id}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).execute();
        await this.journal.recordAcceptedEvent(db, { school_id: schoolId, source_outbox_event_id: event.id, event_type: "finance.charge.issued",
          subject: { kind: "fee_invoice", domain: "finance", domain_id: item.invoice_id, label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} }, context: null,
          actor_user_id: user.id, audience_user_ids: audience, occurred_at: at, effective_from: at, effective_until: null, source_domain: "finance", source_record_id: item.invoice_id,
          source_revision: 1, correlation_id: data.command_id, causation_event_id: null, idempotency_key: `fee-batch-charge-event:${prepared.command_id}:${item.person_id}`,
          payload: { invoice_id: item.invoice_id, batch_id: data.batch_id, revision: 1 } });
      }
      const event = await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "finance.charge_batch.issued", aggregate_type: "fee_charge_batch", aggregate_id: data.batch_id,
        audience_user_ids: [], payload: { batch_id: data.batch_id, revision: 1 }, idempotency_key: `fee-charge-batch:${prepared.command_id}`,
        notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
      await this.journal.recordAcceptedEvent(db, { school_id: schoolId, source_outbox_event_id: event.id, event_type: "finance.charge_batch.issued",
        subject: { kind: "fee_charge_batch", domain: "finance", domain_id: data.batch_id, label: "Charge collection", lifecycle_state: "active", source_revision: 1, metadata: {} }, context: null,
        actor_user_id: user.id, audience_user_ids: [], occurred_at: at, effective_from: at, effective_until: null, source_domain: "finance", source_record_id: data.batch_id,
        source_revision: 1, correlation_id: data.command_id, causation_event_id: null, idempotency_key: `fee-charge-batch-event:${prepared.command_id}`,
        payload: { batch_id: data.batch_id, revision: 1 } });
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: "fee_charge_batch_issued",
        explanation: "The charge collection was recorded. Each person has a separate invoice; no payment was recorded.", resulting_revision: 1, domain_event_id: event.id,
        metadata: { id: data.batch_id, batch_id: data.batch_id, revision: 1 }, completed_at: at });
      if (items.length === 1) await retainFeesContinuation(db, user, schoolId, { id: items[0]!.invoice_id, person_id: items[0]!.person_id, created_by: user.id });
      else await retainFeeBatchContinuation(db, user, schoolId, { id: data.batch_id, created_by: user.id });
      return this.result(db, schoolId, data.batch_id, false);
    });
    // Throw only after the terminal rejection commits. Throwing inside would erase
    // the evidence needed to release an uncertain client safely.
    if ("rejected" in outcome) throw outcome.rejected;
    return outcome;
  }
}
