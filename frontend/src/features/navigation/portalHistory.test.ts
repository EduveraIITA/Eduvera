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

  it("does not leave the active portal or use unknown browser history", () => {
    expect(canPopPortalHistory("/principal/events/event-1", "/teacher/events", "/principal/events")).toBe(false);
    expect(canPopPortalHistory("/principal/events/event-1", "/login", "/principal/events")).toBe(false);
    expect(canPopPortalHistory("/principal/events/event-1", null, "/principal/events")).toBe(false);
  });

  it("does not pop to an indistinguishable duplicate route", () => {
    expect(canPopPortalHistory("/parent/events", "/parent/events", "/parent/more")).toBe(false);
  });

  it("does not walk backward through filter changes on the same screen", () => {
    expect(canPopPortalHistory(
      "/principal/events?view=past",
      "/principal/events?view=upcoming",
      "/principal/more",
    )).toBe(false);
  });

  it("pops a query-backed child only when the prior entry is its exact parent", () => {
    expect(canPopPortalHistory(
      "/principal/administration?section=rules&rule=events&school=school-1",
      "/principal/administration?school=school-1&section=rules",
      "/principal/administration?section=rules&school=school-1",
    )).toBe(true);
  });

  it("only reads entries observed by the running app", () => {
    rememberPortalLocation(4, "/parent/requests?student_id=child-1");
    expect(previousPortalLocation(5)).toBe("/parent/requests?student_id=child-1");
    expect(previousPortalLocation(4)).toBeNull();
  });
});
