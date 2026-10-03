import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayActivities, type TodayActivityPeriod } from "./TodayActivities";

const periods: TodayActivityPeriod[] = [
  { id: "math", period: 1, subject: "Mathematics", startsAt: "9:00 AM", endsAt: "9:45 AM", teacher: "Kavita Mehta", room: "Room 204", state: "current", progressPercent: 42, subjectIcon: "calculator", subjectColor: "#1d4ed8" },
  { id: "science", period: 2, subject: "General Science", startsAt: "9:50 AM", endsAt: "10:35 AM", teacher: "Arjun Shah", room: "Lab 2", state: "upcoming", subjectIcon: "flask-conical", subjectColor: "#0f766e" },
];

afterEach(cleanup);

describe("TodayActivities", () => {
  it("renders contextual subject icons and schedule progress", () => {
    render(<TodayActivities periods={periods} onOpenTimetable={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Today's activities" })).toBeVisible();
    expect(document.querySelector('[data-subject-icon="calculator"]')).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Mathematics: 42% complete" })).toHaveAttribute("aria-valuenow", "42");
  });

  it("keeps the timetable and period actions explicit", () => {
    const openTimetable = vi.fn();
    const openPeriod = vi.fn();
    render(<TodayActivities periods={periods} onOpenTimetable={openTimetable} onOpenPeriod={openPeriod} />);

    fireEvent.click(screen.getByRole("button", { name: "Timetable" }));
    fireEvent.click(screen.getByRole("button", { name: /Open timetable. Period 1/ }));

    expect(openTimetable).toHaveBeenCalledOnce();
    expect(openPeriod).toHaveBeenCalledWith(periods[0]);
  });
});
