import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarView, type CalendarViewProps } from "./CalendarView";

afterEach(cleanup);

function props(overrides: Partial<CalendarViewProps> = {}): CalendarViewProps {
  return {
    year: 2026,
    month0: 9,
    selected: "2026-10-10",
    mode: "month",
    onMonthChange: vi.fn(),
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
    const day = screen.getByRole("button", { name: /Saturday, 10 October, 2 indicators/i });
    expect(day).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Friday, 9 October/i }));
    expect(input.onSelect).toHaveBeenCalledWith("2026-10-09");
  });

  it("switches to the day view and uses day navigation labels", async () => {
    const input = props({ mode: "day" });
    render(<CalendarView {...input} />);
    expect(screen.getByRole("button", { name: "Previous day" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next day" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Seven day selector" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(input.onModeChange).toHaveBeenCalledWith("month");
  });

  it("keeps selected-day detail in a labelled live region", () => {
    render(<CalendarView {...props()} />);
    expect(screen.getByRole("region", { name: "Schedule for Saturday, 10 October" })).toHaveTextContent("Selected schedule");
  });
});
