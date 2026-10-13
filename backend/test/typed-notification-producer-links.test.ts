import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(...parts: string[]) {
  return readFileSync(join(process.cwd(), "src", ...parts), "utf8");
}

describe("typed notification producer links", () => {
  it("persists exact assessment and report publication destinations for bell navigation", () => {
    const assessments = source("assessments", "assessments.service.ts");
    const reports = source("academic-reports", "academic-reports.service.ts");

    expect(assessments).toContain(
      "`/parent/results?student_id=${recipient.student_id}&assessment_id=${assessmentId}&publication_id=${publication.id}`",
    );
    expect(reports).toContain(
      "`/parent/results?student_id=${recipient.student_id}&report_batch_id=${batchId}`",
    );
  });

  it("persists the exact published day-plan or timetable source and revision", () => {
    const dayPlans = source("day-plans", "events.ts");
    const schedules = source("schedule-planning", "schedule-planning.service.ts");

    for (const parameter of ["day_plan_id=", "day_plan_revision="]) {
      expect(dayPlans).toContain(parameter);
    }
    for (const parameter of ["school=", "date=", "class=", "schedule_id=", "schedule_revision="]) {
      expect(schedules).toContain(parameter);
    }
    expect(schedules).toContain("CASE WHEN recipient.portal<>'student' THEN ${publishedRevision} END");
  });

  it("persists exact attendance, leave and calendar outcome targets", () => {
    const events = source("school", "school-event.service.ts");
    const school = source("school", "school.service.ts");

    for (const parameter of ["date=${input.date}", "attendance_record_id=${record.id}", "attendance_revision=${record.revision ?? 1}"]) {
      expect(events).toContain(parameter);
    }
    expect(school).toContain("&tab=history`");
    for (const parameter of [
      "calendar_change_id=", "calendar_change_kind=created", "calendar_change_kind=removed",
      "calendar_revision=", "calendar_record_revision=",
    ]) expect(school).toContain(parameter);
  });

  it("persists exact family event, fee, authority, care, policy and transport targets", () => {
    const campusEvents = source("campus-events", "campus-events.service.ts");
    const finance = source("campus-events", "campus-event-finance.service.ts");
    const feeReview = source("operations", "fee-review.service.ts");
    const authority = source("people", "guardian-authority.service.ts");
    const care = source("restricted-care", "restricted-care.service.ts");
    const governance = source("governance", "governance.service.ts");
    const departure = source("departure-coordination", "departure-coordination.service.ts");

    expect(campusEvents).toContain("&focus=status&event_revision=${event.revision}");
    expect(finance).toContain('&focus=payment&${source.kind === "event_withdrawal" ? "withdrawal_id" : "refund_id"}=${source.id}');
    expect(feeReview).toContain("&view=reviews&review=${id}&decision=${decision.id}");
    expect(authority).toContain("&authority_change_id=${command.id}&authority_revision=${result.revision}");
    expect(care).toContain("&case=${caseId}&case_revision=${revision}");
    expect(governance).toContain("admin_link: `/principal/governance?section=register&policy=${current.family_id}`");
    expect(governance).toContain("?policy=${versionId}&policy_revision=${published.revision}");
    for (const parameter of ["request_revision=", "trip_revision=", "rider_revision=", "plan_revision="]) {
      expect(departure).toContain(parameter);
    }
    expect(departure).toContain("LEFT JOIN guardian_school_profiles profile");
    expect(departure).toContain("parent.user_id=${request.requester_user_id}::uuid OR profile.person_id=${request.requester_person_id}::uuid");
  });
});
