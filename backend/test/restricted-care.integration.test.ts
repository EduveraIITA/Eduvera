import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { hashPassword } from "../src/auth/password.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const suite = isolated ? describe : describe.skip;

suite("restricted care workflow against disposable PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const port = 8035;
  const base = `http://127.0.0.1:${port}`;
  const suffix = randomUUID();
  const password = "Str0ng!RestrictedRiver2026";
  const primaryEmail = `care.primary.${suffix}@example.test`;
  const alternateEmail = `care.alternate.${suffix}@example.test`;
  const reporterEmail = `care.reporter.${suffix}@example.test`;
  const unrelatedAdminEmail = `care.unrelated-admin.${suffix}@example.test`;
  const primaryCookies = new Map<string, string>();
  const alternateCookies = new Map<string, string>();
  const reporterCookies = new Map<string, string>();
  const unrelatedAdminCookies = new Map<string, string>();
  let server: ChildProcess;
  let schoolId: string;
  let primaryId: string;
  let alternateId: string;
  let reporterId: string;
  let caseId: string;

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
  const path = (suffixPath: string) => `schools/${schoolId}/restricted-care/${suffixPath}/`;
  const login = async (cookies: Map<string, string>, identifier: string) => {
    await request(cookies, "auth/csrf/");
    expect((await request(cookies, "auth/login/", { identifier, password })).status).toBe(200);
  };

  beforeAll(async () => {
    const primary = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Meera','Kapoor','admin') RETURNING id", [`care-primary.${suffix}`, primaryEmail, await hashPassword(password)]);
    const alternate = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Anita','Rao','admin') RETURNING id", [`care-alternate.${suffix}`, alternateEmail, await hashPassword(password)]);
    const reporter = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Kavita','Mehta','staff') RETURNING id", [`care-reporter.${suffix}`, reporterEmail, await hashPassword(password)]);
    const unrelatedAdmin = await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Rohan','Sen','admin') RETURNING id", [`care-unrelated-admin.${suffix}`, unrelatedAdminEmail, await hashPassword(password)]);
    primaryId = primary.rows[0].id; alternateId = alternate.rows[0].id; reporterId = reporter.rows[0].id;
    const school = await pool.query("INSERT INTO schools(name,code) VALUES('Restricted Care Test Institution',$1) RETURNING id", [`care-${suffix.slice(0, 12)}`]);
    schoolId = school.rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'admin'),($3,$5,'staff'),($4,$5,'admin')", [primaryId, alternateId, reporterId, unrelatedAdmin.rows[0].id, schoolId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", COOKIE_SECRET: "restricted-care-test-cookie-secret-over-32-chars", RESTRICTED_CASE_ENCRYPTION_KEY: "restricted-care-test-encryption-key-separate-2026", RATE_LIMIT_STORE: "memory", LOG_LEVEL: "error" }, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    expect(ready).toBe(true);
    await login(primaryCookies, primaryEmail); await login(alternateCookies, alternateEmail); await login(reporterCookies, reporterEmail); await login(unrelatedAdminCookies, unrelatedAdminEmail);
  });

  afterAll(async () => { server?.kill("SIGTERM"); await pool.end(); });

  it("uses explicit primary and alternate role assignments", async () => {
    const workspace = await request(primaryCookies, path("workspace"));
    expect(workspace.status).toBe(200);
    expect(workspace.data.routes.primary).toBe(1);
    expect(workspace.data.routes.alternate).toBe(0);
    const assigned = await request(primaryCookies, path("team-assignments"), { user_id: alternateId, role_kind: "deputy_lead", route_kind: "alternate", valid_from: "2026-10-04", valid_until: null });
    expect(assigned.status).toBe(201);
    expect((await request(reporterCookies, path("team-assignments"), { user_id: reporterId, role_kind: "counsellor", route_kind: "primary", valid_from: "2026-10-04", valid_until: null })).status).toBe(403);
  });

  it("opens an encrypted intake and grants only the reporter receipt plus assigned owner access", async () => {
    const opened = await request(reporterCookies, path("cases"), {
      student_id: null, intake_route: "primary", source_kind: "child_disclosure", urgency: "urgent",
      concern_category: "sexual_safety", safety_state: "actions_underway", ordinary_handler_involved: false,
      observed_at: null, details: "The child used exact words that require immediate protected follow-up and the staff member recorded them without interpretation.",
    });
    expect(opened.status, JSON.stringify(opened.data)).toBe(201); caseId = opened.data.id;
    expect(opened.data.receipt).toMatch(/not proof/i);
    const reporterDetail = await request(reporterCookies, path(`cases/${caseId}`));
    expect(reporterDetail.data.access).toMatchObject({ assignment_role: "reporter", access_level: "intake_only" });
    expect(reporterDetail.data.entries).toHaveLength(1);
    expect((await request(reporterCookies, path(`cases/${caseId}/actions`), { action: "add_entry", expected_revision: 1, entry_type: "case_note", note: "Reporter should not see or add handling notes." })).status).toBe(403);
    const primaryDetail = await request(primaryCookies, path(`cases/${caseId}`));
    expect(primaryDetail.data.access).toMatchObject({ assignment_role: "owner", access_level: "full" });
    expect(primaryDetail.data.entries[0].note).toMatch(/exact words/);
    expect((await request(alternateCookies, path(`cases/${caseId}`))).status).toBe(404);
    const raw = await pool.query("SELECT encode(ciphertext,'escape') AS ciphertext FROM restricted_care_case_entries WHERE case_id=$1", [caseId]);
    expect(raw.rows[0].ciphertext).not.toContain("exact words");
  });

  it("records the reporting decision and external authority evidence before closure", async () => {
    const assessed = await request(primaryCookies, path(`cases/${caseId}/actions`), { action: "reporting_decision", expected_revision: 1, reporting_state: "reporting_required", rationale: "The designated owner assessed the information against the institution procedure and recorded that immediate external reporting is required." });
    expect(assessed.status).toBe(201); expect(assessed.data.reporting_state).toBe("reporting_required");
    expect((await request(primaryCookies, path(`cases/${caseId}/actions`), { action: "transition", expected_revision: assessed.data.revision, status: "closed", note: "This should not close while required reporting remains outstanding." })).status).toBe(409);
    const reported = await request(primaryCookies, path(`cases/${caseId}/actions`), { action: "external_report", expected_revision: assessed.data.revision, authority_type: "local_police", reported_at: "2026-10-04T10:30:00+05:30", reference: "Protected police diary reference 2026-104" });
    expect(reported.data.reporting_state).toBe("reported");
    const closed = await request(primaryCookies, path(`cases/${caseId}/actions`), { action: "transition", expected_revision: reported.data.revision, status: "closed", note: "Immediate safety actions and the external report were verified; follow-up ownership was documented before controlled closure." });
    expect(closed.data.status).toBe("closed");
    const detail = await request(primaryCookies, path(`cases/${caseId}`));
    expect(detail.data.external_reports[0]).toMatchObject({ authority_type: "local_police", reference: "Protected police diary reference 2026-104" });
  });

  it("routes around an involved ordinary handler without granting all administrators case access", async () => {
    const opened = await request(primaryCookies, path("cases"), {
      student_id: null, intake_route: "alternate", source_kind: "staff_observation", urgency: "priority",
      concern_category: "physical_safety", safety_state: "unknown", ordinary_handler_involved: true,
      observed_at: null, details: "The ordinary handling route may involve a person named in the concern, so this intake uses the separately configured alternate recipient.",
    });
    expect(opened.status, JSON.stringify(opened.data)).toBe(201); expect(opened.data.owner_user_id).toBe(alternateId);
    expect((await request(alternateCookies, path(`cases/${opened.data.id}`))).status).toBe(200);
    expect((await request(primaryCookies, path(`cases/${opened.data.id}`))).status).toBe(200);
    expect((await request(unrelatedAdminCookies, path(`cases/${opened.data.id}`))).status).toBe(404);
    expect((await request(unrelatedAdminCookies, path("workspace"))).data.cases.map((item: { id: string }) => item.id)).not.toContain(opened.data.id);
    const unrelatedWorkspace = await request(reporterCookies, path("workspace"));
    expect(unrelatedWorkspace.data.cases.map((item: { id: string }) => item.id)).not.toContain(opened.data.id);
  });

  it("keeps outbox and audits free of protected narrative and external references", async () => {
    const audits = await pool.query("SELECT action,metadata FROM restricted_care_audits WHERE case_id=$1 ORDER BY created_at", [caseId]);
    expect(audits.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["restricted_care.case.opened", "restricted_care.reporting.assessed", "restricted_care.external_report.recorded", "restricted_care.case.closed"]));
    const outbox = await pool.query("SELECT payload,notification_payload FROM event_outbox WHERE aggregate_id=$1", [caseId]);
    const serialized = JSON.stringify(outbox.rows);
    expect(serialized).not.toContain("exact words");
    expect(serialized).not.toContain("police diary reference");
  });
});
