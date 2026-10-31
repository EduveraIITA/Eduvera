import { config } from "../config.js";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database, FeeCorrectionWatermark } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { OperationsService } from "./operations.service.js";
import { feeLedgerQuerySchema, type FeeLedgerQuery } from "./fee-ledger-read.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { NativeFeeReviewsModel } from "./native-fee-reviews.model.js";
import { nativeFeeReviewRevision } from "./native-fee-reviews.service.js";
import { arrangementInvoice } from "./finance-arrangements.store.js";
import { operationalFeeAccess } from "./operational-fee-access.js";

type Db = Transaction<Database> | DatabaseService;
const uuid = z.uuid();
const correctionWatermarkSchema = z.object({ invoice_revision: z.number().int().nonnegative().safe(), payment_correction_count: z.number().int().nonnegative().safe() }).strict();
export const feeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payment"), amount_paise: z.number().int().min(1).max(100_000_000), method: z.enum(["cash", "bank_transfer", "cheque"]), reference: z.string().trim().min(3).max(120), note: z.string().trim().max(1000).default(""), idempotency_key: uuid }),
  z.object({ kind: z.literal("charge"), note: z.string().trim().min(5).max(1000), idempotency_key: uuid }),
]);
export const feeDecisionSchema = z.object({ outcome: z.enum(["verified", "rejected", "answered"]), response: z.string().trim().min(5).max(1000), verified_funds: z.boolean().default(false) });
const settingsSchema = z.object({ payee_name: z.string().trim().max(120), upi_id: z.string().trim().max(160).refine(value => !value || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(value), "Enter a valid UPI ID"), instructions: z.string().trim().max(2000), expected_revision: z.number().int().min(0) }).refine(value => !value.upi_id || value.payee_name.length >= 2, "Payee name is required for UPI");
interface Invoice { id: string; student_id: string; amount_paise: number }
interface Review { id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; method: string | null; reference: string | null; submitted_by: string; submitter_person_id: string | null; request_hash: string; correction_watermark: FeeCorrectionWatermark | null }
interface GatewayPaymentReview {
  id: string;
  invoice_id: string;
  amount_paise: number;
  state: "review_required";
  provider_payment_id: string;
  payment_id: null;
}

