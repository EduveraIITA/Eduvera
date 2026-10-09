import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { FeeReviewService } from "../src/operations/fee-review.service.js";
import type { AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { RazorpayClient, type RazorpayPayment } from "../src/operations/razorpay.client.js";
import { RazorpayService } from "../src/operations/razorpay.service.js";
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const url = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
describe.skipIf(!isolated)("Razorpay sandbox invoice integration", () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  let db: DatabaseService; let service: FeeReviewService; let operations: OperationsService;
  let school: string; let student: string; let parent: AuthUser; let admin: AuthUser; let outsider: AuthUser; let learner: AuthUser;
  async function user(role: AuthUser["role"]): Promise<AuthUser> {
    const id = randomUUID(); const name = `fees-${id}`;
    await pool.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'unused','Fee','Tester',$4)", [id, name, `${name}@example.test`, role]);
    return { id, username: name, email: `${name}@example.test`, first_name: "Fee", last_name: "Tester", role, is_active: true };
  }
  async function invoice(amount = 10000) {
    return (await pool.query("INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by) VALUES($1,$2,$3,'Tuition', $4,current_date,$5) RETURNING id", [school, student, randomUUID(), amount, admin.id])).rows[0].id as string;
  }
  const gateway = new RazorpayClient();
  let payments: RazorpayService;
  const providerPayment = (order: { order_id: string; amount: number }, overrides: Partial<RazorpayPayment> = {}): RazorpayPayment => ({ id: `pay_${randomUUID().replaceAll("-", "")}`, order_id: order.order_id, amount: order.amount, currency: "INR", status: "captured", captured: true, ...overrides });
  async function confirm(id: string, order: { order_id: string; amount: number }, payment = providerPayment(order)) {
    vi.spyOn(gateway, "request").mockResolvedValue(payment);
    return payments.verify(parent, school, id, { razorpay_order_id: order.order_id, razorpay_payment_id: payment.id, razorpay_signature: "a".repeat(64) });
  }
  const claim = (reference: string = randomUUID()) => ({ kind: "payment", amount_paise: 4000, method: "bank_transfer", reference, note: "Transferred today", idempotency_key: randomUUID() });

  beforeAll(async () => {
    db = new DatabaseService(); operations = new OperationsService(db); service = new FeeReviewService(db, operations);
    payments = new RazorpayService(db, gateway);
    vi.spyOn(gateway, "enabled").mockReturnValue(true);
    vi.spyOn(gateway, "keyId").mockReturnValue("rzp_test_fixture");
    vi.spyOn(gateway, "verify").mockImplementation(() => {});
    vi.spyOn(gateway, "request").mockImplementation((_path, body) => Promise.resolve(Object.assign({}, body, { id: `order_${randomUUID().replaceAll("-", "")}` })));
    admin = await user("admin"); parent = await user("parent"); outsider = await user("parent"); learner = await user("student");
    school = (await pool.query("INSERT INTO schools(name,code) VALUES('Review Test School',$1) RETURNING id", [randomUUID().slice(0, 25)])).rows[0].id;
    for (const [actor, role] of [[admin, "admin"], [parent, "guardian"], [outsider, "guardian"], [learner, "student"]] as const) await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)", [school, actor.id, role]);
    student = (await pool.query("INSERT INTO students(user_id,school_id,admission_number) VALUES($1,$2,$3) RETURNING id", [learner.id, school, randomUUID()])).rows[0].id;
    const p = (await pool.query("INSERT INTO parents(user_id) VALUES($1) RETURNING id", [parent.id])).rows[0].id;
    await pool.query("INSERT INTO guardian_relationships(school_id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'guardian')", [school, student, p]);
  });
  afterAll(async () => { await db?.destroy(); await pool.end(); });
  it("rejects other families, students and cross-school checkout", async () => {
    const id = await invoice();
    for (const actor of [outsider, learner]) await expect(payments.create(actor, school, id, { amount_paise: 1000 })).rejects.toThrow(/guardian/);
    await expect(payments.create(parent, randomUUID(), id, { amount_paise: 1000 })).rejects.toThrow(/guardian/);
    await expect(payments.create(parent, school, id, { amount_paise: 10001 })).rejects.toThrow(/balance/);
    await expect(payments.create(parent, school, id, { amount_paise: 99 })).rejects.toThrow();
  });
  it("reuses an invoice checkout across retries and rejects changed amounts", async () => {
    const id = await invoice(); const first = await payments.create(parent, school, id, { amount_paise: 2000 });
    expect(await payments.create(parent, school, id, { amount_paise: 2000 })).toEqual(first);
    await expect(payments.create(parent, school, id, { amount_paise: 1000 })).rejects.toThrow(/existing checkout/);
  });
  it("blocks checkout when an offline claim is pending", async () => {
    const id = await invoice(); await service.submit(parent, school, id, claim());
    await expect(payments.create(parent, school, id, { amount_paise: 2000 })).rejects.toThrow(/awaiting school/);
  });
  it("never trusts authorization, wrong amounts, currency or another provider order", async () => {
    const id = await invoice(); const order = await payments.create(parent, school, id, { amount_paise: 2000 });
    for (const mismatch of [{ amount: 1999 }, { currency: "USD" }, { order_id: "order_elsewhere" }]) await expect(confirm(id, order, providerPayment(order, mismatch))).rejects.toThrow(/match/);
    expect(await confirm(id, order, providerPayment(order, { status: "authorized", captured: false }))).toEqual({ state: "pending", payment_id: null });
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
    const captured = providerPayment(order);
    const [one, two] = await Promise.all([confirm(id, order, captured), confirm(id, order, captured)]);
    expect(one).toEqual(two); expect(one.state).toBe("captured");
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(1);
    const event = (await pool.query("SELECT audience_user_ids,payload FROM event_outbox WHERE aggregate_id=$1", [order.id])).rows[0];
    expect(event.audience_user_ids).toContain(parent.id); expect(event.audience_user_ids).not.toContain(outsider.id);
    expect(event.payload).not.toHaveProperty("provider_payment_id");
  });
  it("preserves captured funds for review when another payment changes the balance", async () => {
    vi.spyOn(gateway, "request").mockImplementation((_path, body) => Promise.resolve(Object.assign({}, body, { id: `order_${randomUUID().replaceAll("-", "")}` })));
    const id = await invoice(); const order = await payments.create(parent, school, id, { amount_paise: 10000 });
    await operations.payment(admin, school, id, { amount_paise: 10000, method: "cash", reference: "counter", idempotency_key: randomUUID() });
    expect((await confirm(id, order)).state).toBe("review_required");
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(1);
  });
  it("deduplicates signed webhook deliveries and rejects event ID reuse", async () => {
    vi.spyOn(gateway, "request").mockImplementation((_path, body) => Promise.resolve(Object.assign({}, body, { id: `order_${randomUUID().replaceAll("-", "")}` })));
    const id = await invoice(); const order = await payments.create(parent, school, id, { amount_paise: 3000 });
    const payment = providerPayment(order);
    vi.spyOn(gateway, "verifyWebhook").mockImplementation(() => {});
    vi.spyOn(gateway, "request").mockResolvedValue(payment);
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: payment } } }));
    const eventId = randomUUID();
    expect(await payments.webhook(raw, "test-signature", eventId)).toEqual({ received: true });
    expect(await payments.webhook(raw, "test-signature", eventId)).toEqual({ received: true });
    await expect(payments.webhook(Buffer.from(raw.toString() + " "), "test-signature", eventId)).rejects.toThrow(/reused/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(1);
  });
  it("recovers missed callbacks through the status endpoint and rejects revoked guardians", async () => {
    vi.spyOn(gateway, "request").mockImplementation((_path, body) => Promise.resolve(Object.assign({}, body, { id: `order_${randomUUID().replaceAll("-", "")}` })));
    const id = await invoice(); const order = await payments.create(parent, school, id, { amount_paise: 3000 });
    vi.spyOn(gateway, "request").mockResolvedValue({ items: [providerPayment(order)] });
    const result = await payments.status(parent, school, id);
    expect(result[0]).toMatchObject({ state: "captured" });
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [school, parent.id]);
    await expect(payments.status(parent, school, id)).rejects.toThrow(/guardian/);
  });
});
