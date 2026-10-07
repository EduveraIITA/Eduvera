import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { effectiveSchoolAccess } from "../roles/authorization.js";
import { SchoolEventService } from "../school/school-event.service.js";
import {
  campusEventFinanceIdSchema,
  campusEventFinanceQuerySchema,
  recordEventRefundSchema,
  withdrawFromPaidEventSchema,
  type EventFinanceParticipantDto,
  type EventFinanceResponse,
  type EventFinanceState,
} from "./campus-event-finance.contracts.js";

type Db = Kysely<Database> | Transaction<Database>;
type MemberRole = "student" | "guardian" | "staff" | "admin";

interface EventFinanceEventRow {
  id: string;
  school_id: string;
  title: string;
  status: "draft" | "published" | "cancelled" | "completed";
  starts_at: Date;
  revision: number;
  payment_required: boolean;
  participation_requirement: "optional" | "mandatory";
}

interface FinanceRow {
  student_id: string;
  student_name: string;
  admission_number: string;
  avatar_url: string | null;
  rsvp_status: "pending" | "accepted" | "declined";
  invoice_id: string | null;
  invoice_amount_paise: number;
  credited_paise: number;
  paid_paise: number;
  refunded_paise: number;
  withdrawal_id: string | null;
  withdrawn_at: Date | null;
}

interface RefundRow {
  id: string;
  student_id: string;
  amount_paise: number;
  method: "cash" | "bank_transfer" | "cheque";
  reference: string;
  reason: string;
  created_at: Date;
}

interface FinanceAccess {
  role: MemberRole;
  canViewDetails: boolean;
  canRecordRefund: boolean;
  familyStudentIds: string[];
}

const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value: Date | null) => value ? value.toISOString() : null;

