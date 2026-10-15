import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { PublicDemoGuard } from "../src/auth/guards.js";

function contextFor(request: { method: string; url: string; publicDemo?: boolean }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("PublicDemoGuard", () => {
  const guard = new PublicDemoGuard();

  it("allows ordinary authenticated sessions to keep using write endpoints", () => {
    expect(guard.canActivate(contextFor({ method: "POST", url: "/api/v1/attendance/registers/" }))).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("allows %s requests in the public demo", (method) => {
    expect(guard.canActivate(contextFor({ method, url: "/api/v1/attendance/registers/", publicDemo: true }))).toBe(true);
  });

  it.each(["/api/v1/auth/demo-profile-switch/", "/api/v1/auth/logout/"])(
    "allows the public-demo control endpoint %s",
    (url) => {
      expect(guard.canActivate(contextFor({ method: "POST", url, publicDemo: true }))).toBe(true);
    },
  );

  it("blocks mutations even when query parameters are present", () => {
    expect(() => guard.canActivate(contextFor({
      method: "POST",
      url: "/api/v1/attendance/registers/?school_id=sample",
      publicDemo: true,
    }))).toThrowError(ForbiddenException);
  });
});
