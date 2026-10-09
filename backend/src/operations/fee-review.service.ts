import { config } from "../config.js";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { OperationsService } from "./operations.service.js";

type Db = Transaction<Database> | DatabaseService;
const uuid = z.uuid();
export const feeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payment"), amount_paise: z.number().int().min(1).max(100_000_000), method: z.enum(["cash", "bank_transfer", "cheque"]), reference: z.string().trim().min(3).max(120), note: z.string().trim().max(1000).default(""), idempotency_key: uuid }),
  z.object({ kind: z.literal("charge"), note: z.string().trim().min(5).max(1000), idempotency_key: uuid }),
]);
export const feeDecisionSchema = z.object({ outcome: z.enum(["verified", "rejected", "answered"]), response: z.string().trim().min(5).max(1000), verified_funds: z.boolean().default(false) });
const settingsSchema = z.object({ payee_name: z.string().trim().max(120), upi_id: z.string().trim().max(160).refine(value => !value || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(value), "Enter a valid UPI ID"), instructions: z.string().trim().max(2000), expected_revision: z.number().int().min(0) }).refine(value => !value.upi_id || value.payee_name.length >= 2, "Payee name is required for UPI");
interface Invoice { id: string; student_id: string; amount_paise: number }
interface Review { id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; method: string | null; reference: string | null; submitted_by: string; request_hash: string }

@Injectable()
export class FeeReviewService {
  constructor(private readonly db: DatabaseService, private readonly operations: OperationsService) {}

  private async guardian(db: Db, user: AuthUser, schoolId: string, studentId: string) {
    const result = await sql`SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id
      JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=gr.school_id
      WHERE p.user_id=${user.id}::uuid AND gr.school_id=${schoolId}::uuid AND gr.student_id=${studentId}::uuid
      AND m.role='guardian' AND m.is_active`.execute(db);
    return Boolean(result.rows.length);
  }

  async workspace(user: AuthUser, schoolId: string, studentId?: string) {
    const ledger = await this.operations.fees(user, schoolId, studentId);
    const [settings, reviews, gatewayPayments] = await Promise.all([
      sql`SELECT payee_name,upi_id,instructions,revision FROM school_fee_payment_settings WHERE school_id=${schoolId}::uuid`.execute(this.db),
      sql`SELECT r.id,r.invoice_id,r.kind,r.amount_paise,r.method,r.reference,r.note,r.created_at,
        coalesce(d.outcome,'pending') AS status,d.response,d.payment_id,d.created_at AS reviewed_at
        FROM fee_review_requests r JOIN fee_invoices i ON i.id=r.invoice_id AND i.school_id=r.school_id
        LEFT JOIN fee_review_decisions d ON d.request_id=r.id AND d.school_id=r.school_id
        WHERE r.school_id=${schoolId}::uuid AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid)
        ORDER BY r.created_at DESC,r.id`.execute(this.db),
      sql`SELECT g.id,g.invoice_id,g.amount_paise,g.state,g.provider_payment_id,g.payment_id FROM fee_gateway_orders g
        JOIN fee_invoices i ON i.school_id=g.school_id AND i.id=g.invoice_id
        WHERE g.school_id=${schoolId}::uuid AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid)
        ORDER BY g.created_at DESC LIMIT 100`.execute(this.db),
    ]);
    return { ...ledger, gateway_payments: gatewayPayments.rows, online_payments_enabled: config().RAZORPAY_ENABLED, payment_mode: config().RAZORPAY_ENABLED ? "sandbox" : null, reviews: reviews.rows, payment_settings: settings.rows[0] ?? { payee_name: "", upi_id: "", instructions: "", revision: 0 }, can_submit: studentId ? await this.guardian(this.db, user, schoolId, studentId) : false };
  }

