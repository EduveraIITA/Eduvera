import { describe, expect, it } from "vitest";
import { isPortalHome, isSecondaryPortalPage, portalParent } from "./portalHierarchy";

describe("portal navigation hierarchy", () => {
  it.each(["/principal", "/teacher", "/parent", "/parent/home", "/student", "/teacher/"])("leaves home %s outside the non-home redesign", path => {
    expect(isPortalHome(path)).toBe(true);
    expect(isSecondaryPortalPage(path)).toBe(false);
  });
  it.each([
    ["/teacher/classes/class-1", "?date=2026-10-08&section=students", "/teacher/classes?date=2026-10-08"],
    ["/principal/staff/staff-1", "", "/principal/staff"],
    ["/principal/insights", "?date=2026-10-08", "/principal"],
    ["/principal/events/event-1/edit", "", "/principal/events/event-1"],
    ["/parent/fees", "?student_id=child-2", "/parent/more?student_id=child-2"],
    ["/parent/attendance", "?student_id=child-2&date=2026-10-08", "/parent/home?student_id=child-2"],
    ["/student/policies", "?school=1", "/student/apps?school=1"],
    ["/teacher/more", "", "/teacher"],
    ["/principal/timetable/weekly", "?class=class-1", "/principal/timetable?class=class-1"],
  ])("returns %s to its parent with only relevant context", (path, search, expected) => {
    expect(isSecondaryPortalPage(path)).toBe(true);
    expect(portalParent(path, search, "/")).toBe(expected);
  });
  it("does not invent a hierarchy outside the supported portals", () => {
    expect(isSecondaryPortalPage("/account/security")).toBe(false);
    expect(portalParent("/account/security", "", "/")).toBe("/");
  });
});
