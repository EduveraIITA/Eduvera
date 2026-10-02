import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { FeeReviewService } from "../src/operations/fee-review.service.js";
import type { AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const url = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
describe.skipIf(!isolated)("fee payment claims and review", () => {
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
  const claim = (reference: string = randomUUID()) => ({ kind: "payment", amount_paise: 4000, method: "bank_transfer", reference, note: "Transferred today", idempotency_key: randomUUID() });
  const approve = { outcome: "verified", response: "Matched against the school bank statement.", verified_funds: true };
  beforeAll(async () => {
    db = new DatabaseService(); operations = new OperationsService(db); service = new FeeReviewService(db, operations);
    admin = await user("admin"); parent = await user("parent"); outsider = await user("parent"); learner = await user("student");
    school = (await pool.query("INSERT INTO schools(name,code) VALUES('Review Test School',$1) RETURNING id", [randomUUID().slice(0, 25)])).rows[0].id;
    for (const [actor, role] of [[admin, "admin"], [parent, "guardian"], [outsider, "guardian"], [learner, "student"]] as const) await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)", [school, actor.id, role]);
    student = (await pool.query("INSERT INTO students(user_id,school_id,admission_number) VALUES($1,$2,$3) RETURNING id", [learner.id, school, randomUUID()])).rows[0].id;
    const p = (await pool.query("INSERT INTO parents(user_id) VALUES($1) RETURNING id", [parent.id])).rows[0].id;
    await pool.query("INSERT INTO guardian_relationships(school_id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'guardian')", [school, student, p]);
  });
  afterAll(async () => { await db?.destroy(); await pool.end(); });
  it("restricts submissions to active linked guardians, and school-wide reads to finance staff", async () => {
    const id = await invoice();
    await expect(service.submit(outsider, school, id, claim())).rejects.toThrow(/guardian/);
    await expect(service.submit(learner, school, id, claim())).rejects.toThrow(/guardian/);
    await expect(service.workspace(parent, school)).rejects.toThrow(/permission/);
    await expect(service.workspace(outsider, school, student)).rejects.toThrow(/permission/);
    await expect(service.submit(parent, randomUUID(), id, claim())).rejects.toThrow(/not found/);
    expect((await service.workspace(learner, school, student)).can_submit).toBe(false);
    expect((await service.workspace(parent, school, student)).can_submit).toBe(true);
  });
  it("keeps submissions out of the ledger and replays only an identical idempotent request", async () => {
    const id = await invoice(); const input = claim(); const first = await service.submit(parent, school, id, input);
    expect(await service.submit(parent, school, id, input)).toEqual(first);
    await expect(service.submit(parent, school, id, { ...input, amount_paise: 3000 })).rejects.toThrow(/different/);
    await expect(service.submit(parent, school, id, claim())).rejects.toThrow(/pending/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
    const outbox = await pool.query("SELECT audience_user_ids,payload FROM event_outbox WHERE aggregate_id=$1", [first.id]);
    expect(outbox.rows[0].audience_user_ids).toContain(parent.id);
    expect(outbox.rows[0].audience_user_ids).not.toContain(outsider.id);
    expect(outbox.rows[0].payload).not.toHaveProperty("reference");
  });
  it("requires finance permission and verified funds, then atomically creates exactly one receipt", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    await expect(service.decide(parent, school, request.id, approve)).rejects.toThrow(/permission/);
    await expect(service.decide(admin, school, request.id, { ...approve, verified_funds: false })).rejects.toThrow(/Confirm/);
    const result = await service.decide(admin, school, request.id, approve);
    expect(result.payment_id).toBeTruthy();
    expect((await service.decide(admin, school, request.id, approve)).payment_id).toBe(result.payment_id);
    await expect(service.decide(admin, school, request.id, { outcome: "rejected", response: "Another reviewer disagreed." })).rejects.toThrow(/already reviewed/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(1);
    const ledger = await service.workspace(parent, school, student);
    expect(ledger.invoices.find((item: unknown) => (item as { id: string }).id === id)).toMatchObject({ balance_paise: 6000 });
  });
  it("serializes competing reviewers and keeps one final decision", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    const results = await Promise.allSettled([
      service.decide(admin, school, request.id, approve),
      service.decide(admin, school, request.id, { outcome: "rejected", response: "Competing reviewer cannot match payment." }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_review_decisions WHERE request_id=$1", [request.id])).rows[0].count).toBe(1);
  });
  it("allows delegated finance review but prevents self-verification", async () => {
    const reviewer = await user("staff");
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'staff')", [school, reviewer.id]);
    const request = await service.submit(parent, school, await invoice(), claim());
    await expect(service.decide(reviewer, school, request.id, approve)).rejects.toThrow(/permission/);
    await pool.query("INSERT INTO school_permission_grants(school_id,user_id,permission) VALUES($1,$2,'fees.manage')", [school, reviewer.id]);
    await service.decide(reviewer, school, request.id, approve);
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')", [school, parent.id]);
    const own = await service.submit(parent, school, await invoice(), claim());
    await expect(service.decide(parent, school, own.id, approve)).rejects.toThrow(/own submission/);
    await pool.query("DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin'", [school, parent.id]);
  });
  it("rejects case-insensitive duplicate references across invoices", async () => {
    const reference = `BANK-${randomUUID()}`;
    await service.submit(parent, school, await invoice(), claim(reference));
    await expect(service.submit(parent, school, await invoice(), claim(reference.toLowerCase()))).rejects.toThrow(/reference/);
  });
  it("blocks overpayments and stale approvals without writing a receipt or decision", async () => {
    await expect(service.submit(parent, school, await invoice(1000), claim())).rejects.toThrow(/exceeds/);
    const id = await invoice(); const request = await service.submit(parent, school, id, claim());
    await operations.payment(admin, school, id, { amount_paise: 8000, method: "cash", reference: randomUUID(), idempotency_key: randomUUID() });
    await expect(service.decide(admin, school, request.id, approve)).rejects.toThrow(/balance changed/);
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_review_decisions WHERE request_id=$1", [request.id])).rows[0].count).toBe(0);
  });
  it("allows rejection then corrected resubmission without reducing the balance", async () => {
    const id = await invoice(); const input = claim(); const request = await service.submit(parent, school, id, input);
    await service.decide(admin, school, request.id, { outcome: "rejected", response: "Transaction not found in bank statement." });
    await service.submit(parent, school, id, { ...input, idempotency_key: randomUUID(), note: "Corrected details" });
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
  });
  it("answers fee questions without claiming an adjustment or issuing a payment", async () => {
    const id = await invoice(); const request = await service.submit(parent, school, id, { kind: "charge", note: "Please explain the transport charge", idempotency_key: randomUUID() });
    await expect(service.decide(admin, school, request.id, approve)).rejects.toThrow(/appropriate/);
    await service.decide(admin, school, request.id, { outcome: "answered", response: "Transport covers the first term only." });
    expect((await pool.query("SELECT count(*)::int AS count FROM fee_payments WHERE invoice_id=$1", [id])).rows[0].count).toBe(0);
    await expect(pool.query("DELETE FROM fee_review_requests WHERE id=$1", [request.id])).rejects.toThrow(/cannot/);
    await expect(pool.query("UPDATE fee_review_decisions SET response='changed' WHERE request_id=$1", [request.id])).rejects.toThrow(/cannot/);
  });
  it("protects payment instructions with administrator authorization and revision checks", async () => {
    const settings = { payee_name: "Review School", upi_id: "school@bank", instructions: "Use invoice reference in the transfer note.", expected_revision: 0 };
    await expect(service.settings(parent, school, settings)).rejects.toThrow(/permission/);
    await service.settings(admin, school, settings);
    await expect(service.settings(admin, school, settings)).rejects.toThrow(/changed/);
    expect((await service.workspace(parent, school, student)).payment_settings).toMatchObject({ upi_id: "school@bank", revision: 1 });
  });
  it("revoked guardian links cannot read fee events or submit new claims", async () => {
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [school, parent.id]);
    const result = await pool.query("SELECT event_user_is_authorized($1,'fees.updated',$2::jsonb,$3) AS allowed", [school, JSON.stringify({ student_id: student }), parent.id]);
    expect(result.rows[0].allowed).toBe(false);
    await expect(service.submit(parent, school, await invoice(), claim())).rejects.toThrow(/guardian/);
  });
});
