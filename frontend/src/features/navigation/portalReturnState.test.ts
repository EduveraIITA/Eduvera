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

  it("preserves provenance when a legacy shell hands work to the canonical application", () => {
    expect(portalReturnState(
      "/teacher/requests?category=academics",
      "/areas/assessments/assigned?assessment=assessment-1",
    )).toEqual({ portalReturnTo: "/teacher/requests?category=academics" });
    expect(portalReturnTarget(
      { portalReturnTo: "/teacher/requests?category=academics" },
      "/areas/assessments/assigned?assessment=assessment-1",
    )).toBe("/teacher/requests?category=academics");
  });

  it("preserves the filtered Work origin when opening an owning More tool", () => {
    const origin = "/work?work_view=needs_me&work_search=campus&work_page=2";
    const destination = "/more/policies?policy=version-1&policy_revision=4";
    const state = portalReturnState(origin, destination);
    expect(state).toEqual({ portalReturnTo: origin });
    expect(portalReturnTarget(state, destination)).toBe(origin);
    expect(samePortalHref(origin, "/work?work_page=2&work_search=campus&work_view=needs_me")).toBe(true);
  });

  it("accepts More as a canonical origin without broadening unsafe or account destinations", () => {
    const state = portalReturnState("/more?tool_search=policies", "/work?item=policy-1");
    expect(state).toEqual({ portalReturnTo: "/more?tool_search=policies" });
    expect(portalReturnTarget(state, "/work?item=policy-1")).toBe("/more?tool_search=policies");
    expect(portalReturnState("/work", "https://example.com/more/policies")).toBeUndefined();
    expect(portalReturnState("/work", "//example.com/more/policies")).toBeUndefined();
    expect(portalReturnState("/work", "/account/security")).toBeUndefined();
    expect(portalReturnTarget({ portalReturnTo: "/account/security" }, "/more/policies")).toBeNull();
    expect(portalReturnTarget({ portalReturnTo: "//example.com/work" }, "/more/policies")).toBeNull();
  });

  it("compares equivalent same-portal URLs without depending on query order", () => {
    expect(samePortalHref(
      "/parent/requests?student_id=child-1&category=transport",
      "/parent/requests?category=transport&student_id=child-1",
    )).toBe(true);
    expect(samePortalHref("/parent/requests", "/teacher/requests")).toBe(false);
  });
});
