import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FamilyScheduleAgenda } from "./FamilyScheduleAgenda";
import type { TimetableDay } from "../../pages/student/student-timetable-data";

describe("FamilyScheduleAgenda", () => {
  it("shows full lesson details and preserves cancelled periods without claiming their materials are needed", () => {
    const day: TimetableDay = { key: "wed", date: 7, shortLabel: "Wed", longLabel: "Wednesday", meta: "", periods: [
      { id: "p1", period: "P1", subject: "Computer Science", teacher: "Ritu Malhotra", room: "Lab 2", time: "9:00 AM", endTime: "9:45 AM", materials: ["Lab manual"], tone: "lab" },
      { id: "p2", period: "P2", subject: "Mathematics", time: "9:50 AM", cancelled: true, materials: ["Ruler"], tone: "math" },
    ] };
    const onOpen = vi.fn();
    render(<FamilyScheduleAgenda days={[day]} currentPeriodId="p1" onOpen={onOpen} />);
    expect(screen.getByRole("list", { name: "Day periods" })).toBeVisible();
    expect(screen.getByText("Ritu Malhotra")).toBeVisible();
    expect(screen.getByText("Bring: Lab manual")).toBeVisible();
    expect(screen.getByText("Now")).toBeVisible();
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.queryByText(/Ruler/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Computer Science, Wednesday P1/ }));
    expect(onOpen).toHaveBeenCalledWith({ day, period: day.periods[0] });
  });
});
