import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestApiSession, startManagedTestApi, type ManagedTestApi } from "./http-api.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Ordinary compiled HTTP acceptance, not a second API/runtime harness. The
// owning runner must finish the reviewed build and supply its disposable store.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true" && process.env.CHAT_HTTP_TEST_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/chat_http_unused_test";
const port = 8087;
interface Policy {
  revision: number;
  student_teacher_direct_enabled: boolean;
  guardian_teacher_direct_enabled: boolean;
  student_group_replies: boolean;
  guardian_group_replies: boolean;
  attachments_enabled: boolean;
  enforce_communication_hours: boolean;
  communication_start: string;
  communication_end: string;
}
interface Category { workflow: { revision: number; message_edit_minutes: number; message_attachment_mb: number }; domain: Policy }
interface MessagePage {
  results: { id: string; body: string; transport: string; transport_state: string }[];
  has_more: boolean;
  next_cursor: string | null;
  boundary_cursor: string | null;
  reached_through: boolean;
}

describe.skipIf(!enabled)("messaging integrity through ordinary authenticated HTTP", () => {
  const pool = new Pool({ connectionString: url, max: 2, application_name: "chat_integrity_http_test" });
  const owner = new TestApiSession(`http://127.0.0.1:${port}`), anonymous = new TestApiSession(`http://127.0.0.1:${port}`);
  let server: ManagedTestApi | undefined, schoolId = "", ownerId = "";
  const categoryPath = () => `/api/v1/operating-rules/${schoolId}/categories/messages`;
  const inputFor = (rules: Category) => ({
    expected_workflow_revision: rules.workflow.revision, expected_domain_revision: rules.domain.revision,
    message_edit_minutes: rules.workflow.message_edit_minutes, message_attachment_mb: rules.workflow.message_attachment_mb,
    student_teacher_direct_enabled: rules.domain.student_teacher_direct_enabled,
    guardian_teacher_direct_enabled: rules.domain.guardian_teacher_direct_enabled,
    student_group_replies: rules.domain.student_group_replies, guardian_group_replies: rules.domain.guardian_group_replies,
    attachments_enabled: rules.domain.attachments_enabled, enforce_communication_hours: false,
    communication_start: rules.domain.communication_start, communication_end: rules.domain.communication_end,
  });
  const policyRows = async () => (await pool.query<{ policies: number; workflow: number }>(`SELECT
    (SELECT count(*)::int FROM chat_policies WHERE school_id=$1) AS policies,
    (SELECT count(*)::int FROM institution_operating_rules WHERE school_id=$1) AS workflow`, [schoolId])).rows[0]!;

  beforeAll(async () => {
    const identity = (await pool.query<{ name: string; version: number }>(
      "SELECT current_database() AS name,current_setting('server_version_num')::int AS version",
    )).rows[0]!;
    expect(identity.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
    expect(identity.version).toBeGreaterThanOrEqual(170000);
    expect(identity.version).toBeLessThan(180000);
    server = await startManagedTestApi({ port, databaseUrl: url,
      cookieSecret: "chat-integrity-isolated-http-cookie-secret2026", rateLimitStore: "memory" });
    expect((await owner.request("/api/v1/auth/csrf/")).status).toBe(200);
    const registration = await owner.request("/api/v1/auth/register/", {
      email: `chat-http-${randomUUID()}@example.test`, password: `Safe-Chat-Fixture-2026!${randomUUID()}`,
    });
    expect(registration.status).toBe(201);
    const account = registration.data as { user: { id: string; active_school_id: string } };
    ownerId = account.user.id; schoolId = account.user.active_school_id;
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(schoolId).toMatch(/^[0-9a-f-]{36}$/u);
  }, 30_000);
  // Native account/workspace, command and model evidence stays together in this
  // disposable database; its owning runner retires it after final acceptance.
  afterAll(async () => { await server?.stop(); await pool.end(); });

  it("uses a normal authenticated cookie and rejects anonymous or CSRF-free writes", async () => {
    const session = await owner.request("/api/v1/auth/session/");
    expect(session.status).toBe(200);
    expect(session.data).toMatchObject({ authenticated: true, user: { id: ownerId, active_school_id: schoolId } });
    expect((await anonymous.request("/api/v1/chat/policy/")).status).toBe(401);
    expect((await owner.request(categoryPath(), {}, "POST", false)).status).toBe(403);
  });

  it("reads selected-campus defaults without creating policy or workflow configuration", async () => {
    const before = await policyRows();
    expect(before.policies).toBe(0);
    for (let read = 0; read < 2; read++) {
      const response = await owner.request("/api/v1/chat/policy/");
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ school_id: schoolId, revision: 0, can_manage: true });
      expect((await owner.request(categoryPath())).status).toBe(200);
    }
    expect(await policyRows()).toEqual(before);
  });

  it("uses the one revision-checked category writer and refuses stale, unsupported and removed writers", async () => {
    const current = await owner.request(categoryPath());
    expect(current.status).toBe(200);
    const input = inputFor(current.data as Category);
    const missingRevision: Partial<typeof input> = { ...input };
    delete missingRevision.expected_domain_revision;
    expect((await owner.request(categoryPath(), missingRevision)).status).toBe(400);
    expect((await owner.request(categoryPath(), { ...input, retention_days: 30 })).status).toBe(400);
    const saved = await owner.request(categoryPath(), { ...input, message_edit_minutes: 7 });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ workflow: { message_edit_minutes: 7 } });
    expect((await owner.request(categoryPath(), input)).status).toBe(409);
    expect((await owner.request("/api/v1/chat/policy/", { ...input, school_id: schoolId }, "PATCH")).status).toBe(404);
    expect((await owner.request("/api/v1/chat/policy/")).data).toMatchObject({ school_id: schoolId, can_manage: true });
  });

  it("pages tied history and refreshes a retained frontier through the actual controller and Matrix binding", async () => {
    const created = await owner.request("/api/v1/chat/groups/", {
      school_id: schoolId, title: "Synthetic HTTP history", group_type: "activity", member_ids: [ownerId],
    });
    expect(created.status).toBe(201);
    const conversationId = (created.data as { id: string }).id;
    const sent = await owner.request(`/api/v1/chat/conversations/${conversationId}/messages/`, {
      body: "Synthetic ordinary HTTP message", client_id: randomUUID(),
    });
    expect(sent.status).toBe(201);
    await pool.query(`INSERT INTO chat_messages(conversation_id,sender_id,body,created_at,updated_at)
      SELECT $1,$2,'Synthetic tied history '||series,'2026-10-20T10:00:00.123456Z'::timestamptz,
        '2026-10-20T10:00:00.123456Z'::timestamptz FROM generate_series(1,112) AS series`, [conversationId, ownerId]);
    const expected = (await pool.query<{ id: string }>(
      "SELECT id FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at,id", [conversationId],
    )).rows.map(row => row.id);
    const path = (cursor?: string, through?: string) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (through) query.set("through_cursor", through);
      return `/api/v1/chat/conversations/${conversationId}/messages/${query.size ? `?${query.toString()}` : ""}`;
    };
    let cursor: string | undefined, first: MessagePage | undefined, requests = 0;
    const seen: string[] = [];
    do {
      const response = await owner.request(path(cursor));
      expect(response.status).toBe(200);
      const page = response.data as MessagePage;
      first ??= page;
      expect(page.results.length).toBeLessThanOrEqual(50);
      expect(page.results.every(message => typeof message.transport_state === "string")).toBe(true);
      seen.unshift(...page.results.map(message => message.id));
      cursor = page.next_cursor ?? undefined;
      expect(page.has_more).toBe(Boolean(cursor));
      expect(++requests).toBeLessThan(5);
    } while (cursor);
    expect(requests).toBe(3);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);
    expect(first?.boundary_cursor).toBeTruthy();
    const refreshed = await owner.request(path(undefined, first.boundary_cursor ?? undefined));
    expect(refreshed.status).toBe(200);
    const window = refreshed.data as MessagePage;
    expect(window.reached_through).toBe(true);
    expect(window.results.map(message => message.id)).toEqual(first.results.map(message => message.id));
    expect(window.boundary_cursor).toBe(first.boundary_cursor);
  });
});
