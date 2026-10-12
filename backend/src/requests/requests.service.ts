import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolService, type HomeAction } from "../school/school.service.js";
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
  title: string;
  detail: string;
  status_label: string;
  due_at: string | Date | null;
  occurs_at: string | Date | null;
  created_at: string | Date | null;
  urgent: boolean;
  subject_label: string | null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
  return value.toISOString();
}

function categoryForHomeAction(kind: HomeAction["kind"]): RequestCategory {
  if (kind.startsWith("event_")) return "events";
  if (kind === "leave_signature") return "leave";
  if (kind === "diary_acknowledgement") return "communication";
  return "attendance";
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

@Injectable()
export class RequestsService {
  constructor(private readonly db: DatabaseService, private readonly school: SchoolService) {}

  async inbox(user: AuthUser, query: Record<string, string | undefined>): Promise<RequestInboxResponse> {
    const parsed = portalSchema.safeParse(query.portal);
    if (!parsed.success) throw new BadRequestException("Choose parent, teacher or principal request context.");
    const portal = parsed.data;
    const studentId = query.student_id || undefined;
    const scope = await this.scope(user, portal, studentId);
    const baseItems = await this.homeItems(user, portal, scope);
    const projected = portal === "parent"
      ? await this.parentItems(user, scope)
      : portal === "teacher"
        ? await this.teacherItems(user, scope)
        : await this.principalItems(scope);
    const deduplicated = new Map<string, RequestInboxItem>();
    for (const item of [...baseItems, ...projected]) deduplicated.set(item.id, item);
    const items = sortRequestItems([...deduplicated.values()]).slice(0, 100);
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

  private async homeItems(user: AuthUser, portal: RequestPortal, scope: Scope): Promise<RequestInboxItem[]> {
    const response = portal === "parent"
      ? await this.school.parentHome(user, scope.student_id ?? undefined)
      : portal === "teacher"
        ? await this.school.teacherHomeScreen(user)
        : await this.school.principalHomeScreen(user);
    const actions = response.home_actions ?? [];
    return actions
      .filter((action) => action.priority !== "info" && action.kind !== "event_upcoming")
      .map((action) => {
        let href = action.href;
        if (href.startsWith("#")) {
          href = portal === "principal" ? "/principal/followups"
            : portal === "teacher" ? `/teacher${href}`
              : `/parent/home?student_id=${encodeURIComponent(scope.student_id ?? "")}${href}`;
        }
        return {
          ...action,
          category: categoryForHomeAction(action.kind),
          priority: action.priority as RequestPriority,
          href,
          subject_label: scope.student_name,
          created_at: action.occurs_at,
        };
      });
  }

  private item(
    row: StaffActionRow,
    values: Pick<RequestInboxItem, "kind" | "category" | "action_label" | "href">,
    priority: RequestPriority = row.urgent ? "urgent" : "high",
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

  private async parentItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const [policies, invoices] = await Promise.all([
      sql<StaffActionRow>`
        SELECT version.id,version.title,
          'Read and acknowledge the published school policy.'::text AS detail,
          'Acknowledgement needed'::text AS status_label,
          version.effective_on AS due_at,version.published_at AS occurs_at,version.published_at AS created_at,
          (version.review_due_on IS NOT NULL AND version.review_due_on<=current_date)::boolean AS urgent,
          ${scope.student_name}::text AS subject_label
        FROM institution_policy_versions version
        WHERE version.school_id=${scope.school_id}::uuid AND version.status='published'
          AND version.requires_acknowledgement AND 'guardian'=ANY(version.audience_roles)
          AND NOT EXISTS(SELECT 1 FROM institution_policy_acknowledgements acknowledgement
            WHERE acknowledgement.policy_version_id=version.id AND acknowledgement.user_id=${user.id}::uuid)
        ORDER BY version.effective_on NULLS LAST,version.id LIMIT 20
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT invoice.id,invoice.description AS title,
          ('Outstanding balance: ₹'||to_char(GREATEST(invoice.amount_paise-COALESCE(paid.amount_paise,0),0)/100.0,'FM99,99,99,990.00'))::text AS detail,
          ('Due '||to_char(invoice.due_on,'DD Mon'))::text AS status_label,
          invoice.due_on AS due_at,invoice.created_at AS occurs_at,invoice.created_at,
          (invoice.due_on<current_date)::boolean AS urgent,${scope.student_name}::text AS subject_label
        FROM fee_invoices invoice
        LEFT JOIN LATERAL (SELECT COALESCE(sum(payment.amount_paise),0)::int AS amount_paise
          FROM fee_payments payment WHERE payment.invoice_id=invoice.id) paid ON true
        WHERE invoice.school_id=${scope.school_id}::uuid AND invoice.student_id=${scope.student_id}::uuid
          AND invoice.amount_paise>COALESCE(paid.amount_paise,0)
        ORDER BY invoice.due_on,invoice.id LIMIT 20
      `.execute(this.db),
    ]);
    return [
      ...policies.rows.map((row) => this.item(row, { kind: "policy_acknowledgement", category: "governance", action_label: "Review policy", href: "/parent/policies" }, row.urgent ? "urgent" : "normal")),
      ...invoices.rows.map((row) => this.item(row, { kind: "fee_due", category: "finance", action_label: "View fees", href: `/parent/fees?student_id=${encodeURIComponent(scope.student_id ?? "")}` })),
    ];
  }

  private async teacherItems(user: AuthUser, scope: Scope): Promise<RequestInboxItem[]> {
    const profile = await this.db.selectFrom("staff_profiles").select("id")
      .where("school_id", "=", scope.school_id).where("user_id", "=", user.id).executeTakeFirst();
    const [assignments, coverage, trips, swaps, assessments, policies] = await Promise.all([
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
        ORDER BY assignment.starts_on,assignment.id LIMIT 30
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
        ORDER BY task.duty_date,task.id LIMIT 30
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
        ORDER BY trip.service_date,trip.scheduled_departure_time,trip.id LIMIT 30
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
        ORDER BY requester_trip.service_date,swap.id LIMIT 30
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
        ORDER BY assessment.scheduled_at NULLS LAST,assessment.id LIMIT 30
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
        ORDER BY version.effective_on NULLS LAST,version.id LIMIT 20
      `.execute(this.db),
    ]);
    return [
      ...assignments.rows.map((row) => this.item(row, { kind: "responsibility_offer", category: "staffing", action_label: "Review assignment", href: "/teacher/responsibilities" })),
      ...coverage.rows.map((row) => this.item(row, { kind: "coverage_offer", category: "staffing", action_label: "Review cover", href: "/teacher/responsibilities" })),
      ...trips.rows.map((row) => this.item(row, { kind: "transport_assignment", category: "transport", action_label: "Review ride", href: `/teacher/transport?trip_id=${encodeURIComponent(row.id)}` })),
      ...swaps.rows.map((row) => this.item(row, { kind: "transport_swap", category: "transport", action_label: "Respond", href: "/teacher/transport" })),
      ...assessments.rows.map((row) => this.item(row, { kind: "assessment_work", category: "academics", action_label: "Open assessment", href: `/teacher/assessments?assessment_id=${encodeURIComponent(row.id)}` })),
      ...policies.rows.map((row) => this.item(row, { kind: "policy_acknowledgement", category: "governance", action_label: "Review policy", href: "/teacher/policies" }, row.urgent ? "urgent" : "normal")),
    ];
  }

  private async principalItems(scope: Scope): Promise<RequestInboxItem[]> {
    const [leave, departure, swaps, fees, policies, assessments, continuity, concerns] = await Promise.all([
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
        ORDER BY request.starts_on,request.id LIMIT 40
      `.execute(this.db),
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
        ORDER BY request.service_date,request.id LIMIT 40
      `.execute(this.db),
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
        ORDER BY trip.service_date,swap.id LIMIT 40
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT request.id,concat('Payment review · ',invoice.reference)::text AS title,
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
        ORDER BY invoice.due_on,request.id LIMIT 40
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT version.id,version.title,version.summary AS detail,
          'Policy review needed'::text AS status_label,version.review_due_on AS due_at,
          version.submitted_at AS occurs_at,version.created_at,
          (version.review_due_on IS NOT NULL AND version.review_due_on<=current_date)::boolean AS urgent,
          family.category::text AS subject_label
        FROM institution_policy_versions version
        JOIN institution_policy_families family ON family.id=version.family_id
        WHERE version.school_id=${scope.school_id}::uuid AND version.status='in_review'
        ORDER BY version.submitted_at,version.id LIMIT 40
      `.execute(this.db),
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
        ORDER BY assessment.scheduled_at NULLS LAST,assessment.id LIMIT 40
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT review.id,'Attendance entry needs review'::text AS title,review.reason AS detail,
          'Reconciliation needed'::text AS status_label,batch.date AS due_at,
          review.opened_at AS occurs_at,review.opened_at AS created_at,true AS urgent,
          concat('Class ',section.grade,section.section)::text AS subject_label
        FROM attendance_reconciliation_cases review
        JOIN attendance_capture_batches batch ON batch.id=review.batch_id
        JOIN class_sections section ON section.id=batch.class_section_id
        WHERE review.school_id=${scope.school_id}::uuid AND review.state='open'
        ORDER BY review.opened_at,review.id LIMIT 40
      `.execute(this.db),
      sql<StaffActionRow>`
        SELECT report.id,'Student concern report'::text AS title,report.reason AS detail,
          CASE report.status WHEN 'open' THEN 'Review needed' ELSE 'Follow-up needed' END::text AS status_label,
          NULL::date AS due_at,report.created_at AS occurs_at,report.created_at,
          (report.status='open')::boolean AS urgent,NULL::text AS subject_label
        FROM chat_message_reports report
        JOIN chat_messages message ON message.id=report.message_id
        JOIN chat_conversations conversation ON conversation.id=message.conversation_id
        WHERE conversation.school_id=${scope.school_id}::uuid AND report.status IN ('open','under_review')
        ORDER BY (report.status='open') DESC,report.created_at,report.id LIMIT 40
      `.execute(this.db),
    ]);
    return [
      ...leave.rows.map((row) => this.item(row, { kind: "staff_leave_review", category: "leave", action_label: "Review leave", href: "/principal/staff?section=leave" })),
      ...departure.rows.map((row) => this.item(row, { kind: "departure_change", category: "transport", action_label: "Review change", href: "/principal/departure?section=requests" })),
      ...swaps.rows.map((row) => this.item(row, { kind: "transport_swap_approval", category: "transport", action_label: "Review duty change", href: "/principal/departure?section=roster" })),
      ...fees.rows.map((row) => this.item(row, { kind: "fee_review", category: "finance", action_label: "Review payment", href: "/principal/fees" })),
      ...policies.rows.map((row) => this.item(row, { kind: "policy_review", category: "governance", action_label: "Review policy", href: "/principal/governance?section=register" })),
      ...assessments.rows.map((row) => this.item(row, { kind: "assessment_moderation", category: "academics", action_label: "Review assessment", href: `/principal/assessments?assessment_id=${encodeURIComponent(row.id)}` })),
      ...continuity.rows.map((row) => this.item(row, { kind: "attendance_reconciliation", category: "attendance", action_label: "Review entry", href: "/principal/attendance" }, "urgent")),
      ...concerns.rows.map((row) => this.item(row, { kind: "student_concern", category: "care", action_label: "Review concern", href: "/principal/safeguarding" })),
    ];
  }
}
