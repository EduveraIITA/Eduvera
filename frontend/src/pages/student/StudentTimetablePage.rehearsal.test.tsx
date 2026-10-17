import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StudentTimetablePage } from "./StudentTimetablePage";
import type { TimetableRehearsalIndicator } from "../../features/planner/rehearsal";
import type { TimetableDay } from "./student-timetable-data";

vi.mock("./StudentShell", () => ({
  StudentShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../parent/ParentShell", () => ({
  ParentShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../features/timetable/TimetableNavigator", () => ({
  TimetableNavigator: () => <nav aria-label="Timetable navigator" />,
}));

const rehearsal: TimetableRehearsalIndicator = {
  label: "Simulated school day",
  status: "running",
  referenceDate: "2026-10-14",
  simulatedAt: "2026-10-14T09:10:00+05:30",
  phaseLabel: "Period 1",
  phaseMode: "lesson",
  nextChangeAt: null,
  activeSlotIds: ["slot-1"],
  timeZone: "Asia/Kolkata",
  campusPath: "/principal/campus",
};

const days: TimetableDay[] = [{
  key: "wed",
  shortLabel: "WED",
  longLabel: "Wednesday",
  date: 14,
  isoDate: "2026-10-14",
  meta: "2 periods",
  periods: [
    { id: "slot-1", period: "P1", time: "09:00 AM", endTime: "09:45 AM", subject: "Mathematics", tone: "math" },
    { id: "slot-2", period: "P2", time: "09:50 AM", endTime: "10:35 AM", subject: "Science", tone: "science" },
  ],
}];

describe("StudentTimetablePage rehearsal clock", () => {
  it("shows the same read-only simulated now and bell calculation", () => {
    render(<MemoryRouter><StudentTimetablePage
      rehearsal={rehearsal}
      selectedDate="2026-10-14"
      onDateChange={vi.fn()}
      onViewChange={vi.fn()}
      className="Class 6A"
      studentName="Test Student"
      termLabel="Term 1"
      days={days}
    /></MemoryRouter>);

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByLabelText("Simulated school day bell status")).toHaveTextContent("35 mins");
    expect(screen.getByText("Rehearsal now")).toBeInTheDocument();
  });
});
