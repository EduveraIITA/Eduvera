import type { LearningAssignmentWorkItem } from "../learning/learning-assignments.service.js";
import type { FinanceArrangementWorkRecord } from "../operations/finance-arrangements.read.js";
import type { NativeFeeReviewWorkRecord } from "../operations/native-fee-reviews.contracts.js";
import type { OwnedMessageProjection, WorkspaceWorkRecord } from "./workspace.contracts.js";
import type { ResourceLoanWorkRecord } from "../resource-loans/resource-loans.contracts.js";
import type { FacilitiesWorkRecord } from "../facilities/facilities.contracts.js";
import type { AccommodationWorkRecord } from "../facilities/accommodation/accommodation.contracts.js";
import type { DiningWorkRecord } from "../dining/dining.contracts.js";
import type { VisitQuestionWorkRecord } from "../gate/visit-sharing.contracts.js";

// These workflows own their current obligations and retain the exact Core trace.
// A queued protocol mirror cannot outlive a native closure or confer new access.
export function hasNativeWorkflowProjection(message: Pick<OwnedMessageProjection, "reaction_kind" | "source_domain">): boolean {
  return message.source_domain === "learning_assignments" && ["learning_assignment_review", "learning_assignment_revision"].includes(message.reaction_kind)
    || message.source_domain === "finance" && ["fee_instalment_review", "finance_payment_review"].includes(message.reaction_kind)
    || message.source_domain === "resource_loans" && message.reaction_kind === "resource_loan_question"
    || message.source_domain === "facilities" && ["facilities_repair_handling", "facilities_repair_verification"].includes(message.reaction_kind)
    || message.source_domain === "accommodation" && ["accommodation_stay_response", "accommodation_stay_action"].includes(message.reaction_kind)
    || message.source_domain === "dining" && ["dining_session_action", "dining_issue_action"].includes(message.reaction_kind)
    || message.source_domain === "gate" && message.reaction_kind === "gate_visit_question";
}

export function visitQuestionWork(item: VisitQuestionWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  const recovery = item.state === "needs_reassignment";
  return { id: `visit-question:${direction}:${item.id}`, kind: "request", direction,
    state: recovery ? "needs_reassignment" : direction === "needs_me" ? "action_required" : "waiting_for_review",
    urgency: "normal", title: item.title,
    status_label: recovery ? "Question contact unavailable" : direction === "waiting" ? `Waiting for ${item.owner.label}` : "Visit question to answer",
    href: item.href, action_label: recovery ? "Review question owner" : direction === "needs_me" ? "Answer question" : "View question",
    source_label: "Visits", source: { domain: "gate", kind: "gate_visit_question", id: item.id,
      action: direction === "waiting" ? "await_reply" : item.action, revision: item.revision },
    owner: item.owner, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: null, created_at: item.created_at, tone: recovery ? "attention" : "neutral" };
}

export function diningWork(item: DiningWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  const unavailable = item.state === "needs_reassignment" || item.state === "route_unavailable";
  return { id: `dining:${direction}:${item.id}`, kind: "task", direction,
    state: item.state === "needs_reassignment" ? "needs_reassignment" : item.state === "route_unavailable" ? "route_unavailable"
      : direction === "needs_me" ? "action_required" : "waiting_for_review",
    urgency: "normal", title: item.title,
    status_label: unavailable ? "Dining routing needs review" : direction === "waiting" ? `Waiting for ${item.owner.label}`
      : item.action === "resolve" ? "Service issue to resolve" : item.action === "publish" ? "Menu to publish" : "Service follow-up",
    href: item.href, action_label: direction === "waiting" ? "View service" : item.action === "recover" ? "Review routing"
      : item.action === "resolve" ? "Review issue" : item.action === "publish" ? "Review menu" : "Open service",
    source_label: "Dining", source: { domain: "dining", kind: item.source_kind, id: item.source_id,
      action: direction === "waiting" ? `await_${item.action}` : item.action, revision: item.revision },
    owner: item.owner, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: item.due_at, created_at: item.created_at, tone: unavailable ? "attention" : "neutral" };
}

