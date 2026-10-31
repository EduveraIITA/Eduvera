import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

suite("purpose-first progressive onboarding against PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_ISOLATED === "true"
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 2 });
  const base = "http://127.0.0.1:8067/api/v1/";
  const suffix = randomUUID();
  const password = "Str0ng!WorkspaceRiver2026";
  const cookies: Record<string, Map<string, string>> = { applicant: new Map(), company: new Map(), legacy: new Map() };
  let server: ChildProcess;
  let applicantId: string;
  let legacySchoolId: string;
  let originalCatalogue: Array<{ goal_key: string; destination: string }> = [];

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
    originalCatalogue = (await pool.query<{ goal_key: string; destination: string }>(
      "SELECT goal_key,destination FROM progressive_onboarding_goal_catalog",
    )).rows;
    // Exercise an upgraded installation retaining the historical catalogue.
    // The application must normalize its response and new resumes without a DDL
    // rewrite or changing the stored catalogue as a side effect of a read.
    await pool.query(`UPDATE progressive_onboarding_goal_catalog SET destination=CASE
      WHEN goal_key='performance' THEN '/principal/results'
      ELSE '/principal/get-started?task='||goal_key END
      WHERE goal_key IN ('attendance','gate','timetable','assignments','examinations','performance','staff','messages')`);
    const digest = await hashPassword(password);
    applicantId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role,email_verified_at) VALUES($1,$2,$3,'Anita','Founder','admin',now()) RETURNING id",
      [`founder.${suffix}`, `founder.${suffix}@example.test`, digest],
    )).rows[0].id;
    const companyId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Company','Reviewer','admin') RETURNING id",
      [`reviewer.${suffix}`, `reviewer.${suffix}@example.test`, digest],
    )).rows[0].id;
    const legacyId = (await pool.query(
      "INSERT INTO users(username,email,password_hash,first_name,last_name,role,email_verified_at) VALUES($1,$2,$3,'Existing','Admin','admin',now()) RETURNING id",
      [`existing.${suffix}`, `existing.${suffix}@example.test`, digest],
    )).rows[0].id;
    legacySchoolId = (await pool.query(
      "INSERT INTO schools(name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id) VALUES('Existing campus',$1,'Asia/Kolkata','school','company_verified','approved',$2) RETURNING id",
      [`existing-${suffix.slice(0, 8)}`, legacyId],
    )).rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')", [legacyId, legacySchoolId]);
    await pool.query("INSERT INTO company_operators(user_id) VALUES($1)", [companyId]);
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "8067", COOKIE_SECRET: "self-service-onboarding-test-secret-32", NODE_ENV: "test", RATE_LIMIT_STORE: "postgres", LOG_LEVEL: "silent" }, stdio: ["ignore", "ignore", "inherit"] });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { if ((await fetch("http://127.0.0.1:8067/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    for (const actor of ["applicant", "company", "legacy"] as const) await request(actor, "auth/csrf/");
    expect((await request("applicant", "auth/login/", { identifier: `founder.${suffix}`, password })).status).toBe(200);
    expect((await request("company", "auth/login/", { identifier: `reviewer.${suffix}`, password })).status).toBe(200);
    expect((await request("legacy", "auth/login/", { identifier: `existing.${suffix}`, password })).status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    for (const row of originalCatalogue) {
      await pool.query("UPDATE progressive_onboarding_goal_catalog SET destination=$2 WHERE goal_key=$1", [row.goal_key, row.destination]);
    }
    await pool.end();
  });

  it("provisions one neutral workspace, persists purposes and verifies that same tenant", async () => {
    const empty = await request("applicant", "onboarding/workspace/");
    expect(empty.status).toBe(200);
    expect(empty.data).toMatchObject({ status: "workspace_required", workspace: null });
    expect(empty.data.catalogue.map((goal: { key: string }) => goal.key)).toEqual(expect.arrayContaining([
      "attendance", "gate", "timetable", "assignments", "examinations", "performance", "staff", "messages", "whole_campus", "explore",
    ]));
    for (const goal of ["attendance", "gate", "timetable", "assignments", "examinations", "performance", "staff", "messages"]) {
      expect(empty.data.catalogue.find((entry: { key: string }) => entry.key === goal).destination)
        .toBe(`/more/setup/capabilities?task=${goal}`);
    }
    expect((await pool.query("SELECT destination FROM progressive_onboarding_goal_catalog WHERE goal_key='attendance'")).rows[0].destination)
      .toBe("/principal/get-started?task=attendance");

    const provisioned = await request("applicant", "onboarding/workspace/", {
      timezone: "Asia/Kolkata", goals: ["attendance", "gate"],
    });
    expect(provisioned.status, JSON.stringify(provisioned.data)).toBe(201);
    expect(provisioned.data).toMatchObject({
      status: "ready",
      active_school_id: expect.any(String),
      workspace: { id: expect.any(String), display_name: "Your campus", profile_named: false, timezone: "Asia/Kolkata" },
      goals: { selected: ["attendance", "gate"], primary: "attendance" },
      resume: { step: "first_use", goal: "attendance", path: "/more/setup/capabilities?task=attendance" },
    });
    const schoolId = provisioned.data.workspace.id;
    expect((await pool.query("SELECT resume_path FROM progressive_onboarding_workspaces WHERE school_id=$1", [schoolId])).rows[0].resume_path)
      .toBe("/more/setup/capabilities?task=attendance");
    await pool.query("UPDATE progressive_onboarding_workspaces SET resume_path='/principal/get-started/attendance' WHERE school_id=$1", [schoolId]);
    const oldResume = await request("applicant", "onboarding/workspace/");
    expect(oldResume.data.resume).toMatchObject({ step: "first_use", goal: "attendance", path: "/more/setup/capabilities?task=attendance" });
    const privateRow = (await pool.query(
      "SELECT institution_kind,onboarding_model,verification_status FROM schools WHERE id=$1",
      [schoolId],
    )).rows[0];
    expect(privateRow).toEqual({ institution_kind: "unspecified", onboarding_model: "progressive_private", verification_status: "not_verified" });
    expect((await pool.query("SELECT count(*)::int n FROM institution_activation_states WHERE school_id=$1", [schoolId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT role FROM school_memberships WHERE school_id=$1 AND user_id=$2", [schoolId, applicantId])).rows[0].role).toBe("admin");
    expect((await pool.query(
      "SELECT count(*)::int n FROM campus_model_agent_endpoints WHERE school_id=$1 AND user_id=$2 AND status='active'",
      [schoolId, applicantId],
    )).rows[0].n).toBe(1);

    const repeated = await request("applicant", "onboarding/workspace/", { timezone: "Europe/London" });
    expect(repeated.status).toBe(201);
    expect(repeated.data.workspace.id).toBe(schoolId);
    expect(repeated.data.workspace.timezone).toBe("Europe/London");
    expect((await pool.query("SELECT count(*)::int n FROM progressive_onboarding_workspaces WHERE provisioned_for_account_id=$1", [applicantId])).rows[0].n).toBe(1);

    const reprioritized = await request("applicant", "onboarding/goals/", {
      goals: ["attendance", "gate", "messages"], primary: "gate",
    }, "PUT");
    expect(reprioritized.status).toBe(200);
    expect(reprioritized.data.goals).toMatchObject({ selected: ["gate", "attendance", "messages"], primary: "gate" });
    const resumed = await request("applicant", "onboarding/resume/", {
      step: "first_use", goal: "gate", path: "/principal/get-started/gate",
    }, "PATCH");
    expect(resumed.status).toBe(200);
    expect(resumed.data.resume).toMatchObject({ step: "first_use", goal: "gate", path: "/more/setup/capabilities?task=gate" });
    expect((await pool.query("SELECT resume_path FROM progressive_onboarding_workspaces WHERE school_id=$1", [schoolId])).rows[0].resume_path)
      .toBe("/more/setup/capabilities?task=gate");
    const named = await request("applicant", "onboarding/workspace-profile/", {
      display_name: "Lotus Learning School", timezone: "Asia/Kolkata",
    }, "PATCH");
    expect(named.status).toBe(200);
    expect(named.data.workspace).toMatchObject({ id: schoolId, display_name: "Lotus Learning School", profile_named: true });

    const applicationBody = { institution_name: "Lotus Verified Learning School", requested_code: `lotus-${suffix.slice(0, 8)}`, institution_kind: "school", timezone: "Asia/Kolkata", state_code: "KA", district: "Bengaluru Urban", website: "https://example.test", applicant_role_title: "Founder Principal", regulator_type: "udise", regulator_reference: `UDISE-${suffix.slice(0, 10)}`, declaration_accepted: true };
    const submitted = await request("applicant", "onboarding/institution-applications/", applicationBody);
    expect(submitted.status).toBe(201);
    expect((await pool.query("SELECT workspace_school_id,provisioned_school_id,status FROM institution_onboarding_applications WHERE id=$1", [submitted.data.id])).rows[0]).toEqual({ workspace_school_id: schoolId, provisioned_school_id: null, status: "submitted" });
    expect((await request("applicant", "company/workspace/")).status).toBe(403);
    expect((await request("company", "company/workspace/")).data.applications.some((application: { id: string }) => application.id === submitted.data.id)).toBe(true);

    const needsInfo = await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "request_information", note: "Confirm the current affiliation reference." });
    expect(needsInfo.data.status).toBe("needs_information");
    const resubmitted = await request("applicant", "onboarding/institution-applications/", { ...applicationBody, application_id: submitted.data.id, regulator_reference: `AFFILIATION-${suffix.slice(0, 10)}` });
    expect(resubmitted.data.status).toBe("submitted");

    const approved = await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "approve", note: "Registration verified.", institution_code: applicationBody.requested_code });
    expect(approved.data.status).toBe("approved");
    expect(approved.data.school.id).toBe(schoolId);
    expect(approved.data.school.name).toBe(applicationBody.institution_name);
    expect((await pool.query(`SELECT label FROM campus_model_entities
      WHERE school_id=$1 AND domain='institutions' AND domain_id=$1::text`, [schoolId])).rows)
      .toEqual([expect.objectContaining({ label: applicationBody.institution_name })]);
    const formal = (await pool.query("SELECT institution_kind,onboarding_model,verification_status,created_by_user_id FROM schools WHERE id=$1", [schoolId])).rows[0];
    expect(formal).toEqual({ institution_kind: "school", onboarding_model: "company_verified", verification_status: "approved", created_by_user_id: applicantId });
    expect((await pool.query("SELECT count(*)::int n FROM schools WHERE created_by_user_id=$1", [applicantId])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT role FROM school_memberships WHERE school_id=$1 AND user_id=$2", [schoolId, applicantId])).rows[0].role).toBe("admin");
    const profile = await request("applicant", "auth/me/");
    expect(profile.data.memberships.some((membership: { school_id: string; role: string }) => membership.school_id === schoolId && membership.role === "admin")).toBe(true);
    expect((await request("company", `company/institution-applications/${submitted.data.id}/review/`, { action: "approve", note: "again" })).status).toBe(409);
  }, 30_000);

  it("does not force an existing administrator through purpose selection when a resumable record is added", async () => {
    const before = await request("legacy", "onboarding/workspace/");
    expect(before.data).toMatchObject({ status: "ready", workspace: { id: legacySchoolId } });
    expect(before.data.goals.selected).toEqual([]);
    const resumed = await request("legacy", "onboarding/resume/", {
      step: "operating", path: "/today",
    }, "PATCH");
    expect(resumed.data).toMatchObject({ status: "ready", resume: { step: "operating", path: "/today" } });
    expect(resumed.data.goals.selected).toEqual([]);
    const profile = await request("legacy", "auth/me/");
    expect(profile.data).toMatchObject({ institution_setup_required: false, onboarding: { status: "ready", selected_goal_count: 0 } });
  });
});
