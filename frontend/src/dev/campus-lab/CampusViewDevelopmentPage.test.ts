import { describe, expect, it } from "vitest";
import type { CampusLabStatus } from "./api";
import { campusLabViewOverlay } from "./CampusViewDevelopmentPage";

function pausedStatus(): CampusLabStatus {
  return {
    status: "paused",
    generated_at: "2026-10-16T13:00:00.000Z",
    started_at: "2026-10-16T03:00:00.000Z",
    school: { id: "school-1", name: "Cambridge International School", code: "cis" },
    phase: {
      id: "after-hours",
      label: "After school hours",
      description: "The simulator is paused until the next school day.",
      mode: "closed",
      next_change_at: "2026-10-19T03:00:00.000Z",
    },
    schedule: {
      reference_weekday: 5,
      reference_date: "2026-10-16",
      simulated_at: "2026-10-16T18:30:00+05:30",
      source: "effective_school_schedule",
      active_slot_ids: [],
    },
    summary: { actors: 0, students: 0, staff: 0, zones: 0 },
    zones: [{
      id: "space:room-201",
      space_id: "room-201",
      label: "Classroom 201",
      kind: "classroom",
      activity: "Mathematics",
      actors: [{ id: "student-1", name: "Aarav", role: "student" }],
    }],
    activity: [],
  };
}

describe("Campus Lab Campus View overlay", () => {
  it("shows the paused phase without projecting simulated people", () => {
    const overlay = campusLabViewOverlay(pausedStatus());
    expect(overlay).toMatchObject({ status: "paused", badge_label: "After school hours", zones: [] });
  });
});