@Injectable()
export class CampusEventFinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SchoolEventService,
  ) {}

  private async membership(db: Db, user: AuthUser, schoolId: string, lock = false): Promise<MemberRole> {
    if (user.active_school_id && user.active_school_id !== schoolId) {
      throw new NotFoundException("Campus event not found in the active school.");
    }
    const membership = (await sql<{ role: MemberRole }>`
      SELECT membership.role
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid
        AND membership.is_active
      ${lock ? sql`FOR SHARE OF membership,account` : sql``}
    `.execute(db)).rows[0];
    if (!membership) throw new NotFoundException("Campus event not found in the active school.");
    return membership.role;
  }

  private async event(db: Db, schoolId: string, eventId: string, lock = false): Promise<EventFinanceEventRow> {
    const event = (await sql<EventFinanceEventRow>`
      SELECT id,school_id,title,status,starts_at,revision,payment_required,participation_requirement
      FROM campus_events
      WHERE school_id=${schoolId}::uuid AND id=${eventId}::uuid
      ${lock ? sql`FOR UPDATE` : sql``}
    `.execute(db)).rows[0];
    if (!event) throw new NotFoundException("Campus event not found.");
    return event;
  }

  private async access(db: Db, user: AuthUser, event: EventFinanceEventRow, lock = false): Promise<FinanceAccess> {
    const role = await this.membership(db, user, event.school_id, lock);
    const financeGranted = role === "admin" || role === "staff" && (await effectiveSchoolAccess(db,user.id,event.school_id,"fees.manage")).sources.length>0;
    if (financeGranted) {
      return { role, canViewDetails: true, canRecordRefund: true, familyStudentIds: [] };
    }
    if (role === "staff") {
      const assigned = Boolean((await sql<{ allowed: boolean }>`
        SELECT EXISTS(
          SELECT 1 FROM campus_event_staff staff
          WHERE staff.school_id=${event.school_id}::uuid AND staff.event_id=${event.id}::uuid
            AND staff.user_id=${user.id}::uuid
        ) AS allowed
      `.execute(db)).rows[0]?.allowed);
      if (assigned) return { role, canViewDetails: false, canRecordRefund: false, familyStudentIds: [] };
      throw new NotFoundException("Campus event not found or no longer accessible.");
    }
    if (event.status === "draft") throw new NotFoundException("Campus event not found or no longer accessible.");
    const familyStudentIds = (await sql<{ student_id: string }>`
      SELECT participant.student_id
      FROM campus_event_participants participant
      JOIN students student ON student.id=participant.student_id
      WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
        AND ((${role}='student' AND student.user_id=${user.id}::uuid) OR (${role}='guardian' AND EXISTS(
          SELECT 1 FROM parents parent
          JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
          WHERE parent.user_id=${user.id}::uuid AND relationship.school_id=participant.school_id
            AND relationship.student_id=participant.student_id
        )))
      ${lock ? sql`FOR SHARE OF participant,student` : sql``}
    `.execute(db)).rows.map((row) => row.student_id);
    if (!familyStudentIds.length) throw new NotFoundException("Campus event not found or no longer accessible.");
    return { role, canViewDetails: true, canRecordRefund: false, familyStudentIds };
  }

  private async priorCommand<T>(db: Db, schoolId: string, actorId: string, commandKey: string, operation: string, hash: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`campus-event:${schoolId}:${actorId}:${commandKey}`},0))`.execute(db);
    const prior = (await sql<{ operation: string; request_hash: string; result: T }>`
      SELECT operation,request_hash,result
      FROM campus_event_commands
      WHERE school_id=${schoolId}::uuid AND actor_id=${actorId}::uuid AND command_key=${commandKey}::uuid
    `.execute(db)).rows[0];
    if (!prior) return null;
    if (prior.operation !== operation || prior.request_hash !== hash) {
      throw new ConflictException("This request key was already used for a different campus-event action.");
    }
    return prior.result;
  }

  private async saveCommand(db: Db, schoolId: string, actorId: string, commandKey: string, operation: string, hash: string, result: unknown) {
    await sql`
      INSERT INTO campus_event_commands(school_id,actor_id,command_key,operation,request_hash,result)
      VALUES(${schoolId}::uuid,${actorId}::uuid,${commandKey}::uuid,${operation},${hash},${JSON.stringify(result)}::jsonb)
    `.execute(db);
  }

  private async audience(db: Db, event: EventFinanceEventRow) {
    return (await sql<{ user_id: string }>`
      SELECT DISTINCT candidate.user_id FROM (
        SELECT membership.user_id
        FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${event.school_id}::uuid AND membership.role='admin' AND membership.is_active
        UNION ALL
        SELECT exception.user_id
        FROM school_access_exceptions exception
        JOIN school_memberships membership ON membership.school_id=exception.school_id
          AND membership.user_id=exception.user_id AND membership.role='staff' AND membership.is_active
        JOIN users account ON account.id=exception.user_id AND account.is_active
        WHERE exception.school_id=${event.school_id}::uuid AND exception.permission='fees.manage'
          AND exception.status='active' AND current_date BETWEEN exception.valid_from AND exception.valid_until
        UNION ALL
        SELECT profile.user_id
        FROM staff_responsibility_assignments assignment
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id AND type.is_active
        WHERE assignment.school_id=${event.school_id}::uuid AND 'fees.manage'=ANY(type.capability_permissions)
          AND assignment.status='active' AND assignment.starts_on<=current_date
          AND (assignment.ends_on IS NULL OR assignment.ends_on>=current_date)
        UNION ALL
        SELECT staff.user_id
        FROM campus_event_staff staff
        JOIN school_memberships membership ON membership.school_id=staff.school_id
          AND membership.user_id=staff.user_id AND membership.is_active
        JOIN users account ON account.id=staff.user_id AND account.is_active
        WHERE staff.school_id=${event.school_id}::uuid AND staff.event_id=${event.id}::uuid
        UNION ALL
        SELECT student.user_id
        FROM campus_event_participants participant
        JOIN students student ON student.id=participant.student_id AND student.user_id IS NOT NULL
        WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
        UNION ALL
        SELECT parent.user_id
        FROM campus_event_participants participant
        JOIN guardian_relationships relationship ON relationship.school_id=participant.school_id
          AND relationship.student_id=participant.student_id
        JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
        WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
      ) candidate WHERE candidate.user_id IS NOT NULL
    `.execute(db)).rows.map((row) => row.user_id);
  }

  private async audit(db: Db, req: AuthenticatedRequest, action: string, event: EventFinanceEventRow, studentId: string, metadata: Record<string, unknown>) {
    await db.insertInto("audit_events").values({
      action,
      actor_id: req.authUser.id,
      school_id: event.school_id,
      target_type: "campus_event_finance",
      target_id: event.id,
      request_id: req.requestId,
      ip_hash: null,
      metadata: { student_id: studentId, ...metadata },
    }).execute();
  }

  private async enqueue(
    db: Db,
    event: EventFinanceEventRow,
    changeKind: "participant_withdrawn" | "refund_recorded",
    key: string,
    studentId: string,
    notification: { title: string; body: string },
  ) {
    const audience = await this.audience(db, event);
    const familyUsers = (await sql<{ user_id: string }>`
      SELECT DISTINCT candidate.user_id FROM (
        SELECT student.user_id FROM students student
        WHERE student.id=${studentId}::uuid AND student.school_id=${event.school_id}::uuid AND student.user_id IS NOT NULL
        UNION ALL
        SELECT parent.user_id FROM guardian_relationships relationship
        JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
        WHERE relationship.school_id=${event.school_id}::uuid AND relationship.student_id=${studentId}::uuid
      ) candidate
    `.execute(db)).rows.map((row) => row.user_id);
    await this.events.enqueueUserEvent(db, {
      schoolId: event.school_id,
      eventType: "campus_event.updated",
      aggregateType: "campus_event",
      aggregateId: event.id,
      audienceUserIds: audience,
      idempotencyKey: key,
      payload: {
        event_id: event.id,
        revision: event.revision,
        change_kind: changeKind,
        refresh: ["campus-events", "student.home", "parent.home", "teacher.home", "principal.home", "notifications"],
      },
      notificationUserIds: familyUsers,
      notificationPayload: {
        kind: "general",
        title: notification.title,
        body: notification.body,
        link: `/events/${event.id}`,
        student_link: `/student/events/${event.id}`,
        parent_link: `/parent/events/${event.id}?student_id=${studentId}`,
        staff_link: `/teacher/events/${event.id}`,
        admin_link: `/principal/events/${event.id}`,
        event_id: event.id,
        student_id: studentId,
      },
    });
  }

  private financeState(row: FinanceRow): EventFinanceState {
    if (!row.invoice_id) return "not_invoiced";
    const adjusted = Math.max(row.invoice_amount_paise - row.credited_paise, 0);
    const refundDue = Math.max(row.paid_paise - adjusted - row.refunded_paise, 0);
    if (refundDue > 0) return row.refunded_paise > 0 ? "partially_refunded" : "refund_due";
    if (row.credited_paise > 0) return row.paid_paise > 0 ? "refunded" : "credited";
    return row.paid_paise >= row.invoice_amount_paise ? "paid" : "collectible";
  }

  private async readFinance(
    db: Db,
    event: EventFinanceEventRow,
    access: FinanceAccess,
    requestedStudentId?: string,
  ): Promise<EventFinanceResponse> {
    // Assigned event staff can operate the roster, but a duty assignment is
    // not a finance permission. Return no per-child ledger projection rather
    // than leaking paid/pending state through otherwise zeroed amounts.
    if (!access.canViewDetails) {
      return {
        event: { id: event.id, title: event.title, status: event.status },
        items: [],
        counts: { reconciliation_required: 0, withdrawn: 0 },
        permissions: { can_view_finance_details: false, can_record_refund: false },
      };
    }
    const allowedStudentIds = access.familyStudentIds.length ? access.familyStudentIds : null;
    if (requestedStudentId && allowedStudentIds && !allowedStudentIds.includes(requestedStudentId)) {
      throw new NotFoundException("Event participant not found or no longer accessible.");
    }
    const rows = (await sql<FinanceRow>`
      SELECT participant.student_id,
        COALESCE(NULLIF(trim(concat(account.first_name,' ',account.last_name)),''),student.admission_number) AS student_name,
        student.admission_number,student.avatar_url,participant.rsvp_status,
        invoice.id AS invoice_id,COALESCE(invoice.amount_paise,0)::int AS invoice_amount_paise,
        COALESCE(credit.amount_paise,0)::int AS credited_paise,
        COALESCE(payment.amount_paise,0)::int AS paid_paise,
        COALESCE(refund.amount_paise,0)::int AS refunded_paise,
        withdrawal.id AS withdrawal_id,withdrawal.withdrawn_at
      FROM campus_event_participants participant
      JOIN students student ON student.id=participant.student_id AND student.school_id=participant.school_id
      LEFT JOIN users account ON account.id=student.user_id
      LEFT JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id AND invoice.school_id=participant.school_id
      LEFT JOIN LATERAL (
        SELECT sum(entry.amount_paise)::int AS amount_paise
        FROM fee_invoice_credits entry WHERE entry.invoice_id=invoice.id
      ) credit ON true
      LEFT JOIN LATERAL (
        SELECT sum(entry.amount_paise)::int AS amount_paise
        FROM fee_payments entry WHERE entry.invoice_id=invoice.id
      ) payment ON true
      LEFT JOIN LATERAL (
        SELECT sum(entry.amount_paise)::int AS amount_paise
        FROM fee_refunds entry WHERE entry.invoice_id=invoice.id
      ) refund ON true
      LEFT JOIN campus_event_participant_withdrawals withdrawal
        ON withdrawal.school_id=participant.school_id AND withdrawal.event_id=participant.event_id
          AND withdrawal.student_id=participant.student_id
      WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
        AND (${requestedStudentId ?? null}::uuid IS NULL OR participant.student_id=${requestedStudentId ?? null}::uuid)
        AND (${allowedStudentIds}::uuid[] IS NULL OR participant.student_id=ANY(${allowedStudentIds}::uuid[]))
      ORDER BY student.admission_number,participant.student_id
    `.execute(db)).rows;
    if (requestedStudentId && !rows.length) throw new NotFoundException("Event participant not found or no longer accessible.");
    const studentIds = rows.map((row) => row.student_id);
    const refunds = access.canViewDetails && studentIds.length ? (await sql<RefundRow>`
      SELECT refund.id,refund.student_id,refund.amount_paise,refund.method,refund.reference,refund.reason,refund.created_at
      FROM fee_refunds refund
      WHERE refund.school_id=${event.school_id}::uuid AND refund.event_id=${event.id}::uuid
        AND refund.student_id=ANY(${studentIds}::uuid[])
      ORDER BY refund.created_at,refund.id
    `.execute(db)).rows : [];
    const refundsByStudent = new Map<string, RefundRow[]>();
    for (const refund of refunds) refundsByStudent.set(refund.student_id, [...(refundsByStudent.get(refund.student_id) ?? []), refund]);
    const isGuardian = access.role === "guardian";
    const items = rows.map<EventFinanceParticipantDto>((row) => {
      const adjusted = Math.max(row.invoice_amount_paise - row.credited_paise, 0);
      const collectible = Math.max(adjusted - row.paid_paise, 0);
      const refundDue = Math.max(row.paid_paise - adjusted - row.refunded_paise, 0);
      const visible = access.canViewDetails;
      return {
        student_id: row.student_id,
        student_name: row.student_name,
        admission_number: row.admission_number,
        avatar_url: row.avatar_url,
        participation_state: row.withdrawal_id ? "withdrawn" : row.rsvp_status,
        withdrawn_at: iso(row.withdrawn_at),
        can_withdraw: isGuardian && event.status === "published" && event.payment_required
          && event.participation_requirement === "optional" && row.rsvp_status === "accepted"
          && !row.withdrawal_id && event.starts_at.getTime() > Date.now(),
        finance_state: event.payment_required ? this.financeState(row) : "not_required",
        currency: "INR",
        invoice_id: visible ? row.invoice_id : null,
        invoice_amount_paise: visible ? row.invoice_amount_paise : 0,
        credited_paise: visible ? row.credited_paise : 0,
        paid_paise: visible ? row.paid_paise : 0,
        refunded_paise: visible ? row.refunded_paise : 0,
        collectible_balance_paise: visible ? collectible : 0,
        refund_due_paise: visible ? refundDue : 0,
        refunds: visible ? (refundsByStudent.get(row.student_id) ?? []).map((refund) => ({
          id: refund.id,
          amount_paise: refund.amount_paise,
          method: refund.method,
          reference: refund.reference,
          reason: refund.reason,
          recorded_at: refund.created_at.toISOString(),
        })) : [],
      };
    });
    return {
      event: { id: event.id, title: event.title, status: event.status },
      items,
      counts: {
        reconciliation_required: items.filter((item) => item.finance_state === "refund_due" || item.finance_state === "partially_refunded").length,
        withdrawn: items.filter((item) => item.participation_state === "withdrawn").length,
      },
      permissions: { can_view_finance_details: access.canViewDetails, can_record_refund: access.canRecordRefund },
    };
  }

  async finance(user: AuthUser, eventId: string, schoolId: string, studentId?: string) {
    const parsedEventId = campusEventFinanceIdSchema.parse(eventId);
    const query = campusEventFinanceQuerySchema.parse({ school_id: schoolId, student_id: studentId });
    const event = await this.event(this.db, query.school_id, parsedEventId);
    const access = await this.access(this.db, user, event);
    return this.readFinance(this.db, event, access, query.student_id);
  }

  async withdraw(req: AuthenticatedRequest, eventId: string, body: unknown) {
    const parsedEventId = campusEventFinanceIdSchema.parse(eventId);
    const input = withdrawFromPaidEventSchema.parse(body);
    const hash = requestHash({ eventId: parsedEventId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.event(db, input.school_id, parsedEventId, true);
      const access = await this.access(db, req.authUser, event, true);
      if (access.role !== "guardian" || !access.familyStudentIds.includes(input.student_id)) {
        throw new ForbiddenException("A linked guardian must withdraw an accepted paid-event place.");
      }
      const prior = await this.priorCommand<EventFinanceResponse>(db, input.school_id, req.authUser.id, input.idempotency_key, "withdraw_paid_event", hash);
      if (prior) return prior;
      if (event.status !== "published" || event.starts_at.getTime() <= Date.now()) {
        throw new ConflictException("A participant can withdraw only before the published event starts.");
      }
      if (!event.payment_required || event.participation_requirement !== "optional") {
        throw new ConflictException("This event does not use the optional paid-participation withdrawal workflow.");
      }
      const participant = (await sql<{ rsvp_status: string; fee_invoice_id: string | null; invoice_amount_paise: number }>`
        SELECT participant.rsvp_status,participant.fee_invoice_id,invoice.amount_paise AS invoice_amount_paise
        FROM campus_event_participants participant
        JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
          AND invoice.school_id=participant.school_id AND invoice.student_id=participant.student_id
        WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
          AND participant.student_id=${input.student_id}::uuid
        FOR UPDATE OF participant,invoice
      `.execute(db)).rows[0];
      if (!participant || participant.rsvp_status !== "accepted" || !participant.fee_invoice_id) {
        throw new ConflictException("Only an accepted optional place with a posted event invoice can be withdrawn.");
      }
      const withdrawal = (await sql<{ id: string }>`
        INSERT INTO campus_event_participant_withdrawals(
          school_id,event_id,student_id,reason,idempotency_key,request_hash,withdrawn_by
        ) VALUES(
          ${event.school_id}::uuid,${event.id}::uuid,${input.student_id}::uuid,${input.reason},
          ${input.idempotency_key}::uuid,${hash},${req.authUser.id}::uuid
        ) RETURNING id
      `.execute(db)).rows[0]!;
      await sql`
        INSERT INTO fee_invoice_credits(
          school_id,invoice_id,event_id,student_id,amount_paise,source,participant_withdrawal_id,
          reason,idempotency_key,request_hash,recorded_by
        ) VALUES(
          ${event.school_id}::uuid,${participant.fee_invoice_id}::uuid,${event.id}::uuid,${input.student_id}::uuid,
          ${participant.invoice_amount_paise},'participant_withdrawn',${withdrawal.id}::uuid,
          ${input.reason},${input.idempotency_key}::uuid,${hash},${req.authUser.id}::uuid
        )
      `.execute(db);
      await sql`
        WITH removed AS (
          DELETE FROM campus_event_session_participants
          WHERE school_id=${event.school_id}::uuid AND event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid
          RETURNING session_id
        )
        UPDATE campus_event_sessions session SET revision=revision+1,updated_at=now()
        WHERE session.id IN(SELECT session_id FROM removed)
      `.execute(db);
      await sql`
        UPDATE campus_event_participants
        SET rsvp_status='declined',rsvp_by=${req.authUser.id}::uuid,rsvp_at=now()
        WHERE school_id=${event.school_id}::uuid AND event_id=${event.id}::uuid AND student_id=${input.student_id}::uuid
      `.execute(db);
      await this.audit(db, req, "campus_event.participant_withdrawn", event, input.student_id, {
        invoice_id: participant.fee_invoice_id,
        credited_paise: participant.invoice_amount_paise,
        reason: input.reason,
      });
      await this.enqueue(
        db,
        event,
        "participant_withdrawn",
        `campus-event:${event.id}:withdraw:${input.student_id}:${input.idempotency_key}`,
        input.student_id,
        { title: `${event.title} place withdrawn`, body: "The event invoice was credited. Any amount already paid is now pending manual refund reconciliation by the school office." },
      );
      const result = await this.readFinance(db, event, access, input.student_id);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "withdraw_paid_event", hash, result);
      return result;
    });
  }

  async refund(req: AuthenticatedRequest, eventId: string, body: unknown) {
    const parsedEventId = campusEventFinanceIdSchema.parse(eventId);
    const input = recordEventRefundSchema.parse(body);
    const hash = requestHash({ eventId: parsedEventId, input });
    return this.db.transaction().execute(async (db) => {
      const event = await this.event(db, input.school_id, parsedEventId, true);
      const access = await this.access(db, req.authUser, event, true);
      if (!access.canRecordRefund) throw new ForbiddenException("A principal or staff member with fee-management permission must record this refund.");
      const prior = await this.priorCommand<EventFinanceResponse>(db, input.school_id, req.authUser.id, input.idempotency_key, "record_event_refund", hash);
      if (prior) return prior;
      const invoice = (await sql<{ invoice_id: string; invoice_amount_paise: number }>`
        SELECT invoice.id AS invoice_id,invoice.amount_paise AS invoice_amount_paise
        FROM campus_event_participants participant
        JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
        WHERE participant.school_id=${event.school_id}::uuid AND participant.event_id=${event.id}::uuid
          AND participant.student_id=${input.student_id}::uuid
          AND EXISTS(SELECT 1 FROM fee_invoice_credits credit WHERE credit.invoice_id=invoice.id AND credit.event_id=participant.event_id)
        FOR UPDATE OF participant,invoice
      `.execute(db)).rows[0];
      if (!invoice) throw new ConflictException("This participant has no credited event invoice to refund.");
      const totals = (await sql<{
        credit_id: string;
        credited_paise: number;
        paid_paise: number;
        refunded_paise: number;
      }>`
        SELECT
          (SELECT credit.id FROM fee_invoice_credits credit WHERE credit.invoice_id=${invoice.invoice_id}::uuid ORDER BY credit.created_at,credit.id LIMIT 1) AS credit_id,
          COALESCE((SELECT sum(credit.amount_paise) FROM fee_invoice_credits credit WHERE credit.invoice_id=${invoice.invoice_id}::uuid),0)::int AS credited_paise,
          COALESCE((SELECT sum(payment.amount_paise) FROM fee_payments payment WHERE payment.invoice_id=${invoice.invoice_id}::uuid),0)::int AS paid_paise,
          COALESCE((SELECT sum(refund.amount_paise) FROM fee_refunds refund WHERE refund.invoice_id=${invoice.invoice_id}::uuid),0)::int AS refunded_paise
      `.execute(db)).rows[0]!;
      const adjusted = Math.max(invoice.invoice_amount_paise - totals.credited_paise, 0);
      const due = Math.max(totals.paid_paise - adjusted - totals.refunded_paise, 0);
      if (input.amount_paise > due) throw new ConflictException("Refund amount exceeds the remaining manual refund due.");
      await sql`
        INSERT INTO fee_refunds(
          school_id,invoice_id,credit_id,event_id,student_id,amount_paise,method,reference,reason,
          idempotency_key,request_hash,recorded_by
        ) VALUES(
          ${event.school_id}::uuid,${invoice.invoice_id}::uuid,${totals.credit_id}::uuid,${event.id}::uuid,
          ${input.student_id}::uuid,${input.amount_paise},${input.method},${input.reference},${input.reason},
          ${input.idempotency_key}::uuid,${hash},${req.authUser.id}::uuid
        )
      `.execute(db);
      await this.audit(db, req, "campus_event.refund_recorded", event, input.student_id, {
        invoice_id: invoice.invoice_id,
        amount_paise: input.amount_paise,
        method: input.method,
        reference: input.reference,
        reason: input.reason,
      });
      await this.enqueue(
        db,
        event,
        "refund_recorded",
        `campus-event:${event.id}:refund:${input.student_id}:${input.idempotency_key}`,
        input.student_id,
        { title: `${event.title} refund recorded`, body: "The school office recorded a manual refund against the event fee. No online gateway refund was initiated by this app." },
      );
      const result = await this.readFinance(db, event, access, input.student_id);
      await this.saveCommand(db, input.school_id, req.authUser.id, input.idempotency_key, "record_event_refund", hash, result);
      return result;
    });
  }
}
