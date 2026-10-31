import { describe, expect, it } from "vitest";
import { accommodationWork, assignmentWork, facilitiesWork, financeArrangementWork, hasNativeWorkflowProjection, resourceLoanWork } from "../src/workspace/workflow-work.projection.js";
import { mergeWorkItems } from "../src/workspace/workspace.service.js";
import type { LearningAssignmentWorkItem } from "../src/learning/learning-assignments.service.js";
import type { FinanceArrangementWorkRecord } from "../src/operations/finance-arrangements.read.js";

const now = new Date("2026-10-23T09:00:00Z");
const assignment: LearningAssignmentWorkItem = { id: "work-one", assignment_id: "assignment", student_id: "learner-one", attempt_id: "attempt-one",
  action: "review", stream: "needs_me", state: "action_required", title: "Programming practice", student_label: "Sana", reviewer_label: "Meera",
  owner_user_id: "teacher", message_id: "message-one", source_revision: 1, href: "/areas/messages/assignments?assignment=assignment&learner=learner-one",
  created_at: "2026-10-23T08:00:00Z", due_at: "2026-10-22T08:00:00Z" };
const finance: FinanceArrangementWorkRecord = { id: "request", invoice_id: "invoice", student_id: "learner-one", revision: 2,
  created_at: "2026-10-23T08:00:00Z", message_id: "fee-message", due_at: null, href: "/areas/fees/ledger?arrangement=request",
  title: "Instalment request · INV-1", reviewer: { user_id: "reviewer", label: "Imran" }, state: "review_needed" };

