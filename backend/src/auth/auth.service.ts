import { RolesService } from "../roles/roles.service.js";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { config } from "../config.js";
import { AuditService } from "../common/audit.service.js";
import { deliverAccountAction } from "../common/account-email.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { hashPassword, isPublishedDemoPassword, validatePassword, verifyPassword } from "./password.js";
import { proFeaturesEnabled } from "./pro-features.js";
import {
  demoProfileSwitcherEnabled,
  demoSwitchRoles,
  demoSwitchUsernames,
  isDemoSwitchUsername,
  type DemoSwitchRole,
} from "./demo-profile-switcher.js";
import {
  createMfaSecret,
  createRecoveryCodes,
  decryptMfaSecret,
  encryptMfaSecret,
  matchingTotpStep,
  normalizeRecoveryCode,
} from "./mfa.js";

const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  first_name: z.string().trim().min(1).max(150),
  last_name: z.string().trim().min(1).max(150),
  role: z.enum(["student", "parent", "admin"]),
});
const tokenSchema = z.object({ token: z.string().trim().min(32).max(256) });
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const mfaLoginSchema = z.object({ challenge_token: z.string().trim().min(32).max(256), code: z.string().trim().min(6).max(32) });
const resetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const resetConfirmSchema = tokenSchema.extend({ password: z.string().min(1).max(128) });
const demoUsernames = {
  student: "aarav.student",
  parent: "pooja.parent",
  staff: "kavita.staff",
  admin: "meera.principal",
  school_admin: "arjun.admin",
  company: "company.demo",
} as const;
const institutionDemoUsernames = new Set<string>(Object.values(demoUsernames).filter((username) => username !== demoUsernames.company));

