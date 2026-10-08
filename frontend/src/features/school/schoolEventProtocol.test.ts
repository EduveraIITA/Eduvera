import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvalidationBatcher,
  FULL_SYNC_INVALIDATIONS,
  resolveSchoolEvent,
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
  it("refreshes enrollment and family lists on a people event", () => {
    const result=resolveSchoolEvent(eventData("people.updated",{student_id:"new-student",class_section_id:"class-7a"}),"people.updated","admin-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([{queryKey:["school","people"]},{queryKey:["school","parent"]},{queryKey:["teacher-attendance","class-7a"]}]));
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
    expect(result.invalidations).toEqual([{ queryKey: ["school", "coordination"] }]);
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
    ]);
  });
});
