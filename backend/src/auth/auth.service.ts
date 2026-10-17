import { RolesService } from "../roles/roles.service.js";
import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { config } from "../config.js";
import { AuditService } from "../common/audit.service.js";
import { deliverAccountAction } from "../common/account-email.js";
import type { AuthUser } from "../common/request.js";
import {
  TRANSIENT_EXECUTION_RUN_CATALOG,
  type TransientExecutionRunCatalog,
} from "../campus-model-core/transient-execution-run.contracts.js";
import { DatabaseService } from "../database/database.service.js";
import {
  ExecutionDataPlaneError,
  ExecutionDataPlaneRegistry,
} from "../database/execution-data-plane.js";
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
import {
  liveSessionExecutionEnvironment,
  simulationSessionExecutionEnvironment,
  unavailableSimulationSessionExecutionEnvironment,
  type ExecutionEnvironmentView,
  type ResolvedSessionExecutionEnvironment,
} from "./session-execution-environment.js";

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
const selectExecutionEnvironmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("live") }).strict(),
  z.object({ mode: z.literal("simulation"), run_id: z.string().uuid() }).strict(),
]);
const demoUsernames = {
  student: "aarav.student",
  parent: "pooja.parent",
  staff: "kavita.staff",
  admin: "meera.principal",
  school_admin: "arjun.admin",
  company: "company.demo",
} as const;
const institutionDemoUsernames = new Set<string>(Object.values(demoUsernames).filter((username) => username !== demoUsernames.company));

export interface SessionIdentity {
  user: AuthUser;
  tokenHash: string;
  csrfToken: string;
  publicDemo: boolean;
  executionEnvironment: ResolvedSessionExecutionEnvironment["environment"];
  executionEnvironmentView: ExecutionEnvironmentView;
}

