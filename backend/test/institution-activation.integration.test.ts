import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string) {
  let bits = "";
  for (const character of value) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function currentTotp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const binary = ((digest[offset]! & 127) << 24) | ((digest[offset + 1]! & 255) << 16)
    | ((digest[offset + 2]! & 255) << 8) | (digest[offset + 3]! & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

suite("institution activation and account trust against PostgreSQL 17", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const base = "http://127.0.0.1:8072/api/v1/";
  const suffix = randomUUID();
  const email = `owner.${suffix}@example.test`;
  const username = `owner.${suffix}`;
  const password = "Str0ng!FirstDayRiver2026";
  const newPassword = "Str0ng!RecoveredMaple2026";
  const cookies = new Map<string, string>();
  let server: ChildProcess;
  let userId = "";
  let schoolId = "";
  let recoveryCodes: string[] = [];

  async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookies.get("csrftoken")) headers["X-CSRFToken"] = cookies.get("csrftoken")!;
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const split = pair.indexOf("=");
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data: data as any };
  }

  beforeAll(async () => {
    userId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kiran','Owner','admin') RETURNING id",
      [username, email, await hashPassword(password)],
    )).rows[0].id;
    server = spawn(process.execPath, ["dist/main.js"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "8072",
        COOKIE_SECRET: "activation-integration-cookie-secret-2026",
        NODE_ENV: "test",
        DEMO_MODE: "true",
        INVITATION_EMAIL_ENABLED: "false",
        RATE_LIMIT_STORE: "memory",
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { if ((await fetch("http://127.0.0.1:8072/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: username, password })).status).toBe(200);
  }, 30_000);

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("requires verified ownership before either onboarding lane", async () => {
    const rejected = await request("onboarding/coaching-workspaces/", {
      name: "Kiran Tutorials", code: `coach-${suffix.slice(0, 8)}`, timezone: "Asia/Kolkata", delivery_mode: "hybrid", minors_enrolled: true,
    });
    expect(rejected.status).toBe(409);
    const issued = await request("auth/email-verification/request/", {});
    expect(issued.status).toBe(201);
    expect(issued.data.development_token).toHaveLength(43);
    expect((await request("auth/email-verification/confirm/", { token: issued.data.development_token })).status).toBe(200);
    expect((await pool.query("SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id=$1", [userId])).rows[0].verified).toBe(true);
  });

  it("creates a coaching workspace and writes a real quick-start foundation", async () => {
    const created = await request("onboarding/coaching-workspaces/", {
      name: "Kiran Tutorials", code: `coach-${suffix.slice(0, 8)}`, timezone: "Asia/Kolkata", delivery_mode: "hybrid", minors_enrolled: true,
    });
    expect(created.status).toBe(201);
    schoolId = created.data.id;
    const before = await request(`schools/${schoolId}/activation/`);
    expect(before.status).toBe(200);
    expect(before.data.institution.capability_pack).toBe("coaching_core");
    expect(before.data.institution.status).toBe("draft");
    expect(before.data.checks.find((check: any) => check.key === "owner_email").complete).toBe(true);

    const quick = await request(`schools/${schoolId}/activation/quick-start/`, {
      academic_year: "2026-27", term_name: "Term 1", starts_on: "2026-04-01", ends_on: "2027-03-31",
      grade_or_program: "Foundation", section: "A",
      subjects: [{ code: "MATH", name: "Mathematics", short_name: "Maths" }],
      attendance_threshold: 80, medical_document_after_days: 2,
      contact_name: "Kiran Tutorials office", contact_phone: "+91 9000000000", contact_email: "",
      teaching_days: [1, 2, 3, 4, 5, 6], starts_at: "17:00", ends_at: "18:00",
    });
    expect(quick.status).toBe(201);
    expect(quick.data.counts).toMatchObject({ terms: 1, cohorts: 1, subjects: 1, schedule: 6 });
    expect((await pool.query("SELECT count(*)::int AS count FROM attendance_policies policy JOIN academic_terms term ON term.id=policy.term_id WHERE term.school_id=$1", [schoolId])).rows[0].count).toBe(1);
    expect((await request(`schools/${schoolId}/activation/quick-start/`, {
      academic_year: "2026-27", term_name: "Again", starts_on: "2026-04-01", ends_on: "2027-03-31",
      grade_or_program: "Again", section: "A", subjects: [{ code: "SCI", name: "Science", short_name: "Science" }],
      attendance_threshold: 80, medical_document_after_days: 2, contact_name: "Office", contact_phone: "1", contact_email: "",
      teaching_days: [1], starts_at: "17:00", ends_at: "18:00",
    })).status).toBe(409);
  });

  it("protects privileged activation with authenticator MFA and a real enrolment", async () => {
    const enrollment = await request("auth/mfa/enroll/", {});
    expect(enrollment.status).toBe(201);
    const confirmed = await request("auth/mfa/confirm/", { code: currentTotp(enrollment.data.secret) });
    expect(confirmed.status).toBe(200);
    recoveryCodes = confirmed.data.recovery_codes;
    expect(recoveryCodes).toHaveLength(8);

    const catalog = (await pool.query(
      "SELECT (SELECT id FROM academic_terms WHERE school_id=$1 LIMIT 1) term_id,(SELECT id FROM class_sections WHERE school_id=$1 LIMIT 1) class_id",
      [schoolId],
    )).rows[0];
    const personId = (await pool.query(
      "INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Aarav','Learner') RETURNING id", [schoolId],
    )).rows[0].id;
    const studentId = (await pool.query(
      "INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,$3) RETURNING id", [schoolId, personId, `ADM-${suffix.slice(0, 8)}`],
    )).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number) VALUES($1,$2,$3,1)", [studentId, catalog.class_id, catalog.term_id]);

    const reviewed = await request(`schools/${schoolId}/activation/review/`, {});
    expect(reviewed.status).toBe(200);
    expect(reviewed.data.summary.ready).toBe(true);
    expect(reviewed.data.institution.status).toBe("ready");
    const activated = await request(`schools/${schoolId}/activation/activate/`, { expected_revision: reviewed.data.institution.revision });
    expect(activated.status).toBe(200);
    expect(activated.data.institution.status).toBe("active");
    expect((await pool.query("SELECT count(*)::int AS count FROM event_outbox WHERE event_type='InstitutionActivated' AND school_id=$1", [schoolId])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT action FROM institution_activation_audits WHERE school_id=$1 ORDER BY created_at", [schoolId])).rows.map((row) => row.action)).toEqual(["quick_start_applied", "readiness_reviewed", "activated"]);
  });

  it("requires MFA on the next login and supports single-use recovery", async () => {
    expect((await request("auth/logout/", {})).status).toBe(204);
    await request("auth/csrf/");
    const challenged = await request("auth/login/", { identifier: username, password });
    expect(challenged.status).toBe(202);
    const completed = await request("auth/mfa/login/", { challenge_token: challenged.data.challenge_token, code: recoveryCodes[0] });
    expect(completed.status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM auth_mfa_recovery_codes WHERE user_id=$1 AND used_at IS NOT NULL", [userId])).rows[0].count).toBe(1);
  });

  it("resets the password, revokes sessions and preserves MFA", async () => {
    const issued = await request("auth/password-reset/request/", { email });
    expect(issued.status).toBe(202);
    expect(issued.data.development_token).toHaveLength(43);
    expect((await request("auth/password-reset/confirm/", { token: issued.data.development_token, password: newPassword })).status).toBe(200);
    expect((await request("auth/me/")).status).toBe(401);
    await request("auth/csrf/");
    expect((await request("auth/login/", { identifier: username, password })).status).toBe(401);
    const challenged = await request("auth/login/", { identifier: username, password: newPassword });
    expect(challenged.status).toBe(202);
    expect((await request("auth/mfa/login/", { challenge_token: challenged.data.challenge_token, code: recoveryCodes[1] })).status).toBe(200);
  });
});