  async settings(user: AuthUser, schoolId: string, body: unknown) {
    uuid.parse(schoolId); const data = settingsSchema.parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.operations.authorize(user, schoolId, "fees.manage", db, true);
      const current = await sql<{ revision: number; payee_name: string; upi_id: string; instructions: string }>`SELECT revision,payee_name,upi_id,instructions FROM school_fee_payment_settings WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db);
      if ((current.rows[0]?.revision ?? 0) !== data.expected_revision) throw new ConflictException("Payment instructions changed. Refresh and review before saving.");
      await sql`INSERT INTO school_fee_payment_settings(school_id,payee_name,upi_id,instructions,updated_by)
        VALUES(${schoolId}::uuid,${data.payee_name},${data.upi_id},${data.instructions},${user.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET payee_name=excluded.payee_name,upi_id=excluded.upi_id,instructions=excluded.instructions,
        revision=school_fee_payment_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`.execute(db);
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'fee.instructions_updated',${schoolId}::uuid,
        ${JSON.stringify({ before: current.rows[0] ?? null, after: { payee_name: data.payee_name, upi_id: data.upi_id, instructions: data.instructions, revision: data.expected_revision + 1 } })}::jsonb)`.execute(db);
      return { saved: true };
    });
  }

  private async invoice(db: Db, schoolId: string, invoiceId: string) {
    const result = await sql<Invoice>`SELECT id,student_id,amount_paise FROM fee_invoices WHERE school_id=${schoolId}::uuid AND id=${invoiceId}::uuid FOR UPDATE`.execute(db);
    if (!result.rows[0]) throw new NotFoundException("Invoice not found.");
    return result.rows[0];
  }

  private async balance(db: Db, schoolId: string, invoice: Invoice) {
    const result = await sql<{ balance: number }>`SELECT (${invoice.amount_paise}
      - COALESCE((SELECT sum(amount_paise) FROM fee_invoice_credits WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0)
      - COALESCE((SELECT sum(amount_paise) FROM fee_payments WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0)
      + COALESCE((SELECT sum(amount_paise) FROM fee_refunds WHERE school_id=${schoolId}::uuid AND invoice_id=${invoice.id}::uuid),0))::int AS balance`.execute(db);
    return Math.max(0, result.rows[0]!.balance);
  }

