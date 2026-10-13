import { describe, expect, it } from "vitest";
import { academicReportUpdatedEvent } from "../src/academic-reports/academic-reports.service.js";
import { assessmentUpdatedEvent } from "../src/assessments/assessments.service.js";

describe("assessment and academic-report realtime contracts", () => {
  it("builds a scoped assessment invalidation with a revision-stable key", () => {
    const event = assessmentUpdatedEvent({
      schoolId: "school-1",
      assessmentId: "assessment-1",
      classSectionId: "class-1",
      action: "submit",
      status: "submitted",
      revision: 4,
      audienceUserIds: ["admin-1", "examiner-1", "moderator-1"],
    });

    expect(event).toMatchObject({
      eventType: "assessment.updated",
      aggregateType: "assessment",
      aggregateId: "assessment-1",
      audienceUserIds: ["admin-1", "examiner-1", "moderator-1"],
      idempotencyKey: "assessment:assessment-1:submit:4",
      payload: {
        assessment_id: "assessment-1",
        class_section_id: "class-1",
        action: "submit",
        status: "submitted",
        revision: 4,
        refresh: ["assessments", "teacher.home", "principal.home"],
      },
    });
  });

  it("refreshes the shared calendar only when assessment visibility changes", () => {
    const scheduled = assessmentUpdatedEvent({
      schoolId: "school-1",
      assessmentId: "assessment-1",
      classSectionId: "class-1",
      action: "schedule",
      status: "scheduled",
      revision: 2,
      audienceUserIds: ["admin-1", "examiner-1", "moderator-1"],
    });

    expect(scheduled.payload.refresh).toContain("calendar");
  });

  it("refreshes notifications when an assessment release reaches families", () => {
    const event = assessmentUpdatedEvent({
      schoolId: "school-1",
      assessmentId: "assessment-1",
      classSectionId: "class-1",
      action: "publish",
      status: "published",
      revision: 6,
      audienceUserIds: ["admin-1", "guardian-1"],
    });

    expect(event.payload.refresh).toContain("notifications");
    expect(event.idempotencyKey).toBe("assessment:assessment-1:publish:6");
  });

  it("builds report submission/review/release invalidations against the batch", () => {
    const generated = academicReportUpdatedEvent({
      schoolId: "school-1",
      batchId: "batch-1",
      schemeId: "scheme-1",
      classSectionId: "class-1",
      action: "generated",
      status: "draft",
      revision: 1,
      audienceUserIds: ["admin-1", "class-teacher-1"],
    });
    const published = academicReportUpdatedEvent({
      schoolId: "school-1",
      batchId: "batch-1",
      schemeId: "scheme-1",
      classSectionId: "class-1",
      action: "publish",
      status: "published",
      revision: 3,
      audienceUserIds: ["admin-1", "class-teacher-1", "guardian-1"],
    });

    expect(generated).toMatchObject({
      eventType: "academic_report.updated",
      aggregateType: "grading_report_batch",
      aggregateId: "batch-1",
      idempotencyKey: "academic-report:batch-1:generated:1",
      payload: {
        report_batch_id: "batch-1",
        scheme_id: "scheme-1",
        class_section_id: "class-1",
        action: "generated",
        status: "draft",
        revision: 1,
      },
    });
    expect(generated.payload.refresh).not.toContain("notifications");
    expect(published.payload.refresh).toContain("notifications");
    expect(published.idempotencyKey).toBe("academic-report:batch-1:publish:3");
  });
});
