import { describe, expect, it } from "vitest";
import { attendanceStartTime } from "./activityStartTime";

describe("attendance-first campus clock", () => {
  it("starts now in the campus timezone, not a hidden 9am session", () => {
    expect(attendanceStartTime(new Date("2026-10-20T12:32:28Z"), "Asia/Kolkata"))
      .toEqual({ date: "2026-10-20", start: "18:02", end: "19:02", endDayOffset: 0 });
  });
  it("shows the real campus date and explicit next-day end across midnight", () => {
    expect(attendanceStartTime(new Date("2026-10-20T18:15:00Z"), "Asia/Kolkata"))
      .toEqual({ date: "2026-10-20", start: "23:45", end: "00:45", endDayOffset: 1 });
    expect(attendanceStartTime(new Date("2026-10-20T23:30:00Z"), "Pacific/Auckland")).toMatchObject({ date: "2026-10-21" });
  });
  it("uses its supplied selected-world instant without reading the wall clock", () => {
    expect(attendanceStartTime(new Date("2031-03-02T00:00:00Z"), "UTC"))
      .toEqual({ date: "2031-03-02", start: "00:00", end: "01:00", endDayOffset: 0 });
  });
});
