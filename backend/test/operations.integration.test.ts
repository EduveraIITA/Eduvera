import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";

// This suite leaves immutable ledger records behind by design. It must only
// run in a disposable database, never a school's staging/production database.
const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;
suite("school operations against disposable PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const base = "http://127.0.0.1:8023";
  let server: ChildProcess;
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
  const cookies = new Map<string, string>();

  async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", csrf = true) {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (csrf && cookies.get("csrftoken")) headers["X-CSRFToken"] = cookies.get("csrftoken")!;
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0]!; const at = pair.indexOf("="); cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
    const data: any = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  }
  const schoolRequest = (path: string, body?: unknown, method?: string) => request(`schools/${school}/${path}/`, body, method);
  beforeAll(async () => {
    const account = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'School','Operator','admin') RETURNING id", [`operator.${suffix}`, email, await hashPassword(password)]);
    adminId = account.rows[0].id;
    const created = await pool.query("INSERT INTO schools(name,code) VALUES('Isolated Operations School',$1) RETURNING id", [suffix.slice(0, 20)]);
    school = created.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')", [adminId, school]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: "8023", HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "operations-test-cookie-secret-at-least-32", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    expect(ready).toBe(true);
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: email, password })).status).toBe(200);
  });
  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

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
    await expect(pool.query("UPDATE fee_invoices SET amount_paise=1 WHERE id=$1", [invoiceId])).rejects.toThrow("cannot be updated or deleted");
  });
  it("preserves the last administrator and previews promotion without writes", async () => {
    const overview = await schoolRequest("administration");
    const admin = overview.data.members.find((item: { user_id: string }) => item.user_id === adminId);
    expect((await schoolRequest(`members/${admin.id}`, { is_active: false }, "PATCH")).status).toBe(409);
    const target = await schoolRequest("catalog/terms", { name: "Term 1", academic_year: "2031-32", starts_on: "2031-04-01", ends_on: "2032-03-31" });
    const section = await schoolRequest("catalog/classes", { grade: "6", section: "A", academic_year: "2031-32" });
    const body = { source_term_id: termId, target_term_id: target.data.id, mappings: [{ from_class_id: classId, to_class_id: section.data.id }] };
    expect((await schoolRequest("rollover", body)).data).toMatchObject({ count: 2, confirmed: false });
    expect((await schoolRequest("administration")).data.enrollments).toHaveLength(2);
    expect((await schoolRequest("rollover", { ...body, confirm: true })).data.confirmed).toBe(true);
    expect((await schoolRequest("administration")).data.enrollments).toHaveLength(4);
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
    expect((await request("invitations/accept/", payload)).status).toBe(400);
  });
  it("limits the student to their own fees and denies administration", async () => {
    cookies.clear(); await request("auth/csrf/");
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
    cookies.clear(); await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: email, password })).status).toBe(200);
    const overview = await schoolRequest("administration");
    expect(overview.status).toBe(200);
    expect(overview.data.students).toContainEqual(expect.objectContaining({ id: student.rows[0].id, first_name: "Accountless" }));
    const eligible = await schoolRequest("fees/students");
    expect(eligible.status).toBe(200);
    expect(eligible.data.results).toContainEqual(expect.objectContaining({ id: student.rows[0].id, first_name: "Accountless" }));
  });
});
