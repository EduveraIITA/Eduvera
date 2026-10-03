import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "./school-event.service.js";
import {lockSchedule,protectPublishedPlans} from '../day-plans/schedule.js';
import { attendanceDayPolicy, attendanceWorkspace } from '../attendance/attendance-workspace.js';

type Db = Kysely<Database> | Transaction<Database>;
type LeaveStatus = "draft" | "pending_guardian" | "authorized" | "declined" | "school_approved" | "school_rejected" | "withdrawn";

interface StudentContext {
  id: string; person_id: string; user_id: string | null; school_id: string; admission_number: string;
  date_of_birth: string | null; blood_group: string | null; emergency_contact: string | null;
  avatar_url: string; username: string | null; email: string | null; first_name: string; last_name: string;
  school_name: string; school_code: string; school_timezone: string;
}

interface EnrollmentContext {
  id: string; class_section_id: string; term_id: string; roll_number: number; is_active: boolean;
  grade: string; section: string; board: string; room_number: string;
  school_id: string; school_timezone: string; school_date: string;
  academic_year: string; term_name: string; starts_on: string; ends_on: string; attendance_threshold: string;
}

export type HomeActionPriority = "urgent" | "high" | "normal" | "info";
export type HomeActionKind =
  | "event_rsvp"
  | "event_consent"
  | "event_payment"
  | "event_checklist"
  | "event_upcoming"
  | "leave_signature"
  | "diary_acknowledgement"
  | "attendance_register"
  | "attendance_followup"
  | "event_duty";

export interface HomeAction {
  id: string;
  kind: HomeActionKind;
  priority: HomeActionPriority;
  title: string;
  detail: string;
  status_label: string;
  action_label: string;
  href: string;
  source_id: string;
  occurs_at: string | null;
  due_at: string | null;
}

interface FamilyEventActionRow {
  event_id: string;
  title: string;
  starts_at: Date;
  payment_due_on: string | null;
  requires_rsvp: boolean;
  requires_guardian_consent: boolean;
  payment_required: boolean;
  participation_requirement: "mandatory" | "optional";
  rsvp_status: "pending" | "accepted" | "declined";
  consent_status: "pending" | "granted" | "denied" | "withdrawn";
  invoice_amount_paise: number;
  paid_paise: number;
  required_items: number;
  required_completed: number;
}

function actionPriority(action: HomeAction): number {
  return { urgent: 0, high: 1, normal: 2, info: 3 }[action.priority];
}

function sortHomeActions(actions: HomeAction[]): HomeAction[] {
  return actions.sort((left, right) => {
    const priority = actionPriority(left) - actionPriority(right);
    if (priority) return priority;
    const leftTime = Date.parse(left.due_at ?? left.occurs_at ?? "9999-12-31T00:00:00.000Z");
    const rightTime = Date.parse(right.due_at ?? right.occurs_at ?? "9999-12-31T00:00:00.000Z");
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
}

export interface UploadInput { filename: string; mimetype: string; data: Buffer }

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const leaveSchema = z.object({
  student_id: z.string().uuid().optional(),
  category: z.enum(["medical", "family", "travel", "personal"]),
  starts_on: z.string().regex(datePattern),
  ends_on: z.string().regex(datePattern),
  reason: z.string().trim().min(5).max(2000),
});
const attendanceBulkSchema = z.object({
  class_section_id: z.string().uuid(),
  date: z.string().regex(datePattern),
  expected_revision: z.number().int().min(0),
  photo_session_id: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  records: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(["present", "absent", "late", "excused", "half_day"]),
    remarks: z.string().trim().max(500).optional().default(""),
  })).min(1).max(100),
});
const attendanceCaptureSourceSchema = z.enum(["live_app", "offline_device", "paper", "office"]);
const attendanceContinuityBatchSchema = attendanceBulkSchema.extend({
  source: attendanceCaptureSourceSchema,
  source_reference: z.string().trim().max(160).optional().default(""),
  device_id: z.string().trim().min(8).max(128).nullable().optional(),
  observed_at: z.string().datetime({ offset: true }),
  roster_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  roster_captured_at: z.string().datetime({ offset: true }),
  roster_expires_at: z.string().datetime({ offset: true }),
  snapshot_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).superRefine((value, context) => {
  if (value.source === "offline_device" && !value.device_id) {
    context.addIssue({ code: "custom", path: ["device_id"], message: "Offline attendance requires a registered device identifier." });
  }
  if ((value.source === "paper" || value.source === "office") && value.source_reference.length < 3) {
    context.addIssue({ code: "custom", path: ["source_reference"], message: "Paper and office captures require a source reference." });
  }
});
const attendanceReconciliationDecisionSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().trim().min(3).max(500),
  expected_revision: z.number().int().min(0),
});
const attendanceLockSchema = z.object({
  date: z.string().regex(datePattern),
  reason: z.string().trim().min(3).max(500).optional(),
});

export function attendanceRosterFingerprint(input: {
  schoolId: string;
  classSectionId: string;
  termId: string;
  date: string;
  studentIds: string[];
}) {
  return createHash("sha256").update(JSON.stringify({
    school_id: input.schoolId,
    class_section_id: input.classSectionId,
    term_id: input.termId,
    date: input.date,
    student_ids: [...input.studentIds].sort(),
  })).digest("hex");
}

function attendanceSnapshotToken(input: {
  userId: string;
  schoolId: string;
  classSectionId: string;
  termId: string;
  date: string;
  rosterFingerprint: string;
  rosterCount: number;
  capturedAt: string;
  expiresAt: string;
}) {
  return createHmac("sha256", config().COOKIE_SECRET)
    .update(JSON.stringify(input))
    .digest("base64url");
}

function validAttendanceSnapshotToken(token: string, input: Parameters<typeof attendanceSnapshotToken>[0]) {
  const expected = attendanceSnapshotToken(input);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
const timetableSlotSchema = z.object({
  term_id: z.string().uuid().optional(),
  class_section_id: z.string().uuid(),
  subject_id: z.string().uuid().nullable().optional(),
  weekday: z.number().int().min(1).max(7),
  period_number: z.number().int().min(1).max(20),
  starts_at: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  slot_type: z.enum(["class", "break", "activity"]),
  title: z.string().trim().max(120).optional().default(""),
  room: z.string().trim().max(80).optional().default(""),
  teacher_user_id: z.string().uuid().nullable().optional(),
  teacher_designation: z.string().trim().max(120).optional().default("Subject Teacher"),
});
const timetableCopyDaySchema = z.object({
  term_id: z.string().uuid(),
  class_section_id: z.string().uuid(),
  source_weekday: z.number().int().min(1).max(7),
  target_weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(6),
  replace: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  if (new Set(value.target_weekdays).size !== value.target_weekdays.length) {
    context.addIssue({ code: "custom", message: "Choose each target day once.", path: ["target_weekdays"] });
  }
  if (value.target_weekdays.includes(value.source_weekday)) {
    context.addIssue({ code: "custom", message: "The source day cannot also be a target day.", path: ["target_weekdays"] });
  }
});
const curriculumTargetSchema = z.object({
  term_id: z.string().uuid(),
  class_section_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  target_minutes: z.number().int().min(30).max(120000),
  expected_revision: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
});
const schoolClosureSchema = z.object({
  term_id: z.string().uuid(),
  starts_on: z.string().regex(datePattern),
  ends_on: z.string().regex(datePattern),
  kind: z.enum(["public_holiday", "local_holiday", "emergency_closure"]),
  label: z.string().trim().min(3).max(160),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  if (value.ends_on < value.starts_on) {
    context.addIssue({ code: "custom", message: "The closure end cannot be before its start.", path: ["ends_on"] });
  } else if (daysInclusive(value.starts_on, value.ends_on) > 31) {
    context.addIssue({ code: "custom", message: "A closure range cannot exceed 31 days.", path: ["ends_on"] });
  }
});
const schoolClosureDeleteSchema = z.object({
  expected_revision: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});
const notificationPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
});
const actionLabels: Record<string, string> = {
  submitted: "Submitted", document_added: "Document added", clarification_requested: "Clarification requested",
  authorized: "Guardian authorized", declined: "Guardian declined", approved: "School approved",
  rejected: "School rejected", withdrawn: "Withdrawn",
};
const categoryLabels: Record<string, string> = { medical: "Medical", family: "Family commitment", travel: "Travel", personal: "Personal / domestic" };
const statusLabels: Record<string, string> = {
  draft: "Draft", pending_guardian: "Pending guardian authorization", authorized: "Guardian authorized",
  declined: "Guardian declined", school_approved: "School approved", school_rejected: "School rejected", withdrawn: "Withdrawn",
};
const weekdayLabels = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoWeekday(value: string): number {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error("Database returned an invalid calendar date.");
  return match[0];
}

function daysInclusive(start: string | Date, end: string | Date): number {
  const startTime = Date.parse(`${dateOnly(start)}T00:00:00Z`);
  const endTime = Date.parse(`${dateOnly(end)}T00:00:00Z`);
  return Math.round((endTime - startTime) / 86_400_000) + 1;
}

function notificationCursor(value?: string): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const parsed = z.object({ created_at: z.string().datetime(), id: z.string().uuid() }).parse(decoded);
    return { createdAt: new Date(parsed.created_at), id: parsed.id };
  } catch {
    throw new BadRequestException("The notification cursor is invalid or expired.");
  }
}

