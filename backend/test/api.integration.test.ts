import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/database/database.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import {
  assertIsolatedTestDatabaseName,
  requireIsolatedTestDatabaseUrl,
  requireManagedTestApiBaseUrl,
} from "./test-database.js";

const port = 8022;
const base = requireManagedTestApiBaseUrl(process.env.API_BASE_URL, `http://127.0.0.1:${port}`);
const databaseUrl = requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const metricsToken = "integration-test-metrics-token-long-enough";
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "omnischool_tests" });
let server: ChildProcess | undefined;
const cleanupLeaves: string[] = [];
const cleanupUsers: string[] = [];

async function json<T = any>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

class BrowserSession {
  private readonly cookies = new Map<string, string>();

  async request(path: string, init: RequestInit = {}, csrf = false): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    if (cookie) headers.set("Cookie", cookie);
    if (csrf) {
      const token = this.cookies.get("csrftoken");
      if (token) headers.set("X-CSRFToken", token);
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";", 1);
      const separator = pair?.indexOf("=") ?? -1;
      if (pair && separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async csrf(): Promise<void> {
    expect((await this.request("/api/v1/auth/csrf/")).status).toBe(200);
    expect(this.cookies.has("csrftoken")).toBe(true);
  }

  async login(identifier: string): Promise<Response> {
    await this.csrf();
    const response = await this.request("/api/v1/auth/login/", { method: "POST", body: JSON.stringify({ identifier, password: "OmniDemo@2026" }) }, true);
    expect(response.status).toBe(200);
    return response;
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/readyz`)).ok) return;
    } catch {
      // The child process may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test server did not become ready");
}

async function waitForPublishedEvent(eventId: string): Promise<{
  sequence: string;
  delivery_sequence: string;
  published_at: Date;
}> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const event = (await pool.query<{
      sequence: string;
      delivery_sequence: string | null;
      published_at: Date | null;
    }>(
      "SELECT sequence, delivery_sequence, published_at FROM event_outbox WHERE id=$1",
      [eventId],
    )).rows[0];
    if (event?.published_at && event.delivery_sequence) {
      return {
        sequence: event.sequence,
        delivery_sequence: event.delivery_sequence,
        published_at: event.published_at,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Event ${eventId} was not published with a delivery sequence`);
}

async function latestScheduledDateForTeacher(username: string): Promise<string> {
  const result = await pool.query<{ date: string }>(`
    SELECT candidate::date::text AS date
    FROM users teacher
    JOIN school_memberships membership
      ON membership.user_id=teacher.id AND membership.is_active
    JOIN schools school ON school.id=membership.school_id
    CROSS JOIN LATERAL generate_series(
      (now() AT TIME ZONE school.timezone)::date - 14,
      (now() AT TIME ZONE school.timezone)::date,
      interval '1 day'
    ) candidate
    WHERE teacher.username=$1
      AND EXISTS (
        SELECT 1
        FROM effective_school_schedule(school.id, candidate::date) slot
        WHERE slot.teacher_user_id=teacher.id
          AND slot.weekday=EXTRACT(ISODOW FROM candidate::date)::int
          AND slot.slot_type IN ('class','activity')
          AND NOT slot.cancelled
          AND slot.coverage_status IN ('not_required','accepted')
      )
    ORDER BY candidate DESC
    LIMIT 1
  `, [username]);
  const date = result.rows[0]?.date;
  if (!date) throw new Error(`Expected a recent scheduled school day for ${username}`);
  return date;
}

beforeAll(async () => {
  const identity = await pool.query<{ database_name: string }>("SELECT current_database() AS database_name");
  assertIsolatedTestDatabaseName(identity.rows[0]?.database_name ?? "");
  await pool.query("DELETE FROM api_rate_limit_buckets");
  server = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      EVENT_DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      COOKIE_SECRET: "integration-test-cookie-secret-at-least-32",
      METRICS_TOKEN: metricsToken,
      DEMO_MODE: "true",
      AI_PROVIDER: "mock",
      SPA_DIST_DIR: join(process.cwd(), "no-spa"),
      LOG_LEVEL: "silent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

beforeEach(async () => {
  // Keep authentication and endpoint throttles independent across cases. This
  // disposable table is isolated from Stage and prevents unrelated fast test
  // scenarios from collectively reaching the production limit.
  await pool.query("DELETE FROM api_rate_limit_buckets");
});

afterAll(async () => {
  for (const leaveId of cleanupLeaves) {
    const documents = await pool.query<{ storage_key: string }>("SELECT storage_key FROM leave_documents WHERE leave_request_id=$1", [leaveId]);
    await pool.query("DELETE FROM leave_requests WHERE id=$1", [leaveId]);
    for (const document of documents.rows) await unlink(join(process.cwd(), "storage/leave-documents", document.storage_key)).catch(() => undefined);
  }
  for (const userId of cleanupUsers) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
  server?.kill("SIGTERM");
});

describe("OmniSchool API", () => {
  it("serves reviewed import APIs with session, role, CSRF and private download enforcement",async()=>{
    const principal=new BrowserSession();expect((await principal.login("meera.principal")).status).toBe(200);
    const scope=(await pool.query("SELECT t.school_id,t.id FROM academic_terms t JOIN school_memberships m ON m.school_id=t.school_id JOIN users u ON u.id=m.user_id WHERE u.username='meera.principal' AND m.role='admin' AND t.is_active LIMIT 1")).rows[0];
    const endpoint='/api/v1/people/imports';const template=await principal.request(`${endpoint}/template?school_id=${scope.school_id}`);
    expect(template.status).toBe(200);expect(template.headers.get('content-type')).toContain('text/csv');expect(template.headers.get('cache-control')).toContain('no-store');const header=(await template.text()).trim();
    const body={school_id:scope.school_id,term_id:scope.id,filename:'api-contract.csv',csv:`${header}\nAPI-IMPORT-TEST,Test,Student,2014-04-12,7A,2000,2026-09-15,API-FAMILY,Test,Guardian,9000099999,,guardian`,idempotency_key:randomUUID()};
    expect((await principal.request(endpoint,{method:'POST',body:JSON.stringify(body)})).status).toBe(403);
    const upload=await principal.request(endpoint,{method:'POST',body:JSON.stringify(body)},true);expect(upload.status).toBe(200);const job=await json<{id:string}>(upload);
    try{
      const read=await principal.request(`${endpoint}/${job.id}?school_id=${scope.school_id}`);expect(read.status).toBe(200);expect((await json(read)).review.rows).toHaveLength(1);
      const teacher=new BrowserSession();await teacher.login('kavita.staff');expect((await teacher.request(`${endpoint}/${job.id}?school_id=${scope.school_id}`)).status).toBe(403);
      expect((await new BrowserSession().request(`${endpoint}?school_id=${scope.school_id}`)).status).toBe(401);
      const report=await principal.request(`${endpoint}/${job.id}/report?school_id=${scope.school_id}`);expect(report.status).toBe(200);expect(report.headers.get('content-disposition')).toContain('attachment');expect(await report.text()).toContain('API-IMPORT-TEST');
      expect((await principal.request(`${endpoint}/${job.id}/cancel`,{method:'POST',body:JSON.stringify({school_id:scope.school_id,expected_revision:1})},true)).status).toBe(200);
    }finally{await pool.query('DELETE FROM event_outbox WHERE aggregate_id=$1',[job.id]);await pool.query('DELETE FROM audit_events WHERE target_id=$1',[job.id]);await pool.query('DELETE FROM people_imports WHERE id=$1',[job.id]);}
  });
  it("reports liveness and PostgreSQL readiness", async () => {
    expect(await json(await fetch(`${base}/healthz`))).toEqual({ status: "ok", service: "omnischool-api" });
    expect(await json(await fetch(`${base}/readyz`))).toEqual({ status: "ready", database: "ok", events: "ok" });
  });

  it("protects monitoring metrics without converting authorization errors into 500s", async () => {
    const anonymous = await fetch(`${base}/metrics`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toContain("application/json");
    expect((await json(anonymous)).error).toMatchObject({ status: 401, code: "request_error" });

    const authorized = await fetch(`${base}/metrics`, {
      headers: { Authorization: `Bearer ${metricsToken}` },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("content-type")).toContain("text/plain");
    expect(await authorized.text()).toContain("omnischool_event_broker_ready");
  });

  it("isolates the maintenance lease from the publication cursor and browser roles", async () => {
    const relations = await pool.query<{ relname: string; relrowsecurity: boolean }>(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('event_delivery_cursor', 'event_maintenance_leases')
      ORDER BY relname
    `);
    expect(relations.rows).toEqual([
      { relname: "event_delivery_cursor", relrowsecurity: true },
      { relname: "event_maintenance_leases", relrowsecurity: true },
    ]);
    const legacyColumn = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='event_delivery_cursor'
          AND column_name='last_overdue_scan_at'
      ) AS exists
    `);
    expect(legacyColumn.rows[0]?.exists).toBe(false);
    const lease = await pool.query<{ task_name: string }>(`
      SELECT task_name FROM event_maintenance_leases
      WHERE task_name='attendance_register_overdue_scan'
    `);
    expect(lease.rows).toEqual([{ task_name: "attendance_register_overdue_scan" }]);
    const retentionLease = await pool.query<{ task_name: string }>(`
      SELECT task_name FROM event_maintenance_leases
      WHERE task_name='event_retention_cleanup'
    `);
    expect(retentionLease.rows).toEqual([{ task_name: "event_retention_cleanup" }]);
    const browserGrants = await pool.query(`
      SELECT table_name, grantee, privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema='public'
        AND table_name IN ('event_delivery_cursor', 'event_maintenance_leases')
        AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    `);
    expect(browserGrants.rows).toEqual([]);
  });

  it("captures the committed watermark and drains newer buffered events after a full sync", async () => {
    const events = new SchoolEventService({} as DatabaseService);
    const calls: string[] = [];
    const sentSequences: Array<number | undefined> = [];
    const client = {
      id: "full-sync-client",
      userId: "full-sync-user",
      lastSequence: null,
      replaying: true,
      replayOverflow: false,
      pendingEvents: new Map(),
      closed: false,
    } as any;
    (events as any).clients.set(client.id, client);
    (events as any).advanceToCurrentWatermark = (candidate: { lastSequence: number | null }) => {
      calls.push("watermark");
      candidate.lastSequence = 42;
      return Promise.resolve(42);
    };
    (events as any).send = (_client: unknown, eventName: string, _data: unknown, sequence?: number) => {
      calls.push(eventName);
      sentSequences.push(sequence);
      if (eventName === "sync.required") {
        (events as any).dispatch({
          id: "event-after-watermark",
          sequence: 43,
          school_id: "school",
          event_type: "attendance.updated",
          aggregate_type: "student",
          aggregate_id: "student",
          audience_user_ids: [client.userId],
          payload: { refresh: ["student.attendance"] },
          created_at: new Date(),
        });
      }
      return true;
    };

    await (events as any).requestFullSync(client, "integration_check");

    expect(calls).toEqual(["watermark", "sync.required"]);
    expect(sentSequences).toEqual([42]);
    expect(client.lastSequence).toBe(42);
    expect([...client.pendingEvents.keys()]).toEqual([43]);

    await (events as any).finishReplay(client);

    expect(calls).toEqual(["watermark", "sync.required", "attendance.updated"]);
    expect(sentSequences).toEqual([42, 43]);
    expect(client.lastSequence).toBe(43);
    expect(client.replaying).toBe(false);
    expect(client.pendingEvents.size).toBe(0);
  });

  it("checkpoints a newly initialized browser cursor with v2-0", async () => {
    const events = new SchoolEventService({} as DatabaseService);
    let content = "";
    const client = {
      id: "zero-watermark-client",
      lastSequence: null,
      closed: false,
      reply: {
        raw: {
          destroyed: false,
          writableEnded: false,
          write: (frame: string) => {
            content += frame;
            return true;
          },
        },
      },
    } as any;
    (events as any).advanceToCurrentWatermark = (candidate: { lastSequence: number | null }) => {
      candidate.lastSequence = 0;
      return Promise.resolve(0);
    };

    await (events as any).requestFullSync(client, "initial_connection");

    expect(client.lastSequence).toBe(0);
    expect(content).toBe('id: v2-0\nevent: sync.required\ndata: {"reason":"initial_connection"}\n\n');
  });

  it("replays missed SSE events only to their authorized audience", async () => {
    const browser = new BrowserSession();
    const login = await browser.login("aarav.student");
    expect(login.status).toBe(200);
    const identity = await json(login);
    const unrelated = await pool.query<{ id: string }>("SELECT id FROM users WHERE username='ananya.student'");
    const relevantId = randomUUID();
    const unrelatedId = randomUUID();
    const suffix = randomUUID();
    await pool.query(`
      INSERT INTO event_outbox (id, school_id, event_type, aggregate_type, aggregate_id, audience_user_ids, payload, idempotency_key)
      SELECT $1, m.school_id, 'attendance.updated', 'student', st.id, ARRAY[$2::uuid], jsonb_build_object('student_id', st.id, 'refresh', ARRAY['student.attendance']), $3
      FROM students st JOIN school_memberships m ON m.user_id=st.user_id AND m.is_active
      WHERE st.user_id=$2::uuid
    `, [relevantId, identity.user.id, `sse-relevant-${suffix}`]);
    await pool.query(`
      INSERT INTO event_outbox (id, school_id, event_type, aggregate_type, aggregate_id, audience_user_ids, payload, idempotency_key)
      SELECT $1, m.school_id, 'attendance.updated', 'student', st.id, ARRAY[$2::uuid], jsonb_build_object('student_id', st.id, 'refresh', ARRAY['student.attendance']), $3
      FROM students st JOIN school_memberships m ON m.user_id=st.user_id AND m.is_active
      WHERE st.user_id=$2::uuid
    `, [unrelatedId, unrelated.rows[0]!.id, `sse-unrelated-${suffix}`]);
    const event = await waitForPublishedEvent(relevantId);
    const controller = new AbortController();
    const response = await browser.request("/api/v1/events/stream/", {
      headers: { "Last-Event-ID": `v2-${Math.max(0, Number(event.delivery_sequence) - 1)}` },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let content = "";
    for (let attempt = 0; attempt < 10 && !content.includes("event: stream.ready"); attempt++) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE replay timed out")), 1_000)),
      ]);
      if (next.done) break;
      content += decoder.decode(next.value, { stream: true });
    }
    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(content).toContain(`"id":"${relevantId}"`);
    expect(content).not.toContain(unrelatedId);
  });

  it("assigns a delivery cursor when a legacy publisher only sets published_at", async () => {
    const identity = (await pool.query<{ user_id: string; student_id: string; school_id: string }>(`
      SELECT student.user_id, student.id AS student_id, student.school_id
      FROM students student
      JOIN users account ON account.id=student.user_id
      WHERE account.username='aarav.student'
    `)).rows[0]!;
    const eventId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO event_outbox (
          id, school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key, available_at
        ) VALUES (
          $1, $2, 'attendance.updated', 'student', $3,
          ARRAY[$4::uuid], jsonb_build_object(
            'student_id', $3::uuid,
            'refresh', ARRAY['student.attendance']
          ), $5, now() + interval '1 day'
        )
      `, [eventId, identity.school_id, identity.student_id, identity.user_id, `legacy-publisher-${eventId}`]);
      const published = await client.query<{ delivery_sequence: string }>(`
        UPDATE event_outbox
        SET published_at=clock_timestamp(), published_by='legacy-integration-worker'
        WHERE id=$1
        RETURNING delivery_sequence
      `, [eventId]);
      expect(Number(published.rows[0]?.delivery_sequence)).toBeGreaterThan(0);
      await client.query("COMMIT");
      const cursor = await pool.query<{ last_sequence: string }>(
        "SELECT last_sequence FROM event_delivery_cursor WHERE singleton",
      );
      expect(Number(cursor.rows[0]?.last_sequence)).toBeGreaterThanOrEqual(
        Number(published.rows[0]?.delivery_sequence),
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await pool.query("DELETE FROM event_outbox WHERE id=$1", [eventId]);
    }
  });

  it("drains a legacy publisher batch in cursor order when notifications arrive reversed", async () => {
    const browser = new BrowserSession();
    const login = await browser.login("aarav.student");
    expect(login.status).toBe(200);
    const identity = await json(login);
    const context = (await pool.query<{ student_id: string; school_id: string }>(`
      SELECT student.id AS student_id, student.school_id
      FROM students student WHERE student.user_id=$1
    `, [identity.user.id])).rows[0]!;
    const eventIds = [randomUUID(), randomUUID()];
    const baseline = Number((await pool.query<{ last_sequence: string }>(
      "SELECT last_sequence FROM event_delivery_cursor WHERE singleton",
    )).rows[0]!.last_sequence);
    const streamController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const publisher = await pool.connect();
    let transactionOpen = false;
    try {
      const response = await browser.request("/api/v1/events/stream/", {
        headers: { "Last-Event-ID": `v2-${baseline}` },
        signal: streamController.signal,
      });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      for (let attempt = 0; attempt < 10 && !content.includes("event: stream.ready"); attempt++) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE stream setup timed out")), 1_000)),
        ]);
        if (next.done) break;
        content += decoder.decode(next.value, { stream: true });
      }
      expect(content).toContain("event: stream.ready");

      await publisher.query("BEGIN");
      transactionOpen = true;
      await publisher.query(`
        INSERT INTO event_outbox (
          id, school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key, available_at
        ) VALUES
          ($1, $3, 'attendance.updated', 'student', $4, ARRAY[$5::uuid],
            jsonb_build_object('student_id', $4::uuid, 'refresh', ARRAY['student.attendance']), $6, now() + interval '1 day'),
          ($2, $3, 'attendance.updated', 'student', $4, ARRAY[$5::uuid],
            jsonb_build_object('student_id', $4::uuid, 'refresh', ARRAY['student.home']), $7, now() + interval '1 day')
      `, [
        eventIds[0], eventIds[1], context.school_id, context.student_id,
        identity.user.id, `legacy-batch-${eventIds[0]}`, `legacy-batch-${eventIds[1]}`,
      ]);
      const published = await publisher.query<{ id: string; delivery_sequence: string }>(`
        UPDATE event_outbox
        SET published_at=clock_timestamp(), published_by='legacy-batch-integration-worker'
        WHERE id=ANY($1::uuid[])
        RETURNING id, delivery_sequence
      `, [eventIds]);
      const ordered = [...published.rows].sort(
        (left, right) => Number(left.delivery_sequence) - Number(right.delivery_sequence),
      );
      expect(ordered).toHaveLength(2);
      for (const event of [...ordered].reverse()) {
        await publisher.query(
          "SELECT pg_notify('omnischool_school_events_v1', $1)",
          [JSON.stringify({ id: event.id, sequence: event.delivery_sequence })],
        );
      }
      await publisher.query("COMMIT");
      transactionOpen = false;

      for (let attempt = 0; attempt < 10 && !ordered.every((event) => content.includes(event.id)); attempt++) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Ordered legacy batch delivery timed out")), 1_000)),
        ]);
        if (next.done) break;
        content += decoder.decode(next.value, { stream: true });
      }
      expect(content).toContain(`id: v2-${ordered[0]!.delivery_sequence}`);
      expect(content).toContain(`id: v2-${ordered[1]!.delivery_sequence}`);
      expect(content.indexOf(`"id":"${ordered[0]!.id}"`)).toBeLessThan(
        content.indexOf(`"id":"${ordered[1]!.id}"`),
      );
    } finally {
      if (transactionOpen) await publisher.query("ROLLBACK").catch(() => undefined);
      publisher.release();
      streamController.abort();
      await reader?.cancel().catch(() => undefined);
      await pool.query("DELETE FROM event_outbox WHERE id=ANY($1::uuid[])", [eventIds]);
    }
  });

  it("treats a legacy numeric Last-Event-ID as an incompatible cursor", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("aarav.student")).status).toBe(200);
    const controller = new AbortController();
    const response = await browser.request("/api/v1/events/stream/", {
      headers: { "Last-Event-ID": "1" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let content = "";
    for (let attempt = 0; attempt < 10 && !content.includes("event: stream.ready"); attempt++) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE cursor reset timed out")), 1_000)),
      ]);
      if (next.done) break;
      content += decoder.decode(next.value, { stream: true });
    }
    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(content).toMatch(/id: v2-\d+\nevent: sync\.required/);
    expect(content).toContain("event: sync.required");
    expect(content).toContain('"reason":"initial_connection"');
  });

  it("assigns replay cursors in publication order when inserts commit out of order", async () => {
    const browser = new BrowserSession();
    const login = await browser.login("aarav.student");
    expect(login.status).toBe(200);
    const identity = await json(login);
    const context = (await pool.query<{ student_id: string; school_id: string }>(`
      SELECT student.id AS student_id, student.school_id
      FROM students student
      WHERE student.user_id=$1
    `, [identity.user.id])).rows[0]!;
    const firstInsertedId = randomUUID();
    const firstCommittedId = randomUUID();
    const suffix = randomUUID();
    const slow = await pool.connect();
    const fast = await pool.connect();
    let slowOpen = false;
    let fastOpen = false;
    let slowReleased = false;
    let fastReleased = false;
    let firstInsertedSequence = 0;
    let firstCommittedSequence = 0;
    try {
      await slow.query("BEGIN");
      slowOpen = true;
      firstInsertedSequence = Number((await slow.query<{ sequence: string }>(`
        INSERT INTO event_outbox (
          id, school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key
        ) VALUES (
          $1, $2, 'attendance.updated', 'student', $3,
          ARRAY[$4::uuid], jsonb_build_object(
            'student_id', $3::uuid,
            'refresh', ARRAY['student.attendance']
          ), $5
        )
        RETURNING sequence
      `, [firstInsertedId, context.school_id, context.student_id, identity.user.id, `out-of-order-slow-${suffix}`])).rows[0]!.sequence);

      await fast.query("BEGIN");
      fastOpen = true;
      firstCommittedSequence = Number((await fast.query<{ sequence: string }>(`
        INSERT INTO event_outbox (
          id, school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key
        ) VALUES (
          $1, $2, 'attendance.updated', 'student', $3,
          ARRAY[$4::uuid], jsonb_build_object(
            'student_id', $3::uuid,
            'refresh', ARRAY['student.attendance']
          ), $5
        )
        RETURNING sequence
      `, [firstCommittedId, context.school_id, context.student_id, identity.user.id, `out-of-order-fast-${suffix}`])).rows[0]!.sequence);
      await fast.query("COMMIT");
      fastOpen = false;
      fast.release();
      fastReleased = true;

      const firstPublished = await waitForPublishedEvent(firstCommittedId);
      await slow.query("COMMIT");
      slowOpen = false;
      slow.release();
      slowReleased = true;
      const secondPublished = await waitForPublishedEvent(firstInsertedId);

      expect(firstInsertedSequence).toBeLessThan(firstCommittedSequence);
      expect(Number(firstPublished.delivery_sequence)).toBeLessThan(Number(secondPublished.delivery_sequence));

      const controller = new AbortController();
      const response = await browser.request("/api/v1/events/stream/", {
        headers: { "Last-Event-ID": `v2-${Number(firstPublished.delivery_sequence) - 1}` },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      for (let attempt = 0; attempt < 20 && !(content.includes(firstCommittedId) && content.includes(firstInsertedId) && content.includes("event: stream.ready")); attempt++) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Ordered SSE replay timed out")), 1_000)),
        ]);
        if (next.done) break;
        content += decoder.decode(next.value, { stream: true });
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      expect(content).toContain(`id: v2-${firstPublished.delivery_sequence}`);
      expect(content).toContain(`id: v2-${secondPublished.delivery_sequence}`);
      expect(content.indexOf(`"id":"${firstCommittedId}"`)).toBeLessThan(content.indexOf(`"id":"${firstInsertedId}"`));
    } finally {
      if (fastOpen) await fast.query("ROLLBACK").catch(() => undefined);
      if (slowOpen) await slow.query("ROLLBACK").catch(() => undefined);
      if (!fastReleased) fast.release();
      if (!slowReleased) slow.release();
    }
  });

  it("requires a full sync when the cursor predates an expired event", async () => {
    const browser = new BrowserSession();
    const login = await browser.login("aarav.student");
    expect(login.status).toBe(200);
    const identity = await json(login);
    const context = (await pool.query<{ student_id: string; school_id: string }>(`
      SELECT student.id AS student_id, student.school_id
      FROM students student WHERE student.user_id=$1
    `, [identity.user.id])).rows[0]!;
    const eventId = randomUUID();
    const client = await pool.connect();
    let deliverySequence = 0;
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO event_outbox (
          id, school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key, expires_at,
          available_at
        ) VALUES (
          $1, $2, 'attendance.updated', 'student', $3,
          ARRAY[$4::uuid], jsonb_build_object(
            'student_id', $3::uuid,
            'refresh', ARRAY['student.attendance']
          ), $5, now() - interval '1 second', now() + interval '1 day'
        )
      `, [eventId, context.school_id, context.student_id, identity.user.id, `expired-replay-${eventId}`]);
      const published = await client.query<{ delivery_sequence: string }>(`
        UPDATE event_outbox
        SET published_at=clock_timestamp(), published_by='retention-integration-worker'
        WHERE id=$1
        RETURNING delivery_sequence
      `, [eventId]);
      deliverySequence = Number(published.rows[0]!.delivery_sequence);
      await client.query("COMMIT");

      const controller = new AbortController();
      const response = await browser.request("/api/v1/events/stream/", {
        headers: { "Last-Event-ID": `v2-${deliverySequence - 1}` },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      for (let attempt = 0; attempt < 10 && !content.includes("event: stream.ready"); attempt++) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Expired replay fallback timed out")), 1_000)),
        ]);
        if (next.done) break;
        content += decoder.decode(next.value, { stream: true });
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      expect(content).toContain("event: sync.required");
      expect(content).toContain('"reason":"replay_window_expired"');
      expect(content).not.toContain(`"id":"${eventId}"`);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      if (deliverySequence > 0) {
        await pool.query(
          "UPDATE event_delivery_cursor SET replay_floor=GREATEST(replay_floor, $1) WHERE singleton",
          [deliverySequence],
        );
      }
      await pool.query("DELETE FROM event_outbox WHERE id=$1", [eventId]);
    }
  });

  it("deletes expired outbox rows in bounded batches before advancing the replay floor", async () => {
    const identity = (await pool.query<{ user_id: string; student_id: string; school_id: string }>(`
      SELECT student.user_id, student.id AS student_id, student.school_id
      FROM students student JOIN users account ON account.id=student.user_id
      WHERE account.username='aarav.student'
    `)).rows[0]!;
    const eventIds = [randomUUID(), randomUUID(), randomUUID()];
    const eventDatabase = new DatabaseService();
    const eventService = new SchoolEventService(eventDatabase) as unknown as {
      cleanupExpiredEvents(batchSize: number): Promise<number>;
    };
    try {
      for (const [index, eventId] of eventIds.entries()) {
        await pool.query(`
          INSERT INTO event_outbox (
            id, school_id, event_type, aggregate_type, aggregate_id,
            audience_user_ids, payload, idempotency_key, available_at, expires_at
          ) VALUES (
            $1, $2, 'attendance.updated', 'student', $3, ARRAY[$4::uuid],
            jsonb_build_object('student_id', $3::uuid, 'refresh', ARRAY['student.attendance']),
            $5, now() + interval '1 day', now() - make_interval(mins => $6)
          )
        `, [
          eventId, identity.school_id, identity.student_id, identity.user_id,
          `bounded-cleanup-${eventId}`, eventIds.length - index,
        ]);
      }
      const published = await pool.query<{ id: string; delivery_sequence: string }>(`
        UPDATE event_outbox
        SET published_at=clock_timestamp(), published_by='cleanup-integration-worker'
        WHERE id=ANY($1::uuid[])
        RETURNING id, delivery_sequence
      `, [eventIds]);
      const sequenceById = new Map(published.rows.map((row) => [row.id, Number(row.delivery_sequence)]));
      await pool.query(`
        UPDATE event_maintenance_leases SET last_claimed_at=NULL
        WHERE task_name='event_retention_cleanup'
      `);

      const deleted = await eventService.cleanupExpiredEvents(2);

      expect(deleted).toBe(2);
      expect(await eventService.cleanupExpiredEvents(2)).toBe(0);
      const remaining = await pool.query<{ id: string }>(
        "SELECT id FROM event_outbox WHERE id=ANY($1::uuid[]) ORDER BY id",
        [eventIds],
      );
      expect(remaining.rows.map((row) => row.id)).toEqual([eventIds[2]].sort());
      const cursor = await pool.query<{ replay_floor: string }>(
        "SELECT replay_floor FROM event_delivery_cursor WHERE singleton",
      );
      expect(Number(cursor.rows[0]!.replay_floor)).toBeGreaterThanOrEqual(Math.max(
        sequenceById.get(eventIds[0]!)!, sequenceById.get(eventIds[1]!)!,
      ));
      const lease = await pool.query<{ claimed: boolean }>(`
        SELECT last_claimed_at IS NOT NULL AS claimed
        FROM event_maintenance_leases WHERE task_name='event_retention_cleanup'
      `);
      expect(lease.rows).toEqual([{ claimed: true }]);
    } finally {
      await pool.query(`
        UPDATE event_maintenance_leases SET last_claimed_at=NULL
        WHERE task_name='event_retention_cleanup'
      `).catch(() => undefined);
      await eventService.cleanupExpiredEvents(10).catch(() => 0);
      await pool.query("DELETE FROM event_outbox WHERE id=ANY($1::uuid[])", [eventIds]);
      await eventDatabase.destroy();
    }
  });

  it("re-checks revoked guardians and ignores stale teacher assignments for attendance events", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const guardian = (await client.query<{
        user_id: string;
        student_id: string;
        school_id: string;
      }>(`
        SELECT parent.user_id, relationship.student_id, student.school_id
        FROM parents parent
        JOIN users account ON account.id=parent.user_id
        JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
        JOIN students student ON student.id=relationship.student_id
        WHERE account.username='pooja.parent'
        ORDER BY relationship.is_primary DESC
        LIMIT 1
      `)).rows[0]!;
      const guardianAuthorized = async () => (await client.query<{ authorized: boolean }>(`
        SELECT event_user_is_authorized(
          $1::uuid,
          'attendance.updated',
          jsonb_build_object('student_id', $2::uuid),
          $3::uuid
        ) AS authorized
      `, [guardian.school_id, guardian.student_id, guardian.user_id])).rows[0]!.authorized;
      expect(await guardianAuthorized()).toBe(true);
      await client.query(`
        UPDATE school_memberships
        SET is_active=false
        WHERE school_id=$1 AND user_id=$2 AND role='guardian'
      `, [guardian.school_id, guardian.user_id]);
      expect(await guardianAuthorized()).toBe(false);

      const teacher = (await client.query<{
        user_id: string;
        school_id: string;
        term_id: string;
        academic_year: string;
      }>(`
        SELECT membership.user_id, membership.school_id,
          term.id AS term_id, term.academic_year
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id
        JOIN academic_terms term ON term.school_id=membership.school_id AND term.is_active
        WHERE account.username='kavita.staff'
          AND membership.role='staff' AND membership.is_active
        ORDER BY term.starts_on DESC, term.id
        LIMIT 1
      `)).rows[0]!;
      const historicalTermId = randomUUID();
      const classSectionId = randomUUID();
      const slotId = randomUUID();
      const suffix = randomUUID().slice(0, 8);
      await client.query(`
        INSERT INTO academic_terms (
          id, school_id, academic_year, name, starts_on, ends_on,
          attendance_threshold, is_active
        ) VALUES ($1, $2, $3, $4, '2025-01-01', '2025-03-31', 85, false)
      `, [historicalTermId, teacher.school_id, teacher.academic_year, `Historical policy ${suffix}`]);
      await client.query(`
        INSERT INTO class_sections (
          id, school_id, academic_year, grade, section, board, room_number
        ) VALUES ($1, $2, $3, 'Policy', $4, 'Test', 'T-1')
      `, [classSectionId, teacher.school_id, teacher.academic_year, suffix]);
      await client.query(`
        INSERT INTO timetable_slots (
          id, class_section_id, term_id, weekday, period_number,
          starts_at, ends_at, slot_type, title, room, teacher_user_id
        ) VALUES ($1, $2, $3, 1, 1, '09:00', '09:45', 'class', 'Historical', 'T-1', $4)
      `, [slotId, classSectionId, historicalTermId, teacher.user_id]);
      const teacherAuthorized = async (eventType: string, termId: string) => (await client.query<{ authorized: boolean }>(`
        SELECT event_user_is_authorized(
          $1::uuid,
          $2,
          jsonb_build_object('class_section_id', $3::uuid, 'term_id', $4::uuid),
          $5::uuid
        ) AS authorized
      `, [teacher.school_id, eventType, classSectionId, termId, teacher.user_id])).rows[0]!.authorized;
      expect(await teacherAuthorized("attendance.updated", historicalTermId)).toBe(true);
      expect(await teacherAuthorized("attendance.updated", teacher.term_id)).toBe(false);
      await client.query("DELETE FROM timetable_slots WHERE id=$1", [slotId]);
      expect(await teacherAuthorized("timetable.updated", teacher.term_id)).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("rejects cross-school relational writes at the database boundary", async () => {
    const client = await pool.connect();
    const schoolId = randomUUID();
    const classId = randomUUID();
    const termId = randomUUID();
    let databaseError: any;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO schools(id,name,code) VALUES ($1,'Isolation Test School',$2)", [schoolId, `iso-${schoolId.slice(0, 8)}`]);
      await client.query("INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active) VALUES ($1,$2,'2026-27','Test','2026-04-01','2027-03-31',85,true)", [termId, schoolId]);
      await client.query("INSERT INTO class_sections(id,school_id,academic_year,grade,section) VALUES ($1,$2,'2026-27','7','Z')", [classId, schoolId]);
      const student = await client.query<{ id: string }>("SELECT id FROM students ORDER BY id LIMIT 1");
      await client.query("INSERT INTO enrollments(id,student_id,class_section_id,term_id,roll_number,is_active) VALUES ($1,$2,$3,$4,99,true)", [randomUUID(), student.rows[0]!.id, classId, termId]);
    } catch (error) {
      databaseError = error;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(databaseError?.code).toBe("23514");
  });

  it("enforces login CSRF and establishes a signed server-side session", async () => {
    const browser = new BrowserSession();
    await browser.csrf();
    const rejected = await browser.request("/api/v1/auth/login/", { method: "POST", body: JSON.stringify({ identifier: "aarav.student", password: "OmniDemo@2026" }) });
    expect(rejected.status).toBe(403);
    const accepted = await browser.request("/api/v1/auth/login/", { method: "POST", body: JSON.stringify({ identifier: "aarav.student", password: "OmniDemo@2026" }) }, true);
    expect(accepted.status).toBe(200);
    expect((await json(accepted)).user.role).toBe("student");
    const me = await browser.request("/api/v1/auth/me/");
    expect(me.status).toBe(200);
    expect((await json(me)).memberships[0].role).toBe("student");
  });

  it("supports demo sign-in, fail-safe logout, and immediate password sign-in in one browser", async () => {
    const browser = new BrowserSession();
    const cambridge = (await pool.query<{ id: string }>("SELECT id FROM schools WHERE code='cis'")).rows[0]!;
    const demo = await browser.request("/api/v1/auth/demo-session/", {
      method: "POST",
      body: JSON.stringify({ role: "admin" }),
    });
    expect(demo.status).toBe(200);
    expect((await json(demo)).user).toMatchObject({ role: "admin", active_school_id: cambridge.id });
    const demoProfileResponse = await browser.request("/api/v1/auth/me/");
    expect(demoProfileResponse.status).toBe(200);
    expect(await json(demoProfileResponse)).toMatchObject({
      user: { active_school_id: cambridge.id },
      memberships: [{ school_id: cambridge.id, role: "admin" }],
      institution_setup_required: false,
    });

    const logout = await browser.request("/api/v1/auth/logout/", { method: "POST" });
    expect(logout.status).toBe(204);
    expect(await json(await browser.request("/api/v1/auth/session/"))).toMatchObject({ authenticated: false, user: null });
    expect((await browser.request("/api/v1/auth/me/")).status).toBe(401);

    expect((await browser.login("meera.principal")).status).toBe(200);
    expect((await browser.request("/api/v1/auth/me/")).status).toBe(200);
  });

  it("pins every school demo profile to Cambridge while keeping the company demo institution-free", async () => {
    const cambridge = (await pool.query<{ id: string }>("SELECT id FROM schools WHERE code='cis'")).rows[0]!;
    for (const role of ["student", "parent", "staff", "admin", "school_admin"] as const) {
      const browser = new BrowserSession();
      const response = await browser.request("/api/v1/auth/demo-session/", { method: "POST", body: JSON.stringify({ role }) });
      expect(response.status).toBe(200);
      expect((await json(response)).user.active_school_id).toBe(cambridge.id);
      const profile = await json(await browser.request("/api/v1/auth/me/"));
      expect(profile.user.active_school_id).toBe(cambridge.id);
      expect(profile.memberships).toEqual(expect.arrayContaining([expect.objectContaining({ school_id: cambridge.id })]));
      expect(profile.institution_setup_required).toBe(false);
    }
    const company = new BrowserSession();
    const response = await company.request("/api/v1/auth/demo-session/", { method: "POST", body: JSON.stringify({ role: "company" }) });
    expect(response.status).toBe(200);
    expect((await json(response)).user.active_school_id).toBeNull();
  });

  it("requires registration CSRF and leaves new identities pending school onboarding", async () => {
    const browser = new BrowserSession();
    await browser.csrf();
    const email = `riya.${Date.now()}@example.test`;
    const payload = { email, password: "N1mble!RiverStone2026", first_name: "Riya", last_name: "Kapoor", role: "student" };
    expect((await browser.request("/api/v1/auth/register/", { method: "POST", body: JSON.stringify(payload) })).status).toBe(403);
    const response = await browser.request("/api/v1/auth/register/", { method: "POST", body: JSON.stringify(payload) }, true);
    expect(response.status).toBe(201);
    const body = await json(response);
    cleanupUsers.push(body.user.id);
    expect(body.onboarding).toMatchObject({ status: "pending_school_membership", has_school_access: false });
    const me = await json(await browser.request("/api/v1/auth/me/"));
    expect(me.memberships).toEqual([]);
    expect((await browser.request("/api/v1/screens/student/attendance/")).status).toBe(404);
  });

  it("returns live parent aggregates, contacts, notifications, and guardian timetable data", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("pooja.parent")).status).toBe(200);
    const home = await json(await browser.request("/api/v1/screens/parent/home/"));
    expect(home.student.user.display_name).toBe("Aarav Sharma");
    expect(home.semester_metrics).toMatchObject({
      attendance_rank: expect.any(Number),
      attendance_cohort_size: expect.any(Number),
      homework_due: expect.any(Number),
      homework_total: expect.any(Number),
      homework_recent: expect.any(Number),
      homework_previous: expect.any(Number),
    });
    expect(home.semester_metrics.homework_total).toBeGreaterThanOrEqual(home.semester_metrics.homework_due);
    expect(home.ranking.students).toHaveLength(25);
    const currentStudent = home.ranking.students.find((item: any) => item.is_current);
    expect(currentStudent).toMatchObject({ name: "Aarav Sharma", rank: expect.any(Number) });
    expect(home.semester_metrics.attendance_rank).toBe(currentStudent.rank);
    expect(home.semester_metrics.attendance_trend_percent === null || Number.isFinite(home.semester_metrics.attendance_trend_percent)).toBe(true);
    expect(home.contacts[0]).toMatchObject({ name: "Ms. Kavita Mehta", email: "kavita.mehta@cambridge.example.test" });
    const parentLeave = await json(await browser.request(`/api/v1/screens/parent/leave/${home.action_required.id}/`));
    expect(parentLeave.constraints).toMatchObject({
      max_duration_days: 31,
      medical_document_after_days: 2,
      max_document_size_bytes: 10 * 1024 * 1024,
    });
    const attendance = await json(await browser.request("/api/v1/screens/parent/attendance/"));
    expect(attendance.contacts[0].phone).toBeTruthy();
    expect(attendance.ranking.students).toHaveLength(25);
    const timetable = await browser.request("/api/v1/students/timetable/");
    expect(timetable.status).toBe(200);
    expect((await json(timetable)).results.length).toBeGreaterThan(0);
    const parentUserId = (await pool.query<{ id: string }>("SELECT id FROM users WHERE username='pooja.parent'"))
      .rows[0]!.id;
    const paginationNotificationIds = Array.from({ length: 4 }, () => randomUUID());
    await pool.query(`
      INSERT INTO notifications (id, recipient_id, kind, title, body, link, created_at)
      SELECT fixture_id, $1::uuid, 'general',
        'Pagination fixture ' || fixture_number,
        'Deterministic keyset pagination coverage.', '/parent/home',
        clock_timestamp() - fixture_number * interval '1 second'
      FROM unnest($2::uuid[]) WITH ORDINALITY fixture(fixture_id, fixture_number)
    `, [parentUserId, paginationNotificationIds]);
    try {
      const notifications = await json(await browser.request("/api/v1/notifications/"));
      expect(notifications.results[0]).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), title: expect.any(String), body: expect.any(String), link: expect.any(String), created_at: expect.any(String) }));
      expect(notifications.unread_count).toEqual(expect.any(Number));
      const firstPage = await json(await browser.request("/api/v1/notifications/?limit=2"));
      expect(firstPage.results).toHaveLength(2);
      expect(firstPage.next_cursor).toEqual(expect.any(String));
      const secondPage = await json(await browser.request(`/api/v1/notifications/?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`));
      expect(secondPage.results).toHaveLength(2);
      expect(secondPage.results.map((item: { id: string }) => item.id)).not.toContain(firstPage.results[0].id);
      expect((await browser.request("/api/v1/notifications/?cursor=not-a-valid-cursor")).status).toBe(400);
    } finally {
      await pool.query("DELETE FROM notifications WHERE id=ANY($1::uuid[])", [paginationNotificationIds]);
    }
  });

  it("scopes homework completion to linked children and updates the pending count", async () => {
    const guardian = new BrowserSession();
    expect((await guardian.login("pooja.parent")).status).toBe(200);
    const before = await json(await guardian.request("/api/v1/screens/parent/home/"));
    expect(before.homework_items).toHaveLength(before.semester_metrics.homework_total);
    const item = before.homework_items.find((entry: any) => !entry.completed_at);
    expect(item).toBeDefined();
    const path = `/api/v1/homework/${item.id}/complete/`;
    try {
      const marked = await guardian.request(path, { method: "POST", body: JSON.stringify({ student_id: before.student.id }) }, true);
      expect(marked.status).toBe(200);
      const after = await json(await guardian.request("/api/v1/screens/parent/home/"));
      expect(after.homework_items.find((entry: any) => entry.id === item.id).completed_at).toBeTruthy();
      expect(after.semester_metrics.homework_due).toBe(before.semester_metrics.homework_due - 1);
      const otherChild = before.siblings[0];
      if (otherChild) {
        const sibling = await json(await guardian.request(`/api/v1/screens/parent/home/?student_id=${otherChild.id}`));
        expect(sibling.homework_items.find((entry: any) => entry.id === item.id)?.completed_at).toBeFalsy();
      }
    } finally {
      expect((await guardian.request(`${path}?student_id=${before.student.id}`, { method: "DELETE" }, true)).status).toBe(200);
    }
  });

  it("keeps clarification non-destructive and records the guardian note", async () => {
    const browser = new BrowserSession();
    await browser.login("pooja.parent");
    const leaves = await json(await browser.request("/api/v1/leave-requests/"));
    const pending = leaves.results.find((item: any) => item.status === "pending_guardian");
    expect(pending).toBeTruthy();
    const note = "Please confirm whether both dates are covered by the doctor's note.";
    const response = await browser.request(`/api/v1/leave-requests/${pending.id}/clarify/`, { method: "POST", body: JSON.stringify({ note }) }, true);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.status).toBe("pending_guardian");
    const clarificationAudit = body.audit_log.at(-1);
    expect(clarificationAudit).toMatchObject({ action: "clarification_requested", from_status: "pending_guardian", to_status: "pending_guardian", note });
    await pool.query("DELETE FROM notifications WHERE metadata->>'action'='clarify' AND metadata->>'leave_request_id'=$1 AND body LIKE '%' || $2 || '%'", [pending.id, note]);
    await pool.query("DELETE FROM leave_audits WHERE id=$1", [clarificationAudit.id]);
  });

  it("creates a student leave and supporting document atomically in one multipart POST", async () => {
    const browser = new BrowserSession();
    await browser.login("aarav.student");
    const withoutCsrf = new FormData();
    withoutCsrf.set("category", "medical"); withoutCsrf.set("starts_on", "2026-10-12"); withoutCsrf.set("ends_on", "2026-10-13"); withoutCsrf.set("reason", "Doctor advised two days of rest and observation.");
    expect((await browser.request("/api/v1/leave-requests/", { method: "POST", body: withoutCsrf })).status).toBe(403);
    const form = new FormData();
    form.set("category", "medical"); form.set("starts_on", "2026-10-12"); form.set("ends_on", "2026-10-13"); form.set("reason", "Doctor advised two days of rest and observation.");
    form.set("file", new File(["%PDF-1.4\nOmniSchool integration note"], "doctor-note.pdf", { type: "application/pdf" }));
    const response = await browser.request("/api/v1/leave-requests/", { method: "POST", body: form }, true);
    expect(response.status).toBe(201);
    const leave = await json(response); cleanupLeaves.push(leave.id);
    expect(leave.status).toBe("pending_guardian");
    expect(leave.documents).toHaveLength(1);
    const download = await browser.request(new URL(leave.documents[0].file_url).pathname);
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("OmniSchool integration note");
  });

  it("enforces the medical-document threshold published by the attendance policy", async () => {
    const browser = new BrowserSession();
    await browser.login("aarav.student");

    const applyScreen = await json(await browser.request("/api/v1/screens/student/leave/apply/"));
    expect(applyScreen.constraints.medical_document_after_days).toBe(2);

    const shorterResponse = await browser.request("/api/v1/leave-requests/", {
      method: "POST",
      body: JSON.stringify({
        category: "medical",
        starts_on: "2026-10-14",
        ends_on: "2026-10-15",
        reason: "Recovering at home for two calendar days on medical advice.",
      }),
    }, true);
    expect(shorterResponse.status).toBe(201);
    const shorterLeave = await json(shorterResponse);
    cleanupLeaves.push(shorterLeave.id);
    expect(shorterLeave.documents).toEqual([]);

    const requiredResponse = await browser.request("/api/v1/leave-requests/", {
      method: "POST",
      body: JSON.stringify({
        category: "medical",
        starts_on: "2026-10-16",
        ends_on: "2026-10-18",
        reason: "Recovering at home for three calendar days on medical advice.",
      }),
    }, true);
    expect(requiredResponse.status).toBe(400);
    expect(await json(requiredResponse)).toMatchObject({
      error: {
        code: "request_error",
        detail: "A supporting document is required for medical leave longer than 2 calendar days.",
        status: 400,
      },
    });
  });

  it("auto-authorizes a linked guardian's own leave submission", async () => {
    const browser = new BrowserSession();
    await browser.login("pooja.parent");
    const home = await json(await browser.request("/api/v1/screens/parent/home/"));
    const response = await browser.request("/api/v1/leave-requests/", {
      method: "POST",
      body: JSON.stringify({ student_id: home.student.id, category: "family", starts_on: "2026-10-20", ends_on: "2026-10-20", reason: "Attending a close family ceremony out of town." }),
    }, true);
    expect(response.status).toBe(201);
    const leave = await json(response); cleanupLeaves.push(leave.id);
    expect(leave.status).toBe("authorized");
    expect(leave.guardian_authorized_by_name).toBe("Pooja Sharma");
    expect(leave.audit_log.map((entry: any) => entry.action)).toEqual(["submitted", "authorized"]);
  });

  it("atomically turns school-approved leave into excused attendance and live events", async () => {
    const guardian = new BrowserSession(); await guardian.login("pooja.parent");
    const principal = new BrowserSession(); await principal.login("meera.principal");
    const home = await json(await guardian.request("/api/v1/screens/parent/home/"));
    // A medium-school seed can already contain observed presence on a fixed date.
    // Use an unrecorded instructional day; approval must never erase presence.
    const available = await pool.query<{ date: string }>(`
      SELECT day::date::text AS date FROM enrollments e
      JOIN academic_terms term ON term.id=e.term_id
      CROSS JOIN LATERAL generate_series(term.starts_on,term.ends_on,interval '1 day') day
      WHERE e.student_id=$1 AND e.is_active AND day::date>=current_date
        AND EXISTS (SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=e.class_section_id
          AND slot.term_id=e.term_id AND slot.weekday=extract(isodow FROM day) AND slot.slot_type='class')
        AND NOT EXISTS (SELECT 1 FROM school_calendar_days calendar
          WHERE calendar.school_id=term.school_id AND calendar.date=day::date AND NOT calendar.is_instructional)
        AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.student_id=e.student_id AND a.date=day::date)
        AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.student_id=e.student_id AND day::date BETWEEN l.starts_on AND l.ends_on)
      ORDER BY day LIMIT 1
    `, [home.student.id]);
    const leaveDate = available.rows[0]?.date;
    expect(leaveDate).toBeTruthy();
    const create = await guardian.request("/api/v1/leave-requests/", {
      method: "POST",
      body: JSON.stringify({ student_id: home.student.id, category: "family", starts_on: leaveDate, ends_on: leaveDate, reason: "Attending a close family ceremony with prior school notice." }),
    }, true);
    expect(create.status).toBe(201);
    const leave = await json(create); cleanupLeaves.push(leave.id);
    expect(leave.status).toBe("authorized");
    const decision = await principal.request(`/api/v1/leave-requests/${leave.id}/approve/`, { method: "POST", body: JSON.stringify({ note: "Approved against the school calendar." }) }, true);
    expect(decision.status).toBe(200);
    expect((await json(decision)).status).toBe("school_approved");
    const attendance = await pool.query("SELECT status, remarks FROM attendance_records WHERE student_id=$1 AND date=$2", [home.student.id, leaveDate]);
    expect(attendance.rows).toMatchObject([{ status: "excused", remarks: `Approved leave ${leave.id}` }]);
    const revision = await pool.query("SELECT reason FROM attendance_record_revisions WHERE attendance_record_id=(SELECT id FROM attendance_records WHERE student_id=$1 AND date=$2)", [home.student.id, leaveDate]);
    expect(revision.rows).toMatchObject([{ reason: "School-approved leave" }]);
    const outbox = await pool.query("SELECT event_type FROM event_outbox WHERE (aggregate_id=$1 OR payload->>'student_id'=$2) AND event_type IN ('leave.updated','attendance.updated')", [leave.id, home.student.id]);
    expect(outbox.rows.some((row) => row.event_type === "leave.updated")).toBe(true);
    expect(outbox.rows.some((row) => row.event_type === "attendance.updated")).toBe(true);
  });

  it("denies staff leave decisions and supporting-document mutations", async () => {
    const guardian = new BrowserSession();
    const staff = new BrowserSession();
    expect((await guardian.login("pooja.parent")).status).toBe(200);
    expect((await staff.login("kavita.staff")).status).toBe(200);
    const home = await json(await guardian.request("/api/v1/screens/parent/home/"));
    const create = await guardian.request("/api/v1/leave-requests/", {
      method: "POST",
      body: JSON.stringify({
        student_id: home.student.id,
        category: "family",
        starts_on: "2026-10-22",
        ends_on: "2026-10-22",
        reason: "Attending a family event with advance notice to the school.",
      }),
    }, true);
    expect(create.status).toBe(201);
    const leave = await json(create);
    cleanupLeaves.push(leave.id);
    expect(leave.status).toBe("authorized");

    const decision = await staff.request(`/api/v1/leave-requests/${leave.id}/approve/`, {
      method: "POST",
      body: JSON.stringify({ note: "A teacher must not make the school decision." }),
    }, true);
    expect(decision.status).toBe(403);

    const form = new FormData();
    form.set("file", new Blob(["not a real PDF"], { type: "application/pdf" }), "staff-upload.pdf");
    const document = await staff.request(`/api/v1/leave-requests/${leave.id}/documents/`, {
      method: "POST",
      body: form,
    }, true);
    expect(document.status).toBe(403);
    const persisted = await pool.query<{ status: string; document_count: string }>(`
      SELECT request.status,
        (SELECT count(*)::text FROM leave_documents document WHERE document.leave_request_id=request.id) AS document_count
      FROM leave_requests request
      WHERE request.id=$1
    `, [leave.id]);
    expect(persisted.rows[0]).toEqual({ status: "authorized", document_count: "0" });
  });

  it("answers attendance questions through the configured generic provider", async () => {
    const browser = new BrowserSession();
    await browser.login("aarav.student");
    const response = await browser.request("/api/v1/ai/attendance/query/", { method: "POST", body: JSON.stringify({ question: "What happens if I miss 2 more school days?" }) }, true);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ provider: "mock", model: "deterministic-attendance-v1", student_id: expect.any(String), conversation_id: expect.any(String) });
    expect(body.answer).toContain("2 additional absence(s)");
    expect(body.answer).not.toContain("undefined");
    expect(body.answer).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("serves a distinct live student home dashboard", async () => {
    const browser = new BrowserSession();
    await browser.login("aarav.student");
    const response = await browser.request("/api/v1/screens/student/home/");
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({
      student: { user: { display_name: "Aarav Sharma" } },
      attendance: { percentage: expect.any(Number) },
      today_schedule: expect.any(Array),
      diary_preview: expect.any(Array),
      active_leave_count: expect.any(Number),
      unread_notifications: expect.any(Number),
    });
  });

  it("computes class attendance ranking from recorded peer attendance", async () => {
    const browser = new BrowserSession();
    await browser.login("aarav.student");
    const body = await json(await browser.request("/api/v1/screens/student/attendance/"));
    expect(body.ranking).toMatchObject({
      published: true,
      cohort_size: 25,
      minimum_recorded_days: 5,
      current_rank: expect.any(Number),
    });
    const percentages = body.ranking.leaders.map((item: any) => item.percentage);
    expect(percentages).toHaveLength(3);
    expect(percentages[0]).toBe(100);
    expect(percentages).toEqual([...percentages].sort((left: number, right: number) => right - left));
    expect(body.ranking.leaders[0].name).toMatch(/\.$/);
    expect(body.ranking.leaders[0]).toMatchObject({ avatar_url: "/assets/ananya-iyer.png", streak: expect.any(Number) });
    const rosterSize=(await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM enrollments peer
      WHERE peer.is_active AND (peer.class_section_id,peer.term_id) IN (
        SELECT mine.class_section_id,mine.term_id FROM enrollments mine
        JOIN students student ON student.id=mine.student_id JOIN users account ON account.id=student.user_id
        WHERE account.username='aarav.student' AND mine.is_active
      )`)).rows[0]!.count;
    // The walking-transport demo added learners without enough recorded days to
    // rank. The list includes the full roster, not just the eligible cohort.
    expect(body.ranking.students).toHaveLength(rosterSize);
    expect(body.ranking.students[0]).toMatchObject({ rank: 1, percentage: 100, is_current: false });
    expect(body.ranking.students[0].name).toMatch(/\.$/);
    expect(body.ranking.students.filter((item: any) => item.is_current)).toMatchObject([
      { name: "Aarav Sharma", rank: body.ranking.current_rank },
    ]);
    expect(body.ranking.current_streak).toEqual(expect.any(Number));
  });

  it("keeps unscheduled term assignments out of the daily queue and rejects attendance writes", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    const date = "2026-09-13";
    const expected = (await pool.query(`SELECT DISTINCT slot.class_section_id
      FROM timetable_slots slot JOIN users u ON u.id=slot.teacher_user_id
      JOIN academic_terms term ON term.id=slot.term_id
      WHERE u.username='kavita.staff' AND $1::date BETWEEN term.starts_on AND term.ends_on`, [date])).rows;
    const response = await browser.request(`/api/v1/screens/teacher/home/?date=${date}`);
    expect(response.status).toBe(200);
    const home = await json(response);
    expect(expected.length).toBeGreaterThan(0);
    expect(home.classes).toEqual([]);
    const classId = expected[0].class_section_id;
    const registerResponse = await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${date}`);
    expect(registerResponse.status).toBe(200);
    const register = await json(registerResponse);
    expect(register.availability).toEqual({
      can_mark: false,
      reason: "No attendance is required because this class has no scheduled lesson.",
    });
    const save = await browser.request("/api/v1/teacher/attendance/bulk/", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        class_section_id: classId,
        date,
        expected_revision: register.register.revision,
        records: register.roster.map((row: any) => ({ student_id: row.id, status: "present", remarks: "" })),
      }),
    }, true);
    expect(save.status).toBe(400);
    expect(await json(save)).toMatchObject({ error: { detail: expect.stringMatching(/no scheduled lesson/i) } });
    const principal = new BrowserSession();
    expect((await principal.login("meera.principal")).status).toBe(200);
    const oversight = await json(await principal.request(`/api/v1/screens/principal/home/?date=${date}`));
    expect(oversight.summary).toMatchObject({ classes_total: 0, classes_submitted: 0, students: 0, marked: 0 });
    expect(oversight.classes).toEqual([]);
  });

  it("denies direct register access outside the teacher's assigned classes", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    const unrelated = (await pool.query(`SELECT cs.id FROM class_sections cs
      JOIN academic_terms term ON term.school_id=cs.school_id AND term.academic_year=cs.academic_year
      WHERE '2026-09-13'::date BETWEEN term.starts_on AND term.ends_on AND NOT EXISTS (
        SELECT 1 FROM timetable_slots slot JOIN users u ON u.id=slot.teacher_user_id
        WHERE slot.class_section_id=cs.id AND slot.term_id=term.id AND u.username='kavita.staff'
      ) LIMIT 1`)).rows[0];
    expect(unrelated).toBeTruthy();
    expect((await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${unrelated.id}&date=2026-09-13`)).status).toBe(403);
  });

  it("exposes future register availability without allowing an early submission", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    // Pick the next date that is both in the future in the school's timezone and
    // actually has a lesson for this teacher. Using UTC + 24h flakes when CI
    // runs after local midnight but before UTC midnight.
    const futureSchoolDay = (await pool.query<{ date: string }>(`
      WITH teacher_school AS (
        SELECT school.id, school.timezone
        FROM users teacher
        JOIN school_memberships membership ON membership.user_id=teacher.id AND membership.is_active
        JOIN schools school ON school.id=membership.school_id
        WHERE teacher.username='kavita.staff'
        LIMIT 1
      )
      SELECT candidate::date::text AS date
      FROM teacher_school school
      CROSS JOIN LATERAL generate_series(
        (now() AT TIME ZONE school.timezone)::date + 1,
        (now() AT TIME ZONE school.timezone)::date + 14,
        interval '1 day'
      ) candidate
      WHERE EXISTS (
        SELECT 1
        FROM effective_school_schedule(school.id, candidate::date) slot
        JOIN users teacher ON teacher.id=slot.teacher_user_id
        WHERE teacher.username='kavita.staff'
          AND slot.weekday=EXTRACT(ISODOW FROM candidate::date)::int
          AND slot.slot_type IN ('class','activity')
          AND NOT slot.cancelled
          AND slot.coverage_status IN ('not_required','accepted')
      )
      ORDER BY candidate
      LIMIT 1
    `)).rows[0];
    expect(futureSchoolDay).toBeTruthy();
    if (!futureSchoolDay) throw new Error("Expected a future scheduled school day for kavita.staff");
    const date = futureSchoolDay.date;
    const home = await json(await browser.request(`/api/v1/screens/teacher/home/?date=${date}`));
    expect(home.classes.length).toBeGreaterThan(0);
    expect(home.classes.every((row: any) => row.date_open === false)).toBe(true);
    const register = await json(await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${home.classes[0].class_section_id}&date=${date}`));
    expect(register.availability).toEqual({ can_mark: false, reason: "Attendance opens on the selected date." });
    const response = await browser.request("/api/v1/teacher/attendance/bulk/", {
      method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: JSON.stringify({
        class_section_id: register.class.id, date, expected_revision: register.register.revision,
        records: register.roster.map((row: any) => ({ student_id: row.id, status: "present" })),
      }),
    }, true);
    expect(response.status).toBe(400);
  });

  it("gives teachers an assigned register and persists an authorized bulk submission", async () => {
    await pool.query("DELETE FROM api_rate_limit_buckets");
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    const schoolDay = await latestScheduledDateForTeacher("kavita.staff");
    const home = await json(await browser.request(`/api/v1/screens/teacher/home/?date=${schoolDay}`));
    expect(home.teacher).toMatchObject({ name: "Kavita Mehta", role: "staff" });
    expect(home.classes.length).toBeGreaterThan(0);
    const classId = home.classes[0].class_section_id;
    const register = await json(await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${home.date}`));
    expect(register.roster).toHaveLength(25);
    const idempotencyKey = `attendance-test-${Date.now()}`;
    const payload = { class_section_id: classId, date: home.date, expected_revision: register.register.revision, records: register.roster.map((student: any) => ({ student_id: student.id, status: student.status ?? "present", remarks: student.remarks ?? "" })) };
    const response = await browser.request("/api/v1/teacher/attendance/bulk/", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) }, true);
    expect(response.status).toBe(200);
    const saved = await json(response);
    expect(saved.roster.every((student: any) => student.status)).toBe(true);
    expect(saved.register).toMatchObject({ state: "submitted", revision: expect.any(Number) });
    const refreshed = await json(await browser.request(`/api/v1/screens/teacher/home/?date=${home.date}`));
    expect(refreshed.classes.find((row: any) => row.class_section_id === classId)).toMatchObject({ submission_status: "submitted", submitted_by_name: "Kavita Mehta", submission_authorized: true });
    const principal = new BrowserSession();
    expect((await principal.login("meera.principal")).status).toBe(200);
    const oversight = await json(await principal.request(`/api/v1/screens/principal/home/?date=${home.date}`));
    expect(oversight.classes.find((row: any) => row.id === classId)).toMatchObject({ submission_status: "submitted", submitted_by_name: "Kavita Mehta", submission_authorized: true, assigned_teachers: expect.arrayContaining(["Kavita Mehta"]) });
    const replay = await browser.request("/api/v1/teacher/attendance/bulk/", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) }, true);
    expect(replay.status).toBe(200);
    expect((await json(replay)).register.revision).toBe(saved.register.revision);
    const conflictPayload = { ...payload, records: payload.records.map((row: any, index: number) => index === 0 ? { ...row, remarks: "Different retry payload" } : row) };
    const conflict = await browser.request("/api/v1/teacher/attendance/bulk/", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(conflictPayload) }, true);
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toMatchObject({ error: { code: "idempotency_conflict" } });
    const unauthorizedActor = (await pool.query(`SELECT membership.user_id
      FROM school_memberships membership
      WHERE membership.school_id=(SELECT school_id FROM class_sections WHERE id=$1::uuid)
        AND membership.role='staff' AND membership.is_active AND membership.user_id<>$2::uuid
        AND NOT EXISTS (
          SELECT 1 FROM effective_school_schedule(membership.school_id,$3::date) slot
          WHERE slot.class_section_id=$1::uuid AND slot.teacher_user_id=membership.user_id
            AND slot.weekday=EXTRACT(ISODOW FROM $3::date)::int AND NOT slot.cancelled
            AND slot.slot_type IN ('class','activity')
            AND slot.coverage_status IN ('not_required','accepted')
        ) LIMIT 1`, [classId, home.teacher.id, home.date])).rows[0];
    expect(unauthorizedActor).toBeTruthy();
    try {
      await pool.query("UPDATE attendance_registers SET submitted_by=$1::uuid WHERE class_section_id=$2::uuid AND date=$3::date", [unauthorizedActor.user_id, classId, home.date]);
      const mismatchOversight = await json(await principal.request(`/api/v1/screens/principal/home/?date=${home.date}`));
      expect(mismatchOversight.classes.find((row: any) => row.id === classId)).toMatchObject({ submission_status: "submitted", submission_authorized: false });
      expect(mismatchOversight.summary.classes_submitted).toBe(oversight.summary.classes_submitted - 1);
    } finally {
      await pool.query("UPDATE attendance_registers SET submitted_by=$1::uuid WHERE class_section_id=$2::uuid AND date=$3::date", [home.teacher.id, classId, home.date]);
    }
  });

  it("accepts current offline-safe observations and quarantines expired or paper captures for review", async () => {
    const teacher = new BrowserSession();
    const principal = new BrowserSession();
    expect((await teacher.login("kavita.staff")).status).toBe(200);
    expect((await principal.login("meera.principal")).status).toBe(200);
    const date = await latestScheduledDateForTeacher("kavita.staff");
    const home = await json(await teacher.request(`/api/v1/screens/teacher/home/?date=${date}`));
    const classId = home.classes[0].class_section_id;
    const register = await json(await teacher.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${date}`));
    expect(register.continuity_snapshot).toMatchObject({ roster_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), roster_count: register.roster.length });
    const records = register.roster.map((row: any) => ({ student_id: row.id, status: row.status ?? "present", remarks: row.remarks ?? "" }));
    const capture = {
      class_section_id: classId,
      date,
      expected_revision: register.register.revision,
      records,
      source: "live_app",
      source_reference: "",
      device_id: null,
      observed_at: new Date().toISOString(),
      roster_fingerprint: register.continuity_snapshot.roster_fingerprint,
      roster_captured_at: register.continuity_snapshot.captured_at,
      roster_expires_at: register.continuity_snapshot.expires_at,
      snapshot_token: register.continuity_snapshot.token,
    };
    const acceptedResponse = await teacher.request("/api/v1/attendance-continuity/batches/", {
      method: "POST", headers: { "Idempotency-Key": `continuity-live-${randomUUID()}` }, body: JSON.stringify(capture),
    }, true);
    expect(acceptedResponse.status).toBe(200);
    const accepted = await json(acceptedResponse);
    expect(accepted).toMatchObject({ status: "accepted", register: { register: { state: "submitted" }, latest_capture: { status: "accepted", source: "live_app" } } });
    expect((await pool.query("SELECT action FROM audit_events WHERE target_id=$1", [accepted.batch.id])).rows)
      .toContainEqual({ action: "attendance.capture.accepted" });

    const expiredResponse = await teacher.request("/api/v1/attendance-continuity/batches/", {
      method: "POST", headers: { "Idempotency-Key": `continuity-expired-${randomUUID()}` }, body: JSON.stringify({
        ...capture,
        expected_revision: accepted.register.register.revision,
        source: "offline_device",
        device_id: `test-device-${randomUUID()}`,
        roster_expires_at: new Date(Date.now() - 1_000).toISOString(),
      }),
    }, true);
    expect(expiredResponse.status).toBe(200);
    const expired = await json(expiredResponse);
    expect(expired).toMatchObject({ status: "quarantined", review: { reason_code: "snapshot_expired", state: "open" } });
    const rejected = await principal.request(`/api/v1/attendance-continuity/cases/${expired.review.id}/decision/`, {
      method: "POST", body: JSON.stringify({ decision: "reject", reason: "Expired device roster cannot be accepted automatically", expected_revision: accepted.register.register.revision }),
    }, true);
    expect(rejected.status).toBe(200);

    const paperRegister = await json(await principal.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${date}`));
    const paperResponse = await principal.request("/api/v1/attendance-continuity/batches/", {
      method: "POST", headers: { "Idempotency-Key": `continuity-paper-${randomUUID()}` }, body: JSON.stringify({
        class_section_id: classId,
        date,
        expected_revision: paperRegister.register.revision,
        records: paperRegister.roster.map((row: any) => ({ student_id: row.id, status: row.status, remarks: row.remarks ?? "" })),
        source: "paper",
        source_reference: "Register book 7A, page 42",
        device_id: null,
        observed_at: new Date().toISOString(),
        roster_fingerprint: paperRegister.continuity_snapshot.roster_fingerprint,
        roster_captured_at: paperRegister.continuity_snapshot.captured_at,
        roster_expires_at: paperRegister.continuity_snapshot.expires_at,
        snapshot_token: paperRegister.continuity_snapshot.token,
      }),
    }, true);
    expect(paperResponse.status).toBe(200);
    const paper = await json(paperResponse);
    expect(paper).toMatchObject({ status: "quarantined", review: { reason_code: "source_requires_review" } });
    const applied = await principal.request(`/api/v1/attendance-continuity/cases/${paper.review.id}/decision/`, {
      method: "POST", body: JSON.stringify({ decision: "accept", reason: "Matched every row against the signed paper register", expected_revision: paperRegister.register.revision }),
    }, true);
    expect(applied.status).toBe(200);
    const stored = await pool.query("SELECT capture_source,observed_at FROM attendance_submissions WHERE capture_batch_id=$1", [paper.batch.id]);
    expect(stored.rows).toMatchObject([{ capture_source: "paper", observed_at: expect.any(Date) }]);
    await expect(pool.query("UPDATE attendance_observations SET remarks='tampered' WHERE batch_id=$1", [paper.batch.id])).rejects.toThrow(/append-only/i);
  });

  it("limits staff student records to their current timetable assignments", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    const fixtures = await pool.query<{ assigned_id: string; unrelated_id: string }>(`
      WITH teacher AS (
        SELECT id FROM users WHERE username='kavita.staff'
      ), assigned AS (
        SELECT DISTINCT enrollment.student_id
        FROM enrollments enrollment
        JOIN timetable_slots slot
          ON slot.class_section_id=enrollment.class_section_id
          AND slot.term_id=enrollment.term_id
        JOIN teacher ON teacher.id=slot.teacher_user_id
        WHERE enrollment.is_active
      )
      SELECT
        (SELECT student_id FROM assigned ORDER BY student_id LIMIT 1) AS assigned_id,
        (SELECT student.id FROM students student
          WHERE NOT EXISTS (SELECT 1 FROM assigned WHERE assigned.student_id=student.id)
          ORDER BY student.id LIMIT 1) AS unrelated_id
    `);
    const fixture = fixtures.rows[0]!;
    expect(fixture?.assigned_id).toBeTruthy();
    expect(fixture?.unrelated_id).toBeTruthy();

    const accessible = await json(await browser.request("/api/v1/students/"));
    const ids = accessible.results.map((student: { id: string }) => student.id);
    expect(ids).toContain(fixture.assigned_id);
    expect(ids).not.toContain(fixture.unrelated_id);

    const unrelatedAttendance = await browser.request(`/api/v1/attendance-records/?student_id=${fixture.unrelated_id}`);
    expect(unrelatedAttendance.status).toBe(404);
  });

  it("revalidates teacher authority inside the attendance write transaction", async () => {
    const database = new DatabaseService();
    const events = new SchoolEventService(database);
    const school = new SchoolService(database, events);
    const user = (await pool.query<{
      id: string; username: string; email: string; first_name: string;
      last_name: string; role: "staff"; is_active: boolean;
    }>(`
      SELECT id, username, email, first_name, last_name, role, is_active
      FROM users WHERE username='kavita.staff'
    `)).rows[0]!;
    const date = await latestScheduledDateForTeacher("kavita.staff");
    const home = await school.teacherHomeScreen(user, date);
    const selectedClass = home.classes[0]!;
    expect(selectedClass).toBeDefined();
    const screen = await school.teacherAttendanceScreen(user, selectedClass.class_section_id, date);
    const payload = {
      class_section_id: selectedClass.class_section_id,
      date,
      expected_revision: screen.register.revision,
      reason: "Concurrent authorization safety test",
      records: screen.roster.map((student) => ({
        student_id: student.id,
        status: student.status ?? "present",
        remarks: student.remarks ?? "",
      })),
    };
    const request = {
      headers: { "idempotency-key": `authority-race-${randomUUID()}` },
      requestId: randomUUID(),
    } as unknown as AuthenticatedRequest;
    type SchoolRoleHook = (
      authenticatedUser: AuthUser,
      roles: Array<"staff" | "admin">,
      schoolId?: string,
    ) => Promise<unknown>;
    const schoolInternals = school as unknown as { requireSchoolRole: SchoolRoleHook };
    const originalRequireSchoolRole = schoolInternals.requireSchoolRole.bind(school);
    let roleChecks = 0;
    let signalPreflight!: () => void;
    let releasePreflight!: () => void;
    const preflightReached = new Promise<void>((resolve) => { signalPreflight = resolve; });
    const continueWrite = new Promise<void>((resolve) => { releasePreflight = resolve; });
    schoolInternals.requireSchoolRole = async (...args: Parameters<SchoolRoleHook>) => {
      const membership = await originalRequireSchoolRole(...args);
      roleChecks += 1;
      // Entry guard, screen access, then the pre-transaction membership check.
      // Pause after the latter so revocation is caught inside the write lock.
      if (roleChecks === 3) {
        signalPreflight();
        await continueWrite;
      }
      return membership;
    };

    const save = school.saveTeacherAttendance(user, payload, request);
    try {
      await preflightReached;
      const revoked = await pool.query(`
        UPDATE school_memberships
        SET is_active=false
        WHERE user_id=$1 AND school_id=$2 AND role='staff' AND is_active
      `, [user.id, screen.class.school_id]);
      expect(revoked.rowCount).toBe(1);
      releasePreflight();
      await expect(save).rejects.toThrow(/active school staff membership/i);
    } finally {
      releasePreflight();
      await save.catch(() => undefined);
      await pool.query(`
        UPDATE school_memberships
        SET is_active=true
        WHERE user_id=$1 AND school_id=$2 AND role='staff'
      `, [user.id, screen.class.school_id]);
      schoolInternals.requireSchoolRole = originalRequireSchoolRole;
      await database.destroy();
    }
  });

  it("keeps legacy direct attendance CRUD disabled; writes use reviewed register commands", async () => {
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    const legacyCreate = await browser.request("/api/v1/attendance-records/", {
      method: "POST",
      body: JSON.stringify({
        student_id: randomUUID(),
        class_section_id: randomUUID(),
        date: "2026-09-14",
        status: "present",
      }),
    }, true);
    expect(legacyCreate.status).toBe(404);
    const legacyUpdate = await browser.request(`/api/v1/attendance-records/${randomUUID()}/`, {
      method: "PATCH",
      body: JSON.stringify({ status: "absent", reason: "Legacy direct edit" }),
    }, true);
    expect(legacyUpdate.status).toBe(404);
  });

  it("lets a principal lock and reopen a register while blocking teacher corrections", async () => {
    const teacher = new BrowserSession();
    const principal = new BrowserSession();
    expect((await teacher.login("kavita.staff")).status).toBe(200);
    expect((await principal.login("meera.principal")).status).toBe(200);
    const date = await latestScheduledDateForTeacher("kavita.staff");
    const home = await json(await teacher.request(`/api/v1/screens/teacher/home/?date=${date}`));
    const classId = home.classes[0].class_section_id;
    let register = await json(await teacher.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${date}`));
    if (register.register.state === "draft") {
      register = await json(await teacher.request("/api/v1/teacher/attendance/bulk/", {
        method: "POST", headers: { "Idempotency-Key": `lock-setup-${Date.now()}` },
        body: JSON.stringify({ class_section_id: classId, date, expected_revision: register.register.revision, records: register.roster.map((row: any) => ({ student_id: row.id, status: row.status ?? "present", remarks: row.remarks ?? "" })) }),
      }, true));
    }
    const lockedResponse = await principal.request(`/api/v1/attendance-registers/${classId}/lock/?date=${date}`, { method: "POST", body: JSON.stringify({}) }, true);
    expect(lockedResponse.status).toBe(200);
    const locked = await json(lockedResponse);
    expect(locked.register.state).toBe("locked");
    const blocked = await teacher.request("/api/v1/teacher/attendance/bulk/", {
      method: "POST", headers: { "Idempotency-Key": `locked-edit-${Date.now()}` },
      body: JSON.stringify({
        class_section_id: classId,
        date,
        expected_revision: locked.register.revision,
        reason: "Teacher correction after lock",
        records: locked.roster.map((row: any) => ({
          student_id: row.id,
          status: row.status ?? "present",
          remarks: row.remarks ?? "",
        })),
      }),
    }, true);
    expect(blocked.status).toBe(403);
    const reopenedResponse = await principal.request(`/api/v1/attendance-registers/${classId}/lock/?date=${date}`, { method: "DELETE", body: JSON.stringify({ reason: "Reopened to correct a verified register entry" }) }, true);
    expect(reopenedResponse.status).toBe(200);
    expect((await json(reopenedResponse)).register).toMatchObject({ state: "submitted", reopened_by: expect.any(String) });
  });

  it("restricts principal oversight and timetable control to school administrators", async () => {
    await pool.query("DELETE FROM api_rate_limit_buckets");
    const student = new BrowserSession(); await student.login("aarav.student");
    expect((await student.request("/api/v1/screens/principal/home/")).status).toBe(403);
    const principal = new BrowserSession(); expect((await principal.login("meera.principal")).status).toBe(200);
    const schoolDate = await latestScheduledDateForTeacher("kavita.staff");
    const overview = await json(await principal.request(`/api/v1/screens/principal/home/?date=${schoolDate}`));
    expect(overview.summary).toMatchObject({ students: 200, classes_total: 8 });
    expect(overview.classes).toHaveLength(8);
    const timetable = await json(await principal.request("/api/v1/screens/principal/timetable/"));
    expect(timetable.terms).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.any(String), academic_year: "2026-27" })]));
    expect(timetable.selected_term_id).toEqual(expect.any(String));
    expect(timetable.slots.length).toBeGreaterThan(250);
    expect(timetable.classes).toHaveLength(8);
    expect(timetable.teachers).toHaveLength(17);
    expect(timetable.coverage).toHaveLength(timetable.classes.length * timetable.subjects.length);
    expect(timetable.calendar_exceptions).toEqual(expect.any(Array));
    const coveredSlot = timetable.slots.find((item: any) => item.weekday >= 1 && item.weekday <= 5 && item.subject_id);
    expect(coveredSlot).toBeDefined();
    const initialCoverage = timetable.coverage.find((item: any) => item.class_section_id === coveredSlot.class_section_id && item.subject_id === coveredSlot.subject_id);
    expect(initialCoverage.projected_minutes).toBeGreaterThan(0);
    const targetResponse = await principal.request("/api/v1/principal/timetable/targets/", {
      method: "POST",
      body: JSON.stringify({
        term_id: timetable.selected_term_id,
        class_section_id: coveredSlot.class_section_id,
        subject_id: coveredSlot.subject_id,
        target_minutes: initialCoverage.projected_minutes + 180,
        expected_revision: 0,
        reason: "Verify term curriculum coverage planning",
      }),
    }, true);
    expect(targetResponse.status).toBe(201);
    expect(await json(targetResponse)).toMatchObject({ target_minutes: initialCoverage.projected_minutes + 180, revision: 1 });
    expect((await principal.request("/api/v1/principal/timetable/targets/", {
      method: "POST",
      body: JSON.stringify({
        term_id: timetable.selected_term_id,
        class_section_id: coveredSlot.class_section_id,
        subject_id: coveredSlot.subject_id,
        target_minutes: initialCoverage.projected_minutes + 240,
        expected_revision: 0,
        reason: "Reject a stale curriculum edit",
      }),
    }, true)).status).toBe(409);
    const availableClosure = (await pool.query<{ date: string }>(`
      SELECT day::date::text AS date
      FROM generate_series(GREATEST(current_date + 7, $1::date), $2::date, '1 day') day
      WHERE extract(isodow FROM day)=$3
        AND NOT EXISTS(SELECT 1 FROM school_calendar_days calendar WHERE calendar.school_id=$4 AND calendar.date=day::date)
        AND NOT EXISTS(SELECT 1 FROM attendance_registers register WHERE register.school_id=$4 AND register.date=day::date)
      ORDER BY day LIMIT 1
    `, [timetable.terms.find((item: any) => item.id === timetable.selected_term_id).starts_on, timetable.terms.find((item: any) => item.id === timetable.selected_term_id).ends_on, coveredSlot.weekday, overview.classes[0].school_id ?? (await pool.query("SELECT school_id FROM class_sections WHERE id=$1", [coveredSlot.class_section_id])).rows[0].school_id])).rows[0];
    expect(availableClosure).toBeDefined();
    if (!availableClosure) throw new Error("Expected an available school date for closure coverage");
    const closureResponse = await principal.request("/api/v1/principal/calendar/closures/", {
      method: "POST",
      body: JSON.stringify({
        term_id: timetable.selected_term_id,
        starts_on: availableClosure.date,
        ends_on: availableClosure.date,
        kind: "public_holiday",
        label: "Integration planning holiday",
        reason: "Verify dated timetable exceptions",
      }),
    }, true);
    expect(closureResponse.status).toBe(201);
    const closure = (await json(closureResponse)).results[0];
    const afterClosure = await json(await principal.request(`/api/v1/screens/principal/timetable/?term_id=${timetable.selected_term_id}`));
    const reducedCoverage = afterClosure.coverage.find((item: any) => item.class_section_id === coveredSlot.class_section_id && item.subject_id === coveredSlot.subject_id);
    expect(reducedCoverage.projected_minutes).toBeLessThan(initialCoverage.projected_minutes);
    const removedClosure = await principal.request(`/api/v1/principal/calendar/closures/${availableClosure.date}/`, {
      method: "DELETE",
      body: JSON.stringify({ expected_revision: closure.revision, reason: "Integration cleanup" }),
    }, true);
    expect(removedClosure.status).toBe(200);
    await pool.query("DELETE FROM curriculum_subject_targets WHERE term_id=$1 AND class_section_id=$2 AND subject_id=$3", [timetable.selected_term_id, coveredSlot.class_section_id, coveredSlot.subject_id]);
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'timetable.curriculum_target.%' OR (action LIKE 'school_calendar.%' AND metadata->>'label'='Integration planning holiday')");
    await pool.query("DELETE FROM event_outbox WHERE event_type='calendar.updated' OR (event_type='timetable.updated' AND aggregate_id=$1)", [coveredSlot.class_section_id]);
    const draft = { class_section_id: timetable.classes[0].id, subject_id: timetable.subjects[0].id, teacher_user_id: timetable.teachers[0].id, weekday: 6, period_number: 9, starts_at: "14:00", ends_at: "14:45", slot_type: "class", title: "", room: "Seminar 2", teacher_designation: "Subject Teacher" };
    const createdResponse = await principal.request("/api/v1/principal/timetable/slots/", { method: "POST", body: JSON.stringify(draft) }, true);
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    const updatedResponse = await principal.request(`/api/v1/principal/timetable/slots/${created.id}/`, { method: "PATCH", body: JSON.stringify({ ...draft, starts_at: "14:50", ends_at: "15:35" }) }, true);
    expect(updatedResponse.status).toBe(200);
    expect((await json(updatedResponse)).starts_at).toContain("14:50");
    const copyResponse = await principal.request("/api/v1/principal/timetable/copy-day/", {
      method: "POST",
      body: JSON.stringify({
        term_id: timetable.selected_term_id,
        class_section_id: timetable.classes[0].id,
        source_weekday: 6,
        target_weekdays: [7],
        replace: false,
        reason: "Verify atomic principal timetable copy workflow",
      }),
    }, true);
    expect(copyResponse.status).toBe(201);
    const copied = await json(copyResponse);
    expect(copied).toMatchObject({ copied: true, target_weekdays: [7] });
    expect(copied.periods_created).toBeGreaterThan(0);
    const copiedRows = await pool.query<{ id: string }>(
      "SELECT id FROM timetable_slots WHERE term_id=$1 AND class_section_id=$2 AND weekday=7",
      [timetable.selected_term_id, timetable.classes[0].id],
    );
    expect(copiedRows.rows).toHaveLength(copied.periods_created);
    const copiedIds = copiedRows.rows.map((row) => row.id);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_id = ANY($1::uuid[])", [copiedIds]);
    await pool.query("DELETE FROM audit_events WHERE target_id = ANY($1::uuid[])", [copiedIds]);
    await pool.query("DELETE FROM timetable_slots WHERE id = ANY($1::uuid[])", [copiedIds]);
    const deletedResponse = await principal.request(`/api/v1/principal/timetable/slots/${created.id}/`, { method: "DELETE" }, true);
    expect(deletedResponse.status).toBe(200);
    expect(await json(deletedResponse)).toEqual({ deleted: true, id: created.id });
  });

  it("weights half days and excludes excused records from the principal daily attendance score", async () => {
    const principal = new BrowserSession();
    const login = await principal.login("meera.principal");
    expect(login.status).toBe(200);
    const identity = await json(await principal.request("/api/v1/auth/me/"));
    const schoolId = identity.memberships.find((membership: any) => membership.role === "admin")?.school_id;
    expect(schoolId).toEqual(expect.any(String));

    const dateResult = await pool.query<{ date: string }>(`
      SELECT record.date::text AS date
      FROM attendance_records record
      JOIN class_sections section ON section.id=record.class_section_id
      WHERE section.school_id=$1
      GROUP BY record.date
      HAVING bool_or(record.status='half_day')
        AND bool_or(record.status='excused')
        AND bool_or(record.status='absent')
        AND bool_or(record.status IN ('present','late'))
      ORDER BY record.date DESC
      LIMIT 1
    `, [schoolId]);
    const date = dateResult.rows[0]?.date;
    expect(date).toEqual(expect.any(String));

    const expected = await pool.query<{
      class_section_id: string;
      student_count: string;
      marked_count: string;
      scored_count: string;
      points: string;
      absent_count: string;
      late_count: string;
      excused_count: string;
      half_day_count: string;
    }>(`
      SELECT section.id AS class_section_id,
        count(enrollment.student_id)::text AS student_count,
        count(record.id)::text AS marked_count,
        count(record.id) FILTER (WHERE record.status <> 'excused')::text AS scored_count,
        COALESCE(sum(CASE
          WHEN record.status IN ('present','late') THEN 1.0
          WHEN record.status='half_day' THEN 0.5
          ELSE 0
        END), 0)::text AS points,
        count(record.id) FILTER (WHERE record.status='absent')::text AS absent_count,
        count(record.id) FILTER (WHERE record.status='late')::text AS late_count,
        count(record.id) FILTER (WHERE record.status='excused')::text AS excused_count,
        count(record.id) FILTER (WHERE record.status='half_day')::text AS half_day_count
      FROM class_sections section
      JOIN academic_terms term ON term.school_id=section.school_id
        AND term.academic_year=section.academic_year
        AND $2::date BETWEEN term.starts_on AND term.ends_on
      LEFT JOIN enrollments enrollment ON enrollment.class_section_id=section.id
        AND enrollment.term_id=term.id AND enrollment.is_active
      LEFT JOIN attendance_records record ON record.student_id=enrollment.student_id
        AND record.class_section_id=section.id AND record.date=$2::date
      WHERE section.school_id=$1
      GROUP BY section.id
      ORDER BY section.id
    `, [schoolId, date]);
    expect(expected.rows.reduce((count, row) => count + Number(row.half_day_count), 0)).toBeGreaterThan(0);
    expect(expected.rows.reduce((count, row) => count + Number(row.excused_count), 0)).toBeGreaterThan(0);

    const response = await principal.request(`/api/v1/screens/principal/home/?date=${date}`);
    expect(response.status).toBe(200);
    const dashboard = await json(response);
    const expectedByClass = new Map(expected.rows.map((row) => [row.class_section_id, row]));
    expect(dashboard.classes).toHaveLength(expected.rows.length);
    for (const actual of dashboard.classes) {
      const row = expectedByClass.get(actual.id)!;
      const scored = Number(row.scored_count);
      const points = Number(row.points);
      expect(actual).toMatchObject({
        student_count: Number(row.student_count),
        marked_count: Number(row.marked_count),
        scored_count: Number(row.scored_count),
        absent_count: Number(row.absent_count),
        late_count: Number(row.late_count),
        excused_count: Number(row.excused_count),
        attendance_percentage: scored ? Math.round(points * 10_000 / scored) / 100 : 0,
      });
      expect(Number(actual.attending_count)).toBe(points);
    }

    const totals = expected.rows.reduce((result, row) => ({
      students: result.students + Number(row.student_count),
      marked: result.marked + Number(row.marked_count),
      scored: result.scored + Number(row.scored_count),
      attending: result.attending + Number(row.points),
      absent: result.absent + Number(row.absent_count),
      late: result.late + Number(row.late_count),
      excused: result.excused + Number(row.excused_count),
    }), { students: 0, marked: 0, scored: 0, attending: 0, absent: 0, late: 0, excused: 0 });
    expect(dashboard.summary).toMatchObject({
      ...totals,
      attendance_percentage: Math.round(totals.attending * 10_000 / totals.scored) / 100,
    });
  });

  it("deduplicates overdue register alerts and targets only the assigned teacher and school administrator", async () => {
    const schoolId = randomUUID();
    const termId = randomUUID();
    const classSectionId = randomUUID();
    const slotId = randomUUID();
    const code = `OVERDUE-${randomUUID().slice(0, 8)}`;
    const idempotencyKey = `attendance-register-overdue:${schoolId}:${classSectionId}`;
    let eventId: string | undefined;
    const eventDatabase = new DatabaseService();
    const scanner = new SchoolEventService(eventDatabase);
    try {
      const actors = await pool.query<{ teacher_id: string; admin_id: string }>(`
        SELECT teacher.id AS teacher_id, administrator.id AS admin_id
        FROM users teacher CROSS JOIN users administrator
        WHERE teacher.username='kavita.staff' AND administrator.username='meera.principal'
      `);
      const actor = actors.rows[0]!;
      await pool.query(`
        INSERT INTO schools (id, name, code, timezone, attendance_submission_cutoff)
        VALUES ($1, 'Overdue Register Integration School', $2, 'Asia/Kolkata', '00:00')
      `, [schoolId, code]);
      const fixture = await pool.query<{ school_date: string; weekday: number }>(`
        SELECT (now() AT TIME ZONE timezone)::date::text AS school_date,
          EXTRACT(ISODOW FROM (now() AT TIME ZONE timezone)::date)::int AS weekday
        FROM schools WHERE id=$1
      `, [schoolId]);
      const schoolDate = fixture.rows[0]!.school_date;
      await pool.query(`
        INSERT INTO academic_terms (
          id, school_id, academic_year, name, starts_on, ends_on,
          attendance_threshold, is_active
        ) VALUES ($1, $2, '2099-00', 'Integration term', $3::date - 1, $3::date + 1, 85, true)
      `, [termId, schoolId, schoolDate]);
      await pool.query(`
        INSERT INTO class_sections (
          id, school_id, academic_year, grade, section, board, room_number
        ) VALUES ($1, $2, '2099-00', 'IT', 'O', 'Integration', 'Lab')
      `, [classSectionId, schoolId]);
      await pool.query(`
        INSERT INTO school_memberships (user_id, school_id, role, is_active)
        VALUES ($1, $3, 'staff', true), ($2, $3, 'admin', true)
      `, [actor.teacher_id, actor.admin_id, schoolId]);
      await pool.query(`
        INSERT INTO timetable_slots (
          id, class_section_id, term_id, weekday, period_number,
          starts_at, ends_at, slot_type, title, room,
          teacher_user_id, teacher_designation
        ) VALUES (
          $1, $2, $3, $4, 1, '09:00', '09:45', 'activity',
          'Morning advisory', 'Lab', $5, 'Class teacher'
        )
      `, [slotId, classSectionId, termId, fixture.rows[0]!.weekday, actor.teacher_id]);
      const fullIdempotencyKey = `${idempotencyKey}:${schoolDate}`;

      await pool.query(`
        UPDATE event_maintenance_leases SET last_claimed_at=NULL
        WHERE task_name='attendance_register_overdue_scan'
      `);
      await (scanner as unknown as { enqueueOverdueRegisters(): Promise<void> }).enqueueOverdueRegisters();
      for (let attempt = 0; attempt < 100 && !eventId; attempt++) {
        const event = await pool.query<{ id: string }>(
          "SELECT id FROM event_outbox WHERE idempotency_key=$1",
          [fullIdempotencyKey],
        );
        eventId = event.rows[0]?.id;
        if (!eventId) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(eventId).toEqual(expect.any(String));
      await waitForPublishedEvent(eventId!);

      const event = await pool.query<{
        event_type: string;
        audience_user_ids: string[];
        notification_user_ids: string[];
        payload: any;
      }>(`
        SELECT event_type, audience_user_ids, notification_user_ids, payload
        FROM event_outbox WHERE id=$1
      `, [eventId]);
      const expectedAudience = [actor.teacher_id, actor.admin_id].sort();
      expect([...event.rows[0]!.audience_user_ids].sort()).toEqual(expectedAudience);
      expect([...event.rows[0]!.notification_user_ids].sort()).toEqual(expectedAudience);
      expect(event.rows[0]).toMatchObject({
        event_type: "attendance.register.overdue",
        payload: {
          class_section_id: classSectionId,
          term_id: termId,
          date: schoolDate,
          state: "overdue",
        },
      });

      const notifications = await pool.query<{ recipient_id: string; role: string; link: string }>(`
        SELECT notification.recipient_id, account.role, notification.link
        FROM notifications notification
        JOIN users account ON account.id=notification.recipient_id
        WHERE notification.dedupe_key=$1
        ORDER BY notification.recipient_id
      `, [`event:${eventId}`]);
      expect(notifications.rows.map((row) => row.recipient_id).sort()).toEqual(expectedAudience);
      expect(notifications.rows.find((row) => row.role === "staff")?.link).toBe(`/teacher/attendance?class_section_id=${classSectionId}&date=${schoolDate}`);
      expect(notifications.rows.find((row) => row.role === "admin")?.link).toBe(`/principal/attendance?class_section_id=${classSectionId}&date=${schoolDate}`);

      await pool.query(`
        UPDATE event_maintenance_leases SET last_claimed_at=NULL
        WHERE task_name='attendance_register_overdue_scan'
      `);
      await (scanner as unknown as { enqueueOverdueRegisters(): Promise<void> }).enqueueOverdueRegisters();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const duplicateCounts = await pool.query<{ events: string; notifications: string }>(`
        SELECT
          (SELECT count(*)::text FROM event_outbox WHERE idempotency_key=$1) AS events,
          (SELECT count(*)::text FROM notifications WHERE dedupe_key=$2) AS notifications
      `, [fullIdempotencyKey, `event:${eventId}`]);
      expect(duplicateCounts.rows[0]).toEqual({ events: "1", notifications: "2" });
    } finally {
      if (eventId) await pool.query("DELETE FROM notifications WHERE dedupe_key=$1", [`event:${eventId}`]);
      await pool.query("DELETE FROM event_outbox WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM students WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM guardian_school_profiles WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM school_people WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM schools WHERE id=$1", [schoolId]);
      await eventDatabase.destroy();
    }
  });

  it("refreshes half-day subject attendance from checkout times with a deterministic first-half fallback", async () => {
    const schoolId = randomUUID();
    const termId = randomUUID();
    const classSectionId = randomUUID();
    const studentUserId = randomUUID();
    const guardianUserId = randomUUID();
    const studentId = randomUUID();
    const guardianId = randomUUID();
    const firstSubjectId = randomUUID();
    const secondSubjectId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const database = new DatabaseService();
    const events = new SchoolEventService(database);
    const school = new SchoolService(database, events);
    try {
      await pool.query(`
        INSERT INTO users (
          id, username, email, password_hash, first_name, last_name, role, is_active
        ) VALUES
          ($1, $3, $4, 'integration-only', 'Subject', 'Student', 'student', true),
          ($2, $5, $6, 'integration-only', 'Subject', 'Guardian', 'parent', true)
      `, [
        studentUserId,
        guardianUserId,
        `subject.student.${suffix}`,
        `subject.student.${suffix}@example.test`,
        `subject.guardian.${suffix}`,
        `subject.guardian.${suffix}@example.test`,
      ]);
      await pool.query(`
        INSERT INTO schools (id, name, code, timezone, attendance_submission_cutoff)
        VALUES ($1, 'Subject Attendance Integration School', $2, 'Asia/Kolkata', '10:30')
      `, [schoolId, `SUBJECT-${suffix}`]);
      const dates = await pool.query<{ fallback_date: string; checkout_date: string }>(`
        SELECT ((now() AT TIME ZONE timezone)::date - 2)::text AS fallback_date,
          ((now() AT TIME ZONE timezone)::date - 1)::text AS checkout_date
        FROM schools WHERE id=$1
      `, [schoolId]);
      const { fallback_date: fallbackDate, checkout_date: checkoutDate } = dates.rows[0]!;
      await pool.query(`
        INSERT INTO academic_terms (
          id, school_id, academic_year, name, starts_on, ends_on,
          attendance_threshold, is_active
        ) VALUES ($1, $2, '2099-00', 'Integration term', $3::date - 5, $4::date + 1, 85, true)
      `, [termId, schoolId, fallbackDate, checkoutDate]);
      await pool.query(`
        INSERT INTO class_sections (
          id, school_id, academic_year, grade, section, board, room_number
        ) VALUES ($1, $2, '2099-00', 'IT', 'H', 'Integration', 'Half-day lab')
      `, [classSectionId, schoolId]);
      await pool.query(`
        INSERT INTO students (
          id, user_id, school_id, admission_number, avatar_url
        ) VALUES ($1, $2, $3, $4, '')
      `, [studentId, studentUserId, schoolId, `SUB-${suffix}`]);
      await pool.query(`
        INSERT INTO parents (id, user_id, phone) VALUES ($1, $2, '+910000000000')
      `, [guardianId, guardianUserId]);
      await pool.query(`
        INSERT INTO guardian_relationships (
          guardian_id, student_id, relationship, is_primary, can_authorize_leave
        ) VALUES ($1, $2, 'guardian', true, true)
      `, [guardianId, studentId]);
      await pool.query(`
        INSERT INTO school_memberships (user_id, school_id, role, is_active)
        VALUES ($1, $3, 'student', true), ($2, $3, 'guardian', true)
      `, [studentUserId, guardianUserId, schoolId]);
      await pool.query(`
        INSERT INTO enrollments (
          student_id, class_section_id, term_id, roll_number, is_active
        ) VALUES ($1, $2, $3, 1, true)
      `, [studentId, classSectionId, termId]);
      await pool.query(`
        INSERT INTO subjects (id, school_id, code, name, short_name, color, icon)
        VALUES
          ($1, $3, 'SUB-A', 'Subject A', 'A', '#1D4ED8', 'book-open'),
          ($2, $3, 'SUB-B', 'Subject B', 'B', '#1D4ED8', 'book-open')
      `, [firstSubjectId, secondSubjectId, schoolId]);
      await pool.query(`
        INSERT INTO timetable_slots (
          class_section_id, term_id, subject_id, weekday, period_number,
          starts_at, ends_at, slot_type, title, room, teacher_designation
        )
        SELECT $1, $2, fixture.subject_id, fixture.weekday, fixture.period_number,
          fixture.starts_at, fixture.ends_at, 'class', fixture.title, 'Half-day lab', 'Subject teacher'
        FROM (
          VALUES
            ($3::uuid, EXTRACT(ISODOW FROM $5::date)::int, 1::smallint, '09:00'::time, '09:45'::time, 'A1'),
            ($4::uuid, EXTRACT(ISODOW FROM $5::date)::int, 2::smallint, '10:00'::time, '10:45'::time, 'B1'),
            ($3::uuid, EXTRACT(ISODOW FROM $5::date)::int, 3::smallint, '11:00'::time, '11:45'::time, 'A2'),
            ($4::uuid, EXTRACT(ISODOW FROM $5::date)::int, 4::smallint, '12:00'::time, '12:45'::time, 'B2'),
            ($3::uuid, EXTRACT(ISODOW FROM $6::date)::int, 1::smallint, '09:00'::time, '09:45'::time, 'A1'),
            ($4::uuid, EXTRACT(ISODOW FROM $6::date)::int, 2::smallint, '10:00'::time, '10:45'::time, 'B1'),
            ($3::uuid, EXTRACT(ISODOW FROM $6::date)::int, 3::smallint, '11:00'::time, '11:45'::time, 'A2'),
            ($4::uuid, EXTRACT(ISODOW FROM $6::date)::int, 4::smallint, '12:00'::time, '12:45'::time, 'B2')
        ) AS fixture(subject_id, weekday, period_number, starts_at, ends_at, title)
      `, [classSectionId, termId, firstSubjectId, secondSubjectId, fallbackDate, checkoutDate]);
      await pool.query(`
        INSERT INTO attendance_records (
          student_id, class_section_id, date, status, check_out_at, remarks
        ) VALUES
          ($1, $2, $3, 'half_day', NULL, 'No checkout; use the first-half fallback'),
          ($1, $2, $4, 'half_day', (($4::date + '11:50'::time) AT TIME ZONE 'Asia/Kolkata'), 'Checkout after period three')
      `, [studentId, classSectionId, fallbackDate, checkoutDate]);

      await (school as unknown as {
        refreshSubjectAttendance(db: DatabaseService, studentIds: string[]): Promise<void>;
      }).refreshSubjectAttendance(database, [studentId]);

      const actual = await pool.query<{
        subject_id: string;
        classes_held: number;
        classes_attended: number;
        classes_excused: number;
      }>(`
        SELECT subject_id, classes_held, classes_attended, classes_excused
        FROM subject_attendance
        WHERE student_id=$1 AND term_id=$2
        ORDER BY subject_id
      `, [studentId, termId]);
      const bySubject = new Map(actual.rows.map((row) => [row.subject_id, {
        classes_held: Number(row.classes_held),
        classes_attended: Number(row.classes_attended),
        classes_excused: Number(row.classes_excused),
      }]));
      // On the no-checkout day, four periods deterministically allocate the
      // first two (A1/B1). The 11:50 checkout on the second day includes
      // A1/B1/A2 but excludes B2.
      expect(bySubject.get(firstSubjectId)).toEqual({
        classes_held: 4,
        classes_attended: 3,
        classes_excused: 0,
      });
      expect(bySubject.get(secondSubjectId)).toEqual({
        classes_held: 4,
        classes_attended: 2,
        classes_excused: 0,
      });
    } finally {
      await pool.query("DELETE FROM guardian_relationships WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM students WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM guardian_school_profiles WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM school_people WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM schools WHERE id=$1", [schoolId]);
      await pool.query("DELETE FROM parents WHERE id=$1", [guardianId]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[studentUserId, guardianUserId]]);
      await database.destroy();
    }
  });
});
