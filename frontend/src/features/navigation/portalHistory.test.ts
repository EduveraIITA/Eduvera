import { afterEach, describe, expect, it } from "vitest";
import {
  canPopPortalHistory,
  previousPortalLocation,
  rememberPortalLocation,
  resetRememberedPortalHistory,
} from "./portalHistory";

afterEach(resetRememberedPortalHistory);

describe("portal back history", () => {
  it("returns to the actual in-portal source, including cross-module entry points", () => {
    expect(canPopPortalHistory(
      "/principal/events/event-1?focus=status",
      "/principal/requests",
      "/principal/events",
    )).toBe(true);
  });

  it.each([
    ["/areas/dining", "/areas", "/areas"],
    ["/areas/people/participants/person-1", "/areas/people/participants?page=3", "/areas/people/participants"],
    ["/more/policies?policy=version-1", "/work?work_search=campus&work_page=2", "/more/policies"],
    ["/areas/events/calendar/event-1", "/today", "/areas/events/calendar"],
    ["/areas/dining", "/more", "/areas"],
  ])("returns from %s to the observed canonical source %s", (current, previous, parent) => {
    expect(canPopPortalHistory(current, previous, parent)).toBe(true);
  });

  it("allows a legacy hand-off to and from the canonical application", () => {
    expect(canPopPortalHistory("/areas/assessments/assigned?assessment=assessment-1", "/teacher/requests", "/areas/assessments")).toBe(true);
    expect(canPopPortalHistory("/teacher/attendance/class-1", "/work?work_page=2", "/teacher/attendance")).toBe(true);
  });

  it("does not leave the active portal or use unknown browser history", () => {
    expect(canPopPortalHistory("/principal/events/event-1", "/teacher/events", "/principal/events")).toBe(false);
    expect(canPopPortalHistory("/principal/events/event-1", "/login", "/principal/events")).toBe(false);
    expect(canPopPortalHistory("/principal/events/event-1", null, "/principal/events")).toBe(false);
  });

  it.each([
    ["/areas/dining", "https://example.com/areas"],
    ["/areas/dining", "//example.com/areas"],
    ["https://example.com/areas/dining", "/areas"],
    ["/areas/dining", "/login"],
    ["/areas/dining", "/account/profile"],
    ["/areas/dining", "/unrecognized"],
  ])("rejects external or non-workspace history from %s to %s", (current, previous) => {
    expect(canPopPortalHistory(current, previous, "/areas")).toBe(false);
  });

  it("does not pop to an indistinguishable duplicate route", () => {
    expect(canPopPortalHistory("/parent/events", "/parent/events", "/parent/more")).toBe(false);
    expect(canPopPortalHistory("/areas/events/?view=upcoming&page=2", "/areas/events?page=2&view=upcoming", "/areas/events")).toBe(false);
  });

  it("does not walk backward through filter changes on the same screen", () => {
    expect(canPopPortalHistory(
      "/principal/events?view=past",
      "/principal/events?view=upcoming",
      "/principal/more",
    )).toBe(false);
    expect(canPopPortalHistory("/work?work_page=3", "/work?work_page=2", "/today")).toBe(false);
  });

  it("pops a query-backed child only when the prior entry is its exact parent", () => {
    expect(canPopPortalHistory(
      "/principal/administration?section=rules&rule=events&school=school-1",
      "/principal/administration?school=school-1&section=rules",
      "/principal/administration?section=rules&school=school-1",
    )).toBe(true);
    expect(canPopPortalHistory(
      "/more/policies?view=all&policy=version-1",
      "/more/policies?view=all",
      "/more/policies?view=all",
    )).toBe(true);
  });

  it("only reads entries observed by the running app", () => {
    rememberPortalLocation(4, "/parent/requests?student_id=child-1");
    expect(previousPortalLocation(5)).toBe("/parent/requests?student_id=child-1");
    expect(previousPortalLocation(4)).toBeNull();
  });
});
