import { describe, expect, it } from "vitest";
import { campusLabTimetableIndicator } from "./PrincipalTimetableDevelopmentRoute";
import type { CampusLabStatus } from "./api";

function status(schedule: CampusLabStatus["schedule"]): CampusLabStatus {
  return {
    status: "running", generated_at: "2026-10-16T12:00:00.000Z", started_at: "2026-10-16T11:00:00.000Z",
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    phase: { id: "period-1", label: "Period 1", description: "Mathematics", mode: "lesson", period_number: 1, next_change_at: "2026-10-16T12:00:30.000Z" },
    schedule, summary: { actors: 25, students: 24, staff: 1, zones: 1 }, zones: [], activity: [],
  };
}

describe("Campus Lab timetable projection", () => {
  it("maps the shared development snapshot into a neutral timetable indicator", () => {
    const indicator = campusLabTimetableIndicator(status({ reference_weekday: 3, reference_date: "2026-10-14", simulated_at: "2026-10-14T09:10:00+05:30", source: "effective_school_schedule", active_slot_ids: ["slot-1"], clock: { mode: "compressed_school_day", label: "One-hour Cambridge school day", duration_seconds: 3600 } }));
    expect(indicator).toMatchObject({ label: "One-hour Cambridge school day", referenceDate: "2026-10-14", simulatedAt: "2026-10-14T09:10:00+05:30", phaseMode: "lesson", activeSlotIds: ["slot-1"] });
  });

  it("does not expose a partial boot snapshot to timetable date logic", () => {
    expect(campusLabTimetableIndicator(status({ reference_weekday: null, reference_date: null, simulated_at: null, source: "effective_school_schedule", active_slot_ids: [] }))).toBeNull();
  });

  it("does not let a paused or closed simulator drive normal timetable state", () => {
    const schedule = { reference_weekday: 5, reference_date: "2026-10-16", simulated_at: "2026-10-16T18:30:00+05:30", source: "effective_school_schedule" as const, active_slot_ids: [] };
    const paused = status(schedule);
    paused.status = "paused";
    expect(campusLabTimetableIndicator(paused)).toBeNull();

    const closed = status(schedule);
    closed.phase = { ...closed.phase!, mode: "closed" };
    expect(campusLabTimetableIndicator(closed)).toBeNull();
  });
});
