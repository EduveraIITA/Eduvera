import type * as ConfigModule from "../src/config.js";
import { randomUUID } from "node:crypto";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { DatabaseService } from "../src/database/database.service.js";
import { AuditService } from "../src/common/audit.service.js";
import { GoogleAuthService } from "../src/auth/google-auth.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AuthController } from "../src/auth/auth.controller.js";
import type { RolesService } from "../src/roles/roles.service.js";
vi.mock("../src/config.js", async importOriginal => {
  const actual = await importOriginal<typeof ConfigModule>();
  return { ...actual, config: () => ({ ...actual.config(), GOOGLE_CLIENT_ID: "test-client" }) };
});
const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
suite("Google account linking and MFA with isolated PostgreSQL", () => {
  let db: DatabaseService;
  let google: GoogleAuthService;
  let audit: AuditService;
  const ids: string[] = [];
  const request = { ip: "127.0.0.1", headers: {} } as FastifyRequest;
  beforeAll(() => { db = new DatabaseService(); audit = new AuditService(db); google = new GoogleAuthService(db, audit); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of ids) await db.deleteFrom("users").where("id", "=", id).execute();
    await db.destroy();
  });
  async function proof(overrides: Record<string, unknown> = {}) {
    const nonce = await google.issueNonce();
    const subject = randomUUID();
    const claims = { iss: "https://accounts.google.com", aud: "test-client", sub: subject, email: `${subject}@gmail.com`, email_verified: true, nonce, iat: 1, exp: 9999999999, ...overrides };
    vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue(new LoginTicket("", claims) as never);
    return { nonce, claims, body: { credential: "synthetic-token" } };
  }
  it("creates a verified account without any school access and rejects replay", async () => {
    const p = await proof();
    const user = await google.login(p.body, p.nonce, request); ids.push(user.id);
    expect(user.email_verified_at).toBeTruthy();
    expect(await db.selectFrom("school_memberships").select("id").where("user_id", "=", user.id).execute()).toEqual([]);
    await expect(google.login(p.body, p.nonce, request)).rejects.toThrow(/already used/);
  });
  it("links existing accounts without changing role and retains stable subject after email changes", async () => {
    const email = `${randomUUID()}@gmail.com`;
    const account = await db.insertInto("users").values({ username: randomUUID(), email, first_name: "Existing", last_name: "Teacher", role: "staff", password_hash: "unusable" }).returningAll().executeTakeFirstOrThrow(); ids.push(account.id);
    const p = await proof({ email });
    const user = await google.login(p.body, p.nonce, request);
    expect(user.id).toBe(account.id); expect(user.role).toBe("staff"); expect(user.first_name).toBe("Existing");
    const changed = await proof({ sub: p.claims.sub, email: `${randomUUID()}@gmail.com` });
    expect((await google.login(changed.body, changed.nonce, request)).id).toBe(account.id);
    const alternate = await proof({ email });
    await expect(google.login(alternate.body, alternate.nonce, request)).rejects.toThrow(/another Google/);
  });
  it("rejects disabled accounts and expired nonces", async () => {
    const p = await proof();
    const user = await google.login(p.body, p.nonce, request); ids.push(user.id);
    await db.updateTable("users").set({ is_active: false }).where("id", "=", user.id).execute();
    const next = await proof({ sub: p.claims.sub, email: p.claims.email });
    await expect(google.login(next.body, next.nonce, request)).rejects.toThrow(/unavailable/);
    const expired = await proof();
    await sql`UPDATE auth_google_nonces SET expires_at=now()-interval '1 minute' WHERE nonce_hash=${AuthService.tokenHash(expired.nonce)}`.execute(db);
    await expect(google.login(expired.body, expired.nonce, request)).rejects.toThrow(/expired/);
  });
  it("requires existing MFA and does not issue a session before the challenge is complete", async () => {
    const p = await proof();
    const user = await google.login(p.body, p.nonce, request); ids.push(user.id);
    await sql`INSERT INTO auth_mfa_factors(user_id,encrypted_secret,secret_iv,secret_tag,status,confirmed_at)
      VALUES(${user.id}::uuid,${Buffer.alloc(16)},${Buffer.alloc(12)},${Buffer.alloc(16)},'active',now())`.execute(db);
    const next = await proof({ sub: p.claims.sub, email: p.claims.email });
    const auth = new AuthService(db, audit, {} as RolesService);
    const createSession = vi.spyOn(auth, "createSession");
    const controller = new AuthController(auth, audit, google);
    const req = { ...request, body: next.body, cookies: { google_signin_nonce: "signed" }, unsignCookie: () => ({ valid: true, value: next.nonce }) };
    const reply = { clearCookie: vi.fn(), status: vi.fn(), setCookie: vi.fn() };
    const result = await controller.googleLogin(req as unknown as FastifyRequest, reply as never);
    expect(result).toMatchObject({ mfa_required: true });
    expect(reply.status).toHaveBeenCalledWith(202);
    expect(createSession).not.toHaveBeenCalled();
    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});