function encodeNotificationCursor(row: { created_at: Date | string; id: string }): string {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

@Injectable()
export class SchoolService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  private async familyHomeActions(
    user: AuthUser,
    student: StudentContext,
    audience: "guardian" | "student",
  ): Promise<HomeAction[]> {
    const rows = (await sql<FamilyEventActionRow>`
      SELECT event.id AS event_id,event.title,event.starts_at,event.payment_due_on,
        event.requires_rsvp,event.requires_guardian_consent,event.payment_required,
        participant.participation_requirement,participant.rsvp_status,
        COALESCE(consent.status,'pending') AS consent_status,
        COALESCE(invoice.amount_paise,0)::int AS invoice_amount_paise,
        COALESCE((SELECT sum(payment.amount_paise)::int FROM fee_payments payment
          WHERE payment.invoice_id=invoice.id),0)::int AS paid_paise,
        (SELECT count(*)::int FROM campus_event_checklist_items item
          WHERE item.event_id=event.id AND item.required) AS required_items,
        (SELECT count(*)::int FROM campus_event_checklist_completions completion
          JOIN campus_event_checklist_items item ON item.id=completion.item_id AND item.required
          WHERE completion.event_id=event.id AND completion.student_id=participant.student_id) AS required_completed
      FROM campus_event_participants participant
      JOIN campus_events event ON event.id=participant.event_id AND event.school_id=participant.school_id
      LEFT JOIN campus_event_consents consent ON consent.event_id=event.id AND consent.student_id=participant.student_id
      LEFT JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id
      WHERE participant.student_id=${student.id}::uuid
        AND participant.school_id=${student.school_id}::uuid
        AND event.status='published' AND event.ends_at>=now()
        AND (
          (${audience}='student' AND EXISTS(SELECT 1 FROM students scoped_student
            WHERE scoped_student.id=participant.student_id AND scoped_student.user_id=${user.id}::uuid))
          OR (${audience}='guardian' AND EXISTS(
            SELECT 1 FROM guardian_relationships relationship
            JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE relationship.school_id=participant.school_id
              AND relationship.student_id=participant.student_id AND parent.user_id=${user.id}::uuid
          ))
        )
      ORDER BY event.starts_at,event.id
      LIMIT 8
    `.execute(this.db)).rows;
    const now = Date.now();
    const prefix = audience === "guardian" ? "/parent" : "/student";
    const href = (eventId: string) => audience === "guardian"
      ? `${prefix}/events/${eventId}?student_id=${encodeURIComponent(student.id)}`
      : `${prefix}/events/${eventId}`;
    const actions = rows.map<HomeAction | null>((row) => {
      const startsAt = new Date(row.starts_at).toISOString();
      const hoursUntil = (Date.parse(startsAt) - now) / 3_600_000;
      const accepted = row.participation_requirement === "mandatory" || row.rsvp_status === "accepted";
      const participationReady = accepted && (!row.requires_guardian_consent || row.consent_status === "granted");
      const imminent = hoursUntil <= 48;
      if (row.requires_rsvp && row.rsvp_status === "pending") {
        const guardianDecision = audience === "student" && row.payment_required;
        return {
          id: `event-rsvp:${row.event_id}`,
          kind: "event_rsvp",
          priority: imminent ? "urgent" : "high",
          title: guardianDecision ? `Guardian response needed for ${row.title}` : `Respond to ${row.title}`,
          detail: guardianDecision
            ? "A linked guardian must accept or decline this paid activity."
            : "Accept or decline the invitation so the school can plan the participant roster.",
          status_label: imminent ? "Starts soon" : "RSVP pending",
          action_label: guardianDecision ? "View event" : "Respond now",
          href: href(row.event_id), source_id: row.event_id, occurs_at: startsAt, due_at: startsAt,
        };
      }
      if (accepted && row.requires_guardian_consent && row.consent_status === "pending") {
        return {
          id: `event-consent:${row.event_id}`,
          kind: "event_consent",
          priority: imminent ? "urgent" : "high",
          title: `Guardian consent needed for ${row.title}`,
          detail: audience === "guardian"
            ? "Review the event details and record the guardian decision."
            : "A linked guardian needs to review and record the consent decision.",
          status_label: imminent ? "Starts soon" : "Consent pending",
          action_label: audience === "guardian" ? "Review consent" : "View details",
          href: href(row.event_id), source_id: row.event_id, occurs_at: startsAt, due_at: startsAt,
        };
      }
      if (participationReady && audience === "guardian" && row.payment_required
          && row.invoice_amount_paise > row.paid_paise) {
        return {
          id: `event-payment:${row.event_id}`,
          kind: "event_payment",
          priority: row.payment_due_on && row.payment_due_on < new Date().toISOString().slice(0, 10) ? "urgent" : "high",
          title: `Event fee due for ${row.title}`,
          detail: `Review the outstanding school ledger balance of ₹${Math.ceil((row.invoice_amount_paise - row.paid_paise) / 100).toLocaleString("en-IN")}.`,
          status_label: row.payment_due_on ? `Due ${row.payment_due_on}` : "Fee pending",
          action_label: "View fee",
          href: href(row.event_id), source_id: row.event_id, occurs_at: startsAt,
          due_at: row.payment_due_on ? `${row.payment_due_on}T18:29:59.000Z` : startsAt,
        };
      }
      if (participationReady && row.required_items > row.required_completed) {
        const remaining = row.required_items - row.required_completed;
        return {
          id: `event-checklist:${row.event_id}`,
          kind: "event_checklist",
          priority: imminent ? "urgent" : "normal",
          title: `Prepare for ${row.title}`,
          detail: `${remaining} required ${remaining === 1 ? "item is" : "items are"} still unchecked.`,
          status_label: `${row.required_completed}/${row.required_items} ready`,
          action_label: "Open checklist",
          href: href(row.event_id), source_id: row.event_id, occurs_at: startsAt, due_at: startsAt,
        };
      }
      if (row.rsvp_status === "declined" || ["denied", "withdrawn"].includes(row.consent_status)) return null;
      return {
        id: `event-upcoming:${row.event_id}`,
        kind: "event_upcoming",
        priority: "info",
        title: row.title,
        detail: "A school event has been published for this student.",
        status_label: imminent ? "Coming up" : "Upcoming event",
        action_label: "View event",
        href: href(row.event_id), source_id: row.event_id, occurs_at: startsAt, due_at: null,
      };
    });
    return sortHomeActions(actions.filter((action): action is HomeAction => action !== null)).slice(0, 4);
  }

  private async followupHomeActions(user: AuthUser, context: "staff" | "guardian", studentId?: string): Promise<HomeAction[]> {
    const rows = (await sql<{
      id: string; student_id: string; student_name: string; attendance_date: string;
      question: string; due_at: Date; state: "awaiting_response" | "in_review";
      class_section_id: string;
    }>`
      SELECT followup.id,followup.student_id,concat_ws(' ',person.first_name,person.last_name) AS student_name,
        followup.attendance_date,followup.question,followup.due_at,followup.state,record.class_section_id
      FROM attendance_followups followup
      JOIN students student ON student.id=followup.student_id
      JOIN school_people person ON person.id=student.person_id
      JOIN attendance_records record ON record.id=followup.attendance_record_id
      WHERE followup.state<>'resolved'
        AND coordination_actor_authorized(followup.school_id,followup.student_id,${user.id}::uuid,${context})
        AND (${studentId ?? null}::uuid IS NULL OR followup.student_id=${studentId ?? null}::uuid)
        AND (${context}='guardian' OR followup.owner_user_id=${user.id}::uuid)
      ORDER BY (followup.due_at<now()) DESC,followup.due_at,followup.id
      LIMIT 4
    `.execute(this.db)).rows;
    const now = Date.now();
    return rows.map((row) => {
      const dueAt = new Date(row.due_at).toISOString();
      const guardianTurn = context === "guardian" && row.state === "awaiting_response";
      const staffTurn = context === "staff" && row.state === "in_review";
      return {
        id: `attendance-followup:${row.id}`,
        kind: "attendance_followup",
        priority: Date.parse(dueAt) < now ? "urgent" : guardianTurn || staffTurn ? "high" : "normal",
        title: guardianTurn ? `Reply about ${row.student_name}'s attendance` : staffTurn ? `Review ${row.student_name}'s response` : `Attendance follow-up for ${row.student_name}`,
        detail: row.question,
        status_label: Date.parse(dueAt) < now ? "Overdue" : row.state === "in_review" ? "School review" : "Awaiting response",
        action_label: guardianTurn ? "Reply" : staffTurn ? "Review response" : "Open follow-up",
        href: context === "guardian" ? "#attendance-followups" : "#attendance-followups",
        source_id: row.id, occurs_at: `${row.attendance_date}T12:00:00.000Z`, due_at: dueAt,
      } satisfies HomeAction;
    });
  }

  private async staffEventHomeActions(user: AuthUser, schoolId: string, portal: "teacher" | "principal"): Promise<HomeAction[]> {
    const rows = (await sql<{ id: string; title: string; starts_at: Date; venue: string; role: string | null }>`
      SELECT event.id,event.title,event.starts_at,event.venue,staff.role
      FROM campus_events event
      LEFT JOIN campus_event_staff staff ON staff.event_id=event.id AND staff.user_id=${user.id}::uuid
      WHERE event.school_id=${schoolId}::uuid AND event.status='published' AND event.ends_at>=now()
        AND (${portal}='principal' OR staff.user_id IS NOT NULL)
      ORDER BY event.starts_at,event.id LIMIT 3
    `.execute(this.db)).rows;
    return rows.map((row) => ({
      id: `event-duty:${row.id}`,
      kind: "event_duty",
      priority: row.role ? "normal" : "info",
      title: row.title,
      detail: row.role
        ? `${row.role.replace("_", " ")} duty${row.venue ? ` at ${row.venue}` : ""}.`
        : `Upcoming school event${row.venue ? ` at ${row.venue}` : ""}.`,
      status_label: row.role ? "Assigned event duty" : "Upcoming event",
      action_label: row.role ? "Open duty" : "Review event",
      href: `/${portal}/events/${row.id}`,
      source_id: row.id, occurs_at: new Date(row.starts_at).toISOString(), due_at: null,
    }));
  }

  async studentForUser(user: AuthUser, requestedId?: string): Promise<StudentContext> {
    const result = await sql<StudentContext>`
      SELECT st.id, st.person_id, st.user_id, st.school_id, st.admission_number, st.date_of_birth,
        st.blood_group, st.emergency_contact, st.avatar_url, account.username, account.email,
        u.first_name, u.last_name, sc.name AS school_name, sc.code AS school_code,
        sc.timezone AS school_timezone
      FROM students st
      JOIN school_people u ON u.id = st.person_id
      LEFT JOIN users account ON account.id = st.user_id
      JOIN schools sc ON sc.id = st.school_id
      WHERE (${requestedId ?? null}::uuid IS NULL OR st.id = ${requestedId ?? null}::uuid)
        AND (${user.active_school_id ?? null}::uuid IS NULL OR st.school_id=${user.active_school_id ?? null}::uuid)
        AND (
          (st.user_id = ${user.id}::uuid AND EXISTS (
            SELECT 1 FROM school_memberships m WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'student' AND m.is_active
          ))
          OR EXISTS (
            SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id = p.id
            JOIN school_memberships m ON m.user_id = p.user_id AND m.school_id = st.school_id
            WHERE p.user_id = ${user.id}::uuid AND gr.student_id = st.id
              AND m.role = 'guardian' AND m.is_active
          )
          OR EXISTS (
            SELECT 1 FROM school_memberships m WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'admin' AND m.is_active
          )
          OR EXISTS (
            SELECT 1
            FROM school_memberships m
            JOIN enrollments assigned_enrollment
              ON assigned_enrollment.student_id = st.id AND assigned_enrollment.is_active
            JOIN timetable_slots assigned_slot
              ON assigned_slot.class_section_id = assigned_enrollment.class_section_id
              AND assigned_slot.term_id = assigned_enrollment.term_id
              AND assigned_slot.teacher_user_id = m.user_id
            WHERE m.user_id = ${user.id}::uuid
              AND m.school_id = st.school_id AND m.role = 'staff' AND m.is_active
          )
        )
      ORDER BY CASE WHEN st.user_id = ${user.id}::uuid THEN 0 ELSE 1 END,
        st.admission_number DESC, st.id
      LIMIT 1
    `.execute(this.db);
    const student = result.rows[0];
    if (!student) throw new NotFoundException("No accessible student matches this request.");
    return student;
  }

  async accessibleStudentDtos(user: AuthUser) {
    const ids = await sql<{ id: string }>`
      SELECT DISTINCT st.id FROM students st WHERE (${user.active_school_id ?? null}::uuid IS NULL OR st.school_id=${user.active_school_id ?? null}::uuid) AND (
        (st.user_id = ${user.id}::uuid AND EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id AND m.role='student' AND m.is_active))
        OR EXISTS (SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id AND m.role='guardian' AND m.is_active WHERE p.user_id=${user.id}::uuid AND gr.student_id=st.id)
        OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id AND m.role='admin' AND m.is_active)
        OR EXISTS (
          SELECT 1
          FROM school_memberships m
          JOIN enrollments assigned_enrollment ON assigned_enrollment.student_id=st.id AND assigned_enrollment.is_active
          JOIN timetable_slots assigned_slot
            ON assigned_slot.class_section_id=assigned_enrollment.class_section_id
            AND assigned_slot.term_id=assigned_enrollment.term_id
            AND assigned_slot.teacher_user_id=m.user_id
          WHERE m.user_id=${user.id}::uuid AND m.school_id=st.school_id
            AND m.role='staff' AND m.is_active
        )
      )
      ORDER BY st.id
    `.execute(this.db);
    return Promise.all(ids.rows.map(async (row) => this.studentDto(await this.studentForUser(user, row.id))));
  }

  async enrollment(studentId: string, onDate?: string): Promise<EnrollmentContext> {
    const result = await sql<EnrollmentContext>`
      SELECT e.id, e.class_section_id, e.term_id, e.roll_number, e.is_active,
        cs.grade, cs.section, cs.board, cs.room_number, t.academic_year, t.name AS term_name,
        cs.school_id, school.timezone AS school_timezone,
        (now() AT TIME ZONE school.timezone)::date::text AS school_date,
        t.starts_on, t.ends_on, t.attendance_threshold
      FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id
      JOIN academic_terms t ON t.id=e.term_id
      JOIN schools school ON school.id=cs.school_id
      WHERE e.student_id=${studentId}::uuid AND e.is_active
      ORDER BY CASE WHEN COALESCE(${onDate ?? null}::date, (now() AT TIME ZONE school.timezone)::date)
        BETWEEN t.starts_on AND t.ends_on THEN 0 ELSE 1 END,
        t.starts_on DESC LIMIT 1
    `.execute(this.db);
    const enrollment = result.rows[0];
    if (!enrollment) throw new NotFoundException("The student has no active enrollment.");
    return enrollment;
  }

  async studentDto(student: StudentContext, knownEnrollment?: EnrollmentContext) {
    const enrollment = knownEnrollment ?? await this.enrollment(student.id);
    return {
      id: student.id,
      person: {id:student.person_id,first_name:student.first_name,last_name:student.last_name,display_name:`${student.first_name} ${student.last_name}`.trim()},
      account: student.user_id ? {id:student.user_id,username:student.username,email:student.email} : null,
      // Backwards-compatible display container. A null id means no login exists.
      user: {
        id: student.user_id, username: student.username, email: student.email,
        first_name: student.first_name, last_name: student.last_name,
        display_name: `${student.first_name} ${student.last_name}`.trim(), role: "student",
      },
      school: { id: student.school_id, name: student.school_name, code: student.school_code },
      admission_number: student.admission_number,
      date_of_birth: student.date_of_birth,
      blood_group: student.blood_group,
      emergency_contact: student.emergency_contact,
      avatar_url: student.avatar_url,
      current_enrollment: {
        id: enrollment.id, class_name: `Class ${enrollment.grade}${enrollment.section}`,
        grade: enrollment.grade, section: enrollment.section, board: enrollment.board,
        room_number: enrollment.room_number, roll_number: enrollment.roll_number,
        is_active: enrollment.is_active,
        term: {
          id: enrollment.term_id, academic_year: enrollment.academic_year, name: enrollment.term_name,
          starts_on: enrollment.starts_on, ends_on: enrollment.ends_on,
          attendance_threshold: enrollment.attendance_threshold, is_active: true,
        },
      },
    };
  }

  async requireRole(user: AuthUser, student: StudentContext, role: "student" | "guardian" | "staff"): Promise<void> {
    let allowed = false;
    if (role === "student") {
      allowed = student.user_id === user.id && Boolean(await this.db.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", student.school_id).where("role", "=", "student").where("is_active", "=", true).executeTakeFirst());
    } else if (role === "guardian") {
      const found = await sql<{ ok: boolean }>`SELECT true AS ok FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=${student.school_id}::uuid WHERE p.user_id=${user.id}::uuid AND gr.student_id=${student.id}::uuid AND m.role='guardian' AND m.is_active LIMIT 1`.execute(this.db);
      allowed = Boolean(found.rows[0]?.ok);
    } else {
      allowed = Boolean(await this.db.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", student.school_id)
        .where("role", "in", ["staff", "admin"]).where("is_active", "=", true).executeTakeFirst());
    }
    if (!allowed) throw new ForbiddenException(`An active ${role} membership is required for this operation.`);
  }

  async calendarDays(user: AuthUser, query: Record<string, string>) {
    const input = z.object({
      school_id: z.string().uuid(),
      from: z.string().date(),
      to: z.string().date(),
    }).refine((value) => value.from <= value.to, { message: "Calendar start must not follow its end." })
      .refine((value) => (new Date(`${value.to}T00:00:00`).getTime() - new Date(`${value.from}T00:00:00`).getTime()) / 86_400_000 <= 92, { message: "Calendar ranges cannot exceed 92 days." })
      .parse(query);
    const membership = await this.db.selectFrom("school_memberships").select("id")
      .where("user_id", "=", user.id).where("school_id", "=", input.school_id)
      .where("is_active", "=", true).executeTakeFirst();
    if (!membership) throw new ForbiddenException("An active school membership is required for this calendar.");
    return this.db.selectFrom("school_calendar_days").select([
      "date", "is_instructional", "label", "kind", "reason", "revision",
    ])
      .where("school_id", "=", input.school_id).where("date", ">=", input.from).where("date", "<=", input.to)
      .orderBy("date").execute();
  }

  private async requireSchoolRole(user: AuthUser, roles: Array<"staff" | "admin">, schoolId?: string) {
    let query = this.db.selectFrom("school_memberships").select(["id", "school_id", "role"])
      .where("user_id", "=", user.id).where("role", "in", roles).where("is_active", "=", true);
    const scopedSchoolId = schoolId ?? user.active_school_id;
    if (scopedSchoolId) query = query.where("school_id", "=", scopedSchoolId);
    const memberships = await query.orderBy("role").execute();
    if (!scopedSchoolId && new Set(memberships.map((m) => m.school_id)).size > 1) {
      throw new BadRequestException("Select an active school before opening this workspace.");
    }
    const membership = memberships[0];
    if (!membership) throw new ForbiddenException(`An active ${roles.join(" or ")} membership is required.`);
    return membership;
  }

  private async schoolLocalDate(schoolId: string): Promise<string> {
    const result = await sql<{ date: string }>`
      SELECT (now() AT TIME ZONE timezone)::date::text AS date
      FROM schools WHERE id=${schoolId}::uuid
    `.execute(this.db);
    if (!result.rows[0]?.date) throw new NotFoundException("School not found.");
    return result.rows[0].date;
  }

  async attendanceSummary(studentId: string, term: EnrollmentContext): Promise<{ total: number; present: number; absent: number; late: number; excused: number; half_day: number; percentage: number }> {
    const result = await sql<{ total: string; present: string; absent: string; late: string; excused: string; half_day: string }>`
      SELECT count(*) FILTER (WHERE status <> 'excused')::text AS total,
        count(*) FILTER (WHERE status='present')::text AS present,
        count(*) FILTER (WHERE status='absent')::text AS absent,
        count(*) FILTER (WHERE status='late')::text AS late,
        count(*) FILTER (WHERE status='excused')::text AS excused,
        count(*) FILTER (WHERE status='half_day')::text AS half_day
      FROM attendance_records WHERE student_id=${studentId}::uuid
        AND date BETWEEN ${term.starts_on}::date AND LEAST(${term.ends_on}::date, ${term.school_date}::date)
    `.execute(this.db);
    const row = result.rows[0] ?? { total: "0", present: "0", absent: "0", late: "0", excused: "0", half_day: "0" };
    const values = { total: Number(row.total), present: Number(row.present), absent: Number(row.absent), late: Number(row.late), excused: Number(row.excused), half_day: Number(row.half_day) };
    const attended = values.present + values.late + values.half_day * 0.5;
    return { ...values, percentage: values.total ? Math.round(attended * 10_000 / values.total) / 100 : 0 };
  }

  async attendanceRecords(studentId: string, term?: EnrollmentContext) {
    let query = this.db.selectFrom("attendance_records").selectAll().where("student_id", "=", studentId);
    if (term) query = query.where("date", ">=", term.starts_on)
      .where("date", "<=", term.ends_on).where("date", "<=", term.school_date);
    const rows = await query.orderBy("date", "desc").execute();
    return rows.map((row) => ({ ...row, status_label: row.status.replace("_", " ").replace(/^./, (value) => value.toUpperCase()) }));
  }

  async latestGate(studentId: string, date?: string) {
    let query = this.db.selectFrom("gate_events").selectAll()
      .where("student_id", "=", studentId)
      .where("occurred_at", "<=", new Date());
    if (date) query = query.where(sql<boolean>`occurred_at::date = ${date}::date`);
    const row = await query.orderBy("occurred_at", "desc").executeTakeFirst();
    return row ? { ...row, direction_label: row.direction === "in" ? "Entry" : "Exit" } : null;
  }

  async dbGateEvents(studentId: string) {
    const rows = await this.db.selectFrom("gate_events").selectAll().where("student_id", "=", studentId)
      .orderBy("occurred_at", "desc").limit(100).execute();
    return rows.map((row) => ({ ...row, direction_label: row.direction === "in" ? "Entry" : "Exit" }));
  }

  async subjectAttendance(studentId: string, termId: string) {
    const result = await sql<any>`
      SELECT sa.id, sa.classes_held, sa.classes_attended, sa.classes_excused,
        CASE WHEN sa.classes_held-sa.classes_excused=0 THEN 0 ELSE round(sa.classes_attended*100.0/(sa.classes_held-sa.classes_excused), 2) END AS percentage,
        s.id AS subject_id, s.code, s.name, s.short_name, s.color, s.icon,
        next_slot.room, next_slot.weekday AS next_weekday, next_slot.starts_at AS next_starts_at,
        next_slot.teacher_user_id, next_slot.teacher_first_name, next_slot.teacher_last_name,
        next_slot.teacher_designation
      FROM subject_attendance sa
      JOIN subjects s ON s.id=sa.subject_id
      JOIN students subject_student ON subject_student.id=sa.student_id
      JOIN schools subject_school ON subject_school.id=subject_student.school_id
      LEFT JOIN LATERAL (
        SELECT ts.room, ts.weekday, ts.starts_at, ts.teacher_user_id, ts.teacher_designation,
          u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM enrollments e
        JOIN timetable_slots ts ON ts.class_section_id=e.class_section_id
          AND ts.term_id=e.term_id AND ts.subject_id=sa.subject_id
        LEFT JOIN users u ON u.id=ts.teacher_user_id
        WHERE e.student_id=sa.student_id AND e.term_id=sa.term_id AND e.is_active
        ORDER BY CASE
          WHEN ts.weekday=extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
            AND ts.starts_at > (current_timestamp AT TIME ZONE subject_school.timezone)::time THEN 0
          WHEN ts.weekday > extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
            THEN ts.weekday-extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int
          ELSE 7-extract(isodow FROM current_timestamp AT TIME ZONE subject_school.timezone)::int+ts.weekday
        END, ts.starts_at
        LIMIT 1
      ) next_slot ON true
      WHERE sa.student_id=${studentId}::uuid AND sa.term_id=${termId}::uuid ORDER BY s.name
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id,
      subject: { id: row.subject_id, code: row.code, name: row.name, short_name: row.short_name, color: row.color, icon: row.icon },
      classes_held: row.classes_held, classes_attended: row.classes_attended,
      classes_excused: row.classes_excused, percentage: row.percentage,
      room: row.room || null,
      teacher: row.teacher_user_id ? {
        id: row.teacher_user_id,
        name: `${row.teacher_first_name} ${row.teacher_last_name}`.trim(),
        designation: row.teacher_designation,
      } : null,
      next_class: row.next_weekday ? {
        weekday: Number(row.next_weekday),
        weekday_label: weekdayLabels[Number(row.next_weekday)],
        starts_at: row.next_starts_at,
      } : null,
    }));
  }

  async classAttendanceRanking(studentId: string, enrollment: EnrollmentContext) {
    const result = await sql<any>`
      WITH attendance_scores AS (
        SELECT st.id AS student_id, st.avatar_url, e.roll_number, u.first_name, u.last_name,
          count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS recorded_days,
          array_agg(ar.status ORDER BY ar.date DESC) FILTER (WHERE ar.id IS NOT NULL AND ar.status <> 'excused') AS recent_statuses,
          COALESCE(sum(CASE
            WHEN ar.status IN ('present','late') THEN 1.0
            WHEN ar.status='half_day' THEN 0.5
            ELSE 0.0
          END), 0)::numeric AS attendance_points
        FROM enrollments e
        JOIN students st ON st.id=e.student_id
        JOIN school_people u ON u.id=st.person_id
        LEFT JOIN attendance_records ar ON ar.student_id=st.id
          AND ar.date BETWEEN ${enrollment.starts_on}::date AND LEAST(${enrollment.ends_on}::date, ${enrollment.school_date}::date)
        WHERE e.class_section_id=${enrollment.class_section_id}::uuid
          AND e.term_id=${enrollment.term_id}::uuid AND e.is_active
        GROUP BY st.id, st.avatar_url, e.roll_number, u.first_name, u.last_name
      ), eligible_scores AS (
        SELECT *, round(attendance_points * 100.0 / NULLIF(recorded_days, 0), 2) AS percentage
        FROM attendance_scores WHERE recorded_days >= 5
      ), ranked AS (
        SELECT *, dense_rank() OVER (
          ORDER BY percentage DESC, attendance_points DESC, recorded_days DESC
        )::int AS rank
        FROM eligible_scores
      )
      SELECT attendance_scores.*,
        round(attendance_scores.attendance_points * 100.0 / NULLIF(attendance_scores.recorded_days, 0), 2) AS percentage,
        ranked.rank
      FROM attendance_scores LEFT JOIN ranked ON ranked.student_id=attendance_scores.student_id
      ORDER BY ranked.rank NULLS LAST, attendance_scores.roll_number
    `.execute(this.db);
    const rows = result.rows.map((row) => {
      const recentStatuses = (row.recent_statuses ?? []) as string[];
      const firstMissedDay = recentStatuses.findIndex((status) => !["present", "late"].includes(status));
      return {
        student_id: row.student_id,
        avatar_url: row.avatar_url || null,
        rank: row.rank == null ? null : Number(row.rank),
        name: row.student_id === studentId
          ? `${row.first_name} ${row.last_name}`.trim()
          : `${row.first_name} ${String(row.last_name ?? "").slice(0, 1)}.`.trim(),
        attended: Number(row.attendance_points),
        held: Number(row.recorded_days),
        streak: firstMissedDay === -1 ? recentStatuses.length : firstMissedDay,
        percentage: row.percentage == null ? null : Number(row.percentage),
      };
    });
    const eligible = rows.filter((row) => row.rank !== null);
    const current = eligible.find((row) => row.student_id === studentId);
    const published = eligible.length > 1 && Boolean(current);
    return {
      published,
      as_of: enrollment.school_date,
      cohort_size: eligible.length,
      minimum_recorded_days: 5,
      methodology: "Daily attendance points: present or late = 1, half day = 0.5, absent = 0, and excused leave is excluded; ranked by percentage, then attendance points and recorded days.",
      current_rank: current?.rank ?? null,
      current_streak: current?.streak ?? 0,
      leaders: eligible.slice(0, 3).map((row) => ({
        rank: row.rank,
        name: row.name,
        avatar_url: row.avatar_url,
        attended: row.attended,
        held: row.held,
        streak: row.streak,
        percentage: row.percentage,
      })),
      students: published ? rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        avatar_url: row.avatar_url,
        attended: row.attended,
        held: row.held,
        streak: row.streak,
        percentage: row.percentage,
        is_current: row.student_id === studentId,
      })) : [],
    };
  }

  async timetable(enrollment: Pick<EnrollmentContext, "class_section_id" | "term_id">, weekday?: number, date?: string) {
    const result = await sql<any>`
      SELECT ts.*, s.code, s.name AS subject_name, s.short_name, s.color AS subject_color, s.icon AS subject_icon,
        u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
      FROM ${date?sql`effective_school_schedule((SELECT school_id FROM class_sections WHERE id=${enrollment.class_section_id}::uuid),${date}::date)`:sql`timetable_slots`} ts LEFT JOIN subjects s ON s.id=ts.subject_id
      LEFT JOIN users u ON u.id=ts.teacher_user_id
      WHERE ts.class_section_id=${enrollment.class_section_id}::uuid AND ts.term_id=${enrollment.term_id}::uuid
        AND (${weekday ?? null}::smallint IS NULL OR ts.weekday=${weekday ?? null}::smallint)
      ORDER BY ts.weekday, ts.period_number
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id, weekday: row.weekday, weekday_label: weekdayLabels[row.weekday],
      period_number: row.period_number, starts_at: row.starts_at, ends_at: row.ends_at,
      slot_type: row.slot_type, slot_type_label: String(row.slot_type).replace(/^./, (v: string) => v.toUpperCase()),
      display_title: row.day_plan_id?row.title:row.subject_name ?? row.title, title: row.title, room: row.room,
      subject: row.subject_id ? { id: row.subject_id, code: row.code, name: row.subject_name, short_name: row.short_name, color: row.subject_color, icon: row.subject_icon } : null,
      teacher: row.teacher_user_id ? { id: row.teacher_user_id, name: `${row.teacher_first_name} ${row.teacher_last_name}`.trim(), designation: row.teacher_designation } : null,
      cancelled: row.cancelled ?? false, materials: row.materials ?? [], day_plan_id: row.day_plan_id ?? null,
      plan_version: row.plan_version ?? null, notice: row.notice ?? '', date: date ?? null,
    }));
  }

  async dayPlanSummary(classId:string,date:string){
    return (await sql`SELECT d.id,d.date,d.published_version AS version,v.notice,v.published_at,
      (SELECT count(*)::int FROM day_plan_periods p WHERE p.plan_id=d.id AND p.version=d.published_version AND p.cancelled) AS cancelled_periods
      FROM day_plans d JOIN day_plan_versions v ON v.plan_id=d.id AND v.version=d.published_version
      WHERE d.class_section_id=${classId}::uuid AND d.date=${date}::date`.execute(this.db)).rows[0]??null;
  }

  async diaryItems(studentId: string, enrollment: EnrollmentContext, dateFrom?: string, dateTo?: string) {
    const result = await sql<any>`
      SELECT di.*, s.id AS subject_join_id, s.name AS subject_name, s.short_name,
        au.first_name AS author_first_name, au.last_name AS author_last_name,
        EXISTS(SELECT 1 FROM diary_acknowledgements da WHERE da.item_id=di.id AND da.student_id=${studentId}::uuid) AS acknowledged
      FROM diary_items di LEFT JOIN subjects s ON s.id=di.subject_id JOIN users au ON au.id=di.author_id
      WHERE di.class_section_id=${enrollment.class_section_id}::uuid AND di.term_id=${enrollment.term_id}::uuid
        AND di.published_at <= now()
        AND (${dateFrom ?? null}::date IS NULL OR di.date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR di.date <= ${dateTo ?? null}::date)
      ORDER BY di.date DESC, di.created_at DESC LIMIT 200
    `.execute(this.db);
    const items = [];
    for (const row of result.rows) {
      const notes = await sql<any>`
        SELECT dn.id, dn.body, dn.created_at, u.first_name, u.last_name
        FROM diary_notes dn JOIN users u ON u.id=dn.author_id
        WHERE dn.item_id=${row.id}::uuid AND dn.student_id=${studentId}::uuid ORDER BY dn.created_at
      `.execute(this.db);
      items.push({
        id: row.id, date: row.date, item_type: row.item_type,
        item_type_label: String(row.item_type).replace(/^./, (value: string) => value.toUpperCase()),
        subject: row.subject_join_id ? { id: row.subject_join_id, name: row.subject_name, short_name: row.short_name } : null,
        title: row.title, body: row.body,
        author_name: `${row.author_first_name} ${row.author_last_name}`.trim(), due_at: row.due_at,
        requires_acknowledgement: row.requires_acknowledgement, acknowledged: row.acknowledged,
        published_at: row.published_at,
        notes: notes.rows.map((note) => ({ id: note.id, author_name: `${note.first_name} ${note.last_name}`.trim(), body: note.body, created_at: note.created_at })),
      });
    }
    return items;
  }

  async contacts(schoolId: string) {
    return this.db.selectFrom("school_contacts").select(["id", "label", "name", "phone", "email", "availability"])
      .where("school_id", "=", schoolId).orderBy("priority").limit(5).execute();
  }

  async leaveDto(leaveId: string, request?: FastifyRequest) {
    const result = await sql<any>`
      SELECT lr.*, ru.first_name AS requester_first, ru.last_name AS requester_last,
        gu.first_name AS guardian_first, gu.last_name AS guardian_last,
        du.first_name AS decider_first, du.last_name AS decider_last,
        COALESCE(su.first_name, sp.first_name, '') AS student_first, COALESCE(su.last_name, sp.last_name, '') AS student_last,
        st.admission_number, st.avatar_url AS student_avatar, cs.grade AS class_grade, cs.section AS class_section
      FROM leave_requests lr JOIN users ru ON ru.id=lr.requested_by
      JOIN students st ON st.id=lr.student_id
      LEFT JOIN users su ON su.id=st.user_id
      LEFT JOIN school_people sp ON sp.id=st.id
      LEFT JOIN enrollments e ON e.student_id=st.id AND e.term_id=lr.term_id AND e.is_active
      LEFT JOIN class_sections cs ON cs.id=e.class_section_id
      LEFT JOIN users gu ON gu.id=lr.guardian_authorized_by
      LEFT JOIN users du ON du.id=lr.decided_by WHERE lr.id=${leaveId}::uuid
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Leave request not found.");
    const [documents, audits] = await Promise.all([
      this.db.selectFrom("leave_documents").selectAll()
        .where("leave_request_id", "=", leaveId).orderBy("created_at").execute(),
      sql<any>`
        SELECT la.*, u.first_name, u.last_name FROM leave_audits la JOIN users u ON u.id=la.actor_id
        WHERE la.leave_request_id=${leaveId}::uuid ORDER BY la.created_at,
          CASE la.action WHEN 'submitted' THEN 0 WHEN 'document_added' THEN 1 WHEN 'clarification_requested' THEN 2 WHEN 'authorized' THEN 3 WHEN 'declined' THEN 3 WHEN 'approved' THEN 4 WHEN 'rejected' THEN 4 WHEN 'withdrawn' THEN 5 ELSE 9 END,
          la.id
      `.execute(this.db),
    ]);
    const origin = request ? `${request.protocol}://${request.headers.host}` : "";
    return {
      id: row.id, student_id: row.student_id, term_id: row.term_id,
      student: {
        id: row.student_id, name: `${row.student_first} ${row.student_last}`.trim(), display_name: `${row.student_first} ${row.student_last}`.trim(),
        admission_number: row.admission_number, avatar_url: row.student_avatar,
        class_name: row.class_grade ? `Class ${row.class_grade}${row.class_section}` : null,
      },
      class_name: row.class_grade ? `Class ${row.class_grade}${row.class_section}` : null,
      category: row.category, category_label: categoryLabels[row.category] ?? row.category,
      starts_on: dateOnly(row.starts_on), ends_on: dateOnly(row.ends_on),
      duration_days: daysInclusive(row.starts_on, row.ends_on), reason: row.reason,
      status: row.status, status_label: statusLabels[row.status] ?? row.status,
      requested_by_name: `${row.requester_first} ${row.requester_last}`.trim(), submitted_at: row.submitted_at,
      guardian_authorized_by_name: row.guardian_authorized_by ? `${row.guardian_first} ${row.guardian_last}`.trim() : null,
      guardian_authorized_at: row.guardian_authorized_at,
      decided_by_name: row.decided_by ? `${row.decider_first} ${row.decider_last}`.trim() : null,
      decided_at: row.decided_at,
      documents: documents.map((document) => ({
        id: document.id, original_name: document.original_name, content_type: document.content_type,
        size_bytes: document.size_bytes,
        file_url: `${origin}/api/v1/leave-requests/${leaveId}/documents/${document.id}/download/`,
        created_at: document.created_at,
      })),
      audit_log: audits.rows.map((audit) => ({
        id: audit.id, action: audit.action, action_label: actionLabels[audit.action] ?? audit.action,
        from_status: audit.from_status, to_status: audit.to_status, note: audit.note,
        actor_name: `${audit.first_name} ${audit.last_name}`.trim(), created_at: audit.created_at,
      })),
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  async leaveForUser(user: AuthUser, leaveId: string) {
    const row = await this.db.selectFrom("leave_requests").select(["id", "student_id", "status", "requested_by"])
      .where("id", "=", leaveId).executeTakeFirst();
    if (!row) throw new NotFoundException("Leave request not found.");
    const student = await this.studentForUser(user, row.student_id);
    return { leave: row, student };
  }

  async leaveList(user: AuthUser, studentId?: string, status?: string, request?: FastifyRequest) {
    const valid = ["draft", "pending_guardian", "authorized", "declined", "school_approved", "school_rejected", "withdrawn"];
    if (status && !valid.includes(status)) throw new BadRequestException("Unknown leave status.");
    let query = this.db.selectFrom("leave_requests").select("id");
    // Staff and leadership see the whole school's queue unless they ask for one student;
    // students and guardians are always scoped to a student they may see.
    const staff = studentId ? null : await this.db.selectFrom("school_memberships").select("school_id")
      .where("user_id", "=", user.id).where("role", "in", ["staff", "admin"]).where("is_active", "=", true).executeTakeFirst();
    if (staff) {
      query = query.where("student_id", "in", this.db.selectFrom("students").select("id").where("school_id", "=", staff.school_id));
    } else {
      const student = await this.studentForUser(user, studentId);
      query = query.where("student_id", "=", student.id);
    }
    if (status) query = query.where("status", "=", status as LeaveStatus);
    const rows = await query.orderBy("created_at", "desc").limit(200).execute();
    return Promise.all(rows.map((row) => this.leaveDto(row.id, request)));
  }

  private validateUpload(upload: UploadInput): void {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(upload.mimetype)) {
      throw new BadRequestException("Only PDF, JPEG, and PNG documents are accepted.");
    }
    if (upload.data.byteLength > 10 * 1024 * 1024) throw new BadRequestException("File must not exceed 10 MB.");
    if (!upload.data.byteLength) throw new BadRequestException("The uploaded document is empty.");
  }

  private async guardianRelationship(db: Db, userId: string, studentId: string, lock = false) {
    const result = await sql<{ id: string; can_authorize_leave: boolean; relationship: string }>`
      SELECT gr.id, guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date) AS can_authorize_leave, gr.relationship FROM guardian_relationships gr
      JOIN parents p ON p.id=gr.guardian_id JOIN students st ON st.id=gr.student_id
      JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id
      JOIN schools sc ON sc.id=st.school_id JOIN users u ON u.id=p.user_id AND u.is_active
      WHERE p.user_id=${userId}::uuid AND gr.student_id=${studentId}::uuid
        AND m.role='guardian' AND m.is_active LIMIT 1 ${lock ? sql`FOR SHARE OF gr,m,u` : sql``}
    `.execute(db);
    return result.rows[0] ?? null;
  }

  private async addLeaveAudit(db: Db, leaveId: string, actorId: string, action: any, fromStatus: string, toStatus: string, note = "") {
    await db.insertInto("leave_audits").values({ leave_request_id: leaveId, actor_id: actorId, action, from_status: fromStatus, to_status: toStatus, note: note.slice(0, 500) }).execute();
  }

  private async notify(db: Db, recipientId: string | null, input: { title: string; body: string; link: string; metadata: Record<string, unknown> }) {
    if (!recipientId) return; // A school person without an account cannot receive an app notification.
    await db.insertInto("notifications").values({ recipient_id: recipientId, kind: "leave", title: input.title, body: input.body.slice(0, 500), link: input.link, metadata: input.metadata, read_at: null }).execute();
  }

  private async leaveEventAudience(db: Db, student: StudentContext): Promise<string[]> {
    const result = await sql<{ user_id: string }>`
      SELECT DISTINCT audience.user_id FROM (
        SELECT ${student.user_id}::uuid AS user_id
        UNION
        SELECT p.user_id
        FROM guardian_relationships gr
        JOIN parents p ON p.id=gr.guardian_id
        JOIN users u ON u.id=p.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=p.user_id
          AND m.school_id=${student.school_id}::uuid AND m.role='guardian' AND m.is_active
        WHERE gr.student_id=${student.id}::uuid
        UNION
        SELECT m.user_id
        FROM school_memberships m
        JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${student.school_id}::uuid AND m.is_active
          AND (m.role='admin' OR (m.role='staff' AND EXISTS (
            SELECT 1
            FROM enrollments e
            JOIN timetable_slots slot ON slot.class_section_id=e.class_section_id
              AND slot.term_id=e.term_id AND slot.teacher_user_id=m.user_id
            WHERE e.student_id=${student.id}::uuid AND e.is_active
          )))
      ) audience WHERE audience.user_id IS NOT NULL
    `.execute(db);
    return result.rows.map((row) => row.user_id);
  }

  private async enqueueLeaveUpdate(db: Db, input: {
    student: StudentContext;
    leaveId: string;
    requestId: string;
    action: string;
    status: LeaveStatus;
    changedAttendanceDates?: string[];
  }): Promise<void> {
    const changedAttendanceDates = input.changedAttendanceDates ?? [];
    const refresh = [
      "student.leave", "student.home", "parent.leave", "parent.home",
      "notifications", "teacher.home", "principal.home",
      ...(changedAttendanceDates.length
        ? ["student.attendance", "parent.attendance", "teacher.attendance", "principal.attendance"]
        : []),
    ];
    await this.events.enqueueUserEvent(db, {
      schoolId: input.student.school_id,
      eventType: "leave.updated",
      aggregateType: "leave_request",
      aggregateId: input.leaveId,
      audienceUserIds: await this.leaveEventAudience(db, input.student),
      payload: {
        leave_request_id: input.leaveId,
        student_id: input.student.id,
        action: input.action,
        status: input.status,
        changed_attendance_dates: changedAttendanceDates,
        refresh,
      },
      idempotencyKey: `leave:${input.requestId}:${input.leaveId}:${input.action}:${input.status}`,
    });
  }

  private async leaveConstraints(termId: string) {
    const policy = await this.db.selectFrom("attendance_policies")
      .select("medical_document_after_days")
      .where("term_id", "=", termId)
      .executeTakeFirst();
    return {
      max_duration_days: 31,
      medical_document_after_days: policy?.medical_document_after_days ?? null,
      accepted_documents: ["application/pdf", "image/jpeg", "image/png"],
      max_document_size_bytes: 10 * 1024 * 1024,
    };
  }

  async createLeave(user: AuthUser, body: unknown, upload: UploadInput | undefined, request: FastifyRequest) {
    const data = leaveSchema.parse(body);
    const duration = daysInclusive(data.starts_on, data.ends_on);
    if (duration < 1) throw new BadRequestException("Leave must end on or after its start date.");
    if (duration > 31) throw new BadRequestException("A single leave request cannot exceed 31 calendar days.");
    if (upload) this.validateUpload(upload);
    const student = await this.studentForUser(user, data.student_id);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may submit this leave request.");
    const termResult = await sql<{ id: string }>`
      SELECT term.id
      FROM academic_terms term
      JOIN enrollments enrollment ON enrollment.term_id=term.id
        AND enrollment.student_id=${student.id}::uuid AND enrollment.is_active
      WHERE term.school_id=${student.school_id}::uuid
        AND term.starts_on <= ${data.starts_on}::date
        AND term.ends_on >= ${data.ends_on}::date
      ORDER BY term.is_active DESC, term.starts_on DESC
      LIMIT 1
    `.execute(this.db);
    const termId = termResult.rows[0]?.id;
    if (!termId) throw new BadRequestException("The full leave range must fall inside an active enrollment term.");
    const constraints = await this.leaveConstraints(termId);
    const medicalDocumentAfterDays = constraints.medical_document_after_days;
    if (data.category === "medical" && medicalDocumentAfterDays !== null && duration > medicalDocumentAfterDays && !upload) {
      throw new BadRequestException(
        `A supporting document is required for medical leave longer than ${medicalDocumentAfterDays} calendar days.`,
      );
    }

    let temporaryPath: string | undefined;
    let finalPath: string | undefined;
    let storageKey: string | undefined;
    if (upload) {
      await mkdir(config().uploadDir, { recursive: true, mode: 0o750 });
      const extension = [".pdf", ".jpg", ".jpeg", ".png"].includes(extname(upload.filename).toLowerCase()) ? extname(upload.filename).toLowerCase() : "";
      storageKey = `${randomUUID()}${extension}`;
      temporaryPath = join(config().uploadDir, `.${storageKey}.pending`);
      finalPath = join(config().uploadDir, storageKey);
      await writeFile(temporaryPath, upload.data, { flag: "wx", mode: 0o640 });
    }
    const requestId = (request as AuthenticatedRequest).requestId ?? randomUUID();
    try {
      const leaveId = await this.db.transaction().execute(async (trx) => {
        const currentGuardian = await this.guardianRelationship(trx, user.id, student.id, true);
        if (!self && !currentGuardian) throw new ForbiddenException("Your guardian access is no longer active.");
        const leave = await trx.insertInto("leave_requests").values({
          student_id: student.id, term_id: termId, requested_by: user.id, category: data.category,
          starts_on: data.starts_on, ends_on: data.ends_on, reason: data.reason,
          status: "pending_guardian", submitted_at: new Date(), guardian_authorized_by: null,
          guardian_authorized_at: null, decided_by: null, decided_at: null,
        }).returning("id").executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leave.id, user.id, "submitted", "draft", "pending_guardian", guardian ? "Leave request submitted by a guardian." : "Leave request submitted for guardian authorization.");
        let status: LeaveStatus = "pending_guardian";
        if (currentGuardian?.can_authorize_leave) {
          status = "authorized";
          await trx.updateTable("leave_requests").set({ status, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leave.id).execute();
          await this.addLeaveAudit(trx, leave.id, user.id, "authorized", "pending_guardian", status, "Guardian submitted and authorized the leave request.");
          await this.notify(trx, student.user_id, { title: "Leave request ready for school review", body: `${user.first_name} ${user.last_name} submitted and authorized the request; it is ready for school review.`, link: `/student/leave?leave_id=${leave.id}`, metadata: { leave_request_id: leave.id, student_id: student.id } });
        } else {
          const guardians = await sql<{ user_id: string }>`
            SELECT DISTINCT p.user_id
            FROM parents p
            JOIN guardian_relationships gr ON gr.guardian_id=p.id
            JOIN users u ON u.id=p.user_id AND u.is_active
            JOIN school_memberships m ON m.user_id=p.user_id
              AND m.school_id=${student.school_id}::uuid
              AND m.role='guardian' AND m.is_active
            JOIN schools sc ON sc.id=gr.school_id
            WHERE gr.student_id=${student.id}::uuid AND guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date)
          `.execute(trx);
          for (const recipient of guardians.rows) await this.notify(trx, recipient.user_id, {
            title: "Leave authorization required",
            body: `${student.first_name} ${student.last_name} submitted a ${duration}-day leave request.`,
            link: `/parent/leave?leave_id=${leave.id}&student_id=${student.id}`,
            metadata: { leave_request_id: leave.id, student_id: student.id },
          });
        }
        if (upload && storageKey && temporaryPath && finalPath) {
          await rename(temporaryPath, finalPath);
          temporaryPath = undefined;
          await trx.insertInto("leave_documents").values({ leave_request_id: leave.id, storage_key: storageKey, original_name: upload.filename.slice(0, 255), content_type: upload.mimetype, size_bytes: upload.data.byteLength, uploaded_by: user.id }).execute();
          await this.addLeaveAudit(trx, leave.id, user.id, "document_added", status, status, `Added ${upload.filename}`);
        }
        await this.enqueueLeaveUpdate(trx, {
          student, leaveId: leave.id, requestId, action: "created", status,
        });
        return leave.id;
      });
      return await this.leaveDto(leaveId, request);
    } catch (error) {
      if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
      if (finalPath) await unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  async addLeaveDocument(user: AuthUser, leaveId: string, upload: UploadInput, request: FastifyRequest) {
    this.validateUpload(upload);
    const scoped = await this.leaveForUser(user, leaveId);
    const self = scoped.student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, scoped.student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may add leave documents.");
    if (!["draft", "pending_guardian", "authorized"].includes(scoped.leave.status)) throw new BadRequestException("Documents cannot be added to a closed leave request.");
    await mkdir(config().uploadDir, { recursive: true, mode: 0o750 });
    const extension = [".pdf", ".jpg", ".jpeg", ".png"].includes(extname(upload.filename).toLowerCase()) ? extname(upload.filename).toLowerCase() : "";
    const storageKey = `${randomUUID()}${extension}`;
    const temporaryPath = join(config().uploadDir, `.${storageKey}.pending`);
    const finalPath = join(config().uploadDir, storageKey);
    await writeFile(temporaryPath, upload.data, { flag: "wx", mode: 0o640 });
    let moved = false;
    try {
      const document = await this.db.transaction().execute(async (trx) => {
        const locked = await sql<{ student_id: string; status: LeaveStatus }>`
          SELECT student_id, status FROM leave_requests WHERE id=${leaveId}::uuid FOR UPDATE
        `.execute(trx);
        const current = locked.rows[0];
        if (!current || current.student_id !== scoped.student.id) throw new NotFoundException("Leave request not found.");
        const currentGuardian = await this.guardianRelationship(trx, user.id, current.student_id);
        if (scoped.student.user_id !== user.id && !currentGuardian) {
          throw new ForbiddenException("Your authority to add a leave document has changed.");
        }
        if (!["draft", "pending_guardian", "authorized"].includes(current.status)) {
          throw new BadRequestException("Documents cannot be added to a closed leave request.");
        }
        await rename(temporaryPath, finalPath); moved = true;
        const row = await trx.insertInto("leave_documents").values({ leave_request_id: leaveId, storage_key: storageKey, original_name: upload.filename.slice(0, 255), content_type: upload.mimetype, size_bytes: upload.data.byteLength, uploaded_by: user.id }).returningAll().executeTakeFirstOrThrow();
        await this.addLeaveAudit(trx, leaveId, user.id, "document_added", current.status, current.status, `Added ${upload.filename}`);
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student,
          leaveId,
          requestId: (request as AuthenticatedRequest).requestId ?? randomUUID(),
          action: "document_added",
          status: current.status,
        });
        return row;
      });
      const origin = `${request.protocol}://${request.headers.host}`;
      return { id: document.id, original_name: document.original_name, content_type: document.content_type, size_bytes: document.size_bytes, file_url: `${origin}/api/v1/leave-requests/${leaveId}/documents/${document.id}/download/`, created_at: document.created_at };
    } catch (error) {
      await unlink(moved ? finalPath : temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async leaveDocument(user: AuthUser, leaveId: string, documentId: string) {
    const scoped = await this.leaveForUser(user, leaveId);
    const self = scoped.student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, scoped.student.id);
    const administrator = await this.db.selectFrom("school_memberships").select("id")
      .where("user_id", "=", user.id).where("school_id", "=", scoped.student.school_id)
      .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!self && !guardian && !administrator) throw new ForbiddenException("Leave documents are limited to the family and authorized school administrators.");
    const document = await this.db.selectFrom("leave_documents").selectAll()
      .where("id", "=", documentId).where("leave_request_id", "=", leaveId).executeTakeFirst();
    if (!document) throw new NotFoundException("Leave document not found.");
    return { document, stream: createReadStream(join(config().uploadDir, document.storage_key)) };
  }

  private async applyApprovedLeaveAttendance(db: Db, input: {
    leaveId: string; studentId: string; schoolId: string; termId: string;
    startsOn: string; endsOn: string; actorId: string; requestId: string;
  }): Promise<string[]> {
    const enrollment = await db.selectFrom("enrollments").select(["class_section_id", "term_id"])
      .where("student_id", "=", input.studentId).where("term_id", "=", input.termId)
      .where("is_active", "=", true).executeTakeFirst();
    if (!enrollment) throw new BadRequestException("The student is not actively enrolled for the leave term.");
    const days = await sql<{ date: string }>`
      SELECT candidate.day::date::text AS date
      FROM generate_series(${input.startsOn}::date, ${input.endsOn}::date, interval '1 day') candidate(day)
      LEFT JOIN school_calendar_days calendar ON calendar.school_id=${input.schoolId}::uuid
        AND calendar.date=candidate.day::date
      WHERE COALESCE(calendar.is_instructional, EXISTS (
        SELECT 1 FROM timetable_slots slot
        WHERE slot.class_section_id=${enrollment.class_section_id}::uuid
          AND slot.term_id=${input.termId}::uuid
          AND slot.weekday=EXTRACT(ISODOW FROM candidate.day)::int
          AND slot.slot_type IN ('class','activity')
      ))
      ORDER BY candidate.day
    `.execute(db);
    const changedDates: string[] = [];
    for (const day of days.rows) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${enrollment.class_section_id}:${day.date}`}, 0))`.execute(db);
      const current = await db.selectFrom("attendance_records").selectAll()
        .where("student_id", "=", input.studentId).where("date", "=", day.date).executeTakeFirst();
      if (current && current.status !== "absent") continue;
      const registerRows = await sql<any>`
        SELECT * FROM attendance_registers WHERE class_section_id=${enrollment.class_section_id}::uuid
          AND term_id=${input.termId}::uuid AND date=${day.date}::date FOR UPDATE
      `.execute(db);
      const existingRegister = registerRows.rows[0];
      if (existingRegister?.state === "locked") {
        throw new ConflictException("Reopen the locked attendance register before approving leave for this date.");
      }
      const registerRevision = Number(existingRegister?.revision ?? 0) + 1;
      const now = new Date();
      const register = existingRegister
        ? await db.updateTable("attendance_registers").set({ revision: registerRevision, updated_at: now })
            .where("id", "=", existingRegister.id).returningAll().executeTakeFirstOrThrow()
        : await db.insertInto("attendance_registers").values({
            school_id: input.schoolId, class_section_id: enrollment.class_section_id,
            term_id: input.termId, date: day.date, state: "draft", revision: registerRevision,
            submitted_by: null, submitted_at: null, locked_by: null, locked_at: null,
            reopened_by: null, reopened_at: null, reopen_reason: null,
          }).returningAll().executeTakeFirstOrThrow();
      const saved = current
        ? await db.updateTable("attendance_records").set({
            status: "excused", remarks: `Approved leave ${input.leaveId}`,
            marked_by: input.actorId, revision: registerRevision,
            source_request_id: input.requestId, updated_at: now,
          }).where("id", "=", current.id).returningAll().executeTakeFirstOrThrow()
        : await db.insertInto("attendance_records").values({
            student_id: input.studentId, class_section_id: enrollment.class_section_id,
            date: day.date, status: "excused", remarks: `Approved leave ${input.leaveId}`,
            marked_by: input.actorId, revision: registerRevision,
            source_request_id: input.requestId,
          }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("attendance_record_revisions").values({
        attendance_record_id: saved.id, attendance_submission_id: null,
        attendance_register_id: register.id, school_id: input.schoolId,
        student_id: input.studentId, class_section_id: enrollment.class_section_id,
        date: day.date, previous_status: current?.status ?? null, new_status: "excused",
        previous_remarks: current?.remarks ?? null, new_remarks: saved.remarks,
        previous_check_in_at: current?.check_in_at ?? null, new_check_in_at: saved.check_in_at,
        previous_check_out_at: current?.check_out_at ?? null, new_check_out_at: saved.check_out_at,
        reason: "School-approved leave", changed_by: input.actorId,
        request_id: input.requestId, register_revision: registerRevision,
      }).execute();
      await this.events.enqueueAttendanceUpdates(db, {
        schoolId: input.schoolId, classSectionId: enrollment.class_section_id,
        termId: input.termId,
        date: day.date, requestId: input.requestId,
        records: [{ student_id: input.studentId, status: "excused", previous_status: current?.status ?? null, revision: registerRevision }],
        suppressNotifications: true,
      });
      changedDates.push(day.date);
    }
    if (changedDates.length) await this.refreshSubjectAttendance(db, [input.studentId]);
    return changedDates;
  }

  async performLeaveAction(user: AuthUser, leaveId: string, action: string, noteValue: unknown, request: FastifyRequest) {
    const note = z.string().max(500).optional().default("").parse(noteValue).trim();
    const requestId = (request as AuthenticatedRequest).requestId ?? randomUUID();
    const scoped = await this.leaveForUser(user, leaveId);
    const validActions = ["authorize", "clarify", "decline", "withdraw", "approve", "reject"];
    if (!validActions.includes(action)) throw new NotFoundException();

    await this.db.transaction().execute(async (trx) => {
      const lockedResult = await sql<{ status: LeaveStatus; requested_by: string; term_id: string; starts_on: string; ends_on: string }>`SELECT status, requested_by, term_id, starts_on::text, ends_on::text FROM leave_requests WHERE id=${leaveId}::uuid FOR UPDATE`.execute(trx);
      const locked = lockedResult.rows[0];
      if (!locked) throw new NotFoundException("Leave request not found.");
      const guardian = await this.guardianRelationship(trx, user.id, scoped.student.id, true);
      const isSchoolApprover = Boolean(await trx.selectFrom("school_memberships").select("id")
        .where("user_id", "=", user.id).where("school_id", "=", scoped.student.school_id)
        .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
      if (["authorize", "clarify", "decline"].includes(action)) {
        if (!guardian?.can_authorize_leave) throw new ForbiddenException("You are not authorized to review leave for this student.");
        if (locked.status !== "pending_guardian") throw new BadRequestException("Only requests awaiting guardian authorization can be reviewed.");
      }
      if (action === "clarify") {
        if (!note) throw new BadRequestException("Explain what clarification the student should provide.");
        await this.addLeaveAudit(trx, leaveId, user.id, "clarification_requested", locked.status, locked.status, note);
        await this.notify(trx, scoped.student.user_id, { title: "Clarification requested for leave", body: `${user.first_name} ${user.last_name} requested clarification: ${note}`, link: `/student/leave?leave_id=${leaveId}`, metadata: { action: "clarify", leave_request_id: leaveId, student_id: scoped.student.id } });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: "clarification_requested", status: locked.status,
        });
        return;
      }
      if (action === "withdraw") {
        if (user.id !== locked.requested_by && !guardian) throw new ForbiddenException("Only the requester or a linked guardian may withdraw this request.");
        if (!["draft", "pending_guardian", "authorized"].includes(locked.status)) throw new BadRequestException("This leave request can no longer be withdrawn.");
        await trx.updateTable("leave_requests").set({ status: "withdrawn", updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, "withdrawn", locked.status, "withdrawn", note);
        await this.notify(trx, scoped.student.user_id, { title: "Leave request withdrawn", body: "The leave request has been withdrawn.", link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: "withdrawn", status: "withdrawn",
        });
        return;
      }
      if (["approve", "reject"].includes(action)) {
        if (!isSchoolApprover) throw new ForbiddenException("An active school administrator must decide a leave request.");
        if (locked.status !== "authorized") throw new BadRequestException("Guardian authorization is required before a school decision.");
        const next = action === "approve" ? "school_approved" : "school_rejected";
        await trx.updateTable("leave_requests").set({ status: next, decided_by: user.id, decided_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
        await this.addLeaveAudit(trx, leaveId, user.id, action === "approve" ? "approved" : "rejected", locked.status, next, note);
        const changedAttendanceDates = action === "approve" ? await this.applyApprovedLeaveAttendance(trx, {
          leaveId, studentId: scoped.student.id, schoolId: scoped.student.school_id,
          termId: locked.term_id, startsOn: locked.starts_on, endsOn: locked.ends_on,
          actorId: user.id, requestId,
        }) : [];
        const guardianUsers = await sql<{ user_id: string }>`
          SELECT DISTINCT p.user_id FROM guardian_relationships gr
          JOIN parents p ON p.id=gr.guardian_id
          JOIN users u ON u.id=p.user_id AND u.is_active
          JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=${scoped.student.school_id}::uuid
            AND m.role='guardian' AND m.is_active
          WHERE gr.student_id=${scoped.student.id}::uuid
        `.execute(trx);
        const recipients = [scoped.student.user_id, ...guardianUsers.rows.map((row) => row.user_id)];
        const notification = {
          title: action === "approve" ? "Leave request approved" : "Leave request not approved",
          body: action === "approve"
            ? `The school approved the leave request${changedAttendanceDates.length ? ` and excused ${changedAttendanceDates.length} instructional day${changedAttendanceDates.length === 1 ? "" : "s"}` : ""}.`
            : "The school did not approve the leave request. Review the decision note or contact the office.",
        };
        for (const recipientId of recipients) await this.notify(trx, recipientId, {
          ...notification,
          link: recipientId === scoped.student.user_id ? `/student/leave?leave_id=${leaveId}` : `/parent/leave?leave_id=${leaveId}&student_id=${scoped.student.id}`,
          metadata: { leave_request_id: leaveId, student_id: scoped.student.id, status: next, changed_attendance_dates: changedAttendanceDates },
        });
        await this.enqueueLeaveUpdate(trx, {
          student: scoped.student, leaveId, requestId,
          action: action === "approve" ? "approved" : "rejected",
          status: next,
          changedAttendanceDates,
        });
        return;
      }
      const next = action === "authorize" ? "authorized" : "declined";
      await trx.updateTable("leave_requests").set({ status: next, guardian_authorized_by: user.id, guardian_authorized_at: new Date(), updated_at: new Date() }).where("id", "=", leaveId).execute();
      await this.addLeaveAudit(trx, leaveId, user.id, action === "authorize" ? "authorized" : "declined", locked.status, next, note);
      await this.notify(trx, scoped.student.user_id, { title: action === "authorize" ? "Leave request authorized" : "Leave request declined", body: action === "authorize" ? `${user.first_name} ${user.last_name} authorized the request; it is ready for school review.` : `${user.first_name} ${user.last_name} declined the leave authorization request.`, link: `/student/leave?leave_id=${leaveId}`, metadata: { leave_request_id: leaveId, student_id: scoped.student.id } });
      await this.enqueueLeaveUpdate(trx, {
        student: scoped.student, leaveId, requestId,
        action: action === "authorize" ? "authorized" : "declined",
        status: next,
      });
    });
    return this.leaveDto(leaveId, request);
  }

  async acknowledgeDiary(user: AuthUser, itemId: string, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may acknowledge this item.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").selectAll().where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id).executeTakeFirst();
    if (!item) throw new NotFoundException("Diary item not found.");
    if (!item.requires_acknowledgement) throw new BadRequestException("This diary item does not require acknowledgement.");
    return this.db.transaction().execute(async (tx) => {
      const existing = await tx.selectFrom("diary_acknowledgements").selectAll().where("item_id", "=", itemId).where("student_id", "=", student.id).executeTakeFirst();
      if (existing) return { data: { id: existing.id, acknowledged_by_name: `${user.first_name} ${user.last_name}`.trim(), acknowledged_at: existing.acknowledged_at }, created: false };
      const created = await tx.insertInto("diary_acknowledgements").values({ item_id: itemId, student_id: student.id, acknowledged_by: user.id }).returningAll().executeTakeFirstOrThrow();
      const audience = (await sql<{ user_id: string }>`
        SELECT audience.user_id FROM (
          SELECT scoped_student.user_id FROM students scoped_student WHERE scoped_student.id=${student.id}::uuid
          UNION
          SELECT parent.user_id FROM guardian_relationships relationship
          JOIN parents parent ON parent.id=relationship.guardian_id
          WHERE relationship.student_id=${student.id}::uuid AND relationship.school_id=${student.school_id}::uuid
        ) audience WHERE audience.user_id IS NOT NULL
      `.execute(tx)).rows.map((row) => row.user_id);
      await this.events.enqueueUserEvent(tx, {
        schoolId: student.school_id,
        eventType: "diary.updated",
        aggregateType: "diary_acknowledgement",
        aggregateId: created.id,
        audienceUserIds: audience,
        payload: {
          diary_item_id: itemId,
          student_id: student.id,
          refresh: ["student.home", "student.diary", "parent.home", "parent.diary"],
        },
        idempotencyKey: `diary-acknowledgement:${created.id}`,
      });
      return { data: { id: created.id, acknowledged_by_name: `${user.first_name} ${user.last_name}`.trim(), acknowledged_at: created.acknowledged_at }, created: true };
    });
  }

  async setHomeworkCompleted(user: AuthUser, itemId: string, studentId: string | undefined, completed: boolean) {
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may update homework.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").select("id").where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id)
      .where("item_type", "=", "homework").where("published_at", "<=", new Date()).executeTakeFirst();
    if (!item) throw new NotFoundException("Homework not found.");
    if (completed) {
      await this.db.insertInto("homework_completions").values({ item_id: itemId, student_id: student.id, completed_by: user.id })
        .onConflict((conflict) => conflict.columns(["item_id", "student_id"]).doNothing()).execute();
    } else {
      await this.db.deleteFrom("homework_completions").where("item_id", "=", itemId).where("student_id", "=", student.id).execute();
    }
    return { item_id: itemId, student_id: student.id, completed };
  }

  async addDiaryNote(user: AuthUser, itemId: string, studentId: string | undefined, bodyValue: unknown) {
    const body = z.string().trim().min(2).max(2000).parse(bodyValue);
    const student = await this.studentForUser(user, studentId);
    const self = student.user_id === user.id;
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    if (!self && !guardian) throw new ForbiddenException("Only the student or a linked guardian may add a diary note.");
    const enrollment = await this.enrollment(student.id);
    const item = await this.db.selectFrom("diary_items").select("id").where("id", "=", itemId)
      .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id).executeTakeFirst();
    if (!item) throw new NotFoundException("Diary item not found.");
    const note = await this.db.insertInto("diary_notes").values({ item_id: itemId, student_id: student.id, author_id: user.id, body }).returningAll().executeTakeFirstOrThrow();
    return { id: note.id, author_name: `${user.first_name} ${user.last_name}`.trim(), body: note.body, created_at: note.created_at };
  }

  async notifications(user: AuthUser, rawPage: { limit?: string | undefined; cursor?: string | undefined } = {}) {
    const page = notificationPageSchema.parse(rawPage);
    const after = notificationCursor(page.cursor);
    let query = this.db.selectFrom("notifications")
      .select(["id", "kind", "title", "body", "link", "metadata", "read_at", "created_at"])
      .where("recipient_id", "=", user.id);
    if (after) {
      query = query.where((expression) => expression.or([
        expression("created_at", "<", after.createdAt),
        expression.and([
          expression("created_at", "=", after.createdAt),
          expression("id", "<", after.id),
        ]),
      ]));
    }
    const [rows, unread] = await Promise.all([
      query.orderBy("created_at", "desc").orderBy("id", "desc").limit(page.limit + 1).execute(),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count"))
        .where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
    ]);
    const results = rows.slice(0, page.limit);
    return {
      results,
      unread_count: Number(unread?.count ?? 0),
      next_cursor: rows.length > page.limit && results.length
        ? encodeNotificationCursor(results[results.length - 1]!)
        : null,
    };
  }

  async markNotificationRead(user: AuthUser, id: string) {
    const row = await this.db.updateTable("notifications").set({ read_at: new Date() }).where("id", "=", id)
      .where("recipient_id", "=", user.id).returning(["id", "read_at"]).executeTakeFirst();
    if (!row) throw new NotFoundException("Notification not found.");
    return row;
  }

  async parentHome(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "guardian"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [summary, campus, schedule, diary, contacts, siblings, unread, pending, homework, recentAttendance, ranking, homeworkItems, eventActions, followupActions] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.diaryItems(student.id, enrollment, schoolDate, schoolDate),
      this.contacts(student.school_id),
      this.accessibleStudentDtos(user),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count")).where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
      this.db.selectFrom("leave_requests").select("id").where("student_id", "=", student.id).where("status", "=", "pending_guardian").orderBy("created_at", "desc").executeTakeFirst(),
      this.db.selectFrom("diary_items").select([
        sql<string>`count(*) FILTER (WHERE published_at >= now() - interval '30 days')::text`.as("recent"),
        sql<string>`count(*) FILTER (WHERE published_at >= now() - interval '60 days' AND published_at < now() - interval '30 days')::text`.as("previous"),
      ])
        .where("class_section_id", "=", enrollment.class_section_id).where("term_id", "=", enrollment.term_id)
        .where("item_type", "=", "homework").where("published_at", "<=", new Date()).executeTakeFirst(),
      this.db.selectFrom("attendance_records").select("status")
        .where("student_id", "=", student.id).where("date", ">=", enrollment.starts_on)
        .where("date", "<=", enrollment.ends_on).where("date", "<=", schoolDate)
        .where("status", "!=", "excused")
        .orderBy("date", "desc").limit(20).execute(),
      this.classAttendanceRanking(student.id, enrollment),
      this.db.selectFrom("diary_items as item")
        .leftJoin("homework_completions as completion", (join) => join.onRef("completion.item_id", "=", "item.id").on("completion.student_id", "=", student.id))
        .leftJoin("subjects as subject", "subject.id", "item.subject_id")
        .select(["item.id", "item.title", "item.body", "item.due_at", "item.published_at", "subject.name as subject_name", "completion.completed_at"])
        .where("item.class_section_id", "=", enrollment.class_section_id).where("item.term_id", "=", enrollment.term_id)
        .where("item.item_type", "=", "homework").where("item.published_at", "<=", new Date())
        .orderBy("item.published_at", "desc").execute(),
      this.familyHomeActions(user, student, "guardian"),
      this.followupHomeActions(user, "guardian", student.id),
    ]);
    const sampleSize = Math.min(10, Math.floor(recentAttendance.length / 2));
    const attendanceScore = (statuses: typeof recentAttendance) => statuses.reduce((score, item) =>
      score + (item.status === "present" || item.status === "late" ? 1 : item.status === "half_day" ? 0.5 : 0), 0) * 100 / statuses.length;
    const attendanceTrend = sampleSize >= 3 ? Math.round((
      attendanceScore(recentAttendance.slice(0, sampleSize)) - attendanceScore(recentAttendance.slice(sampleSize, sampleSize * 2))
    ) * 10) / 10 : null;
    const recentHomework = Number(homework?.recent ?? 0);
    const previousHomework = Number(homework?.previous ?? 0);
    const actionRequired = pending ? await this.leaveDto(pending.id) : null;
    const diaryAcknowledgements = diary.filter((item) => item.requires_acknowledgement && !item.acknowledged);
    const localActions: HomeAction[] = [
      ...(actionRequired ? [{
        id: `leave-signature:${actionRequired.id}`,
        kind: "leave_signature" as const,
        priority: "urgent" as const,
        title: "Review and sign the leave request",
        detail: `${actionRequired.category_label} leave for ${daysInclusive(actionRequired.starts_on, actionRequired.ends_on)} ${daysInclusive(actionRequired.starts_on, actionRequired.ends_on) === 1 ? "day" : "days"}.`,
        status_label: "Guardian decision needed",
        action_label: "Review request",
        href: `/parent/leave?leave_id=${encodeURIComponent(actionRequired.id)}&student_id=${encodeURIComponent(student.id)}`,
        source_id: actionRequired.id,
        occurs_at: actionRequired.submitted_at ? new Date(actionRequired.submitted_at).toISOString() : null,
        due_at: `${dateOnly(actionRequired.starts_on)}T00:00:00.000Z`,
      }] : []),
      ...(diaryAcknowledgements.length ? [{
        id: `diary-acknowledgement:${diaryAcknowledgements[0]!.id}`,
        kind: "diary_acknowledgement" as const,
        priority: "normal" as const,
        title: diaryAcknowledgements.length === 1 ? "A diary note needs acknowledgement" : `${diaryAcknowledgements.length} diary notes need acknowledgement`,
        detail: diaryAcknowledgements[0]!.title,
        status_label: "Unread school note",
        action_label: "Open diary",
        href: `/parent/diary?student_id=${encodeURIComponent(student.id)}`,
        source_id: diaryAcknowledgements[0]!.id,
        occurs_at: new Date(diaryAcknowledgements[0]!.published_at).toISOString(),
        due_at: diaryAcknowledgements[0]!.due_at ? new Date(diaryAcknowledgements[0]!.due_at).toISOString() : null,
      }] : []),
    ];
    return {
      student: await this.studentDto(student, enrollment), siblings: siblings.filter((item) => item.id !== student.id),
      campus_presence: campus, attendance: summary,
      ranking,
      action_required: actionRequired,
      home_actions: sortHomeActions([...localActions, ...followupActions, ...eventActions]).slice(0, 6),
      today_schedule: schedule, day_plan:await this.dayPlanSummary(enrollment.class_section_id,schoolDate), diary_preview: diary.slice(0, 3), unread_notifications: Number(unread?.count ?? 0),
      homework_items: homeworkItems,
      semester_metrics: {
        attendance_percentage: summary.percentage,
        attendance_threshold: Number(enrollment.attendance_threshold),
        attendance_trend_percent: attendanceTrend,
        attendance_rank: ranking.published ? ranking.current_rank : null,
        attendance_cohort_size: ranking.published ? ranking.cohort_size : null,
        periods_today: schedule.length,
        homework_due: homeworkItems.filter((item) => !item.completed_at).length,
        homework_total: homeworkItems.length,
        homework_recent: recentHomework,
        homework_previous: previousHomework,
        dues_status: "All Cleared",
        dues_status_scope: "display_only_demo",
      },
      contacts,
    };
  }

  async parentAttendance(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "guardian"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [records, schedule, summary, latestGate, contacts, ranking] = await Promise.all([
      this.attendanceRecords(student.id, enrollment),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.attendanceSummary(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.contacts(student.school_id),
      this.classAttendanceRanking(student.id, enrollment),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: { id: enrollment.term_id, name: enrollment.term_name, academic_year: enrollment.academic_year, threshold: enrollment.attendance_threshold },
      summary,
      ranking,
      today: records.find((row) => row.date === schoolDate) ?? null,
      latest_gate_event: latestGate,
      expected_dismissal_at: schedule.filter(p=>!p.cancelled).at(-1)?.ends_at ?? null,
      calendar: records,
      contacts,
    };
  }

  async parentDiary(user: AuthUser, studentId?: string, selectedDateValue?: string) {
    const student = await this.studentForUser(user, studentId);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(student.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    await this.requireRole(user, student, "guardian");
    const enrollment = await this.enrollment(student.id, selectedDate);
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    return {
      student: await this.studentDto(student), date: selectedDate,
      items: await this.diaryItems(student.id, enrollment, selectedDate, selectedDate),
      schedule: (await this.timetable(enrollment, isoWeekday(selectedDate),selectedDate)).filter(p=>!p.cancelled),
      guardian: {
        name: `${user.first_name} ${user.last_name}`.trim() || user.username,
        relationship: guardian?.relationship ?? "guardian",
        verified_id: user.username,
      },
    };
  }

  async parentLeave(user: AuthUser, leaveId: string, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "guardian");
    const leave = await this.db.selectFrom("leave_requests").select(["id", "status", "term_id"]).where("id", "=", leaveId).where("student_id", "=", student.id).executeTakeFirst();
    if (!leave) throw new NotFoundException("Leave request not found.");
    const guardian = await this.guardianRelationship(this.db, user.id, student.id);
    return {
      student: await this.studentDto(student),
      request: await this.leaveDto(leave.id, request),
      can_authorize: Boolean(guardian?.can_authorize_leave && leave.status === "pending_guardian"),
      constraints: await this.leaveConstraints(leave.term_id),
    };
  }

  async studentAttendanceScreen(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "student"), this.enrollment(student.id)]);
    const [summary, subjects, ranking, records] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.subjectAttendance(student.id, enrollment.term_id),
      this.classAttendanceRanking(student.id, enrollment),
      this.attendanceRecords(student.id, enrollment),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: { id: enrollment.term_id, name: enrollment.term_name, academic_year: enrollment.academic_year, threshold: enrollment.attendance_threshold },
      summary,
      subjects,
      ranking,
      calendar: records,
    };
  }

  async studentHomeScreen(user: AuthUser, studentId?: string) {
    const student = await this.studentForUser(user, studentId);
    const [, enrollment] = await Promise.all([this.requireRole(user, student, "student"), this.enrollment(student.id)]);
    const schoolDate = enrollment.school_date;
    const [attendance, records, campus, schedule, diary, activeLeaves, unread, homeActions] = await Promise.all([
      this.attendanceSummary(student.id, enrollment),
      this.attendanceRecords(student.id, enrollment),
      this.latestGate(student.id, schoolDate),
      this.timetable(enrollment, isoWeekday(schoolDate),schoolDate),
      this.diaryItems(student.id, enrollment, schoolDate, schoolDate),
      this.db.selectFrom("leave_requests").select(sql<string>`count(*)::text`.as("count"))
        .where("student_id", "=", student.id).where("status", "in", ["pending_guardian", "authorized"]).executeTakeFirst(),
      this.db.selectFrom("notifications").select(sql<string>`count(*)::text`.as("count"))
        .where("recipient_id", "=", user.id).where("read_at", "is", null).executeTakeFirst(),
      this.familyHomeActions(user, student, "student"),
    ]);
    return {
      student: await this.studentDto(student, enrollment),
      term: {
        id: enrollment.term_id,
        name: enrollment.term_name,
        academic_year: enrollment.academic_year,
        threshold: enrollment.attendance_threshold,
      },
      date: schoolDate,
      attendance,
      today_attendance: records.find((record) => record.date === schoolDate) ?? null,
      campus_presence: campus,
      today_schedule: schedule,
      day_plan: await this.dayPlanSummary(enrollment.class_section_id,schoolDate),
      diary_preview: diary.slice(0, 4),
      active_leave_count: Number(activeLeaves?.count ?? 0),
      unread_notifications: Number(unread?.count ?? 0),
      home_actions: sortHomeActions([
        ...diary.filter((item) => item.requires_acknowledgement && !item.acknowledged).slice(0, 1).map((item) => ({
          id: `diary-acknowledgement:${item.id}`,
          kind: "diary_acknowledgement" as const,
          priority: "normal" as const,
          title: "A diary note needs acknowledgement",
          detail: item.title,
          status_label: "Unread school note",
          action_label: "Open diary",
          href: "/student/diary",
          source_id: item.id,
          occurs_at: new Date(item.published_at).toISOString(),
          due_at: item.due_at ? new Date(item.due_at).toISOString() : null,
        })),
        ...homeActions,
      ]).slice(0, 5),
    };
  }

  async eligibilityScreen(user: AuthUser, studentId?: string, subjectId?: string, additionalMissedValue = "1") {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const enrollment = await this.enrollment(student.id);
    const additionalMissed = Number(additionalMissedValue);
    if (!Number.isInteger(additionalMissed) || additionalMissed < 0 || additionalMissed > 30) throw new BadRequestException("additional_missed must be an integer from 0 to 30.");
    const subjects = await this.subjectAttendance(student.id, enrollment.term_id);
    const subject = subjectId ? subjects.find((item) => item.subject.id === subjectId) : [...subjects].sort((a, b) => Number(a.percentage) - Number(b.percentage))[0];
    if (!subject) throw new NotFoundException("No subject attendance has been recorded.");
    const policy = await this.db.selectFrom("attendance_policies").selectAll().where("term_id", "=", enrollment.term_id).executeTakeFirst();
    const threshold = Number(policy?.minimum_percentage ?? enrollment.attendance_threshold);
    const projected = subject.classes_held + additionalMissed ? Math.round(subject.classes_attended * 10_000 / (subject.classes_held + additionalMissed)) / 100 : 0;
    return {
      student: await this.studentDto(student), subject,
      projection: { additional_missed: additionalMissed, projected_percentage: projected, eligible: projected >= threshold, threshold, is_advisory: true },
      policy: { name: policy?.name ?? "Term attendance requirement", minimum_percentage: threshold, medical_document_after_days: policy?.medical_document_after_days ?? null, text: policy?.policy_text ?? "" },
    };
  }

  async timetableScreen(user: AuthUser, mode: string, studentId?: string, selectedDateValue?: string, portal: "student" | "guardian" = "student") {
    if (!['day', 'week'].includes(mode)) throw new NotFoundException();
    const student = await this.studentForUser(user, studentId);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(student.school_id);
    z.iso.date().parse(selectedDate);
    await this.requireRole(user, student, portal);
    const enrollment = await this.enrollment(student.id, selectedDate);
    const monday=new Date(`${selectedDate}T00:00:00Z`);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    const dates=mode==='day'?[selectedDate]:Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
    const slots=(await Promise.all(dates.map(d=>this.timetable(enrollment,undefined,d)))).flat();
    const grouped = new Map<number, any[]>();
    for (const slot of slots) grouped.set(slot.weekday, [...(grouped.get(slot.weekday) ?? []), slot]);
    return {
      student: await this.studentDto(student,enrollment), mode, selected_date: selectedDate,
      class_name: `Class ${enrollment.grade}${enrollment.section}`,
      day_plan: await this.dayPlanSummary(enrollment.class_section_id,selectedDate),
      days: [...grouped.entries()].sort(([left], [right]) => left - right).map(([weekday, periods]) => ({ weekday, weekday_label: weekdayLabels[weekday], periods })),
    };
  }

  async timetableSummaryScreen(
    user: AuthUser,
    startValue: string,
    endValue: string,
    selectedDateValue?: string,
    studentId?: string,
    portal: "student" | "guardian" = "student",
  ) {
    if (!datePattern.test(startValue) || !datePattern.test(endValue))
      throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const startMs = Date.parse(`${startValue}T00:00:00Z`);
    const endMs = Date.parse(`${endValue}T00:00:00Z`);
    const dayCount = Math.round((endMs - startMs) / 86_400_000) + 1;
    if (dayCount < 1) throw new BadRequestException("End date must follow start date.");
    if (dayCount > 370) throw new BadRequestException("Timetable summary ranges are limited to 370 days.");
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, portal);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(student.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const enrollment = await this.enrollment(student.id, selectedDate);
    const days = (
      await sql<{
        date: string;
        periods: number;
        classes: number;
        pending: number;
        accepted: number;
        declined: number;
        cancelled: number;
      }>`WITH days AS (
        SELECT generate_series(${startValue}::date,${endValue}::date,'1 day')::date AS day
      )
      SELECT d.day::text AS date,
        count(e.id) FILTER (WHERE NOT e.cancelled)::int AS periods,
        CASE WHEN count(e.id) FILTER (WHERE NOT e.cancelled)>0 THEN 1 ELSE 0 END::int AS classes,
        0::int AS pending,
        0::int AS accepted,
        0::int AS declined,
        count(e.id) FILTER (WHERE e.cancelled)::int AS cancelled
      FROM days d
      LEFT JOIN LATERAL (
        SELECT * FROM effective_school_schedule(${student.school_id}::uuid,d.day)
        WHERE class_section_id=${enrollment.class_section_id}::uuid
      ) e ON true
      GROUP BY d.day
      ORDER BY d.day`.execute(this.db)
    ).rows;
    const totals = days.reduce(
      (sum, day) => ({
        periods: sum.periods + day.periods,
        classes: sum.classes + day.classes,
        pending: 0,
        accepted: 0,
        declined: 0,
        cancelled: sum.cancelled + day.cancelled,
      }),
      { periods: 0, classes: 0, pending: 0, accepted: 0, declined: 0, cancelled: 0 },
    );
    return { start: startValue, end: endValue, days, totals };
  }

  async leaveApplyScreen(user: AuthUser, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const enrollment = await this.enrollment(student.id);
    const guardians = await sql<any>`SELECT gr.id, gr.relationship, gr.is_primary,
      guardian_may_sign_leave(gr,(clock_timestamp() AT TIME ZONE sc.timezone)::date) AS can_authorize_leave,
      p.id AS parent_id, u.contact_phone AS phone, p.user_id, u.first_name, u.last_name, u.contact_email AS email
      FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
      JOIN schools sc ON sc.id=gr.school_id
      JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${student.school_id}::uuid
      JOIN school_people u ON u.id=gp.person_id WHERE gr.student_id=${student.id}::uuid ORDER BY gr.is_primary DESC`.execute(this.db);
    const recent = (await this.leaveList(user, student.id, undefined, request)).slice(0, 3);
    return {
      student: await this.studentDto(student),
      categories: Object.entries(categoryLabels).map(([value, label]) => ({ value, label })),
      guardians: guardians.rows.map((row) => ({ id: row.id, relationship: row.relationship, is_primary: row.is_primary, can_authorize_leave: row.can_authorize_leave, guardian: { id: row.parent_id, user_id: row.user_id, name: `${row.first_name} ${row.last_name}`.trim(), email: row.email, phone: row.phone } })),
      recent_requests: recent,
      constraints: await this.leaveConstraints(enrollment.term_id),
    };
  }

  async leaveStatusScreen(user: AuthUser, studentId?: string, request?: FastifyRequest) {
    const student = await this.studentForUser(user, studentId);
    await this.requireRole(user, student, "student");
    const leaves = await this.leaveList(user, student.id, undefined, request);
    return { student: await this.studentDto(student), active: leaves.filter((item) => ["pending_guardian", "authorized"].includes(item.status)), history: leaves.filter((item) => !["pending_guardian", "authorized"].includes(item.status)) };
  }

  async teacherHomeScreen(user: AuthUser, selectedDateValue?: string) {
    const membership = await this.requireSchoolRole(user, ["staff", "admin"]);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(membership.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const classes = await attendanceWorkspace(this.db, membership.school_id, user.id, membership.role, selectedDate);
    const weekly = await sql<any>`
      SELECT ts.id, ts.weekday, ts.period_number, ts.starts_at, ts.ends_at, ts.room,
        COALESCE(s.name, ts.title) AS subject_name, cs.id AS class_section_id, cs.grade, cs.section
      FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id
      JOIN academic_terms t ON t.id=ts.term_id AND ${selectedDate}::date BETWEEN t.starts_on AND t.ends_on
      LEFT JOIN subjects s ON s.id=ts.subject_id
      WHERE cs.school_id=${membership.school_id}::uuid
        AND (${membership.role}='admin' OR ts.teacher_user_id=${user.id}::uuid)
      ORDER BY ts.weekday, ts.period_number, cs.grade, cs.section
    `.execute(this.db);
    const [followupActions, eventActions] = await Promise.all([
      this.followupHomeActions(user, "staff"),
      this.staffEventHomeActions(user, membership.school_id, "teacher"),
    ]);
    const registerActions: HomeAction[] = classes
      .filter((item) => item.can_mark !== false && !["submitted", "locked"].includes(item.submission_status))
      .map((item) => ({
        id: `attendance-register:${item.class_section_id}:${selectedDate}`,
        kind: "attendance_register",
        priority: item.submission_status === "in_progress" ? "high" : "normal",
        title: `${item.class_name} attendance is ${item.submission_status === "in_progress" ? "unfinished" : "due"}`,
        detail: `${item.marked_count}/${item.student_count} students marked${item.subjects?.length ? ` for ${item.subjects.join(", ")}` : ""}.`,
        status_label: item.submission_status === "in_progress" ? "Finish register" : "Not started",
        action_label: item.submission_status === "in_progress" ? "Continue attendance" : "Take attendance",
        href: `/teacher/attendance?class_section_id=${encodeURIComponent(item.class_section_id)}&date=${selectedDate}`,
        source_id: item.class_section_id,
        occurs_at: item.starts_at ? `${selectedDate}T${String(item.starts_at).slice(0, 8)}` : null,
        due_at: item.ends_at ? `${selectedDate}T${String(item.ends_at).slice(0, 8)}` : null,
      }));
    return {
      date: selectedDate,
      teacher: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim(), role: membership.role },
      classes,
      weekly_timetable: weekly.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, weekday_label: weekdayLabels[row.weekday] })),
      home_actions: sortHomeActions([...followupActions, ...registerActions, ...eventActions]).slice(0, 6),
    };
  }

  async teacherAttendanceScreen(user: AuthUser, classSectionId: string | undefined, selectedDateValue?: string) {
    if (!classSectionId) throw new BadRequestException("class_section_id is required.");
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(target.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const section = await this.db.selectFrom("class_sections as cs")
      .innerJoin("academic_terms as t", (join) => join
        .onRef("t.school_id", "=", "cs.school_id")
        .onRef("t.academic_year", "=", "cs.academic_year"))
      .select(["cs.id", "cs.school_id", "cs.grade", "cs.section", "cs.room_number", "cs.board", "t.id as term_id", "t.name as term_name", "t.academic_year", "t.starts_on", "t.ends_on"])
      .where("cs.id", "=", classSectionId)
      .where("t.starts_on", "<=", selectedDate)
      .where("t.ends_on", ">=", selectedDate)
      .orderBy("t.starts_on", "desc")
      .executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["staff", "admin"], section.school_id);
    if (membership.role !== "admin") {
      const assigned = await this.db.selectFrom("timetable_slots").select("id")
        .where("class_section_id", "=", classSectionId).where("term_id", "=", section.term_id)
        .where("teacher_user_id", "=", user.id).executeTakeFirst();
      const substitute=(await sql`SELECT id FROM effective_school_schedule(${section.school_id}::uuid,${selectedDate}::date) WHERE class_section_id=${classSectionId}::uuid AND term_id=${section.term_id}::uuid AND teacher_user_id=${user.id}::uuid AND NOT cancelled AND coverage_status='accepted' LIMIT 1`.execute(this.db)).rows[0];
      if (!assigned&&!substitute) throw new ForbiddenException("This class is not assigned to the signed-in teacher.");
    }
    const [roster, register] = await Promise.all([sql<any>`
      SELECT st.id AS student_id, st.admission_number, st.avatar_url, e.roll_number,
        u.first_name, u.last_name, ar.id AS attendance_id, ar.status, ar.remarks,
        ar.revision AS attendance_revision, ar.updated_at
      FROM enrollments e JOIN students st ON st.id=e.student_id JOIN school_people u ON u.id=st.person_id
      LEFT JOIN attendance_records ar ON ar.student_id=st.id AND ar.date=${selectedDate}::date
      WHERE e.class_section_id=${classSectionId}::uuid AND e.term_id=${section.term_id}::uuid AND e.is_active
        AND e.enrolled_on<=${selectedDate}::date
      ORDER BY e.roll_number
    `.execute(this.db), this.db.selectFrom("attendance_registers")
      .selectAll().where("class_section_id", "=", classSectionId)
      .where("term_id", "=", section.term_id).where("date", "=", selectedDate).executeTakeFirst()]);
    const periods = await this.timetable({
      class_section_id: classSectionId,
      term_id: section.term_id,
    }, isoWeekday(selectedDate),selectedDate);
    const dayPolicy = await attendanceDayPolicy(
      this.db,
      section.school_id,
      classSectionId,
      section.term_id,
      selectedDate,
      { userId: user.id, role: membership.role },
    );
    const hasRoster = roster.rows.length > 0;
    const canMark = Boolean(
      dayPolicy?.completed
      && dayPolicy?.instructional
      && dayPolicy?.actor_scheduled
      && hasRoster,
    );
    const rosterFingerprint = attendanceRosterFingerprint({
      schoolId: section.school_id,
      classSectionId,
      termId: section.term_id,
      date: selectedDate,
      studentIds: roster.rows.map((row) => row.student_id),
    });
    const rosterCapturedAt = new Date();
    const rosterExpiresAt = new Date(rosterCapturedAt.getTime() + 18 * 60 * 60 * 1000);
    const capturedAt = rosterCapturedAt.toISOString();
    const expiresAt = rosterExpiresAt.toISOString();
    const snapshotToken = attendanceSnapshotToken({
      userId: user.id,
      schoolId: section.school_id,
      classSectionId,
      termId: section.term_id,
      date: selectedDate,
      rosterFingerprint,
      rosterCount: roster.rows.length,
      capturedAt,
      expiresAt,
    });
    const latestCapture = await this.db.selectFrom("attendance_capture_batches")
      .select(["id", "source", "status", "received_at", "roster_expires_at"])
      .where("class_section_id", "=", classSectionId)
      .where("term_id", "=", section.term_id)
      .where("date", "=", selectedDate)
      .where("recorded_by", "=", user.id)
      .orderBy("received_at", "desc")
      .executeTakeFirst();
    return {
      date: selectedDate,
      availability: {
        can_mark: canMark,
        reason: !dayPolicy?.completed
          ? "Attendance opens on the selected date."
          : !dayPolicy?.instructional
            ? "No attendance is required because this class has no scheduled lesson."
            : !hasRoster
              ? "No enrolled students require attendance for this date."
              : !dayPolicy?.actor_scheduled
                ? "You have no scheduled or accepted cover period for this class on this date."
                : null,
      },
      class: { id: section.id, school_id: section.school_id, term_id: section.term_id, name: `Class ${section.grade}${section.section}`, grade: section.grade, section: section.section, room: section.room_number, board: section.board, term: `${section.term_name} • ${section.academic_year}`, term_starts_on: section.starts_on, term_ends_on: section.ends_on },
      register: register ? {
        id: register.id, state: register.state, revision: register.revision,
        submitted_by: register.submitted_by, submitted_at: register.submitted_at,
        submitted_by_name: dayPolicy?.submitted_by_name ?? null,
        locked_by: register.locked_by, locked_at: register.locked_at,
        reopened_by: register.reopened_by, reopened_at: register.reopened_at,
        reopen_reason: register.reopen_reason,
      } : {
        id: null, state: "draft" as const, revision: 0, submitted_by: null,
        submitted_at: null, locked_by: null, locked_at: null,
        reopened_by: null, reopened_at: null, reopen_reason: null,
      },
      periods,
      continuity_snapshot: {
        roster_fingerprint: rosterFingerprint,
        roster_count: roster.rows.length,
        captured_at: capturedAt,
        expires_at: expiresAt,
        token: snapshotToken,
      },
      latest_capture: latestCapture ? {
        id: latestCapture.id,
        source: latestCapture.source,
        status: latestCapture.status,
        received_at: latestCapture.received_at,
        roster_expires_at: latestCapture.roster_expires_at,
      } : null,
      roster: roster.rows.map((row) => ({
        id: row.student_id, admission_number: row.admission_number, avatar_url: row.avatar_url,
        roll_number: row.roll_number, name: `${row.first_name} ${row.last_name}`.trim(),
        status: row.status ?? null, remarks: row.remarks ?? "", attendance_id: row.attendance_id,
        attendance_revision: Number(row.attendance_revision ?? 0), updated_at: row.updated_at,
      })),
    };
  }

  async refreshSubjectAttendance(db: Db, studentIds: string[]): Promise<void> {
    if (!studentIds.length) return;
    await sql`
      DELETE FROM subject_attendance sa
      USING enrollments e
      WHERE sa.student_id=e.student_id AND sa.term_id=e.term_id AND e.is_active
        AND e.student_id=ANY(${studentIds}::uuid[])
    `.execute(db);
    await sql`
      WITH recorded_days AS (
        SELECT DISTINCT student.school_id,ar.date FROM attendance_records ar JOIN students student ON student.id=ar.student_id
        WHERE ar.student_id=ANY(${studentIds}::uuid[])
      ), scheduled_slots AS (
        SELECT slot.*,days.date,
          row_number() OVER (
            PARTITION BY slot.class_section_id, slot.term_id, days.date
            ORDER BY slot.period_number, slot.starts_at, slot.id
          )::int AS instructional_index,
          count(*) OVER (
            PARTITION BY slot.class_section_id, slot.term_id, days.date
          )::int AS instructional_count
        FROM recorded_days days CROSS JOIN LATERAL effective_school_schedule(days.school_id,days.date) slot
        WHERE slot.slot_type='class' AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
      )
      INSERT INTO subject_attendance (student_id, subject_id, term_id, classes_held, classes_attended, classes_excused)
      SELECT e.student_id, ts.subject_id, e.term_id,
        count(*)::int AS classes_held,
        count(*) FILTER (WHERE
          ar.status IN ('present','late')
          OR (
            ar.status='half_day'
            AND ar.check_out_at IS NOT NULL
            AND (ar.check_out_at AT TIME ZONE school.timezone)::date=ar.date
            AND (ar.check_out_at AT TIME ZONE school.timezone)::time >= ts.ends_at
          ) OR (
            ar.status='half_day'
            AND ar.check_out_at IS NULL
            AND ts.instructional_index * 2 <= ts.instructional_count + 1
          )
        )::int AS classes_attended,
        count(*) FILTER (WHERE ar.status='excused')::int AS classes_excused
      FROM enrollments e
      JOIN academic_terms term ON term.id=e.term_id
      JOIN class_sections section ON section.id=e.class_section_id
      JOIN schools school ON school.id=section.school_id
      JOIN attendance_records ar ON ar.student_id=e.student_id
        AND ar.class_section_id=e.class_section_id
        AND ar.date BETWEEN term.starts_on
          AND LEAST(term.ends_on, (now() AT TIME ZONE school.timezone)::date)
      JOIN scheduled_slots ts ON ts.class_section_id=e.class_section_id AND ts.term_id=e.term_id
        AND ts.date=ar.date AND ar.date>=e.enrolled_on
      WHERE e.is_active AND e.student_id=ANY(${studentIds}::uuid[])
      GROUP BY e.student_id, ts.subject_id, e.term_id
      ON CONFLICT (student_id, subject_id, term_id) DO UPDATE SET
        classes_held=EXCLUDED.classes_held,
        classes_attended=EXCLUDED.classes_attended,
        classes_excused=EXCLUDED.classes_excused
    `.execute(db);
    await sql`
      INSERT INTO subject_attendance (
        student_id, subject_id, term_id,
        classes_held, classes_attended, classes_excused
      )
      SELECT DISTINCT enrollment.student_id, slot.subject_id, enrollment.term_id, 0, 0, 0
      FROM enrollments enrollment
      JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
        AND slot.term_id=enrollment.term_id
        AND slot.slot_type='class' AND slot.subject_id IS NOT NULL
      WHERE enrollment.is_active
        AND enrollment.student_id=ANY(${studentIds}::uuid[])
      ON CONFLICT (student_id, subject_id, term_id) DO NOTHING
    `.execute(db);
  }

  async saveTeacherAttendance(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceBulkSchema.parse(body);
    const rawIdempotencyKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey;
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header (8–128 safe characters) is required.");
    }
    const screen = await this.teacherAttendanceScreen(user, data.class_section_id, data.date);
    const membership = await this.requireSchoolRole(user, ["staff", "admin"], screen.class.school_id);
    const rosterIds = new Set(screen.roster.map((student) => student.id));
    if (data.records.some((record) => !rosterIds.has(record.student_id))) throw new BadRequestException("Every attendance record must belong to the selected class roster.");
    if (new Set(data.records.map((record) => record.student_id)).size !== data.records.length) throw new BadRequestException("A student may only appear once in an attendance submission.");
    if (data.records.length !== rosterIds.size) throw new BadRequestException("Mark every student before submitting the class register.");
    if (data.date < screen.class.term_starts_on || data.date > screen.class.term_ends_on) {
      throw new BadRequestException("Attendance can only be submitted inside the selected class term.");
    }
    const canonical = {
      class_section_id: data.class_section_id,
      date: data.date,
      expected_revision: data.expected_revision,
      photo_session_id: data.photo_session_id ?? null,
      reason: data.reason ?? "",
      records: [...data.records].sort((a, b) => a.student_id.localeCompare(b.student_id)),
    };
    const requestHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");

    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${membership.school_id}:${user.id}:${idempotencyKey}`}, 0))`.execute(tx);
      const duplicate = await tx.selectFrom("attendance_submissions").select(["request_hash", "result_body"])
        .where("school_id", "=", membership.school_id).where("submitted_by", "=", user.id)
        .where("idempotency_key", "=", idempotencyKey).executeTakeFirst();
      if (duplicate) {
        if (duplicate.request_hash !== requestHash) {
          throw new ConflictException({ message: "This Idempotency-Key was already used for different attendance data.", code: "idempotency_conflict" });
        }
        return duplicate.result_body;
      }
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${data.class_section_id}:${data.date}`}, 0))`.execute(tx);
      // Re-check authorization and the roster after acquiring the write lock.
      // The screen read above is only a UX preflight; it must never authorize
      // a command after a concurrent membership, assignment, or enrollment
      // change. Locking the class also blocks new FK-backed enrollments until
      // this register transaction commits.
      const lockedClass = await sql<{ id: string }>`
        SELECT section.id
        FROM class_sections section
        WHERE section.id=${data.class_section_id}::uuid
          AND section.school_id=${membership.school_id}::uuid
        FOR UPDATE
      `.execute(tx);
      if (!lockedClass.rows[0]) throw new NotFoundException("Class section not found.");
      const currentMembership = await sql<{ role: "staff" | "admin" }>`
        SELECT current_membership.role
        FROM school_memberships current_membership
        JOIN users account ON account.id=current_membership.user_id AND account.is_active
        WHERE current_membership.user_id=${user.id}::uuid
          AND current_membership.school_id=${membership.school_id}::uuid
          AND current_membership.role IN ('staff','admin')
          AND current_membership.is_active
        FOR SHARE OF current_membership
      `.execute(tx);
      const currentRole = currentMembership.rows[0]?.role;
      if (!currentRole) throw new ForbiddenException("An active school staff membership is required.");
      if (currentRole !== "admin") {
        const currentAssignment = await sql<{ id: string }>`
          SELECT slot.id
          FROM timetable_slots slot
          WHERE slot.class_section_id=${data.class_section_id}::uuid
            AND slot.term_id=${screen.class.term_id}::uuid
            AND slot.teacher_user_id=${user.id}::uuid
          ORDER BY slot.id
          LIMIT 1
          FOR SHARE OF slot
        `.execute(tx);
        const currentSubstitute=(await sql`SELECT id FROM effective_school_schedule(${membership.school_id}::uuid,${data.date}::date) WHERE class_section_id=${data.class_section_id}::uuid AND term_id=${screen.class.term_id}::uuid AND teacher_user_id=${user.id}::uuid AND NOT cancelled AND coverage_status='accepted' LIMIT 1`.execute(tx)).rows[0];
        if (!currentAssignment.rows[0]&&!currentSubstitute) {
          throw new ForbiddenException("This class is no longer assigned to the signed-in teacher.");
        }
      }
      const currentRoster = await sql<{ student_id: string }>`
        SELECT enrollment.student_id
        FROM enrollments enrollment
        JOIN students student ON student.id=enrollment.student_id
          AND student.school_id=${membership.school_id}::uuid
        WHERE enrollment.class_section_id=${data.class_section_id}::uuid
          AND enrollment.term_id=${screen.class.term_id}::uuid
          AND enrollment.is_active
          AND enrollment.enrolled_on<=${data.date}::date
        ORDER BY enrollment.student_id
        FOR SHARE OF enrollment, student
      `.execute(tx);
      const lockedRosterIds = new Set(currentRoster.rows.map((row) => row.student_id));
      if (
        lockedRosterIds.size !== rosterIds.size
        || [...lockedRosterIds].some((studentId) => !rosterIds.has(studentId))
      ) {
        throw new ConflictException({
          message: "The class roster changed after this register was opened. Refresh before submitting.",
          code: "roster_changed",
        });
      }
      const dayPolicy = await attendanceDayPolicy(
        tx,
        membership.school_id,
        data.class_section_id,
        screen.class.term_id,
        data.date,
        { userId: user.id, role: currentRole },
      );
      if (!dayPolicy?.completed) {
        throw new BadRequestException("Attendance opens on the selected date.");
      }
      if (!dayPolicy.instructional) {
        throw new BadRequestException("Attendance cannot be submitted because this class has no scheduled lesson on the selected date.");
      }
      if (!dayPolicy.actor_scheduled) {
        throw new ForbiddenException("You have no scheduled or accepted cover period for this class on the selected date.");
      }
      const registerResult = await sql<any>`
        SELECT * FROM attendance_registers
        WHERE class_section_id=${data.class_section_id}::uuid
          AND term_id=${screen.class.term_id}::uuid AND date=${data.date}::date
        FOR UPDATE
      `.execute(tx);
      const currentRegister = registerResult.rows[0];
      const currentRevision = Number(currentRegister?.revision ?? 0);
      if (currentRevision !== data.expected_revision) {
        throw new ConflictException({
          message: "This register changed after it was opened. Refresh it before submitting.",
          code: "revision_conflict", current_revision: currentRevision,
        });
      }
      if (currentRegister?.state === "locked") {
        throw new ForbiddenException("This attendance register is locked. A principal must reopen it before a teacher can make corrections.");
      }

      const sourcePhotoSession = data.photo_session_id
        ? await tx.selectFrom("photo_attendance_sessions").selectAll()
          .where("id", "=", data.photo_session_id)
          .where("school_id", "=", membership.school_id)
          .where("class_section_id", "=", data.class_section_id)
          .where("date", "=", data.date)
          .forUpdate()
          .executeTakeFirst()
        : undefined;
      if (data.photo_session_id && !sourcePhotoSession) {
        throw new BadRequestException("The selected photo analysis does not belong to this class register.");
      }
      if (sourcePhotoSession && sourcePhotoSession.expires_at < new Date()) {
        throw new ConflictException("The photo analysis expired. Capture a new photo or continue manually.");
      }
      if (sourcePhotoSession && sourcePhotoSession.state !== "analyzed") {
        throw new ConflictException("This photo analysis has already been applied or discarded.");
      }

      const currentRows = await sql<any>`
        SELECT * FROM attendance_records
        WHERE date=${data.date}::date AND student_id=ANY(${[...rosterIds]}::uuid[])
        FOR UPDATE
      `.execute(tx);
      const previousByStudent = new Map(currentRows.rows.map((row) => [row.student_id as string, row]));
      const conflictingClass = currentRows.rows.find((row) => row.class_section_id !== data.class_section_id);
      if (conflictingClass) {
        throw new ConflictException({
          message: "An existing attendance record belongs to a different class. Resolve the enrollment transfer before submitting.",
          code: "attendance_class_conflict",
          student_id: conflictingClass.student_id,
        });
      }
      const changed = data.records.filter((record) => {
        const previous = previousByStudent.get(record.student_id);
        return !previous || previous.status !== record.status || previous.remarks !== record.remarks;
      });
      if (changed.some((record) => previousByStudent.has(record.student_id)) && !data.reason) {
        throw new BadRequestException("A correction reason is required when changing an existing attendance record.");
      }
      const advancesRevision = changed.length > 0 || !currentRegister || currentRegister.state === "draft";
      const nextRevision = currentRevision + (advancesRevision ? 1 : 0);
      const effectiveRevision = Math.max(1, nextRevision);
      const now = new Date();
      const nextState = "submitted" as const;
      const register = currentRegister
        ? await tx.updateTable("attendance_registers").set({
            state: nextState, revision: effectiveRevision, submitted_by: user.id,
            submitted_at: now, updated_at: now,
          }).where("id", "=", currentRegister.id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto("attendance_registers").values({
            school_id: membership.school_id, class_section_id: data.class_section_id,
            term_id: screen.class.term_id, date: data.date, state: "submitted",
            revision: effectiveRevision, submitted_by: user.id, submitted_at: now,
            locked_by: null, locked_at: null, reopened_by: null, reopened_at: null,
            reopen_reason: null,
          }).returningAll().executeTakeFirstOrThrow();

      const provisionalResult = {
        ...screen,
        register: {
          id: register.id, state: register.state, revision: register.revision,
          submitted_by: register.submitted_by, submitted_at: register.submitted_at,
          locked_by: register.locked_by, locked_at: register.locked_at,
          reopened_by: register.reopened_by, reopened_at: register.reopened_at,
          reopen_reason: register.reopen_reason,
        },
      };
      const submission = await tx.insertInto("attendance_submissions").values({
        school_id: membership.school_id, class_section_id: data.class_section_id,
        term_id: screen.class.term_id, date: data.date, submitted_by: user.id,
        idempotency_key: idempotencyKey, request_hash: requestHash, request_id: request.requestId,
        register_revision: effectiveRevision, records_count: data.records.length,
        changed_count: changed.length, result_body: provisionalResult as any,
        source_photo_session_id: sourcePhotoSession?.id ?? null,
        capture_batch_id: null,
        observed_at: null,
        completed_at: now,
      }).returning("id").executeTakeFirstOrThrow();

      if (sourcePhotoSession) {
        await tx.updateTable("photo_attendance_sessions").set({
          state: "applied",
          applied_at: now,
          applied_submission_id: submission.id,
          updated_at: now,
        }).where("id", "=", sourcePhotoSession.id).execute();
      }

      let persisted = new Map<string, any>();
      if (changed.length) {
        const saved = await tx.insertInto("attendance_records").values(changed.map((record) => ({
          student_id: record.student_id, class_section_id: data.class_section_id, date: data.date,
          status: record.status, remarks: record.remarks, marked_by: user.id,
          revision: effectiveRevision, source_request_id: request.requestId, updated_at: now,
        }))).onConflict((conflict) => conflict.columns(["student_id", "date"]).doUpdateSet({
          status: sql`excluded.status`, remarks: sql`excluded.remarks`, marked_by: user.id,
          revision: effectiveRevision, source_request_id: request.requestId, updated_at: now,
        })).returningAll().execute();
        persisted = new Map(saved.map((row) => [row.student_id, row]));
        await tx.insertInto("attendance_record_revisions").values(changed.map((record) => {
          const previous = previousByStudent.get(record.student_id);
          const savedRecord = persisted.get(record.student_id)!;
          return {
            attendance_record_id: savedRecord.id,
            attendance_submission_id: submission.id,
            attendance_register_id: register.id,
            school_id: membership.school_id, student_id: record.student_id,
            class_section_id: data.class_section_id, date: data.date,
            previous_status: previous?.status ?? null, new_status: record.status,
            previous_remarks: previous?.remarks ?? null, new_remarks: record.remarks,
            previous_check_in_at: previous?.check_in_at ?? null,
            new_check_in_at: savedRecord.check_in_at ?? null,
            previous_check_out_at: previous?.check_out_at ?? null,
            new_check_out_at: savedRecord.check_out_at ?? null,
            reason: previous ? data.reason! : "Initial register submission", changed_by: user.id,
            request_id: request.requestId, register_revision: effectiveRevision,
          };
        })).execute();
      }

      const submittedByStudent = new Map(data.records.map((record) => [record.student_id, record]));
      const result = {
        ...provisionalResult,
        roster: screen.roster.map((student) => {
          const submitted = submittedByStudent.get(student.id)!;
          const saved = persisted.get(student.id);
          return {
            ...student, status: submitted.status, remarks: submitted.remarks,
            attendance_id: saved?.id ?? student.attendance_id,
            attendance_revision: saved?.revision ?? student.attendance_revision,
            updated_at: saved?.updated_at ?? student.updated_at,
          };
        }),
      };
      await tx.updateTable("attendance_submissions").set({ result_body: result as any }).where("id", "=", submission.id).execute();
      await tx.insertInto("audit_events").values({
        action: "attendance.class.submitted", actor_id: user.id, school_id: membership.school_id,
        target_type: "class_section", target_id: data.class_section_id, request_id: request.requestId,
        ip_hash: null, metadata: {
          date: data.date, records: data.records.length, changed: changed.length,
          register_revision: effectiveRevision, register_state: register.state,
          correction_reason: data.reason ?? null,
          photo_session_id: sourcePhotoSession?.id ?? null,
        },
      }).execute();
      if (changed.length) {
        await this.refreshSubjectAttendance(tx, changed.map((record) => record.student_id));
        await this.events.enqueueAttendanceUpdates(tx, {
          schoolId: membership.school_id, classSectionId: data.class_section_id,
          termId: screen.class.term_id,
          date: data.date, requestId: request.requestId,
          records: changed.map((record) => ({
            ...record, previous_status: previousByStudent.get(record.student_id)?.status ?? null,
            revision: effectiveRevision,
          })),
        });
      }
      await this.events.enqueueRegisterEvent(tx, {
        schoolId: membership.school_id, classSectionId: data.class_section_id,
        termId: screen.class.term_id,
        date: data.date, requestId: request.requestId, state: register.state,
        revision: effectiveRevision, actorId: user.id,
      });
      return result;
    });
  }

  private async attendanceCaptureResult(batchId: string) {
    const batch = await this.db.selectFrom("attendance_capture_batches").selectAll().where("id", "=", batchId).executeTakeFirstOrThrow();
    const review = await this.db.selectFrom("attendance_reconciliation_cases").selectAll().where("batch_id", "=", batchId).executeTakeFirst();
    if (batch.status === "accepted" && batch.accepted_submission_id) {
      const submission = await this.db.selectFrom("attendance_submissions")
        .select("result_body").where("id", "=", batch.accepted_submission_id).executeTakeFirst();
      return { status: "accepted" as const, batch, review: review ?? null, register: submission?.result_body ?? null };
    }
    return { status: batch.status, batch, review: review ?? null, register: null };
  }

  private async quarantineAttendanceCapture(
    user: AuthUser,
    batchId: string,
    code: "snapshot_expired" | "roster_changed" | "register_changed" | "permission_revoked" | "assignment_changed" | "invalid_observation_time" | "source_requires_review" | "write_conflict",
    reason: string,
    details: Record<string, unknown>,
    request: AuthenticatedRequest,
  ) {
    await this.db.transaction().execute(async (tx) => {
      const batch = await tx.selectFrom("attendance_capture_batches").selectAll().where("id", "=", batchId).forUpdate().executeTakeFirstOrThrow();
      if (batch.status === "accepted" || batch.status === "rejected") return;
      const now = new Date();
      await tx.updateTable("attendance_capture_batches").set({ status: "quarantined", updated_at: now }).where("id", "=", batchId).execute();
      await tx.insertInto("attendance_reconciliation_cases").values({
        school_id: batch.school_id,
        batch_id: batch.id,
        reason_code: code,
        reason,
        details: details as any,
        state: "open",
        decided_by: null,
        decided_at: null,
        decision_note: null,
        updated_at: now,
      }).onConflict((conflict) => conflict.column("batch_id").doUpdateSet({
        reason_code: code,
        reason,
        details,
        updated_at: now,
      })).execute();
      await tx.insertInto("audit_events").values({
        action: "attendance.capture.quarantined",
        actor_id: user.id,
        school_id: batch.school_id,
        target_type: "attendance_capture_batch",
        target_id: batch.id,
        request_id: request.requestId,
        ip_hash: null,
        metadata: { reason_code: code, reason, details, source: batch.source, date: batch.date },
      }).execute();
    });
    return this.attendanceCaptureResult(batchId);
  }

  async saveAttendanceContinuityBatch(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceContinuityBatchSchema.parse(body);
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header (8–128 safe characters) is required.");
    }
    const section = await this.db.selectFrom("class_sections as section")
      .innerJoin("academic_terms as term", (join) => join
        .onRef("term.school_id", "=", "section.school_id")
        .onRef("term.academic_year", "=", "section.academic_year"))
      .select(["section.school_id", "section.id as class_section_id", "term.id as term_id"])
      .where("section.id", "=", data.class_section_id)
      .where("term.starts_on", "<=", data.date)
      .where("term.ends_on", ">=", data.date)
      .orderBy("term.starts_on", "desc")
      .executeTakeFirst();
    if (!section) throw new NotFoundException("Class section and term were not found for this attendance date.");
    const membership = await this.db.selectFrom("school_memberships")
      .select(["role", "is_active"])
      .where("school_id", "=", section.school_id)
      .where("user_id", "=", user.id)
      .where("role", "in", ["staff", "admin"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!membership) {
      throw new ForbiddenException("Only current or previously assigned school staff can upload this captured register.");
    }
    if ((data.source === "paper" || data.source === "office") && (!membership.is_active || membership.role !== "admin")) {
      throw new ForbiddenException("Only an active school administrator can record paper or office attendance.");
    }
    const canonical = {
      class_section_id: data.class_section_id,
      date: data.date,
      expected_revision: data.expected_revision,
      source: data.source,
      source_reference: data.source_reference,
      device_id: data.device_id ?? null,
      observed_at: data.observed_at,
      roster_fingerprint: data.roster_fingerprint,
      roster_captured_at: data.roster_captured_at,
      roster_expires_at: data.roster_expires_at,
      snapshot_token: data.snapshot_token,
      photo_session_id: data.photo_session_id ?? null,
      reason: data.reason ?? "",
      records: [...data.records].sort((left, right) => left.student_id.localeCompare(right.student_id)),
    };
    const requestHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const now = new Date();
    const batch = await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${section.school_id}:${user.id}:attendance-capture:${idempotencyKey}`}, 0))`.execute(tx);
      const duplicate = await tx.selectFrom("attendance_capture_batches").selectAll()
        .where("school_id", "=", section.school_id)
        .where("recorded_by", "=", user.id)
        .where("idempotency_key", "=", idempotencyKey)
        .executeTakeFirst();
      if (duplicate) {
        if (duplicate.request_hash !== requestHash) {
          throw new ConflictException({ message: "This Idempotency-Key was already used for a different attendance capture.", code: "idempotency_conflict" });
        }
        return duplicate;
      }
      if (new Set(data.records.map((record) => record.student_id)).size !== data.records.length) {
        throw new BadRequestException("A student may only appear once in an attendance capture.");
      }
      const created = await tx.insertInto("attendance_capture_batches").values({
        school_id: section.school_id,
        class_section_id: data.class_section_id,
        term_id: section.term_id,
        date: data.date,
        source: data.source,
        source_reference: data.source_reference,
        recorded_by: user.id,
        device_id: data.device_id ?? null,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        roster_fingerprint: data.roster_fingerprint,
        roster_count: data.records.length,
        expected_register_revision: data.expected_revision,
        observed_at: data.observed_at,
        roster_captured_at: data.roster_captured_at,
        roster_expires_at: data.roster_expires_at,
        received_at: now,
        status: "pending",
        accepted_submission_id: null,
        accepted_at: null,
        resolved_by: null,
        resolved_at: null,
        resolution_note: null,
        created_at: now,
        updated_at: now,
      }).returningAll().executeTakeFirstOrThrow();
      await tx.insertInto("attendance_observations").values(data.records.map((record) => ({
        batch_id: created.id,
        school_id: section.school_id,
        student_id: record.student_id,
        class_section_id: data.class_section_id,
        term_id: section.term_id,
        date: data.date,
        observed_status: record.status,
        remarks: record.remarks,
        observed_at: data.observed_at,
        recorded_at: now,
        recorded_by: user.id,
        source: data.source,
      }))).execute();
      return created;
    });
    if (batch.status !== "pending") return this.attendanceCaptureResult(batch.id);

    const observedAt = new Date(data.observed_at);
    const expiresAt = new Date(data.roster_expires_at);
    if (observedAt.getTime() > now.getTime() + 5 * 60 * 1000 || observedAt.getTime() < now.getTime() - 48 * 60 * 60 * 1000) {
      return this.quarantineAttendanceCapture(user, batch.id, "invalid_observation_time", "The recorded observation time is outside the allowed attendance capture window.", { observed_at: data.observed_at }, request);
    }
    if (expiresAt.getTime() < now.getTime()) {
      return this.quarantineAttendanceCapture(user, batch.id, "snapshot_expired", "The downloaded roster expired before this capture reached the school server.", { roster_expires_at: data.roster_expires_at }, request);
    }
    const snapshotIsValid = validAttendanceSnapshotToken(data.snapshot_token, {
      userId: user.id,
      schoolId: section.school_id,
      classSectionId: data.class_section_id,
      termId: section.term_id,
      date: data.date,
      rosterFingerprint: data.roster_fingerprint,
      rosterCount: data.records.length,
      capturedAt: data.roster_captured_at,
      expiresAt: data.roster_expires_at,
    });
    if (!snapshotIsValid) {
      return this.quarantineAttendanceCapture(user, batch.id, "roster_changed", "The roster snapshot signature is invalid or its offline window was changed.", { snapshot_signature_valid: false }, request);
    }
    const currentMembership = await this.db.selectFrom("school_memberships")
      .select(["role", "is_active"])
      .where("school_id", "=", section.school_id)
      .where("user_id", "=", user.id)
      .where("role", "in", ["staff", "admin"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!currentMembership?.is_active) {
      return this.quarantineAttendanceCapture(user, batch.id, "permission_revoked", "The recorder no longer has an active school role. The observation was retained but not published.", {}, request);
    }
    if (currentMembership.role !== "admin") {
      const assignment = await sql<{ assigned: boolean }>`SELECT EXISTS(
        SELECT 1 FROM effective_school_schedule(${section.school_id}::uuid,${data.date}::date) slot
        WHERE slot.class_section_id=${data.class_section_id}::uuid
          AND slot.term_id=${section.term_id}::uuid
          AND slot.teacher_user_id=${user.id}::uuid
          AND NOT slot.cancelled AND slot.coverage_status IN ('not_required','accepted')
      ) AS assigned`.execute(this.db);
      if (!assignment.rows[0]?.assigned) {
        return this.quarantineAttendanceCapture(user, batch.id, "assignment_changed", "The recorder is no longer assigned to this class for the selected date.", {}, request);
      }
    }
    const currentRoster = await this.db.selectFrom("enrollments as enrollment")
      .innerJoin("students as student", "student.id", "enrollment.student_id")
      .select("enrollment.student_id")
      .where("student.school_id", "=", section.school_id)
      .where("enrollment.class_section_id", "=", data.class_section_id)
      .where("enrollment.term_id", "=", section.term_id)
      .where("enrollment.is_active", "=", true)
      .where("enrollment.enrolled_on", "<=", data.date)
      .orderBy("enrollment.student_id")
      .execute();
    const currentFingerprint = attendanceRosterFingerprint({
      schoolId: section.school_id,
      classSectionId: data.class_section_id,
      termId: section.term_id,
      date: data.date,
      studentIds: currentRoster.map((row) => row.student_id),
    });
    if (currentFingerprint !== data.roster_fingerprint || currentRoster.length !== data.records.length) {
      return this.quarantineAttendanceCapture(user, batch.id, "roster_changed", "The class roster changed after this attendance snapshot was downloaded.", { captured_count: data.records.length, current_count: currentRoster.length }, request);
    }
    const register = await this.db.selectFrom("attendance_registers").select("revision")
      .where("class_section_id", "=", data.class_section_id)
      .where("term_id", "=", section.term_id)
      .where("date", "=", data.date)
      .executeTakeFirst();
    const currentRevision = Number(register?.revision ?? 0);
    if (currentRevision !== data.expected_revision) {
      return this.quarantineAttendanceCapture(user, batch.id, "register_changed", "The attendance register changed after this capture began.", { expected_revision: data.expected_revision, current_revision: currentRevision }, request);
    }
    if (data.source === "paper" || data.source === "office") {
      return this.quarantineAttendanceCapture(user, batch.id, "source_requires_review", "Paper and office observations require an explicit attendance-desk review before publication.", { source_reference: data.source_reference }, request);
    }

    let result: Awaited<ReturnType<SchoolService["saveTeacherAttendance"]>>;
    try {
      result = await this.saveTeacherAttendance(user, {
        class_section_id: data.class_section_id,
        date: data.date,
        expected_revision: data.expected_revision,
        photo_session_id: data.photo_session_id,
        reason: data.reason,
        records: data.records,
      }, request);
    } catch (error) {
      const status = typeof (error as { getStatus?: unknown })?.getStatus === "function"
        ? (error as { getStatus: () => number }).getStatus()
        : 500;
      if ([400, 403, 409, 423].includes(status)) {
        const response = typeof (error as { getResponse?: unknown })?.getResponse === "function"
          ? (error as { getResponse: () => unknown }).getResponse()
          : null;
        const message = typeof response === "string" ? response : typeof response === "object" && response && "message" in response
          ? String(response.message)
          : error instanceof Error ? error.message : "The attendance capture conflicted with the current register.";
        return this.quarantineAttendanceCapture(user, batch.id, "write_conflict", message, { status }, request);
      }
      throw error;
    }
    const submission = await this.db.selectFrom("attendance_submissions").select("id")
      .where("school_id", "=", section.school_id)
      .where("submitted_by", "=", user.id)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirstOrThrow();
    const acceptedResult = {
      ...result,
      latest_capture: {
        id: batch.id,
        source: data.source,
        status: "accepted" as const,
        received_at: batch.received_at,
        roster_expires_at: batch.roster_expires_at,
      },
    };
    await this.db.transaction().execute(async (tx) => {
      await tx.updateTable("attendance_submissions").set({
        capture_batch_id: batch.id,
        capture_source: data.photo_session_id ? "photo" : data.source,
        observed_at: data.observed_at,
        result_body: acceptedResult as any,
      }).where("id", "=", submission.id).execute();
      await tx.updateTable("attendance_capture_batches").set({
        status: "accepted",
        accepted_submission_id: submission.id,
        accepted_at: new Date(),
        updated_at: new Date(),
      }).where("id", "=", batch.id).execute();
      await tx.insertInto("audit_events").values({
        action: "attendance.capture.accepted",
        actor_id: user.id,
        school_id: section.school_id,
        target_type: "attendance_capture_batch",
        target_id: batch.id,
        request_id: request.requestId,
        ip_hash: null,
        metadata: {
          source: data.source,
          date: data.date,
          submission_id: submission.id,
          observed_at: data.observed_at,
        },
      }).execute();
    });
    return { status: "accepted" as const, batch: { ...batch, status: "accepted" as const, accepted_submission_id: submission.id }, review: null, register: acceptedResult };
  }

  async attendanceContinuityWorkspace(user: AuthUser, selectedDateValue?: string) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(membership.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const [summary, cases] = await Promise.all([
      sql<{ pending: number; quarantined: number; accepted: number; rejected: number }>`
        SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
          count(*) FILTER (WHERE status='quarantined')::int AS quarantined,
          count(*) FILTER (WHERE status='accepted' AND date=${selectedDate}::date)::int AS accepted,
          count(*) FILTER (WHERE status='rejected' AND date=${selectedDate}::date)::int AS rejected
        FROM attendance_capture_batches
        WHERE school_id=${membership.school_id}::uuid
      `.execute(this.db),
      sql<any>`
        SELECT review.id, review.reason_code, review.reason, review.details, review.state, review.opened_at,
          batch.id AS batch_id, batch.date, batch.source, batch.source_reference, batch.observed_at,
          batch.received_at, batch.roster_count, batch.expected_register_revision,
          section.id AS class_section_id, 'Class ' || section.grade || section.section AS class_name,
          trim(concat_ws(' ', actor.first_name, actor.last_name)) AS recorded_by_name,
          COALESCE(register.revision,0)::int AS current_revision,
          register.state AS register_state
        FROM attendance_reconciliation_cases review
        JOIN attendance_capture_batches batch ON batch.id=review.batch_id
        JOIN class_sections section ON section.id=batch.class_section_id
        JOIN users actor ON actor.id=batch.recorded_by
        LEFT JOIN attendance_registers register ON register.class_section_id=batch.class_section_id
          AND register.term_id=batch.term_id AND register.date=batch.date
        WHERE review.school_id=${membership.school_id}::uuid AND review.state='open'
        ORDER BY review.opened_at, section.grade, section.section
        LIMIT 50
      `.execute(this.db),
    ]);
    return { date: selectedDate, summary: summary.rows[0] ?? { pending: 0, quarantined: 0, accepted: 0, rejected: 0 }, cases: cases.rows };
  }

  async decideAttendanceReconciliation(user: AuthUser, caseId: string, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceReconciliationDecisionSchema.parse(body);
    const review = await this.db.selectFrom("attendance_reconciliation_cases as review")
      .innerJoin("attendance_capture_batches as batch", "batch.id", "review.batch_id")
      .select([
        "review.id", "review.school_id", "review.state", "review.batch_id",
        "batch.class_section_id", "batch.term_id", "batch.date", "batch.source", "batch.source_reference",
        "batch.recorded_by", "batch.observed_at", "batch.received_at", "batch.roster_expires_at", "batch.expected_register_revision",
      ])
      .where("review.id", "=", caseId)
      .executeTakeFirst();
    if (!review) throw new NotFoundException("Attendance reconciliation case not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], review.school_id);
    if (review.state !== "open") return this.attendanceContinuityWorkspace(user, review.date);
    if (data.decision === "reject") {
      const rejected = await this.db.transaction().execute(async (tx) => {
        const now = new Date();
        const claimed = await tx.updateTable("attendance_reconciliation_cases").set({
          state: "rejected", decided_by: user.id, decided_at: now,
          decision_note: data.reason, updated_at: now,
        }).where("id", "=", review.id).where("state", "=", "open").returning("id").executeTakeFirst();
        if (!claimed) return false;
        await tx.updateTable("attendance_capture_batches").set({
          status: "rejected", resolved_by: user.id, resolved_at: now,
          resolution_note: data.reason, updated_at: now,
        }).where("id", "=", review.batch_id).where("status", "=", "quarantined").execute();
        await tx.insertInto("audit_events").values({
          action: "attendance.capture.rejected", actor_id: user.id, school_id: membership.school_id,
          target_type: "attendance_capture_batch", target_id: review.batch_id,
          request_id: request.requestId, ip_hash: null,
          metadata: { case_id: review.id, reason: data.reason, source: review.source, date: review.date },
        }).execute();
        return true;
      });
      if (!rejected) return this.attendanceContinuityWorkspace(user, review.date);
      return this.attendanceContinuityWorkspace(user, review.date);
    }

    const screen = await this.teacherAttendanceScreen(user, review.class_section_id, review.date);
    if (screen.register.revision !== data.expected_revision) {
      throw new ConflictException({ message: "The register changed after this review opened. Reload the queue before applying the observation.", code: "revision_conflict", current_revision: screen.register.revision });
    }
    if (screen.register.state === "locked") throw new ForbiddenException("Unlock the register before applying a reconciled observation.");
    const observations = await this.db.selectFrom("attendance_observations")
      .select(["student_id", "observed_status", "remarks"])
      .where("batch_id", "=", review.batch_id)
      .orderBy("student_id")
      .execute();
    const currentIds = [...screen.roster.map((student) => student.id)].sort();
    const observedIds = observations.map((item) => item.student_id).sort();
    if (currentIds.length !== observedIds.length || currentIds.some((id, index) => id !== observedIds[index])) {
      throw new ConflictException({ message: "The current class roster differs from this observation. Reject the batch and correct the live register manually.", code: "roster_changed" });
    }
    const reconciliationKey = `reconcile:${review.id}:${data.expected_revision}`;
    const previousKey = request.headers["idempotency-key"];
    request.headers["idempotency-key"] = reconciliationKey;
    let result: Awaited<ReturnType<SchoolService["saveTeacherAttendance"]>>;
    try {
      result = await this.saveTeacherAttendance(user, {
        class_section_id: review.class_section_id,
        date: review.date,
        expected_revision: data.expected_revision,
        reason: `Reconciled ${review.source.replace("_", " ")} observation: ${data.reason}`,
        records: observations.map((item) => ({ student_id: item.student_id, status: item.observed_status, remarks: item.remarks })),
      }, request);
    } finally {
      if (previousKey === undefined) delete request.headers["idempotency-key"];
      else request.headers["idempotency-key"] = previousKey;
    }
    const submission = await this.db.selectFrom("attendance_submissions").select("id")
      .where("school_id", "=", review.school_id)
      .where("submitted_by", "=", user.id)
      .where("idempotency_key", "=", reconciliationKey)
      .executeTakeFirstOrThrow();
    const acceptedResult = {
      ...result,
      latest_capture: {
        id: review.batch_id,
        source: review.source,
        status: "accepted" as const,
        received_at: review.received_at,
        roster_expires_at: review.roster_expires_at,
      },
    };
    await this.db.transaction().execute(async (tx) => {
      const now = new Date();
      await tx.updateTable("attendance_submissions").set({
        capture_batch_id: review.batch_id,
        capture_source: review.source,
        observed_at: review.observed_at,
        result_body: acceptedResult as any,
      }).where("id", "=", submission.id).execute();
      await tx.updateTable("attendance_capture_batches").set({
        status: "accepted", accepted_submission_id: submission.id, accepted_at: now,
        resolved_by: user.id, resolved_at: now, resolution_note: data.reason, updated_at: now,
      }).where("id", "=", review.batch_id).execute();
      await tx.updateTable("attendance_reconciliation_cases").set({
        state: "accepted", decided_by: user.id, decided_at: now,
        decision_note: data.reason, updated_at: now,
      }).where("id", "=", review.id).execute();
      await tx.insertInto("audit_events").values({
        action: "attendance.capture.reconciled", actor_id: user.id, school_id: membership.school_id,
        target_type: "attendance_capture_batch", target_id: review.batch_id,
        request_id: request.requestId, ip_hash: null,
        metadata: { case_id: review.id, reason: data.reason, source: review.source, date: review.date, submission_id: submission.id },
      }).execute();
    });
    return { ...(await this.attendanceContinuityWorkspace(user, review.date)), applied_register: acceptedResult };
  }

  async setAttendanceRegisterLock(user: AuthUser, classSectionId: string, locked: boolean, body: unknown, request: AuthenticatedRequest) {
    const data = attendanceLockSchema.parse(body);
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], target.school_id);
    const screen = await this.teacherAttendanceScreen(user, classSectionId, data.date);
    if (!locked && !data.reason) throw new BadRequestException("A reason is required to reopen a locked register.");
    let changed = false;
    await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${classSectionId}:${data.date}`}, 0))`.execute(tx);
      const found = await sql<any>`
        SELECT * FROM attendance_registers WHERE class_section_id=${classSectionId}::uuid
          AND term_id=${screen.class.term_id}::uuid AND date=${data.date}::date FOR UPDATE
      `.execute(tx);
      const register = found.rows[0];
      if (!register) throw new BadRequestException("Submit the attendance register before locking it.");
      if (locked && register.state === "locked") return;
      if (!locked && register.state !== "locked") return;
      if (locked && register.state !== "submitted") throw new BadRequestException("Only a submitted register can be locked.");
      const revision = Number(register.revision) + 1;
      const now = new Date();
      await tx.updateTable("attendance_registers").set(locked ? {
        state: "locked", revision, locked_by: user.id, locked_at: now, updated_at: now,
      } : {
        state: "submitted", revision, locked_by: null, locked_at: null,
        reopened_by: user.id, reopened_at: now, reopen_reason: data.reason!, updated_at: now,
      }).where("id", "=", register.id).execute();
      await tx.insertInto("audit_events").values({
        action: locked ? "attendance.register.locked" : "attendance.register.reopened",
        actor_id: user.id, school_id: membership.school_id, target_type: "attendance_register",
        target_id: register.id, request_id: request.requestId, ip_hash: null,
        metadata: { class_section_id: classSectionId, date: data.date, revision, reason: data.reason ?? null },
      }).execute();
      await this.events.enqueueRegisterEvent(tx, {
        schoolId: membership.school_id, classSectionId, date: data.date,
        termId: screen.class.term_id,
        requestId: request.requestId, state: locked ? "locked" : "unlocked",
        revision, actorId: user.id,
      });
      changed = true;
    });
    const refreshed = await this.teacherAttendanceScreen(user, classSectionId, data.date);
    return { ...refreshed, lifecycle_changed: changed };
  }

  async attendanceRegisterHistory(user: AuthUser, classSectionId: string, selectedDate: string) {
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const target = await this.db.selectFrom("class_sections").select("school_id").where("id", "=", classSectionId).executeTakeFirst();
    if (!target) throw new NotFoundException("Class section not found.");
    await this.requireSchoolRole(user, ["admin"], target.school_id);
    const screen = await this.teacherAttendanceScreen(user, classSectionId, selectedDate);
    const [revisions, submissions] = await Promise.all([
      sql<any>`
        SELECT history.id, history.student_id, history.previous_status, history.new_status,
          history.previous_remarks, history.new_remarks, history.reason,
          history.register_revision, history.created_at,
          trim(concat_ws(' ', student_user.first_name, student_user.last_name)) AS student_name,
          trim(concat_ws(' ', actor.first_name, actor.last_name)) AS changed_by_name
        FROM attendance_record_revisions history
        JOIN students student ON student.id=history.student_id
        JOIN school_people student_user ON student_user.id=student.person_id
        JOIN users actor ON actor.id=history.changed_by
        WHERE history.class_section_id=${classSectionId}::uuid AND history.date=${selectedDate}::date
        ORDER BY history.register_revision DESC, student_name, history.id DESC
      `.execute(this.db),
      sql<any>`
        SELECT submission.id, submission.register_revision, submission.records_count,
          submission.changed_count, submission.created_at, submission.capture_source,
          submission.observed_at, batch.source_reference,
          trim(concat_ws(' ', actor.first_name, actor.last_name)) AS submitted_by_name
        FROM attendance_submissions submission JOIN users actor ON actor.id=submission.submitted_by
        LEFT JOIN attendance_capture_batches batch ON batch.id=submission.capture_batch_id
        WHERE submission.class_section_id=${classSectionId}::uuid AND submission.date=${selectedDate}::date
        ORDER BY submission.register_revision DESC, submission.created_at DESC
      `.execute(this.db),
    ]);
    return { date: selectedDate, class: screen.class, register: screen.register, submissions: submissions.rows, revisions: revisions.rows };
  }

  async principalHomeScreen(user: AuthUser, selectedDateValue?: string) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const selectedDate = selectedDateValue ?? await this.schoolLocalDate(membership.school_id);
    if (!datePattern.test(selectedDate)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const workspace = await attendanceWorkspace(this.db, membership.school_id, user.id, membership.role, selectedDate);
    const classContext = new Map(workspace.map((item) => [item.class_section_id, item]));
    const classes = await sql<any>`
      WITH attendance_rollup AS (
        SELECT e.class_section_id, e.term_id,
          count(*)::int AS student_count,
          count(ar.id)::int AS marked_count,
          count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS scored_count,
          COALESCE(sum(CASE
            WHEN ar.status IN ('present','late') THEN 1.0
            WHEN ar.status='half_day' THEN 0.5
            ELSE 0
          END), 0)::numeric AS attending_count,
          count(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count,
          count(ar.id) FILTER (WHERE ar.status='late')::int AS late_count,
          count(ar.id) FILTER (WHERE ar.status='excused')::int AS excused_count
        FROM enrollments e
        JOIN class_sections section ON section.id=e.class_section_id
        LEFT JOIN attendance_records ar ON ar.student_id=e.student_id
          AND ar.class_section_id=e.class_section_id AND ar.date=${selectedDate}::date
        WHERE e.is_active AND section.school_id=${membership.school_id}::uuid AND e.enrolled_on<=${selectedDate}::date
        GROUP BY e.class_section_id, e.term_id
      ), timetable_rollup AS (
        SELECT ts.class_section_id, ts.term_id,
          count(*)::int AS timetable_slots,
          count(*) FILTER (WHERE ts.teacher_user_id IS NULL AND ts.slot_type='class')::int AS unassigned_slots
        FROM effective_school_schedule(${membership.school_id}::uuid,${selectedDate}::date) ts
        JOIN class_sections section ON section.id=ts.class_section_id
        WHERE section.school_id=${membership.school_id}::uuid
          AND ts.weekday=${isoWeekday(selectedDate)} AND NOT ts.cancelled
        GROUP BY ts.class_section_id, ts.term_id
      )
      SELECT cs.id, cs.grade, cs.section, cs.room_number,
        t.id AS term_id, t.name AS term_name, t.academic_year,
        reg.state AS register_state, reg.revision AS register_revision,
        COALESCE(attendance.student_count, 0)::int AS student_count,
        COALESCE(attendance.marked_count, 0)::int AS marked_count,
        COALESCE(attendance.scored_count, 0)::int AS scored_count,
        COALESCE(attendance.attending_count, 0)::numeric AS attending_count,
        COALESCE(attendance.absent_count, 0)::int AS absent_count,
        COALESCE(attendance.late_count, 0)::int AS late_count,
        COALESCE(attendance.excused_count, 0)::int AS excused_count,
        COALESCE(timetable.timetable_slots, 0)::int AS timetable_slots,
        COALESCE(timetable.unassigned_slots, 0)::int AS unassigned_slots
      FROM class_sections cs
      JOIN academic_terms t ON t.school_id=cs.school_id
        AND t.academic_year=cs.academic_year
        AND ${selectedDate}::date BETWEEN t.starts_on AND t.ends_on
      LEFT JOIN attendance_rollup attendance
        ON attendance.class_section_id=cs.id AND attendance.term_id=t.id
      LEFT JOIN attendance_registers reg
        ON reg.class_section_id=cs.id AND reg.term_id=t.id AND reg.date=${selectedDate}::date
      LEFT JOIN timetable_rollup timetable
        ON timetable.class_section_id=cs.id AND timetable.term_id=t.id
      WHERE cs.school_id=${membership.school_id}::uuid
      ORDER BY cs.grade, cs.section
    `.execute(this.db);
    const exceptions = await sql<any>`
      WITH scores AS (
        SELECT st.id, st.admission_number, u.first_name, u.last_name, cs.id AS class_section_id, cs.grade, cs.section,
          t.attendance_threshold, count(ar.id) FILTER (WHERE ar.status <> 'excused')::int AS recorded_days,
          COALESCE(sum(CASE WHEN ar.status IN ('present','late') THEN 1.0 WHEN ar.status='half_day' THEN 0.5 ELSE 0 END),0)::numeric AS points
        FROM students st JOIN school_people u ON u.id=st.person_id JOIN enrollments e ON e.student_id=st.id AND e.is_active
        JOIN class_sections cs ON cs.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id AND t.is_active
        LEFT JOIN attendance_records ar ON ar.student_id=st.id
          AND ar.date BETWEEN t.starts_on AND LEAST(t.ends_on, ${selectedDate}::date)
        WHERE st.school_id=${membership.school_id}::uuid
        GROUP BY st.id, st.admission_number, u.first_name, u.last_name, cs.id, cs.grade, cs.section, t.attendance_threshold
      ) SELECT *, round(points*100.0/NULLIF(recorded_days,0),2) AS percentage FROM scores
      WHERE recorded_days >= 5 AND points*100.0/NULLIF(recorded_days,0) < attendance_threshold
      ORDER BY percentage, grade, section LIMIT 20
    `.execute(this.db);
    const operationalRows = classes.rows.filter((row) => classContext.has(row.id));
    const dueRows = operationalRows.filter((row) => classContext.get(row.id)?.can_mark);
    const totals = dueRows.reduce((result, row) => ({
      students: result.students + Number(row.student_count), marked: result.marked + Number(row.marked_count),
      scored: result.scored + Number(row.scored_count), attending: result.attending + Number(row.attending_count),
      absent: result.absent + Number(row.absent_count), late: result.late + Number(row.late_count),
      excused: result.excused + Number(row.excused_count),
    }), { students: 0, marked: 0, scored: 0, attending: 0, absent: 0, late: 0, excused: 0 });
    const [followupActions, eventActions] = await Promise.all([
      this.followupHomeActions(user, "staff"),
      this.staffEventHomeActions(user, membership.school_id, "principal"),
    ]);
    const pendingRegisters = dueRows
      .filter((row) => !["submitted", "locked"].includes(classContext.get(row.id)?.submission_status ?? "not_started"))
      .map((row) => {
        const context = classContext.get(row.id)!;
        const status = context.submission_status ?? "not_started";
        return {
          id: `attendance-register:${row.id}:${selectedDate}`,
          kind: "attendance_register",
          priority: status === "in_progress" ? "high" : "normal",
          title: `${`Class ${row.grade}${row.section}`} register is ${status === "in_progress" ? "unfinished" : "due"}`,
          detail: `${Number(row.marked_count)}/${Number(row.student_count)} students marked.`,
          status_label: status === "in_progress" ? "Partly marked" : "Not started",
          action_label: "Review register",
          href: `/principal/attendance?class_section_id=${encodeURIComponent(row.id)}&date=${selectedDate}`,
          source_id: row.id,
          occurs_at: context.starts_at ? `${selectedDate}T${String(context.starts_at).slice(0, 8)}` : null,
          due_at: context.ends_at ? `${selectedDate}T${String(context.ends_at).slice(0, 8)}` : null,
        } satisfies HomeAction;
      });
    const unfinishedRegisterCount = pendingRegisters.filter((action) => action.priority === "high").length;
    const registerActions: HomeAction[] = pendingRegisters.length === 0 ? [] : pendingRegisters.length === 1
      ? pendingRegisters
      : [{
          id: `attendance-registers:${membership.school_id}:${selectedDate}`,
          kind: "attendance_register",
          priority: unfinishedRegisterCount > 0 ? "high" : "normal",
          title: `${pendingRegisters.length} attendance registers need attention`,
          detail: unfinishedRegisterCount > 0
            ? `${unfinishedRegisterCount} partly marked, ${pendingRegisters.length - unfinishedRegisterCount} not started.`
            : `${pendingRegisters.length} registers have not been started.`,
          status_label: unfinishedRegisterCount > 0 ? "Attendance in progress" : "Attendance due",
          action_label: "Review registers",
          href: `/principal/attendance?date=${selectedDate}`,
          source_id: membership.school_id,
          occurs_at: null,
          due_at: `${selectedDate}T23:59:59`,
        }];
    return {
      date: selectedDate,
      principal: { id: user.id, name: `${user.first_name} ${user.last_name}`.trim() },
      summary: { ...totals, attendance_percentage: totals.scored ? Math.round(totals.attending * 10_000 / totals.scored) / 100 : 0, classes_total: dueRows.length, classes_submitted: dueRows.filter((row) => ["submitted", "locked"].includes(row.register_state) && classContext.get(row.id)?.submission_authorized !== false).length },
      classes: operationalRows.map((row) => ({ ...classContext.get(row.id), ...row, name: `Class ${row.grade}${row.section}`, submission_status: classContext.get(row.id)?.submission_status ?? "not_started", attendance_percentage: Number(row.scored_count) ? Math.round(Number(row.attending_count) * 10_000 / Number(row.scored_count)) / 100 : 0 })),
      exceptions: exceptions.rows.map((row) => ({ ...row, name: `${row.first_name} ${row.last_name}`.trim(), class_name: `Class ${row.grade}${row.section}`, percentage: Number(row.percentage), threshold: Number(row.attendance_threshold) })),
      home_actions: sortHomeActions([...followupActions, ...registerActions, ...eventActions]).slice(0, 6),
    };
  }

  async principalTimetableScreen(user: AuthUser, requestedTermId?: string) {
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const terms = await this.db.selectFrom("academic_terms")
      .select(["id", "academic_year", "name", "starts_on", "ends_on", "is_active"])
      .where("school_id", "=", membership.school_id)
      .orderBy("starts_on", "desc")
      .execute();
    const selectedTerm = requestedTermId
      ? terms.find((term) => term.id === requestedTermId)
      : terms.find((term) => term.is_active) ?? terms[0];
    if (requestedTermId && !selectedTerm) throw new BadRequestException("The selected term does not belong to this school.");
    if (!selectedTerm) {
      return {
        terms: [], selected_term_id: null, classes: [], subjects: [], teachers: [], slots: [], conflicts: [],
        calendar_exceptions: [], coverage: [], school_date: await this.schoolLocalDate(membership.school_id),
      };
    }
    const [classes, subjects, teachers, slots, calendarExceptions, coverage, schoolDate] = await Promise.all([
      this.db.selectFrom("class_sections").selectAll().where("school_id", "=", membership.school_id).where("academic_year", "=", selectedTerm.academic_year).orderBy("grade").orderBy("section").execute(),
      this.db.selectFrom("subjects").select(["id", "code", "name", "short_name", "color"]).where("school_id", "=", membership.school_id).orderBy("name").execute(),
      this.db.selectFrom("school_memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.first_name", "u.last_name"]).where("m.school_id", "=", membership.school_id).where("m.role", "=", "staff").where("m.is_active", "=", true).execute(),
      sql<any>`SELECT ts.*, cs.grade, cs.section, s.name AS subject_name, u.first_name, u.last_name FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id LEFT JOIN subjects s ON s.id=ts.subject_id LEFT JOIN users u ON u.id=ts.teacher_user_id WHERE cs.school_id=${membership.school_id}::uuid AND ts.term_id=${selectedTerm.id}::uuid ORDER BY ts.weekday,ts.period_number,cs.grade,cs.section`.execute(this.db),
      this.db.selectFrom("school_calendar_days")
        .select(["id", "date", "is_instructional", "label", "kind", "reason", "revision"])
        .where("school_id", "=", membership.school_id)
        .where("date", ">=", dateOnly(selectedTerm.starts_on)).where("date", "<=", dateOnly(selectedTerm.ends_on))
        .orderBy("date").execute(),
      sql<{
        class_section_id: string; subject_id: string; weekly_periods: number; weekly_minutes: number;
        projected_periods: number; projected_minutes: number; target_minutes: number | null; revision: number | null;
      }>`
        WITH baseline AS (
          SELECT slot.class_section_id,slot.subject_id,
            count(*)::int AS weekly_periods,
            round(sum(extract(epoch FROM (slot.ends_at-slot.starts_at))/60))::int AS weekly_minutes
          FROM timetable_slots slot
          JOIN class_sections class ON class.id=slot.class_section_id
          WHERE class.school_id=${membership.school_id}::uuid
            AND slot.term_id=${selectedTerm.id}::uuid
            AND slot.slot_type='class' AND slot.subject_id IS NOT NULL
          GROUP BY slot.class_section_id,slot.subject_id
        ), effective AS (
          SELECT schedule.class_section_id,schedule.subject_id,
            count(*)::int AS projected_periods,
            round(sum(extract(epoch FROM (schedule.ends_at-schedule.starts_at))/60))::int AS projected_minutes
          FROM generate_series(${dateOnly(selectedTerm.starts_on)}::date,${dateOnly(selectedTerm.ends_on)}::date,'1 day') day
          CROSS JOIN LATERAL effective_school_schedule(${membership.school_id}::uuid,day::date) schedule
          WHERE schedule.term_id=${selectedTerm.id}::uuid
            AND schedule.slot_type='class' AND schedule.subject_id IS NOT NULL AND NOT schedule.cancelled
          GROUP BY schedule.class_section_id,schedule.subject_id
        )
        SELECT class.id AS class_section_id,subject.id AS subject_id,
          COALESCE(baseline.weekly_periods,0)::int AS weekly_periods,
          COALESCE(baseline.weekly_minutes,0)::int AS weekly_minutes,
          COALESCE(effective.projected_periods,0)::int AS projected_periods,
          COALESCE(effective.projected_minutes,0)::int AS projected_minutes,
          target.target_minutes,target.revision
        FROM class_sections class CROSS JOIN subjects subject
        LEFT JOIN baseline ON baseline.class_section_id=class.id AND baseline.subject_id=subject.id
        LEFT JOIN effective ON effective.class_section_id=class.id AND effective.subject_id=subject.id
        LEFT JOIN curriculum_subject_targets target ON target.term_id=${selectedTerm.id}::uuid
          AND target.class_section_id=class.id AND target.subject_id=subject.id
        WHERE class.school_id=${membership.school_id}::uuid
          AND class.academic_year=${selectedTerm.academic_year}
          AND subject.school_id=${membership.school_id}::uuid
        ORDER BY class.grade,class.section,subject.name
      `.execute(this.db),
      this.schoolLocalDate(membership.school_id),
    ]);
    const conflicts = await sql<any>`
      SELECT a.id AS first_slot_id, b.id AS second_slot_id, a.weekday, a.starts_at, a.ends_at,
        CASE WHEN a.teacher_user_id=b.teacher_user_id AND a.teacher_user_id IS NOT NULL THEN 'teacher' ELSE 'room' END AS type
      FROM timetable_slots a JOIN timetable_slots b ON a.id < b.id AND a.weekday=b.weekday
        AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
        AND ((a.teacher_user_id=b.teacher_user_id AND a.teacher_user_id IS NOT NULL) OR (a.room=b.room AND a.room<>''))
      JOIN class_sections cs ON cs.id=a.class_section_id WHERE cs.school_id=${membership.school_id}::uuid AND a.term_id=${selectedTerm.id}::uuid AND b.term_id=${selectedTerm.id}::uuid
      ORDER BY a.weekday,a.starts_at
    `.execute(this.db);
    return {
      terms,
      selected_term_id: selectedTerm.id,
      classes: classes.map((row) => ({ ...row, name: `Class ${row.grade}${row.section}` })), subjects,
      teachers: teachers.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })),
      slots: slots.rows.map((row) => ({ ...row, class_name: `Class ${row.grade}${row.section}`, display_title: row.subject_name ?? row.title, teacher_name: row.teacher_user_id ? `${row.first_name} ${row.last_name}`.trim() : null, weekday_label: weekdayLabels[row.weekday] })),
      conflicts: conflicts.rows,
      calendar_exceptions: calendarExceptions,
      coverage: coverage.rows.map((row) => ({
        ...row,
        weekly_periods: Number(row.weekly_periods), weekly_minutes: Number(row.weekly_minutes),
        projected_periods: Number(row.projected_periods), projected_minutes: Number(row.projected_minutes),
        target_minutes: row.target_minutes === null ? null : Number(row.target_minutes),
        revision: row.revision === null ? null : Number(row.revision),
      })),
      school_date: schoolDate,
    };
  }

  async setCurriculumSubjectTarget(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = curriculumTargetSchema.parse(body);
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const [term, section, subject] = await Promise.all([
      this.db.selectFrom("academic_terms").select(["id", "academic_year"])
        .where("id", "=", data.term_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
      this.db.selectFrom("class_sections").select(["id", "academic_year"])
        .where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
      this.db.selectFrom("subjects").select("id")
        .where("id", "=", data.subject_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
    ]);
    if (!term || !section || !subject || term.academic_year !== section.academic_year) {
      throw new BadRequestException("The selected term, class and subject must belong to the same school year.");
    }
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx, membership.school_id);
      const current = await tx.selectFrom("curriculum_subject_targets").selectAll()
        .where("term_id", "=", data.term_id).where("class_section_id", "=", data.class_section_id)
        .where("subject_id", "=", data.subject_id).forUpdate().executeTakeFirst();
      if ((current?.revision ?? 0) !== data.expected_revision) {
        throw new ConflictException("This subject target changed in another session. Refresh and try again.");
      }
      const target = current
        ? await tx.updateTable("curriculum_subject_targets").set({
            target_minutes: data.target_minutes,
            revision: current.revision + 1,
            updated_by: user.id,
            updated_at: new Date(),
          }).where("term_id", "=", data.term_id).where("class_section_id", "=", data.class_section_id)
            .where("subject_id", "=", data.subject_id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto("curriculum_subject_targets").values({
            school_id: membership.school_id,
            term_id: data.term_id,
            class_section_id: data.class_section_id,
            subject_id: data.subject_id,
            target_minutes: data.target_minutes,
            updated_by: user.id,
          }).returningAll().executeTakeFirstOrThrow();
      await tx.insertInto("audit_events").values({
        action: current ? "timetable.curriculum_target.updated" : "timetable.curriculum_target.created",
        actor_id: user.id, school_id: membership.school_id,
        target_type: "curriculum_subject_target", target_id: data.class_section_id,
        request_id: request.requestId, ip_hash: null,
        metadata: {
          term_id: data.term_id, class_section_id: data.class_section_id, subject_id: data.subject_id,
          previous_minutes: current?.target_minutes ?? null, target_minutes: data.target_minutes, reason: data.reason,
        },
      }).execute();
      await this.events.enqueueTimetableUpdate(tx, {
        schoolId: membership.school_id, classSectionId: data.class_section_id,
        slotId: data.class_section_id, requestId: request.requestId, action: "updated",
      });
      return target;
    });
  }

  async createSchoolClosure(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = schoolClosureSchema.parse(body);
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const [term, schoolDate] = await Promise.all([
      this.db.selectFrom("academic_terms").select(["id", "starts_on", "ends_on"])
        .where("id", "=", data.term_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
      this.schoolLocalDate(membership.school_id),
    ]);
    if (!term || data.starts_on < dateOnly(term.starts_on) || data.ends_on > dateOnly(term.ends_on)) {
      throw new BadRequestException("The closure dates must fall inside the selected academic term.");
    }
    if (data.starts_on < schoolDate) throw new BadRequestException("Past school-calendar dates cannot be changed here.");
    const dates = (await sql<{ date: string }>`
      SELECT day::date::text AS date
      FROM generate_series(${data.starts_on}::date,${data.ends_on}::date,'1 day') day
      ORDER BY day
    `.execute(this.db)).rows.map((row) => row.date);
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx, membership.school_id);
      const existing = await tx.selectFrom("school_calendar_days").select(["date", "label"])
        .where("school_id", "=", membership.school_id).where("date", "in", dates).executeTakeFirst();
      if (existing) throw new ConflictException(`${dateOnly(existing.date)} already has a school-calendar override: ${existing.label || "Calendar override"}.`);
      const attendanceConflict = await sql<{ date: string }>`
        SELECT register.date::text AS date
        FROM attendance_registers register
        WHERE register.school_id=${membership.school_id}::uuid AND register.date=ANY(${dates}::date[])
          AND (register.state IN ('submitted','locked') OR EXISTS (
            SELECT 1 FROM attendance_records record
            WHERE record.class_section_id=register.class_section_id AND record.date=register.date
          ))
        ORDER BY register.date LIMIT 1
      `.execute(tx);
      if (attendanceConflict.rows[0]) {
        throw new ConflictException(`Attendance has already been recorded for ${attendanceConflict.rows[0].date}. Resolve the register before closing this date.`);
      }
      const rows = await tx.insertInto("school_calendar_days").values(dates.map((date) => ({
        school_id: membership.school_id, date, is_instructional: false,
        label: data.label, kind: data.kind, reason: data.reason,
        created_by: user.id, updated_by: user.id,
      }))).returning(["id", "date", "is_instructional", "label", "kind", "reason", "revision"]).execute();
      await tx.insertInto("audit_events").values({
        action: "school_calendar.closure.created", actor_id: user.id, school_id: membership.school_id,
        target_type: "school_calendar_range", target_id: rows[0]!.id,
        request_id: request.requestId, ip_hash: null,
        metadata: { term_id: data.term_id, starts_on: data.starts_on, ends_on: data.ends_on, kind: data.kind, label: data.label, reason: data.reason },
      }).execute();
      const audience = (await sql<{ user_id: string }>`
        SELECT DISTINCT membership.user_id
        FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${membership.school_id}::uuid AND membership.is_active
      `.execute(tx)).rows.map((row) => row.user_id);
      const notify = data.kind === "emergency_closure" ? audience : [];
      await this.events.enqueueUserEvent(tx, {
        schoolId: membership.school_id, eventType: "calendar.updated",
        aggregateType: "school_calendar_range", aggregateId: rows[0]!.id,
        audienceUserIds: audience,
        payload: {
          action: "closure_created", starts_on: data.starts_on, ends_on: data.ends_on,
          refresh: ["calendar", "day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "principal.timetable", "notifications"],
        },
        idempotencyKey: `calendar:${request.requestId}:created:${rows[0]!.id}`,
        notificationUserIds: notify,
        notificationPayload: notify.length ? {
          kind: "general", title: data.label,
          body: data.starts_on === data.ends_on ? `${data.reason} School is closed on ${data.starts_on}.` : `${data.reason} School is closed from ${data.starts_on} to ${data.ends_on}.`,
          parent_link: `/parent/calendar?date=${data.starts_on}`,
          student_link: `/student/calendar?date=${data.starts_on}`,
          staff_link: `/teacher/calendar?date=${data.starts_on}`,
          admin_link: `/principal/calendar?date=${data.starts_on}`,
        } : null,
      });
      return { created: true as const, results: rows };
    });
  }

  async deleteSchoolClosure(user: AuthUser, date: string, body: unknown, request: AuthenticatedRequest) {
    if (!datePattern.test(date)) throw new BadRequestException("Use ISO date format YYYY-MM-DD.");
    const data = schoolClosureDeleteSchema.parse(body);
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const schoolDate = await this.schoolLocalDate(membership.school_id);
    if (date < schoolDate) throw new BadRequestException("Past school-calendar dates cannot be changed here.");
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx, membership.school_id);
      const current = await tx.selectFrom("school_calendar_days").selectAll()
        .where("school_id", "=", membership.school_id).where("date", "=", date).forUpdate().executeTakeFirst();
      if (!current || current.is_instructional) throw new NotFoundException("School closure not found.");
      if (current.revision !== data.expected_revision) throw new ConflictException("This school-calendar date changed in another session. Refresh and try again.");
      const attendanceConflict = await sql<{ found: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM attendance_registers register
          WHERE register.school_id=${membership.school_id}::uuid AND register.date=${date}::date
            AND (register.state IN ('submitted','locked') OR EXISTS (
              SELECT 1 FROM attendance_records record
              WHERE record.class_section_id=register.class_section_id AND record.date=register.date
            ))
        ) AS found
      `.execute(tx);
      if (attendanceConflict.rows[0]?.found) throw new ConflictException("Attendance exists for this date, so the closure cannot be removed here.");
      await tx.deleteFrom("school_calendar_days").where("id", "=", current.id).execute();
      await tx.insertInto("audit_events").values({
        action: "school_calendar.closure.removed", actor_id: user.id, school_id: membership.school_id,
        target_type: "school_calendar_day", target_id: current.id,
        request_id: request.requestId, ip_hash: null,
        metadata: { date, label: current.label, kind: current.kind, reason: data.reason },
      }).execute();
      const audience = (await sql<{ user_id: string }>`
        SELECT DISTINCT membership.user_id
        FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${membership.school_id}::uuid AND membership.is_active
      `.execute(tx)).rows.map((row) => row.user_id);
      const notify = current.kind === "emergency_closure" ? audience : [];
      await this.events.enqueueUserEvent(tx, {
        schoolId: membership.school_id, eventType: "calendar.updated",
        aggregateType: "school_calendar_day", aggregateId: current.id,
        audienceUserIds: audience,
        payload: {
          action: "closure_removed", date,
          refresh: ["calendar", "day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "principal.timetable", "notifications"],
        },
        idempotencyKey: `calendar:${request.requestId}:removed:${current.id}`,
        notificationUserIds: notify,
        notificationPayload: notify.length ? {
          kind: "general", title: `${current.label} cancelled`,
          body: `The closure on ${date} was removed. Check the timetable for the restored school day.`,
          parent_link: `/parent/calendar?date=${date}`,
          student_link: `/student/calendar?date=${date}`,
          staff_link: `/teacher/calendar?date=${date}`,
          admin_link: `/principal/calendar?date=${date}`,
        } : null,
      });
      return { deleted: true as const, date };
    });
  }

  async createTimetableSlot(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = timetableSlotSchema.parse(body);
    if (data.ends_at <= data.starts_at) throw new BadRequestException("End time must be after start time.");
    const section = await this.db.selectFrom("class_sections").selectAll().where("id", "=", data.class_section_id).executeTakeFirst();
    if (!section) throw new NotFoundException("Class section not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], section.school_id);
    const term = await this.db.selectFrom("academic_terms").select(["id", "academic_year"]).where("school_id", "=", membership.school_id)
      .$if(Boolean(data.term_id), (query) => query.where("id", "=", data.term_id!))
      .$if(!data.term_id, (query) => query.where("academic_year", "=", section.academic_year).where("is_active", "=", true))
      .executeTakeFirst();
    if (!term || term.academic_year !== section.academic_year) throw new NotFoundException("The selected term is not available for this class.");
    if (data.teacher_user_id) {
      const teacher = await this.db.selectFrom("school_memberships").select("id").where("school_id", "=", membership.school_id).where("user_id", "=", data.teacher_user_id).where("role", "=", "staff").where("is_active", "=", true).executeTakeFirst();
      if (!teacher) throw new BadRequestException("Selected teacher is not active in this school.");
    }
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      const conflict = data.teacher_user_id || data.room ? await tx.selectFrom("timetable_slots").select("id").where("term_id", "=", term.id).where("weekday", "=", data.weekday)
        .where("starts_at", "<", data.ends_at).where("ends_at", ">", data.starts_at)
        .where((eb) => eb.or([
          ...(data.teacher_user_id ? [eb("teacher_user_id", "=", data.teacher_user_id)] : []),
          ...(data.room ? [eb("room", "=", data.room)] : []),
        ])).executeTakeFirst() : undefined;
      if (conflict) throw new BadRequestException("The selected teacher or room already has an overlapping timetable slot.");
      const slot = await tx.insertInto("timetable_slots").values({
        class_section_id: data.class_section_id, term_id: term.id, subject_id: data.subject_id ?? null,
        weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at,
        slot_type: data.slot_type, title: data.title, room: data.room, teacher_user_id: data.teacher_user_id ?? null,
        teacher_designation: data.teacher_designation,
      }).returningAll().executeTakeFirstOrThrow();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.created", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: data.class_section_id, slotId: slot.id, requestId: request.requestId, action: "created" });
      return slot;
    });
  }

  async updateTimetableSlot(user: AuthUser, slotId: string, body: unknown, request: AuthenticatedRequest) {
    const data = timetableSlotSchema.parse(body);
    if (data.ends_at <= data.starts_at) throw new BadRequestException("End time must be after start time.");
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.term_id", "ts.class_section_id", "cs.school_id"]).where("ts.id", "=", slotId).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], current.school_id);
    if (data.term_id && data.term_id !== current.term_id) throw new BadRequestException("Move periods between terms by copying the timetable into the selected term.");
    const section = await this.db.selectFrom("class_sections").select("id").where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst();
    if (!section) throw new BadRequestException("Selected class does not belong to this school.");
    if (data.teacher_user_id) {
      const teacher = await this.db.selectFrom("school_memberships").select("id").where("school_id", "=", membership.school_id).where("user_id", "=", data.teacher_user_id).where("role", "=", "staff").where("is_active", "=", true).executeTakeFirst();
      if (!teacher) throw new BadRequestException("Selected teacher is not active in this school.");
    }
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      const conflict = data.teacher_user_id || data.room ? await tx.selectFrom("timetable_slots").select("id").where("term_id", "=", current.term_id).where("id", "!=", slotId).where("weekday", "=", data.weekday).where("starts_at", "<", data.ends_at).where("ends_at", ">", data.starts_at).where((eb) => eb.or([...(data.teacher_user_id ? [eb("teacher_user_id", "=", data.teacher_user_id)] : []), ...(data.room ? [eb("room", "=", data.room)] : [])])).executeTakeFirst() : undefined;
      if (conflict) throw new BadRequestException("The selected teacher or room already has an overlapping timetable slot.");
      const slot = await tx.updateTable("timetable_slots").set({ class_section_id: data.class_section_id, subject_id: data.subject_id ?? null, teacher_user_id: data.teacher_user_id ?? null, weekday: data.weekday, period_number: data.period_number, starts_at: data.starts_at, ends_at: data.ends_at, slot_type: data.slot_type, title: data.title, room: data.room, teacher_designation: data.teacher_designation }).where("id", "=", slotId).returningAll().executeTakeFirstOrThrow();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.updated", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slot.id, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: data.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: data.class_section_id, slotId: slot.id, requestId: request.requestId, action: "updated" });
      if (current.class_section_id !== data.class_section_id) await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: current.class_section_id, slotId: slot.id, requestId: request.requestId, action: "updated" });
      return slot;
    });
  }

  async deleteTimetableSlot(user: AuthUser, slotId: string, request: AuthenticatedRequest) {
    const current = await this.db.selectFrom("timetable_slots as ts").innerJoin("class_sections as cs", "cs.id", "ts.class_section_id").select(["ts.id", "ts.class_section_id", "cs.school_id"]).where("ts.id", "=", slotId).executeTakeFirst();
    if (!current) throw new NotFoundException("Timetable slot not found.");
    const membership = await this.requireSchoolRole(user, ["admin"], current.school_id);
    await this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx,membership.school_id);
      await tx.deleteFrom("timetable_slots").where("id", "=", slotId).execute();
      await protectPublishedPlans(tx,membership.school_id);
      await tx.insertInto("audit_events").values({ action: "timetable.slot.deleted", actor_id: user.id, school_id: membership.school_id, target_type: "timetable_slot", target_id: slotId, request_id: request.requestId, ip_hash: null, metadata: { class_section_id: current.class_section_id } }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: current.class_section_id, slotId, requestId: request.requestId, action: "deleted" });
    });
    return { deleted: true, id: slotId };
  }

  async copyTimetableDay(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = timetableCopyDaySchema.parse(body);
    const membership = await this.requireSchoolRole(user, ["admin"]);
    const [term, section] = await Promise.all([
      this.db.selectFrom("academic_terms").select(["id", "academic_year"]).where("id", "=", data.term_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
      this.db.selectFrom("class_sections").select(["id", "academic_year"]).where("id", "=", data.class_section_id).where("school_id", "=", membership.school_id).executeTakeFirst(),
    ]);
    if (!term || !section || term.academic_year !== section.academic_year) throw new BadRequestException("The selected class and term do not match.");
    return this.db.transaction().execute(async (tx) => {
      await lockSchedule(tx, membership.school_id);
      const source = await tx.selectFrom("timetable_slots").selectAll()
        .where("term_id", "=", term.id).where("class_section_id", "=", section.id).where("weekday", "=", data.source_weekday)
        .orderBy("period_number").execute();
      if (!source.length) throw new BadRequestException("The source day has no periods to copy.");
      const existingTargets = await tx.selectFrom("timetable_slots").select(["id", "weekday"])
        .where("term_id", "=", term.id).where("class_section_id", "=", section.id).where("weekday", "in", data.target_weekdays).execute();
      if (existingTargets.length && !data.replace) throw new BadRequestException("One or more target days already contain periods. Choose Replace existing days to continue.");
      const otherSlots = await tx.selectFrom("timetable_slots").select(["id", "class_section_id", "teacher_user_id", "weekday", "starts_at", "ends_at", "room"])
        .where("term_id", "=", term.id).where("weekday", "in", data.target_weekdays)
        .$if(data.replace, (query) => query.where("class_section_id", "!=", section.id))
        .execute();
      const planned = data.target_weekdays.flatMap((weekday) => source.map((slot) => ({ ...slot, weekday })));
      const conflict = planned.find((candidate) => otherSlots.some((other) =>
        other.weekday === candidate.weekday && other.starts_at < candidate.ends_at && other.ends_at > candidate.starts_at
        && ((candidate.teacher_user_id && candidate.teacher_user_id === other.teacher_user_id) || (candidate.room && candidate.room === other.room)),
      ));
      if (conflict) throw new BadRequestException(`The copied ${weekdayLabels[conflict.weekday]} schedule conflicts with another teacher or room allocation.`);
      if (data.replace) {
        await tx.deleteFrom("timetable_slots").where("term_id", "=", term.id).where("class_section_id", "=", section.id).where("weekday", "in", data.target_weekdays).execute();
      }
      const inserted = await tx.insertInto("timetable_slots").values(planned.map((slot) => ({
        class_section_id: slot.class_section_id,
        term_id: slot.term_id,
        subject_id: slot.subject_id,
        weekday: slot.weekday,
        period_number: slot.period_number,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        slot_type: slot.slot_type,
        title: slot.title,
        room: slot.room,
        teacher_user_id: slot.teacher_user_id,
        teacher_designation: slot.teacher_designation,
      }))).returning(["id", "weekday"]).execute();
      await protectPublishedPlans(tx, membership.school_id);
      const first = inserted[0]!;
      await tx.insertInto("audit_events").values({
        action: "timetable.day.copied", actor_id: user.id, school_id: membership.school_id,
        target_type: "timetable_slot", target_id: first.id, request_id: request.requestId, ip_hash: null,
        metadata: { class_section_id: section.id, term_id: term.id, source_weekday: data.source_weekday, target_weekdays: data.target_weekdays, replace: data.replace, reason: data.reason, periods_created: inserted.length },
      }).execute();
      await this.events.enqueueTimetableUpdate(tx, { schoolId: membership.school_id, classSectionId: section.id, slotId: first.id, requestId: request.requestId, action: "updated" });
      return { copied: true as const, periods_created: inserted.length, target_weekdays: data.target_weekdays };
    });
  }

}
