import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { attendanceWorkspace, type AttendanceClassWorkspace } from "../attendance/attendance-workspace.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import {
  GOVERNANCE_DECISION_AUTHORITY_PORT,
  type GovernanceDecisionAuthorityPort,
} from "../governance/decision-authority.port.js";
import { effectiveSchoolAccess } from "../roles/authorization.js";
import { safeguardingReportAttentionHref } from "../chat/chat-links.js";
export { safeguardingReportAttentionHref } from "../chat/chat-links.js";
import type {
  RequestCategory,
  RequestInboxItem,
  RequestInboxResponse,
  RequestPortal,
  RequestPriority,
} from "./requests.types.js";

const portalSchema = z.enum(["parent", "teacher", "principal"]);
const priorityOrder: Record<RequestPriority, number> = { urgent: 0, high: 1, normal: 2 };

interface Scope {
  school_id: string;
  school_name: string;
  timezone: string;
  student_id: string | null;
  student_name: string | null;
}

interface StaffActionRow {
  id: string;
  entity_id?: string | null;
  target_id?: string | null;
  term_id?: string | null;
  day_plan_id?: string | null;
  weekday?: number | null;
  title: string;
  detail: string;
  status_label: string;
  due_at: string | Date | null;
  occurs_at: string | Date | null;
  created_at: string | Date | null;
  urgent: boolean;
  subject_label: string | null;
  priority?: RequestPriority | null;
}

interface EventActionRow {
  event_id: string;
  title: string;
  starts_at: Date | string;
  payment_due_on: string | null;
  requires_rsvp: boolean;
  requires_guardian_consent: boolean;
  payment_required: boolean;
  participation_requirement: "mandatory" | "optional";
  rsvp_status: "pending" | "accepted" | "declined";
  consent_status: "pending" | "granted" | "denied" | "withdrawn";
  invoice_amount_paise: number | string;
  paid_paise: number | string;
  required_items: number | string;
  required_completed: number | string;
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
  return value.toISOString();
}

export type ParentEventActionFocus = "rsvp" | "consent" | "payment" | "checklist";

export function parentDiaryAttentionHref(studentId: string, itemId: string, itemDate: string | Date): string {
  const date = iso(itemDate)?.slice(0, 10) ?? "";
  return `/parent/diary?student_id=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}&diary_item=${encodeURIComponent(itemId)}`;
}

export function parentEventAttentionHref(eventId: string, studentId: string, focus: ParentEventActionFocus): string {
  return `/parent/events/${encodeURIComponent(eventId)}?student_id=${encodeURIComponent(studentId)}&focus=${focus}`;
}

export function principalNoticeAttentionHref(noticeId: string): string {
  return `/principal/notices/${encodeURIComponent(noticeId)}?focus=attention`;
}

export function eventSessionAttentionHref(
  portal: "teacher" | "principal",
  eventId: string,
  sessionId: string,
): string {
  return `/${portal}/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance`;
}

export function eventFinanceAttentionHref(portal: "teacher" | "principal", eventId: string): string {
  return `/${portal}/events/${encodeURIComponent(eventId)}?view=finance&focus=refunds`;
}

export function eventDutyAttentionHref(portal: "teacher" | "principal", eventId: string): string {
  return `/${portal}/events/${encodeURIComponent(eventId)}?focus=duty`;
}

export function journeyAttentionHref(tripId: string): string {
  return `/principal/departure/journeys/${encodeURIComponent(tripId)}?focus=reconciliation`;
}

export function peopleImportAttentionHref(
  portal: "teacher" | "principal",
  schoolId: string,
  importId: string,
): string {
  return `/${portal}/students/import?school=${encodeURIComponent(schoolId)}&import=${encodeURIComponent(importId)}`;
}

export function governancePolicyAttentionHref(policyFamilyId: string): string {
  return `/principal/governance?section=register&policy=${encodeURIComponent(policyFamilyId)}`;
}

export function dayPlanAttentionHref(
  schoolId: string,
  date: string,
  classSectionId: string,
  planId: string,
): string {
  return `/principal/timetable/day?school=${encodeURIComponent(schoolId)}&date=${encodeURIComponent(date)}&class=${encodeURIComponent(classSectionId)}&plan=${encodeURIComponent(planId)}`;
}

export function scheduleDraftAttentionHref(classSectionId: string, termId: string, versionId: string): string {
  return `/principal/timetable/weekly?settings=pattern&class=${encodeURIComponent(classSectionId)}&term=${encodeURIComponent(termId)}&version=${encodeURIComponent(versionId)}`;
}

export function teachingAssignmentAttentionHref(input: {
  schoolId: string;
  date: string;
  classSectionId: string;
  termId: string;
  weekday: number;
  periodId: string;
  dayPlanId?: string | null;
}): string {
  if (input.dayPlanId) {
    return `${dayPlanAttentionHref(input.schoolId, input.date, input.classSectionId, input.dayPlanId)}&period=${encodeURIComponent(input.periodId)}`;
  }
  return `/principal/timetable/weekly?class=${encodeURIComponent(input.classSectionId)}&term=${encodeURIComponent(input.termId)}&day=${input.weekday}&date=${encodeURIComponent(input.date)}&period=${encodeURIComponent(input.periodId)}`;
}

export function staffAssignmentAttentionHref(staffProfileId: string, assignmentId: string): string {
  return `/principal/staff/${encodeURIComponent(staffProfileId)}?assignment=${encodeURIComponent(assignmentId)}`;
}

export function paymentCaptureAttentionHref(invoiceId: string, orderId: string): string {
  return `/principal/fees?view=review&invoice=${encodeURIComponent(invoiceId)}&order=${encodeURIComponent(orderId)}`;
}

export function collectorDutyAttentionHref(tripId: string): string {
  return `/principal/departure?section=roster&trip=${encodeURIComponent(tripId)}`;
}

export function departurePlanAttentionHref(planId: string, studentId: string, date: string): string {
  return `/principal/departure?section=pickup&date=${encodeURIComponent(date)}&student=${encodeURIComponent(studentId)}&plan=${encodeURIComponent(planId)}`;
}

export function attendanceDeclineAttentionHref(studentId: string, date: string, classSectionId: string): string {
  return `/principal/insights/review/${encodeURIComponent(studentId)}?date=${encodeURIComponent(date)}&insight_days=28&class=${encodeURIComponent(classSectionId)}&followup=missing`;
}

