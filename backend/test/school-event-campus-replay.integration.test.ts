import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { config } from "../src/config.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

suite("selected-campus SSE reconnect", () => {
  let database: DatabaseService;
  beforeAll(() => {
    requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    database = new DatabaseService();
  });
  afterAll(async () => database?.destroy());

  it("replays A only for a user legitimately authorized in A and B, without B exhausting A's replay limit", async () => {
    const rolledBack = new Error("rollback successful replay fixture");
    await expect(database.transaction().execute(async (tx) => {
      const suffix = randomUUID(), schoolA = randomUUID(), schoolB = randomUUID(), userId = randomUUID();
      await sql`INSERT INTO schools(id,name,code) VALUES
        (${schoolA}::uuid,'Replay campus A',${`replay-a-${suffix.slice(0, 16)}`}),
        (${schoolB}::uuid,'Replay campus B',${`replay-b-${suffix.slice(0, 16)}`})`.execute(tx);
      const user = (await sql<AuthUser>`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role)
        VALUES(${userId}::uuid,${`replay-${suffix}`},${`replay-${suffix}@example.test`},'!','Replay','Owner','admin') RETURNING *`.execute(tx)).rows[0]!;
      await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES
        (${schoolA}::uuid,${userId}::uuid,'admin'),(${schoolB}::uuid,${userId}::uuid,'admin')`.execute(tx);
      const authorization = (await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(
        school_id,'timetable.updated','{}'::jsonb,${userId}::uuid) AS allowed
        FROM school_memberships WHERE user_id=${userId}::uuid`.execute(tx)).rows;
      expect(authorization).toEqual([{ allowed: true }, { allowed: true }]);
      const before = Number((await sql<{ sequence: string }>`SELECT last_sequence AS sequence
        FROM event_delivery_cursor WHERE singleton`.execute(tx)).rows[0]!.sequence);
      await sql`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,published_at)
        SELECT ${schoolB}::uuid,'timetable.updated','school',${schoolB}::uuid,ARRAY[${userId}::uuid],
          '{"refresh":["messages"]}'::jsonb,${suffix}||'-foreign-'||series,now()
        FROM generate_series(1,${config().EVENT_REPLAY_LIMIT + 1}) AS series`.execute(tx);
      const ownId = randomUUID();
      await sql`INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,published_at)
        VALUES(${ownId}::uuid,${schoolA}::uuid,'timetable.updated','school',${schoolA}::uuid,ARRAY[${userId}::uuid],
          '{"refresh":["messages"]}'::jsonb,${`${suffix}-own`},now())`.execute(tx);
      const events = new SchoolEventService(tx as unknown as DatabaseService);
      (events as unknown as { brokerReady: boolean }).brokerReady = true;
      const frames: string[] = [], now = new Date().toISOString();
      const environment = createLiveExecutionEnvironment({ institution_id: schoolA,
        clock: { now: () => new Date(now), nowIso: () => now } });
      const request = { executionEnvironment: environment, sessionHash: suffix,
        headers: { "last-event-id": `v2-${before}` }, raw: { once: vi.fn() } } as unknown as AuthenticatedRequest;
      const reply = { hijack: vi.fn(), raw: { destroyed: false, writableEnded: false,
        writeHead: vi.fn(), once: vi.fn(), end: vi.fn(), destroy: vi.fn(),
        write: (frame: string) => { frames.push(frame); return true; } } } as unknown as FastifyReply;

      await events.openStream({ ...user, active_school_id: schoolA }, reply, request);
      const content = frames.join("");
      expect(content).toContain(`"id":"${ownId}"`);
      expect(content).toContain(`"school_id":"${schoolA}"`);
      expect(content).toContain(`"namespace_id":"live:${schoolA}"`);
      expect(content).toContain("event: stream.ready");
      expect(content).not.toContain(schoolB);
      expect(content).not.toContain("event: sync.required");
      await events.beforeApplicationShutdown();
      throw rolledBack;
    })).rejects.toBe(rolledBack);
  });
});
