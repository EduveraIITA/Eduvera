import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
const moreSource = readFileSync(join(process.cwd(), "src", "features", "more", "MoreWorkspaceRoutes.tsx"), "utf8");

function route(path: string) {
  return appSource.split("\n").find((line) => line.includes(`path="${path}"`)) ?? "";
}

describe("Campus Lab route isolation", () => {
  it.each([
    ["/areas/timetable/schedule", "WorkspaceTimetableScheduleRoute"],
    ["/areas/timetable/planning", "WorkspaceTimetablePlanningRoute"],
  ])("keeps %s on its live route", (path, component) => {
    expect(route(path)).toContain(`<${component} />`);
    expect(route(path)).not.toContain("DevelopmentRoute");
  });

  it("converges staff timetable bookmarks without introducing a Campus Lab renderer", () => {
    expect(appSource).toContain('{ from: "/teacher/timetable", to: "/areas/timetable/schedule"');
    expect(appSource).toContain('{ from: "/principal/timetable", to: "/areas/timetable/planning"');
    expect(appSource).toContain('{ from: "/parent/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "self" } }');
    expect(appSource).not.toMatch(/from: "\/(?:teacher|principal)\/timetable"[^\n]+DevelopmentRoute/u);
  });

  it("keeps one Virtual campus and exposes product Simulation through a neutral route", () => {
    expect(moreSource).toContain('{ path: "/more/virtual-campus", itemKey: "virtual-campus", Component: WorkspaceVirtualCampusRoute }');
    expect(moreSource).toContain('<CampusScenePage backTo="/more" />');
    expect(moreSource).not.toContain('CampusViewPage');
    expect(moreSource).toContain('{ path: "/more/simulation", itemKey: "simulation", Component: WorkspaceSimulationRoute }');
    expect(moreSource).toContain('<MoreRouteBoundary itemKey="simulation"');
    expect(moreSource).toContain('{ from: "/principal/campus", to: "/more/virtual-campus" }');
    expect(moreSource).toContain('{ from: "/more/campus-view", to: "/more/virtual-campus" }');
    expect(moreSource).not.toContain('/more/development/campus-lab');
    expect(moreSource).not.toContain('/principal/campus-lab');
    expect(moreSource).not.toContain('/principal/experimental');
  });

  it("does not wrap the application router in the Campus Lab projection provider", () => {
    expect(appSource).not.toContain("<CampusLabRouteBoundary>\n            <Routes>");
    expect(appSource).not.toMatch(/const (?:Parent|Student|Teacher|Principal)TimetableDevelopmentRoute/u);
  });
});
