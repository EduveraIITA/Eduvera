import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import type { DatabaseService } from "../database/database.service.js";
import { config } from "../config.js";

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

function rule(path: string): { limit: number; windowMs: number } {
  if (path.replace(/\/$/, "").endsWith("/invitations/accept")) return { limit: 10, windowMs: 60_000 };
  if (path.endsWith("/auth/register/")) return { limit: 5, windowMs: 60 * 60_000 };
  if (path.endsWith("/auth/login/") || path.endsWith("/auth/demo-session/")) return { limit: 10, windowMs: 60_000 };
  if (path.endsWith("/auth/mfa/login/")) return { limit: 10, windowMs: 5 * 60_000 };
  if (path.endsWith("/auth/password-reset/request/") || path.endsWith("/auth/email-verification/request/")) return { limit: 5, windowMs: 60 * 60_000 };
  if (path.endsWith("/auth/password-reset/confirm/") || path.endsWith("/auth/email-verification/confirm/") || path.endsWith("/auth/mfa/confirm/")) return { limit: 10, windowMs: 10 * 60_000 };
  if (path.endsWith("/ai/attendance/query/")) return { limit: 10, windowMs: 60_000 };
  return { limit: 300, windowMs: 60_000 };
}

export function rateLimitHook(db: DatabaseService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    const { limit, windowMs } = rule(path);
    const bucketKey = createHash("sha256").update(`${request.ip}:${request.method}:${path}`).digest("hex");
    const expiresAt = new Date(Date.now() + windowMs);
    let bucket: { hits: number; expires_at: Date };
    if (config().rateLimitStore === "memory") {
      bucket = memoryHit(bucketKey, windowMs);
    } else {
      const result = await sql<{ hits: number; expires_at: Date }>`
        INSERT INTO api_rate_limit_buckets(bucket_key, hits, expires_at)
        VALUES (${bucketKey}, 1, ${expiresAt})
        ON CONFLICT(bucket_key) DO UPDATE SET
          hits = CASE WHEN api_rate_limit_buckets.expires_at <= now() THEN 1 ELSE api_rate_limit_buckets.hits + 1 END,
          expires_at = CASE WHEN api_rate_limit_buckets.expires_at <= now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
        RETURNING hits, expires_at
      `.execute(db);
      bucket = result.rows[0]!;
    }
    reply.header("X-RateLimit-Limit", limit);
    reply.header("X-RateLimit-Remaining", Math.max(0, limit - bucket.hits));
    if (bucket.hits > limit) {
      const retryAfter = Math.max(1, Math.ceil((new Date(bucket.expires_at).getTime() - Date.now()) / 1000));
      reply.header("Retry-After", retryAfter);
      await reply.status(429).send({
        error: { status: 429, code: "rate_limited", detail: "Too many requests. Please retry shortly.", request_id: (request as any).requestId ?? "" },
      });
    }
    if (config().rateLimitStore === "postgres" && Math.random() < 0.01) {
      await db.deleteFrom("api_rate_limit_buckets").where("expires_at", "<", new Date(Date.now() - 3_600_000)).execute();
    }
  };
}
