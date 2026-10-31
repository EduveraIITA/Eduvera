import "reflect-metadata";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { Module, UnauthorizedException } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { AuthController } from "../src/auth/auth.controller.js";
import { GoogleAuthService } from "../src/auth/google-auth.service.js";
import { CsrfGuard, PublicDemoGuard, SessionGuard } from "../src/auth/guards.js";
import { NativeGoogleController } from "../src/auth/native-google.controller.js";
import { NativeGoogleService } from "../src/auth/native-google.service.js";
import { NATIVE_GOOGLE_REDIRECT_URI, NATIVE_GOOGLE_ROOT } from "../src/auth/native-google-policy.js";
import { ApiExceptionFilter } from "../src/common/errors.js";
import type { AuthUser } from "../src/common/request.js";

const settings = vi.hoisted(() => ({ PUBLIC_URL: "https://login.example.test", GOOGLE_CLIENT_ID: "public-google-client", ALLOWED_ORIGINS: "https://login.example.test", COOKIE_SECRET: "test-only-native-google-cookie-key-32chars", COOKIE_SECURE: true, DEPLOYMENT_ENVIRONMENT: "test", NODE_ENV: "test", SESSION_COOKIE_NAME: "test_session" }));
vi.mock("../src/config.js", () => ({ config: () => settings }));
const user: AuthUser = { id: "00000000-0000-4000-8000-000000000001", username: "test.google", email: "test@example.test", first_name: "Test", last_name: "Person", role: "staff", is_active: true, active_school_id: "00000000-0000-4000-8000-000000000002" };
const verifier = "v".repeat(64), challenge = createHash("sha256").update(verifier).digest("base64url"), state = "s".repeat(43), nativeToken = `tc_native_${"n".repeat(43)}`, existingToken = `tc_native_${"e".repeat(43)}`, mfaToken = "m".repeat(43);
const rows = new Map<string, number>();
let nonceSequence = 0, mfa = false, accountActive = true, selectedSimulation = false, publicDemo = false;
const google = {
  issueNonce: vi.fn(async (seconds = 600) => { const nonce = Buffer.alloc(32, ++nonceSequence).toString("base64url"); rows.set(nonce, Date.now() + seconds * 1000); return nonce; }),
  hasNonce: vi.fn(async (nonce: string) => (rows.get(nonce) ?? 0) > Date.now()),
  consumeNonce: vi.fn(async (nonce: string) => { if ((rows.get(nonce) ?? 0) <= Date.now()) return false; rows.delete(nonce); return true; }),
  login: vi.fn(async (input: { credential: string }, nonce: string) => { if (input.credential !== "synthetic-google-credential" || !await google.consumeNonce(nonce)) throw new UnauthorizedException("Invalid primary proof"); return user; }),
  resolveNativeAccount: vi.fn(async (id: string, schoolId: string | null) => { if (!accountActive || id !== user.id || schoolId !== user.active_school_id) throw new UnauthorizedException("Account or campus changed"); return { ...user }; }),
};
const auth = {
  finishPrimaryLogin: vi.fn(async () => mfa ? { user, mfaChallenge: mfaToken } : { user }),
  finalizeNativeGoogleLogin: vi.fn(async (actor: AuthUser, request: FastifyRequest): Promise<{ user: AuthUser; mfaChallenge: string } | { user: AuthUser; session: { rawToken: string; csrfToken: string; expiresAt: string } }> => mfa ? { user: actor, mfaChallenge: mfaToken } : { user: actor, session: await auth.createSession(actor, request, { transport: "native" }) }),
  createSession: vi.fn(async (_user: AuthUser, _request: FastifyRequest, options: { transport: string }) => { expect(options).toEqual({ transport: "native" }); return { rawToken: nativeToken, csrfToken: "native-csrf", expiresAt: "2099-01-01T00:00:00.000Z" }; }),
  response: vi.fn((actor: AuthUser, csrf: string) => ({ user: actor, csrf_token: csrf, execution_environment: { mode: "live", institution_id: actor.active_school_id, namespace_id: null } })),
  resolveSession: vi.fn(async (token: string) => token === existingToken ? { user, csrfToken: "existing-csrf", publicDemo, executionEnvironmentView: { mode: selectedSimulation ? "simulation" : "live", unavailable: selectedSimulation } } : null),
};
const service = new NativeGoogleService(google as unknown as GoogleAuthService, auth as unknown as AuthService);
@Module({ controllers: [NativeGoogleController], providers: [
  { provide: NativeGoogleService, useValue: service },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new SessionGuard(reflector, auth as unknown as AuthService, { consume: () => null } as never) },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new CsrfGuard(reflector) },
  { provide: APP_GUARD, useClass: PublicDemoGuard },
] })
class TestModule {}

