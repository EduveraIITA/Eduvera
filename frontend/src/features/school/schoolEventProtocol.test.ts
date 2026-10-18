import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvalidationBatcher,
  FULL_SYNC_INVALIDATIONS,
  resolveSchoolEvent,
  SCHOOL_EVENT_TYPES,
  type SchoolEventType,
} from "./schoolEventProtocol";

function eventData(type: string, payload: Record<string, unknown>) {
  return JSON.stringify({
    id: "event-1",
    type,
    created_at: "2026-09-12T06:00:00.000Z",
    payload,
  });
}

afterEach(() => vi.useRealTimers());

describe("school event protocol", () => {
  it('refreshes gate desks and pending approval popups on visitor decisions',()=>{
    const resolution=resolveSchoolEvent(eventData('gate.visitor.updated',{refresh:['gate','notifications']}),'gate.visitor.updated','host');
    expect(resolution.usedFallback).toBe(false);
    expect(resolution.invalidations).toEqual(expect.arrayContaining([{queryKey:['gate']},{queryKey:['gate-admin']},{queryKey:['gate-approvals']},{queryKey:['notifications','host']}]));
  });
  it('refreshes gate desks when a staff boundary movement is recorded',()=>{
    const resolution=resolveSchoolEvent(eventData('gate.movement.updated',{refresh:['gate']}),'gate.movement.updated','gatekeeper');
    expect(resolution.invalidations).toEqual(expect.arrayContaining([{queryKey:['gate']}]));
  });
  it("subscribes to every current attention-producing custom event name", () => {
    expect(SCHOOL_EVENT_TYPES).toEqual(expect.arrayContaining([
      "staff.responsibility.offered",
      "staff.responsibility.active",
      "staff.responsibility.accepted",
      "staff.responsibility.declined",
      "staff.leave.submitted",
      "staff.leave.approved",
      "staff.leave.rejected",
      "staff.leave.withdrawn",
      "staff.coverage.offered",
      "staff.coverage.accepted",
      "staff.coverage.declined",
      "governance.policy.submitted",
      "governance.policy.published",
      "governance.policy.rejected",
      "governance.policy.acknowledged",
      "restricted_care.case.opened",
      "restricted_care.case.reassigned",
      "restricted_care.case.triage",
      "restricted_care.case.active",
      "restricted_care.case.closed",
      "restricted_care.case.entry_added",
      "restricted_care.reporting.assessed",
      "restricted_care.external_report.recorded",
      "assessment.updated",
      "academic_report.updated",
      "teacher_feedback.updated",
    ]));
  });

  it.each(["transport.updated","departure.updated"])("refreshes every departure view on %s without an unknown-event fallback",type=>{
    const result=resolveSchoolEvent(eventData(type,{refresh:["departure","parent.home","principal.home","teacher.home"]}),type,"guardian-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({queryKey:["departure"]});
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({queryKey:["departure"]});
  });
  it("refreshes enrollment and family lists on a people event", () => {
    const result=resolveSchoolEvent(eventData("people.updated",{student_id:"new-student",class_section_id:"class-7a"}),"people.updated","admin-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([{queryKey:["school","people"]},{queryKey:["school","parent"]},{queryKey:["teacher-attendance","class-7a"]},{queryKey:["attention"]}]));
  });
  it("maps allowlisted refresh hints to the affected student, parent, operations, and notification caches", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.updated", {
        student_id: "student-1",
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: [
          "student.home",
          "student.attendance",
          "student.eligibility",
          "parent.home",
          "parent.attendance",
          "teacher.attendance",
          "teacher.home",
          "principal.home",
          "principal.attendance",
          "principal.attendance-history",
          "notifications",
        ],
      }),
      "attendance.updated",
      "user-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "student", "attendance"] },
      { queryKey: ["school", "parent", "attendance", "student-1"] },
      { queryKey: ["school", "parent", "attendance", "default"] },
      { queryKey: ["teacher-attendance", "class-7a", "2026-09-12"] },
      { queryKey: ["principal-register", "class-7a", "2026-09-12"] },
      { queryKey: ["principal-register-history", "class-7a", "2026-09-12"] },
      { queryKey: ["notifications", "user-1"] },
    ]));
  });

  it("maps the register lifecycle producer contract to teacher and principal register caches", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.register.submitted", {
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: [
          "teacher.attendance",
          "teacher.home",
          "principal.home",
          "principal.attendance",
          "principal.attendance-history",
        ],
      }),
      "attendance.register.submitted",
      "principal-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["teacher-attendance", "class-7a", "2026-09-12"] },
      { queryKey: ["teacher-home", "2026-09-12"] },
      { queryKey: ["principal-home", "2026-09-12"] },
      { queryKey: ["principal-register", "class-7a", "2026-09-12"] },
      { queryKey: ["principal-register-history", "class-7a", "2026-09-12"] },
    ]));
  });

  it("maps an overdue register alert to the responsible operations views and notifications", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.register.overdue", {
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "notifications"],
      }),
      "attendance.register.overdue",
      "teacher-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["teacher-home", "2026-09-12"] },
      { queryKey: ["teacher-attendance", "class-7a", "2026-09-12"] },
      { queryKey: ["principal-home", "2026-09-12"] },
      { queryKey: ["principal-register", "class-7a", "2026-09-12"] },
      { queryKey: ["notifications", "teacher-1"] },
    ]));
  });

  it("uses event defaults when a valid envelope omits refresh hints", () => {
    const access=resolveSchoolEvent(eventData("staff.access.updated",{}),"staff.access.updated","teacher-1");
    expect(access.usedFallback).toBe(false);
    expect(access.invalidations).toContainEqual({queryKey:["staff-operations"]});
    const leave = resolveSchoolEvent(eventData("leave.updated", { student_id: "student-1" }), "leave.updated", "guardian-1");
    expect(leave.usedFallback).toBe(false);
    expect(leave.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "student", "leave"] },
      { queryKey: ["school", "parent", "leave", "student-1"] },
      { queryKey: ["notifications", "guardian-1"] },
    ]));
  });

  it.each<Array<[SchoolEventType, string]>>([
    ["staff.leave.submitted", "staff-operations"],
    ["governance.policy.published", "governance"],
    ["restricted_care.case.opened", "restricted-care"],
    ["assessment.updated", "assessments"],
    ["academic_report.updated", "academic-reports"],
    ["teacher_feedback.updated", "teacher-feedback"],
    ["InstitutionActivated", "institution-activation"],
  ])("accepts the %s producer contract and refreshes its canonical domain", (type, domainRoot) => {
    const result = resolveSchoolEvent(eventData(type, {}), type, "user-1");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: [domainRoot] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("accepts the staff leave producer's legacy refresh aliases without falling back", () => {
    const result = resolveSchoolEvent(eventData("staff.leave.approved", {
      refresh: ["principal.staff", "teacher.leave", "principal.timetable"],
    }), "staff.leave.approved", "user-1");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["staff-operations"] },
      { queryKey: ["principal-timetable"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("removes completed diary actions from linked family home caches", () => {
    const result = resolveSchoolEvent(
      eventData("diary.updated", { student_id: "student-1" }),
      "diary.updated",
      "guardian-1",
    );
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["school", "student", "home"] },
      { queryKey: ["school", "student", "diary"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["school", "parent", "home", "default"] },
      { queryKey: ["school", "parent", "diary", "student-1"] },
      { queryKey: ["school", "parent", "diary", "default"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("refreshes the administration catalog and dependent timetable after a catalog edit", () => {
    const result = resolveSchoolEvent(
      eventData("administration.updated", { refresh: ["principal.administration", "principal.timetable"] }),
      "administration.updated",
      "principal-1",
    );
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["office", "administration"] },
      { queryKey: ["principal-timetable"] },
      { queryKey: ["analytics"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it.each([
    "not json",
    eventData("attendance.updated", { refresh: ["untrusted.cache"] }),
    eventData("leave.updated", { student_id: 12 }),
  ])("falls back to a safe full sync for malformed or untrusted data", (data) => {
    const result = resolveSchoolEvent(data, "attendance.updated", "user-1");
    expect(result.usedFallback).toBe(true);
    expect(result.invalidations).toEqual(FULL_SYNC_INVALIDATIONS);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["principal-register-history"] },
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
    ]));
  });

  it("coalesces repeated invalidations into one 75ms batch", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const batcher = createInvalidationBatcher(queryClient, 75);

    batcher.enqueue([{ queryKey: ["school", "student", "attendance"] }]);
    batcher.enqueue([
      { queryKey: ["school", "student", "attendance"] },
      { queryKey: ["notifications", "user-1"] },
    ]);

    await vi.advanceTimersByTimeAsync(74);
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["school", "student", "attendance"], exact: undefined });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications", "user-1"], exact: undefined });
  });
  it("refreshes the follow-up inbox without refreshing unrelated school screens", () => {
    const result = resolveSchoolEvent(eventData("coordination.updated", { student_id: "student-1", refresh: ["coordination"] }), "coordination.updated", "guardian-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["school", "coordination"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("refreshes event lists, details, registers and notifications for campus event updates", () => {
    const result = resolveSchoolEvent(
      eventData("campus_event.updated", { student_id: "student-1" }),
      "campus_event.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["school", "student", "home"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["school", "parent", "home", "default"] },
      { queryKey: ["teacher-home"] },
      { queryKey: ["principal-home"] },
      { queryKey: ["principal-insights"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("refreshes the exact notice, Requests, bell and shared attention projection", () => {
    const result = resolveSchoolEvent(
      eventData("notice.updated", {
        student_id: "student-1",
        refresh: ["notices", "requests", "notifications", "parent.home"],
      }),
      "notice.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["notices"] },
      { queryKey: ["notice"] },
      { queryKey: ["requests"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("refreshes conversations, notifications and shared request projections for a chat update", () => {
    const result = resolveSchoolEvent(
      eventData("chat.updated", { refresh: ["messages", "notifications", "attention"] }),
      "chat.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["chat"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["attention"] },
      { queryKey: ["requests"] },
    ]);
  });
});
