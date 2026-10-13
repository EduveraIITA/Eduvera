import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { NoticesService } from "../src/notices/notices.service.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
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
const createdStaffUsers: string[] = [];
const createdStaffProfiles: string[] = [];

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
  notices = new NoticesService(db, events); requests = new RequestsService(db);
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
  if (createdStaffProfiles.length) {
    await pool.query("DELETE FROM staff_responsibility_assignments WHERE staff_profile_id=ANY($1::uuid[])", [createdStaffProfiles]);
    await pool.query("DELETE FROM staff_profiles WHERE id=ANY($1::uuid[])", [createdStaffProfiles]);
  }
  if (createdStaffUsers.length) {
    await pool.query("DELETE FROM school_memberships WHERE user_id=ANY($1::uuid[])", [createdStaffUsers]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [createdStaffUsers]);
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
    const managerRow = (await notices.list(admin.authUser, { portal: "principal", school_id: schoolId })).results
      .find((row) => row.id === draft.id);
    expect(managerRow).toMatchObject({ recipient_count: published.recipient_count, response_count: 0,
      unopened_count: published.recipient_count, pending_response_count: published.recipient_count,
      delivery_exception_count: 0 });
    const initialList = await notices.list(parent.authUser, { portal: "parent", student_id: studentId });
    expect(initialList.results.find((row) => row.id === draft.id)).toMatchObject({
      attention_reasons: ["unread", "response_required"],
      last_seen_notice_revision: 0,
    });
    expect(initialList.attention).toMatchObject({ unread: expect.any(Number), action_required: expect.any(Number) });
    const linkedNotification = (await pool.query(`SELECT id,read_at FROM notifications
      WHERE recipient_id=$1 AND metadata->>'notice_recipient_id'=$2`, [parent.authUser.id, recipient.id])).rows[0];
    expect(linkedNotification?.read_at).toBeNull();
    const sibling = (await pool.query(`SELECT recipient.id,recipient.student_id FROM school_notice_recipients recipient
      JOIN parents parent ON parent.id=recipient.guardian_id
      WHERE recipient.notice_id=$1 AND parent.user_id=$2 AND recipient.student_id<>$3 LIMIT 1`,
    [draft.id, parent.authUser.id, studentId])).rows[0];
    expect(sibling).toBeTruthy();

    const opened = await notices.open(parent, draft.id, { student_id: studentId });
    expect(opened).toMatchObject({ last_seen_notice_revision: published.revision });
    const openedAgain = await notices.open(parent, draft.id, { student_id: studentId });
    expect(openedAgain.revision).toBe(opened.revision);
    const afterOpen = await notices.list(parent.authUser, { portal: "parent", student_id: studentId });
    expect(afterOpen.results.find((row) => row.id === draft.id)?.attention_reasons).toEqual(["response_required"]);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1", [linkedNotification.id])).rows[0]?.read_at).toBeTruthy();
    expect((await pool.query("SELECT last_seen_notice_revision FROM school_notice_recipients WHERE id=$1", [sibling.id])).rows[0]?.last_seen_notice_revision).toBe(0);
    expect((await pool.query(`SELECT read_at FROM notifications
      WHERE recipient_id=$1 AND metadata->>'notice_recipient_id'=$2`, [parent.authUser.id, sibling.id])).rows[0]?.read_at).toBeNull();
    expect(Number((await pool.query(`SELECT count(*) AS count FROM school_notice_audits
      WHERE notice_id=$1 AND recipient_id=$2 AND action='opened'`, [draft.id, recipient.id])).rows[0]?.count)).toBe(1);
    const openedEvent = (await pool.query(`SELECT payload FROM event_outbox
      WHERE aggregate_type='school_notice' AND aggregate_id=$1 AND payload->>'action'='opened'`, [draft.id])).rows[0];
    expect(openedEvent?.payload).toMatchObject({ recipient_id: recipient.id, notice_revision: published.revision });
    const replayAuthorization = (await pool.query(`SELECT
      event_user_is_authorized($1,'notice.updated',$2::jsonb,$3) AS parent_allowed,
      event_user_is_authorized($1,'notice.updated',$2::jsonb,$4) AS teacher_allowed,
      event_user_is_authorized($1,'notice.updated',$2::jsonb,$5) AS admin_allowed`,
    [schoolId, JSON.stringify(openedEvent.payload), parent.authUser.id, teacher.authUser.id, admin.authUser.id])).rows[0];
    expect(replayAuthorization).toMatchObject({ parent_allowed: true, teacher_allowed: false, admin_allowed: true });
    expect((await requests.inbox(parent.authUser, { portal: "parent", student_id: studentId })).items)
      .toContainEqual(expect.objectContaining({ kind: "notice_response", source_id: draft.id, category: "communication" }));
    const response = { expected_revision: opened.revision, response_value: "Yes", student_id: studentId, idempotency_key: randomUUID() };
    await notices.respond(parent, draft.id, response);
    expect((await notices.respond(parent, draft.id, response)).response_value).toBe("Yes");
    expect((await notices.list(parent.authUser, { portal: "parent", student_id: studentId })).results
      .find((row) => row.id === draft.id)?.attention_reasons).toEqual([]);
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

  it("revokes authored-notice management everywhere when the class communication assignment ends", async () => {
    const suffix = randomUUID();
    const staffUser = (await pool.query<AuthUser>(`INSERT INTO users(
      username,email,password_hash,first_name,last_name,role
    ) VALUES($1,$2,'unused','Notice','Author','staff') RETURNING *`,
    [`notice-author-${suffix}`, `notice-author-${suffix}@example.test`])).rows[0]!;
    createdStaffUsers.push(staffUser.id);
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role,is_active) VALUES($1,$2,'staff',true)",
      [schoolId, staffUser.id]);
    const staffProfile = (await pool.query<{ id: string }>(`INSERT INTO staff_profiles(
      school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,
      joined_on,status,created_by,updated_by
    ) VALUES($1,$2,$3,'Notice','Author',$4,'teaching','Teacher','full_time',current_date,'active',$5,$5)
    RETURNING id`, [schoolId, staffUser.id, `NOTICE-${suffix.slice(0, 8)}`, staffUser.email, admin.authUser.id])).rows[0]!;
    createdStaffProfiles.push(staffProfile.id);
    const assignment = (await pool.query<{ id: string }>(`INSERT INTO staff_responsibility_assignments(
      school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by
    ) SELECT $1,type.id,$2,$3,current_date,'active',$4
      FROM staff_responsibility_types type
      WHERE type.school_id=$1 AND type.code='class_teacher'
      RETURNING id`, [schoolId, staffProfile.id, classId, admin.authUser.id])).rows[0]!;
    const revokedTeacher: AuthenticatedRequest = {
      authUser: { ...staffUser, active_school_id: schoolId },
      requestId: randomUUID(),
      ip: "127.0.0.1",
    } as AuthenticatedRequest;
    const audience = { kind: "class_guardians", class_section_id: classId };
    const draft = await notices.create(revokedTeacher, content("information", audience));
    created.push(draft.id);
    const publishedDraft = await notices.create(revokedTeacher, content("acknowledgement", audience));
    created.push(publishedDraft.id);
    const published = await notices.publish(revokedTeacher, publishedDraft.id, {
      expected_revision: publishedDraft.revision,
      idempotency_key: randomUUID(),
    });
    await pool.query("UPDATE school_notices SET due_at=now()-interval '1 minute' WHERE id=$1", [published.id]);
    const recipient = (await pool.query<{ id: string }>(
      "SELECT id FROM school_notice_recipients WHERE notice_id=$1 ORDER BY id LIMIT 1",
      [published.id],
    )).rows[0]!;
    const event = (await pool.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event_outbox
      WHERE aggregate_type='school_notice' AND aggregate_id=$1 AND payload->>'action'='published'`,
    [published.id])).rows[0]!;

    expect((await pool.query(`SELECT
      notice_actor_is_current_manager($1,$2,$3,'messages.view') AS can_view,
      notice_actor_is_current_manager($1,$2,$3,'messages.send') AS can_send`,
    [schoolId, published.id, staffUser.id])).rows[0]).toEqual({ can_view: true, can_send: true });
    expect((await notices.list(revokedTeacher.authUser, { portal: "teacher" })).results)
      .toContainEqual(expect.objectContaining({ id: published.id, can_manage: true }));
    expect((await notices.attentionItems(revokedTeacher.authUser, { portal: "teacher" })).items)
      .toContainEqual(expect.objectContaining({ source_id: published.id, attention_reasons: ["response_overdue"] }));
    expect(await notices.detail(revokedTeacher.authUser, published.id, { portal: "teacher" }))
      .toMatchObject({ id: published.id, can_manage: true });
    expect((await pool.query(
      "SELECT event_user_is_authorized($1,'notice.updated',$2::jsonb,$3) AS allowed",
      [schoolId, JSON.stringify(event.payload), staffUser.id],
    )).rows[0]?.allowed).toBe(true);

    await pool.query(`UPDATE staff_responsibility_assignments
      SET status='revoked',revoked_by=$2,revoked_at=now(),revocation_reason='Class ownership transferred.'
      WHERE id=$1`, [assignment.id, admin.authUser.id]);
    expect((await pool.query(`SELECT
      staff_has_class_permission($1,$2,'messages.view',$3) AS can_view,
      staff_has_class_permission($1,$2,'messages.send',$3) AS can_send`,
    [schoolId, staffUser.id, classId])).rows[0]).toEqual({ can_view: false, can_send: false });
    expect((await notices.list(revokedTeacher.authUser, { portal: "teacher" })).results)
      .not.toContainEqual(expect.objectContaining({ id: published.id }));
    expect((await notices.attentionItems(revokedTeacher.authUser, { portal: "teacher" })).items)
      .not.toContainEqual(expect.objectContaining({ source_id: published.id }));
    await expect(notices.detail(revokedTeacher.authUser, published.id, { portal: "teacher" }))
      .rejects.toThrow("Notice not found");
    await expect(notices.update(revokedTeacher, draft.id, {
      title: "Stale author update",
      body: "The revoked author must not be able to change this draft.",
      response_mode: "information",
      response_options: [],
      priority: "normal",
      due_at: null,
      audiences: [audience],
      expected_revision: draft.revision,
      idempotency_key: randomUUID(),
    })).rejects.toThrow("Notice not found");
    await expect(notices.publish(revokedTeacher, draft.id, {
      expected_revision: draft.revision,
      idempotency_key: randomUUID(),
    })).rejects.toThrow("Notice not found");
    await expect(notices.cancel(revokedTeacher, published.id, {
      expected_revision: published.revision,
      reason: "This stale author must not cancel the notice.",
      idempotency_key: randomUUID(),
    })).rejects.toThrow("Notice not found");
    await expect(notices.recordDelivery(revokedTeacher, published.id, {
      recipient_id: recipient.id,
      channel: "phone",
      status: "delivered",
      note: "Stale author attempt.",
      provider_reference: "",
      attempted_at: new Date().toISOString(),
      idempotency_key: randomUUID(),
    })).rejects.toThrow("Notice not found");
    expect((await pool.query(
      "SELECT event_user_is_authorized($1,'notice.updated',$2::jsonb,$3) AS allowed",
      [schoolId, JSON.stringify(event.payload), staffUser.id],
    )).rows[0]?.allowed).toBe(false);

    expect(await notices.detail(admin.authUser, published.id, { portal: "principal" }))
      .toMatchObject({ id: published.id, can_manage: true });
    expect(await notices.detail(parent.authUser, published.id, { portal: "parent", student_id: studentId }))
      .toMatchObject({ id: published.id, can_manage: false });
    expect((await pool.query(
      "SELECT event_user_is_authorized($1,'notice.updated',$2::jsonb,$3) AS allowed",
      [schoolId, JSON.stringify(event.payload), parent.authUser.id],
    )).rows[0]?.allowed).toBe(true);
  });

  it("records non-app delivery and assisted responses with actor and observed time", async () => {
    const draft = await notices.create(admin, content("acknowledgement", { kind: "school_guardians" })); created.push(draft.id);
    await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    const recipient = (await pool.query("SELECT * FROM school_notice_recipients WHERE notice_id=$1 AND recipient_role='guardian' LIMIT 1", [draft.id])).rows[0];
    if (!recipient) throw new Error("The notice fixture needs at least one guardian recipient.");
    await notices.recordDelivery(admin, draft.id, { recipient_id: recipient.id, channel: "phone", status: "delivered",
      note: "Reached guardian", provider_reference: "", attempted_at: new Date().toISOString(), idempotency_key: randomUUID() });
    await notices.assistedResponse(admin, draft.id, { recipient_id: recipient.id, expected_revision: recipient.revision,
      response_note: "Guardian acknowledged by phone.", channel: "phone", observed_at: new Date().toISOString(), idempotency_key: randomUUID() });
    const stored = (await pool.query(`SELECT response_value,response_channel,response_recorded_by,opened_at,last_seen_notice_revision
      FROM school_notice_recipients WHERE id=$1`, [recipient.id])).rows[0];
    expect(stored).toMatchObject({ response_value: "acknowledged", response_channel: "phone",
      response_recorded_by: admin.authUser.id, opened_at: null, last_seen_notice_revision: 0 });
    const events = (await pool.query(`SELECT idempotency_key FROM event_outbox
      WHERE aggregate_type='school_notice' AND aggregate_id=$1
        AND payload->>'action' IN ('delivery_recorded','responded')`, [draft.id])).rows;
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.idempotency_key)).size).toBe(2);
  });

  it("keeps expired responses out of Requests while exposing the overdue notice exception", async () => {
    const draft = await notices.create(admin, content("acknowledgement", { kind: "school_guardians" })); created.push(draft.id);
    await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    await pool.query("UPDATE school_notices SET due_at=now()-interval '1 minute' WHERE id=$1", [draft.id]);
    expect((await requests.inbox(parent.authUser, { portal: "parent", student_id: studentId })).items)
      .not.toContainEqual(expect.objectContaining({ kind: "notice_response", source_id: draft.id }));
    const row = (await notices.list(parent.authUser, { portal: "parent", student_id: studentId })).results
      .find((candidate) => candidate.id === draft.id);
    expect(row?.attention_reasons).toEqual(["unread", "response_overdue"]);
  });

  it("raises a new revision-aware cancellation signal and reconciles only the exact bell", async () => {
    const draft = await notices.create(admin, content("information", { kind: "school_guardians" })); created.push(draft.id);
    const published = await notices.publish(admin, draft.id, { expected_revision: draft.revision, idempotency_key: randomUUID() });
    const firstOpen = await notices.open(parent, draft.id, { student_id: studentId });
    expect(firstOpen.last_seen_notice_revision).toBe(published.revision);
    const cancelled = await notices.cancel(admin, draft.id, { expected_revision: published.revision,
      reason: "The instruction has been withdrawn.", idempotency_key: randomUUID() });
    const row = (await notices.list(parent.authUser, { portal: "parent", student_id: studentId })).results
      .find((candidate) => candidate.id === draft.id);
    expect(row).toMatchObject({ status: "cancelled", attention_reasons: ["unread"] });
    const recipientId = row?.recipient_id;
    const cancellationBell = (await pool.query(`SELECT id,read_at,metadata FROM notifications
      WHERE recipient_id=$1 AND metadata->>'notice_recipient_id'=$2 AND metadata->>'notice_status'='cancelled'`,
    [parent.authUser.id, recipientId])).rows[0];
    expect(cancellationBell).toMatchObject({ read_at: null, metadata: expect.objectContaining({ notice_revision: cancelled.revision }) });
    const reopened = await notices.open(parent, draft.id, { student_id: studentId });
    expect(reopened.last_seen_notice_revision).toBe(cancelled.revision);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1", [cancellationBell.id])).rows[0]?.read_at).toBeTruthy();
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
