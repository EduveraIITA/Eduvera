import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { CampusMapPanel } from "./CampusMapPanel";
import type { CampusViewSpace } from "./types";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

const room: CampusViewSpace = {
  id: "room-401",
  campus_id: "campus-1",
  parent_space_id: null,
  floor_id: "floor-4",
  floor_label: "Fourth floor",
  name: "Classroom 401",
  code: "401",
  kind: "classroom",
  capacity: 40,
  assertions: {
    accepted: [],
    observed: [],
    expected: [{
      id: "exam-1",
      dimension: "expected",
      label: "Mid-term examination",
      source_label: "Scheduled examination",
      freshness: "not_applicable",
      count: 25,
    }],
  },
  expected_now: [{
    id: "slot-1",
    occurrence_id: "class-6a:2026-10-17:1",
    space_id: "room-401",
    title: "Mathematics",
    slot_type: "class",
    class_label: "Class 6A",
    subject_label: "Mathematics",
    teacher: { id: "teacher-1", label: "Kavita Mehta" },
    expected_count: 25,
    starts_at: "2026-10-17T03:30:00.000Z",
    ends_at: "2026-10-17T04:15:00.000Z",
    state: "in_progress",
    dimension: "expected",
    spatial_claim: "expected_context_only",
    source: { label: "Published timetable", domain: "timetable", record_id: "schedule-1", revision: 2 },
  }],
  day_activity_count: 1,
  gate_activity_today: null,
  state_dimension: "expected",
  signal_count: 0,
};

describe("CampusMapPanel room capacity summary", () => {
  it("exposes the representative planned/unconfirmed meaning outside the canvas", () => {
    render(<MemoryRouter><CampusMapPanel
      mode="spaces"
      spaces={[room]}
      zones={[]}
      activity={[]}
      formatTime={() => "9:00 AM"}
      formatClock={() => "9:00 AM"}
      returnFocus={null}
      onSelectSpace={() => undefined}
      onClose={() => undefined}
    /></MemoryRouter>);

    expect(screen.getByText("25 expected · 40 seats")).toBeInTheDocument();
    expect(screen.getByText(/representative pattern is a plan, not physical occupancy/i)).toBeInTheDocument();
    expect(screen.getByText("Expected: Kavita Mehta")).toBeInTheDocument();
    expect(screen.queryByText(/25 occupied/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /classroom 401/i })).toBeInTheDocument();
  });

  it("discloses the bounded activity list instead of silently hiding records", () => {
    const activity = Array.from({ length: 31 }, (_, index) => ({
      id: `activity-${index + 1}`,
      occurred_at: "2026-10-17T04:15:00.000Z",
      title: `Activity ${index + 1}`,
      detail: "Published timetable context",
      state_dimension: "expected" as const,
      source_label: "Published timetable",
      state: "ended" as const,
      spatial_claim: "expected_context_only" as const,
    }));

    render(<MemoryRouter><CampusMapPanel
      mode="activity"
      spaces={[]}
      zones={[]}
      activity={activity}
      formatTime={() => "9:00 AM"}
      formatClock={() => "9:00 AM"}
      returnFocus={null}
      onSelectSpace={() => undefined}
      onClose={() => undefined}
    /></MemoryRouter>);

    expect(screen.getByText("Showing 30 of 31 current and recent activity records.")).toBeInTheDocument();
    expect(screen.getByText("Activity 30")).toBeInTheDocument();
    expect(screen.queryByText("Activity 31")).not.toBeInTheDocument();
  });

  it("shows the published day timetable without mixing in recorded activity", () => {
    render(<MemoryRouter><CampusMapPanel
      mode="timetable"
      spaces={[]}
      zones={[]}
      activity={[
        {
          id: "period-1",
          occurred_at: "2026-10-17T03:30:00.000Z",
          ends_at: "2026-10-17T04:15:00.000Z",
          title: "Mathematics · Class 6A",
          detail: "Classroom 401 · Kavita Mehta expected",
          state_dimension: "expected",
          source_label: "Published timetable",
          state: "in_progress",
          spatial_claim: "expected_context_only",
          target_path: "/principal/timetable",
        },
        {
          id: "gate-point-1",
          occurred_at: "2026-10-17T03:32:00.000Z",
          title: "Gate check-in accepted",
          detail: "Main gate",
          state_dimension: "accepted",
          source_label: "Gate register",
          state: "point_event",
          spatial_claim: "point_observation_only",
        },
      ]}
      formatTime={() => "17 Oct, 9:00 AM"}
      formatClock={(date) => date.getUTCMinutes() === 30 ? "9:00 AM" : "9:45 AM"}
      returnFocus={null}
      onSelectSpace={() => undefined}
      onClose={() => undefined}
    /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Today's timetable" })).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("to 9:45 AM")).toBeInTheDocument();
    expect(screen.getByText("Mathematics · Class 6A")).toBeInTheDocument();
    expect(screen.getByText(/expectations, not proof of physical presence/i)).toBeInTheDocument();
    expect(screen.queryByText("Gate check-in accepted")).not.toBeInTheDocument();
  });
});
