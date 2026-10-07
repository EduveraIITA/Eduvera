import { describe, expect, it } from "vitest";
import type { SchoolMembership } from "./AuthContext";
import { teacherPathIsAuthorized, teacherToolIsVisible } from "./staffAccess";

const busAttendant: SchoolMembership = {
  id: "membership-1",
  school_id: "school-1",
  school_name: "Cambridge International School",
  role: "staff",
  permissions: ["departure.collect"],
  custom_role: { id: "role-1", name: "Bus Attendant" },
};

describe("custom staff access", () => {
  it("shows only tools backed by the effective permission set", () => {
    expect(teacherToolIsVisible(busAttendant, "transport")).toBe(true);
    expect(teacherToolIsVisible(busAttendant, "assessments")).toBe(false);
    expect(teacherToolIsVisible(busAttendant, "report-cards")).toBe(false);
    expect(teacherToolIsVisible(busAttendant, "responsibilities")).toBe(true);
  });

  it("keeps the role home available while protecting direct module URLs", () => {
    expect(teacherPathIsAuthorized(busAttendant, "/teacher")).toBe(true);
    expect(teacherPathIsAuthorized(busAttendant, "/teacher/more")).toBe(true);
    expect(teacherPathIsAuthorized(busAttendant, "/teacher/transport")).toBe(true);
    expect(teacherPathIsAuthorized(busAttendant, "/teacher/assessments")).toBe(false);
    expect(teacherPathIsAuthorized(busAttendant, "/teacher/report-cards")).toBe(false);
  });
});
