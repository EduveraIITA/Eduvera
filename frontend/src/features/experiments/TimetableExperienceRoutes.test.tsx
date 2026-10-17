import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PrincipalCalendarExperienceRoute, PrincipalTimetableExperienceRoute } from "./TimetableExperienceRoutes";
import { setTimetableExperience } from "./timetableExperience";
import type { TimetableRehearsalIndicator } from "../planner/rehearsal";

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "principal-1" } }) }));
vi.mock("../day-plans/PrincipalDayPlanPage", () => ({ default: ({ rehearsal }: { rehearsal?: TimetableRehearsalIndicator | null }) => <p>Current timetable{rehearsal ? ` · ${rehearsal.label}` : ""}</p> }));
vi.mock("../calendar/CalendarRoutes", () => ({ PrincipalCalendarRoute: () => <p>Current calendar</p> }));
vi.mock("../planner/PrincipalPlannerRoute", () => ({ PrincipalPlannerRoute: ({ rehearsal }: { rehearsal?: TimetableRehearsalIndicator | null }) => <p>Timeline planner{rehearsal ? ` · ${rehearsal.label}` : ""}</p> }));

function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

function show(path: string, rehearsal?: TimetableRehearsalIndicator) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/principal/timetable" element={<><PrincipalTimetableExperienceRoute rehearsal={rehearsal} /><Location /></>} />
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

  it("forwards a development rehearsal without changing the selected timetable experience", () => {
    const rehearsal: TimetableRehearsalIndicator = {
      label: "Simulated school day", status: "running", referenceDate: "2026-10-14",
      simulatedAt: "2026-10-14T09:10:00+05:30", phaseLabel: "Period 1", phaseMode: "lesson",
      nextChangeAt: null, activeSlotIds: ["slot-1"], timeZone: "Asia/Kolkata", campusPath: "/principal/campus",
    };
    const current = show("/principal/timetable", rehearsal);
    expect(screen.getByText("Current timetable · Simulated school day")).toBeVisible();
    current.unmount();
    setTimetableExperience("principal-1", "timeline");
    show("/principal/timetable", rehearsal);
    expect(screen.getByText("Timeline planner · Simulated school day")).toBeVisible();
  });
});
