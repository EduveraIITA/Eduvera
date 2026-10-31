import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { chargeCorrectionApply, chargeCorrectionPreview, paymentCorrectionApply, paymentCorrectionPreview, type ChargeCorrectionQuote,
  type ChargeCorrectionResult, type PaymentCorrectionQuote, type PaymentCorrectionResult } from "./fee-corrections.contracts.js";
import { correctedChargeState, effectiveFeeInvoice } from "./fee-corrections.store.js";
import { financeHash } from "./finance-arrangements.store.js";
import { operationalFeeAccess } from "./operational-fee-access.js";

type Tx = Transaction<Database>;
type Kind = "charge" | "payment";
@Injectable()
export class FeeCorrectionsService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  private async context(db: Tx, user: AuthUser, schoolId: string, lock = false) {
    z.uuid().parse(schoolId); const selected = executionEnvironmentStorage.getStore();
    if (!user.is_active || user.active_school_id !== schoolId || selected && selected.institution_id !== schoolId) throw new ForbiddenException("Choose this campus and world before correcting fees.");
    const school = await db.selectFrom("schools").select(["id", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new NotFoundException("This campus is unavailable.");
    const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your current campus person/account link is unavailable.");
    const technical = await operationalFeeAccess(db, user.id, schoolId, lock);
    return { actor, technical, namespace: selected?.namespace_id ?? `live:${schoolId}`, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
  }
  private handler(kind: Kind) { return `finance.${kind}_correction`; }
  private key(user: AuthUser, kind: Kind, commandId: string) { return `${this.handler(kind)}:${user.id}:${commandId}`; }
  private receipt(db: Tx, user: AuthUser, schoolId: string, kind: Kind, commandId: string) {
    return this.receipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id, source_domain: "finance", handler_key: this.handler(kind), handler_version: 1,
      idempotency_key: this.key(user, kind, commandId) });
  }
  private async retained(db: Tx, user: AuthUser, schoolId: string, kind: Kind, data: { command_id: string; correction_id: string }, actorId: string, payloadHash?: string) {
    const retained = await this.receipt(db, user, schoolId, kind, data.command_id);
    if (!retained) return null;
    if (retained.actor_agent_id !== actorId || retained.target.domain !== "finance" || retained.target.domain_id !== data.correction_id
      || retained.target.kind !== `fee_${kind}_correction` || retained.command_type !== `${this.handler(kind)}.apply`
      || payloadHash && retained.safe_context.payload_hash !== payloadHash) throw new ConflictException("This command belongs to different fee correction work.");
    return retained;
  }
  private async assertUnusedIdentifier(db: Tx, correctionId: string) {
    const used = (await sql`SELECT id FROM fee_invoice_corrections WHERE id=${correctionId}::uuid
      UNION ALL SELECT id FROM fee_payment_corrections WHERE id=${correctionId}::uuid LIMIT 1`.execute(db)).rows.length > 0;
    if (used) throw new BadRequestException({ code: "finance.correction_identifier_in_use",
      message: "This correction identifier is already in use. Start a new correction; no changes were recorded." });
  }
  private prepare(db: Tx, user: AuthUser, schoolId: string, kind: Kind, data: { command_id: string; correction_id: string; snapshot_hash?: string }, payloadHash: string,
    ctx: Awaited<ReturnType<FeeCorrectionsService["context"]>>) {
    return this.commands.prepareDomainCommand(db, { school_id: schoolId, actor_user_id: user.id, source_domain: "finance", command_type: `${this.handler(kind)}.apply`,
      handler_key: this.handler(kind), handler_version: 1, target: { kind: `fee_${kind}_correction`, domain: "finance", domain_id: data.correction_id,
        label: "Fee recording correction", lifecycle_state: "planned", source_revision: 1, metadata: {} }, current_revision: 0, expected_revision: 0,
      capability: "finance.recording.correct", purpose: "correct_fee_recording_error", requested_at: executionNow().toISOString(), correlation_id: data.command_id,
      causation_id: null, idempotency_key: this.key(user, kind, data.command_id), operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["current_fee_recording_access", "explicit_recording_error_attestation"],
        authority_source_refs: [ctx.technical], operating_rule_refs: [], valid_until: null }, safe_context: { correction_id: data.correction_id, payload_hash: payloadHash, snapshot_hash: data.snapshot_hash } });
  }
  private async reject(db: Tx, user: AuthUser, schoolId: string, kind: Kind, data: { command_id: string; correction_id: string; snapshot_hash: string }, hash: string,
    ctx: Awaited<ReturnType<FeeCorrectionsService["context"]>>, error: BadRequestException) {
    const prepared = await this.prepare(db, user, schoolId, kind, data, hash, ctx);
    if (prepared.status !== "ready") throw new ConflictException("Check this correction's exact confirmation before continuing.");
    if (prepared.actor_agent_id !== ctx.actor.agent_id) throw new ForbiddenException("Your current account link changed. Refresh before correcting fees.");
    await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "rejected", code: "fee_correction_validation_rejected",
      explanation: "No correction was recorded. Review the current fee records before submitting a new command.", resulting_revision: null, domain_event_id: null,
      metadata: { correction_id: data.correction_id }, completed_at: executionNow().toISOString() });
    return { rejected: error };
  }
  private async quote(db: Tx, user: AuthUser, schoolId: string, data: z.infer<typeof chargeCorrectionPreview>, lock = false) {
    const ctx = await this.context(db, user, schoolId), invoiceIds = [...data.selection.invoice_ids].sort();
    if (data.selection.batch_id) {
      const matches = await db.selectFrom("fee_charge_batch_items").select("invoice_id").where("school_id", "=", schoolId).where("batch_id", "=", data.selection.batch_id)
        .where("invoice_id", "in", invoiceIds).execute();
      if (matches.length !== invoiceIds.length) throw new BadRequestException("Choose only invoices in this posted collection. Current group membership is not used.");
    }
    const sources = [];
    for (const id of invoiceIds) sources.push(await effectiveFeeInvoice(db, schoolId, id, lock, true));
    const items = sources.map(invoice => ({ invoice_id: invoice.id, person_id: invoice.person_id, student_id: invoice.student_id, name: invoice.name,
      reference: invoice.reference, revision: invoice.correction_revision, before: correctedChargeState(invoice),
      after: correctedChargeState(invoice, data.change.kind === "cancel" ? { amount_paise: 0 } : data.change) }));
    const total = (key: "before" | "after", field: "amount_paise" | "balance_paise" | "credit_paise") => items.reduce((sum, row) => sum + row[key][field], 0);
    const quote: ChargeCorrectionQuote = { snapshot_hash: financeHash({ namespace: ctx.namespace, today: ctx.today, selection: { ...data.selection, invoice_ids: invoiceIds }, change: data.change, sources }),
      today: ctx.today, person_count: new Set(items.map(row => row.person_id)).size, items, before_total_amount_paise: total("before", "amount_paise"), after_total_amount_paise: total("after", "amount_paise"),
      before_balance_paise: total("before", "balance_paise"), after_balance_paise: total("after", "balance_paise"), credit_paise: total("after", "credit_paise") };
    return { quote, sources };
  }
  async preview(user: AuthUser, schoolId: string, raw: unknown) {
    const data = chargeCorrectionPreview.parse(raw);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => (await this.quote(db, user, schoolId, data)).quote);
  }
  private async event(db: Tx, user: AuthUser, schoolId: string, invoice: Awaited<ReturnType<typeof effectiveFeeInvoice>>, correctionId: string, correlationId: string) {
    const payload = { invoice_id: invoice.id, ...(invoice.student_id ? { student_id: invoice.student_id } : { person_id: invoice.person_id }), refresh: ["fees", "attention", "workspace"] };
    const audience = (await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active
      AND event_user_is_authorized(${schoolId}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db)).rows.map(row => row.user_id);
    const event = await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_invoice", aggregate_id: invoice.id,
      audience_user_ids: audience, notification_user_ids: [], notification_payload: null, payload, idempotency_key: `fee-correction:${correctionId}:${invoice.id}`, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
    void user; void correlationId;
    return event.id;
  }
  private async acceptedEvent(db: Tx, user: AuthUser, schoolId: string, kind: Kind, id: string, correlationId: string) {
    const eventType = kind === "charge" ? "finance.charge.corrected" : "finance.payment.corrected", aggregate = `fee_${kind}_correction`;
    const event = await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: eventType, aggregate_type: aggregate, aggregate_id: id,
      audience_user_ids: [], notification_user_ids: [], notification_payload: null, payload: { correction_id: id, revision: 1 }, idempotency_key: `fee-correction-source:${id}`, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(db, { school_id: schoolId, source_outbox_event_id: event.id, event_type: eventType,
      subject: { kind: aggregate, domain: "finance", domain_id: id, label: "Fee recording correction", lifecycle_state: "active", source_revision: 1, metadata: {} }, context: null,
      actor_user_id: user.id, audience_user_ids: [], occurred_at: executionNow().toISOString(), effective_from: executionNow().toISOString(), effective_until: null,
      source_domain: "finance", source_record_id: id, source_revision: 1, correlation_id: correlationId, causation_event_id: null,
      idempotency_key: `fee-correction-source-event:${id}`, payload: { correction_id: id, revision: 1 } });
    return event.id;
  }
  async apply(user: AuthUser, schoolId: string, raw: unknown) {
    const data = chargeCorrectionApply.parse(raw), hash = financeHash(data);
    const outcome = await this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db); const ctx = await this.context(db, user, schoolId, true);
      const prior = await this.retained(db, user, schoolId, "charge", data, ctx.actor.agent_id, hash);
      if (prior) {
        if (prior.state !== "completed" || prior.receipt.terminal_state !== "accepted") throw new ConflictException("Check this correction's exact confirmation before continuing.");
        return { ...await this.readResult(db, schoolId, "charge", data.correction_id), replayed: true } as ChargeCorrectionResult;
      }
      await this.assertUnusedIdentifier(db, data.correction_id);
      let state: Awaited<ReturnType<FeeCorrectionsService["quote"]>>;
      try { state = await this.quote(db, user, schoolId, { selection: data.selection, change: data.change }, true);
        if (state.quote.snapshot_hash !== data.snapshot_hash) throw new BadRequestException({ code: "finance.correction_basis_changed", message: "The fee records changed. Review the correction again." });
        if (state.quote.items.every(row => financeHash(row.before) === financeHash(row.after))) throw new BadRequestException("Change a recorded field before saving a correction.");
      } catch (error) { if (!(error instanceof BadRequestException)) throw error; return this.reject(db, user, schoolId, "charge", data, hash, ctx, error); }
      const prepared = await this.prepare(db, user, schoolId, "charge", data, hash, ctx);
      if (prepared.status !== "ready") throw new ConflictException("Check this correction's exact confirmation.");
      if (prepared.actor_agent_id !== ctx.actor.agent_id) throw new ForbiddenException("Your current account link changed. Refresh before correcting fees.");
      const result: ChargeCorrectionResult = { id: data.correction_id, correction_id: data.correction_id, invoice_ids: state.quote.items.map(row => row.invoice_id), revision: 1, replayed: false };
      await db.insertInto("fee_invoice_corrections").values({ id: data.correction_id, school_id: schoolId, created_by: user.id, actor_person_id: ctx.actor.person_id, actor_name: ctx.actor.label, command_id: prepared.command_id,
        request_hash: hash, snapshot_hash: data.snapshot_hash, reason: data.reason, recording_error_attested: true, change: data.change, invoice_count: result.invoice_ids.length, selection: { ...data.selection, invoice_ids: result.invoice_ids }, result, created_at: executionNow() }).execute();
      for (const item of state.quote.items) {
        await db.insertInto("fee_invoice_correction_items").values({ school_id: schoolId, correction_id: data.correction_id, invoice_id: item.invoice_id,
          revision: item.revision + 1, amount_paise: item.after.amount_paise, description: item.after.description, due_on: item.after.due_on, charge_state: item.after.charge_state }).execute();
        await this.event(db, user, schoolId, state.sources.find(row => row.id === item.invoice_id)!, data.correction_id, data.command_id);
        await this.audit(db, user, schoolId, item.invoice_id, data.correction_id, "fee.charge_corrected");
      }
      const eventId = await this.acceptedEvent(db, user, schoolId, "charge", data.correction_id, data.command_id);
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: "fee_charge_corrected", explanation: "The recording correction was saved. Original charges remain in history; no money was moved.",
        resulting_revision: 1, domain_event_id: eventId, metadata: { correction_id: data.correction_id }, completed_at: executionNow().toISOString() });
      return result;
    });
    if ("rejected" in outcome) throw outcome.rejected; return outcome;
  }
  private async paymentState(db: Tx, user: AuthUser, schoolId: string, paymentId: string, data: z.infer<typeof paymentCorrectionPreview>, lock = false) {
    const ctx = await this.context(db, user, schoolId);
    const payment = await db.selectFrom("fee_payments").selectAll().where("school_id", "=", schoolId).where("id", "=", paymentId).executeTakeFirst();
    if (!payment) throw new NotFoundException("This payment is unavailable.");
    const invoice = await effectiveFeeInvoice(db, schoolId, payment.invoice_id, lock, true);
    if (!['cash', 'bank_transfer', 'cheque'].includes(payment.method) || (await sql`SELECT 1 FROM fee_gateway_orders WHERE school_id=${schoolId}::uuid AND payment_id=${paymentId}::uuid`.execute(db)).rows.length)
      throw new BadRequestException("This provider payment needs its owning reconciliation; it cannot be reversed here.");
    if (await db.selectFrom("fee_payment_corrections").select("id").where("payment_id", "=", paymentId).executeTakeFirst()) throw new BadRequestException("This receipt has already been corrected. Open its current replacement.");
    const predecessor = await db.selectFrom("fee_payment_corrections").select("root_payment_id").where("replacement_payment_id", "=", paymentId).executeTakeFirst();
    const rootId = predecessor?.root_payment_id ?? paymentId;
    const claimant = (await sql`SELECT 1 FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.school_id=d.school_id AND r.id=d.review_id
      WHERE d.school_id=${schoolId}::uuid AND d.payment_id=${rootId}::uuid AND(r.submitted_by=${user.id}::uuid OR r.submitter_person_id=${ctx.actor.person_id}::uuid)
      UNION ALL SELECT 1 FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.school_id=d.school_id AND r.id=d.review_id
      WHERE d.school_id=${schoolId}::uuid AND d.payment_id=${rootId}::uuid AND r.submitter_person_id IS NULL`.execute(db)).rows.length > 0;
    if (data.action === "replace" && claimant) throw new ForbiddenException("Another Finance operator must independently check your claimed payment replacement.");
    if (data.action === "replace") {
      const occupied = (await sql`SELECT payment_id FROM fee_payment_reference_claims WHERE school_id=${schoolId}::uuid AND method=${data.replacement.method}
        AND normalized_reference=lower(trim(${data.replacement.reference})) AND payment_id<>${paymentId}::uuid`.execute(db)).rows[0];
      if (occupied) throw new BadRequestException("This transaction reference already belongs to another active receipt.");
    }
    const before = correctedChargeState(invoice), after = correctedChargeState(invoice, undefined, Math.max(0, before.paid_paise - payment.amount_paise + (data.action === "replace" ? data.replacement.amount_paise : 0)));
    if (data.action === "replace" && after.credit_paise > before.credit_paise) throw new BadRequestException("The replacement would create additional credit beyond the verified money already recorded. Review the amount first.");
    const quote: PaymentCorrectionQuote = { snapshot_hash: financeHash({ namespace: ctx.namespace, today: ctx.today, invoice, payment, rootId, data }), today: ctx.today,
      invoice_id: invoice.id, payment_id: paymentId, reference: payment.reference, amount_paise: payment.amount_paise, method: payment.method, before, after, can_reverse: true, can_replace: !claimant };
    return { quote, invoice, rootId };
  }
  async paymentPreview(user: AuthUser, schoolId: string, paymentId: string, raw: unknown) {
    z.uuid().parse(paymentId); const data = paymentCorrectionPreview.parse(raw);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => (await this.paymentState(db, user, schoolId, paymentId, data)).quote);
  }
  async correctPayment(user: AuthUser, schoolId: string, paymentId: string, raw: unknown) {
    z.uuid().parse(paymentId); const data = paymentCorrectionApply.parse(raw), hash = financeHash({ payment_id: paymentId, ...data });
    const outcome = await this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db); const ctx = await this.context(db, user, schoolId, true);
      const prior = await this.retained(db, user, schoolId, "payment", data, ctx.actor.agent_id, hash);
      if (prior) {
        if (prior.state !== "completed" || prior.receipt.terminal_state !== "accepted") throw new ConflictException("Check this correction's exact confirmation before continuing.");
        return { ...await this.readResult(db, schoolId, "payment", data.correction_id), replayed: true } as PaymentCorrectionResult;
      }
      await this.assertUnusedIdentifier(db, data.correction_id);
      let state: Awaited<ReturnType<FeeCorrectionsService["paymentState"]>>;
      try { state = await this.paymentState(db, user, schoolId, paymentId, data.action === "reverse" ? { action: "reverse" } : { action: "replace", replacement: data.replacement }, true);
        if (state.quote.snapshot_hash !== data.snapshot_hash) throw new BadRequestException({ code: "finance.correction_basis_changed", message: "The fee records changed. Review the correction again." });
        if (await db.selectFrom("fee_payments").select("id").where(eb => eb.or([eb("id", "=", data.correction_id), eb.and([eb("school_id", "=", schoolId), eb("idempotency_key", "=", data.correction_id)])])).executeTakeFirst())
          throw new BadRequestException("This correction identifier is already in use.");
      } catch (error) { if (!(error instanceof BadRequestException)) throw error; return this.reject(db, user, schoolId, "payment", data, hash, ctx, error); }
      const prepared = await this.prepare(db, user, schoolId, "payment", data, hash, ctx);
      if (prepared.status !== "ready") throw new ConflictException("Check this correction's exact confirmation.");
      if (prepared.actor_agent_id !== ctx.actor.agent_id) throw new ForbiddenException("Your current account link changed. Refresh before correcting fees.");
      const result: PaymentCorrectionResult = { id: data.correction_id, correction_id: data.correction_id, invoice_id: state.invoice.id, payment_id: paymentId,
        replacement_payment_id: data.action === "replace" ? data.correction_id : null, action: data.action, revision: 1, replayed: false };
      await db.insertInto("fee_payment_corrections").values({ id: data.correction_id, school_id: schoolId, invoice_id: state.invoice.id, payment_id: paymentId, root_payment_id: state.rootId,
        replacement_payment_id: result.replacement_payment_id, replacement_amount_paise: data.action === "replace" ? data.replacement.amount_paise : null,
        replacement_method: data.action === "replace" ? data.replacement.method : null, replacement_reference: data.action === "replace" ? data.replacement.reference : null,
        action: data.action, reason: data.reason, recording_error_attested: true, verified_funds: data.action === "replace", created_by: user.id, actor_person_id: ctx.actor.person_id, actor_name: ctx.actor.label,
        command_id: prepared.command_id, request_hash: hash, snapshot_hash: data.snapshot_hash, result, created_at: executionNow() }).execute();
      if (data.action === "replace") await db.insertInto("fee_payments").values({ id: data.correction_id, school_id: schoolId, invoice_id: state.invoice.id,
        amount_paise: data.replacement.amount_paise, method: data.replacement.method, reference: data.replacement.reference, idempotency_key: data.correction_id,
        recorded_by: user.id, created_at: executionNow() }).execute();
      await this.event(db, user, schoolId, state.invoice, data.correction_id, data.command_id);
      const eventId = await this.acceptedEvent(db, user, schoolId, "payment", data.correction_id, data.command_id);
      await this.audit(db, user, schoolId, state.invoice.id, data.correction_id, "fee.receipt_corrected");
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: "fee_receipt_corrected",
        explanation: "The receipt recording was corrected. Original evidence remains; no provider or refund action was taken.", resulting_revision: 1, domain_event_id: eventId,
        metadata: { correction_id: data.correction_id }, completed_at: executionNow().toISOString() });
      return result;
    });
    if ("rejected" in outcome) throw outcome.rejected; return outcome;
  }
  private async audit(db: Tx, user: AuthUser, schoolId: string, invoiceId: string, correctionId: string, action: string) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${invoiceId}::uuid,${JSON.stringify({ correction_id: correctionId })}::jsonb)`.execute(db);
  }
  private async readResult(db: Tx, schoolId: string, kind: Kind, id: string) {
    const row = kind === "charge" ? await db.selectFrom("fee_invoice_corrections").select("result").where("school_id", "=", schoolId).where("id", "=", id).executeTakeFirst()
      : await db.selectFrom("fee_payment_corrections").select("result").where("school_id", "=", schoolId).where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundException("This fee correction is unavailable."); return row.result as ChargeCorrectionResult | PaymentCorrectionResult;
  }
  private async detailFor(user: AuthUser, schoolId: string, kind: Kind, id: string) {
    z.uuid().parse(id); return this.db.transaction().execute(async db => { await this.context(db, user, schoolId); return this.readResult(db, schoolId, kind, id); });
  }
  detail(user: AuthUser, schoolId: string, id: string) { return this.detailFor(user, schoolId, "charge", id); }
  paymentDetail(user: AuthUser, schoolId: string, id: string) { return this.detailFor(user, schoolId, "payment", id); }
  private async confirmationFor(user: AuthUser, schoolId: string, kind: Kind, id: string, commandId: string) {
    z.uuid().parse(id); z.uuid().parse(commandId); return this.db.transaction().execute(async db => {
      const ctx = await this.context(db, user, schoolId, true), retained = await this.retained(db, user, schoolId, kind, { command_id: commandId, correction_id: id }, ctx.actor.agent_id);
      const base = { handler: this.handler(kind), source_id: id, command_id: commandId, action: "apply" as const };
      if (!retained) return { ...base, state: "not_found" as const }; if (retained.state === "pending") return { ...base, state: "pending" as const };
      if (retained.receipt.terminal_state !== "accepted") return { ...base, state: "not_accepted" as const };
      return { ...base, state: "accepted" as const, result: await this.readResult(db, schoolId, kind, id) };
    });
  }
  confirmation(user: AuthUser, schoolId: string, id: string, commandId: string) { return this.confirmationFor(user, schoolId, "charge", id, commandId); }
  paymentConfirmation(user: AuthUser, schoolId: string, id: string, commandId: string) { return this.confirmationFor(user, schoolId, "payment", id, commandId); }
}