export function accommodationWork(item: AccommodationWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  const unavailable = item.state === "needs_reassignment" || item.state === "route_unavailable";
  return { id: `accommodation-stay:${direction}:${item.id}`, kind: item.action === "respond" ? "offer" : "task", direction,
    state: item.state === "needs_reassignment" ? "needs_reassignment" : item.state === "route_unavailable" ? "route_unavailable"
      : direction === "needs_me" ? "action_required" : "waiting_for_review",
    urgency: "normal", title: item.title, ...(item.detail ? { detail: item.detail } : {}),
    status_label: unavailable ? "Accommodation routing needs review" : direction === "waiting" ? `Waiting for ${item.owner.label}`
      : item.action === "respond" ? "Accommodation to review" : item.action === "move_in" ? "Move-in to record"
        : item.action === "review_end" ? "Planned stay ended"
          : item.action === "return_access" ? "Temporary access outstanding" : "Ready to close",
    href: item.href, action_label: direction === "waiting" ? "View stay" : item.action === "recover" ? "Review routing"
      : item.action === "respond" ? "Review offer" : item.action === "move_in" ? "Record move-in"
        : item.action === "review_end" ? "Review stay end" : item.action === "coordinate" ? "Close stay" : "Open stay",
    source_label: "Accommodation", source: { domain: "accommodation", kind: "accommodation_stay", id: item.stay_id,
      action: direction === "waiting" ? `await_${item.action}` : item.action, revision: item.revision },
    owner: item.owner, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: item.due_at, created_at: item.created_at, tone: unavailable ? "attention" : "neutral" };
}

export function facilitiesWork(item: FacilitiesWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  const recovery = item.action === "recover";
  const unavailable = item.state === "needs_reassignment" || item.state === "route_unavailable";
  const verifying = item.action === "verify";
  return { id: `facility-repair:${direction}:${item.id}`, kind: verifying ? "request" : item.action === "accept" ? "offer" : "task", direction,
    state: item.state === "needs_reassignment" ? "needs_reassignment" : item.state === "route_unavailable" ? "route_unavailable"
      : direction === "needs_me" ? "action_required" : "waiting_for_review",
    urgency: "normal", title: item.title,
    status_label: unavailable ? "Repair routing needs review"
      : direction === "waiting" ? `Waiting for ${item.owner.label}`
        : verifying ? "Repair ready to check" : item.action === "accept" ? "Repair to accept" : "Repair follow-up",
    href: item.href, action_label: recovery ? "Review routing" : direction === "waiting" ? "View repair" : verifying ? "Check repair" : item.action === "accept" ? "Accept repair" : "Open repair",
    source_label: "Repairs", source: { domain: "facilities", kind: "facility_repair", id: item.repair_id,
      action: direction === "waiting" ? `await_${item.action}` : item.action, revision: item.revision },
    owner: item.owner, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: item.due_at, created_at: item.created_at, tone: unavailable ? "attention" : "neutral" };
}

export function resourceLoanWork(item: ResourceLoanWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  return { id: `resource-loan-question:${direction}:${item.id}`, kind: "request", direction,
    state: item.state === "review_needed" ? "action_required" : item.state, urgency: "normal", title: item.title,
    status_label: item.state === "review_needed" ? "Borrowing question to review"
      : item.state === "needs_reassignment" ? "Custodian access changed — follow up"
      : item.state === "route_unavailable" ? "Review delivery unavailable" : `Waiting for ${item.reviewer.label}`,
    href: item.href, action_label: direction === "needs_me" ? "Review question" : "View question", source_label: "Resources",
    source: { domain: "resource_loans", kind: "resource_loan_question", id: item.question_id,
      action: direction === "needs_me" ? "review" : "await_review", revision: item.revision },
    owner: item.reviewer, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: null, created_at: item.created_at,
    tone: item.state === "needs_reassignment" || item.state === "route_unavailable" ? "attention" : "neutral" };
}

