import { fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TimetableSummary } from "./TimetableNavigator";
import { TimetableNavigator, readTimetableView, shiftTimetablePeriod, type TimetableView } from "./TimetableNavigator";

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
  it("keeps seven visible dates, a distinct today marker and one view picker", () => {
    const onDateChange = vi.fn(), onViewChange = vi.fn();
    const { container } = render(<TimetableNavigator date="2026-10-08" today="2026-10-07" view="day" onDateChange={onDateChange} onViewChange={onViewChange} />);
    const page = within(container);
    const dates = page.getByRole("group", { name: "Choose date" });
    expect(within(dates).getAllByRole("button")).toHaveLength(7);
    expect(within(dates).getByRole("button", { name: "Wednesday, 7 October, today" })).toHaveAttribute("aria-current", "date");
    expect(within(dates).getByRole("button", { name: "Thursday, 8 October" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(page.getByRole("button", { name: "Next week" }));
    expect(onDateChange).toHaveBeenCalledWith("2026-10-15");
    fireEvent.click(page.getByRole("button", { name: "Go to today, Wednesday, 7 October" }));
    expect(onDateChange).toHaveBeenCalledWith("2026-10-07");
    fireEvent.change(page.getByRole("combobox", { name: "Timetable view" }), { target: { value: "month" } });
    expect(onViewChange).toHaveBeenCalledWith("month");
    expect(page.queryByRole("tablist")).not.toBeInTheDocument();
    expect(page.getByRole("button", { name: "Expand calendar", exact: true }).textContent).toBe("");
    expect(within(page.getByRole("combobox", { name: "Timetable view" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["Day", "Month", "Year"]);
  });

  it("clamps month and year navigation to valid dates", () => {
    expect(shiftTimetablePeriod("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(shiftTimetablePeriod("2024-02-29", "year", 1)).toBe("2025-02-28");
    expect(shiftTimetablePeriod("2026-01-02", "day", -1)).toBe("2025-12-26");
    expect(readTimetableView("week")).toBe("day");
    expect(readTimetableView(null)).toBe("day");
    expect(readTimetableView("month")).toBe("month");
  });
  it('shows the same period counts in compact and expanded dates without inventing missing totals', () => {
    const props = {date:'2026-10-08', today:'2026-10-08', onDateChange:vi.fn(), onViewChange:vi.fn(), summary:summary([day('2026-10-08',6),day('2026-10-09',0)])};
    const {container,rerender}=render(<TimetableNavigator {...props} view="day"/>);
    const page=within(container);
    expect(page.getByRole('button',{name:'Thursday, 8 October, 6 periods, today'}).querySelector('.schedule-period-count')).toHaveTextContent('6');
    expect(page.getByRole('button',{name:'Friday, 9 October, free day'}).querySelector('.schedule-period-count')).toHaveTextContent('–');
    expect(page.getByRole('button',{name:'Wednesday, 7 October'}).querySelector('.schedule-period-count')).toBeNull();
    rerender(<TimetableNavigator {...props} view="month"/>);
    expect(page.getByRole('button',{name:'Thursday, 8 October, 6 periods, today'}).querySelector('.schedule-period-count')).toHaveTextContent('6');
    rerender(<TimetableNavigator {...props} view="day" error="Unavailable"/>);
    expect(container.querySelector('.schedule-period-count')).toBeNull();
    expect(page.queryByRole('button',{name:/free day/})).not.toBeInTheDocument();
  });
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

    expect(container.querySelector(".date-navigation__weekdays")?.textContent).toBe("MonTueWedThuFriSatSun");
    expect(container.querySelectorAll(".date-navigation__spacer")).toHaveLength(3);
    const month = container.querySelector(".date-navigation__dates");
    expect(month).not.toBeNull();
    const selectedDay = within(month as HTMLElement).getByRole("button", { name: "Friday, 2 October, free day" });
    expect(selectedDay).toHaveAttribute("aria-pressed", "true");
    const today = within(month as HTMLElement).getByRole("button", { name: "Saturday, 3 October, 3 periods, today" });
    expect(today).toHaveClass("is-today");
    expect(within(container).getByRole("button", { name: "Go to today, Saturday, 3 October" })).toHaveTextContent("Today");
    fireEvent.click(today);
    expect(onDateChange).toHaveBeenCalledWith("2026-10-03");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("keeps the expanded calendar after choosing dates and the next month, but collapses on Today", () => {
    function Calendar() {
      const [date, setDate] = useState("2026-10-07");
      const [view, setView] = useState<TimetableView>("day");
      return <TimetableNavigator date={date} view={view} today="2026-10-07" onDateChange={setDate} onViewChange={setView} />;
    }
    const { container } = render(<Calendar />);
    const page = within(container);
    fireEvent.click(page.getByRole("button", { name: "Expand calendar" }));
    const picker = page.getByRole("combobox", { name: "Timetable view" });
    expect(picker).toHaveValue("month");
    fireEvent.click(page.getByRole("button", { name: "Thursday, 8 October" }));
    expect(picker).toHaveValue("month");
    expect(page.getByRole("button", { name: "Thursday, 8 October" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(page.getByRole("button", { name: /Go to today/ }));
    expect(picker).toHaveValue("day");
    expect(page.getByRole("button", { name: "Wednesday, 7 October, today" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(page.getByRole("button", { name: "Expand calendar", exact: true }));
    fireEvent.click(page.getByRole("button", { name: "Next month" }));
    expect(page.getByRole("button", { name: "Saturday, 7 November" })).toHaveAttribute("aria-pressed", "true");
    expect(picker).toHaveValue("month");
    fireEvent.click(page.getByRole("button", { name: "Collapse calendar" }));
    expect(picker).toHaveValue("day");
    expect(page.getByRole("button", { name: "Saturday, 7 November" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps month dates usable while totals are loading or fail, without claiming free days", () => {
    const props = { date: "2026-10-07", today: "2026-10-07", view: "month" as const, onDateChange: vi.fn(), onViewChange: vi.fn() };
    const { container, rerender } = render(<TimetableNavigator {...props} loading />);
    const page = within(container);
    expect(page.getByRole("status")).toHaveTextContent("Updating period totals");
    expect(page.queryByRole("button", { name: /free day/ })).not.toBeInTheDocument();
    fireEvent.click(page.getByRole("button", { name: "Thursday, 8 October" }));
    expect(props.onDateChange).toHaveBeenCalledWith("2026-10-08");
    expect(props.onViewChange).not.toHaveBeenCalled();
    rerender(<TimetableNavigator {...props} error="Network error" />);
    expect(page.getByRole("button", { name: "Thursday, 8 October" })).toBeVisible();
    expect(page.getByRole("alert")).toHaveTextContent("could not be loaded");
  });

  it("renders twelve monthly period totals without calendar dates or a daily agenda", () => {
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

    const chart = container.querySelector(".timetable-year");
    expect(chart).not.toBeNull();
    expect(within(chart as HTMLElement).getAllByRole("button")).toHaveLength(12);
    expect(within(chart as HTMLElement).getByRole("button", { name: "January, 0 periods, open month view" })).toBeVisible();
    const april = within(chart as HTMLElement).getByRole("button", { name: "April, 144 periods, open month view" });
    expect(april).toHaveAttribute("aria-pressed", "true");
    expect(within(chart as HTMLElement).getByRole("button", { name: "October, 0 periods, current month, open month view" })).toHaveClass("is-current-month");
    expect(april.querySelector('.timetable-year__count')).toHaveTextContent('144');
    expect(chart?.querySelector('[data-date]')).toBeNull();
    expect(chart?.querySelector('.timetable-year__dates')).toBeNull();
    fireEvent.click(within(chart as HTMLElement).getByRole("button", { name: "May, 72 periods, open month view" }));
    expect(onNavigate).toHaveBeenCalledWith("2026-05-01", "month");
    fireEvent.click(within(container).getByRole("button", { name: /Go to today/ }));
    expect(onNavigate).toHaveBeenCalledWith("2026-10-03", "day");
    expect(container.querySelector(".teacher-year-chart")).not.toBeInTheDocument();
    expect(container.querySelector('.date-navigation__grid')).not.toBeInTheDocument();
  });
  it('labels unavailable year totals without claiming zero or showing calendar dates',()=>{
    const {container}=render(<TimetableNavigator date="2024-02-29" today="2026-10-08" view="year" onDateChange={vi.fn()} onViewChange={vi.fn()}/>);
    const february=within(container).getByRole('button',{name:'February, totals unavailable, open month view'});
    expect(february.querySelector('.timetable-year__count')).toHaveTextContent('—');
    expect(february.querySelector('[data-date]')).toBeNull();
    expect(within(container).queryByRole('button',{name:/0 periods/})).not.toBeInTheDocument();
  });
});
