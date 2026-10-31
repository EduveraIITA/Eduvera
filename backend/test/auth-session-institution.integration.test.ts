import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
if (enabled) requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);

describe.runIf(enabled)("authenticated institution selection with PostgreSQL memberships", () => {
  let db: DatabaseService;
  let auth: AuthService;
  const userId = randomUUID();
  const institutions = [randomUUID(), randomUUID()];
  const request = { ip: "127.0.0.1", headers: {} } as FastifyRequest;
  const account = (): AuthUser => ({ id: userId, username: `session-${userId}`, email: `${userId}@example.test`,
    first_name: "Session", last_name: "Regression", role: "admin", is_active: true, active_school_id: null });

  beforeAll(async () => {
    db = new DatabaseService();
    auth = new AuthService(db, {} as never, {} as never, {} as never);
    await db.insertInto("users").values({ id: userId, username: `session-${userId}`, email: `${userId}@example.test`,
      first_name: "Session", last_name: "Regression", role: "admin", is_active: true,
      password_hash: "unusable-session-regression" }).execute();
    for (const id of institutions) {
      await db.insertInto("schools").values({ id, name: "Session institution regression", code: `SESSION-${id.slice(0, 16)}` }).execute();
    }
    await db.insertInto("school_memberships").values([
      { user_id: userId, school_id: institutions[0]!, role: "admin", is_active: true },
      { user_id: userId, school_id: institutions[0]!, role: "staff", is_active: true },
      { user_id: userId, school_id: institutions[1]!, role: "admin", is_active: false },
    ]).execute();
  });

  afterAll(async () => {
    await db.deleteFrom("auth_sessions").where("user_id", "=", userId).execute();
    await db.deleteFrom("schools").where("id", "in", institutions).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
    await db.destroy();
  });

  async function storedSelection(user: AuthUser) {
    const session = await auth.createSession(user, request);
    return db.selectFrom("auth_sessions").select("active_school_id")
      .where("token_hash", "=", AuthService.tokenHash(session.rawToken)).executeTakeFirstOrThrow();
  }

  it("selects the single active institution for an administrator who also teaches there", async () => {
    expect(await storedSelection(account())).toEqual({ active_school_id: institutions[0] });
  });

  it("leaves genuinely multiple active institutions unselected rather than choosing a membership row", async () => {
    await db.updateTable("school_memberships").set({ is_active: true })
      .where("user_id", "=", userId).where("school_id", "=", institutions[1]!).execute();
    try {
      expect(await storedSelection(account())).toEqual({ active_school_id: null });
      expect(await storedSelection({ ...account(), active_school_id: institutions[1]! }))
        .toEqual({ active_school_id: institutions[1] });
    } finally {
      await db.updateTable("school_memberships").set({ is_active: false })
        .where("user_id", "=", userId).where("school_id", "=", institutions[1]!).execute();
    }
  });

  it("does not create an institution selection from inactive memberships", async () => {
    await db.updateTable("school_memberships").set({ is_active: false }).where("user_id", "=", userId).execute();
    try { expect(await storedSelection(account())).toEqual({ active_school_id: null }); }
    finally {
      await db.updateTable("school_memberships").set({ is_active: true }).where("user_id", "=", userId)
        .where("school_id", "=", institutions[0]!).execute();
    }
  });
});
