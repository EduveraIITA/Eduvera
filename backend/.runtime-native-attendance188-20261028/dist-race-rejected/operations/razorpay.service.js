var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RazorpayService_1;
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { RazorpayClient } from "./razorpay.client.js";
import { enqueuePaymentEmail, readPaymentDocument } from './payment-email.service.js';
import { paymentReceiptPdf } from './payment-receipt.js';
import { executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';
const providerId = z.string().regex(/^[A-Za-z0-9_]+$/).max(100);
const createSchema = z.object({ amount_paise: z.number().int().min(100).max(100_000_000) });
const verifySchema = z.object({ razorpay_order_id: providerId, razorpay_payment_id: providerId, razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i) });
let RazorpayService = RazorpayService_1 = class RazorpayService {
    db;
    gateway;
    timer;
    reconciling = new Set();
    logger = new Logger(RazorpayService_1.name);
    constructor(db, gateway) {
        this.db = db;
        this.gateway = gateway;
    }
    onModuleInit() {
        if (this.gateway.enabled())
            this.timer = setInterval(() => void this.reconcilePending(), 60_000).unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async guardian(db, user, school, invoice) {
        const result = await sql `SELECT 1 FROM fee_invoices i JOIN guardian_relationships gr ON gr.student_id=i.student_id AND gr.school_id=i.school_id
      JOIN parents p ON p.id=gr.guardian_id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=i.school_id
      WHERE i.id=${invoice}::uuid AND i.school_id=${school}::uuid AND p.user_id=${user.id}::uuid AND m.is_active AND m.role='guardian'`.execute(db);
        if (!result.rows.length)
            throw new ForbiddenException("An active linked guardian is required.");
    }
    async balance(db, school, invoice) {
        await sql `SELECT id FROM fee_invoices WHERE school_id=${school}::uuid AND id=${invoice}::uuid FOR UPDATE`.execute(db);
        const row = (await sql `SELECT i.student_id,
      greatest(0, greatest(0,i.amount_paise-coalesce((SELECT sum(amount_paise) FROM fee_invoice_credits WHERE school_id=i.school_id AND invoice_id=i.id),0))
      - greatest(0,coalesce((SELECT sum(amount_paise) FROM fee_effective_payments WHERE school_id=i.school_id AND invoice_id=i.id),0)
      - coalesce((SELECT sum(amount_paise) FROM fee_refunds WHERE school_id=i.school_id AND invoice_id=i.id),0)))::int AS balance
      FROM fee_effective_invoices i WHERE i.school_id=${school}::uuid AND i.id=${invoice}::uuid`.execute(db)).rows[0];
        if (!row)
            throw new NotFoundException("Invoice not found.");
        return row;
    }
    async lock(db, school) { await sql `SELECT pg_advisory_xact_lock(hashtextextended(${school},0))`.execute(db); }
    checkout(order) {
        return { id: order.id, key_id: order.key_id, order_id: order.provider_order_id, amount: order.amount_paise, currency: "INR", sandbox: true,
            ...(executionEnvironmentStorage.getStore()?.kind === 'simulation' ? { evidence_mode: 'simulation', external_checkout: false, money_moved: false } : {}) };
    }
    async create(user, school, invoice, body) {
        z.uuid().parse(school);
        z.uuid().parse(invoice);
        const data = createSchema.parse(body);
        if (!this.gateway.enabled())
            throw new ServiceUnavailableException("Razorpay sandbox is not configured.");
        return this.db.transaction().execute(async (db) => {
            await this.lock(db, school);
            await this.guardian(db, user, school, invoice);
            const balance = await this.balance(db, school, invoice);
            if (data.amount_paise > balance.balance)
                throw new BadRequestException("Amount exceeds the outstanding balance.");
            const pending = await sql `SELECT 1 FROM fee_native_review_requests r WHERE r.school_id=${school}::uuid AND r.invoice_id=${invoice}::uuid AND r.kind='payment'
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d WHERE d.school_id=r.school_id AND d.review_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=r.school_id AND w.review_id=r.id)`.execute(db);
            if (pending.rows.length)
                throw new ConflictException("A payment is awaiting school verification. Check it before paying again.");
            const previous = (await sql `SELECT * FROM fee_gateway_orders WHERE school_id=${school}::uuid AND invoice_id=${invoice}::uuid AND state IN ('created','review_required') ORDER BY created_at DESC LIMIT 1`.execute(db)).rows[0];
            if (previous) {
                if (previous.state === 'review_required')
                    throw new ConflictException("A captured payment needs school reconciliation. Do not pay again.");
                if (previous.key_id !== this.gateway.keyId())
                    throw new ConflictException("The existing checkout uses an earlier key. Contact the school for reconciliation.");
                if (previous.amount_paise !== data.amount_paise)
                    throw new ConflictException(`An existing checkout is for ₹${(previous.amount_paise / 100).toFixed(2)}. Check its status or use that amount.`);
                return this.checkout(previous);
            }
            const id = randomUUID();
            // Only persisted orders are handed to Checkout. A timed-out create may leave
            // an unpaid provider order, but can never expose an untracked checkout.
            const order = await this.gateway.request("orders", { amount: data.amount_paise, currency: "INR", receipt: id });
            if (!providerId.safeParse(order.id).success || order.amount !== data.amount_paise || order.currency !== "INR" || order.receipt !== id)
                throw new ServiceUnavailableException("Razorpay returned an inconsistent order.");
            const row = (await sql `INSERT INTO fee_gateway_orders(id,school_id,invoice_id,created_by,amount_paise,key_id,provider_order_id)
        VALUES(${id}::uuid,${school}::uuid,${invoice}::uuid,${user.id}::uuid,${data.amount_paise},${this.gateway.keyId()},${order.id}) RETURNING *`.execute(db)).rows[0];
            return this.checkout(row);
        });
    }
    async verify(user, school, invoice, body) {
        z.uuid().parse(school);
        z.uuid().parse(invoice);
        const data = verifySchema.parse(body);
        await this.guardian(this.db, user, school, invoice);
        const row = await this.find(data.razorpay_order_id, school, invoice);
        this.gateway.verify(row.provider_order_id, data.razorpay_payment_id, data.razorpay_signature);
        const payment = await this.gateway.request(`payments/${data.razorpay_payment_id}`);
        return this.settle(row, payment);
    }
    async status(user, school, invoice) {
        z.uuid().parse(school);
        z.uuid().parse(invoice);
        await this.guardian(this.db, user, school, invoice);
        const rows = (await sql `SELECT * FROM fee_gateway_orders WHERE school_id=${school}::uuid AND invoice_id=${invoice}::uuid ORDER BY created_at DESC LIMIT 10`.execute(this.db)).rows;
        for (const row of rows)
            if (row.state === "created") {
                try {
                    await this.reconcile(row);
                }
                catch {
                    this.logger.warn('Payment status refresh deferred; returning saved status.');
                }
            }
        return (await sql `SELECT o.id,CASE WHEN o.state='created' THEN coalesce(o.last_payment_status,'created') ELSE o.state END AS state,
      o.amount_paise,o.payment_id,coalesce(o.provider_payment_id,o.last_attempt_id) AS provider_payment_id,
      o.created_at,o.checked_at,(SELECT delivery_state FROM fee_payment_emails e WHERE e.order_id=o.id ORDER BY e.created_at DESC LIMIT 1) AS email_status
      FROM fee_gateway_orders o WHERE o.school_id=${school}::uuid AND o.invoice_id=${invoice}::uuid ORDER BY o.created_at DESC LIMIT 10`.execute(this.db)).rows;
    }
    async receipt(user, school, invoice, receiptId) {
        z.uuid().parse(school);
        z.uuid().parse(invoice);
        z.uuid().parse(receiptId);
        await this.guardian(this.db, user, school, invoice);
        const row = (await sql `SELECT id FROM fee_gateway_orders WHERE school_id=${school}::uuid AND invoice_id=${invoice}::uuid AND payment_id=${receiptId}::uuid AND state='captured'`.execute(this.db)).rows[0];
        if (!row)
            throw new NotFoundException('Receipt not found.');
        const data = await readPaymentDocument(this.db, row.id);
        if (!data)
            throw new NotFoundException('Receipt not found.');
        return paymentReceiptPdf({ ...data, state: 'captured' });
    }
    async find(providerOrder, school, invoice) {
        const row = (await sql `SELECT * FROM fee_gateway_orders WHERE provider_order_id=${providerOrder}
      AND (${school ?? null}::uuid IS NULL OR school_id=${school ?? null}::uuid)
      AND (${invoice ?? null}::uuid IS NULL OR invoice_id=${invoice ?? null}::uuid)`.execute(this.db)).rows[0];
        if (!row)
            throw new NotFoundException("Checkout order not found.");
        return row;
    }
    async settle(order, payment) {
        if (order.key_id !== this.gateway.keyId())
            throw new ConflictException("Checkout key changed; school reconciliation is required.");
        if (!providerId.safeParse(payment.id).success || payment.order_id !== order.provider_order_id || payment.amount !== order.amount_paise || payment.currency !== order.currency)
            throw new BadRequestException("Payment does not match the saved invoice order.");
        // Authorization is not capture. Dashboard automatic capture or a later webhook/poll must confirm capture.
        if (payment.status !== "captured" || payment.captured !== true) {
            const state = payment.status === 'failed' ? 'failed' : 'pending';
            return this.db.transaction().execute(async (db) => {
                await this.lock(db, order.school_id);
                const changed = await sql `UPDATE fee_gateway_orders SET last_payment_status=${state},last_attempt_id=${payment.id},checked_at=now() WHERE id=${order.id}::uuid AND state='created' RETURNING id`.execute(db);
                if (changed.rows.length)
                    await enqueuePaymentEmail(db, order.id, payment.id, state);
                else {
                    const saved = (await sql `SELECT state,payment_id FROM fee_gateway_orders WHERE id=${order.id}::uuid`.execute(db)).rows[0];
                    if (saved)
                        return saved;
                }
                return { state, payment_id: null };
            });
        }
        return this.db.transaction().execute(async (db) => {
            await this.lock(db, order.school_id);
            const locked = (await sql `SELECT * FROM fee_gateway_orders WHERE id=${order.id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (locked.state !== "created") {
                if (locked.provider_payment_id !== payment.id)
                    throw new ConflictException("Another payment is already associated with this order.");
                return { state: locked.state, payment_id: locked.payment_id };
            }
            const invoice = await this.balance(db, order.school_id, order.invoice_id);
            let receipt = null;
            const state = order.amount_paise <= invoice.balance ? "captured" : "review_required";
            if (state === "captured")
                receipt = (await sql `INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
        VALUES(${order.school_id}::uuid,${order.invoice_id}::uuid,${order.amount_paise},'razorpay_test',${payment.id},${order.id}::uuid,${order.created_by}::uuid) RETURNING id`.execute(db)).rows[0].id;
            await sql `UPDATE fee_gateway_orders SET state=${state},provider_payment_id=${payment.id},payment_id=${receipt}::uuid,checked_at=now() WHERE id=${order.id}::uuid`.execute(db);
            await sql `INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${order.school_id}::uuid,${order.created_by}::uuid,${`fee.razorpay_test_${state}`},${order.id}::uuid,${JSON.stringify({ invoice_id: order.invoice_id, amount_paise: order.amount_paise, provider_payment_id: payment.id, sandbox: true })}::jsonb)`.execute(db);
            const payload = {
                student_id: invoice.student_id,
                invoice_id: order.invoice_id,
                refresh: ["fees", "parent.home", "principal.home"],
            };
            const audience = await sql `SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${order.school_id}::uuid AND is_active
        AND event_user_is_authorized(${order.school_id}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db);
            await db.insertInto("event_outbox").values({ school_id: order.school_id, event_type: "fees.updated", aggregate_type: "fee_payment", aggregate_id: order.id,
                audience_user_ids: audience.rows.map(row => row.user_id), payload, idempotency_key: `razorpay:${order.id}:${state}`, notification_user_ids: [], notification_payload: null }).execute();
            await enqueuePaymentEmail(db, order.id, payment.id, state);
            return { state, payment_id: receipt };
        });
    }
    async reconcile(order) {
        // Rotate the polling queue even on provider errors; no PII or credentials in logs.
        await sql `UPDATE fee_gateway_orders SET checked_at=now() WHERE id=${order.id}::uuid`.execute(this.db);
        if (order.key_id !== this.gateway.keyId())
            return;
        const result = await this.gateway.request(`orders/${order.provider_order_id}/payments`);
        const items = [...(result.items ?? [])].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        const captured = items.filter(payment => payment.status === 'captured');
        if (captured.length) {
            for (const payment of captured)
                await this.settle(order, payment);
        }
        else {
            const latest = items.find(payment => payment.status === 'authorized') ?? items[0];
            if (latest)
                await this.settle(order, latest);
        }
    }
    async reconcilePending() {
        const namespace = executionEnvironmentStorage.getStore()?.namespace_id ?? 'live';
        if (this.reconciling.has(namespace) || !this.gateway.enabled())
            return;
        this.reconciling.add(namespace);
        try {
            const rows = (await sql `SELECT * FROM fee_gateway_orders WHERE state='created' ORDER BY checked_at LIMIT 20`.execute(this.db)).rows;
            for (const row of rows) {
                try {
                    await this.reconcile(row);
                }
                catch {
                    this.logger.warn("Sandbox payment reconciliation deferred; will retry.");
                }
            }
        }
        catch {
            this.logger.warn("Sandbox payment reconciliation unavailable; will retry.");
        }
        finally {
            this.reconciling.delete(namespace);
        }
    }
    async webhook(rawBody, signature, eventId) {
        if (!rawBody || !eventId || eventId.length > 200)
            throw new BadRequestException("Webhook body and event ID required.");
        this.gateway.verifyWebhook(rawBody, signature);
        const hash = createHash("sha256").update(rawBody).digest("hex");
        const previous = (await sql `SELECT payload_hash FROM fee_gateway_webhooks WHERE event_id=${eventId}`.execute(this.db)).rows[0];
        if (previous) {
            if (previous.payload_hash !== hash)
                throw new ConflictException("Webhook event ID was reused.");
            return { received: true };
        }
        const event = z.object({ event: z.string(), payload: z.object({ payment: z.object({ entity: z.object({ id: providerId, order_id: providerId }) }).optional() }) }).parse(JSON.parse(rawBody.toString("utf8")));
        if (["payment.captured", "order.paid", "payment.failed", "payment.authorized"].includes(event.event) && event.payload.payment) {
            const entity = event.payload.payment.entity;
            // The account can receive payments from other applications. Ignore unknown orders.
            const row = (await sql `SELECT * FROM fee_gateway_orders WHERE provider_order_id=${entity.order_id}`.execute(this.db)).rows[0];
            if (row)
                await this.settle(row, await this.gateway.request(`payments/${entity.id}`));
        }
        await sql `INSERT INTO fee_gateway_webhooks(event_id,payload_hash) VALUES(${eventId},${hash}) ON CONFLICT DO NOTHING`.execute(this.db);
        return { received: true };
    }
};
RazorpayService = RazorpayService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, RazorpayClient])
], RazorpayService);
export { RazorpayService };
//# sourceMappingURL=razorpay.service.js.map