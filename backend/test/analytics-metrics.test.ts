import { describe, expect, it } from "vitest";
import { addCounts, attendanceMetric, attendanceTrend, emptyCounts } from "../src/analytics/analytics-metrics.js";

describe("analytics definitions", () => {
  it("weights late and half days and excludes excused records", () => {
    expect(attendanceMetric({ present: 5, late: 1, half_day: 1, absent: 1, excused: 2 }))
      .toMatchObject({ recorded: 10, denominator: 8, attended: 6.5, percentage: 81.25 });
  });
  it("distinguishes missing or entirely excused attendance from recorded absence", () => {
    expect(attendanceMetric(emptyCounts()).percentage).toBeNull();
    expect(attendanceMetric({ ...emptyCounts(), excused: 4 }).percentage).toBeNull();
    expect(attendanceMetric({ ...emptyCounts(), absent: 4 }).percentage).toBe(0);
  });
  it("aggregates denominators, not averages of class percentages", () => {
    const counts = emptyCounts();
    addCounts(counts, { ...emptyCounts(), present: 1 });
    addCounts(counts, { ...emptyCounts(), absent: 9 });
    expect(attendanceMetric(counts).percentage).toBe(10);
  });
  it("retains monthly gaps and bounds partial months, including leap dates", () => {
    const points = attendanceTrend([{ ...emptyCounts(), present: 2, date: "2024-02-29" }, { ...emptyCounts(), absent: 1, date: "2024-04-03" }], "2024-02-16", "2024-04-04", true);
    expect(points.map(p => [p.date, p.end, p.percentage])).toEqual([
      ["2024-02-16", "2024-02-29", 100], ["2024-03-01", "2024-03-31", null], ["2024-04-01", "2024-04-04", 0],
    ]);
  });
  it("uses consecutive seven-day buckets with a labelled partial final bucket", () => {
    expect(attendanceTrend([], "2026-09-30", "2026-10-08", false).map(p => [p.date, p.end, p.percentage]))
      .toEqual([["2026-09-30", "2026-10-06", null], ["2026-10-07", "2026-10-08", null]]);
  });
});
