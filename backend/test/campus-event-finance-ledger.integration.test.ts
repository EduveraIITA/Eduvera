import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// These tests intentionally leave immutable ledger facts behind. They run only
// against a disposable database after migrations 001-019 have been applied.
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe.skipIf(!isolated)("campus-event finance ledger against disposable PostgreSQL", () => {
  let schoolId: string;
  let otherSchoolId: string;
  let actorId: string;
  let studentId: string;
  let eventId: string;
  let invoiceId: string;
  let paymentId: string;
  let creditId: string;
  let actor: AuthUser;
  let operationsDatabase: DatabaseService;
  let operations: OperationsService;

  beforeAll(async () => {
    const suffix = randomUUID();
    actorId = (await pool.query<{ id: string }>(`
      INSERT INTO users(username,email,password_hash,first_name,last_name,role)
      VALUES($1,$2,'not-used','Finance','Operator','admin') RETURNING id
    `, [`finance.${suffix}`, `finance.${suffix}@example.test`])).rows[0]!.id;
    schoolId = (await pool.query<{ id: string }>(`
      INSERT INTO schools(name,code) VALUES('Ledger Test School',$1) RETURNING id
    `, [`ledger-${suffix}`.slice(0, 32)])).rows[0]!.id;
    actor = {
      id: actorId,
      username: `finance.${suffix}`,
      email: `finance.${suffix}@example.test`,
      first_name: "Finance",
      last_name: "Operator",
      role: "admin",
      is_active: true,
      active_school_id: schoolId,
    };
    operationsDatabase = new DatabaseService();
    operations = new OperationsService(operationsDatabase);
    otherSchoolId = (await pool.query<{ id: string }>(`
      INSERT INTO schools(name,code) VALUES('Other Ledger School',$1) RETURNING id
    `, [`other-${suffix}`.slice(0, 32)])).rows[0]!.id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')", [actorId, schoolId]);

    studentId = (await pool.query<{ id: string }>(`
      INSERT INTO students(user_id,school_id,admission_number)
      VALUES($1,$2,$3) RETURNING id
    `, [actorId, schoolId, `LEDGER-${suffix}`])).rows[0]!.id;
    eventId = (await pool.query<{ id: string }>(`
      INSERT INTO campus_events(
        school_id,event_type,status,title,description,venue,starts_at,ends_at,
        audience_mode,participation_requirement,requires_rsvp,requires_guardian_consent,
        payment_required,payment_amount_paise,payment_due_on,created_by,published_by,published_at
      ) VALUES(
        $1,'excursion','published','Ledger test excursion','','Test venue',
        now()+interval '10 days',now()+interval '10 days 4 hours','students','mandatory',
        false,false,true,10000,current_date+5,$2,$2,now()
      ) RETURNING id
    `, [schoolId, actorId])).rows[0]!.id;
    invoiceId = (await pool.query<{ id: string }>(`
      INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
      VALUES($1,$2,$3,'Campus event fee',10000,current_date+5,$4) RETURNING id
    `, [schoolId, studentId, `EVT-${suffix}`, actorId])).rows[0]!.id;
    await pool.query(`
      INSERT INTO campus_event_participants(
        school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id
      ) VALUES($1,$2,$3,'mandatory','pending',$4)
    `, [schoolId, eventId, studentId, invoiceId]);
    paymentId = (await pool.query<{ id: string }>(`
      INSERT INTO fee_payments(
        school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by
      ) VALUES($1,$2,6000,'bank_transfer',$3,$4,$5) RETURNING id
    `, [schoolId, invoiceId, `PAY-${suffix}`, randomUUID(), actorId])).rows[0]!.id;
  });

  afterAll(async () => { await operationsDatabase.destroy(); await pool.end(); });

  it("atomically credits the remaining obligation when an event is cancelled", async () => {
    await pool.query(`
      UPDATE campus_events SET status='cancelled',cancelled_by=$2,cancelled_at=now(),
        cancellation_internal_reason='Venue contract was withdrawn',
        cancellation_reason='Venue became unavailable'
      WHERE id=$1
    `, [eventId, actorId]);

    const credits = await pool.query<{ id: string; amount_paise: number; source: string; request_hash: string }>(`
      SELECT id,amount_paise,source,request_hash FROM fee_invoice_credits
      WHERE school_id=$1 AND invoice_id=$2
    `, [schoolId, invoiceId]);
    expect(credits.rows).toHaveLength(1);
    expect(credits.rows[0]).toMatchObject({ amount_paise: 10000, source: "event_cancelled" });
    expect(credits.rows[0]!.request_hash).toMatch(/^[0-9a-f]{64}$/);
    creditId = credits.rows[0]!.id;
  });

  it("removes credited invoices from the operations collectible balance", async () => {
    const fees = await operations.fees(actor, schoolId) as {
      invoices: Array<{
        id: string;
        credited_paise: number;
        adjusted_amount_paise: number;
        balance_paise: number;
        collection_state: string;
      }>;
    };
    expect(fees.invoices.find((item) => item.id === invoiceId)).toMatchObject({
      credited_paise: 10_000,
      adjusted_amount_paise: 0,
      balance_paise: 0,
      collection_state: "refund_due",
    });
    await expect(operations.payment(actor, schoolId, invoiceId, {
      amount_paise: 100,
      method: "cash",
      reference: `AFTER-CREDIT-${randomUUID()}`,
      idempotency_key: randomUUID(),
    })).rejects.toThrow(/credited.*no collectible balance/i);
  });

  it("records a withdrawal proof before its credit and cannot over-credit the invoice", async () => {
    const suffix = randomUUID();
    const withdrawnEventId = (await pool.query<{ id: string }>(`
      INSERT INTO campus_events(
        school_id,event_type,status,title,description,venue,starts_at,ends_at,
        audience_mode,participation_requirement,requires_rsvp,requires_guardian_consent,
        payment_required,payment_amount_paise,payment_due_on,created_by,published_by,published_at
      ) VALUES(
        $1,'workshop','published','Paid optional workshop','','Lab',
        now()+interval '20 days',now()+interval '20 days 2 hours','students','optional',
        true,false,true,10000,current_date+10,$2,$2,now()
      ) RETURNING id
    `, [schoolId, actorId])).rows[0]!.id;
    const withdrawnInvoiceId = (await pool.query<{ id: string }>(`
      INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
      VALUES($1,$2,$3,'Optional workshop fee',10000,current_date+10,$4) RETURNING id
    `, [schoolId, studentId, `WITHDRAW-${suffix}`, actorId])).rows[0]!.id;
    await pool.query(`
      INSERT INTO campus_event_participants(
        school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id
      ) VALUES($1,$2,$3,'optional','accepted',$4)
    `, [schoolId, withdrawnEventId, studentId, withdrawnInvoiceId]);
    const withdrawalKey = randomUUID();
    const withdrawalHash = digest({ withdrawnEventId, studentId, reason: "Family schedule changed" });
    const withdrawalId = (await pool.query<{ id: string }>(`
      INSERT INTO campus_event_participant_withdrawals(
        school_id,event_id,student_id,reason,idempotency_key,request_hash,withdrawn_by
      ) VALUES($1,$2,$3,'Family schedule changed',$4,$5,$6) RETURNING id
    `, [schoolId, withdrawnEventId, studentId, withdrawalKey, withdrawalHash, actorId])).rows[0]!.id;

    await expect(pool.query(`
      INSERT INTO fee_invoice_credits(
        school_id,invoice_id,event_id,student_id,participant_withdrawal_id,amount_paise,
        source,reason,idempotency_key,request_hash,recorded_by
      ) VALUES($1,$2,$3,$4,$5,10001,'participant_withdrawn','Family schedule changed',$6,$7,$8)
    `, [
      schoolId, withdrawnInvoiceId, withdrawnEventId, studentId, withdrawalId,
      randomUUID(), digest("too much credit"), actorId,
    ])).rejects.toThrow(/credits exceed/i);

    await pool.query(`
      INSERT INTO fee_invoice_credits(
        school_id,invoice_id,event_id,student_id,participant_withdrawal_id,amount_paise,
        source,reason,idempotency_key,request_hash,recorded_by
      ) VALUES($1,$2,$3,$4,$5,10000,'participant_withdrawn','Family schedule changed',$6,$7,$8)
    `, [schoolId, withdrawnInvoiceId, withdrawnEventId, studentId, withdrawalId, withdrawalKey, withdrawalHash, actorId]);
    await expect(pool.query(
      "UPDATE campus_event_participant_withdrawals SET reason='rewritten' WHERE id=$1",
      [withdrawalId],
    )).rejects.toThrow(/append-only/i);

    await pool.query(`
      UPDATE campus_events SET status='cancelled',cancelled_by=$2,cancelled_at=now(),
        cancellation_internal_reason='Workshop cancelled after withdrawal',
        cancellation_reason='Workshop cancelled after withdrawal'
      WHERE id=$1
    `, [withdrawnEventId, actorId]);
    const total = await pool.query<{ amount: string; entries: number }>(`
      SELECT COALESCE(sum(amount_paise),0)::text AS amount,count(*)::int AS entries
      FROM fee_invoice_credits WHERE invoice_id=$1
    `, [withdrawnInvoiceId]);
    expect(total.rows[0]).toMatchObject({ amount: "10000", entries: 1 });
  });

  it("serializes competing credit sources against one invoice", async () => {
    const suffix = randomUUID();
    const concurrentEventId = (await pool.query<{ id: string }>(`
      INSERT INTO campus_events(
        school_id,event_type,status,title,description,venue,starts_at,ends_at,
        audience_mode,participation_requirement,requires_rsvp,requires_guardian_consent,
        payment_required,payment_amount_paise,payment_due_on,created_by,published_by,published_at,
        cancelled_by,cancelled_at,cancellation_internal_reason,cancellation_reason
      ) VALUES(
        $1,'excursion','cancelled','Concurrent credit test','','Test venue',
        now()+interval '30 days',now()+interval '30 days 2 hours','students','mandatory',
        false,false,true,10000,current_date+15,$2,$2,now(),$2,now(),'Concurrent credit reconciliation','Test cancellation'
      ) RETURNING id
    `, [schoolId, actorId])).rows[0]!.id;
    const concurrentInvoiceId = (await pool.query<{ id: string }>(`
      INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
      VALUES($1,$2,$3,'Concurrent credit fee',10000,current_date+15,$4) RETURNING id
    `, [schoolId, studentId, `CONCURRENT-${suffix}`, actorId])).rows[0]!.id;
    await pool.query(`
      INSERT INTO campus_event_participants(
        school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id
      ) VALUES($1,$2,$3,'mandatory','pending',$4)
    `, [schoolId, concurrentEventId, studentId, concurrentInvoiceId]);
    const withdrawalId = (await pool.query<{ id: string }>(`
      INSERT INTO campus_event_participant_withdrawals(
        school_id,event_id,student_id,reason,idempotency_key,request_hash,withdrawn_by
      ) VALUES($1,$2,$3,'Concurrent reconciliation test',$4,$5,$6) RETURNING id
    `, [schoolId, concurrentEventId, studentId, randomUUID(), digest(suffix), actorId])).rows[0]!.id;
    const credit = (source: "event_cancelled" | "participant_withdrawn") => pool.query(`
      INSERT INTO fee_invoice_credits(
        school_id,invoice_id,event_id,student_id,participant_withdrawal_id,amount_paise,
        source,reason,idempotency_key,request_hash,recorded_by
      ) VALUES($1,$2,$3,$4,$5,6000,$6,'Concurrent reconciliation test',$7,$8,$9)
      RETURNING id
    `, [
      schoolId, concurrentInvoiceId, concurrentEventId, studentId,
      source === "participant_withdrawn" ? withdrawalId : null, source,
      randomUUID(), digest({ suffix, source }), actorId,
    ]);

    const results = await Promise.allSettled([credit("event_cancelled"), credit("participant_withdrawn")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const total = await pool.query<{ amount: string }>(`
      SELECT COALESCE(sum(amount_paise),0)::text AS amount FROM fee_invoice_credits
      WHERE invoice_id=$1
    `, [concurrentInvoiceId]);
    expect(total.rows[0]!.amount).toBe("6000");
  });

  it("serializes concurrent refunds and never returns more than was paid", async () => {
    const refund = (amount: number, reference: string) => pool.query(`
      INSERT INTO fee_refunds(
        school_id,invoice_id,credit_id,event_id,student_id,amount_paise,method,
        reference,reason,idempotency_key,request_hash,recorded_by
      ) VALUES($1,$2,$3,$4,$5,$6,'bank_transfer',$7,'Event cancellation refund',$8,$9,$10)
      RETURNING id
    `, [
      schoolId, invoiceId, creditId, eventId, studentId, amount, reference,
      randomUUID(), digest({ invoiceId, amount, reference }), actorId,
    ]);

    const results = await Promise.allSettled([
      refund(4000, `REFUND-A-${randomUUID()}`),
      refund(4000, `REFUND-B-${randomUUID()}`),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const total = await pool.query<{ amount: string }>(`
      SELECT COALESCE(sum(amount_paise),0)::text AS amount FROM fee_refunds
      WHERE school_id=$1 AND invoice_id=$2
    `, [schoolId, invoiceId]);
    expect(Number(total.rows[0]!.amount)).toBe(4000);
  });

  it("rejects cross-tenant linkage and protects every reconciliation fact", async () => {
    await expect(pool.query(`
      INSERT INTO fee_refunds(
        school_id,invoice_id,credit_id,event_id,student_id,amount_paise,method,
        reference,reason,idempotency_key,request_hash,recorded_by
      ) VALUES($1,$2,$3,$4,$5,1,'cash','CROSS-TENANT','Invalid tenant link',$6,$7,$8)
    `, [otherSchoolId, invoiceId, creditId, eventId, studentId, randomUUID(), digest("cross-tenant"), actorId])).rejects.toThrow();
    await expect(pool.query("UPDATE fee_invoice_credits SET reason='rewritten' WHERE id=$1", [creditId]))
      .rejects.toThrow(/append-only/i);
    await expect(pool.query("DELETE FROM fee_refunds WHERE invoice_id=$1", [invoiceId]))
      .rejects.toThrow(/append-only/i);
    await expect(pool.query("UPDATE fee_payments SET amount_paise=1 WHERE id=$1", [paymentId]))
      .rejects.toThrow(/cannot be updated or deleted/i);
  });
});
