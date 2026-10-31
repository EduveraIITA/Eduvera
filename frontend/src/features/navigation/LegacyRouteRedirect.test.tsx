import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyRouteRedirect } from "./LegacyRouteRedirect";

afterEach(cleanup);

function Destination() {
  const location = useLocation();
  return <output aria-label="destination">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

describe("LegacyRouteRedirect", () => {
  it.each(["/principal/campus", "/more/campus-view"])("preserves campus, activity panel and anchors from %s", async (legacyPath) => {
    render(<MemoryRouter initialEntries={[`${legacyPath}?campus_id=east&panel=activity#record-7`]}>
      <Routes>
        <Route path={legacyPath} element={<LegacyRouteRedirect to="/more/virtual-campus" />} />
        <Route path="/more/virtual-campus" element={<Destination />} />
      </Routes>
    </MemoryRouter>);
    expect(await screen.findByLabelText("destination")).toHaveTextContent("/more/virtual-campus?campus_id=east&panel=activity#record-7");
  });
  it("moves nested Calendar bookmarks to its own Area without losing child, attention, date or anchor", async () => {
    render(<MemoryRouter initialEntries={["/areas/timetable/calendar?scope=dependent&student_id=child-2&date=2026-10-20&view=day&calendar_change_id=change-1&calendar_revision=7&calendar_record_revision=2&attention_notification_id=n1#day-detail"]}>
      <Routes>
        <Route path="/areas/timetable/calendar" element={<LegacyRouteRedirect to="/areas/calendar" />} />
        <Route path="/areas/calendar" element={<Destination />} />
      </Routes>
    </MemoryRouter>);
    expect(await screen.findByLabelText("destination")).toHaveTextContent("/areas/calendar?scope=dependent&student_id=child-2&date=2026-10-20&view=day&calendar_change_id=change-1&calendar_revision=7&calendar_record_revision=2&attention_notification_id=n1#day-detail");
  });
  it("preserves query state and anchors while filling canonical defaults", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/timetable?date=2026-10-18#period-2"]}>
        <Routes>
          <Route
            path="/teacher/timetable"
            element={<LegacyRouteRedirect to="/areas/timetable/schedule" defaultSearch={{ view: "day" }} />}
          />
          <Route path="/areas/timetable/schedule" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/areas/timetable/schedule?date=2026-10-18&view=day#period-2",
    );
  });

  it("does not replace an explicit query value", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/timetable?view=month"]}>
        <Routes>
          <Route
            path="/teacher/timetable"
            element={<LegacyRouteRedirect to="/areas/timetable/schedule" defaultSearch={{ view: "day" }} />}
          />
          <Route path="/areas/timetable/schedule" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/areas/timetable/schedule?view=month",
    );
  });

  it("carries a meaningful legacy path parameter into its canonical route", async () => {
    render(
      <MemoryRouter initialEntries={["/principal/staff/staff%201?tab=responsibilities"]}>
        <Routes>
          <Route
            path="/principal/staff/:staffProfileId"
            element={<LegacyRouteRedirect to={({ staffProfileId }) => `/more/setup/responsibilities/${encodeURIComponent(staffProfileId ?? "")}`} />}
          />
          <Route path="/more/setup/responsibilities/:staffProfileId" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/more/setup/responsibilities/staff%201?tab=responsibilities",
    );
  });

  it("can consume a legacy-only query selector after using it to choose a target", async () => {
    render(
      <MemoryRouter initialEntries={["/principal/administration?section=rules&rule=late-arrival"]}>
        <Routes>
          <Route
            path="/principal/administration"
            element={<LegacyRouteRedirect
              to={(_parameters, search) => search.get("section") === "rules"
                ? "/more/setup/institution/operating-rules"
                : "/more/setup/institution"}
              dropSearch={["section"]}
            />}
          />
          <Route path="/more/setup/institution/operating-rules" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/more/setup/institution/operating-rules?rule=late-arrival",
    );
  });
});
