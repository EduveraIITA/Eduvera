import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { rateLimitHook } from "../src/common/rate-limit.js";

describe("native and web auth share the actual IP rate-limit hook budget", () => {
  const app = fastify({ routerOptions: { ignoreTrailingSlash: true } });
  const ceremonies = [
    { path: "login", limit: 10 }, { path: "register", limit: 5 },
    { path: "password-reset/request", limit: 5 }, { path: "mfa/login", limit: 10 },
    { path: "public-demo-session", limit: 10 },
    { path: "demo-profile-switch", limit: 300 },
  ] as const;
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "test");
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:1/auth_ceremony_rate_limit_unused_test");
    vi.stubEnv("CAMPUS_SIMULATION_DATABASE_URL", undefined);
    vi.stubEnv("INVITATION_EMAIL_ENABLED", "false");
    // These tests execute the real hook and memory bucket, with no credential
    // workflow, mocked rate-limit logic, database access or external effects.
    app.addHook("onRequest", rateLimitHook({} as DatabaseService));
    for (const { path } of ceremonies) for (const prefix of ["", "native/"]) {
      app.post(`/api/v1/auth/${prefix}${path}/`, () => ({ accepted: true }));
    }
    app.post("/api/v1/agent/threads/:thread/messages/", () => ({ accepted: true }));
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllEnvs(); });

  it.each(ceremonies)("counts alternating native/web $path requests in one $limit-request bucket", async ({ path, limit }) => {
    const remoteAddress = `192.0.2.${ceremonies.findIndex(item => item.path === path) + 10}`;
    for (let attempt = 0; attempt < limit; attempt++) {
      const prefix = attempt % 2 ? "native/" : "";
      const suffix = attempt % 3 ? "/" : "?transport=alternating";
      const response = await app.inject({ method: "POST", url: `/api/v1/auth/${prefix}${path}${suffix}`, remoteAddress });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["x-ratelimit-limit"]).toBe(String(limit));
      expect(response.headers["x-ratelimit-remaining"]).toBe(String(limit - attempt - 1));
    }
    for (const prefix of ["", "native/"]) {
      const rejected = await app.inject({ method: "POST", url: `/api/v1/auth/${prefix}${path}/`, remoteAddress });
      expect(rejected.statusCode).toBe(429);
      expect(rejected.headers["x-ratelimit-remaining"]).toBe("0");
      expect(Number(rejected.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(rejected.json()).toMatchObject({ error: { code: "rate_limited" } });
    }
    expect((await app.inject({ method: "POST", url: `/api/v1/auth/native/${path}/`, remoteAddress: "198.51.100.25" })).statusCode).toBe(200);
  });

  it("retains independent ceremony budgets and the existing cross-thread Assistant budget", async () => {
    const remoteAddress = "203.0.113.42";
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/login/", remoteAddress })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/api/v1/agent/threads/${attempt}/messages/`, remoteAddress })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/login/", remoteAddress })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/register/", remoteAddress })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/agent/threads/another/messages/", remoteAddress })).statusCode).toBe(429);
  });
});
