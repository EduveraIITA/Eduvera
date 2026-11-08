import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { CsrfGuard, SessionGuard } from "../src/auth/guards.js";
import { liveSessionExecutionEnvironment, unavailableSimulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import { LIVE_ACCOUNT_CONTROL, LiveAccountControl, Public } from "../src/common/decorators.js";
import type { RequestWithContext } from "../src/common/request.js";
import { OperationsController } from "../src/operations/operations.controller.js";
import { AuthController } from '../src/auth/auth.controller.js';

vi.mock("../src/config.js", () => ({ config: () => ({ SESSION_COOKIE_NAME: "test_session" }) }));

class PublicController {
  @Public()
  @LiveAccountControl()
  marked(this: void) {}

  @Public()
  ordinary(this: void) {}
}

const schoolId = "00000000-0000-4000-8000-000000000001";
function fixture(options: { cookie?: string; signed?: boolean; identity?: unknown; ordinary?: boolean } = {}) {
  const unsignCookie = vi.fn(() => ({ valid: options.signed !== false, value: "raw-session-private" }));
  const request = {
    url: "/api/v1/invitations/recipient-proof/", method: "POST", headers: {},
    cookies: options.cookie ? { test_session: options.cookie } : {},
    unsignCookie,
  } as unknown as RequestWithContext;
  const controller = new PublicController();
  const context = {
    getHandler: () => options.ordinary ? controller.ordinary : controller.marked,
    getClass: () => PublicController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const auth = { resolveSession: vi.fn().mockResolvedValue(options.identity ?? null) };
  const guard = new SessionGuard(new Reflector(), auth as never, { consume: vi.fn() } as never);
  return { request, context, auth, guard, unsignCookie };
}
function liveIdentity(extra: Record<string, unknown> = {}) {
  const live = liveSessionExecutionEnvironment(schoolId);
  return { user: { id: "private-account-id" }, tokenHash: "private-session-hash", csrfToken: "session-csrf",
    publicDemo: false, executionEnvironment: live.environment, executionEnvironmentView: live.view, ...extra };
}

describe("public Live account-control session boundary", () => {
  it("marks only the intended invitation ceremonies in the owning controller", () => {
    const reflector = new Reflector();
    const metadata = (name: string) => reflector.get(LIVE_ACCOUNT_CONTROL,
      Reflect.get(OperationsController.prototype, name) as () => unknown);
    expect(metadata("accept")).toBe(true);
    expect(metadata("recipientProof")).toBe(true);
    expect(metadata("nativeAccept")).toBe(true);
    expect(metadata("nativeRecipientProof")).toBe(true);
    expect(metadata("overview")).toBeUndefined();
    for (const name of ['register','passwordResetRequest','passwordResetConfirm'])
      expect(reflector.get(LIVE_ACCOUNT_CONTROL, Reflect.get(AuthController.prototype, name) as () => unknown)).toBe(true);
  });

  it("leaves unmarked public endpoints unchanged without reading a session", async () => {
    const f = fixture({ ordinary: true, cookie: "signed", identity: liveIdentity() });
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.auth.resolveSession).not.toHaveBeenCalled();
    expect(f.unsignCookie).not.toHaveBeenCalled();
  });

  it("allows an anonymous recipient without manufacturing an identity", async () => {
    const f = fixture();
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.auth.resolveSession).not.toHaveBeenCalled();
    expect(f.request.authUser).toBeUndefined();
    expect(f.request.csrfToken).toBeUndefined();
  });

  it("does not treat an invalid signature or expired session as authenticated", async () => {
    const invalid = fixture({ cookie: "tampered", signed: false });
    expect(await invalid.guard.canActivate(invalid.context)).toBe(true);
    expect(invalid.auth.resolveSession).not.toHaveBeenCalled();
    expect(invalid.request.authUser).toBeUndefined();
    const expired = fixture({ cookie: "signed" });
    expect(await expired.guard.canActivate(expired.context)).toBe(true);
    expect(expired.auth.resolveSession).toHaveBeenCalledWith("raw-session-private");
    expect(expired.request.csrfToken).toBeUndefined();
  });

  it("binds a valid Live session's CSRF and transport view without granting campus authority", async () => {
    const identity = liveIdentity(), f = fixture({ cookie: "signed", identity });
    f.request.headers["x-thatcampus-execution-environment"] = `live:${schoolId}`;
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.request.csrfToken).toBe("session-csrf");
    expect(f.request.executionEnvironmentView).toEqual(identity.executionEnvironmentView);
    expect(f.request.executionEnvironment).toBeNull();
    expect(f.request.authUser).toBeUndefined();
    expect(f.request.sessionHash).toBeUndefined();
    f.request.cookies.csrftoken = "other-signed-csrf";
    f.request.headers["x-csrftoken"] = "other-signed-csrf";
    f.unsignCookie.mockReturnValue({ valid: true, value: "not-session-csrf" });
    expect(() => new CsrfGuard(new Reflector()).canActivate(f.context)).toThrow(/active session/);
  });

  it.each([false, true])("rejects a server-selected Simulation (unavailable=%s) without relying on a caller header", async unavailable => {
    const view = unavailableSimulationSessionExecutionEnvironment({ school_id: schoolId,
      scenario_id: "00000000-0000-4000-8000-000000000002", run_id: "00000000-0000-4000-8000-000000000003",
      namespace_id: "scenario:test:run:test", expires_at: "2030-01-01T00:00:00Z" }, "data_plane_unavailable").view;
    const simulationView = unavailable ? view : { ...view, unavailable: undefined };
    const f = fixture({ cookie: "signed", identity: liveIdentity({ executionEnvironment: null, executionEnvironmentView: simulationView }) });
    const controller = vi.fn();
    await expect(f.guard.canActivate(f.context).then(() => controller())).rejects.toMatchObject({ status: 403 });
    expect(f.request.headers["x-thatcampus-execution-environment"]).toBeUndefined();
    expect(controller).not.toHaveBeenCalled();
    expect(f.request.csrfToken).toBeUndefined();
    expect(f.request.authUser).toBeUndefined();
  });

  it("rejects read-only public-demo sessions before the account writer", async () => {
    const f = fixture({ cookie: "signed", identity: liveIdentity({ publicDemo: true }) });
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 403 });
    expect(f.request.csrfToken).toBeUndefined();
  });
});
