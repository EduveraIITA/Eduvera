import { describe, expect, it } from "vitest";
import { searchForStudentContext } from "./studentContextSearch";

describe("searchForStudentContext", () => {
  it("keeps harmless list context when a guardian changes child", () => {
    const next = searchForStudentContext(
      "student_id=child-a&view=past&filter=unpaid&date=2026-10-13&period=30&tab=apply&status=open&layout=list",
      "child-b",
    );

    expect(next.toString()).toBe(
      "student_id=child-b&view=past&filter=unpaid&date=2026-10-13&period=30&tab=apply&status=open&layout=list",
    );
  });

  it("removes record, revision, workflow, and attention targets from the prior child", () => {
    const next = searchForStudentContext(new URLSearchParams({
      student_id: "child-a",
      attention_notification_id: "notification-1",
      focus: "status",
      assessment_id: "assessment-1",
      publication_id: "publication-1",
      report_batch_id: "report-1",
      event_revision: "4",
      withdrawal_id: "withdrawal-1",
      refund_id: "refund-1",
      invoice: "invoice-1",
      receipt: "receipt-1",
      review: "review-1",
      decision: "decision-1",
      conversation: "conversation-1",
      request_id: "request-1",
      request_revision: "2",
      trip_id: "trip-1",
      trip_revision: "3",
      rider_revision: "5",
      plan_id: "plan-1",
      plan_revision: "6",
      calendar_change_id: "calendar-1",
      calendar_revision: "7",
      diary_item: "diary-1",
      leave_id: "leave-1",
      date: "2026-10-13",
      view: "month",
    }), "child-b");

    expect(Object.fromEntries(next)).toEqual({
      student_id: "child-b",
      date: "2026-10-13",
      view: "month",
    });
  });
});
