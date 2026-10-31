import fastify from "fastify";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import * as configuration from "../src/config.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { DatabasePoolTelemetry } from "../src/database/pool-telemetry.js";
import { ApiExceptionFilter } from "../src/common/errors.js";
import { rateLimitHook } from "../src/common/rate-limit.js";
import type { RequestWithContext } from "../src/common/request.js";

describe("canonical responses to known database admission failures", () => {
  const earlyFailure = async (method: "GET" | "POST") => {
    const failure = new Error("Private connection failure must not enter response");
    const nativePool = new Pool({ max: 4 }), telemetry = new DatabasePoolTelemetry(nativePool);
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: {
      connect: () => telemetry.observeAcquisition(() => Promise.reject(failure)), end: () => nativePool.end(),
    } }) }) as DatabaseService;
    const settings = vi.spyOn(configuration, "config").mockReturnValue({ rateLimitStore: "postgres" } as ReturnType<typeof configuration.config>);
    const app = fastify(); let actions = 0;
    try {
      app.addHook("onRequest", (request, _reply, done) => { (request as RequestWithContext).requestId = "bounded-request-id"; done(); });
      app.addHook("onRequest", rateLimitHook(db));
      // Sending can remain pending while real response hooks finish. The domain
      // handler must never run in that interval, including on writes.
      app.addHook("onSend", async (_request, _reply, payload) => { await new Promise(resolve => setTimeout(resolve, 20)); return payload; });
      app.route({ method, url: "/api/v1/example/", handler() { actions++; return { accepted: true }; } });
      const response = await app.inject({ method, url: "/api/v1/example/" });
      expect(response.statusCode).toBe(503); expect(actions).toBe(0);
      expect(response.json()).toMatchObject({ error: { status: 503, code: "service_unavailable", request_id: "bounded-request-id" } });
      expect(response.body).not.toContain(failure.message);
      if (method === "GET") { expect(response.headers["retry-after"]).toBe("2"); expect(response.json().error.detail).toContain("try again shortly"); }
      else { expect(response.headers["retry-after"]).toBeUndefined(); expect(response.json().error.detail).toContain("could not be confirmed"); }
      expect(telemetry.snapshot().acquisition_failures_total).toBe(1);
    } finally { await app.close(); await db.destroy(); settings.mockRestore(); }
  };

  const controllerFailure = async (method: "GET" | "POST") => {
    const pool = new Pool({ max: 4 }), telemetry = new DatabasePoolTelemetry(pool), known = new Error("Private original error");
    await telemetry.observeAcquisition(() => Promise.reject(known)).catch(() => {});
    const app = fastify(), filter = new ApiExceptionFilter();
    try {
      app.route({ method, url: "/api/v1/domain/", handler(request, reply) {
        (request as RequestWithContext).requestId = "domain-request-id";
        filter.catch(known, { switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }) } as ArgumentsHost);
        return reply;
      } });
      app.get("/api/v1/unknown/", (request, reply) => {
        (request as RequestWithContext).requestId = "unknown-request-id";
        filter.catch(new Error("timeout exceeded when trying to connect"), {
          switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
        } as ArgumentsHost);
        return reply;
      });
      const response = await app.inject({ method, url: "/api/v1/domain/" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { status: 503, code: "service_unavailable", request_id: "domain-request-id" } });
      expect(response.body).not.toContain(known.message);
      expect(response.headers["retry-after"]).toBe(method === "GET" ? "2" : undefined);
      expect(response.json().error.detail.includes("could not be confirmed")).toBe(method === "POST");
      const unknown = await app.inject({ method: "GET", url: "/api/v1/unknown/" });
      expect(unknown.statusCode).toBe(500); expect(unknown.json().error.code).toBe("internal_error");
      expect(unknown.body).not.toContain("timeout exceeded");
    } finally { await app.close(); await pool.end(); }
  };
  it("stops a read before its controller despite delayed response hooks", () => earlyFailure("GET"));
  it("stops a write before its controller despite delayed response hooks", () => earlyFailure("POST"));
  it("returns the same read envelope through the exception filter and preserves unknown failures", () => controllerFailure("GET"));
  it("keeps controller write outcomes unconfirmed and preserves unknown failures", () => controllerFailure("POST"));
});