interface StoredExecutionEnvironmentBinding {
  school_id: string;
  scenario_id: string;
  run_id: string;
  namespace_id: string;
  expires_at: Date | string;
}

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
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly roles: RolesService,
    @Optional()
    @Inject(TRANSIENT_EXECUTION_RUN_CATALOG)
    private readonly transientRuns?: TransientExecutionRunCatalog,
    @Optional()
    private readonly executionDataPlanes?: ExecutionDataPlaneRegistry,
  ) {}

  static tokenHash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private sweepTimer?: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;

  private async clearExecutionEnvironmentBinding(tokenHash: string): Promise<void> {
    await this.db.deleteFrom("auth_session_execution_environments")
      .where("token_hash", "=", tokenHash)
      .execute();
  }

  private async resolveSelectedExecutionEnvironment(input: {
    tokenHash: string;
    user: AuthUser;
    binding: StoredExecutionEnvironmentBinding | null;
  }): Promise<ResolvedSessionExecutionEnvironment> {
    const live = () => liveSessionExecutionEnvironment(input.user.active_school_id);
    if (!input.binding) return live();
    const unavailable = (
      reason: Parameters<typeof unavailableSimulationSessionExecutionEnvironment>[1],
    ) => unavailableSimulationSessionExecutionEnvironment(input.binding!, reason);
    const bindingExpiry = new Date(input.binding.expires_at).getTime();
    if (!Number.isFinite(bindingExpiry)
      || !input.user.active_school_id
      || input.binding.school_id !== input.user.active_school_id) return unavailable("binding_invalid");
    if (bindingExpiry <= Date.now()) return unavailable("expired");
    if (!this.transientRuns || !this.executionDataPlanes) return unavailable("runtime_unavailable");

    try {
      const run = await this.transientRuns.resolveAuthorizedRun({
        actor_id: input.user.id,
        institution_id: input.binding.school_id,
        run_id: input.binding.run_id,
      });
      if (!run) return unavailable("run_unavailable");
      if (run.scenario_id !== input.binding.scenario_id
        || run.namespace_id !== input.binding.namespace_id) return unavailable("run_unavailable");
      if (Date.parse(run.expires_at) <= Date.now()) return unavailable("expired");
      const coverage = this.executionDataPlanes.assertReady({
        institutionId: run.institution_id,
        runId: run.run_id,
        namespaceId: run.namespace_id,
      });
      if (coverage.scenario_id !== run.scenario_id || coverage.expires_at !== run.expires_at) {
        return unavailable("data_plane_unavailable");
      }
      return simulationSessionExecutionEnvironment(run, {
        manifest_ref: coverage.manifest_ref,
        checked_at: coverage.checked_at,
      });
    } catch (error) {
      if (error instanceof ExecutionDataPlaneError) return unavailable("data_plane_unavailable");
      if (error instanceof ForbiddenException) return unavailable("authorization_lost");
      if (error instanceof NotFoundException) return unavailable("run_unavailable");
      throw error;
    }
  }

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
      .leftJoin("auth_session_execution_environments as environment", "environment.token_hash", "s.token_hash")
      .select([
        "s.token_hash", "s.csrf_token", "s.expires_at", "s.last_seen_at", "s.active_school_id", "s.is_public_demo",
        "u.id", "u.username", "u.email", "u.first_name", "u.last_name", "u.avatar_url", "u.role", "u.is_active", "u.email_verified_at",
        "environment.school_id as environment_school_id",
        "environment.scenario_id as environment_scenario_id",
        "environment.run_id as environment_run_id",
        "environment.namespace_id as environment_namespace_id",
        "environment.expires_at as environment_expires_at",
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
    const user: AuthUser = {
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
    };
    const selected = await this.resolveSelectedExecutionEnvironment({
      tokenHash,
      user,
      binding: row.environment_run_id ? {
        school_id: row.environment_school_id!,
        scenario_id: row.environment_scenario_id!,
        run_id: row.environment_run_id,
        namespace_id: row.environment_namespace_id!,
        expires_at: row.environment_expires_at!,
      } : null,
    });
    return {
      tokenHash,
      csrfToken: row.csrf_token,
      publicDemo: row.is_public_demo,
      user,
      executionEnvironment: selected.environment,
      executionEnvironmentView: selected.view,
    };
  }

  async hostedCampusSimulatorUser(username: string): Promise<AuthUser | null> {
    if (!config().HOSTED_CAMPUS_SIMULATOR_ENABLED || config().DEPLOYMENT_ENVIRONMENT !== "stage") return null;
    if (!/^[a-z0-9._-]{3,80}$/i.test(username)) return null;
    const row = await this.db.selectFrom("users as u")
      .innerJoin("school_memberships as m", "m.user_id", "u.id")
      .innerJoin("schools as s", "s.id", "m.school_id")
      .select([
        "u.id", "u.username", "u.email", "u.first_name", "u.last_name", "u.avatar_url", "u.role", "u.is_active", "u.email_verified_at",
        "m.school_id",
      ])
      .where(sql<boolean>`lower(u.username) = ${username.toLowerCase()}`)
      .where("u.is_active", "=", true)
      .where("m.is_active", "=", true)
      .where("s.code", "=", "cis")
      .where(sql<boolean>`lower(u.email) like ${"%@example.test"}`)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id, username: row.username, email: row.email, first_name: row.first_name, last_name: row.last_name,
      avatar_url: row.avatar_url, role: row.role, is_active: row.is_active, email_verified_at: row.email_verified_at,
      active_school_id: row.school_id,
    };
  }

  async createSession(user: AuthUser, request: FastifyRequest, options: { publicDemo?: boolean; ttlSeconds?: number } = {}): Promise<{ rawToken: string; csrfToken: string }> {
    if (!user.active_school_id) {
      const memberships = await this.db.selectFrom('school_memberships').select('school_id')
        .where('user_id','=',user.id).where('is_active','=',true).limit(2).execute();
      // Only an unambiguous authenticated membership may establish tenant context.
      if (memberships.length === 1) user.active_school_id = memberships[0]!.school_id;
    }
    const rawToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + (options.ttlSeconds ?? config().SESSION_TTL_SECONDS) * 1000);
    const ipHash = createHash("sha256").update(request.ip).digest("hex");
    await this.db.insertInto("auth_sessions").values({
      token_hash: AuthService.tokenHash(rawToken),
      user_id: user.id,
      active_school_id: user.active_school_id ?? null,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      ip_hash: ipHash,
      user_agent: String(request.headers["user-agent"] ?? "").slice(0, 500),
      is_public_demo: options.publicDemo ?? false,
    }).execute();
    return { rawToken, csrfToken };
  }

  async publicDemoUser(role: DemoSwitchRole, request: FastifyRequest): Promise<AuthUser> {
    if (!config().PUBLIC_DEMO_ENABLED) throw new (await import("@nestjs/common")).NotFoundException();
    const ipBucket = AuthService.tokenHash(`public-demo:${request.ip}`);
    const globalBucket = AuthService.tokenHash("public-demo:global");
    const hit = async (bucket: string) => (await sql<{ hits: number }>`INSERT INTO api_rate_limit_buckets(bucket_key,hits,expires_at)
      VALUES(${bucket},1,now()+interval '1 hour') ON CONFLICT(bucket_key) DO UPDATE SET
      hits=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN 1 ELSE api_rate_limit_buckets.hits+1 END,
      expires_at=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
      RETURNING hits`.execute(this.db)).rows[0]!.hits;
    const [clientHits, globalHits] = await Promise.all([hit(ipBucket), hit(globalBucket)]);
    if (clientHits > config().PUBLIC_DEMO_MAX_STARTS_PER_HOUR || globalHits > 500) {
      throw new HttpException("The public demo is busy. Please try again later.", 429);
    }
    return this.demoProfile(role);
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
    await sql`DELETE FROM api_rate_limit_buckets WHERE bucket_key=${accountBucket}`.execute(this.db);
    return this.finishPrimaryLogin(user, request);
  }

  async finishPrimaryLogin(user: AuthUser, request: FastifyRequest): Promise<{ user: AuthUser; mfaChallenge?: string }> {
    const factor = await sql<{ active: boolean }>`SELECT status='active' AS active FROM auth_mfa_factors WHERE user_id=${user.id}::uuid`.execute(this.db);
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
    const issuer = "ThatCampus";
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

  async returnSessionToLive(tokenHash: string): Promise<void> {
    await this.clearExecutionEnvironmentBinding(tokenHash);
  }

  async selectSchool(user: AuthUser, sessionHash: string, body: unknown) {
    const { school_id } = z.object({ school_id: z.string().uuid() }).parse(body);
    const membership = await this.db.selectFrom("school_memberships").select("id").where("user_id", "=", user.id)
      .where("school_id", "=", school_id).where("is_active", "=", true).executeTakeFirst();
    if (!membership) throw new ForbiddenException("An active membership in the selected school is required.");
    await this.db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom("auth_session_execution_environments")
        .where("token_hash", "=", sessionHash)
        .execute();
      await transaction.updateTable("auth_sessions").set({ active_school_id: school_id })
        .where("token_hash", "=", sessionHash)
        .where("user_id", "=", user.id)
        .execute();
    });
    return {
      active_school_id: school_id,
      execution_environment: liveSessionExecutionEnvironment(school_id).view,
    };
  }

  async currentExecutionEnvironment(user: AuthUser, sessionHash: string) {
    const row = await this.db.selectFrom("auth_sessions as session")
      .leftJoin("auth_session_execution_environments as environment", "environment.token_hash", "session.token_hash")
      .select([
        "session.active_school_id",
        "environment.school_id as environment_school_id",
        "environment.scenario_id as environment_scenario_id",
        "environment.run_id as environment_run_id",
        "environment.namespace_id as environment_namespace_id",
        "environment.expires_at as environment_expires_at",
      ])
      .where("session.token_hash", "=", sessionHash)
      .where("session.user_id", "=", user.id)
      .where("session.expires_at", ">", new Date())
      .executeTakeFirst();
    if (!row) throw new UnauthorizedException("The active authenticated session is unavailable.");
    const selected = await this.resolveSelectedExecutionEnvironment({
      tokenHash: sessionHash,
      user: { ...user, active_school_id: row.active_school_id },
      binding: row.environment_run_id ? {
        school_id: row.environment_school_id!,
        scenario_id: row.environment_scenario_id!,
        run_id: row.environment_run_id,
        namespace_id: row.environment_namespace_id!,
        expires_at: row.environment_expires_at!,
      } : null,
    });
    return { execution_environment: selected.view };
  }

  async selectExecutionEnvironment(
    user: AuthUser,
    sessionHash: string,
    rawInput: unknown,
    request: FastifyRequest,
  ) {
    const input = selectExecutionEnvironmentSchema.parse(rawInput);
    const session = await this.db.selectFrom("auth_sessions")
      .select(["active_school_id", "is_public_demo", "expires_at"])
      .where("token_hash", "=", sessionHash)
      .where("user_id", "=", user.id)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();
    if (!session) throw new UnauthorizedException("The active authenticated session is unavailable.");
    if (session.is_public_demo) {
      throw new ForbiddenException("The public demo cannot activate a transient Simulation environment.");
    }

    if (input.mode === "live") {
      const previous = await this.db.deleteFrom("auth_session_execution_environments")
        .where("token_hash", "=", sessionHash)
        .returning(["school_id", "run_id", "namespace_id"])
        .executeTakeFirst();
      await this.audit.record({
        action: "auth.execution_environment.returned_live",
        request,
        actorId: user.id,
        schoolId: session.active_school_id,
        targetType: "simulation_run",
        targetId: previous?.run_id ?? null,
        metadata: previous ? { namespace_id: previous.namespace_id } : { already_live: true },
      });
      return { execution_environment: liveSessionExecutionEnvironment(session.active_school_id).view };
    }

    const schoolId = session.active_school_id;
    if (!schoolId || user.active_school_id !== schoolId) {
      throw new ConflictException("Select an institution before entering Simulation.");
    }
    const administrator = await this.db.selectFrom("school_memberships")
      .select("id")
      .where("school_id", "=", schoolId)
      .where("user_id", "=", user.id)
      .where("role", "=", "admin")
      .where("is_active", "=", true)
      .executeTakeFirst();
    if (!administrator) {
      throw new ForbiddenException("An active institution administrator membership is required.");
    }
    if (!this.transientRuns || !this.executionDataPlanes) {
      throw new ConflictException("Simulation activation is unavailable until the isolated application data plane is ready.");
    }
    const run = await this.transientRuns.resolveAuthorizedRun({
      actor_id: user.id,
      institution_id: schoolId,
      run_id: input.run_id,
    });
    if (!run || Date.parse(run.expires_at) <= Date.now()) {
      throw new GoneException("Simulation run not found or expired.");
    }

    let selected: ResolvedSessionExecutionEnvironment;
    try {
      const coverage = this.executionDataPlanes.assertReady({
        institutionId: schoolId,
        runId: run.run_id,
        namespaceId: run.namespace_id,
      });
      if (coverage.scenario_id !== run.scenario_id || coverage.expires_at !== run.expires_at) {
        throw new ExecutionDataPlaneError(
          "data_plane_identity_mismatch",
          "The isolated data plane does not match the selected scenario run.",
          coverage,
        );
      }
      selected = simulationSessionExecutionEnvironment(run, {
        manifest_ref: coverage.manifest_ref,
        checked_at: coverage.checked_at,
      });
    } catch (error) {
      if (error instanceof ExecutionDataPlaneError) {
        throw new ConflictException({
          message: "This Simulation run cannot be opened in the application until its isolated data plane has full module parity.",
          code: error.code,
          missing_modules: error.descriptor?.missing_modules ?? [],
          incomplete_capabilities: error.descriptor?.incomplete_capabilities ?? [],
          unsafe_effects: error.descriptor?.unsafe_effects ?? [],
        });
      }
      throw error;
    }

    await this.db.transaction().execute(async (transaction) => {
      const stillActive = await transaction.selectFrom("auth_sessions")
        .select("token_hash")
        .where("token_hash", "=", sessionHash)
        .where("user_id", "=", user.id)
        .where("active_school_id", "=", schoolId)
        .where("expires_at", ">", new Date())
        .executeTakeFirst();
      if (!stillActive) throw new UnauthorizedException("The active authenticated session changed. Try again.");
      await transaction.insertInto("auth_session_execution_environments").values({
        token_hash: sessionHash,
        school_id: schoolId,
        scenario_id: run.scenario_id,
        run_id: run.run_id,
        namespace_id: run.namespace_id,
        expires_at: new Date(run.expires_at),
        bound_by: user.id,
      }).onConflict((conflict) => conflict.column("token_hash").doUpdateSet({
        school_id: schoolId,
        scenario_id: run.scenario_id,
        run_id: run.run_id,
        namespace_id: run.namespace_id,
        expires_at: new Date(run.expires_at),
        bound_by: user.id,
        bound_at: new Date(),
      })).execute();
    });
    await this.audit.record({
      action: "auth.execution_environment.entered_simulation",
      request,
      actorId: user.id,
      schoolId,
      targetType: "simulation_run",
      targetId: run.run_id,
      metadata: {
        scenario_id: run.scenario_id,
        namespace_id: run.namespace_id,
        source_snapshot_ref: run.source_snapshot_ref,
        expires_at: run.expires_at,
      },
    });
    return { execution_environment: selected.view };
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

  response(
    user: AuthUser,
    csrfToken: string,
    executionEnvironment: ExecutionEnvironmentView = liveSessionExecutionEnvironment(user.active_school_id).view,
  ) {
    return {
      user: publicUser(user),
      csrf_token: csrfToken,
      demo_mode: config().DEMO_MODE,
      demo_profile_switcher: this.canUseDemoProfileSwitcher(user),
      execution_environment: executionEnvironment,
    };
  }
}

export { publicUser };
