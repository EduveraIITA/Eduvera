/**
 * Query state that identifies a record, workflow, or attention delivery for one
 * learner. These values must not be carried to another learner when a guardian
 * changes the active child. List presentation state is intentionally left
 * alone, so dates, filters, tabs, and views remain stable.
 */
const learnerTargetKeys = [
  "assessment",
  "assessment_id",
  "assignment",
  "assignment_revision",
  "attendance_record_id",
  "attendance_revision",
  "attention_notification_id",
  "authority_change_id",
  "authority_revision",
  "batch",
  "calendar_change_id",
  "calendar_change_kind",
  "calendar_record_revision",
  "calendar_revision",
  "campaign",
  "case",
  "case_revision",
  "clarify",
  "conversation",
  "coverage",
  "coverage_revision",
  "decision",
  "diary_item",
  "edit",
  "event_revision",
  "focus",
  "followup",
  "guardian",
  "invoice",
  "leave_id",
  "plan",
  "plan_id",
  "plan_revision",
  "publication_id",
  "question",
  "receipt",
  "refund_id",
  "report",
  "report_batch_id",
  "request",
  "request_id",
  "request_revision",
  "review",
  "review_case",
  "rider_revision",
  "schedule_id",
  "schedule_revision",
  "student",
  "student_key",
  "swap",
  "swap_revision",
  "trip",
  "trip_id",
  "trip_revision",
  "withdrawal_id",
] as const;
/** Build the URL search state for an explicit guardian child switch. */
export function searchForStudentContext(
  current: URLSearchParams | string,
  studentId: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("student_id", studentId);
  learnerTargetKeys.forEach((key) => next.delete(key));
  return next;
}
