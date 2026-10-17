import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

function route(path: string) {
  return appSource.split("\n").find((line) => line.includes(`path="${path}"`)) ?? "";
}

describe("Campus Lab route isolation", () => {
  it.each([
    ["/parent/timetable", "ParentTimetableRoute"],
    ["/student/timetable", "StudentTimetableRoute"],
    ["/teacher/timetable", "TeacherDayPage"],
    ["/principal/timetable", "PrincipalTimetableExperienceRoute"],
  ])("keeps %s on its live route", (path, component) => {
    expect(route(path)).toContain(`<${component} />`);
    expect(route(path)).not.toContain("DevelopmentRoute");
  });

  it("keeps the normal Campus view live and scopes the synthetic overlay to its explicit route", () => {
    expect(route("/principal/campus")).toContain("<CampusViewPage />");
    expect(route("/principal/campus")).not.toContain("CampusViewDevelopmentPage");

    const labRoute = route("/principal/campus-lab");
    expect(labRoute).toContain("<CampusLabRouteBoundary>");
    expect(labRoute).toContain("<CampusViewDevelopmentPage />");
  });

  it("does not wrap the application router in the Campus Lab projection provider", () => {
    expect(appSource).not.toContain("<CampusLabRouteBoundary>\n            <Routes>");
    expect(appSource).not.toMatch(/const (?:Parent|Student|Teacher|Principal)TimetableDevelopmentRoute/u);
  });
});
