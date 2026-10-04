import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;

suite("institution governance and policy lifecycle against disposable PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const port = 8034;
  const base = `http://127.0.0.1:${port}`;
  const suffix = randomUUID();
  const password = "Str0ng!GovernanceRiver2026";
  const adminEmail = `governance.admin.${suffix}@example.test`;
  const staffEmail = `governance.staff.${suffix}@example.test`;
  const adminCookies = new Map<string, string>();
  const staffCookies = new Map<string, string>();
  let server: ChildProcess;
  let schoolId: string;
  let versionId: string;

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
  const path = (suffixPath: string) => `schools/${schoolId}/governance/${suffixPath}/`;

  beforeAll(async () => {
    const admin = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Meera','Kapoor','admin') RETURNING id", [`gov-admin.${suffix}`, adminEmail, await hashPassword(password)]);
    const staff = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kavita','Mehta','staff') RETURNING id", [`gov-staff.${suffix}`, staffEmail, await hashPassword(password)]);
    const school = await pool.query("INSERT INTO schools(name,code) VALUES('Governance Test Institution',$1) RETURNING id", [`gov-${suffix.slice(0, 12)}`]);
    schoolId = school.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$3,'admin'),($2,$3,'staff')", [admin.rows[0].id, staff.rows[0].id, schoolId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "governance-test-cookie-secret-over-32-characters", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    expect(ready).toBe(true);
    await request(adminCookies, "auth/csrf/");
    expect((await request(adminCookies, "auth/login/", { identifier: adminEmail, password })).status).toBe(200);
    await request(staffCookies, "auth/csrf/");
    expect((await request(staffCookies, "auth/login/", { identifier: staffEmail, password })).status).toBe(200);
  });

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("seeds a configurable institution profile and policy register", async () => {
    const workspace = await request(adminCookies, path("workspace"));
    expect(workspace.status).toBe(200);
    expect(workspace.data.profile).toMatchObject({ institution_kind: "school", capability_packs: ["india_school_core"], revision: 1 });
    expect(workspace.data.metrics.applicable).toBeGreaterThanOrEqual(13);
    expect(workspace.data.families).toContainEqual(expect.objectContaining({ code: "child_protection", risk_level: "high", applicable: true }));
    expect((await request(staffCookies, path("workspace"))).status).toBe(403);
  });

  it("updates profile with optimistic concurrency and audit evidence", async () => {
    const workspace = await request(adminCookies, path("workspace"));
    const input = { ...workspace.data.profile, state_code: "KA", district: "Bengaluru Urban", regulator_codes: ["CBSE"], reviewed_on: "2030-04-01", review_note: "Reviewed against institution affiliation and management records.", expected_revision: workspace.data.profile.revision };
    delete input.school_id; delete input.revision; delete input.created_at; delete input.updated_at; delete input.updated_by;
    const updated = await request(adminCookies, path("profile"), input, "PATCH");
    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({ state_code: "KA", regulator_codes: ["CBSE"], revision: 2 });
    expect((await request(adminCookies, path("profile"), input, "PATCH")).status).toBe(409);
  });

  it("drafts, submits and publishes an immutable policy with an explicit single-admin override", async () => {
    const draft = await request(adminCookies, path("policies/child_protection/draft"), {
      title: "Child protection and mandatory reporting", summary: "How our institution protects children and responds to concerns.",
      body_markdown: "All staff must use the protected reporting channel immediately. The designated safeguarding lead records external reporting evidence and restricts case access.",
      audience_roles: ["admin", "staff"], requires_acknowledgement: true, effective_on: null, review_due_on: "2027-03-31", source_note: "Reviewed against POCSO reporting duties and the institution safety plan.",
    });
    expect(draft.status).toBe(201); versionId = draft.data.id;
    expect((await request(staffCookies, path("policies/child_protection/draft"), { title: "No access" })).status).toBe(403);
    const submitted = await request(adminCookies, path(`policy-versions/${versionId}/submit`), { expected_revision: draft.data.revision });
    expect(submitted.data.status).toBe("in_review");
    const published = await request(adminCookies, path(`policy-versions/${versionId}/review`), { decision: "publish", expected_revision: submitted.data.revision, note: "Reviewed scope, reporting channel and audience.", override_reason: "This test institution currently has one active administrator; independent review is not yet available." });
    expect(published.status).toBe(201);
    expect(published.data).toMatchObject({ status: "published", review_separation_met: false });
    await expect(pool.query("UPDATE institution_policy_versions SET summary='Changed after publication' WHERE id=$1", [versionId])).rejects.toThrow(/immutable/i);
  });

  it("shows only published audience policies and records idempotent acknowledgement", async () => {
    const library = await request(staffCookies, path("policies"));
    expect(library.status).toBe(200);
    expect(library.data.policies).toContainEqual(expect.objectContaining({ id: versionId, code: "child_protection", acknowledgement_id: null }));
    const first = await request(staffCookies, path(`policy-versions/${versionId}/acknowledgements`), { acknowledgement_text: "I acknowledge that policy version 1 was presented to me." });
    const replay = await request(staffCookies, path(`policy-versions/${versionId}/acknowledgements`), { acknowledgement_text: "I acknowledge that policy version 1 was presented to me." });
    expect(first.status).toBe(201); expect(replay.data.id).toBe(first.data.id);
    const refreshed = await request(staffCookies, path("policies"));
    expect(refreshed.data.policies.find((item: { id: string }) => item.id === versionId).acknowledgement_id).toBe(first.data.id);
  });

  it("writes lifecycle and acknowledgement events without exposing policy bodies", async () => {
    const audits = await pool.query("SELECT action FROM institution_governance_audits WHERE school_id=$1 ORDER BY created_at", [schoolId]);
    expect(audits.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["governance.profile.updated", "governance.policy.draft_saved", "governance.policy.submitted", "governance.policy.published", "governance.policy.acknowledged"]));
    const outbox = await pool.query("SELECT event_type,payload FROM event_outbox WHERE aggregate_id=$1 ORDER BY created_at", [versionId]);
    expect(outbox.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["governance.policy.submitted", "governance.policy.published", "governance.policy.acknowledged"]));
    expect(JSON.stringify(outbox.rows)).not.toContain("protected reporting channel");
  });
});
