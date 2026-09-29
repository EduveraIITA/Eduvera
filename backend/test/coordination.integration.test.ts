import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoordinationService } from "../src/coordination/coordination.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), max: 2 });
let db: DatabaseService;
let service: CoordinationService;
let teacher: AuthenticatedRequest;
let guardian: AuthenticatedRequest;
let student: AuthenticatedRequest;
let stranger: AuthenticatedRequest;
let record: { student_id: string; date: string; school_id: string; id: string };
const created: string[] = [];
async function account(username: string) {
  const user = (await pool.query<AuthUser>("SELECT * FROM users WHERE username=$1", [username])).rows[0]!;
  return { authUser: user, requestId: randomUUID(), ip: "127.0.0.1" } as AuthenticatedRequest;
}
const requestInput = () => ({ student_id: record.student_id, attendance_date: record.date, question: "Please clarify this recorded absence.", due_at: new Date(Date.now() + 86400000).toISOString(), idempotency_key: randomUUID() });
const create = async () => {
  const result = await service.create(teacher, requestInput());
  created.push(result.id);
  return result;
};
const response = (revision: number) => ({ context: "guardian", kind: "guardian_reply", body: "The absence was for a family appointment.", expected_revision: revision, idempotency_key: randomUUID() });
async function withdraw(id: string, revision: number) {
  return service.respond(teacher, id, { context: "staff", kind: "resolved", body: "Duplicate query reviewed and withdrawn.", outcome: "query_withdrawn", expected_revision: revision, idempotency_key: randomUUID() });
}

beforeAll(async () => {
  db = new DatabaseService();
  service = new CoordinationService(db, new SchoolEventService(db));
  teacher = await account("kavita.staff"); guardian = await account("pooja.parent"); student = await account("aarav.student");
  record = (await pool.query("SELECT a.id,a.student_id,a.date::text,s.school_id FROM attendance_records a JOIN students s ON s.id=a.student_id WHERE s.user_id=$1 AND a.status='absent' ORDER BY a.date DESC LIMIT 1", [student.authUser.id])).rows[0];
  if (!record) throw new Error("Seed an isolated test school with Aarav's attendance before running coordination tests.");
  const other = (await pool.query("SELECT u.username FROM users u JOIN parents p ON p.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM guardian_relationships g WHERE g.guardian_id=p.id AND g.student_id=$1) LIMIT 1", [record.student_id])).rows[0];
  stranger = await account(other.username);
});

afterAll(async () => {
  for (const id of created) {
    await pool.query("DELETE FROM coordination_commands WHERE followup_id=$1", [id]);
    await pool.query("DELETE FROM attendance_followup_entries WHERE followup_id=$1", [id]);
    await pool.query("DELETE FROM attendance_followups WHERE id=$1", [id]);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_type='attendance_followup' AND aggregate_id=$1", [id]);
    await pool.query("DELETE FROM audit_events WHERE target_type='attendance_followup' AND target_id=$1", [id]);
  }
  await db?.destroy(); await pool.end();
});

