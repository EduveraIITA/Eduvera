import { ConflictException, ForbiddenException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Transaction } from "kysely";
import { describe, expect, it, vi } from "vitest";
import {
  attendanceDeclineAttentionHref,
  attendanceRegisterRequestItems,
  collectorDutyAttentionHref,
  dayPlanAttentionHref,
  departurePlanAttentionHref,
  eventDutyAttentionHref,
  eventFinanceAttentionHref,
  eventSessionAttentionHref,
  governancePolicyAttentionHref,
  journeyAttentionHref,
  parentDiaryAttentionHref,
  parentEventAttentionHref,
  paymentCaptureAttentionHref,
  peopleImportAttentionHref,
  principalAttendanceExceptionItems,
  principalNoticeAttentionHref,
  safeguardingReportAttentionHref,
  scheduleDraftAttentionHref,
  staffAssignmentAttentionHref,
  sortRequestItems,
  summarizeRequestItems,
  teachingAssignmentAttentionHref,
  RequestsService,
} from "../src/requests/requests.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import type { GovernanceDecisionAuthorityPort } from "../src/governance/decision-authority.port.js";
import type { AttendanceClassWorkspace } from "../src/attendance/attendance-workspace.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";

function item(id: string, priority: RequestInboxItem["priority"], dueAt: string, category: RequestInboxItem["category"]): RequestInboxItem {
  return {
    id,
    kind: id,
    category,
    priority,
    title: id,
    detail: "",
    status_label: "Pending",
    action_label: "Review",
    href: "/",
    source_id: id,
    subject_label: null,
    occurs_at: null,
    due_at: dueAt,
    created_at: null,
  };
}

