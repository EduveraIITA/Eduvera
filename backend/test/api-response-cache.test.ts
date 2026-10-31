import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerApiResponseCacheControl } from "../src/common/api-response-cache.js";

describe("session and environment dependent API response caching", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

  function server() {
    const app = Fastify();
    servers.push(app);
    registerApiResponseCacheControl(app);
    return app;
  }

  it("prevents storage of both successful workspace data and401/403/410 responses on the same URL", async () => {
    const app = server();
    app.get("/api/v1/workspace", (request, reply) => {
      const status = Number(request.headers["x-fixture-status"] ?? 200);
      // A later route cannot accidentally make this session-dependent response
      // cacheable, including heuristically cacheable terminal-world failures.
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.code(status).send({ status, actor: request.headers["x-fixture-actor"] });
    });
    for (const status of [200, 401, 403, 410]) {
      const response = await app.inject({ url: "/api/v1/workspace", headers: {
        "x-fixture-status": String(status), "x-fixture-actor": "first-session",
      } });
      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    const live = await app.inject({ url: "/api/v1/workspace", headers: { "x-fixture-actor": "new-live-session" } });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 200, actor: "new-live-session" });
    expect(live.headers["cache-control"]).toBe("private, no-store");
  });

  it("covers early plugin rejections, uncaught errors, auth writes and missing API routes", async () => {
    const app = server();
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/api/v1/early") return reply.code(403).send({ message: "Denied before controller" });
    });
    app.get("/api/v1/early", () => "unreachable");
    app.get("/api/v1/throw", () => { throw Object.assign(new Error("Unavailable world"), { statusCode: 410 }); });
    app.post("/api/v1/auth/logout", (_request, reply) => reply.code(204).send());
    for (const [method, url, expected] of [
      ["GET", "/api/v1/early", 403], ["GET", "/api/v1/throw", 410],
      ["POST", "/api/v1/auth/logout", 204], ["GET", "/api/v1/missing", 404],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(expected);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("preserves fingerprinted asset and SPA caching outside the API namespace", async () => {
    const app = server();
    app.get("/assets/app.hash.js", (_request, reply) => reply.header("Cache-Control", "public, max-age=31536000, immutable").send("asset"));
    app.get("/login", () => "SPA shell");
    expect((await app.inject("/assets/app.hash.js")).headers["cache-control"])
      .toBe("public, max-age=31536000, immutable");
    expect((await app.inject("/login")).headers["cache-control"]).toBeUndefined();
  });
});
