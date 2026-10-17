import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TimetableRehearsalStrip } from "./TimetableRehearsalStrip";
import type { TimetableRehearsalIndicator } from "./rehearsal";

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

describe("TimetableRehearsalStrip", () => {
  it("labels translated timetable state as read-only", () => {
    render(<MemoryRouter><TimetableRehearsalStrip rehearsal={rehearsal} /></MemoryRouter>);
    expect(screen.getByLabelText(/simulated school day, read-only/i)).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByText(/9:10\s*am.*period 1/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /campus view/i })).not.toBeInTheDocument();
  });

  it("exposes Campus View only when the owning route opts in", () => {
    render(<MemoryRouter><TimetableRehearsalStrip rehearsal={rehearsal} showCampusLink /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /campus view/i })).toHaveAttribute("href", "/principal/campus");
  });
});
