import "reflect-metadata";
import cookie from "@fastify/cookie";
import { Controller, Get, Module, Post, Req } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { NativeAuthController } from "../src/auth/native-auth.controller.js";
import { CsrfGuard, PublicDemoGuard, SessionGuard } from "../src/auth/guards.js";
import { liveSessionExecutionEnvironment, unavailableSimulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import { AuditService } from "../src/common/audit.service.js";
import { rateLimitRule } from "../src/common/rate-limit.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";

vi.mock("../src/config.js", () => ({ config: () => ({ SESSION_COOKIE_NAME: "native_test_session",
  SESSION_TTL_SECONDS: 28800, PUBLIC_DEMO_SESSION_TTL_SECONDS: 1800, COOKIE_SECRET: "native-transport-test-cookie-secret-1234567890", DEMO_MODE: false }) }));

const user: AuthUser = { id: "00000000-0000-4000-8000-000000000001", username: "native.teacher",
  email: "native@example.test", first_name: "Native", last_name: "Teacher", role: "staff", is_active: true,
  active_school_id: "00000000-0000-4000-8000-000000000002" };
const nativeToken = `tc_native_${"a".repeat(43)}`;
const webToken = "web-session";
const live = liveSessionExecutionEnvironment(user.active_school_id);
const identity = () => ({ user, tokenHash: AuthService.tokenHash(nativeToken), csrfToken: "native-csrf",
  expiresAt: "2099-01-01T00:00:00.000Z", publicDemo: false,
  executionEnvironment: live.environment, executionEnvironmentView: live.view });
const tokens = new Map<string, ReturnType<typeof identity>>();
const admin: AuthUser = { ...user, id: "00000000-0000-4000-8000-000000000003", username: "demo.admin", role: "admin" };
const switchedToken = `tc_native_${"c".repeat(43)}`;
const audit = { record: vi.fn().mockResolvedValue(undefined) };
const auth = {
  login: vi.fn((body: { identifier: string }) => Promise.resolve(body.identifier === "mfa" ? { user, mfaChallenge: "challenge" } : { user })),
  completeMfaLogin: vi.fn((body: { code: string }) => body.code === "123456" ? Promise.resolve(user) : Promise.reject(new Error("Bad MFA proof"))),
  register: vi.fn(() => Promise.resolve({ user, verification: { required: true } })),
  publicDemoUser: vi.fn(() => Promise.resolve(user)),
  canUseDemoProfileSwitcher: vi.fn(() => true),
  demoProfile: vi.fn((role: string) => Promise.resolve(role === "admin" ? admin : user)),
  returnSessionToLive: vi.fn(() => Promise.resolve()),
  response: vi.fn((actor: AuthUser, csrf: string, view = live.view) => ({ user: actor, csrf_token: csrf, execution_environment: view })),
  createSession: vi.fn((_actor?: AuthUser, _request?: FastifyRequest, options?: { publicDemo?: boolean; transport?: string; ttlSeconds?: number }) => { tokens.set(nativeToken, {...identity(), publicDemo: options?.publicDemo === true}); return Promise.resolve({ rawToken: nativeToken, csrfToken: "native-csrf", expiresAt: identity().expiresAt }); }),
  resolveSession: vi.fn((token: string) => Promise.resolve(tokens.get(token) ?? null)),
  logout: vi.fn((hash: string) => { for (const [token, session] of tokens) if (session.tokenHash === hash) tokens.delete(token); return Promise.resolve(); }),
  requestPasswordReset: vi.fn(() => Promise.resolve({ accepted: true })),
  confirmPasswordReset: vi.fn(() => Promise.resolve({ updated: true })),
};

@Controller("api/v1/native-transport-probe")
class ProbeController {
  @Get()
  read(@Req() request: AuthenticatedRequest) {
    return { id: request.authUser.id, transport: request.sessionTransport, environment: request.executionEnvironmentView };
  }
  @Post()
  write(@Req() request: AuthenticatedRequest) { return this.read(request); }
}

@Module({ controllers: [NativeAuthController, ProbeController], providers: [
  { provide: AuthService, useValue: auth }, { provide: AuditService, useValue: audit },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new SessionGuard(reflector, auth as never, { consume: () => null } as never) },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new CsrfGuard(reflector) },
  { provide: APP_GUARD, useClass: PublicDemoGuard },
] })
class TransportTestModule {}

