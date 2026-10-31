import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";
import { DatabaseService } from "../src/database/database.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { TestApiSession, startManagedTestApi, type ManagedTestApi } from "./http-api.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// This suite leaves immutable ledger records behind by design. It must only
// run in a disposable database, never a school's staging/production database.
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;
suite("school operations against disposable PostgreSQL", () => {
  const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let server: ManagedTestApi | undefined;
  let school: string;
  let adminId: string;
  let studentId: string;
  let termId: string;
  let classId: string;
  let subjectId: string;
  let invoiceId: string;
  let inviteToken: string;
  const suffix = randomUUID();
  const email = `admin.${suffix}@example.test`;
  const studentEmail = `learner.${suffix}@example.test`;
  const password = "Str0ng!RiverPebbles2026";
  const session = new TestApiSession("http://127.0.0.1:8023/api/v1/");

  async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", csrf = true) {
    return session.request(path, body, method, csrf);
  }
  const schoolRequest = (path: string, body?: unknown, method?: string) => request(`schools/${school}/${path}/`, body, method);
  beforeAll(async () => {
    const account = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'School','Operator','admin') RETURNING id", [`operator.${suffix}`, email, await hashPassword(password)]);
    adminId = account.rows[0].id;
    const created = await pool.query("INSERT INTO schools(name,code) VALUES('Isolated Operations School',$1) RETURNING id", [suffix.slice(0, 20)]);
    school = created.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')", [adminId, school]);
    const identityDb = new DatabaseService();
    try { await linkFixtureStaffIdentity(identityDb, { school_id: school, user_id: adminId, owner_user_id: adminId }); }
    finally { await identityDb.destroy(); }
    server = await startManagedTestApi({ port:8023, databaseUrl, cookieSecret:"operations-test-cookie-secret-at-least-32", rateLimitStore:"memory" });
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: email, password })).status).toBe(200);
  });
  afterAll(async () => { try { await server?.stop(); } finally { await pool.end(); } });

  it("enforces CSRF and school boundaries", async () => {
    expect((await request(`schools/${school}/catalog/subjects/`, { code: "X", name: "X", short_name: "X" }, "POST", false)).status).toBe(403);
    expect((await request(`schools/${randomUUID()}/administration/`)).status).toBe(403);
    expect((await schoolRequest("administration")).status).toBe(200);
    expect((await request("auth/active-school/", { school_id: randomUUID() })).status).toBe(403);
    expect((await request("auth/active-school/", { school_id: school })).status).toBe(200);
  });
  it("creates catalogs and an enrolled student, rejects cross-school enrollment", async () => {
    const term = await schoolRequest("catalog/terms", { name: "Term 1", academic_year: "2030-31", starts_on: "2030-04-01", ends_on: "2031-03-31" });
    expect(term.status).toBe(201); termId = term.data.id;
    const section = await schoolRequest("catalog/classes", { grade: "5", section: "A", academic_year: "2030-31" });
    expect(section.status).toBe(201); classId = section.data.id;
    const subject = await schoolRequest("catalog/subjects", { code: "ENG", name: "English", short_name: "Eng" });
    expect(subject.status).toBe(201); subjectId = subject.data.id;
    const input = { email: studentEmail, first_name: "Mira", last_name: "Sen", admission_number: "S1", class_section_id: classId, term_id: termId, roll_number: 1 };
    expect((await schoolRequest("students", { ...input, class_section_id: randomUUID() })).status).toBe(400);
    const student = await schoolRequest("students", input); expect(student.status).toBe(201); studentId = student.data.id;
    expect((await schoolRequest("students", input)).status).toBe(409);
    expect((await schoolRequest(`students/${studentId}`, { first_name: "Mira", last_name: "Sen", admission_number: "S1", date_of_birth: "2020-02-30" }, "PATCH")).status).toBe(400);
    expect((await schoolRequest(`students/${studentId}`, { first_name: "Mira", last_name: "Sen", admission_number: "S1", date_of_birth: "2020-02-20" }, "PATCH")).status).toBe(200);
    const peopleEvents = await pool.query("SELECT payload FROM event_outbox WHERE school_id=$1 AND event_type='people.updated' AND aggregate_id=$2 ORDER BY sequence", [school, studentId]);
    expect(peopleEvents.rows.map((row) => row.payload.action)).toEqual(["student_created", "student_updated"]);
    const guardianEmail = `guardian.${suffix}@example.test`;
    const retired = await schoolRequest("guardians", {
      email: guardianEmail, first_name: "Rhea", last_name: "Sen", student_id: studentId,
      phone: "+91 9000000000", relationship: "mother", is_primary: true, can_authorize_leave: true,
    });
    expect(retired.status).toBe(404);
    expect((await pool.query("SELECT id FROM guardian_relationships WHERE student_id=$1", [studentId])).rows).toEqual([]);
    const person = await schoolRequest("people/participants", { first_name: "Rhea", last_name: "Sen",
      contact_email: guardianEmail, contact_phone: "+91 9000000000", idempotency_key: randomUUID() });
    expect(person.status).toBe(201);
    const link = { school_id: school, student_id: studentId, person: { id: person.data.id, expected_revision: 1 },
      relationship: "mother", is_primary: true, idempotency_key: randomUUID() };
    const guardian = await request("people/guardian-links", link);
    expect(guardian.status).toBe(200);
    expect(guardian.data).toMatchObject({ person_id: person.data.id, student_id: studentId });
    expect((await request("people/guardian-links", link)).data).toEqual(guardian.data);
    expect((await pool.query(`SELECT relationship.can_authorize_leave,profile.person_id,parent.user_id
      FROM guardian_relationships relationship JOIN guardian_school_profiles profile
        ON profile.school_id=relationship.school_id AND profile.guardian_id=relationship.guardian_id
      JOIN parents parent ON parent.id=profile.guardian_id WHERE relationship.id=$1`, [guardian.data.id])).rows)
      .toEqual([{ can_authorize_leave: false, person_id: person.data.id, user_id: null }]);
    expect((await pool.query("SELECT id FROM users WHERE email=$1", [guardianEmail])).rows).toEqual([]);
    expect((await pool.query("SELECT payload FROM event_outbox WHERE school_id=$1 AND event_type='people.updated' AND aggregate_id=$2", [school, guardian.data.id])).rows)
      .toEqual([{ payload: { action: "guardian_contact_linked", person_id: person.data.id, student_id: studentId,
        refresh: ["people", "people.participants"] } }]);
    expect((await pool.query(`SELECT command.state,outcome.status FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      WHERE command.school_id=$1 AND command.command_type='people.guardian.attach' AND command.correlation_id=$2`, [school, link.idempotency_key])).rows)
      .toEqual([{ state: "accepted", status: "accepted" }]);
  });
  it("protects linked catalogue edits with impact review, revision conflicts, audit context and an outbox event", async () => {
    const overview = await schoolRequest("administration");
    expect(overview.status).toBe(200);
    const section = overview.data.classes.find((item: { id: string }) => item.id === classId);
    expect(section).toMatchObject({ revision: 1, enrollment_count: 1 });
    const changed = { academic_year: section.academic_year, grade: section.grade, section: section.section, board: "CBSE", room_number: "205" };
    expect((await schoolRequest(`catalog/classes/${classId}`, changed, "PATCH")).status).toBe(400);
    expect((await schoolRequest(`catalog/classes/${classId}`, { ...changed, expected_revision: 1 }, "PATCH")).status).toBe(400);
    const saved = await schoolRequest(`catalog/classes/${classId}`, { ...changed, expected_revision: 1, confirmed: true, change_reason: "Reviewed room allocation" }, "PATCH");
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ room_number: "205", revision: 2, enrollment_count: 1 });
    expect((await schoolRequest(`catalog/classes/${classId}`, { ...changed, room_number: "206", expected_revision: 1, confirmed: true, change_reason: "Stale room allocation" }, "PATCH")).status).toBe(409);

    const audit = await pool.query("SELECT target_id,metadata FROM school_operations_audit WHERE school_id=$1 AND action='classes.updated' ORDER BY created_at DESC LIMIT 1", [school]);
    expect(audit.rows[0]).toMatchObject({ target_id: classId, metadata: { catalog_kind: "classes", revision: 2, reason: "Reviewed room allocation" } });
    const event = await pool.query("SELECT event_type,aggregate_id,payload FROM event_outbox WHERE school_id=$1 AND aggregate_id=$2 ORDER BY created_at DESC LIMIT 1", [school, classId]);
    expect(event.rows[0]).toMatchObject({ event_type: "administration.updated", aggregate_id: classId, payload: { catalog_kind: "classes", revision: 2 } });

    const subject = overview.data.subjects.find((item: { id: string }) => item.id === subjectId);
    const subjectSaved = await schoolRequest(`catalog/subjects/${subjectId}`, {
      code: subject.code,
      name: subject.name,
      short_name: subject.short_name,
      color: "#7C3AED",
      icon: "languages",
      expected_revision: subject.revision,
    }, "PATCH");
    expect(subjectSaved.status).toBe(200);
    expect(subjectSaved.data).toMatchObject({ color: "#7C3AED", icon: "languages", revision: 2 });
  });
  it("validates and atomically imports CSV, with duplicate protection", async () => {
    const header = "email,first_name,last_name,admission_number,class_section_id,term_id,roll_number";
    const csv = `${header}\nsecond.${suffix}@example.test,Ravi,Sen,S2,${classId},${termId},2`;
    const preview = await schoolRequest("student-import", { csv }); expect(preview.status).toBe(201); expect(preview.data).toMatchObject({ count: 1, confirmed: false });
    expect((await schoolRequest("administration")).data.students).toHaveLength(1);
    expect((await schoolRequest("student-import", { csv, confirm: true })).status).toBe(201);
    expect((await schoolRequest("student-import", { csv, confirm: true })).status).toBe(409);
    expect((await schoolRequest("administration")).data.students).toHaveLength(2);
    expect(Number((await pool.query("SELECT count(*) AS count FROM event_outbox WHERE school_id=$1 AND event_type='people.updated' AND aggregate_type='people_import' AND payload->>'action'='students_imported'", [school])).rows[0].count)).toBe(1);
  });
  it("posts immutable invoices and idempotent partial payments", async () => {
    const invoice = await schoolRequest("fees/invoices", { student_id: studentId, reference: "F1", description: "Term tuition", amount_paise: 10000, due_on: "2030-04-15" });
    expect(invoice.status).toBe(201); invoiceId = invoice.data.id;
    const payment = { amount_paise: 6000, method: "cash", reference: "R1", idempotency_key: randomUUID() };
    const [first, retry] = await Promise.all([schoolRequest(`fees/invoices/${invoiceId}/payments`, payment), schoolRequest(`fees/invoices/${invoiceId}/payments`, payment)]);
    expect(first.status).toBe(201); expect(retry.data.id).toBe(first.data.id);
    expect((await schoolRequest(`fees/invoices/${invoiceId}/payments`, { ...payment, amount_paise: 100 })).status).toBe(409);
    expect((await schoolRequest(`fees/invoices/${invoiceId}/payments`, { ...payment, reference: "R2", idempotency_key: randomUUID() })).status).toBe(400);
    const fees = await schoolRequest("fees"); expect(fees.data.invoices[0].balance_paise).toBe(4000); expect(fees.data.payments).toHaveLength(1);
    const events = await pool.query("SELECT event_type,aggregate_type,aggregate_id,payload FROM event_outbox WHERE school_id=$1 AND (aggregate_id=$2 OR aggregate_id=$3) ORDER BY sequence", [school, invoiceId, first.data.id]);
    expect(events.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "fees.updated", aggregate_type: "fee_invoice", aggregate_id: invoiceId, payload: expect.objectContaining({ student_id: studentId, action: "invoice_posted" }) }),
      expect.objectContaining({ event_type: "fees.updated", aggregate_type: "fee_payment", aggregate_id: first.data.id, payload: expect.objectContaining({ student_id: studentId, invoice_id: invoiceId, action: "payment_recorded" }) }),
    ]));
    await expect(pool.query("UPDATE fee_invoices SET amount_paise=1 WHERE id=$1", [invoiceId])).rejects.toThrow("cannot be updated or deleted");
  });
  it("preserves the last administrator and previews promotion without writes", async () => {
    const overview = await schoolRequest("administration");
    const admin = overview.data.members.find((item: { user_id: string }) => item.user_id === adminId);
    expect((await schoolRequest(`members/${admin.id}`, { is_active: false }, "PATCH")).status).toBe(409);
    const learnerMembership = (await pool.query("SELECT membership.id,membership.user_id FROM school_memberships membership JOIN students student ON student.user_id=membership.user_id WHERE membership.school_id=$1 AND student.id=$2 AND membership.role='student'", [school, studentId])).rows[0];
    expect((await schoolRequest(`members/${learnerMembership.id}`, { is_active: false }, "PATCH")).status).toBe(200);
    const revokedSignal = (await pool.query("SELECT payload,audience_user_ids,event_user_is_authorized(school_id,event_type,payload,$2) AS deliverable FROM event_outbox WHERE school_id=$1 AND event_type='staff.access.updated' AND aggregate_id=$3 ORDER BY sequence DESC LIMIT 1", [school, learnerMembership.user_id, learnerMembership.id])).rows[0];
    expect(revokedSignal).toMatchObject({ payload: { action: "membership_deactivated", affected_user_id: learnerMembership.user_id }, deliverable: true });
    expect(revokedSignal.audience_user_ids).toEqual(expect.arrayContaining([adminId, learnerMembership.user_id]));
    expect((await schoolRequest(`members/${learnerMembership.id}`, { is_active: true }, "PATCH")).status).toBe(200);
    const target = await schoolRequest("catalog/terms", { name: "Term 1", academic_year: "2031-32", starts_on: "2031-04-01", ends_on: "2032-03-31" });
    const section = await schoolRequest("catalog/classes", { grade: "6", section: "A", academic_year: "2031-32" });
    const body = { source_term_id: termId, target_term_id: target.data.id, mappings: [{ from_class_id: classId, to_class_id: section.data.id }] };
    expect((await schoolRequest("rollover", body)).data).toMatchObject({ count: 2, confirmed: false });
    expect((await schoolRequest("administration")).data.enrollments).toHaveLength(2);
    expect((await schoolRequest("rollover", { ...body, confirm: true })).data.confirmed).toBe(true);
    expect((await schoolRequest("administration")).data.enrollments).toHaveLength(4);
    expect(Number((await pool.query("SELECT count(*) AS count FROM event_outbox WHERE school_id=$1 AND event_type='people.updated' AND aggregate_id=$2 AND payload->>'action'='term_rollover_completed'", [school, target.data.id])).rows[0].count)).toBe(1);
    expect((await schoolRequest("rollover", { ...body, confirm: true })).status).toBe(409);
  });
  it("delivers a single-use invitation without storing its raw token", async () => {
    const invitation = await schoolRequest("invitations", { email: studentEmail, role: "student" });
    expect(invitation.status).toBe(201); inviteToken = invitation.data.token;
    expect(inviteToken).toMatch(/^\d{6}$/);
    const stored = await pool.query("SELECT token_hash FROM school_invitations WHERE id=$1", [invitation.data.id]);
    expect(stored.rows[0].token_hash).not.toBe(inviteToken);
    const payload = { token: inviteToken, email: studentEmail, first_name: "Mira", last_name: "Sen", password };
    expect((await request("invitations/accept/", { ...payload, email: "wrong@example.test" })).status).toBe(400);
    expect((await request("invitations/accept/", payload)).status).toBe(200);
    expect((await pool.query("SELECT email_verified_at FROM users WHERE email=$1", [studentEmail])).rows[0].email_verified_at).not.toBeNull();
    const events = await pool.query("SELECT event_type,payload FROM event_outbox WHERE school_id=$1 AND aggregate_id=$2 ORDER BY sequence", [school, invitation.data.id]);
    expect(events.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "administration.updated", payload: expect.objectContaining({ action: "invitation_created" }) }),
      expect.objectContaining({ event_type: "administration.updated", payload: expect.objectContaining({ action: "invitation_accepted" }) }),
    ]));
    expect((await request("invitations/accept/", payload)).status).toBe(400);
  });
  it("limits the student to their own fees and denies administration", async () => {
    session.clear(); await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: studentEmail, password })).status).toBe(200);
    expect((await schoolRequest("administration")).status).toBe(403);
    expect((await schoolRequest("fees")).status).toBe(403);
    const fees = await request(`schools/${school}/fees/?student_id=${studentId}`);
    expect(fees.status).toBe(200); expect(fees.data.invoices).toHaveLength(1);
    const other = await pool.query("SELECT id FROM students WHERE school_id=$1 AND id<>$2 LIMIT 1", [school, studentId]);
    expect((await request(`schools/${school}/fees/?student_id=${other.rows[0].id}`)).status).toBe(403);
    expect((await schoolRequest(`fees/invoices/${invoiceId}/payments`, { amount_paise: 100, method: "cash", reference: "fraud", idempotency_key: randomUUID() })).status).toBe(403);
    const sessions = await request("auth/sessions/"); expect(sessions.data.results[0].current).toBe(true); expect(sessions.data.results[0].token_hash).toBeUndefined();
    expect((await request("auth/sessions/revoke-others/", {})).status).toBe(200);
  });
  it("includes accountless students in administration and invoice selection", async () => {
    const person = await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Accountless','Learner') RETURNING id", [school]);
    const student = await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,$3) RETURNING id", [school, person.rows[0].id, `NOLOGIN-${suffix.slice(0, 8)}`]);
    session.clear(); await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: email, password })).status).toBe(200);
    const overview = await schoolRequest("administration");
    expect(overview.status).toBe(200);
    expect(overview.data.students).toContainEqual(expect.objectContaining({ id: student.rows[0].id, first_name: "Accountless" }));
    const eligible = await schoolRequest("fees/students");
    expect(eligible.status).toBe(200);
    expect(eligible.data.results).toContainEqual(expect.objectContaining({ id: student.rows[0].id, first_name: "Accountless" }));
    const enrollment = await schoolRequest("enrollments", { student_id: student.rows[0].id, class_section_id: classId, term_id: termId, roll_number: 3 });
    expect(enrollment.status).toBe(201);
    expect((await pool.query("SELECT payload FROM event_outbox WHERE school_id=$1 AND event_type='people.updated' AND aggregate_id=$2", [school, enrollment.data.id])).rows[0].payload)
      .toMatchObject({ action: "student_enrolled", student_id: student.rows[0].id, class_section_id: classId, term_id: termId });
  });
});
