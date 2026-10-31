import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import type { DatabaseService } from "../database/database.service.js";
import { config } from "../config.js";
import { isDatabasePoolAcquisitionFailure } from "../database/pool-telemetry.js";
import { sendDatabaseUnavailable } from "./errors.js";
import type { RequestWithContext } from "./request.js";

// Single-process buckets. Zero round trips; not shared across instances.
const memoryBuckets = new Map<string, { hits: number; expiresAt: number }>();
function memoryHit(key: string, windowMs: number): { hits: number; expires_at: Date } {
  const now = Date.now();
  const existing = memoryBuckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    const bucket = { hits: 1, expiresAt: now + windowMs };
    memoryBuckets.set(key, bucket);
    return { hits: 1, expires_at: new Date(bucket.expiresAt) };
  }
  existing.hits += 1;
  return { hits: existing.hits, expires_at: new Date(existing.expiresAt) };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) if (bucket.expiresAt <= now) memoryBuckets.delete(key);
}, 60_000).unref();

function authCeremonyPath(path: string): string {
  if (/^\/api\/v1\/auth\/native\/invitations\/(?:accept|recipient-proof)\/$/u.test(path))
    return path.replace("/auth/native/invitations/", "/invitations/");
  const authPath = path.replace(/^\/api\/v1\/auth\/native\//u, "/api/v1/auth/");
  // Browser handoff steps share the existing Google read/write budgets across
  // web/native transports and phases; adding a phase cannot multiply a bucket.
  if (/^\/api\/v1\/auth\/google\/(?:start|proof|exchange)\/$/u.test(authPath)) return "/api/v1/auth/google/";
  if (authPath === "/api/v1/auth/google/authorize/") return "/api/v1/auth/google/config/";
  return authPath;
}

function normalizedRateLimitRule(path: string, method: string): { limit: number; windowMs: number } {
  if (/\/campus-view\/scenarios\/targets\/$/.test(path)) return { limit: 12, windowMs: 60_000 };
  if (method === "POST" && /\/campus-view\/scenarios\/$/.test(path)) return { limit: 6, windowMs: 60_000 };
  if (/\/agent\/threads\/[^/]+\/messages\/?$/.test(path)) return { limit: 10, windowMs: 60_000 };
  if (/\/agent\/threads\/?$/.test(path)) return { limit: 60, windowMs: 60_000 };
  if (path.replace(/\/$/, "").endsWith("/invitations/accept")) return { limit: 10, windowMs: 60_000 };
  if (path.replace(/\/$/, "").endsWith("/invitations/recipient-proof")) return { limit: 10, windowMs: 60_000 };
  if (path.endsWith("/auth/register/")) return { limit: 5, windowMs: 60 * 60_000 };
  if (path.endsWith("/auth/google/") || path.endsWith("/auth/google/config/")) return { limit: 20, windowMs: 60_000 };
  if (path.endsWith("/auth/login/") || path.endsWith("/auth/demo-session/") || path.endsWith("/auth/public-demo-session/")) return { limit: 10, windowMs: 60_000 };
  if (path.endsWith("/auth/mfa/login/")) return { limit: 10, windowMs: 5 * 60_000 };
  if (path.endsWith("/auth/password-reset/request/") || path.endsWith("/auth/email-verification/request/")) return { limit: 5, windowMs: 60 * 60_000 };
  if (path.endsWith("/auth/password-reset/confirm/") || path.endsWith("/auth/email-verification/confirm/") || path.endsWith("/auth/mfa/confirm/")) return { limit: 10, windowMs: 10 * 60_000 };
  if (path.endsWith("/ai/attendance/query/")) return { limit: 10, windowMs: 60_000 };
  return { limit: 300, windowMs: 60_000 };
}

export function rateLimitRule(path: string, method = "GET"): { limit: number; windowMs: number } {
  return normalizedRateLimitRule(authCeremonyPath(path), method);
}

export function rateLimitHook(db: DatabaseService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = (request.url.split("?")[0] ?? request.url).replace(/\/+$/, '') + '/';
    if (!path.startsWith("/api/")) return;
    // Normalize once for both rule selection and the persisted/memory key, so
    // alternating native and web transports cannot double the same IP budget.
    const ceremonyPath = authCeremonyPath(path);
    const { limit, windowMs } = normalizedRateLimitRule(ceremonyPath, request.method);
    const normalizedPath = ceremonyPath.replace(/\/agent\/threads\/[^/]+\/messages\/?$/, '/agent/messages');
    const bucketKey = createHash("sha256").update(`${request.ip}:${request.method}:${normalizedPath}`).digest("hex");
    const expiresAt = new Date(Date.now() + windowMs);
    let bucket: { hits: number; expires_at: Date };
    if (config().rateLimitStore === "memory") {
      bucket = memoryHit(bucketKey, windowMs);
    } else {
      try {
        const result = await sql<{ hits: number; expires_at: Date }>`
        INSERT INTO api_rate_limit_buckets(bucket_key, hits, expires_at)
        VALUES (${bucketKey}, 1, ${expiresAt})
        ON CONFLICT(bucket_key) DO UPDATE SET
          hits = CASE WHEN api_rate_limit_buckets.expires_at <= now() THEN 1 ELSE api_rate_limit_buckets.hits + 1 END,
          expires_at = CASE WHEN api_rate_limit_buckets.expires_at <= now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
        RETURNING hits, expires_at
      `.execute(db);
        bucket = result.rows[0]!;
      } catch (error) {
        if (!isDatabasePoolAcquisitionFailure(error)) throw error;
        // Fastify's onRequest hook runs before Nest's exception filter. Keep
        // this failure in the same canonical API envelope as controller reads.
        request.log.error({ err: error, requestId: (request as RequestWithContext).requestId }, "Rate-limit connection unavailable");
        await sendDatabaseUnavailable(request as RequestWithContext, reply);
        return;
      }
    }
    reply.header("X-RateLimit-Limit", limit);
    reply.header("X-RateLimit-Remaining", Math.max(0, limit - bucket.hits));
    if (bucket.hits > limit) {
      const retryAfter = Math.max(1, Math.ceil((new Date(bucket.expires_at).getTime() - Date.now()) / 1000));
      reply.header("Retry-After", retryAfter);
      await reply.status(429).send({
        error: { status: 429, code: "rate_limited", detail: "Too many requests. Please retry shortly.", request_id: (request as any).requestId ?? "" },
      });
      return;
    }
    if (config().rateLimitStore === "postgres" && Math.random() < 0.01) {
      try {
        await db.deleteFrom("api_rate_limit_buckets").where("expires_at", "<", new Date(Date.now() - 3_600_000)).execute();
      } catch (error) {
        if (!isDatabasePoolAcquisitionFailure(error)) throw error;
        request.log.error({ err: error, requestId: (request as RequestWithContext).requestId }, "Rate-limit cleanup connection unavailable");
        await sendDatabaseUnavailable(request as RequestWithContext, reply);
      }
    }
  };
}