export interface SessionIdentity { user: AuthUser; tokenHash: string; csrfToken: string }

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url || null,
    email_verified: Boolean(user.email_verified_at),
    display_name: `${user.first_name} ${user.last_name}`.trim() || user.username,
    role: user.role,
    active_school_id: user.active_school_id ?? null,
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService, private readonly roles: RolesService) {}

  static tokenHash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private sweepTimer?: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;

  // Expired sessions are already rejected on lookup below; the DELETE only reclaims rows,
  // so it runs on a timer instead of on every request.
  private scheduleSessionSweep(): void {
    if (this.sweepTimer) return;
    const sweep = async () => {
      this.lastSweepAt = Date.now();
      await this.db.deleteFrom("auth_sessions").where("expires_at", "<", new Date()).execute().catch(() => undefined);
    };
    this.sweepTimer = setInterval(() => { void sweep(); }, 5 * 60_000);
    this.sweepTimer.unref();
    if (Date.now() - this.lastSweepAt > 5 * 60_000) void sweep();
  }

  async resolveSession(rawToken: string | undefined): Promise<SessionIdentity | null> {
    this.scheduleSessionSweep();
    if (!rawToken) return null;
    const tokenHash = AuthService.tokenHash(rawToken);
    const row = await this.db.selectFrom("auth_sessions as s")
      .innerJoin("users as u", "u.id", "s.user_id")
      .select([
        "s.token_hash", "s.csrf_token", "s.expires_at", "s.last_seen_at", "s.active_school_id",
        "u.id", "u.username", "u.email", "u.first_name", "u.last_name", "u.avatar_url", "u.role", "u.is_active", "u.email_verified_at",
      ])
      .where("s.token_hash", "=", tokenHash).executeTakeFirst();
    if (!row) return null;
    if (!row.is_active || new Date(row.expires_at) <= new Date()) {
      await this.db.deleteFrom("auth_sessions").where("token_hash", "=", tokenHash).execute();
      return null;
    }
    // last_seen_at is informational; write it at most once a minute per session.
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen > 60_000) {
      await this.db.updateTable("auth_sessions").set({ last_seen_at: new Date() })
        .where("token_hash", "=", tokenHash).execute();
    }
    return {
      tokenHash,
      csrfToken: row.csrf_token,
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_url: row.avatar_url,
        role: row.role,
        is_active: row.is_active,
        email_verified_at: row.email_verified_at,
        active_school_id: row.active_school_id,
      },
    };
  }

  async createSession(user: AuthUser, request: FastifyRequest): Promise<{ rawToken: string; csrfToken: string }> {
    if (!user.active_school_id) {
      const memberships = await this.db.selectFrom('school_memberships').select('school_id')
        .where('user_id','=',user.id).where('is_active','=',true).limit(2).execute();
      // Only an unambiguous authenticated membership may establish tenant context.
      if (memberships.length === 1) user.active_school_id = memberships[0]!.school_id;
    }
    const rawToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + config().SESSION_TTL_SECONDS * 1000);
    const ipHash = createHash("sha256").update(request.ip).digest("hex");
    await this.db.insertInto("auth_sessions").values({
      token_hash: AuthService.tokenHash(rawToken),
      user_id: user.id,
      active_school_id: user.active_school_id ?? null,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      ip_hash: ipHash,
      user_agent: String(request.headers["user-agent"] ?? "").slice(0, 500),
    }).execute();
    return { rawToken, csrfToken };
  }

  async login(body: unknown, request: FastifyRequest): Promise<{ user: AuthUser; mfaChallenge?: string }> {
    const data = loginSchema.parse(body);
    const accountBucket = AuthService.tokenHash('login-account:' + data.identifier.toLowerCase());
    const attempts = (await sql<{hits:number}>`INSERT INTO api_rate_limit_buckets(bucket_key,hits,expires_at)
      VALUES(${accountBucket},1,now()+interval '15 minutes') ON CONFLICT(bucket_key) DO UPDATE SET
      hits=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN 1 ELSE api_rate_limit_buckets.hits+1 END,
      expires_at=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
      RETURNING hits`.execute(this.db)).rows[0]!;
    if (attempts.hits > 10) throw new HttpException('Too many sign-in attempts. Please wait 15 minutes before trying again.',429);
    const user = await this.db.selectFrom("users").selectAll()
      .where((eb) => eb.or([
        eb(sql`lower(email)`, "=", data.identifier.toLowerCase()),
        eb(sql`lower(username)`, "=", data.identifier.toLowerCase()),
      ])).executeTakeFirst();
    if (!user || !user.is_active || (!config().DEMO_MODE && isPublishedDemoPassword(data.password)) || !(await verifyPassword(data.password, user.password_hash))) {
      await this.audit.record({
        action: "auth.login.failed", request,
        metadata: { identifier_hash: createHash("sha256").update(data.identifier.toLowerCase()).digest("hex") },
      });
      throw new UnauthorizedException("Invalid email/username or password.");
    }
    const factor = await sql<{ active: boolean }>`SELECT status='active' AS active FROM auth_mfa_factors WHERE user_id=${user.id}::uuid`.execute(this.db);
    await sql`DELETE FROM api_rate_limit_buckets WHERE bucket_key=${accountBucket}`.execute(this.db);
    if (factor.rows[0]?.active) {
      const challenge = randomBytes(32).toString("base64url");
      await this.db.transaction().execute(async (db) => {
        await sql`DELETE FROM auth_mfa_login_challenges WHERE user_id=${user.id}::uuid OR expires_at<now()`.execute(db);
        await sql`INSERT INTO auth_mfa_login_challenges(token_hash,user_id,expires_at)
          VALUES(${AuthService.tokenHash(challenge)},${user.id}::uuid,now()+interval '5 minutes')`.execute(db);
      });
      await this.audit.record({ action: "auth.login.mfa_challenged", request, actorId: user.id });
      return { user, mfaChallenge: challenge };
    }
    await this.audit.record({ action: "auth.login.succeeded", request, actorId: user.id });
    return { user };
  }

  async register(body: unknown, request: FastifyRequest) {
    const data = registrationSchema.parse(body);
    const errors = validatePassword(data.password, { email: data.email, firstName: data.first_name, lastName: data.last_name });
    if (errors.length) {
      throw new (await import("@nestjs/common")).BadRequestException({
        message: "Choose a stronger password.", fields: { password: errors }, code: "validation_error",
      });
    }
    const exists = await this.db.selectFrom("users").select("id")
      .where(sql<boolean>`lower(email) = ${data.email}`).executeTakeFirst();
    if (exists) throw new ConflictException("An account with this email already exists.");
    const digest = createHash("sha256").update(data.email).digest("hex").slice(0, 12);
    const local = data.email.split("@")[0]?.replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "user";
    const base = `${local.slice(0, 120)}.${digest}`;
    const passwordHash = await hashPassword(data.password);
    try {
      const user = await this.db.insertInto("users").values({
        username: base,
        email: data.email,
        password_hash: passwordHash,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.record({
        action: "auth.registration.succeeded", request, actorId: user.id,
        targetType: "user", targetId: user.id,
        metadata: { role: user.role, onboarding_status: "pending_school_membership" },
      });
      const verification = await this.issueAccountToken(user.id, "email_verification", 24 * 60 * 60_000);
      const delivery = await deliverAccountAction({ email: user.email, token: verification.raw, purpose: "email_verification", expiresAt: verification.expiresAt });
      return { user, verification: { ...delivery, expires_at: verification.expiresAt } };
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("An account with this email already exists.");
      throw error;
    }
  }

  private async issueAccountToken(userId: string, purpose: "email_verification" | "password_reset", ttlMs: number) {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.db.transaction().execute(async (db) => {
      await sql`UPDATE auth_account_tokens SET consumed_at=COALESCE(consumed_at,now())
        WHERE user_id=${userId}::uuid AND purpose=${purpose} AND consumed_at IS NULL`.execute(db);
      await sql`INSERT INTO auth_account_tokens(user_id,purpose,token_hash,expires_at)
        VALUES(${userId}::uuid,${purpose},${AuthService.tokenHash(raw)},${expiresAt})`.execute(db);
    });
    return { raw, expiresAt };
  }

  async requestEmailVerification(user: AuthUser, request: FastifyRequest) {
    if (user.email_verified_at) return { verified: true, delivery: "not_required" as const };
    const recent = await sql`SELECT 1 FROM auth_account_tokens WHERE user_id=${user.id}::uuid
      AND purpose='email_verification' AND created_at>now()-interval '1 minute' AND consumed_at IS NULL`.execute(this.db);
    if (recent.rows.length) throw new ConflictException("A verification message was sent recently. Wait a minute before requesting another.");
    const token = await this.issueAccountToken(user.id, "email_verification", 24 * 60 * 60_000);
    const delivery = await deliverAccountAction({ email: user.email, token: token.raw, purpose: "email_verification", expiresAt: token.expiresAt });
    await this.audit.record({ action: "auth.email_verification.requested", request, actorId: user.id, targetType: "user", targetId: user.id, metadata: { delivery: delivery.delivery } });
    return { verified: false, ...delivery, expires_at: token.expiresAt };
  }

  async confirmEmailVerification(user: AuthUser, body: unknown, request: FastifyRequest) {
    const data = tokenSchema.parse(body);
    const result = await this.db.transaction().execute(async (db) => {
      const token = (await sql<{ id: string; user_id: string }>`SELECT id,user_id FROM auth_account_tokens
        WHERE token_hash=${AuthService.tokenHash(data.token)} AND purpose='email_verification'
          AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`.execute(db)).rows[0];
      if (!token || token.user_id !== user.id) throw new BadRequestException("This verification link is invalid or expired.");
      await sql`UPDATE auth_account_tokens SET consumed_at=now() WHERE id=${token.id}::uuid`.execute(db);
      await sql`UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=${user.id}::uuid`.execute(db);
      return { verified: true };
    });
    user.email_verified_at = new Date();
    await this.audit.record({ action: "auth.email_verified", request, actorId: user.id, targetType: "user", targetId: user.id });
    return result;
  }

  async requestPasswordReset(body: unknown, request: FastifyRequest) {
    const data = resetRequestSchema.parse(body);
    const user = await this.db.selectFrom("users").select(["id", "email"]).where(sql<boolean>`lower(email)=${data.email}`).where("is_active", "=", true).executeTakeFirst();
    if (user) {
      const token = await this.issueAccountToken(user.id, "password_reset", 30 * 60_000);
      const delivery = await deliverAccountAction({ email: user.email, token: token.raw, purpose: "password_reset", expiresAt: token.expiresAt });
      await this.audit.record({ action: "auth.password_reset.requested", request, actorId: user.id, targetType: "user", targetId: user.id, metadata: { delivery: delivery.delivery } });
      return { accepted: true, ...(config().DEMO_MODE && config().NODE_ENV !== "production" ? delivery : {}) };
    }
    await this.audit.record({ action: "auth.password_reset.requested_unknown", request, metadata: { email_hash: createHash("sha256").update(data.email).digest("hex") } });
    return { accepted: true };
  }

  async confirmPasswordReset(body: unknown, request: FastifyRequest) {
    const data = resetConfirmSchema.parse(body);
    const tokenHash = AuthService.tokenHash(data.token);
    const result = await this.db.transaction().execute(async (db) => {
      const token = (await sql<{ id: string; user_id: string; email: string; first_name: string; last_name: string }>`SELECT token.id,token.user_id,account.email,account.first_name,account.last_name
        FROM auth_account_tokens token JOIN users account ON account.id=token.user_id
        WHERE token.token_hash=${tokenHash} AND token.purpose='password_reset' AND token.consumed_at IS NULL
          AND token.expires_at>now() AND account.is_active FOR UPDATE OF token`.execute(db)).rows[0];
      if (!token) throw new BadRequestException("This password-reset link is invalid or expired.");
      const errors = validatePassword(data.password, { email: token.email, firstName: token.first_name, lastName: token.last_name });
      if (errors.length) throw new BadRequestException({ message: "Choose a stronger password.", fields: { password: errors }, code: "validation_error" });
      await sql`UPDATE users SET password_hash=${await hashPassword(data.password)},updated_at=now() WHERE id=${token.user_id}::uuid`.execute(db);
      await sql`UPDATE auth_account_tokens SET consumed_at=now() WHERE id=${token.id}::uuid`.execute(db);
      await sql`DELETE FROM auth_sessions WHERE user_id=${token.user_id}::uuid`.execute(db);
      await sql`DELETE FROM auth_mfa_login_challenges WHERE user_id=${token.user_id}::uuid`.execute(db);
      return { reset: true, userId: token.user_id };
    });
    await this.audit.record({ action: "auth.password_reset.completed", request, actorId: result.userId, targetType: "user", targetId: result.userId });
    return { reset: true };
  }

  async mfaStatus(user: AuthUser) {
    const factor = (await sql<{ status: string; confirmed_at: Date | null; recovery_codes: number }>`SELECT factor.status,factor.confirmed_at,
      (SELECT count(*)::int FROM auth_mfa_recovery_codes code WHERE code.user_id=factor.user_id AND code.used_at IS NULL) AS recovery_codes
      FROM auth_mfa_factors factor WHERE factor.user_id=${user.id}::uuid`.execute(this.db)).rows[0];
    return { status: factor?.status ?? "not_enrolled", confirmed_at: factor?.confirmed_at ?? null, recovery_codes_remaining: factor?.recovery_codes ?? 0 };
  }

  async beginMfaEnrollment(user: AuthUser, request: FastifyRequest) {
    if (!user.email_verified_at) throw new ConflictException("Verify your email before setting up two-step verification.");
    const existing = await sql<{ status: string }>`SELECT status FROM auth_mfa_factors WHERE user_id=${user.id}::uuid`.execute(this.db);
    if (existing.rows[0]?.status === "active") throw new ConflictException("Two-step verification is already active.");
    const secret = createMfaSecret();
    const encrypted = encryptMfaSecret(secret);
    await sql`INSERT INTO auth_mfa_factors(user_id,encrypted_secret,secret_iv,secret_tag,status,confirmed_at,updated_at)
      VALUES(${user.id}::uuid,${encrypted.encrypted},${encrypted.iv},${encrypted.tag},'pending',NULL,now())
      ON CONFLICT(user_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,secret_iv=excluded.secret_iv,
        secret_tag=excluded.secret_tag,status='pending',confirmed_at=NULL,last_used_step=NULL,updated_at=now()`.execute(this.db);
    const issuer = "Eduvera";
    const label = `${issuer}:${user.email}`;
    const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    await this.audit.record({ action: "auth.mfa.enrollment_started", request, actorId: user.id, targetType: "user", targetId: user.id });
    return { secret, otpauth_uri: uri };
  }

  async confirmMfaEnrollment(user: AuthUser, body: unknown, request: FastifyRequest) {
    const data = mfaCodeSchema.parse(body);
    const codes = createRecoveryCodes();
    await this.db.transaction().execute(async (db) => {
      const factor = (await sql<{ encrypted_secret: Buffer; secret_iv: Buffer; secret_tag: Buffer; status: string }>`SELECT encrypted_secret,secret_iv,secret_tag,status
        FROM auth_mfa_factors WHERE user_id=${user.id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!factor || factor.status !== "pending") throw new ConflictException("Start two-step verification setup before confirming it.");
      const secret = decryptMfaSecret(factor.encrypted_secret, factor.secret_iv, factor.secret_tag);
      const step = matchingTotpStep(secret, data.code);
      if (step === null) throw new BadRequestException("Enter the current six-digit code from your authenticator app.");
      await sql`UPDATE auth_mfa_factors SET status='active',confirmed_at=now(),last_used_step=${step},updated_at=now() WHERE user_id=${user.id}::uuid`.execute(db);
      await sql`DELETE FROM auth_mfa_recovery_codes WHERE user_id=${user.id}::uuid`.execute(db);
      for (const code of codes) await sql`INSERT INTO auth_mfa_recovery_codes(user_id,code_hash) VALUES(${user.id}::uuid,${AuthService.tokenHash(normalizeRecoveryCode(code))})`.execute(db);
    });
    await this.audit.record({ action: "auth.mfa.activated", request, actorId: user.id, targetType: "user", targetId: user.id });
    return { active: true, recovery_codes: codes };
  }

  async completeMfaLogin(body: unknown, request: FastifyRequest): Promise<AuthUser> {
    const data = mfaLoginSchema.parse(body);
    const challengeHash = AuthService.tokenHash(data.challenge_token);
    const result = await this.db.transaction().execute(async (db) => {
      const challenge = (await sql<{ user_id: string }>`SELECT user_id FROM auth_mfa_login_challenges
        WHERE token_hash=${challengeHash} AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`.execute(db)).rows[0];
      if (!challenge) throw new UnauthorizedException("The sign-in verification expired. Start again.");
      const factor = (await sql<{ encrypted_secret: Buffer; secret_iv: Buffer; secret_tag: Buffer; last_used_step: string | null }>`SELECT encrypted_secret,secret_iv,secret_tag,last_used_step
        FROM auth_mfa_factors WHERE user_id=${challenge.user_id}::uuid AND status='active' FOR UPDATE`.execute(db)).rows[0];
      if (!factor) throw new UnauthorizedException("Two-step verification is unavailable for this account.");
      const secret = decryptMfaSecret(factor.encrypted_secret, factor.secret_iv, factor.secret_tag);
      const step = matchingTotpStep(secret, data.code);
      let recoveryHash: string | null = null;
      if (step === null) {
        recoveryHash = AuthService.tokenHash(normalizeRecoveryCode(data.code));
        const recovery = await sql`SELECT 1 FROM auth_mfa_recovery_codes WHERE user_id=${challenge.user_id}::uuid
          AND code_hash=${recoveryHash} AND used_at IS NULL FOR UPDATE`.execute(db);
        if (!recovery.rows.length) throw new UnauthorizedException("The verification code is invalid.");
      } else if (factor.last_used_step !== null && step <= Number(factor.last_used_step)) {
        throw new UnauthorizedException("That verification code has already been used.");
      }
      if (recoveryHash) await sql`UPDATE auth_mfa_recovery_codes SET used_at=now() WHERE user_id=${challenge.user_id}::uuid AND code_hash=${recoveryHash}`.execute(db);
      else await sql`UPDATE auth_mfa_factors SET last_used_step=${step},updated_at=now() WHERE user_id=${challenge.user_id}::uuid`.execute(db);
      await sql`UPDATE auth_mfa_login_challenges SET consumed_at=now() WHERE token_hash=${challengeHash}`.execute(db);
      const account = await db.selectFrom("users").selectAll().where("id", "=", challenge.user_id).where("is_active", "=", true).executeTakeFirst();
      if (!account) throw new UnauthorizedException("This account is unavailable.");
      return account;
    });
    await this.audit.record({ action: "auth.login.succeeded", request, actorId: result.id, metadata: { mfa: true } });
    return result;
  }

  async demoUser(role: "student" | "parent" | "staff" | "admin" | "school_admin" | "company"): Promise<AuthUser> {
    const username = demoUsernames[role];
    const user = await this.db.selectFrom("users").selectAll().where("username", "=", username).where("is_active", "=", true).executeTakeFirst();
    if (!user) throw new UnauthorizedException("Demo data has not been seeded.");
    if (role === "company") return { ...user, active_school_id: null };
    const membership = await this.db.selectFrom("school_memberships as membership")
      .innerJoin("schools as school", "school.id", "membership.school_id")
      .select("membership.school_id")
      .where("membership.user_id", "=", user.id)
      .where("membership.is_active", "=", true)
      .where("school.code", "=", "cis")
      .executeTakeFirst();
    if (!membership) throw new UnauthorizedException("The Cambridge demo institution has not been seeded for this profile.");
    return { ...user, active_school_id: membership.school_id };
  }

  canUseDemoProfileSwitcher(user: AuthUser): boolean {
    return demoProfileSwitcherEnabled() && isDemoSwitchUsername(user.username);
  }

  async demoProfiles(current: AuthUser) {
    if (!this.canUseDemoProfileSwitcher(current)) return null;
    const profiles = await Promise.all(demoSwitchRoles.map(async (role) => {
      const user = await this.demoUser(role);
      return {
        role,
        username: demoSwitchUsernames[role],
        display_name: `${user.first_name} ${user.last_name}`.trim() || user.username,
        avatar_url: user.avatar_url || null,
        current: user.username === current.username,
      };
    }));
    return { enabled: true, profiles };
  }

  async demoProfile(role: DemoSwitchRole): Promise<AuthUser> {
    return this.demoUser(role);
  }

  async logout(tokenHash: string): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("token_hash", "=", tokenHash).execute();
  }

  async selectSchool(user: AuthUser, sessionHash: string, body: unknown) {
    const { school_id } = z.object({ school_id: z.string().uuid() }).parse(body);
    const membership = await this.db.selectFrom("school_memberships").select("id").where("user_id", "=", user.id)
      .where("school_id", "=", school_id).where("is_active", "=", true).executeTakeFirst();
    if (!membership) throw new ForbiddenException("An active membership in the selected school is required.");
    await this.db.updateTable("auth_sessions").set({ active_school_id: school_id }).where("token_hash", "=", sessionHash).where("user_id", "=", user.id).execute();
    return { active_school_id: school_id };
  }

  async sessions(user: AuthUser, current: string) {
    const rows = await this.db.selectFrom("auth_sessions").select(["token_hash", "user_agent", "created_at", "last_seen_at", "expires_at"])
      .where("user_id", "=", user.id).where("expires_at", ">", new Date()).orderBy("last_seen_at", "desc").execute();
    return { results: rows.map(({ token_hash, ...row }) => ({ ...row, current: token_hash === current })) };
  }

  async revokeOtherSessions(user: AuthUser, current: string) {
    await this.db.deleteFrom("auth_sessions").where("user_id", "=", user.id).where("token_hash", "!=", current).execute();
    return { revoked: true };
  }

  async me(user: AuthUser) {
    const memberships = await this.db.selectFrom("school_memberships as m")
      .innerJoin("schools as s", "s.id", "m.school_id")
      .select(["m.id", "m.school_id", "s.name as school_name", "m.role"])
      .where("m.user_id", "=", user.id).where("m.is_active", "=", true).execute();
    const own = await this.db.selectFrom("students").select(["id", "avatar_url"]).where("user_id", "=", user.id).execute();
    const linked = await this.db.selectFrom("guardian_relationships as gr")
      .innerJoin("parents as p", "p.id", "gr.guardian_id")
      .select("gr.student_id as id").where("p.user_id", "=", user.id).execute();
    const ids = new Set([...own, ...linked].map((row) => row.id));
    const isReferenceInstitutionDemo = config().DEMO_MODE
      && Boolean(user.active_school_id)
      && institutionDemoUsernames.has(user.username);
    return {
      user: { ...publicUser(user), avatar_url: own[0]?.avatar_url || user.avatar_url || null },
      students: [...ids].map((id) => ({ id })),
      memberships,
      institution_setup_required: !isReferenceInstitutionDemo && memberships.some(m=>m.role==='admin') && Boolean((await sql`SELECT 1 FROM institution_activation_states state
        JOIN school_memberships membership ON membership.school_id=state.school_id
        WHERE membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active AND state.status<>'active'
          AND (${user.active_school_id ?? null}::uuid IS NULL OR state.school_id=${user.active_school_id ?? null}::uuid)
        LIMIT 1`.execute(this.db)).rows.length),
      company_operator: (await sql`SELECT 1 FROM company_operators WHERE user_id=${user.id}::uuid AND is_active`.execute(this.db)).rows.length>0,
      permission_grants: [],
      school_permissions: await Promise.all(memberships.map(async m => ({school_id:m.school_id,...await this.roles.effective(user,m.school_id)}))),
      demo_mode: config().DEMO_MODE,
    };
  }

  async proFeatures(user: AuthUser) {
    return { enabled: await proFeaturesEnabled(this.db, user.id), preview: true };
  }

  async setProFeatures(user: AuthUser, body: unknown, request: FastifyRequest) {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(body);
    const previous = await proFeaturesEnabled(this.db, user.id);
    if (previous !== enabled) {
      await this.db.transaction().execute(async tx => {
        await sql`UPDATE users SET pro_features_enabled=${enabled},updated_at=now() WHERE id=${user.id}::uuid AND is_active`.execute(tx);
        if (!enabled) {
          await sql`UPDATE agent_actions action SET status='rejected',finished_at=now()
            WHERE action.status='pending' AND action.run_id IN (
              SELECT run.id FROM agent_runs run JOIN agent_threads thread ON thread.id=run.thread_id
              WHERE thread.owner_id=${user.id}::uuid
            )`.execute(tx);
          await sql`UPDATE agent_runs run SET status='completed',progress='Dismissed',
              answer='This pending action was dismissed when Pro features were turned off.',finished_at=now()
            WHERE run.status='confirmation' AND run.thread_id IN (
              SELECT id FROM agent_threads WHERE owner_id=${user.id}::uuid
            )`.execute(tx);
          await sql`UPDATE agent_runs run SET status='cancelled',progress='Cancelled',
              answer='This request stopped when Pro features were turned off. No pending action was executed.',finished_at=now()
            WHERE run.status='running' AND run.thread_id IN (
              SELECT id FROM agent_threads WHERE owner_id=${user.id}::uuid
            )`.execute(tx);
        }
      });
      await this.audit.record({ action: 'auth.pro_features.changed', request, actorId: user.id, targetType: 'user', targetId: user.id, metadata: { enabled } });
    }
    return { enabled, preview: true };
  }

  response(user: AuthUser, csrfToken: string) {
    return {
      user: publicUser(user),
      csrf_token: csrfToken,
      demo_mode: config().DEMO_MODE,
      demo_profile_switcher: this.canUseDemoProfileSwitcher(user),
    };
  }
}

export { publicUser };
