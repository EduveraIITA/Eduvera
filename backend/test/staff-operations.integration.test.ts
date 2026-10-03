import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;

suite("staff onboarding and leave against disposable PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const port = 8031;
  const base = `http://127.0.0.1:${port}`;
  const suffix = randomUUID();
  const password = "Str0ng!RiverPebbles2026";
  const adminEmail = `staff.admin.${suffix}@example.test`;
  const teacherEmail = `teacher.${suffix}@example.test`;
  const replacementEmail = `replacement.${suffix}@example.test`;
  const adminCookies = new Map<string, string>();
  const teacherCookies = new Map<string, string>();
  const replacementCookies = new Map<string, string>();
  let server: ChildProcess;
  let schoolId: string;
  let teacherId: string;
  let profileId: string;
  let replacementProfileId: string;
  let policyId: string;
  let requestId: string;

  async function request(cookies: Map<string, string>, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookies.get("csrftoken")) headers["X-CSRFToken"] = cookies.get("csrftoken")!;
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!; const at = pair.indexOf("="); cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, data: await response.json() as any };
  }
  const staffPath = (path: string) => `schools/${schoolId}/staff/${path}/`;

  beforeAll(async () => {
    const admin = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Meera','Kapoor','admin') RETURNING id", [`admin.${suffix}`, adminEmail, await hashPassword(password)]);
    const teacher = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kavita','Mehta','staff') RETURNING id", [`teacher.${suffix}`, teacherEmail, await hashPassword(password)]);
    const replacement = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Rohan','Sen','staff') RETURNING id", [`replacement.${suffix}`, replacementEmail, await hashPassword(password)]);
    teacherId = teacher.rows[0].id;
    const school = await pool.query("INSERT INTO schools(name,code) VALUES('Staff Test School',$1) RETURNING id", [`staff-${suffix.slice(0, 12)}`]);
    schoolId = school.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$4,'admin'),($2,$4,'staff'),($3,$4,'staff')", [admin.rows[0].id, teacherId, replacement.rows[0].id, schoolId]);
    const term = await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,is_active) VALUES($1,'2030-31','Term 1','2030-04-01','2031-03-31',true) RETURNING id", [schoolId]);
    const section = await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2030-31','7','A') RETURNING id", [schoolId]);
    const subject = await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'MAT','Mathematics','Maths') RETURNING id", [schoolId]);
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,teacher_user_id) VALUES($1,$2,$3,1,1,'09:00','09:45',$4)", [section.rows[0].id, term.rows[0].id, subject.rows[0].id, teacherId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "staff-test-cookie-secret-at-least-32-characters", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    expect(ready).toBe(true);
    await request(adminCookies, "auth/csrf/");
    expect((await request(adminCookies, "auth/login/", { identifier: adminEmail, password })).status).toBe(200);
  });

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("onboards an existing teacher without creating a second account", async () => {
    const created = await request(adminCookies, staffPath("profiles"), { first_name: "Kavita", last_name: "Mehta", email: teacherEmail, phone: "+91 9000000000", staff_code: "T-001", staff_kind: "teaching", designation: "Mathematics teacher", department: "Secondary", employment_type: "full_time", joined_on: "2030-04-01" });
    expect(created.status).toBe(201);
    expect(created.data.invitation).toBeNull();
    expect(created.data.profile.user_id).toBe(teacherId);
    profileId = created.data.profile.id;
    const replacement = await request(adminCookies, staffPath("profiles"), { first_name: "Rohan", last_name: "Sen", email: replacementEmail, phone: "+91 9000000001", staff_code: "T-002", staff_kind: "teaching", designation: "Science teacher", department: "Secondary", employment_type: "full_time", joined_on: "2030-04-01" });
    expect(replacement.status).toBe(201);
    replacementProfileId = replacement.data.profile.id;
    await pool.query("UPDATE staff_profiles SET status='active' WHERE id IN ($1,$2)", [profileId, replacementProfileId]);
    const workspace = await request(adminCookies, staffPath("workspace"));
    expect(workspace.data.profiles).toContainEqual(expect.objectContaining({ id: profileId, onboarding_total: 5, onboarding_complete: 1 }));
  });

  it("configures school leave policy and enforces role boundaries", async () => {
    const policy = await request(adminCookies, staffPath("leave-policies"), { academic_year: "2030-31", code: "CASUAL", name: "Casual leave", annual_allowance: 12, carry_forward_limit: 0, requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true });
    expect(policy.status).toBe(201); policyId = policy.data.id;
    await request(teacherCookies, "auth/csrf/");
    expect((await request(teacherCookies, "auth/login/", { identifier: teacherEmail, password })).status).toBe(200);
    await request(replacementCookies, "auth/csrf/");
    expect((await request(replacementCookies, "auth/login/", { identifier: replacementEmail, password })).status).toBe(200);
    expect((await request(teacherCookies, staffPath("profiles"), { first_name: "No" })).status).toBe(403);
    const workspace = await request(teacherCookies, staffPath("workspace"));
    expect(workspace.status).toBe(200);
    expect(workspace.data).toMatchObject({ mode: "staff", profile: { id: profileId } });
  });

  it("submits, exposes timetable impact, approves and updates the balance", async () => {
    const leave = await request(teacherCookies, staffPath("leave-requests"), { policy_id: policyId, starts_on: "2030-04-08", ends_on: "2030-04-08", portion: "full_day", reason: "Family medical appointment", handover_note: "Period 1 needs cover" });
    expect(leave.status).toBe(201); requestId = leave.data.id;
    const adminView = await request(adminCookies, staffPath("workspace"));
    expect(adminView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "submitted", affected_periods: 1 }));
    const queued = adminView.data.requests.find((item: { id: string }) => item.id === requestId);
    const approved = await request(adminCookies, staffPath(`leave-requests/${requestId}/decision`), { decision: "approved", note: "Cover arranged", expected_revision: queued.revision });
    expect(approved.status).toBe(201);
    expect(approved.data).toMatchObject({ status: "approved", affected_periods: 1 });
    const teacherView = await request(teacherCookies, staffPath("workspace"));
    expect(teacherView.data.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "approved" }));
    expect(Number(teacherView.data.balances.find((item: { policy_id: string }) => item.policy_id === policyId).used)).toBe(1);
    expect(teacherView.data.coverage_tasks).toContainEqual(expect.objectContaining({ leave_request_id: requestId, status: "open" }));
    expect((await request(teacherCookies, staffPath(`leave-requests/${requestId}/withdraw`), { expected_revision: approved.data.revision })).status).toBe(409);
  });

  it("offers scoped responsibilities and closes the leave coverage loop", async () => {
    const adminView = await request(adminCookies, staffPath("workspace"));
    const type = adminView.data.responsibility_types.find((item: { code: string }) => item.code === "school_duty");
    const assignment = await request(adminCookies, staffPath("responsibilities"), { responsibility_type_id: type.id, staff_profile_id: profileId, class_section_id: null, subject_id: null, event_id: null, scope_label: "Morning arrival gate", location: "Main gate", starts_on: "2030-04-10", ends_on: "2030-04-10", starts_at: "08:00", ends_at: "08:30", notes: "Coordinate arrival and escalate exceptions.", backup_staff_profile_id: null });
    expect(assignment.status).toBe(201);
    expect(assignment.data.status).toBe("offered");
    const teacherView = await request(teacherCookies, staffPath("workspace"));
    const offer = teacherView.data.assignments.find((item: { id: string }) => item.id === assignment.data.id);
    expect(offer).toMatchObject({ type_code: "school_duty", scope_label: "Morning arrival gate", status: "offered" });
    const accepted = await request(teacherCookies, staffPath(`responsibilities/${offer.id}/response`), { decision: "accepted", note: "Confirmed", expected_revision: offer.revision });
    expect(accepted.data.status).toBe("active");

    const task = adminView.data.coverage_tasks.find((item: { leave_request_id: string }) => item.leave_request_id === requestId);
    const offered = await request(adminCookies, staffPath(`coverage-tasks/${task.id}/assign`), { replacement_staff_profile_id: replacementProfileId, note: "Please cover period 1.", expected_revision: task.revision });
    expect(offered.data.status).toBe("offered");
    const replacementView = await request(replacementCookies, staffPath("workspace"));
    const coverOffer = replacementView.data.coverage_tasks.find((item: { id: string }) => item.id === task.id);
    expect(coverOffer).toMatchObject({ status: "offered", title: "Mathematics" });
    const coverAccepted = await request(replacementCookies, staffPath(`coverage-tasks/${task.id}/response`), { decision: "accepted", note: "I have reviewed the handover.", expected_revision: coverOffer.revision });
    expect(coverAccepted.data.status).toBe("accepted");
  });

  it("writes leave state transitions to audit and the outbox", async () => {
    const audit = await pool.query("SELECT action FROM staff_leave_request_audits WHERE request_id=$1 ORDER BY created_at", [requestId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["submitted", "approved"]);
    const outbox = await pool.query("SELECT event_type,payload FROM event_outbox WHERE aggregate_id=$1 ORDER BY created_at", [requestId]);
    expect(outbox.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["staff.leave.submitted", "staff.leave.approved"]));
    expect(outbox.rows.find((row) => row.event_type === "staff.leave.approved").payload).toMatchObject({ affected_periods: 1 });
  });
});
