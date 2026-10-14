import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PrincipalCalendarExperienceRoute, PrincipalTimetableExperienceRoute } from "./TimetableExperienceRoutes";
import { setTimetableExperience } from "./timetableExperience";

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "principal-1" } }) }));
vi.mock("../day-plans/PrincipalDayPlanPage", () => ({ default: () => <p>Current timetable</p> }));
vi.mock("../calendar/CalendarRoutes", () => ({ PrincipalCalendarRoute: () => <p>Current calendar</p> }));
vi.mock("../planner/PrincipalPlannerRoute", () => ({ PrincipalPlannerRoute: () => <p>Timeline planner</p> }));

function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

function show(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/principal/timetable" element={<><PrincipalTimetableExperienceRoute /><Location /></>} />
    <Route path="/principal/calendar" element={<><PrincipalCalendarExperienceRoute /><Location /></>} />
  </Routes></MemoryRouter>);
}

describe("principal timetable experience routes", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("preserves the current timetable and calendar by default", () => {
    const timetable = show("/principal/timetable?date=2026-10-15");
    expect(screen.getByText("Current timetable")).toBeVisible();
    timetable.unmount();
    show("/principal/calendar?date=2026-10-15");
    expect(screen.getByText("Current calendar")).toBeVisible();
  });

  it("uses the timeline for timetable and redirects calendar with its context", async () => {
    setTimetableExperience("principal-1", "timeline");
    const timetable = show("/principal/timetable?date=2026-10-15");
    expect(screen.getByText("Timeline planner")).toBeVisible();
    timetable.unmount();
    show("/principal/calendar?date=2026-10-15&calendar_change_id=change-1");
    expect(await screen.findByText(/\/principal\/timetable\?/)).toHaveTextContent("date=2026-10-15");
    expect(screen.getByText(/\/principal\/timetable\?/)).toHaveTextContent("view=month");
    expect(screen.getByText(/\/principal\/timetable\?/)).toHaveTextContent("calendar_change_id=change-1");
  });
});