export function sortRequestItems(items: RequestInboxItem[]): RequestInboxItem[] {
  return [...items].sort((left, right) => {
    const priority = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priority) return priority;
    const leftTime = Date.parse(left.due_at ?? left.occurs_at ?? left.created_at ?? "9999-12-31T00:00:00.000Z");
    const rightTime = Date.parse(right.due_at ?? right.occurs_at ?? right.created_at ?? "9999-12-31T00:00:00.000Z");
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
}

export function summarizeRequestItems(items: readonly RequestInboxItem[]): RequestInboxResponse["summary"] {
  const categories: Partial<Record<RequestCategory, number>> = {};
  for (const item of items) categories[item.category] = (categories[item.category] ?? 0) + 1;
  return {
    total: items.length,
    urgent: items.filter((item) => item.priority === "urgent").length,
    high: items.filter((item) => item.priority === "high").length,
    normal: items.filter((item) => item.priority === "normal").length,
    categories,
  };
}

/**
 * A register is operational attention only after the school's configured
 * submission cutoff. Before then it remains visible in the attendance
 * workspace as planned work, but it must not light up the global badge.
 */
export function attendanceRegisterRequestItems(
  portal: "teacher" | "principal",
  date: string,
  rows: readonly AttendanceClassWorkspace[],
  submissionCutoffReached: boolean,
): RequestInboxItem[] {
  if (!submissionCutoffReached) return [];
  return rows.filter((row) => row.can_mark
    && !["submitted", "locked"].includes(row.submission_status)
    && !(portal === "principal" && row.submission_status !== "not_started"
      && (!row.instructional || !row.submission_authorized))).map((row) => ({
    id: `attendance-register:${row.class_section_id}:${date}`,
    kind: "attendance_register",
    category: "attendance",
    priority: row.submission_status === "in_progress" ? "high" : "normal",
    title: `${row.class_name} register is ${row.submission_status === "in_progress" ? "unfinished" : "due"}`,
    detail: `${row.marked_count}/${row.student_count} students marked${row.subjects.length ? ` for ${row.subjects.join(", ")}` : ""}.`,
    status_label: row.submission_status === "in_progress" ? "Finish register" : "Not started",
    action_label: portal === "teacher" ? (row.submission_status === "in_progress" ? "Continue attendance" : "Take attendance") : "Review register",
    href: `/${portal}/attendance?class_section_id=${encodeURIComponent(row.class_section_id)}&date=${date}`,
    source_id: row.class_section_id,
    subject_label: row.class_name,
    occurs_at: row.starts_at ? `${date}T${String(row.starts_at).slice(0, 8)}` : `${date}T12:00:00.000Z`,
    due_at: row.ends_at ? `${date}T${String(row.ends_at).slice(0, 8)}` : `${date}T23:59:59.000Z`,
    created_at: null,
  }));
}

export function principalAttendanceExceptionItems(
  date: string,
  rows: readonly AttendanceClassWorkspace[],
): RequestInboxItem[] {
  return rows
    .filter((row) => row.submission_status !== "not_started" && (!row.instructional || !row.submission_authorized))
    .map((row) => {
      const authorityMismatch = !row.submission_authorized;
      const sourceId = `${row.class_section_id}:${row.term_id}:${date}`;
      return {
        id: `attendance_scope_mismatch:${sourceId}`,
        kind: "attendance_scope_mismatch",
        category: "attendance",
        priority: "urgent",
        title: `Review ${row.class_name} attendance`,
        detail: authorityMismatch
          ? `${row.submitted_by_name ?? "A staff member"} saved this register outside the current teaching assignment.`
          : "Attendance was saved even though this class has no effective lesson on this date.",
        status_label: authorityMismatch ? "Assignment mismatch" : "Schedule mismatch",
        action_label: "Review register",
        href: `/principal/attendance?class_section_id=${encodeURIComponent(row.class_section_id)}&date=${encodeURIComponent(date)}`,
        source_id: sourceId,
        subject_label: row.class_name,
        occurs_at: row.submitted_at ? iso(row.submitted_at) : `${date}T12:00:00.000Z`,
        due_at: `${date}T23:59:59.000Z`,
        created_at: row.submitted_at ? iso(row.submitted_at) : null,
      } satisfies RequestInboxItem;
    });
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly db: DatabaseService,
    @Optional()
    @Inject(GOVERNANCE_DECISION_AUTHORITY_PORT)
    private readonly decisionAuthority?: GovernanceDecisionAuthorityPort,
  ) {}

  private async canReviewStaffLeave(
    user: AuthUser,
    schoolId: string,
    transaction: Transaction<Database>,
  ): Promise<boolean> {
    const decisionAuthority = this.decisionAuthority;
    if (!decisionAuthority) return false;
    try {
      await decisionAuthority.assertDecisionAuthority(
        transaction,
        schoolId,
        "staff_leave_decision",
        user.id,
        new Date(),
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException
        || error instanceof ConflictException
        || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  private async canReviewTransportDutyChange(
    user: AuthUser,
    schoolId: string,
    transaction: Transaction<Database>,
  ): Promise<boolean> {
    const decisionAuthority = this.decisionAuthority;
    if (!decisionAuthority) return false;
    try {
      await decisionAuthority.assertDecisionAuthority(
        transaction,
        schoolId,
        "transport_duty_change_decision",
        user.id,
        new Date(),
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException
        || error instanceof ConflictException
        || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async canReadCommunication(user: AuthUser, schoolId: string): Promise<boolean> {
    const access = await effectiveSchoolAccess(this.db, user.id, schoolId, "messages.view");
    return access.role === "admin" || access.sources.length > 0;
  }

  async inbox(user: AuthUser, query: Record<string, string | undefined>): Promise<RequestInboxResponse> {
    const parsed = portalSchema.safeParse(query.portal);
    if (!parsed.success) throw new BadRequestException("Choose parent, teacher or principal request context.");
    const portal = parsed.data;
    const studentId = query.student_id || undefined;
    const scope = await this.scope(user, portal, studentId);
    const [projected, canonical] = await Promise.all([
      portal === "parent"
        ? this.parentItems(user, scope)
        : portal === "teacher"
          ? this.teacherItems(user, scope)
          : this.principalItems(user, scope),
      portal === "parent"
        ? this.parentCanonicalItems(user, scope)
        : portal === "teacher"
          ? this.teacherCanonicalItems(user, scope)
          : this.principalCanonicalItems(user, scope),
    ]);
    const deduplicated = new Map<string, RequestInboxItem>();
    for (const item of [...projected, ...canonical]) deduplicated.set(item.id, item);
    // Requests is the authoritative attention queue, not a presentation card.
    // Do not silently truncate obligations here; home surfaces may choose their
    // own compact subset without changing what the user can review.
    const items = sortRequestItems([...deduplicated.values()]);
    return {
      portal,
      generated_at: new Date().toISOString(),
      scope: {
        school_id: scope.school_id,
        school_name: scope.school_name,
        timezone: scope.timezone,
        student_id: scope.student_id,
        student_name: scope.student_name,
      },
      summary: summarizeRequestItems(items),
      items,
    };
  }

  private async scope(user: AuthUser, portal: RequestPortal, requestedStudentId?: string): Promise<Scope> {
    if (portal === "parent") {
      const result = await sql<Scope>`
        SELECT student.school_id,school.name AS school_name,school.timezone,student.id AS student_id,
          concat_ws(' ',person.first_name,person.last_name) AS student_name
        FROM parents parent
        JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
        JOIN students student ON student.id=relationship.student_id AND student.school_id=relationship.school_id
        JOIN school_people person ON person.id=student.person_id
        JOIN schools school ON school.id=student.school_id
        JOIN school_memberships membership ON membership.school_id=student.school_id
          AND membership.user_id=${user.id}::uuid AND membership.role='guardian' AND membership.is_active
        WHERE parent.user_id=${user.id}::uuid
          AND (${requestedStudentId ?? null}::uuid IS NULL OR student.id=${requestedStudentId ?? null}::uuid)
          AND (${user.active_school_id ?? null}::uuid IS NULL OR student.school_id=${user.active_school_id ?? null}::uuid)
        ORDER BY relationship.is_primary DESC,student.id
        LIMIT 1
      `.execute(this.db);
      const scope = result.rows[0];
      if (!scope) throw new ForbiddenException("No accessible student was found for this parent request inbox.");
      return scope;
    }
    const role = portal === "principal" ? "admin" : "staff";
    const result = await sql<Scope>`
      SELECT membership.school_id,school.name AS school_name,school.timezone,
        NULL::uuid AS student_id,NULL::text AS student_name
      FROM school_memberships membership
      JOIN schools school ON school.id=membership.school_id
      WHERE membership.user_id=${user.id}::uuid AND membership.role=${role} AND membership.is_active
        AND (${user.active_school_id ?? null}::uuid IS NULL OR membership.school_id=${user.active_school_id ?? null}::uuid)
      ORDER BY membership.created_at
      LIMIT 1
    `.execute(this.db);
    const scope = result.rows[0];
    if (!scope) throw new ForbiddenException(`This account does not have an active ${role} context.`);
    return scope;
  }

  private item(
    row: StaffActionRow,
    values: Pick<RequestInboxItem, "kind" | "category" | "action_label" | "href">,
    priority: RequestPriority = row.priority ?? (row.urgent ? "urgent" : "high"),
  ): RequestInboxItem {
    return {
      id: `${values.kind}:${row.id}`,
      kind: values.kind,
      category: values.category,
      priority,
      title: row.title,
      detail: row.detail,
      status_label: row.status_label,
      action_label: values.action_label,
      href: values.href,
      source_id: row.id,
      subject_label: row.subject_label,
      occurs_at: iso(row.occurs_at),
      due_at: iso(row.due_at),
      created_at: iso(row.created_at),
    };
  }

  private async schoolAttendanceClock(scope: Scope): Promise<{ date: string; submission_cutoff_reached: boolean }> {
    const result = await sql<{ date: string; submission_cutoff_reached: boolean }>`
      SELECT to_char(now() AT TIME ZONE school.timezone,'YYYY-MM-DD') AS date,
        ((now() AT TIME ZONE school.timezone)::time >= school.attendance_submission_cutoff) AS submission_cutoff_reached
      FROM schools school
      WHERE school.id=${scope.school_id}::uuid
    `.execute(this.db);
    return result.rows[0]!;
  }

  private eventItems(rows: readonly EventActionRow[], scope: Scope): RequestInboxItem[] {
    const now = Date.now();
    const studentId = scope.student_id!;
    return rows.flatMap((row): RequestInboxItem[] => {
      const startsAt = iso(row.starts_at)!;
      const imminent = Date.parse(startsAt) - now <= 48 * 3_600_000;
      const accepted = row.participation_requirement === "mandatory" || row.rsvp_status === "accepted";
      const participationReady = accepted && (!row.requires_guardian_consent || row.consent_status === "granted");
      const base = {
        source_id: row.event_id,
        subject_label: scope.student_name,
        occurs_at: startsAt,
        created_at: startsAt,
        category: "events" as const,
        action_label: "Open event",
      };
      const actions: RequestInboxItem[] = [];
      if (row.requires_rsvp && row.rsvp_status === "pending") {
        actions.push({
          ...base, id: `event-rsvp:${row.event_id}`, kind: "event_rsvp",
          href: parentEventAttentionHref(row.event_id, studentId, "rsvp"),
          priority: imminent ? "urgent" : "high", title: `Respond to ${row.title}`,
          detail: "Accept or decline the invitation so the school can plan the participant roster.",
          status_label: imminent ? "Starts soon" : "RSVP pending", action_label: "Respond now", due_at: startsAt,
        });
      }
      if (accepted && row.requires_guardian_consent && row.consent_status === "pending") {
        actions.push({
          ...base, id: `event-consent:${row.event_id}`, kind: "event_consent",
          href: parentEventAttentionHref(row.event_id, studentId, "consent"),
          priority: imminent ? "urgent" : "high", title: `Guardian consent needed for ${row.title}`,
          detail: "Review the event details and record the guardian decision.",
          status_label: imminent ? "Starts soon" : "Consent pending", action_label: "Review consent", due_at: startsAt,
        });
      }
      const invoiceAmount = Number(row.invoice_amount_paise);
      const paid = Number(row.paid_paise);
      if (participationReady && row.payment_required && invoiceAmount > paid) {
        const overdue = Boolean(row.payment_due_on && row.payment_due_on < new Date().toISOString().slice(0, 10));
        actions.push({
          ...base, id: `event-payment:${row.event_id}`, kind: "event_payment",
          href: parentEventAttentionHref(row.event_id, studentId, "payment"),
          priority: overdue ? "urgent" : "high", title: `Event fee due for ${row.title}`,
          detail: `Review the outstanding school ledger balance of ₹${Math.ceil((invoiceAmount - paid) / 100).toLocaleString("en-IN")}.`,
          status_label: row.payment_due_on ? `Due ${row.payment_due_on}` : "Fee pending", action_label: "View fee",
          due_at: row.payment_due_on ? `${row.payment_due_on}T18:29:59.000Z` : startsAt,
        });
      }
      const required = Number(row.required_items);
      const completed = Number(row.required_completed);
      if (participationReady && required > completed) {
        const remaining = required - completed;
        actions.push({
          ...base, id: `event-checklist:${row.event_id}`, kind: "event_checklist",
          href: parentEventAttentionHref(row.event_id, studentId, "checklist"),
          priority: imminent ? "urgent" : "normal", title: `Prepare for ${row.title}`,
          detail: `${remaining} required ${remaining === 1 ? "item is" : "items are"} still unchecked.`,
          status_label: `${completed}/${required} ready`, action_label: "Open checklist", due_at: startsAt,
        });
      }
      return actions;
    });
  }

  private async eventSessionRegisterItems(
    user: AuthUser,
    scope: Scope,
    portal: "teacher" | "principal",
  ): Promise<RequestInboxItem[]> {
    const result = await sql<StaffActionRow>`
      SELECT session.id,event.id AS target_id,concat(event.title,' · ',session.title)::text AS title,
        concat(counts.recorded,'/',counts.roster_count,' recorded',
          CASE WHEN counts.checkout_pending>0 THEN ' · '||counts.checkout_pending||' awaiting checkout'
            WHEN counts.not_recorded>0 THEN ' · '||counts.not_recorded||' not recorded' ELSE '' END)::text AS detail,
        CASE WHEN session.ends_at<=now() AND counts.incomplete>0 THEN 'Attendance incomplete'
          WHEN session.ends_at<=now() THEN 'Ready to lock' ELSE 'Register open' END::text AS status_label,
        session.ends_at AS due_at,session.starts_at AS occurs_at,session.created_at,
        (session.ends_at<=now())::boolean AS urgent,
        CASE WHEN session.venue<>'' THEN session.venue ELSE event.venue END::text AS subject_label,
        CASE WHEN session.ends_at<=now() THEN 'urgent' ELSE 'high' END::text AS priority
      FROM campus_event_sessions session
      JOIN campus_events event ON event.id=session.event_id AND event.school_id=session.school_id
      JOIN schools school ON school.id=event.school_id
      LEFT JOIN LATERAL (
        SELECT count(roster.student_id)::int AS roster_count,
          count(roster.student_id) FILTER(WHERE record.status IS NOT NULL AND record.status<>'not_recorded')::int AS recorded,
          count(roster.student_id) FILTER(WHERE record.status IS NULL OR record.status='not_recorded')::int AS not_recorded,
          count(roster.student_id) FILTER(WHERE session.attendance_mode='check_in_out' AND record.status IN ('present','late'))::int AS checkout_pending,
          count(roster.student_id) FILTER(WHERE record.status IS NULL OR record.status='not_recorded'
            OR (session.attendance_mode='check_in_out' AND record.status IN ('present','late')))::int AS incomplete
        FROM campus_event_session_participants roster
        LEFT JOIN campus_event_attendance_records record ON record.session_id=roster.session_id AND record.student_id=roster.student_id
        WHERE roster.session_id=session.id
      ) counts ON true
      WHERE session.school_id=${scope.school_id}::uuid AND event.status='published'
        AND session.attendance_mode<>'none' AND session.state='open'
        AND now()>=session.starts_at-make_interval(hours => COALESCE((SELECT r.event_entry_hours_before FROM institution_operating_rules r WHERE r.school_id=session.school_id),2))
        AND (now()<=session.ends_at+make_interval(hours => COALESCE((SELECT r.event_staff_hours_after FROM institution_operating_rules r WHERE r.school_id=session.school_id),24))
          OR counts.checkout_pending>0)
        AND (session.ends_at<=now() OR counts.incomplete>0)
        AND (
          (${portal}='principal' AND (session.ends_at<=now() OR EXISTS(
            SELECT 1 FROM campus_event_staff assigned
            WHERE assigned.school_id=event.school_id AND assigned.event_id=event.id AND assigned.user_id=${user.id}::uuid
          )))
          OR
          (${portal}='teacher' AND now()<=session.ends_at+make_interval(hours => COALESCE((SELECT r.event_staff_hours_after FROM institution_operating_rules r WHERE r.school_id=session.school_id),24)) AND (
            EXISTS(
              SELECT 1 FROM staff_role_bindings binding
              WHERE binding.school_id=event.school_id AND binding.context_kind='event' AND binding.scope_id=event.id
                AND binding.user_id=${user.id}::uuid AND binding.role_active
                AND binding.source_kind='event_assignment' AND binding.status='active'
                AND binding.starts_on<=current_date AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
                AND 'events.attendance'=ANY(binding.permissions)
            )
            OR (event.event_type='class_test' AND event.subject_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM campus_event_class_sections target
              JOIN staff_role_bindings binding ON binding.school_id=target.school_id
                AND binding.context_kind='class' AND binding.scope_id=target.class_section_id
              WHERE target.school_id=event.school_id AND target.event_id=event.id
                AND binding.user_id=${user.id}::uuid AND binding.status='active' AND binding.role_active
                AND 'events.manage'=ANY(binding.permissions)
                AND current_date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
                AND (event.starts_at AT TIME ZONE school.timezone)::date
                  BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
                AND (binding.subject_id=event.subject_id OR (binding.subject_id IS NULL AND EXISTS(
                  SELECT 1 FROM timetable_slots slot
                  WHERE slot.class_section_id=target.class_section_id AND slot.subject_id=event.subject_id
                )))
            ))
          ))
        )
      ORDER BY session.ends_at,session.id
    `.execute(this.db);
    return result.rows.map((row) => this.item(row, {
      kind: "event_session_register",
      category: "events",
      action_label: row.status_label === "Ready to lock" ? "Lock register" : "Open register",
      href: eventSessionAttentionHref(portal, row.target_id ?? "", row.id),
    }, row.priority ?? (row.urgent ? "urgent" : "high")));
  }

  private async peopleImportItems(
    user: AuthUser,
    scope: Scope,
    portal: "teacher" | "principal",
  ): Promise<RequestInboxItem[]> {
    const access = await effectiveSchoolAccess(this.db, user.id, scope.school_id, "sis.manage");
    if (access.role !== "admin" && !access.sources.length) return [];
    const result = await sql<StaffActionRow>`
      SELECT import.id,concat('Finish ',import.filename)::text AS title,
        concat(import.row_count,' rows are staged. Review, commit or cancel this import before it expires.')::text AS detail,
        CASE WHEN import.expires_at<=now()+interval '6 hours' THEN 'Expires soon' ELSE 'Import awaiting review' END::text AS status_label,
        import.expires_at AS due_at,import.updated_at AS occurs_at,import.created_at,
        (import.expires_at<=now()+interval '6 hours')::boolean AS urgent,
        term.name::text AS subject_label,
        CASE WHEN import.expires_at<=now()+interval '6 hours' THEN 'urgent' ELSE 'high' END::text AS priority
      FROM people_imports import
      JOIN academic_terms term ON term.id=import.term_id AND term.school_id=import.school_id
      WHERE import.school_id=${scope.school_id}::uuid AND import.state='draft' AND import.expires_at>now()
        AND (import.updated_at<=now()-interval '1 hour' OR import.expires_at<=now()+interval '6 hours')
        AND (${portal}='principal' OR import.created_by=${user.id}::uuid)
      ORDER BY import.expires_at,import.id
    `.execute(this.db);
    return result.rows.map((row) => this.item(row, {
      kind: "people_import_review",
      category: "academics",
      action_label: "Review import",
      href: peopleImportAttentionHref(portal, scope.school_id, row.id),
    }, row.priority ?? (row.urgent ? "urgent" : "high")));
  }

  private async paymentCaptureItems(scope: Scope): Promise<RequestInboxItem[]> {
    const relation = await sql<{ available: boolean }>`
      SELECT to_regclass('fee_gateway_orders') IS NOT NULL AS available
    `.execute(this.db);
    if (!relation.rows[0]?.available) return [];
    const result = await sql<StaffActionRow>`
      SELECT gateway.id,invoice.id AS target_id,'Reconcile captured payment'::text AS title,
        concat_ws(' · ',concat_ws(' ',person.first_name,person.last_name),invoice.reference,
          NULLIF(gateway.provider_payment_id,''))::text AS detail,
        'Captured funds need review'::text AS status_label,invoice.due_on AS due_at,
        gateway.checked_at AS occurs_at,gateway.created_at,true AS urgent,
        concat('₹',to_char(gateway.amount_paise/100.0,'FM99,99,99,990.00'))::text AS subject_label,
        'urgent'::text AS priority
      FROM fee_gateway_orders gateway
      JOIN fee_invoices invoice ON invoice.id=gateway.invoice_id AND invoice.school_id=gateway.school_id
      JOIN students student ON student.id=invoice.student_id AND student.school_id=invoice.school_id
      JOIN school_people person ON person.id=student.person_id
      WHERE gateway.school_id=${scope.school_id}::uuid AND gateway.state='review_required'
      ORDER BY gateway.checked_at,gateway.id
    `.execute(this.db);
    return result.rows.map((row) => this.item(row, {
      kind: "payment_capture_review", category: "finance", action_label: "Reconcile payment",
      href: paymentCaptureAttentionHref(row.target_id ?? "", row.id),
    }, "urgent"));
  }

  private async principalOperationalItems(scope: Scope): Promise<RequestInboxItem[]> {
    const [refunds, journeys, governance, dayPlans, schedules, teachingGaps, responsibilityDeclines,
      paymentCaptures, collectorDeclines, departureExceptions] = await Promise.all([
      sql<StaffActionRow>`
        SELECT event.id,event.title,concat('₹',to_char(balance.refund_due/100.0,'FM99,99,99,990.00'),
            ' remains to be returned across ',balance.family_count,' ',
            CASE WHEN balance.family_count=1 THEN 'family' ELSE 'families' END,'.')::text AS detail,
          'Refund reconciliation needed'::text AS status_label,NULL::timestamptz AS due_at,
          balance.first_credit_at AS occurs_at,event.created_at,false AS urgent,
          concat(balance.family_count,' ',CASE WHEN balance.family_count=1 THEN 'refund' ELSE 'refunds' END)::text AS subject_label,
          'high'::text AS priority
        FROM campus_events event
        JOIN LATERAL (
          SELECT sum(GREATEST(COALESCE(payment.amount_paise,0)
              -GREATEST(invoice.amount_paise-COALESCE(credit.amount_paise,0),0)
              -COALESCE(refund.amount_paise,0),0))::bigint AS refund_due,
            count(*) FILTER(WHERE COALESCE(payment.amount_paise,0)
              -GREATEST(invoice.amount_paise-COALESCE(credit.amount_paise,0),0)
              -COALESCE(refund.amount_paise,0)>0)::int AS family_count,
            min(credit.first_credit_at) AS first_credit_at
          FROM campus_event_participants participant
          JOIN fee_invoices invoice ON invoice.id=participant.fee_invoice_id AND invoice.school_id=participant.school_id
          LEFT JOIN LATERAL (SELECT sum(entry.amount_paise)::bigint AS amount_paise,min(entry.created_at) AS first_credit_at
            FROM fee_invoice_credits entry WHERE entry.invoice_id=invoice.id) credit ON true
          LEFT JOIN LATERAL (SELECT sum(entry.amount_paise)::bigint AS amount_paise
            FROM fee_payments entry WHERE entry.invoice_id=invoice.id) payment ON true
          LEFT JOIN LATERAL (SELECT sum(entry.amount_paise)::bigint AS amount_paise
            FROM fee_refunds entry WHERE entry.invoice_id=invoice.id) refund ON true
          WHERE participant.school_id=event.school_id AND participant.event_id=event.id
        ) balance ON balance.refund_due>0
        WHERE event.school_id=${scope.school_id}::uuid
        ORDER BY balance.first_credit_at,event.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT trip.id,route.name::text AS title,
          concat(roster.unresolved_count,' rider ',CASE WHEN roster.unresolved_count=1 THEN 'outcome remains' ELSE 'outcomes remain' END,
            CASE WHEN roster.exception_count>0 THEN ' · '||roster.exception_count||' marked exception' ELSE '' END)::text AS detail,
          CASE WHEN roster.exception_count>0 THEN 'Rider exception'
            WHEN trip.state='planned' THEN 'Journey did not start' ELSE 'Journey overdue' END::text AS status_label,
          ((trip.service_date+trip.scheduled_departure_time) AT TIME ZONE ${scope.timezone}) AS due_at,
          trip.updated_at AS occurs_at,trip.created_at,true AS urgent,route.vehicle_label::text AS subject_label,
          'urgent'::text AS priority
        FROM transport_trips trip
        JOIN transport_routes route ON route.id=trip.route_id AND route.school_id=trip.school_id
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER(WHERE roster.state IN ('expected','boarded','exception'))::int AS unresolved_count,
            count(*) FILTER(WHERE roster.state='exception')::int AS exception_count
          FROM transport_trip_roster roster WHERE roster.trip_id=trip.id
        ) roster ON true
        WHERE trip.school_id=${scope.school_id}::uuid AND trip.state NOT IN ('completed','cancelled')
          AND (roster.exception_count>0 OR
            (trip.collector_assignment_status<>'declined'
              AND trip.service_date+trip.scheduled_departure_time+interval '4 hours'<now() AT TIME ZONE ${scope.timezone}))
        ORDER BY trip.service_date,trip.scheduled_departure_time,trip.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT family.id,family.title,
          CASE WHEN work.status='draft' AND work.reviewed_at IS NOT NULL AND trim(work.review_note)<>''
            THEN work.review_note
            WHEN current_version.review_due_on<=(now() AT TIME ZONE ${scope.timezone})::date
              THEN 'The published policy review is overdue.'
            ELSE 'The published policy review is due within 30 days.' END::text AS detail,
          CASE WHEN work.status='draft' AND work.reviewed_at IS NOT NULL AND trim(work.review_note)<>'' THEN 'Revision rejected'
            WHEN current_version.review_due_on<=(now() AT TIME ZONE ${scope.timezone})::date THEN 'Policy review overdue'
            ELSE 'Policy review due soon' END::text AS status_label,
          current_version.review_due_on AS due_at,
          COALESCE(work.reviewed_at,current_version.updated_at) AS occurs_at,family.created_at,
          (work.status='draft' AND work.reviewed_at IS NOT NULL AND trim(work.review_note)<>''
            OR current_version.review_due_on<=(now() AT TIME ZONE ${scope.timezone})::date)::boolean AS urgent,
          replace(family.category,'_',' ')::text AS subject_label,
          CASE WHEN work.status='draft' AND work.reviewed_at IS NOT NULL AND trim(work.review_note)<>''
              OR current_version.review_due_on<=(now() AT TIME ZONE ${scope.timezone})::date
            THEN 'urgent' ELSE 'high' END::text AS priority
        FROM institution_policy_families family
        JOIN institution_regulatory_profiles profile ON profile.school_id=family.school_id
        LEFT JOIN LATERAL (SELECT version.* FROM institution_policy_versions version
          WHERE version.family_id=family.id AND version.status='published' ORDER BY version.version DESC LIMIT 1) current_version ON true
        LEFT JOIN LATERAL (SELECT version.* FROM institution_policy_versions version
          WHERE version.family_id=family.id AND version.status IN ('draft','in_review') ORDER BY version.version DESC LIMIT 1) work ON true
        WHERE family.school_id=${scope.school_id}::uuid AND family.is_active
          AND family.capability_pack=ANY(profile.capability_packs)
          AND profile.institution_kind=ANY(family.applicable_institution_kinds)
          AND work.status IS DISTINCT FROM 'in_review'
          AND ((work.status='draft' AND work.reviewed_at IS NOT NULL AND trim(work.review_note)<>'')
            OR current_version.review_due_on<=((now() AT TIME ZONE ${scope.timezone})::date+30))
        ORDER BY urgent DESC,current_version.review_due_on NULLS LAST,family.id
      `.execute(this.db),
      sql<StaffActionRow>`
        WITH clock AS (SELECT (now() AT TIME ZONE ${scope.timezone})::date AS today),
        due_dates AS (
          SELECT today,COALESCE((SELECT candidate::date
            FROM clock source_clock
            CROSS JOIN LATERAL generate_series(source_clock.today+1,source_clock.today+14,interval '1 day') candidate
            LEFT JOIN school_calendar_days calendar ON calendar.school_id=${scope.school_id}::uuid AND calendar.date=candidate::date
            WHERE COALESCE(calendar.is_instructional,extract(isodow FROM candidate)<6)
            ORDER BY candidate LIMIT 1),today+1) AS next_instructional
          FROM clock
        )
        SELECT plan.id,plan.class_section_id AS target_id,concat('Publish ',section.grade,section.section,' day plan')::text AS title,
          concat(to_char(plan.date,'Dy, DD Mon'),' · draft version ',plan.draft_version)::text AS detail,
          CASE WHEN plan.date=dates.today THEN 'Needed today' ELSE 'Next instructional day' END::text AS status_label,
          plan.date AS due_at,plan.date AS occurs_at,plan.updated_at AS created_at,
          (plan.date=dates.today)::boolean AS urgent,concat('Class ',section.grade,section.section)::text AS subject_label,
          CASE WHEN plan.date=dates.today THEN 'urgent' ELSE 'high' END::text AS priority
        FROM day_plans plan
        JOIN class_sections section ON section.id=plan.class_section_id AND section.school_id=plan.school_id
        CROSS JOIN due_dates dates
        WHERE plan.school_id=${scope.school_id}::uuid AND plan.draft_version IS NOT NULL
          AND plan.date IN (dates.today,dates.next_instructional)
        ORDER BY plan.date,section.grade,section.section,plan.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT version.id,version.class_section_id AS target_id,version.term_id,
          concat('Publish ',section.grade,section.section,' timetable')::text AS title,
          concat(term.name,' · ',to_char(version.starts_on,'DD Mon'),'–',to_char(version.ends_on,'DD Mon'))::text AS detail,
          CASE WHEN version.starts_on<=(now() AT TIME ZONE ${scope.timezone})::date THEN 'Schedule start is due'
            ELSE 'Starts within 7 days' END::text AS status_label,
          version.starts_on AS due_at,version.created_at AS occurs_at,version.created_at,
          (version.starts_on<=(now() AT TIME ZONE ${scope.timezone})::date)::boolean AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label,
          CASE WHEN version.starts_on<=(now() AT TIME ZONE ${scope.timezone})::date THEN 'urgent' ELSE 'high' END::text AS priority
        FROM schedule_versions version
        JOIN class_sections section ON section.id=version.class_section_id AND section.school_id=version.school_id
        JOIN academic_terms term ON term.id=version.term_id AND term.school_id=version.school_id
        WHERE version.school_id=${scope.school_id}::uuid AND version.state='draft' AND NOT version.baseline
          AND version.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+7)
          AND version.ends_on>=(now() AT TIME ZONE ${scope.timezone})::date
        ORDER BY version.starts_on,section.grade,section.section,version.id
      `.execute(this.db),
      sql<StaffActionRow>`
        WITH clock AS (SELECT (now() AT TIME ZONE ${scope.timezone})::date AS today),
        due_dates AS (
          SELECT candidate::date AS date,clock.today
          FROM clock
          CROSS JOIN LATERAL generate_series(clock.today,clock.today+6,interval '1 day') candidate
        )
        SELECT concat(slot.id::text,':',dates.date::text) AS id,slot.id AS entity_id,
          slot.class_section_id AS target_id,slot.term_id,slot.day_plan_id,slot.weekday,
          concat('Teacher needed · Class ',section.grade,section.section)::text AS title,
          concat(COALESCE(subject.name,NULLIF(slot.title,''),'Teaching period'),' · ',
            to_char(slot.starts_at,'HH24:MI'),'–',to_char(slot.ends_at,'HH24:MI'))::text AS detail,
          CASE WHEN slot.coverage_status='declined' AND dates.date=dates.today THEN 'Cover declined today'
            WHEN slot.coverage_status='declined' THEN 'Cover declined'
            WHEN dates.date=dates.today THEN 'Teacher unassigned today' ELSE 'Teacher unassigned' END::text AS status_label,
          ((dates.date+slot.ends_at) AT TIME ZONE ${scope.timezone}) AS due_at,dates.date AS occurs_at,
          NULL::timestamptz AS created_at,(dates.date=dates.today)::boolean AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label,
          CASE WHEN dates.date=dates.today THEN 'urgent' ELSE 'high' END::text AS priority
        FROM due_dates dates
        CROSS JOIN LATERAL effective_school_schedule(${scope.school_id}::uuid,dates.date) slot
        JOIN class_sections section ON section.id=slot.class_section_id AND section.school_id=${scope.school_id}::uuid
        LEFT JOIN subjects subject ON subject.id=slot.subject_id AND subject.school_id=${scope.school_id}::uuid
        WHERE slot.slot_type='class' AND NOT slot.cancelled
          AND (slot.teacher_user_id IS NULL OR slot.coverage_status IN ('unassigned','declined'))
        ORDER BY dates.date,slot.starts_at,section.grade,section.section,slot.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT assignment.id,profile.id AS target_id,concat('Reassign ',type.name)::text AS title,
          concat_ws(' · ',concat_ws(' ',profile.first_name,profile.last_name),
            COALESCE(NULLIF(assignment.scope_label,''),
              CASE WHEN section.id IS NOT NULL THEN concat('Class ',section.grade,section.section) END,
              event.title,'Institution'),NULLIF(assignment.response_note,''))::text AS detail,
          'Assignment declined'::text AS status_label,assignment.starts_on AS due_at,
          assignment.responded_at AS occurs_at,assignment.created_at,
          (assignment.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          type.name::text AS subject_label,
          CASE WHEN assignment.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1) THEN 'urgent' ELSE 'high' END::text AS priority
        FROM staff_responsibility_assignments assignment
        JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id AND type.school_id=assignment.school_id
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id AND profile.school_id=assignment.school_id
        LEFT JOIN class_sections section ON section.id=assignment.class_section_id AND section.school_id=assignment.school_id
        LEFT JOIN campus_events event ON event.id=assignment.event_id AND event.school_id=assignment.school_id
        WHERE assignment.school_id=${scope.school_id}::uuid AND assignment.status='declined'
          AND COALESCE(assignment.ends_on,'infinity'::date)>=(now() AT TIME ZONE ${scope.timezone})::date
          AND NOT EXISTS (
            SELECT 1 FROM staff_responsibility_assignments replacement
            WHERE replacement.school_id=assignment.school_id AND replacement.id<>assignment.id
              AND replacement.responsibility_type_id=assignment.responsibility_type_id
              AND replacement.class_section_id IS NOT DISTINCT FROM assignment.class_section_id
              AND replacement.subject_id IS NOT DISTINCT FROM assignment.subject_id
              AND replacement.event_id IS NOT DISTINCT FROM assignment.event_id
              AND replacement.status IN ('offered','active')
              AND replacement.starts_on<=COALESCE(assignment.ends_on,'infinity'::date)
              AND COALESCE(replacement.ends_on,'infinity'::date)>=assignment.starts_on
          )
        ORDER BY assignment.starts_on,assignment.id
      `.execute(this.db),
      this.paymentCaptureItems(scope),
      sql<StaffActionRow>`
        SELECT trip.id,route.name::text AS title,
          concat_ws(' · ',concat_ws(' ',collector.first_name,collector.last_name),route.vehicle_label,
            NULLIF(trip.assignment_note,''))::text AS detail,
          'Collector declined duty'::text AS status_label,
          ((trip.service_date+trip.scheduled_departure_time) AT TIME ZONE ${scope.timezone}) AS due_at,
          trip.assignment_declined_at AS occurs_at,trip.created_at,
          (trip.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          route.vehicle_label::text AS subject_label,
          CASE WHEN trip.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1) THEN 'urgent' ELSE 'high' END::text AS priority
        FROM transport_trips trip
        JOIN transport_routes route ON route.id=trip.route_id AND route.school_id=trip.school_id
        JOIN users collector ON collector.id=trip.assigned_collector_user_id
        WHERE trip.school_id=${scope.school_id}::uuid AND trip.state='planned'
          AND trip.collector_assignment_status='declined'
        ORDER BY trip.service_date,trip.scheduled_departure_time,trip.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT plan.id,plan.student_id AS target_id,
          concat('Resolve departure exception · ',concat_ws(' ',person.first_name,person.last_name))::text AS title,
          concat(to_char(plan.service_date,'Dy, DD Mon'),' · ',replace(plan.mode,'_',' '))::text AS detail,
          'Departure outcome unresolved'::text AS status_label,plan.service_date AS due_at,
          plan.updated_at AS occurs_at,plan.created_at,
          (plan.service_date<=((now() AT TIME ZONE ${scope.timezone})::date))::boolean AS urgent,
          concat_ws(' ',person.first_name,person.last_name)::text AS subject_label,
          CASE WHEN plan.service_date<=((now() AT TIME ZONE ${scope.timezone})::date) THEN 'urgent' ELSE 'high' END::text AS priority
        FROM departure_plans plan
        JOIN students student ON student.id=plan.student_id AND student.school_id=plan.school_id
        JOIN school_people person ON person.id=student.person_id
        WHERE plan.school_id=${scope.school_id}::uuid AND plan.is_current AND plan.state='exception'
          AND plan.mode<>'school_transport'
        ORDER BY plan.service_date,plan.id
      `.execute(this.db),
    ]);
    return [
      ...refunds.rows.map((row) => this.item(row, {
        kind: "event_refund_reconciliation", category: "finance", action_label: "Record refunds",
        href: eventFinanceAttentionHref("principal", row.id),
      }, "high")),
      ...journeys.rows.map((row) => this.item(row, {
        kind: "journey_reconciliation", category: "transport", action_label: "Resolve journey",
        href: journeyAttentionHref(row.id),
      }, "urgent")),
      ...governance.rows.map((row) => this.item(row, {
        kind: "policy_lifecycle", category: "governance", action_label: "Review policy",
        href: governancePolicyAttentionHref(row.id),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...dayPlans.rows.map((row) => this.item(row, {
        kind: "day_plan_draft", category: "academics", action_label: "Open day plan",
        href: dayPlanAttentionHref(scope.school_id, iso(row.occurs_at)?.slice(0, 10) ?? "", row.target_id ?? "", row.id),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...schedules.rows.map((row) => this.item(row, {
        kind: "schedule_draft", category: "academics", action_label: "Open timetable",
        href: scheduleDraftAttentionHref(row.target_id ?? "", row.term_id ?? "", row.id),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...teachingGaps.rows.map((row) => this.item(row, {
        kind: "teaching_assignment_gap", category: "staffing", action_label: "Assign teacher",
        href: teachingAssignmentAttentionHref({
          schoolId: scope.school_id,
          date: iso(row.occurs_at)?.slice(0, 10) ?? "",
          classSectionId: row.target_id ?? "",
          termId: row.term_id ?? "",
          weekday: Number(row.weekday ?? 1),
          periodId: row.entity_id ?? row.id,
          dayPlanId: row.day_plan_id ?? null,
        }),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...responsibilityDeclines.rows.map((row) => this.item(row, {
        kind: "responsibility_reassignment", category: "staffing", action_label: "Reassign work",
        href: staffAssignmentAttentionHref(row.target_id ?? "", row.id),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...paymentCaptures,
      ...collectorDeclines.rows.map((row) => this.item(row, {
        kind: "collector_duty_gap", category: "transport", action_label: "Reassign duty",
        href: collectorDutyAttentionHref(row.id),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...departureExceptions.rows.map((row) => this.item(row, {
        kind: "departure_plan_exception", category: "transport", action_label: "Resolve departure",
        href: departurePlanAttentionHref(row.id, row.target_id ?? "", iso(row.due_at)?.slice(0, 10) ?? ""),
      }, row.priority ?? (row.urgent ? "urgent" : "high"))),
    ];
  }

  private async parentCanonicalItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [followups, diary, leave, events, feedback] = await Promise.all([
      sql<StaffActionRow>`
        SELECT followup.id,concat('Reply about ',concat_ws(' ',person.first_name,person.last_name),'''s attendance')::text AS title,
          followup.question AS detail,
          CASE WHEN followup.due_at<now() THEN 'Response overdue' ELSE 'Guardian response needed' END::text AS status_label,
          followup.due_at,followup.attendance_date AS occurs_at,followup.created_at,
          (followup.due_at<now())::boolean AS urgent,concat_ws(' ',person.first_name,person.last_name)::text AS subject_label
        FROM attendance_followups followup
        JOIN students student ON student.id=followup.student_id AND student.school_id=followup.school_id
        JOIN school_people person ON person.id=student.person_id
        WHERE followup.student_id=${scope.student_id}::uuid AND followup.state='awaiting_response'
          AND coordination_actor_authorized(followup.school_id,followup.student_id,${user.id}::uuid,'guardian')
        ORDER BY followup.due_at,followup.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT DISTINCT ON (item.id) item.id,item.title,
          'Review and acknowledge this diary item.'::text AS detail,'Acknowledgement needed'::text AS status_label,
          item.due_at,item.date AS occurs_at,item.created_at,(item.due_at IS NOT NULL AND item.due_at<now())::boolean AS urgent,
          ${scope.student_name}::text AS subject_label
        FROM diary_items item
        JOIN enrollments enrollment ON enrollment.class_section_id=item.class_section_id AND enrollment.term_id=item.term_id
          AND enrollment.student_id=${scope.student_id}::uuid AND enrollment.is_active
        WHERE item.school_id=${scope.school_id}::uuid AND item.requires_acknowledgement AND item.published_at<=now()
          AND NOT EXISTS(SELECT 1 FROM diary_acknowledgements acknowledgement
            WHERE acknowledgement.item_id=item.id AND acknowledgement.student_id=${scope.student_id}::uuid)
        ORDER BY item.id,item.due_at NULLS LAST,item.created_at
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT request.id,concat_ws(' ',person.first_name,person.last_name)||' · Student leave' AS title,
          concat(to_char(request.starts_on,'DD Mon'),'–',to_char(request.ends_on,'DD Mon'),' · ',request.reason)::text AS detail,
          'Guardian authorization needed'::text AS status_label,request.starts_on AS due_at,
          request.submitted_at AS occurs_at,request.created_at,
          (request.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          ${scope.student_name}::text AS subject_label
        FROM leave_requests request
        JOIN students student ON student.id=request.student_id
        JOIN school_people person ON person.id=student.person_id
        JOIN guardian_relationships guardian_link ON guardian_link.student_id=request.student_id
        JOIN parents parent ON parent.id=guardian_link.guardian_id
        JOIN schools school ON school.id=student.school_id
        WHERE request.student_id=${scope.student_id}::uuid AND request.status='pending_guardian'
          AND parent.user_id=${user.id}::uuid
          AND guardian_may_sign_leave(guardian_link,(now() AT TIME ZONE school.timezone)::date)
        ORDER BY request.starts_on,request.id
      `.execute(this.db),
      sql<EventActionRow>`
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
        WHERE participant.student_id=${scope.student_id}::uuid AND participant.school_id=${scope.school_id}::uuid
          AND event.status='published' AND event.ends_at>=now()
          AND EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE relationship.school_id=participant.school_id AND relationship.student_id=participant.student_id
              AND parent.user_id=${user.id}::uuid)
        ORDER BY event.starts_at,event.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT DISTINCT ON (campaign.id) campaign.id,campaign.title,
          concat('Share a short, confidential check-in about ',teacher.first_name,' ',teacher.last_name,'.')::text AS detail,
          'Feedback requested'::text AS status_label,campaign.closes_at AS due_at,
          campaign.created_at AS occurs_at,campaign.created_at,
          (campaign.closes_at<=now()+interval '48 hours')::boolean AS urgent,
          ${scope.student_name}::text AS subject_label
        FROM teacher_feedback_campaigns campaign
        JOIN users teacher ON teacher.id=campaign.teacher_user_id
        JOIN enrollments enrollment ON enrollment.class_section_id=campaign.class_section_id
          AND enrollment.student_id=${scope.student_id}::uuid AND enrollment.is_active
        JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=campaign.school_id
        JOIN schools school ON school.id=campaign.school_id
        JOIN guardian_relationships relationship ON relationship.student_id=enrollment.student_id
        JOIN parents parent ON parent.id=relationship.guardian_id
        WHERE campaign.school_id=${scope.school_id}::uuid AND campaign.audience='parents'
          AND campaign.closed_at IS NULL AND campaign.closes_at>now() AND campaign.teacher_user_id<>${user.id}::uuid
          AND parent.user_id=${user.id}::uuid
          AND (now() AT TIME ZONE school.timezone)::date BETWEEN GREATEST(enrollment.enrolled_on,term.starts_on) AND term.ends_on
          AND NOT EXISTS(SELECT 1 FROM teacher_feedback_responses response
            WHERE response.campaign_id=campaign.id AND response.respondent_user_id=${user.id}::uuid)
        ORDER BY campaign.id,campaign.closes_at
      `.execute(this.db),
    ]);
    return [
      ...followups.rows.map((row) => this.item(row, { kind: "attendance_followup", category: "attendance", action_label: "Reply", href: `/parent/home?student_id=${encodeURIComponent(scope.student_id!)}&followup=${encodeURIComponent(row.id)}#attendance-followups` })),
      ...diary.rows.map((row) => this.item(row, { kind: "diary_acknowledgement", category: "communication", action_label: "Open diary", href: parentDiaryAttentionHref(scope.student_id!, row.id, row.occurs_at!) }, row.urgent ? "urgent" : "normal")),
      ...leave.rows.map((row) => this.item(row, { kind: "leave_signature", category: "leave", action_label: "Review leave", href: `/parent/leave?student_id=${encodeURIComponent(scope.student_id!)}&leave_id=${encodeURIComponent(row.id)}` })),
      ...this.eventItems(events.rows, scope),
      ...feedback.rows.map((row) => this.item(row, { kind: "teacher_feedback", category: "academics", action_label: "Give feedback", href: `/parent/teacher-feedback?student_id=${encodeURIComponent(scope.student_id!)}&campaign=${encodeURIComponent(row.id)}` }, row.urgent ? "urgent" : "normal")),
    ];
  }

  private async staffCanonicalBase(
    user: AuthUser,
    scope: Scope,
    portal: "teacher" | "principal",
  ): Promise<RequestInboxItem[]> {
    const clock = await this.schoolAttendanceClock(scope);
    const date = clock.date;
    const role = portal === "principal" ? "admin" : "staff";
    const [classes, duties, reports, care, assignedSafeguardingReports, eventSessions] = await Promise.all([
      attendanceWorkspace(this.db, scope.school_id, user.id, role, date),
      sql<StaffActionRow>`
        SELECT event.id,event.title,
          concat(replace(staff.role,'_',' '),' duty',CASE WHEN event.venue<>'' THEN ' · '||event.venue ELSE '' END)::text AS detail,
          'Assigned event duty'::text AS status_label,event.starts_at AS due_at,event.starts_at AS occurs_at,event.created_at,
          (event.starts_at<=now()+interval '48 hours')::boolean AS urgent,NULL::text AS subject_label
        FROM campus_event_staff staff
        JOIN campus_events event ON event.id=staff.event_id AND event.school_id=staff.school_id
        WHERE staff.school_id=${scope.school_id}::uuid AND staff.user_id=${user.id}::uuid
          AND event.status='published' AND event.ends_at>=now()
          AND (${portal}='principal' OR EXISTS(
            SELECT 1 FROM staff_role_bindings binding
            WHERE binding.school_id=event.school_id AND binding.context_kind='event' AND binding.scope_id=event.id
              AND binding.user_id=${user.id}::uuid AND binding.source_kind='event_assignment'
              AND binding.status='active' AND binding.role_active AND 'events.view'=ANY(binding.permissions)
              AND binding.starts_on<=current_date AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
          ))
        ORDER BY event.starts_at,event.id
      `.execute(this.db),
      portal === "principal" ? sql<StaffActionRow>`
        SELECT batch.id,scheme.name AS title,
          concat('Class ',section.grade,section.section,' · ',term.name,' · Release ',batch.sequence)::text AS detail,
          CASE batch.status WHEN 'reviewed' THEN 'Ready to publish' ELSE 'Report review needed' END::text AS status_label,
          NULL::timestamptz AS due_at,batch.generated_at AS occurs_at,batch.generated_at AS created_at,
          (batch.status='reviewed')::boolean AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label,
          CASE batch.status WHEN 'reviewed' THEN 'high' ELSE 'normal' END::text AS priority
        FROM grading_report_batches batch
        JOIN grading_schemes scheme ON scheme.id=batch.scheme_id
        JOIN class_sections section ON section.id=scheme.class_section_id
        JOIN academic_terms term ON term.id=scheme.term_id
        WHERE batch.school_id=${scope.school_id}::uuid AND batch.status IN ('draft','reviewed')
        ORDER BY (batch.status='reviewed') DESC,batch.generated_at,batch.id
      `.execute(this.db) : sql<StaffActionRow>`
        SELECT batch.id,scheme.name AS title,
          concat('Class ',section.grade,section.section,' · ',term.name,' · Release ',batch.sequence)::text AS detail,
          'Report remarks open'::text AS status_label,NULL::timestamptz AS due_at,
          batch.generated_at AS occurs_at,batch.generated_at AS created_at,false AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label,'normal'::text AS priority
        FROM grading_report_batches batch
        JOIN grading_schemes scheme ON scheme.id=batch.scheme_id
        JOIN class_sections section ON section.id=scheme.class_section_id
        JOIN academic_terms term ON term.id=scheme.term_id
        WHERE batch.school_id=${scope.school_id}::uuid AND batch.status='draft'
          AND EXISTS(SELECT 1 FROM staff_role_bindings binding
            WHERE binding.school_id=scheme.school_id AND binding.scope_id=scheme.class_section_id
              AND binding.context_kind='class' AND binding.user_id=${user.id}::uuid
              AND binding.role_active AND binding.status='active' AND 'reports.comment'=ANY(binding.permissions)
              AND binding.starts_on<=CURRENT_DATE AND (binding.ends_on IS NULL OR binding.ends_on>=CURRENT_DATE))
        ORDER BY batch.generated_at,batch.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT DISTINCT care.id,'Restricted care action needed'::text AS title,
          'Open the assigned protected case and record the required action.'::text AS detail,
          CASE WHEN care.safety_state='immediate_action_required' THEN 'Immediate action required' ELSE 'Reporting decision required' END::text AS status_label,
          NULL::timestamptz AS due_at,care.last_activity_at AS occurs_at,care.created_at,
          (care.safety_state='immediate_action_required')::boolean AS urgent,NULL::text AS subject_label,
          CASE WHEN care.safety_state='immediate_action_required' THEN 'urgent' ELSE 'high' END::text AS priority
        FROM restricted_care_case_assignments assignment
        JOIN restricted_care_cases care ON care.id=assignment.case_id AND care.school_id=assignment.school_id
        WHERE assignment.school_id=${scope.school_id}::uuid AND assignment.user_id=${user.id}::uuid
          AND assignment.revoked_at IS NULL AND care.status<>'closed'
          AND (care.safety_state='immediate_action_required' OR care.reporting_state IN ('assessment_required','reporting_required'))
        ORDER BY (care.safety_state='immediate_action_required') DESC,care.last_activity_at,care.id
      `.execute(this.db),
      portal === "teacher"
        ? this.teacherSafeguardingReportItems(user, scope)
        : Promise.resolve([]),
      this.eventSessionRegisterItems(user, scope, portal),
    ]);
    return [
      ...attendanceRegisterRequestItems(portal, date, classes, clock.submission_cutoff_reached),
      ...(portal === "principal" ? principalAttendanceExceptionItems(date, classes) : []),
      ...duties.rows.map((row) => this.item(row, { kind: "event_duty", category: "events", action_label: "Open duty", href: eventDutyAttentionHref(portal, row.id) }, row.urgent ? "urgent" : "normal")),
      ...reports.rows.map((row) => this.item(row, { kind: "report_card_review", category: "academics", action_label: portal === "principal" ? "Review reports" : "Open remarks", href: `/${portal}/report-cards?view=releases&batch=${encodeURIComponent(row.id)}` }, row.priority ?? (row.urgent ? "high" : "normal"))),
      ...care.rows.map((row) => this.item(row, { kind: "restricted_care_case", category: "care", action_label: "Open protected case", href: `/${portal}/safeguarding?section=cases&case=${encodeURIComponent(row.id)}` }, row.priority ?? (row.urgent ? "urgent" : "high"))),
      ...assignedSafeguardingReports,
      ...eventSessions,
    ];
  }

  private async teacherSafeguardingReportItems(
    user: AuthUser,
    scope: Scope,
  ): Promise<RequestInboxItem[]> {
    const access = await effectiveSchoolAccess(
      this.db,
      user.id,
      scope.school_id,
      "safeguarding.review",
    );
    if (access.role !== "admin" && access.sources.length === 0) return [];

    const result = await sql<StaffActionRow>`
      SELECT report.id,'Student concern report'::text AS title,report.reason AS detail,
        CASE report.status WHEN 'open' THEN 'Review needed' ELSE 'Follow-up needed' END::text AS status_label,
        NULL::timestamptz AS due_at,report.updated_at AS occurs_at,report.created_at,
        (report.status='open')::boolean AS urgent,
        concat_ws(' ',sender.first_name,sender.last_name)::text AS subject_label,
        CASE report.status WHEN 'open' THEN 'urgent' ELSE 'high' END::text AS priority
      FROM chat_message_reports report
      JOIN chat_messages message ON message.id=report.message_id
      JOIN chat_conversations conversation ON conversation.id=message.conversation_id
      JOIN users sender ON sender.id=message.sender_id
      JOIN school_memberships membership
        ON membership.school_id=conversation.school_id
        AND membership.user_id=${user.id}::uuid
        AND membership.role='staff' AND membership.is_active
      JOIN users reviewer ON reviewer.id=membership.user_id AND reviewer.is_active
      WHERE conversation.school_id=${scope.school_id}::uuid
        AND report.assigned_to=${user.id}::uuid
        AND report.status IN ('open','under_review')
        AND EXISTS (
          SELECT 1 FROM staff_role_bindings binding
          WHERE binding.school_id=conversation.school_id
            AND binding.user_id=${user.id}::uuid
            AND binding.role_active AND binding.status='active'
            AND 'safeguarding.review'=ANY(binding.permissions)
            AND binding.starts_on<=current_date
            AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
        )
      ORDER BY (report.status='open') DESC,report.updated_at,report.id
    `.execute(this.db);

    return result.rows.map((row) => this.item(row, {
      kind: "student_concern",
      category: "care",
      action_label: "Review concern",
      href: safeguardingReportAttentionHref("teacher", row.id),
    }, row.priority ?? (row.urgent ? "urgent" : "high")));
  }

  private async teacherCanonicalItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [base, followups, peopleImports] = await Promise.all([
      this.staffCanonicalBase(user, scope, "teacher"),
      sql<StaffActionRow>`
        SELECT followup.id,concat('Attendance follow-up · ',concat_ws(' ',person.first_name,person.last_name))::text AS title,
          followup.question AS detail,
          CASE WHEN followup.due_at<now() THEN 'Overdue' ELSE 'School review needed' END::text AS status_label,
          followup.due_at,followup.attendance_date AS occurs_at,followup.created_at,
          (followup.due_at<now())::boolean AS urgent,concat_ws(' ',person.first_name,person.last_name)::text AS subject_label
        FROM attendance_followups followup
        JOIN students student ON student.id=followup.student_id
        JOIN school_people person ON person.id=student.person_id
        WHERE followup.school_id=${scope.school_id}::uuid AND followup.state<>'resolved'
          AND followup.owner_user_id=${user.id}::uuid
          AND (followup.state='in_review' OR followup.due_at<now())
          AND coordination_actor_authorized(followup.school_id,followup.student_id,${user.id}::uuid,'staff')
        ORDER BY (followup.due_at<now()) DESC,followup.due_at,followup.id
      `.execute(this.db),
      this.peopleImportItems(user, scope, "teacher"),
    ]);
    return [
      ...base,
      ...followups.rows.map((row) => this.item(row, { kind: "attendance_followup", category: "attendance", action_label: "Review follow-up", href: `/teacher?followup=${encodeURIComponent(row.id)}#attendance-followups` })),
      ...peopleImports,
    ];
  }

  private async principalCanonicalItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [base, followups, studentLeave, coverage, assessmentsReady, attendanceDeclines, peopleImports, operational] = await Promise.all([
      this.staffCanonicalBase(user, scope, "principal"),
      sql<StaffActionRow>`
        SELECT followup.id,concat('Attendance follow-up · ',concat_ws(' ',person.first_name,person.last_name))::text AS title,
          followup.question AS detail,
          CASE WHEN followup.due_at<now() THEN 'Overdue' ELSE 'School review needed' END::text AS status_label,
          followup.due_at,followup.attendance_date AS occurs_at,followup.created_at,
          (followup.due_at<now())::boolean AS urgent,concat_ws(' ',person.first_name,person.last_name)::text AS subject_label
        FROM attendance_followups followup
        JOIN students student ON student.id=followup.student_id AND student.school_id=followup.school_id
        JOIN school_people person ON person.id=student.person_id
        WHERE followup.school_id=${scope.school_id}::uuid AND followup.state<>'resolved'
          AND (followup.state='in_review' OR followup.due_at<now())
        ORDER BY (followup.due_at<now()) DESC,followup.due_at,followup.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT request.id,concat_ws(' ',person.first_name,person.last_name)||' · Student leave' AS title,
          concat(to_char(request.starts_on,'DD Mon'),'–',to_char(request.ends_on,'DD Mon'),' · ',request.reason)::text AS detail,
          'School decision needed'::text AS status_label,request.starts_on AS due_at,
          request.guardian_authorized_at AS occurs_at,request.created_at,
          (request.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          concat_ws(' ',person.first_name,person.last_name)::text AS subject_label
        FROM leave_requests request
        JOIN students student ON student.id=request.student_id AND student.school_id=${scope.school_id}::uuid
        JOIN school_people person ON person.id=student.person_id
        WHERE request.status='authorized'
        ORDER BY request.starts_on,request.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT task.id,task.title,
          concat_ws(' · ',concat_ws(' ',profile.first_name,profile.last_name),to_char(task.duty_date,'DD Mon'),
            NULLIF(task.location,''))::text AS detail,
          CASE task.status WHEN 'declined' THEN 'Cover declined' ELSE 'Cover needed' END::text AS status_label,
          task.duty_date AS due_at,task.updated_at AS occurs_at,task.created_at,
          (task.duty_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          CASE WHEN section.id IS NOT NULL THEN concat('Class ',section.grade,section.section) END::text AS subject_label
        FROM staff_coverage_tasks task
        JOIN staff_profiles profile ON profile.id=task.absent_staff_profile_id
        LEFT JOIN class_sections section ON section.id=task.class_section_id
        WHERE task.school_id=${scope.school_id}::uuid AND task.status IN ('open','declined')
        ORDER BY task.duty_date,task.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT assessment.id,assessment.title,
          concat('Class ',section.grade,section.section,' · ',subject.name)::text AS detail,
          'Ready to publish'::text AS status_label,assessment.scheduled_at AS due_at,
          assessment.moderated_at AS occurs_at,assessment.created_at,false AS urgent,
          subject.name AS subject_label,'high'::text AS priority
        FROM assessments assessment
        JOIN class_sections section ON section.id=assessment.class_section_id AND section.school_id=assessment.school_id
        JOIN subjects subject ON subject.id=assessment.subject_id AND subject.school_id=assessment.school_id
        WHERE assessment.school_id=${scope.school_id}::uuid AND assessment.status='moderated'
        ORDER BY assessment.moderated_at,assessment.id
      `.execute(this.db),
      sql<StaffActionRow>`
        WITH clock AS (SELECT (now() AT TIME ZONE ${scope.timezone})::date AS today),
        cohort AS MATERIALIZED (
          SELECT student.id,concat_ws(' ',person.first_name,person.last_name) AS student_name,
            enrollment.class_section_id,enrollment.term_id,enrollment.enrolled_on,
            concat('Class ',section.grade,section.section) AS class_name
          FROM students student
          JOIN school_people person ON person.id=student.person_id
          JOIN LATERAL (
            SELECT current_enrollment.class_section_id,current_enrollment.term_id,current_enrollment.enrolled_on
            FROM enrollments current_enrollment CROSS JOIN clock
            JOIN academic_terms term ON term.id=current_enrollment.term_id AND term.school_id=${scope.school_id}::uuid
            WHERE current_enrollment.student_id=student.id AND current_enrollment.is_active
              AND current_enrollment.enrolled_on<=clock.today AND clock.today BETWEEN term.starts_on AND term.ends_on
            ORDER BY current_enrollment.enrolled_on DESC,current_enrollment.id DESC LIMIT 1
          ) enrollment ON true
          JOIN class_sections section ON section.id=enrollment.class_section_id AND section.school_id=student.school_id
          WHERE student.school_id=${scope.school_id}::uuid
        ), instructional_days AS MATERIALIZED (
          SELECT DISTINCT day::date AS date,schedule.class_section_id,schedule.term_id
          FROM clock
          CROSS JOIN LATERAL generate_series(clock.today-55,clock.today,interval '1 day') day
          CROSS JOIN LATERAL effective_school_schedule(${scope.school_id}::uuid,day::date) schedule
          WHERE schedule.slot_type IN ('class','activity') AND NOT schedule.cancelled
        ), observations AS MATERIALIZED (
          SELECT cohort.*,days.date,record.id AS record_id,record.status,
            CASE WHEN record.status IN ('present','late') THEN 1.0
              WHEN record.status='half_day' THEN 0.5 ELSE 0 END AS points
          FROM cohort
          JOIN instructional_days days ON days.class_section_id=cohort.class_section_id
            AND days.term_id=cohort.term_id AND days.date>=cohort.enrolled_on
          LEFT JOIN attendance_records record ON record.student_id=cohort.id
            AND record.class_section_id=cohort.class_section_id AND record.date=days.date
        ), stats AS (
          SELECT observations.id,observations.student_name,observations.class_section_id,observations.class_name,clock.today,
            count(*) FILTER(WHERE observations.date>=clock.today-27)::int AS current_expected,
            count(record_id) FILTER(WHERE observations.date>=clock.today-27)::int AS current_recorded,
            count(record_id) FILTER(WHERE observations.date>=clock.today-27 AND status<>'excused')::int AS current_scored,
            COALESCE(sum(points) FILTER(WHERE observations.date>=clock.today-27),0)::numeric AS current_points,
            count(*) FILTER(WHERE observations.date<clock.today-27)::int AS previous_expected,
            count(record_id) FILTER(WHERE observations.date<clock.today-27)::int AS previous_recorded,
            count(record_id) FILTER(WHERE observations.date<clock.today-27 AND status<>'excused')::int AS previous_scored,
            COALESCE(sum(points) FILTER(WHERE observations.date<clock.today-27),0)::numeric AS previous_points
          FROM observations CROSS JOIN clock
          GROUP BY observations.id,observations.student_name,observations.class_section_id,observations.class_name,clock.today
        )
        SELECT stats.id,stats.class_section_id AS target_id,
          concat('Attendance check-in · ',stats.student_name)::text AS title,
          concat(to_char(stats.previous_points*100/stats.previous_scored,'FM990.0'),'% → ',
            to_char(stats.current_points*100/stats.current_scored,'FM990.0'),'% · 28-day comparison')::text AS detail,
          'No open follow-up'::text AS status_label,NULL::timestamptz AS due_at,
          stats.today AS occurs_at,NULL::timestamptz AS created_at,false AS urgent,
          stats.class_name::text AS subject_label,'normal'::text AS priority
        FROM stats
        WHERE stats.current_scored>=5 AND stats.previous_scored>=5
          AND stats.current_expected>0 AND stats.previous_expected>0
          AND stats.current_recorded::numeric/stats.current_expected>=0.8
          AND stats.previous_recorded::numeric/stats.previous_expected>=0.8
          AND stats.previous_points*100/stats.previous_scored-stats.current_points*100/stats.current_scored>=10
          AND NOT EXISTS(SELECT 1 FROM attendance_followups followup
            WHERE followup.school_id=${scope.school_id}::uuid AND followup.student_id=stats.id AND followup.state<>'resolved')
        ORDER BY (stats.current_points*100/stats.current_scored-stats.previous_points*100/stats.previous_scored),stats.student_name,stats.id
      `.execute(this.db),
      this.peopleImportItems(user, scope, "principal"),
      this.principalOperationalItems(scope),
    ]);
    return [
      ...base,
      ...followups.rows.map((row) => this.item(row, { kind: "attendance_followup", category: "attendance", action_label: "Review follow-up", href: `/principal/followups?followup=${encodeURIComponent(row.id)}` })),
      ...studentLeave.rows.map((row) => this.item(row, { kind: "student_leave_review", category: "leave", action_label: "Review student leave", href: `/principal/student-leave?request=${encodeURIComponent(row.id)}` })),
      ...coverage.rows.map((row) => this.item(row, { kind: "coverage_gap", category: "staffing", action_label: "Arrange cover", href: `/principal/staff?section=leave&coverage=${encodeURIComponent(row.id)}` })),
      ...assessmentsReady.rows.map((row) => this.item(row, { kind: "assessment_publish", category: "academics", action_label: "Publish results", href: `/principal/assessments?assessment=${encodeURIComponent(row.id)}` }, "high")),
      ...attendanceDeclines.rows.map((row) => this.item(row, { kind: "attendance_decline_review", category: "attendance", action_label: "Review student", href: attendanceDeclineAttentionHref(row.id, iso(row.occurs_at)?.slice(0, 10) ?? "", row.target_id ?? "") }, "normal")),
      ...peopleImports,
      ...operational,
    ];
  }

  private async parentItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [notices, policies, invoices] = await Promise.all([
      sql<StaffActionRow>`
        SELECT notice.id,notice.title,
          CASE notice.response_mode WHEN 'acknowledgement' THEN 'Read and acknowledge.' ELSE 'Choose a response.' END::text AS detail,
          CASE WHEN notice.due_at<now() THEN 'Response deadline passed'
            WHEN notice.response_mode='acknowledgement' THEN 'Acknowledgement needed' ELSE 'Response needed' END::text AS status_label,
          notice.due_at,notice.published_at AS occurs_at,notice.created_at,
          (notice.priority='urgent' OR notice.due_at<now())::boolean AS urgent,
          notice.priority::text AS priority,${scope.student_name}::text AS subject_label
        FROM school_notice_recipients recipient
        JOIN school_notices notice ON notice.id=recipient.notice_id AND notice.school_id=recipient.school_id
        JOIN parents parent ON parent.id=recipient.guardian_id
        WHERE parent.user_id=${user.id}::uuid AND recipient.student_id=${scope.student_id}::uuid
          AND notice.status='published' AND notice.response_mode<>'information' AND recipient.responded_at IS NULL
          AND (notice.due_at IS NULL OR notice.due_at>=now())
        ORDER BY notice.due_at,notice.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT version.id,version.title,
          'Read and acknowledge the published school policy.'::text AS detail,
          'Acknowledgement needed'::text AS status_label,
          version.effective_on AS due_at,version.published_at AS occurs_at,version.published_at AS created_at,
          (version.review_due_on IS NOT NULL AND version.review_due_on<=current_date)::boolean AS urgent,
          ${scope.school_name}::text AS subject_label
        FROM institution_policy_versions version
        WHERE version.school_id=${scope.school_id}::uuid AND version.status='published'
          AND version.requires_acknowledgement AND 'guardian'=ANY(version.audience_roles)
          AND NOT EXISTS(SELECT 1 FROM institution_policy_acknowledgements acknowledgement
            WHERE acknowledgement.policy_version_id=version.id AND acknowledgement.user_id=${user.id}::uuid)
        ORDER BY version.effective_on NULLS LAST,version.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT invoice.id,invoice.description AS title,
          ('Outstanding balance: ₹'||to_char(GREATEST(invoice.amount_paise-COALESCE(credit.amount_paise,0)-COALESCE(paid.amount_paise,0),0)/100.0,'FM99,99,99,990.00'))::text AS detail,
          ('Due '||to_char(invoice.due_on,'DD Mon'))::text AS status_label,
          invoice.due_on AS due_at,invoice.created_at AS occurs_at,invoice.created_at,
          (invoice.due_on<current_date)::boolean AS urgent,${scope.student_name}::text AS subject_label
        FROM fee_invoices invoice
        LEFT JOIN LATERAL (SELECT COALESCE(sum(entry.amount_paise),0)::int AS amount_paise
          FROM fee_invoice_credits entry WHERE entry.invoice_id=invoice.id) credit ON true
        LEFT JOIN LATERAL (SELECT COALESCE(sum(payment.amount_paise),0)::int AS amount_paise
          FROM fee_payments payment WHERE payment.invoice_id=invoice.id) paid ON true
        WHERE invoice.school_id=${scope.school_id}::uuid AND invoice.student_id=${scope.student_id}::uuid
          AND invoice.amount_paise-COALESCE(credit.amount_paise,0)>COALESCE(paid.amount_paise,0)
          -- While a live event owns this invoice, its RSVP/consent/payment
          -- workflow is the one useful destination. Listing the same balance
          -- again as a generic fee would double-count one family obligation.
          -- Once the event is no longer live, the ordinary fee ledger resumes
          -- ownership so an unpaid balance can never disappear.
          AND NOT EXISTS (
            SELECT 1
            FROM campus_event_participants participant
            JOIN campus_events event ON event.id=participant.event_id AND event.school_id=participant.school_id
            LEFT JOIN campus_event_consents consent
              ON consent.event_id=participant.event_id AND consent.student_id=participant.student_id
            WHERE participant.school_id=invoice.school_id
              AND participant.student_id=invoice.student_id
              AND participant.fee_invoice_id=invoice.id
              AND event.status='published' AND event.ends_at>=now() AND event.payment_required
              AND (participant.participation_requirement='mandatory' OR participant.rsvp_status='accepted')
              AND (NOT event.requires_guardian_consent OR consent.status='granted')
          )
        ORDER BY invoice.due_on,invoice.id
      `.execute(this.db),
    ]);
    return [
      ...notices.rows.map((row) => this.item(row, { kind: "notice_response", category: "communication", action_label: "Open notice", href: `/parent/notices/${encodeURIComponent(row.id)}?student_id=${encodeURIComponent(scope.student_id ?? "")}` }, row.priority ?? (row.urgent ? "urgent" : "normal"))),
      ...policies.rows.map((row) => this.item(row, { kind: "policy_acknowledgement", category: "governance", action_label: "Review policy", href: `/parent/policies?policy=${encodeURIComponent(row.id)}` }, row.urgent ? "urgent" : "normal")),
      ...invoices.rows.map((row) => this.item(row, { kind: "fee_due", category: "finance", action_label: "View fees", href: `/parent/fees?student_id=${encodeURIComponent(scope.student_id ?? "")}&invoice=${encodeURIComponent(row.id)}` })),
    ];
  }

  private async staffLeaveDecisionItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    return this.db.transaction().execute(async (transaction) => {
      const canReview = await this.canReviewStaffLeave(user, scope.school_id, transaction);
      if (!canReview) return [];
      const result = await sql<StaffActionRow>`
        SELECT request.id,concat(profile.first_name,' ',profile.last_name,' · ',policy.name)::text AS title,
          concat(to_char(request.starts_on,'DD Mon'),'–',to_char(request.ends_on,'DD Mon'),' · ',request.reason)::text AS detail,
          'Leave decision needed'::text AS status_label,request.starts_on AS due_at,
          request.submitted_at AS occurs_at,request.created_at,
          (request.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          profile.designation AS subject_label
        FROM staff_leave_requests request
        JOIN staff_profiles profile ON profile.id=request.staff_profile_id
        JOIN staff_leave_policies policy ON policy.id=request.policy_id
        WHERE request.school_id=${scope.school_id}::uuid AND request.status='submitted'
        ORDER BY request.starts_on,request.id
      `.execute(transaction);
      return result.rows.map((row) => this.item(row, {
        kind: "staff_leave_review",
        category: "leave",
        action_label: "Review leave",
        href: `/work/staff-leave?school=${encodeURIComponent(scope.school_id)}&request=${encodeURIComponent(row.id)}`,
      }));
    });
  }

  private async teacherItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [profile, canReadCommunication, leave] = await Promise.all([
      this.db.selectFrom("staff_profiles").select("id")
        .where("school_id", "=", scope.school_id).where("user_id", "=", user.id)
        .where("status", "=", "active").executeTakeFirst(),
      this.canReadCommunication(user, scope.school_id),
      this.staffLeaveDecisionItems(user, scope),
    ]);
    const [notices, assignments, coverage, trips, swaps, assessments, policies] = await Promise.all([
      canReadCommunication ? sql<StaffActionRow>`
        SELECT notice.id,notice.title,
          CASE notice.response_mode WHEN 'acknowledgement' THEN 'Read and acknowledge.' ELSE 'Choose a response.' END::text AS detail,
          CASE WHEN notice.due_at<now() THEN 'Response deadline passed'
            WHEN notice.response_mode='acknowledgement' THEN 'Acknowledgement needed' ELSE 'Response needed' END::text AS status_label,
          notice.due_at,notice.published_at AS occurs_at,notice.created_at,
          (notice.priority='urgent' OR notice.due_at<now())::boolean AS urgent,
          notice.priority::text AS priority,NULL::text AS subject_label
        FROM school_notice_recipients recipient
        JOIN school_notices notice ON notice.id=recipient.notice_id AND notice.school_id=recipient.school_id
        WHERE recipient.user_id=${user.id}::uuid AND notice.school_id=${scope.school_id}::uuid
          AND notice.status='published' AND notice.response_mode<>'information' AND recipient.responded_at IS NULL
          AND (notice.due_at IS NULL OR notice.due_at>=now())
        ORDER BY notice.due_at,notice.id
      `.execute(this.db) : Promise.resolve({ rows: [] as StaffActionRow[] }),
      profile ? sql<StaffActionRow>`
        SELECT assignment.id,type.name AS title,
          concat_ws(' · ',NULLIF(assignment.scope_label,''),NULLIF(assignment.location,'')) AS detail,
          'Response requested'::text AS status_label,assignment.starts_on AS due_at,
          assignment.created_at AS occurs_at,assignment.created_at,
          (assignment.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          assignment.scope_label AS subject_label
        FROM staff_responsibility_assignments assignment
        JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
        WHERE assignment.school_id=${scope.school_id}::uuid AND assignment.staff_profile_id=${profile.id}::uuid
          AND assignment.status='offered'
        ORDER BY assignment.starts_on,assignment.id
      `.execute(this.db) : Promise.resolve({ rows: [] as StaffActionRow[] }),
      profile ? sql<StaffActionRow>`
        SELECT task.id,task.title,
          concat_ws(' · ',to_char(task.duty_date,'DD Mon'),NULLIF(task.location,'')) AS detail,
          'Cover response needed'::text AS status_label,task.duty_date AS due_at,
          task.created_at AS occurs_at,task.created_at,
          (task.duty_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          NULL::text AS subject_label
        FROM staff_coverage_tasks task
        WHERE task.school_id=${scope.school_id}::uuid AND task.replacement_staff_profile_id=${profile.id}::uuid
          AND task.status='offered'
        ORDER BY task.duty_date,task.id
      `.execute(this.db) : Promise.resolve({ rows: [] as StaffActionRow[] }),
      sql<StaffActionRow>`
        SELECT trip.id,route.name AS title,
          concat_ws(' · ',to_char(trip.service_date,'DD Mon'),to_char(trip.scheduled_departure_time,'HH24:MI'),
            CASE trip.direction WHEN 'to_institution' THEN 'To school' ELSE 'From school' END) AS detail,
          'Accept transport duty'::text AS status_label,trip.service_date AS due_at,
          trip.created_at AS occurs_at,trip.created_at,
          (trip.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          route.vehicle_label AS subject_label
        FROM transport_trips trip JOIN transport_routes route ON route.id=trip.route_id
        WHERE trip.school_id=${scope.school_id}::uuid AND trip.assigned_collector_user_id=${user.id}::uuid
          AND trip.collector_assignment_status='pending' AND trip.state='planned'
          AND trip.service_date>=((now() AT TIME ZONE ${scope.timezone})::date)
          AND EXISTS(SELECT 1 FROM staff_role_bindings binding
            WHERE binding.school_id=trip.school_id AND binding.user_id=${user.id}::uuid
              AND binding.source_kind='transport_trip' AND binding.scope_id=trip.id
              AND binding.status='active' AND binding.role_active
              AND current_date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
              AND 'departure.collect'=ANY(binding.permissions))
        ORDER BY trip.service_date,trip.scheduled_departure_time,trip.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT swap.id,'Transport duty change'::text AS title,
          concat(requester.first_name,' ',requester.last_name,': ',swap.reason)::text AS detail,
          'Your response needed'::text AS status_label,requester_trip.service_date AS due_at,
          swap.created_at AS occurs_at,swap.created_at,
          (requester_trip.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          route.name AS subject_label
        FROM transport_duty_swap_requests swap
        JOIN users requester ON requester.id=swap.requester_user_id
        JOIN transport_trips requester_trip ON requester_trip.id=swap.requester_trip_id
        JOIN transport_routes route ON route.id=requester_trip.route_id
        WHERE swap.school_id=${scope.school_id}::uuid AND swap.target_user_id=${user.id}::uuid AND swap.status='submitted'
        ORDER BY requester_trip.service_date,swap.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT assessment.id,assessment.title,
          concat('Class ',section.grade,section.section,' · ',subject.name)::text AS detail,
          CASE assignment.role WHEN 'moderator' THEN 'Moderation needed' ELSE 'Marking needed' END::text AS status_label,
          assessment.scheduled_at AS due_at,assignment.assigned_at AS occurs_at,assignment.assigned_at AS created_at,
          (assessment.scheduled_at IS NOT NULL AND assessment.scheduled_at<now())::boolean AS urgent,
          subject.name AS subject_label
        FROM assessment_staff_assignments assignment
        JOIN assessments assessment ON assessment.id=assignment.assessment_id AND assessment.school_id=assignment.school_id
        JOIN class_sections section ON section.id=assessment.class_section_id
        JOIN subjects subject ON subject.id=assessment.subject_id
        WHERE assignment.school_id=${scope.school_id}::uuid AND assignment.user_id=${user.id}::uuid
          AND ((assignment.role='examiner' AND assessment.status='marking')
            OR (assignment.role='moderator' AND assessment.status='submitted'))
          AND EXISTS(SELECT 1 FROM staff_role_bindings binding
            WHERE binding.school_id=assignment.school_id AND binding.user_id=${user.id}::uuid
              AND binding.source_kind='assessment_assignment' AND binding.scope_id=assessment.id
              AND binding.status='active' AND binding.role_active
              AND current_date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
              AND ((assignment.role='examiner' AND 'assessments.mark'=ANY(binding.permissions))
                OR (assignment.role='moderator' AND 'assessments.moderate'=ANY(binding.permissions))))
        ORDER BY assessment.scheduled_at NULLS LAST,assessment.id
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT version.id,version.title,'Read and acknowledge the published staff policy.'::text AS detail,
          'Acknowledgement needed'::text AS status_label,version.effective_on AS due_at,
          version.published_at AS occurs_at,version.published_at AS created_at,
          (version.review_due_on IS NOT NULL AND version.review_due_on<=current_date)::boolean AS urgent,
          NULL::text AS subject_label
        FROM institution_policy_versions version
        WHERE version.school_id=${scope.school_id}::uuid AND version.status='published'
          AND version.requires_acknowledgement AND 'staff'=ANY(version.audience_roles)
          AND NOT EXISTS(SELECT 1 FROM institution_policy_acknowledgements acknowledgement
            WHERE acknowledgement.policy_version_id=version.id AND acknowledgement.user_id=${user.id}::uuid)
        ORDER BY version.effective_on NULLS LAST,version.id
      `.execute(this.db),
    ]);
    return [
      ...notices.rows.map((row) => this.item(row, { kind: "notice_response", category: "communication", action_label: "Open notice", href: `/teacher/notices/${encodeURIComponent(row.id)}` }, row.priority ?? (row.urgent ? "urgent" : "normal"))),
      ...assignments.rows.map((row) => this.item(row, { kind: "responsibility_offer", category: "staffing", action_label: "Review assignment", href: `/teacher/responsibilities?assignment=${encodeURIComponent(row.id)}` })),
      ...coverage.rows.map((row) => this.item(row, { kind: "coverage_offer", category: "staffing", action_label: "Review cover", href: `/teacher/responsibilities?coverage=${encodeURIComponent(row.id)}` })),
      ...trips.rows.map((row) => this.item(row, { kind: "transport_assignment", category: "transport", action_label: "Review ride", href: `/teacher/transport/${encodeURIComponent(row.id)}` })),
      ...swaps.rows.map((row) => this.item(row, { kind: "transport_swap", category: "transport", action_label: "Respond", href: `/teacher/transport?swap=${encodeURIComponent(row.id)}` })),
      ...assessments.rows.map((row) => this.item(row, { kind: "assessment_work", category: "academics", action_label: "Open assessment", href: `/teacher/assessments?assessment=${encodeURIComponent(row.id)}` })),
      ...policies.rows.map((row) => this.item(row, { kind: "policy_acknowledgement", category: "governance", action_label: "Review policy", href: `/teacher/policies?policy=${encodeURIComponent(row.id)}` }, row.urgent ? "urgent" : "normal")),
      ...leave,
    ];
  }

  private async principalItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    return this.db.transaction().execute(async (transaction) => {
    const canReviewStaffLeave = await this.canReviewStaffLeave(user, scope.school_id, transaction);
    const canReviewTransportDutyChange = await this.canReviewTransportDutyChange(user, scope.school_id, transaction);
    const [notices, noticeExceptions, leave, departure, swaps, fees, policies, assessments, continuity, concerns] = await Promise.all([
      sql<StaffActionRow>`
        SELECT notice.id,notice.title,
          CASE notice.response_mode WHEN 'acknowledgement' THEN 'Read and acknowledge.' ELSE 'Choose a response.' END::text AS detail,
          CASE WHEN notice.due_at<now() THEN 'Response deadline passed'
            WHEN notice.response_mode='acknowledgement' THEN 'Acknowledgement needed' ELSE 'Response needed' END::text AS status_label,
          notice.due_at,notice.published_at AS occurs_at,notice.created_at,
          (notice.priority='urgent' OR notice.due_at<now())::boolean AS urgent,
          notice.priority::text AS priority,NULL::text AS subject_label
        FROM school_notice_recipients recipient
        JOIN school_notices notice ON notice.id=recipient.notice_id AND notice.school_id=recipient.school_id
        WHERE recipient.user_id=${user.id}::uuid AND notice.school_id=${scope.school_id}::uuid
          AND notice.status='published' AND notice.response_mode<>'information' AND recipient.responded_at IS NULL
          AND (notice.due_at IS NULL OR notice.due_at>=now())
        ORDER BY notice.due_at,notice.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT notice.id,notice.title,
          concat_ws(' · ',
            CASE WHEN count(*) FILTER (WHERE latest.status='failed')>0 THEN count(*) FILTER (WHERE latest.status='failed')||' delivery failed' END,
            CASE WHEN notice.due_at<now() THEN count(*) FILTER (WHERE recipient.responded_at IS NULL)||' responses overdue' END)::text AS detail,
          'Follow-up needed'::text AS status_label,notice.due_at,notice.published_at AS occurs_at,notice.created_at,
          true AS urgent,'urgent'::text AS priority,NULL::text AS subject_label
        FROM school_notices notice
        JOIN school_notice_recipients recipient ON recipient.notice_id=notice.id
        LEFT JOIN LATERAL (SELECT attempt.status FROM school_notice_delivery_attempts attempt
          WHERE attempt.recipient_id=recipient.id ORDER BY attempt.created_at DESC,attempt.id DESC LIMIT 1) latest ON true
        WHERE notice.school_id=${scope.school_id}::uuid AND notice.status='published'
        GROUP BY notice.id
        HAVING count(*) FILTER (WHERE latest.status='failed')>0
          OR (notice.response_mode<>'information' AND notice.due_at<now() AND count(*) FILTER (WHERE recipient.responded_at IS NULL)>0)
        ORDER BY notice.due_at NULLS LAST,notice.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT request.id,concat(profile.first_name,' ',profile.last_name,' · ',policy.name)::text AS title,
          concat(to_char(request.starts_on,'DD Mon'),'–',to_char(request.ends_on,'DD Mon'),' · ',request.reason)::text AS detail,
          'Leave decision needed'::text AS status_label,request.starts_on AS due_at,
          request.submitted_at AS occurs_at,request.created_at,
          (request.starts_on<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          profile.designation AS subject_label
        FROM staff_leave_requests request
        JOIN staff_profiles profile ON profile.id=request.staff_profile_id
        JOIN staff_leave_policies policy ON policy.id=request.policy_id
        WHERE request.school_id=${scope.school_id}::uuid AND request.status='submitted'
          AND ${canReviewStaffLeave}
        ORDER BY request.starts_on,request.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT request.id,concat(person.first_name,' ',person.last_name)::text AS title,
          concat('Change to ',replace(request.requested_mode,'_',' '),' · ',request.reason)::text AS detail,
          'Departure change to review'::text AS status_label,request.service_date AS due_at,
          request.created_at AS occurs_at,request.created_at,
          (request.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label
        FROM departure_change_requests request
        JOIN students student ON student.id=request.student_id
        JOIN school_people person ON person.id=student.person_id
        LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
        LEFT JOIN class_sections section ON section.id=enrollment.class_section_id
        WHERE request.school_id=${scope.school_id}::uuid AND request.status='submitted'
        ORDER BY request.service_date,request.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT swap.id,'Transport duty change'::text AS title,
          concat(requester.first_name,' ',requester.last_name,' ↔ ',target.first_name,' ',target.last_name,' · ',swap.reason)::text AS detail,
          'School decision needed'::text AS status_label,trip.service_date AS due_at,
          swap.created_at AS occurs_at,swap.created_at,
          (trip.service_date<=((now() AT TIME ZONE ${scope.timezone})::date+1))::boolean AS urgent,
          route.name AS subject_label
        FROM transport_duty_swap_requests swap
        JOIN users requester ON requester.id=swap.requester_user_id
        JOIN users target ON target.id=swap.target_user_id
        JOIN transport_trips trip ON trip.id=swap.requester_trip_id
        JOIN transport_routes route ON route.id=trip.route_id
        WHERE swap.school_id=${scope.school_id}::uuid AND swap.status='accepted'
          AND ${canReviewTransportDutyChange}
        ORDER BY trip.service_date,swap.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT request.id,invoice.id AS target_id,concat('Payment review · ',invoice.reference)::text AS title,
          concat(person.first_name,' ',person.last_name,' · ',request.note)::text AS detail,
          'Finance review needed'::text AS status_label,invoice.due_on AS due_at,
          request.created_at AS occurs_at,request.created_at,
          (invoice.due_on<current_date)::boolean AS urgent,concat('₹',to_char(request.amount_paise/100.0,'FM99,99,99,990.00'))::text AS subject_label
        FROM fee_review_requests request
        JOIN fee_invoices invoice ON invoice.id=request.invoice_id AND invoice.school_id=request.school_id
        JOIN students student ON student.id=invoice.student_id
        JOIN school_people person ON person.id=student.person_id
        LEFT JOIN fee_review_decisions decision ON decision.request_id=request.id
        WHERE request.school_id=${scope.school_id}::uuid AND decision.id IS NULL
        ORDER BY invoice.due_on,request.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT version.id,family.id AS target_id,version.title,version.summary AS detail,
          'Policy review needed'::text AS status_label,version.review_due_on AS due_at,
          version.submitted_at AS occurs_at,version.created_at,
          (version.review_due_on IS NOT NULL AND version.review_due_on<=current_date)::boolean AS urgent,
          family.category::text AS subject_label
        FROM institution_policy_versions version
        JOIN institution_policy_families family ON family.id=version.family_id
        WHERE version.school_id=${scope.school_id}::uuid AND version.status='in_review'
        ORDER BY version.submitted_at,version.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT assessment.id,assessment.title,
          concat('Class ',section.grade,section.section,' · ',subject.name)::text AS detail,
          'Moderation needed'::text AS status_label,assessment.scheduled_at AS due_at,
          assessment.submitted_at AS occurs_at,assessment.created_at,
          (assessment.scheduled_at IS NOT NULL AND assessment.scheduled_at<now())::boolean AS urgent,
          subject.name AS subject_label
        FROM assessments assessment
        JOIN class_sections section ON section.id=assessment.class_section_id
        JOIN subjects subject ON subject.id=assessment.subject_id
        WHERE assessment.school_id=${scope.school_id}::uuid AND assessment.status='submitted'
        ORDER BY assessment.scheduled_at NULLS LAST,assessment.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT review.id,'Attendance entry needs review'::text AS title,review.reason AS detail,
          'Reconciliation needed'::text AS status_label,batch.date AS due_at,
          review.opened_at AS occurs_at,review.opened_at AS created_at,true AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label
        FROM attendance_reconciliation_cases review
        JOIN attendance_capture_batches batch ON batch.id=review.batch_id
        JOIN class_sections section ON section.id=batch.class_section_id
        WHERE review.school_id=${scope.school_id}::uuid AND review.state='open'
        ORDER BY review.opened_at,review.id
      `.execute(transaction),
      sql<StaffActionRow>`
        SELECT report.id,'Student concern report'::text AS title,report.reason AS detail,
          CASE report.status WHEN 'open' THEN 'Review needed' ELSE 'Follow-up needed' END::text AS status_label,
          NULL::date AS due_at,report.created_at AS occurs_at,report.created_at,
          (report.status='open')::boolean AS urgent,NULL::text AS subject_label
        FROM chat_message_reports report
        JOIN chat_messages message ON message.id=report.message_id
        JOIN chat_conversations conversation ON conversation.id=message.conversation_id
        WHERE conversation.school_id=${scope.school_id}::uuid AND report.status IN ('open','under_review')
        ORDER BY (report.status='open') DESC,report.created_at,report.id
      `.execute(transaction),
    ]);
    return [
      ...notices.rows.map((row) => this.item(row, { kind: "notice_response", category: "communication", action_label: "Open notice", href: `/principal/notices/${encodeURIComponent(row.id)}` }, row.priority ?? (row.urgent ? "urgent" : "normal"))),
      ...noticeExceptions.rows.map((row) => this.item(row, { kind: "notice_exception", category: "communication", action_label: "Review notice", href: principalNoticeAttentionHref(row.id) }, "urgent")),
      ...leave.rows.map((row) => this.item(row, { kind: "staff_leave_review", category: "leave", action_label: "Review leave", href: `/work/staff-leave?school=${encodeURIComponent(scope.school_id)}&request=${encodeURIComponent(row.id)}` })),
      ...departure.rows.map((row) => this.item(row, { kind: "departure_change", category: "transport", action_label: "Review change", href: `/principal/departure?section=requests&request=${encodeURIComponent(row.id)}` })),
      ...swaps.rows.map((row) => this.item(row, { kind: "transport_swap_approval", category: "transport", action_label: "Review duty change", href: `/principal/departure?section=roster&swap=${encodeURIComponent(row.id)}` })),
      ...fees.rows.map((row) => this.item(row, { kind: "fee_review", category: "finance", action_label: "Review payment", href: `/principal/fees?view=review&review=${encodeURIComponent(row.id)}` })),
      ...policies.rows.map((row) => this.item(row, { kind: "policy_review", category: "governance", action_label: "Review policy", href: `/principal/governance?section=register&policy=${encodeURIComponent(row.target_id ?? row.id)}` })),
      ...assessments.rows.map((row) => this.item(row, { kind: "assessment_moderation", category: "academics", action_label: "Review assessment", href: `/principal/assessments?assessment=${encodeURIComponent(row.id)}` })),
      ...continuity.rows.map((row) => this.item(row, { kind: "attendance_reconciliation", category: "attendance", action_label: "Review entry", href: `/principal/attendance?review_case=${encodeURIComponent(row.id)}` }, "urgent")),
      ...concerns.rows.map((row) => this.item(row, { kind: "student_concern", category: "care", action_label: "Review concern", href: safeguardingReportAttentionHref("principal", row.id) })),
    ];
    });
  }
}
