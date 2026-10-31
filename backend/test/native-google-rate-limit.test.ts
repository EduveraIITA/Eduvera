import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { rateLimitHook, rateLimitRule } from "../src/common/rate-limit.js";
vi.mock("../src/config.js", () => ({ config: () => ({ rateLimitStore: "memory" }) }));

describe("native Google handoff keeps the existing Google IP ceremony budgets", () => {
  const app = fastify({ routerOptions: { ignoreTrailingSlash: true } });
  const reads = ["/api/v1/auth/google/config/", "/api/v1/auth/native/google/config/", "/api/v1/auth/native/google/authorize/"];
  const writes = ["/api/v1/auth/google/", "/api/v1/auth/native/google/start/", "/api/v1/auth/native/google/proof/", "/api/v1/auth/native/google/exchange/"];
  beforeAll(async () => {
    app.addHook("onRequest", rateLimitHook({} as DatabaseService));
    for (const path of reads) app.get(path, () => ({ accepted: true }));
    for (const path of writes) app.post(path, () => ({ accepted: true }));
    app.post("/api/v1/auth/native/login/", () => ({ accepted: true })); await app.ready();
  });
  afterAll(async () => { await app.close(); });
  it("uses the original 20-per-minute rule for every native Google phase", () => {
    for (const path of [...reads, ...writes]) expect(rateLimitRule(path, reads.includes(path) ? "GET" : "POST")).toEqual({ limit: 20, windowMs: 60_000 });
  });
  it.each([{ method: "GET" as const, paths: reads, ip: "192.0.2.121" }, { method: "POST" as const, paths: writes, ip: "192.0.2.122" }])("counts all $method transports and phases in one real hook bucket", async ({ method, paths, ip }) => {
    for (let index = 0; index < 20; index++) {
      const path = paths[index % paths.length]!, url = index % 2 ? path : path.slice(0, -1) + "?attempt=alternate";
      const response = await app.inject({ method, url, remoteAddress: ip }); expect(response.statusCode).toBe(200); expect(response.headers["x-ratelimit-limit"]).toBe("20"); expect(response.headers["x-ratelimit-remaining"]).toBe(String(19 - index));
    }
    for (const url of paths) { const blocked = await app.inject({ method, url, remoteAddress: ip }); expect(blocked.statusCode).toBe(429); expect(blocked.headers["x-ratelimit-remaining"]).toBe("0"); }
    expect((await app.inject({ method, url: paths[0]!, remoteAddress: "198.51.100.125" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/native/login/", remoteAddress: ip })).statusCode).toBe(200);
  });
});
