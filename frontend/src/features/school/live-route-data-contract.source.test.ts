import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

const studentRoutes = source("features", "school", "StudentLiveRoutes.tsx");
const parentRoutes = source("features", "school", "ParentLiveRoutes.tsx");

function invocation(text: string, component: string): string {
  const start = text.indexOf(`<${component}`);
  const end = text.indexOf("/>", start);
  return start >= 0 && end >= 0 ? text.slice(start, end + 2) : "";
}

describe("authenticated live-route data contracts", () => {
  it("does not import or reference known demo fixtures from live routes", () => {
    const liveRouteSource = `${studentRoutes}\n${parentRoutes}`;
    expect(liveRouteSource).not.toMatch(
      /parentDemoData|demoParentChild|fallbackHomeData|demoStudentAttendanceData|demoEligibilityData|demoLeaveStatusData|demoTimetableDays|weekGridRows/,
    );
  });

  it("passes loaded domain data to every student live-data page", () => {
    expect(invocation(studentRoutes, "StudentHomePage")).toContain("data=");
    expect(invocation(studentRoutes, "StudentAttendancePage")).toContain("data=");
    expect(invocation(studentRoutes, "StudentEligibilityPage")).toContain("data=");
    expect(invocation(studentRoutes, "StudentLeaveStatusPage")).toContain("data=");
    expect(invocation(studentRoutes, "StudentTimetablePage")).toContain("days=");
    expect(invocation(studentRoutes, "StudentWeekGridPage")).toContain("rows=");
    expect(invocation(parentRoutes, "ParentHomePage")).toContain("data=");
  });

  it("keeps live page datasets required instead of defaulting to demo records", () => {
    const parentHome = source("pages", "parent", "ParentHomePage.tsx");
    const timetable = source("pages", "student", "StudentTimetablePage.tsx");
    const weekGrid = source("pages", "student", "StudentWeekGridPage.tsx");
    expect(parentHome).toMatch(/interface ParentHomePageProps\s*\{\s*data:\s*ParentHomeData;/);
    expect(weekGrid).toMatch(/interface StudentWeekGridPageProps\s*\{\s*rows:\s*WeekGridRow\[\];/);
    expect(weekGrid).not.toMatch(/rows\s*=\s*weekGridRows/);
    expect(timetable).not.toContain("kitForPeriod");
    expect(timetable).toContain(".flatMap(p=>p.materials ?? [])");
  });
});