describe("native auth HTTP transport through ordinary session and CSRF guards", () => {
  let app: NestFastifyApplication;
  const bearer = { authorization: `Bearer ${nativeToken}` };
  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(TransportTestModule, new FastifyAdapter({ routerOptions: { ignoreTrailingSlash: true } }), { logger: false });
    await app.register(cookie, { secret: "native-transport-test-cookie-secret-1234567890" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app.close(); });

  it("issues an explicitly native token without cookies and restores its server-selected scope", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/native/login/", payload: { identifier: user.username, password: "test-password" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json()).toMatchObject({ access_token: nativeToken, token_type: "Bearer", expires_at: identity().expiresAt,
      user: { active_school_id: user.active_school_id }, execution_environment: live.view });
    const restored = await app.inject({ url: "/api/v1/auth/native/session/", headers: bearer });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ authenticated: true, expires_at: identity().expiresAt, execution_environment: live.view });
    expect(restored.json()).not.toHaveProperty("access_token");
    const command = await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: { ...bearer,
      "x-thatcampus-execution-environment": "scenario:forged:run:forged" } });
    expect(command.statusCode).toBe(201);
    expect(command.json()).toMatchObject({ id: user.id, transport: "bearer", environment: live.view });
  });

  it("does not issue a credential until existing MFA has completed", async () => {
    const before = auth.createSession.mock.calls.length;
    const challenge = await app.inject({ method: "POST", url: "/api/v1/auth/native/login/", payload: { identifier: "mfa", password: "test-password" } });
    expect(challenge.statusCode).toBe(202);
    expect(challenge.json()).toEqual({ mfa_required: true, challenge_token: "challenge" });
    expect(auth.createSession.mock.calls.length).toBe(before);
    const completed = await app.inject({ method: "POST", url: "/api/v1/auth/native/mfa/login/", payload: { challenge_token: "challenge", code: "123456" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toHaveProperty("access_token", nativeToken);
  });

  it("registers through the existing account workflow and exposes native reset ceremonies", async () => {
    const registered = await app.inject({ method: "POST", url: "/api/v1/auth/native/register/", payload: { email: user.email, password: "test-password" } });
    expect(registered.statusCode).toBe(201);
    expect(registered.json()).toMatchObject({ access_token: nativeToken, verification: { required: true }, onboarding: { status: "purpose_required" } });
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/password-reset/request/", payload: { email: user.email } })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/password-reset/confirm/", payload: { token: "reset-proof", password: "test-password" } })).statusCode).toBe(200);
  });

  it.each(["Basic private", "Bearer malformed", `Bearer ${nativeToken} extra`, "", `Bearer ${"b".repeat(43)}`])("refuses malformed/native-ineligible bearer %j without falling back to a valid cookie", async authorization => {
    tokens.set(webToken, { ...identity(), tokenHash: AuthService.tokenHash(webToken) });
    const signed = app.getHttpAdapter().getInstance().signCookie(webToken);
    const response = await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: { authorization, cookie: `native_test_session=${encodeURIComponent(signed)}` } });
    expect(response.statusCode).toBe(401);
  });

  it("refuses simultaneous valid bearer and cookie credentials", async () => {
    const signed = app.getHttpAdapter().getInstance().signCookie(webToken);
    const response = await app.inject({ url: "/api/v1/native-transport-probe", headers: { ...bearer, cookie: `native_test_session=${encodeURIComponent(signed)}` } });
    expect(response.statusCode).toBe(401);
  });

  it("keeps cookie reads and CSRF-protected web writes intact", async () => {
    tokens.set(webToken, { ...identity(), tokenHash: AuthService.tokenHash(webToken) });
    const server = app.getHttpAdapter().getInstance();
    const sessionCookie = `native_test_session=${encodeURIComponent(server.signCookie(webToken))}`;
    expect((await app.inject({ url: "/api/v1/native-transport-probe", headers: { cookie: sessionCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: { cookie: sessionCookie } })).statusCode).toBe(403);
    const csrf = server.signCookie("native-csrf");
    expect((await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: {
      cookie: `${sessionCookie}; csrftoken=${encodeURIComponent(csrf)}`, "x-csrftoken": csrf } })).statusCode).toBe(201);
    expect((await app.inject({ url: "/api/v1/auth/native/session/", headers: { cookie: sessionCookie } })).statusCode).toBe(401);
  });

  it("retains unavailable-Simulation refusal and control-plane recovery for native sessions", async () => {
    const unavailable = unavailableSimulationSessionExecutionEnvironment({ school_id: user.active_school_id!,
      scenario_id: "scenario", run_id: "run", namespace_id: "scenario:one:run:one", expires_at: "2099-01-01T00:00:00Z" }, "data_plane_unavailable");
    tokens.set(nativeToken, { ...identity(), executionEnvironment: unavailable.environment, executionEnvironmentView: unavailable.view });
    const refused = await app.inject({ url: "/api/v1/native-transport-probe", headers: bearer });
    expect(refused.statusCode).toBe(410);
    const current = await app.inject({ url: "/api/v1/auth/native/session/", headers: bearer });
    expect(current.statusCode).toBe(200);
    expect(current.json().execution_environment).toMatchObject({ mode: "simulation", unavailable: true });
    const before = auth.register.mock.calls.length;
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/register/", headers: bearer, payload: { email: user.email, password: "test-password" } })).statusCode).toBe(403);
    expect(auth.register.mock.calls.length).toBe(before);
    tokens.set(nativeToken, identity());
  });

  it("revokes the native credential durably on logout and refuses subsequent use", async () => {
    tokens.set(nativeToken, identity());
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/logout/", headers: bearer })).statusCode).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith(AuthService.tokenHash(nativeToken));
    expect((await app.inject({ url: "/api/v1/auth/native/session/", headers: bearer })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: bearer })).statusCode).toBe(401);
  });

  it("requires an eligible native Bearer session before switching demo profiles", async () => {
    const before = auth.createSession.mock.calls.length;
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", payload: { role: "admin" } })).statusCode).toBe(401);
    tokens.set(webToken, { ...identity(), tokenHash: AuthService.tokenHash(webToken) });
    const cookieHeader = `native_test_session=${encodeURIComponent(app.getHttpAdapter().getInstance().signCookie(webToken))}`;
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", headers: { cookie: cookieHeader }, payload: { role: "admin" } })).statusCode).toBe(401);
    tokens.set(nativeToken, identity());
    auth.canUseDemoProfileSwitcher.mockReturnValueOnce(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", headers: bearer, payload: { role: "admin" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", headers: bearer, payload: { role: "owner" } })).statusCode).toBe(400);
    expect(auth.createSession.mock.calls.length).toBe(before);
  });

  it("returns the current demo profile to Live without rotating or exposing its credential", async () => {
    const unavailable = unavailableSimulationSessionExecutionEnvironment({ school_id: user.active_school_id!, scenario_id: "scenario", run_id: "run", namespace_id: "scenario:one:run:one", expires_at: "2099-01-01T00:00:00Z" }, "data_plane_unavailable");
    tokens.set(nativeToken, { ...identity(), executionEnvironment: unavailable.environment, executionEnvironmentView: unavailable.view });
    const created = auth.createSession.mock.calls.length, revoked = auth.logout.mock.calls.length;
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", headers: bearer, payload: { role: "staff" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json()).toMatchObject({ user: { id: user.id }, session_retained: true, public_demo: false, redirect_to: "/today", execution_environment: live.view });
    expect(response.json()).not.toHaveProperty("access_token");
    expect(auth.returnSessionToLive).toHaveBeenLastCalledWith(AuthService.tokenHash(nativeToken));
    expect(auth.createSession.mock.calls.length).toBe(created); expect(auth.logout.mock.calls.length).toBe(revoked);
  });

  it.each([false, true])("rotates only the selected demo actor and preserves public-demo=%s without cookies", async publicDemo => {
    tokens.set(nativeToken, { ...identity(), publicDemo });
    auth.createSession.mockImplementationOnce((actor, _request, options) => {
      tokens.set(switchedToken, { ...identity(), user: actor!, tokenHash: AuthService.tokenHash(switchedToken), publicDemo: options?.publicDemo === true });
      return Promise.resolve({ rawToken: switchedToken, csrfToken: "switched-csrf", expiresAt: identity().expiresAt });
    });
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/native/demo-profile-switch/", headers: bearer, payload: { role: "admin" } });
    expect(response.statusCode).toBe(200); expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json()).toMatchObject({ user: { id: admin.id }, access_token: switchedToken, token_type: "Bearer", public_demo: publicDemo, redirect_to: "/today", execution_environment: live.view });
    expect(auth.createSession).toHaveBeenLastCalledWith(admin, expect.anything(), publicDemo ? { transport: "native", publicDemo: true, ttlSeconds: 1800 } : { transport: "native" });
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: "auth.demo_profile.switched", actorId: user.id, targetId: admin.id, metadata: { from_role: "staff", to_role: "admin" } }));
    expect((await app.inject({ url: "/api/v1/auth/native/session/", headers: bearer })).statusCode).toBe(401);
    const switched = { authorization: `Bearer ${switchedToken}` };
    expect((await app.inject({ url: "/api/v1/auth/native/session/", headers: switched })).json()).toMatchObject({ user: { id: admin.id }, public_demo: publicDemo });
    expect((await app.inject({ method: "POST", url: "/api/v1/native-transport-probe", headers: switched })).statusCode).toBe(publicDemo ? 403 : 201);
  });

  it("issues a short-lived read-only native demo and permits its real logout", async () => {
    const before = auth.publicDemoUser.mock.calls.length;
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/native/public-demo-session/', payload: {role:'owner'} })).statusCode).toBe(400);
    expect(auth.publicDemoUser.mock.calls.length).toBe(before);
    const response = await app.inject({method:'POST',url:'/api/v1/auth/native/public-demo-session/',payload:{role:'staff'}});
    expect(response.statusCode).toBe(200);expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.json()).toMatchObject({public_demo:true,access_token:nativeToken,token_type:'Bearer'});
    expect(auth.createSession).toHaveBeenLastCalledWith(user,expect.anything(),{transport:'native',publicDemo:true,ttlSeconds:1800});
    expect((await app.inject({url:'/api/v1/auth/native/session/',headers:bearer})).json()).toMatchObject({public_demo:true});
    expect((await app.inject({method:'POST',url:'/api/v1/native-transport-probe',headers:bearer})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/auth/native/logout/',headers:bearer})).statusCode).toBe(204);
    expect((await app.inject({url:'/api/v1/auth/native/session/',headers:bearer})).statusCode).toBe(401);
  });
});