describe("Attendance coordination loop", () => {
  it("keeps school review separate from a guardian reply and preserves attendance", async () => {
    const before = (await pool.query("SELECT status,revision FROM attendance_records WHERE id=$1", [record.id])).rows[0];
    const item = await create();
    expect((await service.list(guardian.authUser, { context: "guardian", student_id: record.student_id })).results.some((row) => row.id === item.id)).toBe(true);
    const replied = await service.respond(guardian, item.id, response(item.revision));
    expect((await service.detail(teacher.authUser, item.id, "staff")).state).toBe("in_review");
    await service.respond(teacher, item.id, { context: "staff", kind: "resolved", body: "Guardian explanation reviewed; attendance retained.", outcome: "absence_explained", expected_revision: replied.revision, idempotency_key: randomUUID() });
    expect((await service.detail(guardian.authUser, item.id, "guardian")).state).toBe("resolved");
    expect((await pool.query("SELECT status,revision FROM attendance_records WHERE id=$1", [record.id])).rows[0]).toEqual(before);
    expect(Number((await pool.query("SELECT count(*) FROM event_outbox WHERE aggregate_id=$1 AND event_type='coordination.updated'", [item.id])).rows[0].count)).toBe(3);
  });

  it("deduplicates retries and rejects changed payloads and duplicate open cases", async () => {
    const input = requestInput();
    const item = await service.create(teacher, input); created.push(item.id);
    expect(await service.create(teacher, input)).toEqual(item);
    await expect(service.create(teacher, { ...input, question: "Different payload" })).rejects.toThrow("different details");
    await expect(service.create(teacher, requestInput())).rejects.toThrow("already exists");
    const reply = response(item.revision);
    const next = await service.respond(guardian, item.id, reply);
    expect(await service.respond(guardian, item.id, reply)).toEqual(next);
    expect((await service.detail(guardian.authUser, item.id, "guardian")).entries).toHaveLength(2);
    await withdraw(item.id, next.revision);
  });

  it("denies unrelated guardians, student accounts, and use of teacher authority in guardian context", async () => {
    const item = await create();
    await expect(service.detail(stranger.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.respond(stranger, item.id, response(item.revision))).rejects.toThrow("accessible");
    await expect(service.detail(student.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.detail(teacher.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.create(guardian, requestInput())).rejects.toThrow("accessible");
    expect((await service.list(stranger.authUser, { context: "guardian" })).results).not.toContainEqual(expect.objectContaining({ id: item.id }));
    await withdraw(item.id, item.revision);
  });

  it("attributes an assisted response to staff and records effective time separately", async () => {
    const item = await create();
    const detail = await service.detail(teacher.authUser, item.id, "staff");
    const parent = detail.guardians[0] as { id: string };
    const next = await service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: parent.id,
      observed_at: new Date().toISOString(), body: "Guardian confirmed the absence during a phone call.", expected_revision: item.revision, idempotency_key: randomUUID() });
    const entries = (await service.detail(teacher.authUser, item.id, "staff")).entries as Array<{ actor_name: string; channel: string; guardian_name: string }>;
    expect(entries[1]).toMatchObject({ actor_name: "Kavita Mehta", channel: "phone" });
    expect(entries[1]?.guardian_name).toBeTruthy();
    await withdraw(item.id, next.revision);
  });

  it("rejects stale revisions, invalid resolution, future observed time, and post-closure replies", async () => {
    const item = await create();
    const linkedGuardian = (await service.detail(teacher.authUser, item.id, "staff")).guardians[0] as { id: string };
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: linkedGuardian.id,
      observed_at: new Date(Date.now() + 3600000).toISOString(), body: "A response with an invalid future timestamp.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Response time");
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "resolved", outcome: "record_corrected", body: "Correction claimed without a record change.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Correct the attendance register first");
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "resolved", outcome: "absence_explained", body: "Explained without receiving a response.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Record a guardian response");
    const next = await service.respond(guardian, item.id, response(item.revision));
    await expect(service.respond(guardian, item.id, response(item.revision))).rejects.toThrow("has changed");
    const done = await withdraw(item.id, next.revision);
    await expect(service.respond(guardian, item.id, response(done.revision))).rejects.toThrow("already resolved");
  });

  it("rechecks revoked membership on a previously opened case", async () => {
    const item = await create();
    await pool.query("UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2 AND role='guardian'", [guardian.authUser.id, record.school_id]);
    try { await expect(service.respond(guardian, item.id, response(item.revision))).rejects.toThrow("accessible"); }
    finally { await pool.query("UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2 AND role='guardian'", [guardian.authUser.id, record.school_id]); }
    await withdraw(item.id, item.revision);
  });

  it("rejects missing attendance instead of treating it as absence", async () => {
    await expect(service.create(teacher, { ...requestInput(), attendance_date: "2000-01-01" })).rejects.toThrow("unmarked register is not absence");
  });

  it("serializes concurrent replies and keeps event envelopes free of response content", async () => {
    const item = await create();
    const results = await Promise.allSettled([
      service.respond(guardian, item.id, response(item.revision)),
      service.respond(guardian, item.id, response(item.revision)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const events = (await pool.query("SELECT payload FROM event_outbox WHERE aggregate_id=$1", [item.id])).rows;
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("family appointment");
    await withdraw(item.id, item.revision + 1);
  });

  it("enforces tenant/attendance links and guardian association in the database", async () => {
    const item = await create();
    const otherSchool = randomUUID();
    await pool.query("INSERT INTO schools(id,name,code) VALUES($1,'Coordination isolation fixture',$2)", [otherSchool, `test-${otherSchool.slice(0,8)}`]);
    try {
      await expect(pool.query("UPDATE attendance_followups SET school_id=$2 WHERE id=$1", [item.id, otherSchool])).rejects.toThrow();
      const wrongGuardian = (await pool.query("SELECT id FROM parents WHERE user_id=$1", [stranger.authUser.id])).rows[0];
      await expect(service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: wrongGuardian.id,
        observed_at: new Date().toISOString(), body: "Attempt to attach an unrelated guardian.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("linked to this student");
    } finally { await pool.query("DELETE FROM schools WHERE id=$1", [otherSchool]); }
    await withdraw(item.id, item.revision);
  });
});