describe("request inbox projection", () => {
  it("shows transport duty approvals only to the exact configured decision owner", async () => {
    const transaction = {} as Transaction<Database>;
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const schoolId = "20000000-0000-4000-8000-000000000002";
    const assertDecisionAuthority = vi.fn().mockResolvedValue({});
    const authority = { assertDecisionAuthority } as unknown as GovernanceDecisionAuthorityPort;
    const service = new RequestsService({} as DatabaseService, authority);
    const probe = service as unknown as {
      canReviewTransportDutyChange(
        user: AuthUser,
        schoolId: string,
        transaction: Transaction<Database>,
      ): Promise<boolean>;
    };

    await expect(probe.canReviewTransportDutyChange({ id: ownerId } as AuthUser, schoolId, transaction))
      .resolves.toBe(true);
    expect(assertDecisionAuthority).toHaveBeenCalledWith(
      transaction,
      schoolId,
      "transport_duty_change_decision",
      ownerId,
      expect.any(Date),
    );

    assertDecisionAuthority.mockRejectedValueOnce(new ForbiddenException("Not the current owner."));
    await expect(probe.canReviewTransportDutyChange({ id: "30000000-0000-4000-8000-000000000003" } as AuthUser, schoolId, transaction))
      .resolves.toBe(false);

    assertDecisionAuthority.mockRejectedValueOnce(new ConflictException("No configured owner."));
    await expect(probe.canReviewTransportDutyChange({ id: ownerId } as AuthUser, schoolId, transaction))
      .resolves.toBe(false);

    const source = readFileSync(resolve(process.cwd(), "src/requests/requests.service.ts"), "utf8");
    expect(source).toContain("const canReviewTransportDutyChange = await this.canReviewTransportDutyChange(user, scope.school_id, transaction)");
    expect(source).toContain("AND ${canReviewTransportDutyChange}");
  });

  it("links a diary acknowledgement to its dated item", () => {
    expect(parentDiaryAttentionHref("student/1", "diary item", "2026-10-09"))
      .toBe("/parent/diary?student_id=student%2F1&date=2026-10-09&diary_item=diary%20item");
  });

  it.each(["rsvp", "consent", "payment", "checklist"] as const)(
    "links an event %s request to the exact action section",
    (focus) => {
      expect(parentEventAttentionHref("event/1", "student 1", focus))
        .toBe(`/parent/events/event%2F1?student_id=student%201&focus=${focus}`);
    },
  );

  it("opens principal notice exceptions in the attention recipient view", () => {
    expect(principalNoticeAttentionHref("notice/1"))
      .toBe("/principal/notices/notice%2F1?focus=attention");
    expect(safeguardingReportAttentionHref("teacher", "report/1"))
      .toBe("/teacher/safeguarding?section=message_reports&report=report%2F1");
  });

  it("deep-links each durable operational action to its exact workflow", () => {
    expect(eventSessionAttentionHref("teacher", "event/1", "session 1"))
      .toBe("/teacher/events/event%2F1/sessions/session%201/attendance");
    expect(eventFinanceAttentionHref("principal", "event/1"))
      .toBe("/principal/events/event%2F1?view=finance&focus=refunds");
    expect(eventDutyAttentionHref("teacher", "event/1"))
      .toBe("/teacher/events/event%2F1?focus=duty");
    expect(journeyAttentionHref("trip/1"))
      .toBe("/principal/departure/journeys/trip%2F1?focus=reconciliation");
    expect(peopleImportAttentionHref("principal", "school/1", "import 1"))
      .toBe("/principal/students/import?school=school%2F1&import=import%201");
    expect(governancePolicyAttentionHref("policy/1"))
      .toBe("/principal/governance?section=register&policy=policy%2F1");
    expect(dayPlanAttentionHref("school/1", "2026-10-13", "class 1", "plan 1"))
      .toBe("/principal/timetable/day?school=school%2F1&date=2026-10-13&class=class%201&plan=plan%201");
    expect(scheduleDraftAttentionHref("class/1", "term 1", "version 1"))
      .toBe("/principal/timetable/weekly?settings=pattern&class=class%2F1&term=term%201&version=version%201");
    expect(teachingAssignmentAttentionHref({ schoolId: "school/1", date: "2026-10-13", classSectionId: "class 1", termId: "term 1", weekday: 2, periodId: "period/1" }))
      .toBe("/principal/timetable/weekly?class=class%201&term=term%201&day=2&date=2026-10-13&period=period%2F1");
    expect(teachingAssignmentAttentionHref({ schoolId: "school/1", date: "2026-10-13", classSectionId: "class 1", termId: "term 1", weekday: 2, periodId: "period/1", dayPlanId: "plan 1" }))
      .toBe("/principal/timetable/day?school=school%2F1&date=2026-10-13&class=class%201&plan=plan%201&period=period%2F1");
    expect(staffAssignmentAttentionHref("profile/1", "assignment 1"))
      .toBe("/principal/staff/profile%2F1?assignment=assignment%201");
    expect(paymentCaptureAttentionHref("invoice/1", "order 1"))
      .toBe("/principal/fees?view=review&invoice=invoice%2F1&order=order%201");
    expect(collectorDutyAttentionHref("trip/1"))
      .toBe("/principal/departure?section=roster&trip=trip%2F1");
    expect(departurePlanAttentionHref("plan/1", "student 1", "2026-10-13"))
      .toBe("/principal/departure?section=pickup&date=2026-10-13&student=student%201&plan=plan%2F1");
    expect(attendanceDeclineAttentionHref("student/1", "2026-10-13", "class 1"))
      .toBe("/principal/insights/review/student%2F1?date=2026-10-13&insight_days=28&class=class%201&followup=missing");
  });

  it("projects only saved attendance with an authoritative schedule or assignment mismatch", () => {
    const base: AttendanceClassWorkspace = {
      class_section_id: "class-1", class_name: "Class 7A", grade: "7", section: "A", room_number: "204",
      term_id: "term-1", term_name: "Term 1", academic_year: "2026-27", starts_at: "09:00:00", ends_at: "09:45:00",
      periods_today: 1, student_count: 30, marked_count: 30, attending_count: 29, absent_count: 1,
      subjects: ["English"], assigned_teachers: ["Meera Kapoor"], assignment_kind: "regular",
      submission_status: "submitted", submitted_by_name: "Meera Kapoor", submitted_at: "2026-10-13T04:30:00.000Z",
      submission_authorized: true, instructional: true, date_open: true, can_mark: true, availability_reason: null,
    };
    const items = principalAttendanceExceptionItems("2026-10-13", [
      base,
      { ...base, class_section_id: "class-2", class_name: "Class 8A", submission_authorized: false },
      { ...base, class_section_id: "class-3", class_name: "Class 9A", instructional: false, submission_status: "in_progress" },
      { ...base, class_section_id: "class-4", class_name: "Class 10A", instructional: false, submission_status: "not_started", marked_count: 0 },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((entry) => [entry.source_id, entry.status_label, entry.href])).toEqual([
      ["class-2:term-1:2026-10-13", "Assignment mismatch", "/principal/attendance?class_section_id=class-2&date=2026-10-13"],
      ["class-3:term-1:2026-10-13", "Schedule mismatch", "/principal/attendance?class_section_id=class-3&date=2026-10-13"],
    ]);
  });

  it("keeps planned registers out of attention until the configured cutoff", () => {
    const register: AttendanceClassWorkspace = {
      class_section_id: "class-1", class_name: "Class 7A", grade: "7", section: "A", room_number: "204",
      term_id: "term-1", term_name: "Term 1", academic_year: "2026-27", starts_at: "09:00:00", ends_at: "09:45:00",
      periods_today: 1, student_count: 30, marked_count: 0, attending_count: 0, absent_count: 0,
      subjects: ["English"], assigned_teachers: ["Meera Kapoor"], assignment_kind: "regular",
      submission_status: "not_started", submitted_by_name: null, submitted_at: null,
      submission_authorized: true, instructional: true, date_open: true, can_mark: true, availability_reason: null,
    };

    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], false)).toEqual([]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], true, false)).toEqual([]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], true, true)).toMatchObject([
      { source_id: "class-1", kind: "attendance_register", status_label: "Not started", priority: "normal" },
    ]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [{ ...register, submission_status: "submitted" }], true)).toEqual([]);
  });

  it("stacks urgent work first and orders equal priorities by deadline", () => {
    const items = sortRequestItems([
      item("normal", "normal", "2026-10-10T12:00:00Z", "governance"),
      item("later-urgent", "urgent", "2026-10-10T12:00:00Z", "transport"),
      item("first-urgent", "urgent", "2026-10-09T12:00:00Z", "attendance"),
      item("high", "high", "2026-10-08T12:00:00Z", "leave"),
    ]);
    expect(items.map((entry) => entry.id)).toEqual(["first-urgent", "later-urgent", "high", "normal"]);
  });

  it("returns compact priority and category counts", () => {
    expect(summarizeRequestItems([
      item("one", "urgent", "2026-10-09T12:00:00Z", "transport"),
      item("two", "high", "2026-10-10T12:00:00Z", "transport"),
      item("three", "normal", "2026-10-11T12:00:00Z", "governance"),
    ])).toEqual({ total: 3, urgent: 1, high: 1, normal: 1, categories: { transport: 2, governance: 1 } });
  });
});
