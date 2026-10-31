import { describe, expect, it } from "vitest";
import { safeAccountReturnTarget } from "./accountReturnTarget";

describe("safeAccountReturnTarget", () => {
  it.each([
    ["/gate", "/gate"],
    ["/gate?mode=visitors#pending", "/gate?mode=visitors#pending"],
    ["/principal/more?section=setup#trust", "/principal/more?section=setup#trust"],
    ["/teacher/attendance", "/teacher/attendance"],
    ["/parent/home?student_id=child-1", "/parent/home?student_id=child-1"],
    ["/student", "/student"],
    ["/workspace", "/workspace"],
    ["/company/institutions/campus-1", "/company/institutions/campus-1"],
    ["/work/staff-leave", "/work/staff-leave"],
    ["/today", "/today"],
    ["/areas/attendance/registers?date=2026-10-19", "/areas/attendance/registers?date=2026-10-19"],
    ["/more/connections", "/more/connections"],
    ["/onboarding/start", "/onboarding/start"],
    ["/account/profile?from=%2Fgate", "/account/profile?from=%2Fgate"],
  ])("keeps the authenticated destination %s", (value, expected) => {
    expect(safeAccountReturnTarget(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    "",
    "//evil.example/gate",
    "https://evil.example/gate",
    "/login",
    "/signup",
    "/unknown",
    "/gatekeeper",
  ])("rejects an unsafe or unknown destination %s", (value) => {
    expect(safeAccountReturnTarget(value)).toBeNull();
  });
});
