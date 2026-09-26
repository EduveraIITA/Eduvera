import { spawn, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const port = 8022;
const base = process.env.API_BASE_URL ?? `http://127.0.0.1:${port}`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
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
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // The child process may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test server did not become ready");
}

beforeAll(async () => {
  await pool.query("DELETE FROM api_rate_limit_buckets");
  if (!process.env.API_BASE_URL) {
    server = spawn(process.execPath, ["dist/main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
        PORT: String(port),
        HOST: "127.0.0.1",
        COOKIE_SECRET: "integration-test-cookie-secret-at-least-32",
        DEMO_MODE: "true",
        AI_PROVIDER: "mock",
        SPA_DIST_DIR: join(process.cwd(), "no-spa"),
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  await waitForServer();
});

beforeEach(async () => {
  // Each scenario has independent login attempts. A fast disposable database
  // otherwise makes unrelated cases collectively hit the production limit.
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
  it("reports liveness and PostgreSQL readiness", async () => {
    expect(await json(await fetch(`${base}/healthz`))).toEqual({ status: "ok", service: "omnischool-api" });
    expect(await json(await fetch(`${base}/readyz`))).toEqual({ status: "ready", database: "ok" });
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
    expect(home.ranking.students.filter((item: any) => item.is_current)).toMatchObject([{ name: "Aarav Sharma", rank: 4 }]);
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
    const notifications = await json(await browser.request("/api/v1/notifications/"));
    expect(notifications.results[0]).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), title: expect.any(String), body: expect.any(String), link: expect.any(String), created_at: expect.any(String) }));
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
      current_rank: 4,
    });
    const percentages = body.ranking.leaders.map((item: any) => item.percentage);
    expect(percentages).toHaveLength(3);
    expect(percentages[0]).toBe(100);
    expect(percentages).toEqual([...percentages].sort((left: number, right: number) => right - left));
    expect(body.ranking.leaders[0].name).toMatch(/\.$/);
    expect(body.ranking.leaders[0]).toMatchObject({ avatar_url: "/assets/ananya-iyer.png", streak: expect.any(Number) });
    expect(body.ranking.students).toHaveLength(25);
    expect(body.ranking.students[0]).toMatchObject({ rank: 1, percentage: 100, is_current: false });
    expect(body.ranking.students[0].name).toMatch(/\.$/);
    expect(body.ranking.students.filter((item: any) => item.is_current)).toMatchObject([{ name: "Aarav Sharma", rank: 4 }]);
    expect(body.ranking.current_streak).toEqual(expect.any(Number));
  });

  it("gives teachers an assigned register and persists an authorized bulk submission", async () => {
    await pool.query("DELETE FROM api_rate_limit_buckets");
    const browser = new BrowserSession();
    expect((await browser.login("kavita.staff")).status).toBe(200);
    // Teachers have no classes at weekends, so ask for the most recent school day (Mon-Fri, IST).
    const schoolDay = (() => {
      const now = new Date(Date.now() + 5.5 * 3_600_000); // Asia/Kolkata, the seed's calendar
      const back = [1, 2, 3, 4, 5, 6, 0].indexOf(now.getUTCDay()) >= 5 ? now.getUTCDay() === 6 ? 1 : 2 : 0;
      now.setUTCDate(now.getUTCDate() - back);
      return now.toISOString().slice(0, 10);
    })();
    const home = await json(await browser.request(`/api/v1/screens/teacher/home/?date=${schoolDay}`));
    expect(home.teacher).toMatchObject({ name: "Kavita Mehta", role: "staff" });
    expect(home.classes.length).toBeGreaterThan(0);
    const classId = home.classes[0].class_section_id;
    const register = await json(await browser.request(`/api/v1/screens/teacher/attendance/?class_section_id=${classId}&date=${home.date}`));
    expect(register.roster).toHaveLength(25);
    const response = await browser.request("/api/v1/teacher/attendance/bulk/", { method: "POST", body: JSON.stringify({ class_section_id: classId, date: home.date, records: register.roster.map((student: any) => ({ student_id: student.id, status: student.status ?? "present", remarks: student.remarks ?? "" })) }) }, true);
    expect(response.status).toBe(200);
    expect((await json(response)).roster.every((student: any) => student.status)).toBe(true);
  });

  it("restricts principal oversight and timetable control to school administrators", async () => {
    await pool.query("DELETE FROM api_rate_limit_buckets");
    const student = new BrowserSession(); await student.login("aarav.student");
    expect((await student.request("/api/v1/screens/principal/home/")).status).toBe(403);
    const principal = new BrowserSession(); expect((await principal.login("meera.principal")).status).toBe(200);
    const overview = await json(await principal.request("/api/v1/screens/principal/home/"));
    expect(overview.summary).toMatchObject({ students: 200, classes_total: 8 });
    expect(overview.classes).toHaveLength(8);
    const timetable = await json(await principal.request("/api/v1/screens/principal/timetable/"));
    expect(timetable.slots.length).toBeGreaterThan(250);
    expect(timetable.classes).toHaveLength(8);
    expect(timetable.teachers).toHaveLength(17);
    const draft = { class_section_id: timetable.classes[0].id, subject_id: timetable.subjects[0].id, teacher_user_id: timetable.teachers[0].id, weekday: 6, period_number: 9, starts_at: "14:00", ends_at: "14:45", slot_type: "class", title: "", room: "Seminar 2", teacher_designation: "Subject Teacher" };
    const createdResponse = await principal.request("/api/v1/principal/timetable/slots/", { method: "POST", body: JSON.stringify(draft) }, true);
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    const updatedResponse = await principal.request(`/api/v1/principal/timetable/slots/${created.id}/`, { method: "PATCH", body: JSON.stringify({ ...draft, starts_at: "14:50", ends_at: "15:35" }) }, true);
    expect(updatedResponse.status).toBe(200);
    expect((await json(updatedResponse)).starts_at).toContain("14:50");
    const deletedResponse = await principal.request(`/api/v1/principal/timetable/slots/${created.id}/`, { method: "DELETE" }, true);
    expect(deletedResponse.status).toBe(200);
    expect(await json(deletedResponse)).toEqual({ deleted: true, id: created.id });
  });
});