@Injectable()
export class FeeReviewService {
  constructor(private readonly db: DatabaseService, private readonly operations: OperationsService,
    private readonly model: NativeFeeReviewsModel, @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  private async actor(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    if (!user.is_active || user.active_school_id !== schoolId) throw new ForbiddenException("Choose this campus before changing fee work.");
    const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your current campus person/account link is unavailable.");
    return actor;
  }

  private async guardian(db: Db, user: AuthUser, schoolId: string, studentId: string) {
    const result = await sql`SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id
      JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=gr.school_id
      WHERE p.user_id=${user.id}::uuid AND gr.school_id=${schoolId}::uuid AND gr.student_id=${studentId}::uuid
      AND m.role='guardian' AND m.is_active`.execute(db);
    return Boolean(result.rows.length);
  }

  async workspace(user: AuthUser, schoolId: string, studentId?: string, personId?: string, invoiceId?: string, query: FeeLedgerQuery = {}) {
    const input = feeLedgerQuerySchema.parse(query);
    const ledger = await this.operations.fees(user, schoolId, studentId, personId, invoiceId, query);
    const visibleInvoiceIds = ledger.invoices.map(invoice => invoice.id);
    const [settings, reviews, gatewayPayments] = await Promise.all([
      sql`SELECT payee_name,upi_id,instructions,revision FROM school_fee_payment_settings WHERE school_id=${schoolId}::uuid`.execute(this.db),
      sql<{ id: string; [key: string]: unknown }>`SELECT r.id,r.invoice_id,r.kind,r.amount_paise,r.method,r.reference,r.note,r.created_at,
        coalesce(d.outcome,'pending') AS status,d.id AS decision_id,d.response,d.payment_id,d.created_at AS reviewed_at
        FROM fee_native_review_requests r JOIN fee_invoices i ON i.id=r.invoice_id AND i.school_id=r.school_id
        LEFT JOIN fee_native_review_decisions d ON d.review_id=r.id AND d.school_id=r.school_id
        WHERE r.school_id=${schoolId}::uuid AND r.route_kind='guardian_queue' AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid)
          AND i.id=ANY(${visibleInvoiceIds}::uuid[])
          AND (${personId ?? null}::uuid IS NULL OR i.person_id=${personId ?? null}::uuid) AND (${invoiceId ?? null}::uuid IS NULL OR i.id=${invoiceId ?? null}::uuid)
          AND (${input.review_id ?? null}::uuid IS NULL OR r.id=${input.review_id ?? null}::uuid)
          AND (${input.review_id ? null : input.review_cursor ?? null}::uuid IS NULL OR r.id>${input.review_id ? null : input.review_cursor ?? null}::uuid)
        ORDER BY r.id LIMIT ${input.limit + 1}`.execute(this.db),
      sql`SELECT g.id,g.invoice_id,g.amount_paise,g.state,g.provider_payment_id,g.payment_id FROM fee_gateway_orders g
        JOIN fee_invoices i ON i.school_id=g.school_id AND i.id=g.invoice_id
        WHERE g.school_id=${schoolId}::uuid AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid)
          AND i.id=ANY(${visibleInvoiceIds}::uuid[])
          AND (${personId ?? null}::uuid IS NULL OR i.person_id=${personId ?? null}::uuid) AND (${invoiceId ?? null}::uuid IS NULL OR i.id=${invoiceId ?? null}::uuid)
        ORDER BY g.created_at DESC LIMIT 100`.execute(this.db),
    ]);
    return { ...ledger, pagination: { ...ledger.pagination, review_limit: input.limit,
      next_review_cursor: !input.review_id && reviews.rows.length > input.limit ? reviews.rows[input.limit - 1]!.id : null },
      gateway_payments: gatewayPayments.rows, online_payments_enabled: config().RAZORPAY_ENABLED, payment_mode: config().RAZORPAY_ENABLED ? "sandbox" : null, reviews: reviews.rows.slice(0, input.limit), payment_settings: settings.rows[0] ?? { payee_name: "", upi_id: "", instructions: "", revision: 0 }, can_submit: studentId ? await this.guardian(this.db, user, schoolId, studentId) : false };
  }

  async gatewayPaymentReview(user: AuthUser, schoolId: string, orderId: string) {
    uuid.parse(schoolId);
    uuid.parse(orderId);
    await this.operations.authorize(user, schoolId, "fees.manage");
    const result = await sql<GatewayPaymentReview>`
      SELECT gateway.id,gateway.invoice_id,gateway.amount_paise,gateway.state,
        gateway.provider_payment_id,gateway.payment_id
      FROM fee_gateway_orders gateway
      JOIN fee_invoices invoice ON invoice.id=gateway.invoice_id
        AND invoice.school_id=gateway.school_id
      WHERE gateway.school_id=${schoolId}::uuid AND gateway.id=${orderId}::uuid
        AND gateway.state='review_required'
    `.execute(this.db);
    if (!result.rows[0]) throw new NotFoundException("Payment review not found.");
    return result.rows[0];
  }

  async settings(user: AuthUser, schoolId: string, body: unknown) {
    uuid.parse(schoolId); const data = settingsSchema.parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.operations.authorize(user, schoolId, "fees.manage", db, true);
      const current = await sql<{ revision: number; payee_name: string; upi_id: string; instructions: string }>`SELECT revision,payee_name,upi_id,instructions FROM school_fee_payment_settings WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db);
      if ((current.rows[0]?.revision ?? 0) !== data.expected_revision) throw new ConflictException("Payment instructions changed. Refresh and review before saving.");
      const saved = (await sql<{ revision: number }>`INSERT INTO school_fee_payment_settings(school_id,payee_name,upi_id,instructions,updated_by)
        VALUES(${schoolId}::uuid,${data.payee_name},${data.upi_id},${data.instructions},${user.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET payee_name=excluded.payee_name,upi_id=excluded.upi_id,instructions=excluded.instructions,
        revision=school_fee_payment_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()
        RETURNING revision`.execute(db)).rows[0]!;
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'fee.instructions_updated',${schoolId}::uuid,
        ${JSON.stringify({ before: current.rows[0] ?? null, after: { payee_name: data.payee_name, upi_id: data.upi_id, instructions: data.instructions, revision: data.expected_revision + 1 } })}::jsonb)`.execute(db);
      const payload = {
        action: "fee_instructions_updated",
        revision: saved.revision,
        refresh: ["fees", "parent.home", "principal.home"],
      };
      const audience = await sql<{ user_id: string }>`SELECT DISTINCT membership.user_id
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${schoolId}::uuid AND membership.is_active
          AND event_user_is_authorized(
            ${schoolId}::uuid,
            'administration.updated',
            ${JSON.stringify(payload)}::jsonb,
            membership.user_id
          )`.execute(db);
      await db.insertInto("event_outbox").values({
        school_id: schoolId,
        event_type: "administration.updated",
        aggregate_type: "fee_payment_settings",
        aggregate_id: schoolId,
        audience_user_ids: audience.rows.map((row) => row.user_id),
        payload,
        idempotency_key: `fee-settings:${schoolId}:${saved.revision}`,
        notification_user_ids: [],
        notification_payload: null,
      }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
      return { saved: true };
    });
  }

  private async invoice(db: Db, schoolId: string, invoiceId: string) {
    await sql`SELECT id FROM fee_invoices WHERE school_id=${schoolId}::uuid AND id=${invoiceId}::uuid FOR UPDATE`.execute(db);
    const result = await sql<Invoice>`SELECT id,student_id,amount_paise FROM fee_effective_invoices WHERE school_id=${schoolId}::uuid AND id=${invoiceId}::uuid`.execute(db);
    if (!result.rows[0]) throw new NotFoundException("Invoice not found.");
    return result.rows[0];
  }

  private async balance(db: Db, schoolId: string, invoice: Invoice) {
    const result = await sql<{ balance: number }>`SELECT (${invoice.amount_paise}
      - COALESCE((SELECT sum(amount_paise) FROM fee_invoice_credits WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0)
      - COALESCE((SELECT sum(amount_paise) FROM fee_effective_payments WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0)
      + COALESCE((SELECT sum(amount_paise) FROM fee_refunds WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0))::int AS balance`.execute(db);
    return Math.max(0, result.rows[0]!.balance);
  }

  private async correctionWatermark(db: Db, schoolId: string, invoiceId: string): Promise<FeeCorrectionWatermark> {
    const current = (await sql<FeeCorrectionWatermark>`SELECT
      coalesce((SELECT max(revision) FROM fee_invoice_correction_items WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid),0)::int AS invoice_revision,
      (SELECT count(*)::int FROM fee_payment_corrections WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid) AS payment_correction_count`.execute(db)).rows[0]!;
    return correctionWatermarkSchema.parse(current);
  }

  async submit(user: AuthUser, schoolId: string, invoiceId: string, body: unknown) {
    uuid.parse(schoolId); uuid.parse(invoiceId); const data = feeRequestSchema.parse(body);
    const hash = createHash("sha256").update(JSON.stringify({ invoiceId, userId: user.id, ...data })).digest("hex");
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      const invoice = await this.invoice(db, schoolId, invoiceId);
      if (!await this.guardian(db, user, schoolId, invoice.student_id)) throw new ForbiddenException("An active linked guardian must submit this request.");
      const actor = await this.actor(db, user, schoolId);
      const previous = await sql<Review>`SELECT * FROM fee_native_review_requests WHERE school_id=${schoolId}::uuid AND route_kind='guardian_queue' AND idempotency_key=${data.idempotency_key}::uuid`.execute(db);
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash) throw new ConflictException("This submission key was already used for different details.");
        return { id: previous.rows[0].id };
      }
      const nativePending = await sql`SELECT 1 FROM fee_native_review_requests request WHERE request.school_id=${schoolId}::uuid
        AND request.invoice_id=${invoiceId}::uuid AND request.kind=${data.kind}
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions decision WHERE decision.school_id=request.school_id AND decision.review_id=request.id)
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_withdrawals withdrawal WHERE withdrawal.school_id=request.school_id AND withdrawal.review_id=request.id)`.execute(db);
      if (nativePending.rows.length) throw new ConflictException("This invoice already has a pending request of this type. Open its current fee review.");
      if (data.kind === "payment") {
        if (data.amount_paise > await this.balance(db, schoolId, invoice)) throw new BadRequestException("The reported amount exceeds the current outstanding balance. Request a fee review if you paid too much.");
        const duplicate = await sql`SELECT 1 FROM fee_effective_payments WHERE school_id=${schoolId}::uuid AND method=${data.method} AND lower(trim(reference))=lower(${data.reference})
          UNION ALL SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=${schoolId}::uuid AND r.kind='payment' AND r.method=${data.method}
            AND lower(trim(r.reference))=lower(trim(${data.reference}))
            AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d WHERE d.school_id=r.school_id AND d.review_id=r.id)
            AND NOT EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=r.school_id AND w.review_id=r.id)`.execute(db);
        if (duplicate.rows.length) throw new ConflictException("This payment reference is already recorded or awaiting review.");
      }
      const watermark = await this.correctionWatermark(db, schoolId, invoiceId);
      const id = randomUUID(), revision = await nativeFeeReviewRevision(db, schoolId, invoiceId), source = await arrangementInvoice(db, schoolId, invoiceId);
      const prepared = await this.model.prepare(db, user, actor, source, id, "report", { ...data, command_id: data.idempotency_key, expected_revision: revision }, revision,
        { relationship: "guardian", person_id: actor.person_id, route_kind: "guardian_queue" });
      if (prepared.replay) return { id: prepared.replay.id };
      await sql`INSERT INTO fee_native_review_requests(id,school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,submitter_person_id,submitter_relationship,route_kind,idempotency_key,request_hash,correction_watermark,stream_revision,command_id,created_at)
        VALUES(${id}::uuid,${schoolId}::uuid,${invoiceId}::uuid,${data.kind},${data.kind === "payment" ? data.amount_paise : null},${data.kind === "payment" ? data.method : null},
        ${data.kind === "payment" ? data.reference : null},${data.note},${user.id}::uuid,${actor.person_id}::uuid,'guardian','guardian_queue',${data.idempotency_key}::uuid,${hash},${JSON.stringify(watermark)}::jsonb,${revision + 1},${data.idempotency_key}::uuid,${executionNow()}::timestamptz)`.execute(db);
      await this.audit(db, user, schoolId, id, "fee.review_submitted");
      await this.event(db, schoolId, invoice, id, "submitted");
      const event = await this.model.event(db, user, source, id, revision + 1, data.idempotency_key, "reported", [user.id]);
      await this.model.finish(db, source, prepared.command_id, revision + 1, event.outbox_id, { id, invoice_id: invoiceId, revision: revision + 1, replayed: false });
      return { id };
    });
  }

  async decide(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(schoolId); uuid.parse(requestId); const data = feeDecisionSchema.parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      const permission = await operationalFeeAccess(db, user.id, schoolId, true);
      const request = (await sql<Review>`SELECT * FROM fee_native_review_requests WHERE school_id=${schoolId}::uuid AND id=${requestId}::uuid AND route_kind='guardian_queue'`.execute(db)).rows[0];
      if (!request) throw new NotFoundException("Review request not found.");
      const actor = await this.actor(db, user, schoolId);
      if (request.submitted_by === user.id || request.submitter_person_id === actor.person_id) throw new ForbiddenException("Another fee reviewer must verify your own submission.");
      const previous = (await sql<{ id: string; outcome: string; response: string; payment_id: string | null }>`SELECT id,outcome,response,payment_id FROM fee_native_review_decisions WHERE school_id=${schoolId}::uuid AND review_id=${requestId}::uuid`.execute(db)).rows[0];
      if (previous) {
        if (previous.outcome !== data.outcome || previous.response !== data.response) throw new ConflictException("This request was already reviewed. Refresh to see the decision.");
        return previous;
      }
      if ((request.kind === "charge") !== (data.outcome === "answered")) throw new BadRequestException("Choose a decision appropriate to the request type.");
      const invoice = await this.invoice(db, schoolId, request.invoice_id);
      const source = await arrangementInvoice(db, schoolId, invoice.id), revision = await nativeFeeReviewRevision(db, schoolId, invoice.id);
      const authority = { person_id: actor.person_id, route_kind: "guardian_queue", sources: permission.sources };
      const prepared = await this.model.prepare(db, user, actor, source, requestId, "decide", { ...data, command_id: requestId, expected_revision: revision }, revision, authority);
      if (prepared.replay) return { outcome: prepared.replay.outcome, payment_id: prepared.replay.payment_id };
      let paymentId: string | null = null;
      if (data.outcome === "verified") {
        if (!request.submitter_person_id) throw new ConflictException("This retained report has no canonical claimant identity. Reject it with an explanation and ask for a fresh report before independently verifying funds.");
        if (!data.verified_funds) throw new BadRequestException("Confirm the funds were independently verified, and any cheque has cleared.");
        const current = await this.correctionWatermark(db, schoolId, invoice.id), retained = correctionWatermarkSchema.safeParse(request.correction_watermark);
        if (retained.success ? retained.data.invoice_revision !== current.invoice_revision || retained.data.payment_correction_count !== current.payment_correction_count
          : request.correction_watermark != null || current.invoice_revision > 0 || current.payment_correction_count > 0)
          throw new ConflictException("The fee records changed after this report. Reject it with an explanation and ask for a fresh payment report against the current records.");
        if (request.amount_paise! > await this.balance(db, schoolId, invoice)) throw new ConflictException("The invoice balance changed. Reject with an explanation and reconcile the payment separately.");
        const duplicate = await sql`SELECT 1 FROM fee_effective_payments WHERE school_id=${schoolId}::uuid AND method=${request.method} AND lower(trim(reference))=lower(${request.reference})`.execute(db);
        if (duplicate.rows.length) throw new ConflictException("This payment reference is already in the ledger. Reject the duplicate claim with an explanation.");
        paymentId = (await sql<{ id: string }>`INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
          VALUES(${schoolId}::uuid,${invoice.id}::uuid,${request.amount_paise},${request.method},${request.reference},${requestId}::uuid,${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      }
      const decision = (await sql<{ id: string }>`INSERT INTO fee_native_review_decisions(id,school_id,invoice_id,review_id,outcome,response,payment_id,reviewed_by,reviewer_person_id,authority_receipt,stream_revision,command_id,created_at)
        VALUES(${randomUUID()}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${requestId}::uuid,${data.outcome},${data.response},${paymentId}::uuid,${user.id}::uuid,
          ${actor.person_id}::uuid,${JSON.stringify(authority)}::jsonb,${revision + 1},${requestId}::uuid,${executionNow()}::timestamptz)
        RETURNING id`.execute(db)).rows[0]!;
      await this.audit(db, user, schoolId, requestId, `fee.review_${data.outcome}`);
      await this.event(db, schoolId, invoice, requestId, "reviewed", {
        id: decision.id,
        recipientId: request.submitted_by,
        outcome: data.outcome,
        response: data.response,
      });
      const event = await this.model.event(db, user, source, requestId, revision + 1, requestId, "decided", [user.id, request.submitted_by]);
      await this.model.finish(db, source, prepared.command_id, revision + 1, event.outbox_id,
        { id: requestId, invoice_id: invoice.id, revision: revision + 1, replayed: false, outcome: data.outcome, payment_id: paymentId });
      return { outcome: data.outcome, payment_id: paymentId };
    });
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, targetId: string, action: string) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id) VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${targetId}::uuid)`.execute(db);
  }

  private async event(
    db: Transaction<Database>, schoolId: string, invoice: Invoice, id: string, action: string,
    decision?: { id: string; recipientId: string; outcome: string; response: string },
  ) {
    const payload = {
      student_id: invoice.student_id,
      invoice_id: invoice.id,
      review_id: id,
      ...(decision ? { decision_id: decision.id, outcome: decision.outcome } : {}),
      refresh: ["fees", "student.home", "parent.home", "principal.home", "notifications", "attention"],
    };
    const audience = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active
      AND event_user_is_authorized(${schoolId}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db);
    await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_review", aggregate_id: id,
      audience_user_ids: audience.rows.map(row => row.user_id), payload, idempotency_key: `fee-review:${id}:${action}`,
      notification_user_ids: decision ? [decision.recipientId] : [],
      notification_payload: (decision ? {
        kind: "general",
        title: "Fee review completed",
        body: decision.response,
        parent_link: `/areas/fees/account?scope=dependent&student_id=${invoice.student_id}&view=reviews&review=${id}&decision=${decision.id}`,
        attention_eligible: true,
        attention_portal: "parent",
        attention_module: "fees",
        attention_source_kind: "fee_review_decision",
        attention_source_id: decision.id,
        attention_source_revision: 1,
        attention_topic_key: `fee-review:${id}`,
        attention_student_id: invoice.student_id,
      } : null) as any }).execute();
  }
}
