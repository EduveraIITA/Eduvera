import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { RequestPortal } from "../requests/requests.types.js";
import type { AttentionItem } from "./attention.types.js";

type NotificationAttentionKind =
  | "student_leave_decision"
  | "staff_leave_decision"
  | "assessment_publication"
  | "report_publication"
  | "day_plan_publication"
  | "timetable_publication"
  | "calendar_change"
  | "attendance_outcome"
  | "event_cancellation"
  | "event_withdrawal"
  | "event_refund"
  | "fee_review_decision"
  | "guardian_leave_authority"
  | "restricted_care_update"
  | "policy_publication"
  | "departure_request_decision"
  | "transport_trip_cancellation"
  | "transport_rider_exception"
  | "departure_handover_exception"
  | "departure_plan_exception"
  | "responsibility_offer"
  | "responsibility_response"
  | "responsibility_revocation"
  | "coverage_offer"
  | "coverage_response"
  | "staff_leave_review"
  | "transport_swap"
  | "transport_swap_approval"
  | "transport_swap_response"
  | "transport_swap_decision";

interface NotificationAttentionRow {
  id: string;
  link: string;
  title: string;
  body: string;
  read_at: Date | string | null;
  created_at: Date | string;
  attention_module: "leave" | "results" | "calendar" | "timetable" | "attendance" |
    "events" | "fees" | "safeguarding" | "policies" | "departure" |
    "staff" | "responsibilities" | "transport";
  attention_source_kind: NotificationAttentionKind;
  attention_source_id: string;
  attention_source_revision: number;
  attention_student_id: string | null;
  attention_class_section_id: string | null;
  source_date: string | null;
  aggregate_id: string | null;
  subject_label: string | null;
}

export interface NotificationAttentionScope {
  portal: RequestPortal;
  schoolId: string;
  studentId?: string | null;
}

