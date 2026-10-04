import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

suite("two-lane self-service onboarding against PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const base = "http://127.0.0.1:8067/api/v1/";
  const suffix = randomUUID();
  const password = "Str0ng!WorkspaceRiver2026";
  const cookies: Record<string, Map<string, string>> = { applicant: new Map(), company: new Map() };
  let server: ChildProcess;
  let applicantId: string;

  async function request(actor: keyof typeof cookies, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const jar = cookies[actor]!;
    const headers: Record<string, string> = { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (jar.get("csrftoken")) headers["X-CSRFToken"] = jar.get("csrftoken")!;
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const split = pair.indexOf("=");
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data: data as any };
  }

  beforeAll(async () => {
    const digest = await hashPassword(password);
    applicantId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role,email_verified_at) VALUES($1,$2,$3,'Anita','Founder','admin',now()) RETURNING id",
      [`founder.${suffix}`, `founder.${suffix}@example.test`, digest],
    )).rows[0].id;
    const companyId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Company','Reviewer','admin') RETURNING id",
      [`reviewer.${suffix}`, `reviewer.${suffix}@example.test`, digest],
    )).rows[0].id;
    await pool.query("INSERT INTO company_operators(user_id) VALUES($1)", [companyId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "8067", COOKIE_SECRET: "self-service-onboarding-test-secret-32", NODE_ENV: "test", RATE_LIMIT_STORE: "postgres", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { if ((await fetch("http://127.0.0.1:8067/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    for (const actor of ["applicant", "company"] as const) await request(actor, "auth/csrf/");
    expect((await request("applicant", "auth/login/", { identifier: `founder.${suffix}`, password })).status).toBe(200);
    expect((await request("company", "auth/login/", { identifier: `reviewer.${suffix}`, password })).status).toBe(200);
  }, 30_000);

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("provisions coaching immediately and formal institutions only after review", async () => {
    const coachingCode = `coach-${suffix.slice(0, 8)}`;
    const coaching = await request("applicant", "onboarding/coaching-workspaces/", { name: "Anita Tutorials", code: coachingCode, timezone: "Asia/Kolkata", delivery_mode: "hybrid", minors_enrolled: true });
    expect(coaching.status).toBe(201);
    const coachingRow = (await pool.query("SELECT institution_kind,onboarding_model,verification_status FROM schools WHERE id=$1", [coaching.data.id])).rows[0];
    expect(coachingRow).toEqual({ institution_kind: "coaching", onboarding_model: "self_service_coaching", verification_status: "not_required" });
    expect((await pool.query("SELECT role FROM school_memberships WHERE school_id=$1 AND user_id=$2", [coaching.data.id, applicantId])).rows[0].role).toBe("admin");
    expect((await request("applicant", "onboarding/coaching-workspaces/", { name: "Second Workspace", code: `second-${suffix.slice(0, 8)}`, timezone: "Asia/Kolkata", delivery_mode: "online", minors_enrolled: false })).status).toBe(409);

    const applicationBody = { institution_name: "Lotus Learning School", requested_code: `lotus-${suffix.slice(0, 8)}`, institution_kind: "school", timezone: "Asia/Kolkata", state_code: "KA", district: "Bengaluru Urban", website: "https://example.test", applicant_role_title: "Founder Principal", regulator_type: "udise", regulator_reference: `UDISE-${suffix.slice(0, 10)}`, declaration_accepted: true };
    const submitted = await request("applicant", "onboarding/institution-applications/", applicationBody);
    expect(submitted.status).toBe(201);
    expect((await pool.query("SELECT provisioned_school_id,status FROM institution_onboarding_applications WHERE id=$1", [submitted.data.id])).rows[0]).toEqual({ provisioned_school_id: null, status: "submitted" });
    expect((await request("applicant", "company/workspace/")).status).toBe(403);
    expect((await request("company", "company/workspace/")).data.applications.some((application: { id: string }) => application.id === submitted.data.id)).toBe(true);

    const needsInfo = await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "request_information", note: "Confirm the current affiliation reference." });
    expect(needsInfo.data.status).toBe("needs_information");
    const resubmitted = await request("applicant", "onboarding/institution-applications/", { ...applicationBody, application_id: submitted.data.id, regulator_reference: `AFFILIATION-${suffix.slice(0, 10)}` });
    expect(resubmitted.data.status).toBe("submitted");

    const approved = await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "approve", note: "Registration verified.", institution_code: applicationBody.requested_code });
    expect(approved.data.status).toBe("approved");
    const formal = (await pool.query("SELECT institution_kind,onboarding_model,verification_status,created_by_user_id FROM schools WHERE id=$1", [approved.data.school.id])).rows[0];
    expect(formal).toEqual({ institution_kind: "school", onboarding_model: "company_verified", verification_status: "approved", created_by_user_id: applicantId });
    expect((await pool.query("SELECT role FROM school_memberships WHERE school_id=$1 AND user_id=$2", [approved.data.school.id, applicantId])).rows[0].role).toBe("admin");
    const profile = await request("applicant", "auth/me/");
    expect(profile.data.memberships.some((membership: { school_id: string; role: string }) => membership.school_id === approved.data.school.id && membership.role === "admin")).toBe(true);
    expect((await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "approve", note: "again" })).status).toBe(409);
  }, 30_000);
});