  async submit(user: AuthUser, schoolId: string, invoiceId: string, body: unknown) {
    uuid.parse(schoolId); uuid.parse(invoiceId); const data = feeRequestSchema.parse(body);
    const hash = createHash("sha256").update(JSON.stringify({ invoiceId, userId: user.id, ...data })).digest("hex");
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      const invoice = await this.invoice(db, schoolId, invoiceId);
      if (!await this.guardian(db, user, schoolId, invoice.student_id)) throw new ForbiddenException("An active linked guardian must submit this request.");
      const previous = await sql<Review>`SELECT * FROM fee_review_requests WHERE school_id=${schoolId}::uuid AND idempotency_key=${data.idempotency_key}::uuid`.execute(db);
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash) throw new ConflictException("This submission key was already used for different details.");
        return { id: previous.rows[0].id };
      }
      const pending = await sql`SELECT 1 FROM fee_review_requests r WHERE r.school_id=${schoolId}::uuid AND r.invoice_id=${invoiceId}::uuid AND r.kind=${data.kind}
        AND NOT EXISTS(SELECT 1 FROM fee_review_decisions d WHERE d.request_id=r.id)`.execute(db);
      if (pending.rows.length) throw new ConflictException("This invoice already has a pending request of this type. Wait for the school response.");
      if (data.kind === "payment") {
        if (data.amount_paise > await this.balance(db, schoolId, invoice)) throw new BadRequestException("The reported amount exceeds the current outstanding balance. Request a fee review if you paid too much.");
        const duplicate = await sql`SELECT 1 FROM fee_payments WHERE school_id=${schoolId}::uuid AND method=${data.method} AND lower(trim(reference))=lower(${data.reference})
          UNION ALL SELECT 1 FROM fee_review_requests r WHERE r.school_id=${schoolId}::uuid AND r.kind='payment' AND r.method=${data.method} AND lower(trim(r.reference))=lower(${data.reference})
          AND NOT EXISTS(SELECT 1 FROM fee_review_decisions d WHERE d.request_id=r.id AND d.outcome='rejected')`.execute(db);
        if (duplicate.rows.length) throw new ConflictException("This payment reference is already recorded or awaiting review.");
      }
      const result = await sql<{ id: string }>`INSERT INTO fee_review_requests(school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,idempotency_key,request_hash)
        VALUES(${schoolId}::uuid,${invoiceId}::uuid,${data.kind},${data.kind === "payment" ? data.amount_paise : null},${data.kind === "payment" ? data.method : null},
        ${data.kind === "payment" ? data.reference : null},${data.note},${user.id}::uuid,${data.idempotency_key}::uuid,${hash}) RETURNING id`.execute(db);
      const id = result.rows[0]!.id;
      await this.audit(db, user, schoolId, id, "fee.review_submitted");
      await this.event(db, schoolId, invoice, id, "submitted");
      return { id };
    });
  }

  async decide(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(schoolId); uuid.parse(requestId); const data = feeDecisionSchema.parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.operations.authorize(user, schoolId, "fees.manage", db);
      const request = (await sql<Review>`SELECT * FROM fee_review_requests WHERE school_id=${schoolId}::uuid AND id=${requestId}::uuid`.execute(db)).rows[0];
      if (!request) throw new NotFoundException("Review request not found.");
      if (request.submitted_by === user.id) throw new ForbiddenException("Another fee reviewer must verify your own submission.");
      const previous = (await sql<{ outcome: string; response: string; payment_id: string | null }>`SELECT outcome,response,payment_id FROM fee_review_decisions WHERE school_id=${schoolId}::uuid AND request_id=${requestId}::uuid`.execute(db)).rows[0];
      if (previous) {
        if (previous.outcome !== data.outcome || previous.response !== data.response) throw new ConflictException("This request was already reviewed. Refresh to see the decision.");
        return previous;
      }
      if ((request.kind === "charge") !== (data.outcome === "answered")) throw new BadRequestException("Choose a decision appropriate to the request type.");
      const invoice = await this.invoice(db, schoolId, request.invoice_id);
      let paymentId: string | null = null;
      if (data.outcome === "verified") {
        if (!data.verified_funds) throw new BadRequestException("Confirm the funds were independently verified, and any cheque has cleared.");
        if (request.amount_paise! > await this.balance(db, schoolId, invoice)) throw new ConflictException("The invoice balance changed. Reject with an explanation and reconcile the payment separately.");
        const duplicate = await sql`SELECT 1 FROM fee_payments WHERE school_id=${schoolId}::uuid AND method=${request.method} AND lower(trim(reference))=lower(${request.reference})`.execute(db);
        if (duplicate.rows.length) throw new ConflictException("This payment reference is already in the ledger. Reject the duplicate claim with an explanation.");
        paymentId = (await sql<{ id: string }>`INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
          VALUES(${schoolId}::uuid,${invoice.id}::uuid,${request.amount_paise},${request.method},${request.reference},${requestId}::uuid,${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      }
      await sql`INSERT INTO fee_review_decisions(school_id,request_id,outcome,response,payment_id,reviewed_by)
        VALUES(${schoolId}::uuid,${requestId}::uuid,${data.outcome},${data.response},${paymentId}::uuid,${user.id}::uuid)`.execute(db);
      await this.audit(db, user, schoolId, requestId, `fee.review_${data.outcome}`);
      await this.event(db, schoolId, invoice, requestId, "reviewed");
      return { outcome: data.outcome, payment_id: paymentId };
    });
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, targetId: string, action: string) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id) VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${targetId}::uuid)`.execute(db);
  }

  private async event(db: Transaction<Database>, schoolId: string, invoice: Invoice, id: string, action: string) {
    const payload = { student_id: invoice.student_id, invoice_id: invoice.id, review_id: id };
    const audience = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active
      AND event_user_is_authorized(${schoolId}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db);
    await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_review", aggregate_id: id,
      audience_user_ids: audience.rows.map(row => row.user_id), payload, idempotency_key: `fee-review:${id}:${action}`,
      notification_user_ids: [], notification_payload: null }).execute();
  }
}
