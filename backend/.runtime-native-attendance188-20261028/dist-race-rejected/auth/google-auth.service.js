var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { sql } from "kysely";
import { z } from "zod";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { AuditService } from "../common/audit.service.js";
import { ProgressiveWorkspaceProvisioner } from "../institution-onboarding/progressive-workspace.provisioner.js";
import { hashPassword } from "./password.js";
const credentialSchema = z.object({ credential: z.string().min(1).max(16384) }).strict();
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function validateGoogleIdentity(payload, nonce) {
    const claims = payload;
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
let GoogleAuthService = class GoogleAuthService {
    db;
    audit;
    progressiveWorkspaces;
    client = new OAuth2Client();
    constructor(db, audit, progressiveWorkspaces) {
        this.db = db;
        this.audit = audit;
        this.progressiveWorkspaces = progressiveWorkspaces;
    }
    async issueNonce() {
        const nonce = randomBytes(32).toString("base64url");
        await sql `DELETE FROM auth_google_nonces WHERE expires_at < now()`.execute(this.db);
        await sql `INSERT INTO auth_google_nonces(nonce_hash, expires_at) VALUES(${digest(nonce)}, now()+interval '10 minutes')`.execute(this.db);
        return nonce;
    }
    async login(body, nonce, request) {
        if (!config().GOOGLE_CLIENT_ID)
            throw new NotFoundException();
        const { credential } = credentialSchema.parse(body);
        if (!nonce)
            throw new UnauthorizedException("Google sign-in expired. Refresh the page and try again.");
        let identity;
        try {
            // Official library verifies Google's signature, issuer, audience and expiry.
            const ticket = await this.client.verifyIdToken({ idToken: credential, audience: config().GOOGLE_CLIENT_ID });
            identity = validateGoogleIdentity(ticket.getPayload(), nonce);
        }
        catch (error) {
            await this.audit.record({ action: "auth.google.failed", request });
            if (error instanceof UnauthorizedException)
                throw error;
            throw new UnauthorizedException("Google sign-in could not be verified. Please try again.");
        }
        // Consume outside the account transaction: a verified token is single-use even
        // if account linking subsequently fails. The nonce must also match the signed cookie.
        const consumed = await sql `DELETE FROM auth_google_nonces WHERE nonce_hash=${digest(nonce)} AND expires_at>now() RETURNING nonce_hash`.execute(this.db);
        if (!consumed.rows.length)
            throw new UnauthorizedException("Google sign-in expired or was already used. Please try again.");
        const result = await this.db.transaction().execute(async (db) => {
            // Serialize first sign-in races for the same identity/email across instances.
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${identity.subject}, 0))`.execute(db);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${identity.email}, 1))`.execute(db);
            const link = (await sql `SELECT user_id FROM auth_google_identities WHERE subject=${identity.subject}`.execute(db)).rows[0];
            if (link) {
                const account = await db.selectFrom("users").selectAll().where("id", "=", link.user_id).executeTakeFirst();
                if (!account?.is_active)
                    throw new UnauthorizedException("This account is unavailable.");
                // A changed Google email must never move this identity to another account.
                return { account, activeSchoolId: null };
            }
            let account = await db.selectFrom("users").selectAll().where(sql `lower(email)=${identity.email}`).forUpdate().executeTakeFirst();
            let activeSchoolId = null;
            if (account) {
                if (!account.is_active)
                    throw new UnauthorizedException("This account is unavailable.");
                const existing = await sql `SELECT 1 FROM auth_google_identities WHERE user_id=${account.id}::uuid`.execute(db);
                if (existing.rows.length)
                    throw new UnauthorizedException("This account is linked to another Google account. Use your password to sign in.");
                // First authoritative email proof must not leave pre-existing sessions active.
                await db.deleteFrom("auth_sessions").where("user_id", "=", account.id).execute();
                account = await db.updateTable("users").set({ email_verified_at: account.email_verified_at ?? new Date() })
                    .where("id", "=", account.id).returningAll().executeTakeFirstOrThrow();
            }
            else {
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
            await sql `INSERT INTO auth_google_identities(subject,user_id) VALUES(${identity.subject},${account.id}::uuid)`.execute(db);
            return { account, activeSchoolId };
        });
        const user = { ...result.account, active_school_id: result.activeSchoolId };
        await this.audit.record({ action: "auth.google.verified", request, actorId: user.id });
        return user;
    }
};
GoogleAuthService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, AuditService,
        ProgressiveWorkspaceProvisioner])
], GoogleAuthService);
export { GoogleAuthService };
//# sourceMappingURL=google-auth.service.js.map