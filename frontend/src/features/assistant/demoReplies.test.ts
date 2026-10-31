import { describe, expect, it } from "vitest";
import { demoReply } from "./demoReplies";

describe("demo assistant canonical assessment and event destinations", () => {
  it("keeps an exact dependent relationship when it is already known", () => {
    expect(demoReply("Show assessment results", {
      portal: "parent",
      pageTitle: "Assistant",
      studentId: "student-1",
    }).link?.to).toBe("/areas/assessments/results?scope=dependent&student_id=student-1");
    expect(demoReply("Open the school event", {
      portal: "parent",
      pageTitle: "Assistant",
      studentId: "student-1",
    }).link?.to).toBe("/areas/events/calendar?scope=dependent&student_id=student-1");
  });

  it("uses responsibility surfaces for staff without manufacturing a learner scope", () => {
    expect(demoReply("Open assessments", {
      portal: "teacher",
      pageTitle: "Assistant",
      permissions: ["assessments.view"],
    }).link?.to).toBe("/areas/assessments/assigned");
    expect(demoReply("Open events", {
      portal: "principal",
      pageTitle: "Assistant",
    }).link?.to).toBe("/areas/events/manage");
  });
});