describe("native sessions reuse durable existing session records", () => {
  it("stores only a hash with the ordinary expiry and retains the selected institution", async () => {
    let stored: Record<string, unknown> | undefined;
    const db = { insertInto: () => ({ values: (values: Record<string, unknown>) => { stored = values; return { execute: () => Promise.resolve() }; } }) };
    const service = new AuthService(db as never, {} as never, {} as never, {} as never);
    const result = await service.createSession({ ...user }, { ip: "127.0.0.1", headers: { "user-agent": "ThatCampus native test" } } as FastifyRequest, { transport: "native" });
    expect(result.rawToken).toMatch(/^tc_native_[A-Za-z0-9_-]{43}$/u);
    expect(stored).toMatchObject({ token_hash: AuthService.tokenHash(result.rawToken), active_school_id: user.active_school_id, user_id: user.id });
    expect(JSON.stringify(stored)).not.toContain(result.rawToken);
    expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(28_799_000);
    expect(new Date(result.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(28_800_000);
  });

  it.each(["login/", "public-demo-session/", "demo-profile-switch/", "mfa/login/", "register/", "password-reset/request/", "password-reset/confirm/"])("applies web-equivalent abuse limits to %s", path => {
    expect(rateLimitRule(`/api/v1/auth/native/${path}`, "POST")).toEqual(rateLimitRule(`/api/v1/auth/${path}`, "POST"));
  });
});
