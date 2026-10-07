import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TimetableSummary } from "./TimetableNavigator";
import { TimetableNavigator } from "./TimetableNavigator";

function summary(days: TimetableSummary["days"]): TimetableSummary {
  return {
    start: "2026-01-01",
    end: "2026-12-31",
    days,
    totals: {
      periods: days.reduce((total, day) => total + day.periods, 0),
      classes: days.reduce((total, day) => total + day.classes, 0),
      pending: 0,
      accepted: 0,
      declined: 0,
      cancelled: 0,
    },
  };
}

function day(date: string, periods: number): TimetableSummary["days"][number] {
  return { date, periods, classes: periods ? 1 : 0, pending: 0, accepted: 0, declined: 0, cancelled: 0 };
}

describe("TimetableNavigator overviews", () => {
  it("renders the month as a Monday-first calendar with weekday headings", () => {
    const onDateChange = vi.fn();
    const onViewChange = vi.fn();
    const { container } = render(
      <TimetableNavigator
        date="2026-10-02"
        view="month"
        today="2026-10-03"
        summary={summary([day("2026-10-01", 6), day("2026-10-02", 0), day("2026-10-03", 3)])}
        onDateChange={onDateChange}
        onViewChange={onViewChange}
      />,
    );

    expect(container.querySelector(".teacher-month-weekdays")?.textContent).toBe("MonTueWedThuFriSatSun");
    expect(container.querySelectorAll(".teacher-month-grid__spacer")).toHaveLength(3);
    const month = container.querySelector(".teacher-month-calendar");
    expect(month).not.toBeNull();
    const selectedDay = within(month as HTMLElement).getByRole("button", { name: "Friday, 2 October, free day, open day view" });
    expect(selectedDay).toHaveAttribute("aria-pressed", "true");
    const today = within(month as HTMLElement).getByRole("button", { name: "Saturday, 3 October, 3 periods, today, open day view" });
    expect(today).toHaveClass("is-today");
    expect(within(container).getByRole("button", { name: "Go to today, Saturday, 3 October" })).toHaveTextContent("Today · 3 Oct");
    fireEvent.click(today);
    expect(onDateChange).toHaveBeenCalledWith("2026-10-03");
    expect(onViewChange).toHaveBeenCalledWith("day");
  });

  it("renders one compact twelve-row load chart for the year", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <TimetableNavigator
        date="2026-04-15"
        view="year"
        today="2026-10-03"
        summary={summary([day("2026-04-01", 144), day("2026-05-01", 72)])}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    const chart = container.querySelector(".teacher-year-chart");
    expect(chart).not.toBeNull();
    expect(within(chart as HTMLElement).getAllByRole("button")).toHaveLength(12);
    expect(within(chart as HTMLElement).getByRole("button", { name: "Jan, 0 periods, open month view" })).toBeVisible();
    const april = within(chart as HTMLElement).getByRole("button", { name: "Apr, 144 periods, open month view" });
    expect(april).toHaveAttribute("aria-pressed", "true");
    expect(within(chart as HTMLElement).getByRole("button", { name: "Oct, 0 periods, current month, open month view" })).toHaveClass("is-current-month");
    fireEvent.click(within(chart as HTMLElement).getByRole("button", { name: "May, 72 periods, open month view" }));
    expect(onNavigate).toHaveBeenCalledWith("2026-05-01", "month");
    expect(container.querySelector(".teacher-year-grid")).not.toBeInTheDocument();
  });
});
