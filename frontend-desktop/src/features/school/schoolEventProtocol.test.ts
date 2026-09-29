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
    created_at: "2026-09-13T06:00:00.000Z",
    payload,
  });
}

afterEach(() => vi.useRealTimers());

describe("desktop school event protocol", () => {
  it("scopes attendance refreshes to the changed class, date, student, and notification caches", () => {
    const result = resolveSchoolEvent(eventData("attendance.updated", {
      student_id: "student-1",
      class_section_id: "class-7a",
      date: "2026-09-13",
      refresh: [
        "student.attendance",
        "parent.attendance",
        "teacher.attendance",
        "teacher.home",
        "principal.home",
        "principal.attendance",
        "notifications",
      ],
    }), "attendance.updated");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["student-attendance"] },
      { queryKey: ["parent-attendance", "student-1"] },
      { queryKey: ["parent-attendance", null], exact: true },
      { queryKey: ["register", "class-7a", "2026-09-13"] },
      { queryKey: ["teacher-home", "2026-09-13"] },
      { queryKey: ["principal-home", "2026-09-13"] },
      { queryKey: ["notifications"] },
    ]));
  });

  it("refreshes the staff leave queue in addition to role-specific leave and home views", () => {
    const result = resolveSchoolEvent(eventData("leave.updated", {
      student_id: "student-1",
      refresh: ["student.leave", "parent.leave", "teacher.home", "principal.home", "notifications"],
    }), "leave.updated");

    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["student-leave"] },
      { queryKey: ["parent-leaves", "student-1"] },
      { queryKey: ["leaves"] },
      { queryKey: ["teacher-home"] },
      { queryKey: ["principal-home"] },
    ]));
  });

  it("rejects untrusted refresh keys and falls back to a bounded full cache sync", () => {
    const result = resolveSchoolEvent(eventData("attendance.updated", {
      refresh: ["untrusted.cache"],
    }), "attendance.updated");

    expect(result.usedFallback).toBe(true);
    expect(result.invalidations).toEqual(FULL_SYNC_INVALIDATIONS);
  });

  it("coalesces duplicate invalidations from a burst", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const batcher = createInvalidationBatcher(queryClient, 75);

    batcher.enqueue([{ queryKey: ["register", "class-7a", "2026-09-13"] }]);
    batcher.enqueue([
      { queryKey: ["register", "class-7a", "2026-09-13"] },
      { queryKey: ["notifications"] },
    ]);

    await vi.advanceTimersByTimeAsync(75);
    expect(invalidate).toHaveBeenCalledTimes(2);
    batcher.cancel();
  });

  it("refreshes event finance and the fee ledger after a campus-event finance update", () => {
    const result = resolveSchoolEvent(eventData("campus_event.updated", {
      event_id: "event-1",
      change_kind: "refund_recorded",
      refresh: ["campus-events", "notifications"],
    }), "campus_event.updated");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["fees"] },
      { queryKey: ["notifications"] },
    ]));
  });

  it("includes campus-event and fee caches in full-sync recovery", () => {
    const result = resolveSchoolEvent("not-json", "campus_event.updated");

    expect(result.usedFallback).toBe(true);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["fees"] },
    ]));
  });
});
