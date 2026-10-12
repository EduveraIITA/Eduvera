import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { NoticesService } from "../src/notices/notices.service.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;
const pool = new Pool({ connectionString: isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : undefined, max: 2 });
let db: DatabaseService;
let notices: NoticesService;
let requests: RequestsService;
let admin: AuthenticatedRequest;
let teacher: AuthenticatedRequest;
let parent: AuthenticatedRequest;
let schoolId: string;
let classId: string;
let studentId: string;
const created: string[] = [];

async function account(username: string): Promise<AuthenticatedRequest> {
  const user = (await pool.query<AuthUser>("SELECT * FROM users WHERE username=$1", [username])).rows[0]!;
  return { authUser: { ...user, active_school_id: schoolId }, requestId: randomUUID(), ip: "127.0.0.1" } as AuthenticatedRequest;
}

function content(responseMode: "information" | "acknowledgement" | "choice", audience: Record<string, unknown>) {
  return {
    school_id: schoolId,
    title: `Notice test ${randomUUID().slice(0, 8)}`,
    body: "A focused operational update for the isolated notice workflow test.",
    response_mode: responseMode,
    response_options: responseMode === "choice" ? ["Yes", "No"] : [],
    priority: "normal",
    due_at: responseMode === "information" ? null : new Date(Date.now() + 2 * 86400000).toISOString(),
    audiences: [audience],
    idempotency_key: randomUUID(),
  };
}

beforeAll(async () => {
  if (!isolated) return;
  const scope = (await pool.query<{ school_id: string; class_section_id: string; student_id: string }>(`
    SELECT student.school_id,enrollment.class_section_id,student.id AS student_id
    FROM users teacher
    JOIN timetable_slots slot ON slot.teacher_user_id=teacher.id
    JOIN enrollments enrollment ON enrollment.class_section_id=slot.class_section_id AND enrollment.term_id=slot.term_id AND enrollment.is_active
    JOIN students student ON student.id=enrollment.student_id
    JOIN guardian_relationships relationship ON relationship.student_id=student.id
    JOIN parents parent ON parent.id=relationship.guardian_id
    JOIN users guardian ON guardian.id=parent.user_id AND guardian.username='pooja.parent'
    WHERE teacher.username='kavita.staff'
      AND staff_has_class_permission(student.school_id,teacher.id,'messages.send',enrollment.class_section_id)
    ORDER BY enrollment.class_section_id LIMIT 1
  `)).rows[0];
  if (!scope) throw new Error("The isolated test database needs the standard Kavita/Pooja class fixture.");
  schoolId = scope.school_id; classId = scope.class_section_id; studentId = scope.student_id;
  db = new DatabaseService(); const events = new SchoolEventService(db);
  notices = new NoticesService(db, events); requests = new RequestsService(db, new SchoolService(db, events));
  admin = await account("meera.principal"); teacher = await account("kavita.staff"); parent = await account("pooja.parent");
});

afterAll(async () => {
  if (!isolated) { await pool.end(); return; }
  if (created.length) {
    await pool.query("DELETE FROM notifications WHERE metadata->>'notice_id'=ANY($1::text[])", [created]);
    await pool.query("DELETE FROM audit_events WHERE metadata->>'notice_id'=ANY($1::text[])", [created]);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_type='school_notice' AND aggregate_id=ANY($1::uuid[])", [created]);
    await pool.query("DELETE FROM school_notices WHERE id=ANY($1::uuid[])", [created]);
  }
  await db?.destroy(); await pool.end();
});

