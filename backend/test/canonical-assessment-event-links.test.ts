import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assessmentResultsHref,
  assessmentWorkHref,
  eventSessionAttendanceHref,
  eventWorkHref,
  relationshipEventHref,
} from "../src/workspace/canonical-application-links.js";

const migration = await readFile(
  new URL("../migrations/143_canonical_assessment_event_links.sql", import.meta.url),
  "utf8",
);

describe("canonical Assessment/Results and Events application links", () => {
  it("encodes exact responsibility and relationship destinations", () => {
    expect(assessmentWorkHref("assigned", "assessment/1", [["focus", "marking"]]))
      .toBe("/areas/assessments/assigned?assessment=assessment%2F1&focus=marking");
    expect(assessmentResultsHref("dependent", "student/1", [["publication_id", "publication/1"]]))
      .toBe("/areas/assessments/results?scope=dependent&student_id=student%2F1&publication_id=publication%2F1");
    expect(eventWorkHref("manage", "event/1", [["event_revision", 4]]))
      .toBe("/areas/events/manage/event%2F1?event_revision=4");
    expect(eventSessionAttendanceHref("assigned", "event/1", "session/1"))
      .toBe("/areas/events/assigned/event%2F1/sessions/session%2F1/attendance");
    expect(relationshipEventHref("self", "student/1", "event/1", [["focus", "status"]]))
      .toBe("/areas/events/calendar/event%2F1?scope=self&student_id=student%2F1&focus=status");
    expect(assessmentResultsHref("self", "student/1", [["scope", "dependent"], ["student_id", "other"]]))
      .toBe("/areas/assessments/results?scope=self&student_id=student%2F1");
  });

  it("repairs retained rows without inventing relationship scope from an account role", () => {
    expect(migration).toContain("guardian_relationships relationship");
    expect(migration).toContain("student.user_id=notification.recipient_id");
    expect(migration).toContain("relationship.student_id=(notification.metadata->>'student_id')::uuid");
    expect(migration).toContain("event.published_at IS NULL");
    expect(migration).toContain("does not retain per-recipient learner authority");
    expect(migration).toContain("message.state IN ('queued','delivered','acknowledged')");
    expect(migration).toContain("'/areas/assessments/assigned'");
    expect(migration).toContain("'/areas/assessments/manage'");
    expect(migration).toContain("'/areas/events/assigned'");
    expect(migration).toContain("'/areas/events/manage'");
    expect(migration).toContain("progressive_onboarding_goal_catalog");
    expect(migration).not.toMatch(/users\.role|recipient\.role/);
  });

  it("does not duplicate a legacy learner selector when preserving exact query context", () => {
    expect(migration).toContain("regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g')");
    expect(migration).toContain("'/register([?]|$)',E'/attendance\\\\1'");
  });
});
