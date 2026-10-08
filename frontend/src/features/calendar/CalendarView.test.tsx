import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView, type CalendarViewProps } from "./CalendarView";

beforeEach(() => {
  // Make the selected fixture day also Today, so date queries must distinguish
  // the calendar cell from the separate Go to today control. Leave timers real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T06:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function props(overrides: Partial<CalendarViewProps> = {}): CalendarViewProps {
  return {
    year: 2026,
    month0: 9,
    selected: "2026-10-10",
    mode: "month",
    onToday: vi.fn(),
    onModeChange: vi.fn(),
    onSelect: vi.fn(),
    marks: { "2026-10-10": ["event", "event", "test"] },
    isSchoolDay: (cell) => cell.weekday !== 7,
    legend: [{ tone: "event", label: "Event" }, { tone: "test", label: "Test" }],
    detail: <p>Selected schedule</p>,
    ...overrides,
  };
}

describe("CalendarView", () => {
  it("exposes a meaningful, deduplicated month grid and selects dates", async () => {
    const input = props();
    render(<CalendarView {...input} />);
    const day = screen.getByRole("button", { name: /Saturday, 10 October, Event, Test/i });
    expect(day).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /^Friday, 9 October/i }));
    expect(input.onSelect).toHaveBeenCalledWith("2026-10-09");
  });

  it("uses the shared week navigation and view selector", async () => {
    const input = props({ mode: "day" });
    render(<CalendarView {...input} />);
    expect(screen.getByRole("button", { name: "Previous week" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(input.onSelect).toHaveBeenCalledWith('2026-10-17');
    expect(screen.getByRole("group", { name: "Choose date" })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Calendar view" }), "month");
    expect(input.onModeChange).toHaveBeenCalledWith("month");
  });

  it('keeps month selection open and delegates Today to the atomic route update', async () => {
    const input = props();
    render(<CalendarView {...input} />);
    await userEvent.click(screen.getByRole('button', {name: /^Friday, 9 October/}));
    expect(input.onModeChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', {name: /Go to today/}));
    expect(input.onToday).toHaveBeenCalledOnce();
  });

  it("keeps selected-day detail in a labelled live region", () => {
    render(<CalendarView {...props()} />);
    expect(screen.getByRole("region", { name: "Schedule for Saturday, 10 October" })).toHaveTextContent("Selected schedule");
  });

  it("keeps the calendar key available without displaying it by default", async () => {
    render(<CalendarView {...props()} />);
    expect(screen.getByText("Event")).not.toBeVisible();
    await userEvent.click(screen.getByText("Calendar key"));
    expect(screen.getByText("Event")).toBeVisible();
    expect(screen.getByText("Test")).toBeVisible();
  });
});