suite("School notices and response tracking", () => {
  it("publishes an immutable family audience and keeps delivery separate from response", async () => {
    const input = content("choice", { kind: "school_guardians" });
    const draft = await notices.create(admin, input); created.push(draft.id);
    expect(await notices.create(admin, input)).toEqual(draft);
    const published = await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    expect(published.recipient_count).toBeGreaterThan(0);
    const recipient = (await pool.query(`SELECT recipient.* FROM school_notice_recipients recipient
      JOIN parents parent ON parent.id=recipient.guardian_id WHERE recipient.notice_id=$1 AND parent.user_id=$2 AND recipient.student_id=$3`,
    [draft.id, parent.authUser.id, studentId])).rows[0];
    expect(recipient.responded_at).toBeNull();
    expect((await pool.query("SELECT status FROM school_notice_delivery_attempts WHERE recipient_id=$1 AND channel='app'", [recipient.id])).rows[0]?.status).toBe("delivered");
    expect((await requests.inbox(parent.authUser, { portal: "parent", student_id: studentId })).items)
      .toContainEqual(expect.objectContaining({ kind: "notice_response", source_id: draft.id, category: "communication" }));
    const response = { expected_revision: recipient.revision, response_value: "Yes", student_id: studentId, idempotency_key: randomUUID() };
    await notices.respond(parent, draft.id, response);
    expect((await notices.respond(parent, draft.id, response)).response_value).toBe("Yes");
    expect((await requests.inbox(parent.authUser, { portal: "parent", student_id: studentId })).items)
      .not.toContainEqual(expect.objectContaining({ kind: "notice_response", source_id: draft.id }));
  });

  it("allows assigned staff to publish only to their class guardian scope", async () => {
    await expect(notices.create(teacher, content("information", { kind: "school_guardians" }))).rejects.toThrow("assigned class");
    const draft = await notices.create(teacher, content("acknowledgement", { kind: "class_guardians", class_section_id: classId }));
    created.push(draft.id);
    const published = await notices.publish(teacher, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    expect(published.recipient_count).toBeGreaterThan(0);
    const detail = await notices.detail(teacher.authUser, draft.id, { portal: "teacher" });
    expect(detail.can_manage).toBe(true);
    if (!detail.can_manage) throw new Error("Expected the author management view.");
    expect(detail.metrics).toMatchObject({ recipients: published.recipient_count, responded: 0 });
  });

  it("records non-app delivery and assisted responses with actor and observed time", async () => {
    const draft = await notices.create(admin, content("acknowledgement", { kind: "school_guardians" })); created.push(draft.id);
    await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    const recipient = (await pool.query("SELECT * FROM school_notice_recipients WHERE notice_id=$1 AND user_id IS NULL LIMIT 1", [draft.id])).rows[0];
    if (!recipient) throw new Error("The standard isolated fixture needs at least one guardian without an app account.");
    await notices.recordDelivery(admin, draft.id, { recipient_id: recipient.id, channel: "phone", status: "delivered",
      note: "Reached guardian", provider_reference: "", attempted_at: new Date().toISOString(), idempotency_key: randomUUID() });
    await notices.assistedResponse(admin, draft.id, { recipient_id: recipient.id, expected_revision: recipient.revision,
      response_note: "Guardian acknowledged by phone.", channel: "phone", observed_at: new Date().toISOString(), idempotency_key: randomUUID() });
    const stored = (await pool.query("SELECT response_value,response_channel,response_recorded_by FROM school_notice_recipients WHERE id=$1", [recipient.id])).rows[0];
    expect(stored).toMatchObject({ response_value: "acknowledged", response_channel: "phone", response_recorded_by: admin.authUser.id });
  });

  it("does not leak message content into realtime envelopes and rejects stale writes", async () => {
    const draft = await notices.create(admin, content("information", { kind: "school_staff" })); created.push(draft.id);
    await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    const event = (await pool.query("SELECT payload FROM event_outbox WHERE aggregate_type='school_notice' AND aggregate_id=$1", [draft.id])).rows[0];
    expect(JSON.stringify(event)).not.toContain("focused operational update");
    await expect(notices.cancel(admin, draft.id, { expected_revision: draft.revision, reason: "Superseded update", idempotency_key: randomUUID() }))
      .rejects.toThrow("changed");
  });
});
