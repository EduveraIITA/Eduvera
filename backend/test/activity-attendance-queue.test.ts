import { describe, expect, it } from "vitest";
import { attendanceQueueSchema, type ActivityAttendanceSummary } from "../src/attendance/activity-attendance.contracts.js";
import { composeAttendanceQueue } from "../src/attendance/activity-attendance-queue.js";

const now = new Date("2026-10-20T12:00:00Z");
const row = (index: number, patch: Partial<ActivityAttendanceSummary> = {}): ActivityAttendanceSummary => ({
  id: String(index), occurrence_id: String(index), title: `Activity ${index}`, kind: index % 2 ? "duty" : "training",
  starts_at: "2026-10-20T09:00:00Z", ends_at: "2026-10-20T10:00:00Z", time_zone: "UTC", place_label: "North campus",
  state: "draft", revision: 0, participant_count: 2, recorded_count: 0, can_record: true, can_review: false,
  availability_reason: null, source_kind: "activity", ...patch,
});

describe("complete authorized attendance queue composition", () => {
  it("counts and filters forty records before slicing an eight-record page", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i));
    const result = composeAttendanceQueue(rows, attendanceQueueSchema.parse({ page_size: 8 }), now);
    expect(result.counts).toEqual({ all: 40, needs_recording: 40, awaiting_review: 0, automatic_pending: 0, upcoming: 0, completed: 0, cancelled: 0 });
    expect(result.available_kinds).toEqual([{ kind: "duty", count: 20 }, { kind: "training", count: 20 }]);
    expect(result.items.slice(0, 8)).toHaveLength(8);
    const match = composeAttendanceQueue(rows, attendanceQueueSchema.parse({ search: "Activity 39", page_size: 8 }), now);
    expect(match.items.map(item => item.id)).toEqual(["39"]);
    expect(match.counts.all).toBe(1);
    const duties = composeAttendanceQueue(rows, attendanceQueueSchema.parse({ kind: "duty", page_size: 8 }), now);
    expect(duties.items).toHaveLength(20);
    expect(duties.counts.all).toBe(20);
    expect(duties.available_kinds).toHaveLength(2);
  });

  it("keeps missed, read-only and cancelled records visible in All without inventing attendance", () => {
    const rows = [row(1, { starts_at: "2026-10-20T15:00:00Z" }), row(2, { can_record: false, availability_reason: "Assigned to another person." }),
      row(3, { state: "submitted", recorded_count: 2 }), row(4, { occurrence_state: "cancelled", can_record: false }), row(5, { state: "locked" })];
    const result = composeAttendanceQueue(rows, attendanceQueueSchema.parse({}), now);
    expect(result.counts).toEqual({ all: 5, needs_recording: 1, awaiting_review: 1, automatic_pending: 0, upcoming: 1, completed: 1, cancelled: 1 });
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({ id: "2", can_record: false, recorded_count: 0 });
    expect(result.items.at(-1)).toMatchObject({ id: "4", queue_category: "cancelled" });
    expect(composeAttendanceQueue(rows, attendanceQueueSchema.parse({ view: "completed" }), now).items.map(item => item.state)).toEqual(["locked"]);
    expect(composeAttendanceQueue(rows, attendanceQueueSchema.parse({ view: "awaiting_review" }), now).items.map(item => item.state)).toEqual(["submitted"]);
    expect(rows[1]).not.toHaveProperty("queue_category");
  });

  it("uses the supplied selected-world clock and rejects untrusted filter shapes", () => {
    expect(composeAttendanceQueue([row(1)], attendanceQueueSchema.parse({}), new Date("2026-10-20T08:00:00Z")).counts.upcoming).toBe(1);
    expect(composeAttendanceQueue([row(1)], attendanceQueueSchema.parse({}), now).counts.needs_recording).toBe(1);
    for (const input of [{ view: "students" }, { search: ["forged"] }, { kind: "x".repeat(61) }, { search: "x".repeat(121) }, { page_size: 51 }]) {
      expect(attendanceQueueSchema.safeParse(input).success).toBe(false);
    }
  });

  it("separates scheduled automation from required review without declaring either final", () => {
    const scheduled_at = "2026-10-20T12:10:00Z";
    const rows = [row(1, { state: "submitted", finalization: { state: "automatic_pending", reason: "scheduled", scheduled_at } }),
      ...(["overdue", "policy_changed", "manual"] as const).map((reason, i) => row(i + 2,
        { state: "submitted", finalization: { state: "review_required", reason, scheduled_at } }))];
    const result = composeAttendanceQueue(rows, attendanceQueueSchema.parse({}), now);
    expect(result.counts).toMatchObject({ automatic_pending: 1, awaiting_review: 3, completed: 0, needs_recording: 0 });
    expect(composeAttendanceQueue(rows, attendanceQueueSchema.parse({ view: "automatic_pending" }), now).items)
      .toMatchObject([{ id: "1", state: "submitted", queue_category: "automatic_pending" }]);
    expect(composeAttendanceQueue(rows, attendanceQueueSchema.parse({ view: "completed" }), now).items).toEqual([]);
  });
});
