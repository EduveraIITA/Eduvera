import { describe, expect, it } from "vitest";
import { portalReturnState, portalReturnTarget, samePortalHref } from "./portalReturnState";

describe("portal return navigation state", () => {
  it("records a same-portal origin while preserving other router state", () => {
    expect(portalReturnState(
      "/parent/requests?student_id=child-1&category=transport",
      "/parent/departure?student_id=child-1",
      { transition: "attention" },
    )).toEqual({
      transition: "attention",
      portalReturnTo: "/parent/requests?student_id=child-1&category=transport",
    });
  });

  it.each([
    ["https://example.com/parent/requests", "/parent/departure"],
    ["//example.com/parent/requests", "/parent/departure"],
    ["/parent/requests", "/teacher/attendance"],
    ["/account/profile", "/parent/departure"],
  ])("rejects unsafe or cross-portal provenance from %s to %s", (origin, destination) => {
    expect(portalReturnState(origin, destination)).toBeUndefined();
  });

  it("revalidates state at the destination instead of trusting its shape", () => {
    expect(portalReturnTarget({ portalReturnTo: "/parent/requests?category=leave" }, "/parent/leave")).toBe("/parent/requests?category=leave");
    expect(portalReturnTarget({ portalReturnTo: "/teacher/requests" }, "/parent/leave")).toBeNull();
    expect(portalReturnTarget({ portalReturnTo: "//example.com/parent/requests" }, "/parent/leave")).toBeNull();
    expect(portalReturnTarget("unexpected", "/parent/leave")).toBeNull();
  });

  it("compares equivalent same-portal URLs without depending on query order", () => {
    expect(samePortalHref(
      "/parent/requests?student_id=child-1&category=transport",
      "/parent/requests?category=transport&student_id=child-1",
    )).toBe(true);
    expect(samePortalHref("/parent/requests", "/teacher/requests")).toBe(false);
  });
});
