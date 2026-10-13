import { describe, expect, it } from "vitest";
import type { StudentTimetableResponse } from "./api";
import { readParentDiaryAttentionTarget, resolveParentTimetableAttention } from "./ParentLiveRoutes";

const timetable = {
  student: { id: "student-1" },
  selected_date: "2026-10-13",
  day_plan: { id: "plan-1", date: "2026-10-13", version: 3 },
  schedule_source: { id: "schedule-1", revision: 5 },
} as StudentTimetableResponse;

describe("parent diary attention navigation", () => {
  it("keeps the item identity together with the date needed to load it", () => {
    const target = readParentDiaryAttentionTarget(new URLSearchParams(
      "student_id=student-1&date=2026-10-09&diary_item=diary-42",
    ));

    expect(target).toEqual({ date: "2026-10-09", itemId: "diary-42" });
  });
});

describe("parent timetable attention navigation", () => {
  it("proves the child, date, day plan and durable revision", () => {
    const params = new URLSearchParams("attention_notification_id=notice-1&student_id=student-1&date=2026-10-13&day_plan_id=plan-1&day_plan_revision=3");
    expect(resolveParentTimetableAttention(params, timetable)).toBe("exact");
  });

  it("proves the repeating schedule source and durable revision", () => {
    const params = new URLSearchParams("attention_notification_id=notice-1&student_id=student-1&date=2026-10-13&schedule_id=schedule-1&schedule_revision=5");
    expect(resolveParentTimetableAttention(params, timetable)).toBe("exact");
  });

  it("keeps a stale or incomplete target unread", () => {
    expect(resolveParentTimetableAttention(new URLSearchParams("attention_notification_id=notice-1&student_id=student-1&date=2026-10-13&schedule_id=schedule-1&schedule_revision=4"), timetable)).toBe("stale");
    expect(resolveParentTimetableAttention(new URLSearchParams("attention_notification_id=notice-1&student_id=student-1&date=2026-10-13"), timetable)).toBe("stale");
  });
});