function appendQuery(path: string, values: Record<string, string | null | undefined>) {
  const url = new URL(path, "https://attention.invalid");
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function notificationModule(portal: RequestPortal, row: NotificationAttentionRow): AttentionItem["module"] {
  if (row.attention_module !== "timetable") return row.attention_module;
  return portal === "parent" ? "timetable" : "weekly";
}

function notificationHref(row: NotificationAttentionRow) {
  // Producers own the exact route contract. The bell and the attention
  // projection must use that same stored destination so the two entry points
  // cannot drift to different records. Only the stable acknowledgement id is
  // added at projection time.
  return appendQuery(row.link, { attention_notification_id: row.id });
}

function statusLabel(row: NotificationAttentionRow) {
  switch (row.attention_source_kind) {
    case "student_leave_decision":
    case "staff_leave_decision": return row.body;
    case "assessment_publication": return "New assessment result";
    case "report_publication": return "New report card";
    case "day_plan_publication": return "School day changed";
    case "timetable_publication": return "New timetable";
    case "calendar_change": return "Calendar changed";
    case "attendance_outcome": return "Attendance updated";
    case "event_cancellation": return "Event cancelled";
    case "event_withdrawal": return "Place withdrawn";
    case "event_refund": return "Refund recorded";
    case "fee_review_decision": return "Review completed";
    case "guardian_leave_authority": return "Signing access updated";
    case "restricted_care_update": return "Protected case updated";
    case "policy_publication": return "New policy";
    case "departure_request_decision": return "Request decided";
    case "transport_trip_cancellation": return "Journey cancelled";
    case "transport_rider_exception": return "Journey needs attention";
    case "departure_handover_exception": return "Handover needs attention";
    case "departure_plan_exception": return "Departure plan needs attention";
    case "responsibility_offer": return "Response needed";
    case "responsibility_response": return "Assignment answered";
    case "responsibility_revocation": return "Assignment ended";
    case "coverage_offer": return "Response needed";
    case "coverage_response": return "Cover duty answered";
    case "staff_leave_review": return "Review needed";
    case "transport_swap": return "Response needed";
    case "transport_swap_approval": return "Approval needed";
    case "transport_swap_response": return "Colleague responded";
    case "transport_swap_decision": return "School decision recorded";
  }
}

export function mapNotificationAttention(
  scope: NotificationAttentionScope,
  row: NotificationAttentionRow,
): AttentionItem {
  const isRiderException = row.attention_source_kind === "transport_rider_exception";
  const isHandoverException = row.attention_source_kind === "departure_handover_exception";
  const isPlanException = row.attention_source_kind === "departure_plan_exception";
  const isException = isRiderException || isHandoverException || isPlanException;
  const isActionRequired = ["responsibility_offer", "coverage_offer", "staff_leave_review", "transport_swap", "transport_swap_approval"]
    .includes(row.attention_source_kind);
  const isUnread = !row.read_at;
  return {
    id: `notification:${row.id}`,
    source_kind: row.attention_source_kind,
    source_id: row.attention_source_id,
    module: notificationModule(scope.portal, row),
    state: isException ? "exception" : isActionRequired ? "action_required" : "new",
    signals: isException ? ["exception", ...(isUnread ? ["new" as const] : [])]
      : isActionRequired ? ["action_required", ...(isUnread ? ["new" as const] : [])] : ["new"],
    priority: isHandoverException ? "urgent"
      : isRiderException || isPlanException || ["responsibility_offer", "responsibility_revocation", "coverage_offer", "staff_leave_review", "transport_swap", "transport_swap_approval", "transport_swap_response", "transport_swap_decision"].includes(row.attention_source_kind) ? "high" : "normal",
    title: row.title,
    status_label: statusLabel(row),
    subject_label: row.subject_label,
    due_at: null,
    created_at: new Date(row.created_at).toISOString(),
    href: notificationHref(row),
  };
}

@Injectable()
export class NotificationAttentionService {
  constructor(private readonly db: DatabaseService) {}

  async unread(user: AuthUser, scope: NotificationAttentionScope): Promise<AttentionItem[]> {
    const role = scope.portal === "parent" ? "guardian" : scope.portal === "teacher" ? "staff" : "admin";
    const studentId = scope.portal === "parent" ? scope.studentId ?? null : null;
    if (scope.portal === "parent" && !studentId) return [];

    const parentScope = scope.portal === "parent" ? sql`
      AND EXISTS (
        SELECT 1
        FROM students selected_student
        JOIN guardian_relationships relationship
          ON relationship.student_id=selected_student.id
          AND relationship.school_id=selected_student.school_id
        JOIN parents guardian ON guardian.id=relationship.guardian_id
        WHERE selected_student.id=${studentId}::uuid
          AND selected_student.school_id=notification.attention_school_id
          AND guardian.user_id=${user.id}::uuid
      )
      AND (notification.attention_student_id IS NULL OR notification.attention_student_id=${studentId}::uuid)
      AND (
        notification.attention_class_section_id IS NULL
        OR EXISTS (
          SELECT 1 FROM enrollments enrollment
          WHERE enrollment.student_id=${studentId}::uuid
            AND enrollment.class_section_id=notification.attention_class_section_id
            AND enrollment.is_active
        )
      )
    ` : sql``;

    const result = await sql<NotificationAttentionRow>`
      WITH ranked AS (
        SELECT notification.*,
          row_number() OVER (
            PARTITION BY notification.recipient_id, notification.attention_topic_key
            ORDER BY notification.attention_source_revision DESC,
              notification.created_at DESC, notification.id DESC
          ) AS attention_rank
        FROM notifications notification
        WHERE notification.recipient_id=${user.id}::uuid
          AND notification.attention_school_id=${scope.schoolId}::uuid
          AND notification.attention_eligible
          AND notification.attention_portal=${scope.portal}
      )
      SELECT notification.id,notification.link,notification.title,notification.body,notification.read_at,notification.created_at,
        notification.attention_module,notification.attention_source_kind,
        notification.attention_source_id,notification.attention_source_revision,
        notification.attention_student_id,notification.attention_class_section_id,
        CASE notification.attention_source_kind
          WHEN 'day_plan_publication' THEN (
            SELECT plan.date::text FROM day_plans plan
            WHERE plan.id=notification.attention_source_id
          )
          WHEN 'timetable_publication' THEN (
            SELECT version.starts_on::text FROM schedule_versions version
            WHERE version.id=notification.attention_source_id
          )
          WHEN 'calendar_change' THEN COALESCE(
            notification.metadata->>'date', notification.metadata->>'starts_on'
          )
          WHEN 'attendance_outcome' THEN (
            SELECT record.date::text FROM attendance_records record
            WHERE record.id=notification.attention_source_id
          )
          WHEN 'departure_request_decision' THEN (
            SELECT request.service_date::text FROM departure_change_requests request
            WHERE request.id=notification.attention_source_id
          )
          WHEN 'transport_trip_cancellation' THEN (
            SELECT trip.service_date::text FROM transport_trips trip
            WHERE trip.id=notification.attention_source_id
          )
          WHEN 'transport_rider_exception' THEN (
            SELECT trip.service_date::text FROM transport_trips trip
            WHERE trip.id=notification.attention_source_id
          )
          WHEN 'departure_handover_exception' THEN (
            SELECT plan.service_date::text FROM departure_plans plan
            WHERE plan.id=notification.attention_source_id
          )
          WHEN 'departure_plan_exception' THEN (
            SELECT plan.service_date::text FROM departure_plans plan
            WHERE plan.id=notification.attention_source_id
          )
          WHEN 'responsibility_offer' THEN (
            SELECT assignment.starts_on::text FROM staff_responsibility_assignments assignment
            WHERE assignment.id=notification.attention_source_id
          )
          WHEN 'responsibility_response' THEN (
            SELECT assignment.starts_on::text FROM staff_responsibility_assignments assignment
            WHERE assignment.id=notification.attention_source_id
          )
          WHEN 'responsibility_revocation' THEN (
            SELECT assignment.starts_on::text FROM staff_responsibility_assignments assignment
            WHERE assignment.id=notification.attention_source_id
          )
          WHEN 'coverage_offer' THEN (
            SELECT task.duty_date::text FROM staff_coverage_tasks task
            WHERE task.id=notification.attention_source_id
          )
          WHEN 'coverage_response' THEN (
            SELECT task.duty_date::text FROM staff_coverage_tasks task
            WHERE task.id=notification.attention_source_id
          )
          WHEN 'staff_leave_review' THEN (
            SELECT request.starts_on::text FROM staff_leave_requests request
            WHERE request.id=notification.attention_source_id
          )
          WHEN 'transport_swap' THEN (
            SELECT trip.service_date::text FROM transport_duty_swap_requests swap
            JOIN transport_trips trip ON trip.id=swap.requester_trip_id
            WHERE swap.id=notification.attention_source_id
          )
          WHEN 'transport_swap_approval' THEN (
            SELECT trip.service_date::text FROM transport_duty_swap_requests swap
            JOIN transport_trips trip ON trip.id=swap.requester_trip_id
            WHERE swap.id=notification.attention_source_id
          )
          WHEN 'transport_swap_response' THEN (
            SELECT trip.service_date::text FROM transport_duty_swap_requests swap
            JOIN transport_trips trip ON trip.id=swap.requester_trip_id
            WHERE swap.id=notification.attention_source_id
          )
          WHEN 'transport_swap_decision' THEN (
            SELECT trip.service_date::text FROM transport_duty_swap_requests swap
            JOIN transport_trips trip ON trip.id=swap.requester_trip_id
            WHERE swap.id=notification.attention_source_id
          )
          ELSE NULL
        END AS source_date,
        CASE notification.attention_source_kind
          WHEN 'assessment_publication' THEN (
            SELECT publication.assessment_id::text FROM assessment_publications publication
            WHERE publication.id=notification.attention_source_id
          )
          WHEN 'event_withdrawal' THEN (
            SELECT withdrawal.event_id::text FROM campus_event_participant_withdrawals withdrawal
            WHERE withdrawal.id=notification.attention_source_id
          )
          WHEN 'event_refund' THEN (
            SELECT refund.event_id::text FROM fee_refunds refund
            WHERE refund.id=notification.attention_source_id
          )
          WHEN 'fee_review_decision' THEN (
            SELECT decision.request_id::text FROM fee_review_decisions decision
            WHERE decision.id=notification.attention_source_id
          )
          ELSE NULL
        END AS aggregate_id,
        COALESCE(NULLIF(notification.metadata->>'attention_subject_label',''),CASE WHEN notification.attention_student_id IS NULL THEN NULL ELSE (
          SELECT trim(concat_ws(' ',person.first_name,person.last_name))
          FROM students student JOIN school_people person ON person.id=student.person_id
          WHERE student.id=notification.attention_student_id
        ) END) AS subject_label
      FROM ranked notification
      JOIN school_memberships membership
        ON membership.school_id=notification.attention_school_id
        AND membership.user_id=notification.recipient_id
        AND membership.role=${role}
        AND membership.is_active
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE notification.attention_rank=1
        AND (
          notification.read_at IS NULL
          OR notification.attention_source_kind IN (
            'transport_rider_exception','departure_handover_exception','departure_plan_exception',
            'responsibility_offer','coverage_offer','staff_leave_review','transport_swap','transport_swap_approval'
          )
        )
        ${parentScope}
        AND CASE
          WHEN notification.attention_source_kind='departure_plan_exception' THEN
            notification_departure_plan_exception_is_currently_authorized(
              notification.id,
              notification.recipient_id
            )
          WHEN notification.attention_source_kind IN (
            'responsibility_offer','responsibility_response','responsibility_revocation',
            'coverage_offer','coverage_response','staff_leave_review',
            'transport_swap','transport_swap_approval','transport_swap_response','transport_swap_decision'
          ) THEN notification_staff_workflow_is_currently_authorized(
            notification.id,
            notification.recipient_id
          )
          ELSE notification_attention_is_currently_authorized(
            notification.id,
            notification.recipient_id
          )
        END
        AND CASE notification.attention_source_kind
          WHEN 'student_leave_decision' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM leave_requests request
            JOIN students student ON student.id=request.student_id
            WHERE request.id=notification.attention_source_id
              AND request.student_id=notification.attention_student_id
              AND student.school_id=notification.attention_school_id
              AND request.status IN ('school_approved','school_rejected')
          )
          WHEN 'staff_leave_decision' THEN ${scope.portal === "teacher"} AND EXISTS (
            SELECT 1 FROM staff_leave_requests request
            JOIN staff_profiles profile ON profile.id=request.staff_profile_id
            WHERE request.id=notification.attention_source_id
              AND request.school_id=notification.attention_school_id
              AND request.status IN ('approved','rejected')
              AND profile.user_id=notification.recipient_id
          )
          WHEN 'assessment_publication' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM assessment_publications publication
            JOIN assessment_publication_results result ON result.publication_id=publication.id
            WHERE publication.id=notification.attention_source_id
              AND publication.school_id=notification.attention_school_id
              AND result.student_id=notification.attention_student_id
              AND publication.sequence=notification.attention_source_revision
              AND NOT EXISTS (
                SELECT 1 FROM assessment_publications newer
                JOIN assessment_publication_results newer_result ON newer_result.publication_id=newer.id
                WHERE newer.assessment_id=publication.assessment_id
                  AND newer.sequence>publication.sequence
                  AND newer_result.student_id=notification.attention_student_id
              )
          )
          WHEN 'report_publication' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM grading_report_batches batch
            JOIN grading_report_students report ON report.batch_id=batch.id
            WHERE batch.id=notification.attention_source_id
              AND batch.school_id=notification.attention_school_id
              AND batch.status='published'
              AND batch.sequence=notification.attention_source_revision
              AND report.student_id=notification.attention_student_id
              AND NOT EXISTS (
                SELECT 1 FROM grading_report_batches newer
                JOIN grading_report_students newer_report ON newer_report.batch_id=newer.id
                WHERE newer.scheme_id=batch.scheme_id
                  AND newer.status='published'
                  AND newer.sequence>batch.sequence
                  AND newer_report.student_id=notification.attention_student_id
              )
          )
          WHEN 'day_plan_publication' THEN EXISTS (
            SELECT 1 FROM day_plans plan
            WHERE plan.id=notification.attention_source_id
              AND plan.school_id=notification.attention_school_id
              AND plan.class_section_id=notification.attention_class_section_id
              AND plan.published_version=notification.attention_source_revision
              AND (
                ${scope.portal} <> 'teacher'
                OR staff_has_class_permission(
                  notification.attention_school_id,
                  notification.recipient_id,
                  'timetable.view',
                  plan.class_section_id,
                  plan.date
                )
              )
          )
          WHEN 'timetable_publication' THEN EXISTS (
            SELECT 1 FROM schedule_versions version
            WHERE version.id=notification.attention_source_id
              AND version.school_id=notification.attention_school_id
              AND version.class_section_id=notification.attention_class_section_id
              AND version.state='published'
              AND (
                ${scope.portal} <> 'teacher'
                OR staff_has_class_permission(
                  notification.attention_school_id,
                  notification.recipient_id,
                  'timetable.view',
                  version.class_section_id,
                  version.starts_on
                )
              )
          )
          WHEN 'calendar_change' THEN EXISTS (
            SELECT 1 FROM calendar_attention_topics topic
            WHERE topic.school_id=notification.attention_school_id
              AND topic.date=CASE
                WHEN COALESCE(
                  notification.metadata->>'date',notification.metadata->>'starts_on'
                ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN COALESCE(
                  notification.metadata->>'date',notification.metadata->>'starts_on'
                )::date
                ELSE NULL
              END
              AND topic.source_id=notification.attention_source_id
              AND topic.revision=notification.attention_source_revision
              AND topic.change_kind=COALESCE(
                NULLIF(notification.metadata->>'calendar_change_kind',''),
                CASE WHEN notification.link LIKE '%calendar_change_kind=removed%'
                  THEN 'removed' ELSE 'created' END
              )
          )
          WHEN 'attendance_outcome' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM attendance_records record
            JOIN students student ON student.id=record.student_id
            WHERE record.id=notification.attention_source_id
              AND record.student_id=notification.attention_student_id
              AND student.school_id=notification.attention_school_id
              AND record.revision=notification.attention_source_revision
              AND (record.status<>'present' OR notification.metadata->>'previous_status' IS NOT NULL)
          )
          WHEN 'event_cancellation' THEN EXISTS (
            SELECT 1 FROM campus_events event
            WHERE event.id=notification.attention_source_id
              AND event.school_id=notification.attention_school_id
              AND event.status='cancelled'
              AND event.revision=notification.attention_source_revision
              AND CASE ${scope.portal}
                WHEN 'parent' THEN EXISTS (
                  SELECT 1 FROM campus_event_participants participant
                  WHERE participant.event_id=event.id
                    AND participant.school_id=event.school_id
                    AND participant.student_id=notification.attention_student_id
                )
                WHEN 'teacher' THEN notification.attention_student_id IS NULL AND EXISTS (
                  SELECT 1 FROM staff_role_bindings binding
                  WHERE binding.school_id=event.school_id
                    AND binding.user_id=notification.recipient_id
                    AND binding.context_kind='event'
                    AND binding.scope_id=event.id
                    AND binding.role_active
                    AND (binding.source_kind='event_assignment' OR binding.status='active')
                    AND 'events.view'=ANY(binding.permissions)
                    AND binding.starts_on<=current_date
                    AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
                )
                WHEN 'principal' THEN notification.attention_student_id IS NULL
                ELSE false
              END
          )
          WHEN 'event_withdrawal' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM campus_event_participant_withdrawals withdrawal
            WHERE withdrawal.id=notification.attention_source_id
              AND withdrawal.school_id=notification.attention_school_id
              AND withdrawal.student_id=notification.attention_student_id
          )
          WHEN 'event_refund' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM fee_refunds refund
            WHERE refund.id=notification.attention_source_id
              AND refund.school_id=notification.attention_school_id
              AND refund.student_id=notification.attention_student_id
          )
          WHEN 'fee_review_decision' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM fee_review_decisions decision
            JOIN fee_review_requests request ON request.id=decision.request_id
              AND request.school_id=decision.school_id
            JOIN fee_invoices invoice ON invoice.id=request.invoice_id
              AND invoice.school_id=request.school_id
            WHERE decision.id=notification.attention_source_id
              AND decision.school_id=notification.attention_school_id
              AND request.submitted_by=notification.recipient_id
              AND invoice.student_id=notification.attention_student_id
          )
          WHEN 'guardian_leave_authority' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM guardian_leave_authority_commands command
            JOIN guardian_relationships relationship ON relationship.id=command.relationship_id
              AND relationship.school_id=command.school_id
            JOIN parents guardian ON guardian.id=relationship.guardian_id
            WHERE command.id=notification.attention_source_id
              AND command.school_id=notification.attention_school_id
              AND relationship.student_id=notification.attention_student_id
              AND relationship.authority_revision=notification.attention_source_revision
              AND guardian.user_id=notification.recipient_id
          )
          WHEN 'restricted_care_update' THEN ${scope.portal !== "parent"} AND EXISTS (
            SELECT 1 FROM restricted_care_cases care
            JOIN restricted_care_case_assignments assignment ON assignment.case_id=care.id
              AND assignment.school_id=care.school_id
            WHERE care.id=notification.attention_source_id
              AND care.school_id=notification.attention_school_id
              AND care.revision=notification.attention_source_revision
              AND assignment.user_id=notification.recipient_id
              AND assignment.revoked_at IS NULL
          )
          WHEN 'policy_publication' THEN ${scope.portal !== "principal"} AND EXISTS (
            SELECT 1 FROM institution_policy_versions version
            WHERE version.id=notification.attention_source_id
              AND version.school_id=notification.attention_school_id
              AND version.status='published'
              AND version.revision=notification.attention_source_revision
              AND CASE ${scope.portal}
                WHEN 'parent' THEN 'guardian'=ANY(version.audience_roles)
                WHEN 'teacher' THEN 'staff'=ANY(version.audience_roles)
                ELSE false
              END
          )
          WHEN 'departure_request_decision' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM departure_change_requests request
            WHERE request.id=notification.attention_source_id
              AND request.school_id=notification.attention_school_id
              AND request.student_id=notification.attention_student_id
              AND request.revision=notification.attention_source_revision
              AND request.status IN ('approved','rejected')
              AND (
                request.requester_user_id=notification.recipient_id
                OR EXISTS (
                  SELECT 1 FROM guardian_relationships relationship
                  JOIN parents guardian ON guardian.id=relationship.guardian_id
                  JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id
                    AND profile.guardian_id=relationship.guardian_id
                  WHERE relationship.school_id=request.school_id
                    AND relationship.student_id=request.student_id
                    AND guardian.user_id=notification.recipient_id
                    AND profile.person_id=request.requester_person_id
                )
              )
          )
          WHEN 'transport_trip_cancellation' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM transport_trips trip
            JOIN transport_trip_roster rider ON rider.trip_id=trip.id
            WHERE trip.id=notification.attention_source_id
              AND trip.school_id=notification.attention_school_id
              AND trip.state='cancelled'
              AND trip.revision=notification.attention_source_revision
              AND rider.student_id=notification.attention_student_id
          )
          WHEN 'transport_rider_exception' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM transport_trips trip
            JOIN transport_trip_roster rider ON rider.trip_id=trip.id
            WHERE trip.id=notification.attention_source_id
              AND trip.school_id=notification.attention_school_id
              AND rider.student_id=notification.attention_student_id
              AND rider.state='exception'
              AND rider.revision=notification.attention_source_revision
          )
          WHEN 'departure_handover_exception' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM departure_plans plan
            WHERE plan.id=notification.attention_source_id
              AND plan.school_id=notification.attention_school_id
              AND plan.student_id=notification.attention_student_id
              AND plan.is_current
              AND plan.state='exception'
              AND plan.revision=notification.attention_source_revision
          )
          WHEN 'departure_plan_exception' THEN ${scope.portal === "parent"} AND EXISTS (
            SELECT 1 FROM departure_plans plan
            WHERE plan.id=notification.attention_source_id
              AND plan.school_id=notification.attention_school_id
              AND plan.student_id=notification.attention_student_id
              AND plan.is_current
              AND plan.state='exception'
              AND plan.revision=notification.attention_source_revision
          )
          WHEN 'responsibility_offer' THEN ${scope.portal === "teacher"}
          WHEN 'responsibility_response' THEN ${scope.portal === "principal"}
          WHEN 'responsibility_revocation' THEN ${scope.portal === "teacher"}
          WHEN 'coverage_offer' THEN ${scope.portal === "teacher"}
          WHEN 'coverage_response' THEN ${scope.portal === "principal"}
          WHEN 'staff_leave_review' THEN ${scope.portal === "principal"}
          WHEN 'transport_swap' THEN ${scope.portal === "teacher"}
          WHEN 'transport_swap_approval' THEN ${scope.portal === "principal"}
          WHEN 'transport_swap_response' THEN ${scope.portal === "teacher"}
          WHEN 'transport_swap_decision' THEN ${scope.portal === "teacher"}
          ELSE false
        END
      ORDER BY notification.created_at DESC,notification.id DESC
    `.execute(this.db);

    return result.rows.map((row) => mapNotificationAttention(scope, row));
  }
}
