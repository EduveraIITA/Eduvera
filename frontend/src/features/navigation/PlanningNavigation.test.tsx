import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PlanningNavigation } from "./PlanningNavigation";

describe("PlanningNavigation", () => {
  it("separates browsing from editing and preserves the selected school, class and date", () => {
    render(<MemoryRouter initialEntries={["/principal/calendar?school=s1&class=c2&date=2026-10-08&view=month"]}><PlanningNavigation /></MemoryRouter>);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Timetable", exact: true })).toHaveAttribute("href", "/principal/timetable?school=s1&date=2026-10-08&class=c2");
    expect(screen.getByRole("link", { name: "Schedule settings" })).toHaveAttribute("href", "/principal/timetable/weekly?school=s1&date=2026-10-08&class=c2&view=month");
    expect(screen.queryByText("Daily plan")).not.toBeInTheDocument();
  });
});