describe("native Google browser handoff through current session guards", () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter({ routerOptions: { ignoreTrailingSlash: true } }), { logger: false });
    await app.register(cookie, { secret: settings.COOKIE_SECRET });
    await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] } } });
    app.useGlobalFilters(new ApiExceptionFilter()); await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); rows.clear(); nonceSequence = 0; mfa = false; accountActive = true; selectedSimulation = false; publicDemo = false; settings.GOOGLE_CLIENT_ID = "public-google-client"; settings.PUBLIC_URL = "https://login.example.test"; });
  async function begin() {
    const response = await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/start/`, payload: { redirect_uri: NATIVE_GOOGLE_REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: "S256" } });
    expect(response.statusCode).toBe(200); expect(response.headers["set-cookie"]).toBeUndefined();
    const url = new URL(response.json().authorization_url); expect(url.origin).toBe(settings.PUBLIC_URL); expect([...url.searchParams.keys()]).toEqual(["request"]);
    const spy = vi.spyOn(service, "authorize"), page = await app.inject({ url: url.pathname + url.search });
    expect(page.statusCode).toBe(200); const prepared = await spy.mock.results.at(-1)!.value as Awaited<ReturnType<NativeGoogleService["authorize"]>>;
    const cookieHeader = page.headers["set-cookie"]; expect(typeof cookieHeader).toBe("string");
    const cookieValue = String(cookieHeader).split(";", 1)[0]!;
    return { page, prepared, cookie: cookieValue, payload: { request: url.searchParams.get("request")!, credential: "synthetic-google-credential", csrf: prepared.page.csrfProof } };
  }
  async function grant() { const flow = await begin(); const proof = await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/proof/`, headers: { origin: settings.PUBLIC_URL, cookie: flow.cookie }, payload: flow.payload }); expect(proof.statusCode).toBe(200); const callback = new URL(proof.json().redirect_url); return { ...flow, proof, callback, code: callback.searchParams.get("code")! }; }
  const exchange = (code: string, codeVerifier = verifier) => app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/exchange/`, payload: { code, code_verifier: codeVerifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI } });

  it("advertises only configured trusted origins and does not change global CSP", async () => {
    const config = await app.inject({ url: `${NATIVE_GOOGLE_ROOT}/config/` }); expect(config.json()).toEqual({ enabled: true, authorization_origin: settings.PUBLIC_URL });
    expect(config.headers["content-security-policy"]).toContain("script-src 'self'"); expect(config.headers["content-security-policy"]).not.toContain("accounts.google.com");
    settings.GOOGLE_CLIENT_ID = ""; expect((await app.inject({ url: `${NATIVE_GOOGLE_ROOT}/config/` })).json()).toEqual({ enabled: false });
    expect((await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/start/`, payload: {} })).statusCode).toBe(404);
    settings.GOOGLE_CLIENT_ID = "public-google-client"; settings.PUBLIC_URL = "https://foreign.example.test"; expect(service.configuration()).toEqual({ enabled: false });
  });
  it("serves a standalone nonced GIS page with only a scoped signed HttpOnly browser cookie", async () => {
    const { page, prepared } = await begin(); expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["content-security-policy"]).toContain(`'nonce-${prepared.page.scriptNonce}'`); expect(page.headers["referrer-policy"]).toBe("no-referrer");
    const cookies = String(page.headers["set-cookie"]); expect(cookies).toContain("native_google_browser="); expect(cookies).toContain("HttpOnly"); expect(cookies).toContain("Secure"); expect(cookies).toContain(`Path=${NATIVE_GOOGLE_ROOT}`); expect(cookies).not.toContain("test_session="); expect(cookies).not.toContain("csrftoken=");
    expect(page.body).toContain("https://accounts.google.com/gsi/client"); expect(page.body).not.toContain("/assets/");
  });
  it("exchanges a PKCE-bound single-use code for explicit native transport without web cookies", async () => {
    const { code, callback } = await grant(); expect([...callback.searchParams.keys()]).toEqual(["code", "state"]); expect(callback.searchParams.get("state")).toBe(state); expect(callback.origin).toBe("null"); expect(callback.protocol).toBe("thatcampus:"); expect(callback.host).toBe("auth"); expect(callback.pathname).toBe("/google");
    expect(callback.href).not.toContain("synthetic-google-credential"); expect(auth.createSession).not.toHaveBeenCalled();
    const response = await exchange(code); expect(response.statusCode).toBe(200); expect(response.headers["set-cookie"]).toBeUndefined(); expect(response.json()).toMatchObject({ access_token: nativeToken, token_type: "Bearer", user: { id: user.id }, execution_environment: { mode: "live" } });
    expect(auth.createSession).toHaveBeenCalledTimes(1); expect((await exchange(code)).statusCode).toBe(401); expect(auth.createSession).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong PKCE without consuming the valid grant, and refuses callback URI changes", async () => {
    const { code } = await grant(); expect((await exchange(code, "x".repeat(64))).statusCode).toBe(401); expect(auth.createSession).not.toHaveBeenCalled();
    const changed = await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/exchange/`, payload: { code, code_verifier: verifier, redirect_uri: "thatcampus://evil/google" } }); expect(changed.statusCode).toBe(400);
    expect((await exchange(code)).statusCode).toBe(200);
  });
  it("refuses tampered, expired and cross-phase envelopes without issuing a session", async () => {
    const flow = await grant(), pieces = flow.code.split("."); pieces[2] = `${pieces[2]![0] === "A" ? "B" : "A"}${pieces[2]!.slice(1)}`;
    expect((await exchange(pieces.join("."))).statusCode).toBe(401); expect((await exchange(flow.payload.request)).statusCode).toBe(401);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 60_001); expect((await exchange(flow.code)).statusCode).toBe(401); expect(auth.createSession).not.toHaveBeenCalled();
  });
  it("requires exact same-origin page proof and a cookie bound to this exact request", async () => {
    const first = await begin(), second = await begin();
    for (const origin of [undefined, "https://attacker.example.test"]) {
      const response = await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/proof/`, headers: { cookie: first.cookie, ...(origin ? { origin } : {}) }, payload: first.payload }); expect(response.statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/proof/`, headers: { cookie: first.cookie, origin: settings.PUBLIC_URL }, payload: { ...first.payload, csrf: "x".repeat(43) } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/proof/`, headers: { cookie: second.cookie, origin: settings.PUBLIC_URL }, payload: { ...first.payload, csrf: second.payload.csrf } })).statusCode).toBe(403);
    expect(google.login).not.toHaveBeenCalled();
  });
  it("claims requests atomically before Google/account effects and cannot mint a second grant", async () => {
    const flow = await begin(), send = () => app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/proof/`, headers: { cookie: flow.cookie, origin: settings.PUBLIC_URL }, payload: flow.payload });
    const results = await Promise.all([send(), send()]); expect(results.map(item => item.statusCode).sort()).toEqual([200, 401]); expect(google.login).toHaveBeenCalledTimes(1); expect(auth.finishPrimaryLogin).toHaveBeenCalledTimes(1);
  });
  it("retains the durable replay boundary across service replacement", async () => {
    const { code } = await grant(), replacement = new NativeGoogleService(google as unknown as GoogleAuthService, auth as unknown as AuthService);
    const request = { ip: "127.0.0.1", headers: {} } as FastifyRequest;
    expect(await replacement.exchange({ code, code_verifier: verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }, request)).toMatchObject({ access_token: nativeToken });
    await expect(service.exchange({ code, code_verifier: verifier, redirect_uri: NATIVE_GOOGLE_REDIRECT_URI }, request)).rejects.toThrow(/already used/);
  });
  it("freshly rechecks account authority after consuming a grant", async () => {
    const { code } = await grant(); accountActive = false; expect((await exchange(code)).statusCode).toBe(401); expect(auth.createSession).not.toHaveBeenCalled(); accountActive = true; expect((await exchange(code)).statusCode).toBe(401);
  });
  it("returns existing MFA only in the app exchange and issues no premature native session", async () => {
    mfa = true; const { callback, code } = await grant(); expect(callback.href).not.toContain(mfaToken); expect(auth.createSession).not.toHaveBeenCalled();
    const response = await exchange(code); expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ mfa_required: true, challenge_token: mfaToken }); expect(response.headers["set-cookie"]).toBeUndefined(); expect(auth.createSession).not.toHaveBeenCalled();
  });
  it("requires fresh MFA when it was enabled after browser proof", async () => {
    const { code } = await grant(); mfa = true;
    const response = await exchange(code);
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ mfa_required: true, challenge_token: mfaToken });
    expect(auth.createSession).not.toHaveBeenCalled(); expect(auth.finishPrimaryLogin).toHaveBeenCalledTimes(1); expect(auth.finalizeNativeGoogleLogin).toHaveBeenCalledTimes(1);
    expect((await exchange(code)).statusCode).toBe(401);
  });
  it("applies the existing Live-only account fence to every new route including GETs", async () => {
    for (const mode of ["simulation", "public-demo"]) {
      selectedSimulation = mode === "simulation"; publicDemo = mode === "public-demo";
      for (const [method, path] of [["GET", "config"], ["POST", "start"], ["GET", "authorize"], ["POST", "proof"], ["POST", "exchange"]] as const) {
        const response = await app.inject({ method, url: `${NATIVE_GOOGLE_ROOT}/${path}/`, headers: { authorization: `Bearer ${existingToken}` }, ...(method === "POST" ? { payload: {} } : {}) }); expect(response.statusCode, `${mode}:${path}`).toBe(403);
      }
    }
    expect(google.issueNonce).not.toHaveBeenCalled(); expect(google.login).not.toHaveBeenCalled(); expect(auth.createSession).not.toHaveBeenCalled();
  });
  it("also fences the existing web Google routes against a selected Simulation/public demo", async () => {
    const guard = new SessionGuard(new Reflector(), auth as unknown as AuthService, { consume: () => null } as never);
    for (const handler of [AuthController.prototype.googleConfig, AuthController.prototype.googleLogin]) {
      const request = { headers: { authorization: `Bearer ${existingToken}` }, cookies: {} };
      const context = { getHandler: () => handler, getClass: () => AuthController, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      selectedSimulation = true; publicDemo = false; await expect(guard.canActivate(context)).rejects.toThrow(/Live/);
      selectedSimulation = false; publicDemo = true; await expect(guard.canActivate(context)).rejects.toThrow(/demo/);
      publicDemo = false; await expect(guard.canActivate(context)).resolves.toBe(true);
      request.headers.authorization = ""; delete (request.headers as Partial<typeof request.headers>).authorization; await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });
  it("rejects malformed state, PKCE method, extra start fields and authorize selectors", async () => {
    const input = { redirect_uri: NATIVE_GOOGLE_REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: "S256" };
    for (const changed of [{ ...input, state: "short" }, { ...input, code_challenge_method: "plain" }, { ...input, next: "/company" }, { ...input, redirect_uri: `${NATIVE_GOOGLE_REDIRECT_URI}?token=bad` }]) expect((await app.inject({ method: "POST", url: `${NATIVE_GOOGLE_ROOT}/start/`, payload: changed })).statusCode).toBe(400);
    const flow = await begin(); expect((await app.inject({ url: `${NATIVE_GOOGLE_ROOT}/authorize/?${new URLSearchParams({ request: flow.payload.request, next: "/company" })}` })).statusCode).toBe(400);
  });
});
