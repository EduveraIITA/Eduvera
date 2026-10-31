import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
if (enabled) requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);

describe.runIf(enabled)("native credentials use the existing PostgreSQL session lifecycle", () => {
  let db: DatabaseService;
  let auth: AuthService;
  const userId = randomUUID(), schoolId = randomUUID(), otherSchoolId = randomUUID();
  const actor = (): AuthUser => ({ id: userId, username: `native-${userId}`, email: `${userId}@example.test`,
    first_name: "Native", last_name: "Session", role: "staff", is_active: true, active_school_id: schoolId });
  const request = { ip: "127.0.0.1", headers: { "user-agent": "ThatCampus native lifecycle test" } } as FastifyRequest;

  beforeAll(async () => {
    db = new DatabaseService();
    auth = new AuthService(db, {} as never, {} as never, {} as never);
    await db.insertInto("users").values({ id: userId, username: actor().username, email: actor().email,
      first_name: "Native", last_name: "Session", role: "staff", password_hash: "unusable-native-session-test" }).execute();
    for (const id of [schoolId, otherSchoolId]) await db.insertInto("schools").values({ id,
      name: "Native session isolated test", code: `NATIVE-${id.slice(0, 16)}` }).execute();
    await db.insertInto("school_memberships").values({ user_id: userId, school_id: schoolId, role: "staff", is_active: true }).execute();
  });
  afterAll(async () => {
    await db.deleteFrom("auth_sessions").where("user_id", "=", userId).execute();
    await db.deleteFrom("schools").where("id", "in", [schoolId, otherSchoolId]).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
    await db.destroy();
  });

  it("persists only the native token hash and restores its ordinary institution/session scope", async () => {
    const session = await auth.createSession(actor(), request, { transport: "native" });
    const stored = await db.selectFrom("auth_sessions").selectAll().where("token_hash", "=", AuthService.tokenHash(session.rawToken)).executeTakeFirstOrThrow();
    expect(session.rawToken).toMatch(/^tc_native_[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(stored)).not.toContain(session.rawToken);
    const restored = await auth.resolveSession(session.rawToken);
    expect(restored).toMatchObject({ user: { id: userId, active_school_id: schoolId }, expiresAt: session.expiresAt,
      executionEnvironmentView: { mode: "live", institution_id: schoolId, namespace_id: `live:${schoolId}` } });
  });

  it("rechecks membership when a native session selects another institution", async () => {
    const session = await auth.createSession(actor(), request, { transport: "native" });
    await expect(auth.selectSchool(actor(), AuthService.tokenHash(session.rawToken), { school_id: otherSchoolId })).rejects.toMatchObject({ status: 403 });
    expect((await auth.resolveSession(session.rawToken))?.user.active_school_id).toBe(schoolId);
  });

  it("revokes both other native and web sessions through the same existing API", async () => {
    const current = await auth.createSession(actor(), request, { transport: "native" });
    const anotherNative = await auth.createSession(actor(), request, { transport: "native" });
    const web = await auth.createSession(actor(), request);
    await auth.revokeOtherSessions(actor(), AuthService.tokenHash(current.rawToken));
    expect(await auth.resolveSession(current.rawToken)).not.toBeNull();
    expect(await auth.resolveSession(anotherNative.rawToken)).toBeNull();
    expect(await auth.resolveSession(web.rawToken)).toBeNull();
  });

  it("refuses an expired or disabled account's native credential", async () => {
    const expired = await auth.createSession(actor(), request, { transport: "native" });
    await db.updateTable("auth_sessions").set({ expires_at: new Date("2000-01-01T00:00:00Z") }).where("token_hash", "=", AuthService.tokenHash(expired.rawToken)).execute();
    expect(await auth.resolveSession(expired.rawToken)).toBeNull();
    const disabled = await auth.createSession(actor(), request, { transport: "native" });
    await db.updateTable("users").set({ is_active: false }).where("id", "=", userId).execute();
    try { expect(await auth.resolveSession(disabled.rawToken)).toBeNull(); }
    finally { await db.updateTable("users").set({ is_active: true }).where("id", "=", userId).execute(); }
  });

  it("makes native logout effective against subsequent durable session lookups", async () => {
    const session = await auth.createSession(actor(), request, { transport: "native" });
    await auth.logout(AuthService.tokenHash(session.rawToken));
    expect(await auth.resolveSession(session.rawToken)).toBeNull();
  });
});