export function nativeFeeReviewWork(item: NativeFeeReviewWorkRecord, direction: "needs_me" | "waiting"): WorkspaceWorkRecord {
  return { id: `native-fee-review:${direction}:${item.id}`, kind: "request", direction,
    state: item.state === "review_needed" ? "action_required" : item.state, urgency: "normal", title: item.title,
    status_label: item.state === "review_needed" ? item.kind === "payment" ? "Payment to verify" : "Fee question to answer"
      : item.state === "needs_reassignment" ? "Reviewer changed — withdraw and resend"
      : item.state === "route_unavailable" ? "Review delivery unavailable"
      : item.state === "access_ended" ? "Account access ended — withdraw pending review"
      : `Waiting for ${item.reviewer.label}`,
    href: item.href, action_label: direction === "waiting" ? "View review" : item.kind === "payment" ? "Verify payment" : "Answer question",
    source_label: "Fees", source: { domain: "finance", kind: "fee_payment_review", id: item.id, action: direction === "waiting" ? "await_decision" : "decide", revision: item.revision },
    owner: item.reviewer, ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}), due_at: null, created_at: item.created_at,
    tone: direction === "waiting" && item.state !== "waiting_for_review" ? "attention" : "neutral" };
}

function deadline(value: string | null, at: Date, timeZone: string) {
  const remaining = value ? Date.parse(value) - at.getTime() : Number.POSITIVE_INFINITY;
  const urgency = remaining < 0 ? "overdue" as const : remaining <= 2 * 60 * 60 * 1000 ? "due_soon" as const : "normal" as const;
  return { urgency, ...(value ? { due_label: `Due ${new Intl.DateTimeFormat("en", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value))}` } : {}) };
}

export function assignmentWork(item: LearningAssignmentWorkItem, at: Date, timeZone: string): WorkspaceWorkRecord {
  const waiting = item.stream === "waiting";
  const due = deadline(waiting || item.action === "review" ? null : item.due_at, at, timeZone);
  return { id: item.id, kind: "task", direction: item.stream, state: item.state, ...due,
    title: item.title, detail: item.student_label,
    status_label: item.state === "needs_reassignment" ? "Review route changed — needs reassignment"
      : item.state === "route_unavailable" ? "Review route unavailable"
      : waiting ? `Waiting for ${item.reviewer_label}` : item.action === "review" ? "Submission to review" : item.action === "revise" ? "Changes requested" : "Ready to work on",
    href: item.href, action_label: waiting ? "View submission" : item.action === "review" ? "Review submission" : "Open assignment",
    source_label: "Assignments", source: { domain: "learning_assignments", kind: "individual_assignment_work",
      id: `${item.assignment_id}:${item.student_id}:${item.attempt_id ?? "initial"}`, action: waiting ? "await_review" : item.action, revision: item.source_revision },
    ...(waiting ? { owner: { user_id: item.owner_user_id, label: item.reviewer_label } } : {}),
    ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: waiting || item.action === "review" ? null : item.due_at, created_at: item.created_at,
    tone: item.state === "needs_reassignment" || item.state === "route_unavailable" || due.urgency === "due_soon" ? "attention" : due.urgency === "overdue" ? "critical" : "neutral" };
}

export function financeArrangementWork(item: FinanceArrangementWorkRecord, direction: "needs_me" | "waiting", at: Date, timeZone: string): WorkspaceWorkRecord {
  const due = deadline(item.due_at, at, timeZone);
  return { id: `fee-instalment:${direction}:${item.id}`, kind: "request", direction,
    state: item.state === "review_needed" ? "action_required" : item.state, ...due,
    title: item.title,
    status_label: item.state === "review_needed" ? "Payment plan to review"
      : item.state === "needs_reassignment" ? "Review route changed — needs reassignment"
      : item.state === "route_unavailable" ? "Review route unavailable"
      : item.state === "review_window_ended" ? "Review window ended — follow up"
      : `Waiting for ${item.reviewer?.label ?? "review"}`,
    href: item.href, action_label: direction === "waiting" ? "View request" : "Review payment plan", source_label: "Fees",
    source: { domain: "finance", kind: "fee_instalment_request", id: item.id, action: direction === "waiting" ? "await_decision" : "decide", revision: item.revision },
    ...(item.reviewer ? { owner: item.reviewer } : {}), ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
    due_at: item.due_at, created_at: item.created_at,
    tone: direction === "waiting" && item.state !== "waiting_for_review" || due.urgency === "due_soon" ? "attention" : due.urgency === "overdue" ? "critical" : "neutral" };
}
