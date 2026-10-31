import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { TestApiSession, startManagedTestApi, type ManagedTestApi } from "./http-api.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Requires the reviewed compiled release. Native source/COW evidence is a separate suite.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true" && process.env.WHOLE_CAMPUS_HTTP_TEST_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/whole_campus_http_unused_test";

describe.skipIf(!enabled)("whole-campus preference through ordinary authenticated HTTP", () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const owner = new TestApiSession("http://127.0.0.1:8076"), staff = new TestApiSession("http://127.0.0.1:8076"), anonymous = new TestApiSession("http://127.0.0.1:8076");
  const suffix = randomUUID(), password = "C4mpus!Onboarding-Http2026";
  let server: ManagedTestApi | undefined, schoolId = "", ownerId = "", staffId = "";
  beforeAll(async () => {
    const digest = await hashPassword(password);
    for (const [name, role] of [["owner", "admin"], ["staff", "staff"]] as const) {
      const account = (await pool.query<{ id: string }>(`INSERT INTO users(username,email,password_hash,first_name,last_name,role,email_verified_at)
        VALUES($1,$2,$3,$4,'Onboarding',$5,now()) RETURNING id`, [`whole-http-${name}-${suffix}`, `whole-http-${name}-${suffix}@example.test`, digest, name, role])).rows[0]!;
      if (name === "owner") ownerId = account.id; else staffId = account.id;
    }
    server = await startManagedTestApi({ port: 8076, databaseUrl: url, cookieSecret: "whole-campus-guidance-isolated-http-secret2026", rateLimitStore: "memory" });
    for (const [name, session] of [["owner", owner], ["staff", staff]] as const) {
      await session.request("/api/v1/auth/csrf/");
      expect((await session.request("/api/v1/auth/login/", { identifier: `whole-http-${name}-${suffix}`, password })).status).toBe(200);
    }
  }, 30_000);
  afterAll(async () => { await server?.stop(); await pool.end(); });

  it("starts incrementally and preserves the same workspace, goals and fixed continuation on refresh", async () => {
    const created = await owner.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus", timezone: "Asia/Kolkata" });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    schoolId = created.data.active_school_id;
    expect(created.data).toMatchObject({ status: "ready", guidance: "whole_campus", goals: { selected: [], primary: null },
      guidance_resume: { path: "/more/setup/whole-campus", actor_user_id: ownerId, school_id: schoolId, requires_recheck: true } });
    const refreshed = await owner.request("/api/v1/auth/me/");
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.onboarding).toMatchObject({ status: "ready", selected_goal_count: 0, guidance: "whole_campus", guidance_resume: { school_id: schoolId } });
    const repeated = await owner.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus" });
    expect(repeated.data.active_school_id).toBe(schoolId);
    expect((await pool.query("SELECT count(*)::int n FROM progressive_onboarding_workspaces WHERE provisioned_for_account_id=$1", [ownerId])).rows[0].n).toBe(1);
    const choices = await owner.request("/api/v1/onboarding/goals/", { goals: ["messages", "fees"], primary: "fees" }, "PUT");
    expect(choices.status).toBe(200);
    expect(choices.data).toMatchObject({ guidance: "whole_campus", goals: { selected: ["fees", "messages"] } });
    const paused = await owner.request("/api/v1/onboarding/workspace/", { guidance: null });
    expect(paused.data).toMatchObject({ guidance: null, guidance_resume: null, goals: { selected: ["fees", "messages"] } });
    expect((await owner.request("/api/v1/auth/me/")).data.onboarding.guidance_resume).toBeNull();
  });

  it("rejects arbitrary context, role and completion input and keeps anonymous/CSRF boundaries", async () => {
    for (const body of [{ guidance: "whole_campus", campus_id: randomUUID() }, { guidance: "whole_campus", role: "admin" },
      { guidance: "whole_campus", path: "https://evil.invalid" }, { guidance: "whole_campus", completed: true }, { guidance: "unknown" }]) {
      expect((await owner.request("/api/v1/onboarding/workspace/", body)).status).toBe(400);
    }
    expect((await anonymous.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus" })).status).toBe(401);
    expect((await owner.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus" }, "POST", false)).status).toBe(403);
    expect((await owner.request("/api/v1/onboarding/workspace/")).data.guidance).toBeNull();
  });

  it("does not make staff a founder, return an unrelated administrator workspace or retain a revoked setup landing", async () => {
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'staff')", [staffId, schoolId]);
    expect((await staff.request("/api/v1/auth/active-school/", { school_id: schoolId })).status).toBe(200);
    expect((await staff.request("/api/v1/auth/me/")).data.onboarding.guidance_resume).toBeNull();
    expect((await staff.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus" })).status).toBe(403);
    expect((await staff.request("/api/v1/onboarding/goals/", { goals: ["gate"], guidance: "whole_campus" }, "PUT")).status).toBeGreaterThanOrEqual(403);
    expect((await pool.query("SELECT count(*)::int n FROM schools WHERE created_by_user_id=$1", [staffId])).rows[0].n).toBe(0);
    expect((await owner.request("/api/v1/onboarding/workspace/", { guidance: "whole_campus" })).status).toBe(201);
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [schoolId, ownerId]);
    const refreshed = await owner.request("/api/v1/auth/me/");
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.onboarding.guidance_resume).toBeNull();
    expect((await owner.request("/api/v1/onboarding/workspace/", { guidance: null })).status).toBeGreaterThanOrEqual(403);
  });
});
