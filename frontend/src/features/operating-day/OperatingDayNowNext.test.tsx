import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { OperatingDayProjection } from "../operations/api";
import { OperatingDayNowNext } from "./OperatingDayNowNext";

afterEach(cleanup);

const day: OperatingDayProjection = {
  schema_version: 1,
  environment: { kind: "simulation", label: "Simulation", namespace_id: "scenario:s:run:r" },
  institution: { id: "school-1", name: "Cambridge International School", timezone: "Asia/Kolkata" },
  viewer: { role: "admin", agent_id: "agent-1" },
  date: "2026-10-17", as_of: "2026-10-17T04:30:00.000Z",
  summary: { scheduled_sessions: 6, completed_sessions: 2, current_sessions: 1, upcoming_sessions: 3, registers_expected: 4, registers_submitted: 2, registers_in_progress: 1, registers_not_started: 1, gate_entries: 184, gate_exits: 3 },
  now: [{
    id: "session-1", occurrence_id: "occurrence-1", period_number: 3, class_section_id: "class-1",
    class_label: "Class 6A", subject_label: "Science", space_label: "Classroom 201",
    teacher: { agent_id: "agent-1", label: "Kavita Mehta" }, title: "Science", slot_type: "class",
    starts_at: "2026-10-17T04:20:00.000Z", ends_at: "2026-10-17T05:05:00.000Z", state: "in_progress",
    attendance: { register_id: "register-1", state: "in_progress", revision: 2, marked_count: 12, expected_count: 25, submitted_at: null },
    source: { domain: "timetable", record_id: "slot-1", revision: 3, change_kind: "published" },
    target_path: "/teacher/attendance?class_section_id=class-1&date=2026-10-17",
  }], next: [], sessions: [], contradictions: [{
    id: "signal-1", kind: "expected_after_exit", student_id: "student-1", student_label: "Aarav",
    explanation: "Exit before a later class", gate_observed_at: "2026-10-17T04:00:00.000Z",
    expected_from: "2026-10-17T04:20:00.000Z", expected_until: "2026-10-17T05:05:00.000Z",
    attendance_status: null,
  }],
  freshness: { schedule: "current", attendance: "authoritative", gate: "accepted_points" },
};

describe("OperatingDayNowNext", () => {
  it("shows the selected environment and connected current-day evidence", () => {
    render(<MemoryRouter><OperatingDayNowNext day={day} showCampus /></MemoryRouter>);
    expect(screen.getByText("Simulation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Happening now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Science/ })).toHaveAttribute("href", day.now[0]!.target_path);
    expect(screen.getByText("184 in · 3 out")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cross-check needs review/ })).toHaveAttribute("href", "/principal/campus?panel=activity");
  });
});
