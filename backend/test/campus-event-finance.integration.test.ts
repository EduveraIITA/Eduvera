import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampusEventFinanceService } from "../src/campus-events/campus-event-finance.service.js";
import { CampusEventsService } from "../src/campus-events/campus-events.service.js";
import type { CampusEventDto } from "../src/campus-events/contracts.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const request = (user: AuthUser): AuthenticatedRequest => ({
  authUser: user,
  requestId: randomUUID(),
  sessionHash: "campus-event-finance-integration",
  csrfToken: "campus-event-finance-integration",
  protocol: "http",
  headers: { host: "localhost" },
  ip: "127.0.0.1",
} as AuthenticatedRequest);

describe.skipIf(!isolated)("campus-event withdrawal and manual refund service", () => {
  let database: DatabaseService;
  let events: CampusEventsService;
  let finance: CampusEventFinanceService;
  let schoolId: string;
  let studentId: string;
  let eventId: string;
  let invoiceId: string;
  let guardian: AuthenticatedRequest;
  let principal: AuthenticatedRequest;
  let dutyStaff: AuthenticatedRequest;
  let feeManager: AuthenticatedRequest;

  beforeAll(async () => {
    database = new DatabaseService();
    const schoolEvents = new SchoolEventService(database);
    events = new CampusEventsService(database, schoolEvents);
    finance = new CampusEventFinanceService(database, schoolEvents);

    schoolId = (await pool.query<{ id: string }>("SELECT id FROM schools WHERE code='cis'")).rows[0]!.id;
    const users = (await pool.query<AuthUser & { username: string }>(`
      SELECT account.*, $1::uuid AS active_school_id
      FROM users account
      WHERE account.username IN ('meera.principal','pooja.parent','vikram.singh','ritu.malhotra')
    `, [schoolId])).rows;
    principal = request(users.find((user) => user.username === "meera.principal")!);
    guardian = request(users.find((user) => user.username === "pooja.parent")!);
    dutyStaff = request(users.find((user) => user.username === "vikram.singh")!);
    feeManager = request(users.find((user) => user.username === "ritu.malhotra")!);
    await pool.query(`
      INSERT INTO school_permission_grants(school_id,user_id,permission)
      VALUES($1,$2,'fees.manage')
      ON CONFLICT(school_id,user_id,permission) DO NOTHING
    `, [schoolId, feeManager.authUser.id]);
    studentId = (await pool.query<{ id: string }>(`
      SELECT student.id FROM students student
      JOIN users account ON account.id=student.user_id
      WHERE student.school_id=$1 AND account.username='aarav.student'
    `, [schoolId])).rows[0]!.id;

    const startsAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    startsAt.setUTCHours(4, 30, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
    const dueOn = new Date(startsAt.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const draft = await events.create(principal, {
      school_id: schoolId,
      idempotency_key: randomUUID(),
      event_type: "workshop",
      subject_id: null,
      title: `Finance reconciliation workshop ${randomUUID()}`,
      description: "A disposable integration fixture for paid-event reconciliation.",
      venue: "Innovation Lab",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience: { mode: "students", class_section_ids: [], student_ids: [studentId] },
      participation_requirement: "optional",
      requires_rsvp: true,
      requires_guardian_consent: false,
      payment_required: true,
      payment_amount_paise: 10_000,
      payment_due_on: dueOn,
      payment_currency: "INR",
      sessions: [{
        title: "Workshop programme",
        session_type: "activity",
        venue: "Innovation Lab",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        attendance_mode: "none",
        participant_student_ids: [],
      }],
      checklist: [{ label: "Notebook", required: true }],
      staff: [{ user_id: dutyStaff.authUser.id, role: "duty_staff" }],
    });
    const published = await events.publish(principal, draft.id, {
      school_id: schoolId,
      expected_revision: draft.revision,
      idempotency_key: randomUUID(),
    }) as CampusEventDto;
    eventId = published.id;
    const accepted = await events.rsvp(guardian, eventId, {
      school_id: schoolId,
      student_id: studentId,
      status: "accepted",
      expected_revision: 0,
      idempotency_key: randomUUID(),
    });
    invoiceId = accepted.viewer_participants[0]!.fee_invoice_id!;
    await pool.query(`
      INSERT INTO fee_payments(
        school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by
      ) VALUES($1,$2,6000,'bank_transfer',$3,$4,$5)
    `, [schoolId, invoiceId, `FINANCE-TEST-${randomUUID()}`, randomUUID(), principal.authUser.id]);
  });

  afterAll(async () => {
    await database?.destroy();
    await pool.end();
  });

  it("withdraws once, credits the immutable invoice, and emits durable audit and update facts", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      school_id: schoolId,
      student_id: studentId,
      reason: "Family travel now overlaps the workshop",
      idempotency_key: idempotencyKey,
    };
    const result = await finance.withdraw(guardian, eventId, input);
    expect(result.items[0]).toMatchObject({
      participation_state: "withdrawn",
      finance_state: "refund_due",
      invoice_amount_paise: 10_000,
      credited_paise: 10_000,
      paid_paise: 6_000,
      refunded_paise: 0,
      collectible_balance_paise: 0,
      refund_due_paise: 6_000,
      can_withdraw: false,
    });

    const retry = await finance.withdraw(guardian, eventId, input);
    expect(retry).toEqual(result);
    await expect(finance.withdraw(guardian, eventId, { ...input, reason: "Different retry payload" }))
      .rejects.toThrow(/request key was already used/i);

    const facts = (await pool.query<{
      withdrawals: string; credits: string; audits: string; outbox: string; leaked_student_ids: string; roster_rows: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM campus_event_participant_withdrawals WHERE event_id=$1 AND student_id=$2) withdrawals,
        (SELECT count(*)::text FROM fee_invoice_credits WHERE event_id=$1 AND student_id=$2) credits,
        (SELECT count(*)::text FROM audit_events WHERE action='campus_event.participant_withdrawn' AND target_id=$1) audits,
        (SELECT count(*)::text FROM event_outbox WHERE event_type='campus_event.updated' AND aggregate_id=$1
          AND payload->>'change_kind'='participant_withdrawn') outbox,
        (SELECT count(*)::text FROM event_outbox WHERE event_type='campus_event.updated' AND aggregate_id=$1
          AND payload->>'change_kind'='participant_withdrawn' AND payload ? 'student_id') leaked_student_ids,
        (SELECT count(*)::text FROM campus_event_session_participants WHERE event_id=$1 AND student_id=$2) roster_rows
    `, [eventId, studentId])).rows[0]!;
    expect(facts).toEqual({ withdrawals: "1", credits: "1", audits: "1", outbox: "1", leaked_student_ids: "0", roster_rows: "0" });

    const delivery = (await pool.query<{
      audience_user_ids: string[];
      payload: Record<string, unknown>;
      replay_authorized: boolean;
      unrelated_change_authorized: boolean;
    }>(`
      SELECT event_outbox.audience_user_ids,event_outbox.payload,
        event_user_is_authorized(
          event_outbox.school_id,event_outbox.event_type,event_outbox.payload,$2::uuid
        ) AS replay_authorized,
        event_user_is_authorized(
          event_outbox.school_id,event_outbox.event_type,
          jsonb_build_object('event_id',$1::uuid::text,'change_kind','checklist'),$2::uuid
        ) AS unrelated_change_authorized
      FROM event_outbox
      WHERE event_outbox.event_type='campus_event.updated' AND event_outbox.aggregate_id=$1::uuid
        AND event_outbox.payload->>'change_kind'='participant_withdrawn'
    `, [eventId, feeManager.authUser.id])).rows[0]!;
    expect(delivery.audience_user_ids).toContain(feeManager.authUser.id);
    expect(delivery.payload).not.toHaveProperty("student_id");
    expect(delivery.replay_authorized).toBe(true);
    expect(delivery.unrelated_change_authorized).toBe(false);

    const managerView = await finance.finance(feeManager.authUser, eventId, schoolId);
    expect(managerView.permissions).toEqual({ can_view_finance_details: true, can_record_refund: true });
    expect(managerView.items[0]).toMatchObject({
      student_id: studentId,
      invoice_id: invoiceId,
      finance_state: "refund_due",
      paid_paise: 6_000,
      refund_due_paise: 6_000,
    });
  });

  it("returns no per-child ledger projection to ordinary assigned staff", async () => {
    const result = await finance.finance(dutyStaff.authUser, eventId, schoolId);
    expect(result.permissions).toEqual({ can_view_finance_details: false, can_record_refund: false });
    expect(result.items).toEqual([]);
    expect(result.counts).toEqual({ reconciliation_required: 0, withdrawn: 0 });
    await expect(finance.refund(dutyStaff, eventId, {
      school_id: schoolId,
      student_id: studentId,
      amount_paise: 100,
      method: "cash",
      reference: "NOT-ALLOWED",
      reason: "Should not be accepted",
      idempotency_key: randomUUID(),
    })).rejects.toThrow(/fee-management permission/i);
  });

  it("records partial manual refunds idempotently without claiming gateway execution", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      school_id: schoolId,
      student_id: studentId,
      amount_paise: 4_000,
      method: "bank_transfer" as const,
      reference: `UTR-${randomUUID()}`,
      reason: "Returned by the school office after withdrawal",
      idempotency_key: idempotencyKey,
    };
    const partial = await finance.refund(principal, eventId, input);
    expect(partial.items[0]).toMatchObject({
      finance_state: "partially_refunded",
      refunded_paise: 4_000,
      refund_due_paise: 2_000,
    });
    expect(partial.items[0]!.refunds[0]).toMatchObject({
      amount_paise: 4_000,
      method: "bank_transfer",
      reference: input.reference,
    });
    expect(await finance.refund(principal, eventId, input)).toEqual(partial);
    await expect(finance.refund(principal, eventId, {
      ...input,
      idempotency_key: randomUUID(),
      amount_paise: 2_001,
      reference: `UTR-${randomUUID()}`,
    })).rejects.toThrow(/exceeds the remaining manual refund due/i);

    const complete = await finance.refund(principal, eventId, {
      ...input,
      idempotency_key: randomUUID(),
      amount_paise: 2_000,
      reference: `UTR-${randomUUID()}`,
    });
    expect(complete.items[0]).toMatchObject({ finance_state: "refunded", refunded_paise: 6_000, refund_due_paise: 0 });
    expect(complete.counts.reconciliation_required).toBe(0);

    const emitted = await pool.query<{ audits: string; outbox: string; leaked_student_ids: string }>(`
      SELECT
        (SELECT count(*)::text FROM audit_events WHERE action='campus_event.refund_recorded' AND target_id=$1) audits,
        (SELECT count(*)::text FROM event_outbox WHERE event_type='campus_event.updated' AND aggregate_id=$1
          AND payload->>'change_kind'='refund_recorded') outbox,
        (SELECT count(*)::text FROM event_outbox WHERE event_type='campus_event.updated' AND aggregate_id=$1
          AND payload->>'change_kind'='refund_recorded' AND payload ? 'student_id') leaked_student_ids
    `, [eventId]);
    expect(emitted.rows[0]).toEqual({ audits: "2", outbox: "2", leaked_student_ids: "0" });
  });
});
