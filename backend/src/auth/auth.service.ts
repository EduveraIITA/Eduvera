import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { config } from "../config.js";
import { AuditService } from "../common/audit.service.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";

const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  first_name: z.string().trim().min(1).max(150),
  last_name: z.string().trim().min(1).max(150),
  role: z.enum(["student", "parent"]),
});

export interface SessionIdentity { user: AuthUser; tokenHash: string; csrfToken: string }

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    display_name: `${user.first_name} ${user.last_name}`.trim() || user.username,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

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
        "s.token_hash", "s.csrf_token", "s.expires_at", "s.last_seen_at",
        "u.id", "u.username", "u.email", "u.first_name", "u.last_name", "u.role", "u.is_active",
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
        role: row.role,
        is_active: row.is_active,
      },
    };
  }

  async createSession(user: AuthUser, request: FastifyRequest): Promise<{ rawToken: string; csrfToken: string }> {
    const rawToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + config().SESSION_TTL_SECONDS * 1000);
    const ipHash = createHash("sha256").update(request.ip).digest("hex");
    await this.db.insertInto("auth_sessions").values({
      token_hash: AuthService.tokenHash(rawToken),
      user_id: user.id,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      ip_hash: ipHash,
      user_agent: String(request.headers["user-agent"] ?? "").slice(0, 500),
    }).execute();
    return { rawToken, csrfToken };
  }

  async login(body: unknown, request: FastifyRequest): Promise<AuthUser> {
    const data = loginSchema.parse(body);
    const user = await this.db.selectFrom("users").selectAll()
      .where((eb) => eb.or([
        eb(sql`lower(email)`, "=", data.identifier.toLowerCase()),
        eb(sql`lower(username)`, "=", data.identifier.toLowerCase()),
      ])).executeTakeFirst();
    if (!user || !user.is_active || !(await verifyPassword(data.password, user.password_hash))) {
      await this.audit.record({
        action: "auth.login.failed", request,
        metadata: { identifier_hash: createHash("sha256").update(data.identifier.toLowerCase()).digest("hex") },
      });
      throw new UnauthorizedException("Invalid email/username or password.");
    }
    await this.audit.record({ action: "auth.login.succeeded", request, actorId: user.id });
    return user;
  }

  async register(body: unknown, request: FastifyRequest): Promise<AuthUser> {
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
      return user;
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("An account with this email already exists.");
      throw error;
    }
  }

  async demoUser(role: "student" | "parent" | "staff" | "admin"): Promise<AuthUser> {
    const username = { student: "aarav.student", parent: "pooja.parent", staff: "kavita.staff", admin: "meera.principal" }[role];
    const user = await this.db.selectFrom("users").selectAll().where("username", "=", username).where("is_active", "=", true).executeTakeFirst();
    if (!user) throw new UnauthorizedException("Demo data has not been seeded.");
    return user;
  }

  async logout(tokenHash: string): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("token_hash", "=", tokenHash).execute();
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
    const companyOperator = await sql`SELECT 1 FROM company_operators WHERE user_id=${user.id}::uuid`.execute(this.db);
    return {
      user: { ...publicUser(user), avatar_url: own[0]?.avatar_url || null, is_company_operator: companyOperator.rows.length > 0 },
      students: [...ids].map((id) => ({ id })),
      memberships,
      demo_mode: config().DEMO_MODE,
    };
  }

  response(user: AuthUser, csrfToken: string) {
    return { user: publicUser(user), csrf_token: csrfToken, demo_mode: config().DEMO_MODE };
  }
}

export { publicUser };