describe("native workflow Work projection", () => {
  it("keeps an accommodation offer distinct from a movement task and never infers occupancy or a stay deadline", () => {
    const item = { id: "stay-response", stay_id: "stay", revision: 2, title: "Aarav Sharma", detail: "Room 203",
      state: "review_needed" as const, href: "/areas/accommodation?stay_id=stay", created_at: now.toISOString(),
      due_at: null, message_id: "stay-message", owner: { user_id: "resident", label: "Resident" }, action: "respond" as const };
    const offer = accommodationWork(item, "needs_me"), waiting = accommodationWork(item, "waiting");
    expect(offer).toMatchObject({ kind: "offer", state: "action_required", due_at: null, urgency: "normal",
      source: { domain: "accommodation", kind: "accommodation_stay", id: "stay", action: "respond", revision: 2 },
      core_trace: { message_ids: ["stay-message"] }, title: "Aarav Sharma", detail: "Room 203", href: item.href });
    expect(waiting).toMatchObject({ direction: "waiting", status_label: "Waiting for Resident", source: { action: "await_respond" } });
    expect(accommodationWork({ ...item, action: "move_in" }, "needs_me"))
      .toMatchObject({ kind: "task", status_label: "Move-in to record", action_label: "Record move-in" });
    expect(accommodationWork({ ...item, action: "review_end" }, "needs_me"))
      .toMatchObject({ kind: "task", status_label: "Planned stay ended", action_label: "Review stay end", due_at: null, urgency: "normal" });
    expect(accommodationWork({ ...item, action: "coordinate" }, "needs_me"))
      .toMatchObject({ status_label: "Ready to close", action_label: "Close stay" });
    expect(accommodationWork({ ...item, action: "return_access" }, "needs_me"))
      .toMatchObject({ kind: "task", status_label: "Temporary access outstanding", due_at: null });
    expect(accommodationWork({ ...item, action: "recover", state: "needs_reassignment", message_id: null }, "needs_me"))
      .toMatchObject({ state: "needs_reassignment", tone: "attention", action_label: "Review routing" });
    expect(JSON.stringify(offer)).not.toMatch(/room_id|instructions|resident_person_id|planned_ends_at|actual_move/u);
    expect(hasNativeWorkflowProjection({ source_domain: "accommodation", reaction_kind: "accommodation_stay_response" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "accommodation", reaction_kind: "accommodation_stay_action" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "other", reaction_kind: "accommodation_stay_response" })).toBe(false);
  });
  it("keeps repair handling, verification and recovery source-backed without inventing an SLA", () => {
    const item = { id: "repair-handling", repair_id: "repair", revision: 4, title: "Repair to review",
      state: "review_needed" as const, href: "/areas/facilities?repair_id=repair", created_at: now.toISOString(),
      due_at: null, message_id: "repair-message", owner: { user_id: "handler", label: "Campus caretaker" }, action: "work" as const };
    const repair = facilitiesWork(item, "needs_me"), waiting = facilitiesWork(item, "waiting");
    expect(repair).toMatchObject({ kind: "task", state: "action_required", status_label: "Repair follow-up", urgency: "normal", due_at: null,
      href: item.href, source: { domain: "facilities", kind: "facility_repair", id: "repair", revision: 4, action: "work" },
      core_trace: { message_ids: ["repair-message"] } });
    expect(waiting).toMatchObject({ direction: "waiting", status_label: "Waiting for Campus caretaker", source: { action: "await_work" } });
    expect(mergeWorkItems([repair], [waiting])).toHaveLength(2);
    expect(facilitiesWork({ ...item, action: "verify" }, "needs_me")).toMatchObject({ kind: "request", action_label: "Check repair" });
    expect(facilitiesWork({ ...item, state: "needs_reassignment", action: "recover", message_id: null }, "needs_me"))
      .toMatchObject({ state: "needs_reassignment", tone: "attention", action_label: "Review routing" });
    expect(facilitiesWork({ ...item, state: "needs_reassignment" }, "waiting"))
      .toMatchObject({ state: "needs_reassignment", tone: "attention", status_label: "Repair routing needs review", action_label: "View repair" });
    expect(JSON.stringify(repair)).not.toMatch(/problem|photo|location_note|reporter_person_id/u);
    expect(hasNativeWorkflowProjection({ source_domain: "facilities", reaction_kind: "facilities_repair_handling" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "facilities", reaction_kind: "facilities_repair_verification" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "other", reaction_kind: "facilities_repair_verification" })).toBe(false);
  });
  it("keeps a borrowing question attached to its exact native source without exposing its private text", () => {
    const item = { id: "question", loan_id: "loan", question_id: "question", revision: 3,
      title: "Borrowing question · Camera", state: "review_needed" as const,
      href: "/areas/resources?loan_id=loan&question_id=question", created_at: now.toISOString(), due_at: null,
      message_id: "resource-message", reviewer: { user_id: "custodian", label: "Dev" } };
    const review = resourceLoanWork(item, "needs_me");
    expect(review).toMatchObject({ state: "action_required", urgency: "normal", due_at: null,
      href: item.href, source: { domain: "resource_loans", id: "question", revision: 3, action: "review" },
      core_trace: { message_ids: ["resource-message"] } });
    const waiting = resourceLoanWork({ ...item, state: "needs_reassignment", message_id: null }, "waiting");
    expect(waiting).toMatchObject({ direction: "waiting", tone: "attention", due_at: null, source: { action: "await_review" } });
    expect(waiting.core_trace).toBeUndefined();
    expect(JSON.stringify(review)).not.toMatch(/note|claimed_return_at|reporter_person_id/);
    expect(hasNativeWorkflowProjection({ source_domain: "resource_loans", reaction_kind: "resource_loan_question" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "another_domain", reaction_kind: "resource_loan_question" })).toBe(false);
  });
  it("retains each learner/attempt separately and keeps the exact handoff trace", () => {
    const one = assignmentWork(assignment, now, "Asia/Kolkata");
    const two = assignmentWork({ ...assignment, id: "work-two", student_id: "learner-two", attempt_id: "attempt-two" }, now, "Asia/Kolkata");
    expect(mergeWorkItems([one, two], [], "branch-one")).toHaveLength(2);
    expect(one.core_trace).toEqual({ message_ids: ["message-one"] });
    expect(one).toMatchObject({ due_at: null, urgency: "normal", source: { action: "review", revision: 1 } });
    expect(one.due_label).toBeUndefined();
  });
  it("uses the learner deadline only for their own work, not the reviewer or Waiting", () => {
    const revise = assignmentWork({ ...assignment, action: "revise", message_id: "revision-message" }, now, "Asia/Kolkata");
    expect(revise).toMatchObject({ urgency: "overdue", status_label: "Changes requested", due_at: assignment.due_at });
    const waiting = assignmentWork({ ...assignment, stream: "waiting", state: "needs_reassignment" }, now, "Asia/Kolkata");
    expect(waiting).toMatchObject({ direction: "waiting", urgency: "normal", due_at: null, owner: { label: "Meera" }, source: { action: "await_review" } });
    expect(waiting.status_label).toContain("needs reassignment");
    expect(assignmentWork({ ...assignment, stream: "waiting", state: "route_unavailable" }, now, "UTC"))
      .toMatchObject({ status_label: "Review route unavailable", direction: "waiting", urgency: "normal", tone: "attention", due_at: null });
  });
  it("does not duplicate a native obligation from its stale Core mirror", () => {
    for (const reaction_kind of ["learning_assignment_review", "learning_assignment_revision", "fee_instalment_review"]) {
      expect(hasNativeWorkflowProjection({ reaction_kind, source_domain: reaction_kind.startsWith("learning") ? "learning_assignments" : "finance" })).toBe(true);
      expect(hasNativeWorkflowProjection({ reaction_kind, source_domain: "another_domain" })).toBe(false);
    }
    expect(hasNativeWorkflowProjection({ reaction_kind: "staff_leave_decision_review", source_domain: "staff_operations" })).toBe(false);
  });
  it("retains neutral fee status and separates a sender's Waiting from a decision", () => {
    const decision = financeArrangementWork(finance, "needs_me", now, "Asia/Kolkata");
    const waiting = financeArrangementWork({ ...finance, state: "waiting_for_review" }, "waiting", now, "Asia/Kolkata");
    expect(mergeWorkItems([decision], [waiting])).toHaveLength(2);
    expect(waiting).toMatchObject({ urgency: "normal", due_at: null, status_label: "Waiting for Imran", source: { action: "await_decision" } });
    expect(decision).toMatchObject({ state: "action_required", source: { action: "decide" }, core_trace: { message_ids: ["fee-message"] } });
    expect(JSON.stringify(decision)).not.toMatch(/note|transaction_reference|schedule|bank/);
  });
  it("shows an expired review window truthfully without treating the invoice due date as a reviewer deadline", () => {
    const waiting = financeArrangementWork({ ...finance, state: "review_window_ended" }, "waiting", now, "UTC");
    expect(waiting).toMatchObject({ state: "review_window_ended", tone: "attention", due_at: null, urgency: "normal" });
    expect(waiting.status_label).toContain("Review window ended");
  });
});
