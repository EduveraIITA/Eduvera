import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { sql } from "kysely";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { AuditService } from "../common/audit.service.js";
import type { AuthUser } from "../common/request.js";
import { ProgressiveWorkspaceProvisioner } from "../institution-onboarding/progressive-workspace.provisioner.js";
import { hashPassword } from "./password.js";

const credentialSchema = z.object({ credential: z.string().min(1).max(16384) }).strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function validateGoogleIdentity(payload: TokenPayload | undefined, nonce: string) {
  const claims = payload as (TokenPayload & { nonce?: string }) | undefined;
  if (!claims?.sub || claims.nonce !== nonce || claims.email_verified !== true || !claims.email) {
    throw new UnauthorizedException("Google sign-in could not be verified. Please try again.");
  }
  const email = z.string().email().max(254).parse(claims.email.toLowerCase());
  // Google is not authoritative for third-party mailboxes, even with email_verified.
  // Do not silently link an existing school account using such an address.
  if (!email.endsWith("@gmail.com") && !claims.hd) {
    throw new UnauthorizedException("Use your password for this email address. Google sign-in supports Gmail and Google Workspace accounts.");
  }
  return { subject: claims.sub, email, firstName: (claims.given_name || "").slice(0, 150), lastName: (claims.family_name || "").slice(0, 150) };
}

@Injectable()
export class GoogleAuthService {
  private readonly client = new OAuth2Client();
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService,
    private readonly progressiveWorkspaces: ProgressiveWorkspaceProvisioner) {}

  async issueNonce(ttlSeconds = 600): Promise<string> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) throw new Error("Invalid Google nonce lifetime.");
    const nonce = randomBytes(32).toString("base64url");
    await sql`DELETE FROM auth_google_nonces WHERE expires_at < now()`.execute(this.db);
    await sql`INSERT INTO auth_google_nonces(nonce_hash, expires_at) VALUES(${digest(nonce)}, now()+(${ttlSeconds} * interval '1 second'))`.execute(this.db);
    return nonce;
  }

  async hasNonce(nonce: string): Promise<boolean> {
    return (await sql`SELECT 1 FROM auth_google_nonces WHERE nonce_hash=${digest(nonce)} AND expires_at>now()`.execute(this.db)).rows.length > 0;
  }

  async consumeNonce(nonce: string): Promise<boolean> {
    return (await sql`DELETE FROM auth_google_nonces WHERE nonce_hash=${digest(nonce)} AND expires_at>now() RETURNING nonce_hash`.execute(this.db)).rows.length > 0;
  }

  async resolveNativeAccount(userId: string, activeSchoolId: string | null): Promise<AuthUser> {
    const account = await this.db.selectFrom("users").selectAll().where("id", "=", userId).where("is_active", "=", true).executeTakeFirst();
    if (!account) throw new UnauthorizedException("This account is unavailable. Start sign-in again.");
    if (activeSchoolId && !await this.db.selectFrom("school_memberships").select("school_id").where("user_id", "=", userId).where("school_id", "=", activeSchoolId).where("is_active", "=", true).executeTakeFirst()) throw new UnauthorizedException("Your campus access changed. Start sign-in again.");
    return { ...account, active_school_id: activeSchoolId };
  }

  async login(body: unknown, nonce: string | undefined, request: FastifyRequest): Promise<AuthUser> {
    if (!config().GOOGLE_CLIENT_ID) throw new NotFoundException();
    const { credential } = credentialSchema.parse(body);
    if (!nonce) throw new UnauthorizedException("Google sign-in expired. Refresh the page and try again.");
    let identity: ReturnType<typeof validateGoogleIdentity>;
    try {
      // Official library verifies Google's signature, issuer, audience and expiry.
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: config().GOOGLE_CLIENT_ID });
      identity = validateGoogleIdentity(ticket.getPayload(), nonce);
    } catch (error) {
      await this.audit.record({ action: "auth.google.failed", request });
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Google sign-in could not be verified. Please try again.");
    }
    // Consume outside the account transaction: a verified token is single-use even
    // if account linking subsequently fails. The nonce must also match the signed cookie.
    if (!await this.consumeNonce(nonce)) throw new UnauthorizedException("Google sign-in expired or was already used. Please try again.");
    const result = await this.db.transaction().execute(async db => {
      // Serialize first sign-in races for the same identity/email across instances.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity.subject}, 0))`.execute(db);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity.email}, 1))`.execute(db);
      const link = (await sql<{ user_id: string }>`SELECT user_id FROM auth_google_identities WHERE subject=${identity.subject}`.execute(db)).rows[0];
      if (link) {
        const account = await db.selectFrom("users").selectAll().where("id", "=", link.user_id).executeTakeFirst();
        if (!account?.is_active) throw new UnauthorizedException("This account is unavailable.");
        // A changed Google email must never move this identity to another account.
        return { account, activeSchoolId: null };
      }
      let account = await db.selectFrom("users").selectAll().where(sql<boolean>`lower(email)=${identity.email}`).forUpdate().executeTakeFirst();
      let activeSchoolId: string | null = null;
      if (account) {
        if (!account.is_active) throw new UnauthorizedException("This account is unavailable.");
        const existing = await sql`SELECT 1 FROM auth_google_identities WHERE user_id=${account.id}::uuid`.execute(db);
        if (existing.rows.length) throw new UnauthorizedException("This account is linked to another Google account. Use your password to sign in.");
        // First authoritative email proof must not leave pre-existing sessions active.
        await db.deleteFrom("auth_sessions").where("user_id", "=", account.id).execute();
        account = await db.updateTable("users").set({ email_verified_at: account.email_verified_at ?? new Date() })
          .where("id", "=", account.id).returningAll().executeTakeFirstOrThrow();
      } else {
        account = await db.insertInto("users").values({
          username: `google.${digest(identity.subject).slice(0, 32)}`,
          email: identity.email,
          first_name: identity.firstName,
          last_name: identity.lastName,
          // No known password is created. A new self-created account receives only
          // its own private provisional workspace below; access inside another
          // campus is still controlled by that campus's invitation flow.
          password_hash: await hashPassword(randomBytes(48).toString("base64url")),
          role: "admin",
          email_verified_at: new Date(),
        }).returningAll().executeTakeFirstOrThrow();
        activeSchoolId = await this.progressiveWorkspaces.createForAccount(db, account, "UTC");
      }
      await sql`INSERT INTO auth_google_identities(subject,user_id) VALUES(${identity.subject},${account.id}::uuid)`.execute(db);
      return { account, activeSchoolId };
    });
    const user: AuthUser = { ...result.account, active_school_id: result.activeSchoolId };
    await this.audit.record({ action: "auth.google.verified", request, actorId: user.id });
    return user;
  }
}
