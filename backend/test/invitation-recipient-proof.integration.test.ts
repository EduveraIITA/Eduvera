import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import * as settingsModule from "../src/config.js";
import * as transport from "../src/common/email-transport.js";
import { DatabaseService } from "../src/database/database.service.js";
import { privacySafeSimulationRow } from "../src/database/simulation-snapshot-store.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { PersonAccountInvitationsService } from "../src/operations/person-account-invitations.service.js";
import { invitationRecipientProofHash, invitationRecipientProofMatches } from "../src/operations/invitation-recipient-proof.js";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const password = "Synthet1c!Mailbox-Forest-River2026";
afterEach(() => vi.restoreAllMocks());

describe("recipient proof cryptographic separation", () => {
  it("binds a six-digit mailbox proof to the exact invitation and current credential", () => {
    vi.spyOn(settingsModule, "config").mockReturnValue({ COOKIE_SECRET: "test-recipient-cookie-secret-at-least-32" } as ReturnType<typeof settingsModule.config>);
    const id = randomUUID(), code = "012345", tokenHash = "a".repeat(64);
    const hash = invitationRecipientProofHash(id, tokenHash, code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitationRecipientProofMatches(hash, id, tokenHash, code)).toBe(true);
    expect(invitationRecipientProofMatches(hash, randomUUID(), tokenHash, code)).toBe(false);
    expect(invitationRecipientProofMatches(hash, id, "b".repeat(64), code)).toBe(false);
    expect(invitationRecipientProofMatches(hash, id, tokenHash, "123456")).toBe(false);
    expect(invitationRecipientProofMatches(hash, id, tokenHash, undefined)).toBe(false);
    expect(invitationRecipientProofMatches("invalid", id, tokenHash, code)).toBe(false);
  });
  it("does not carry a Live recipient-proof hash into a Simulation snapshot", () => {
    const source = "a".repeat(64);
    const safe = privacySafeSimulationRow({ recipient_proof_hash: source }, "redaction-seed") as { recipient_proof_hash: string };
    expect(safe.recipient_proof_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(safe.recipient_proof_hash).not.toBe(source);
  });
  it("refuses Simulation before any credential lookup, write or email", async () => {
    const db = { transaction: vi.fn() };
    const operations = new OperationsService(db as never, {} as never);
    await executionEnvironmentStorage.run({ kind: "simulation" } as never, async () => {
      await expect(operations.recipientProof({ email: "synthetic@example.test", token: "012345" })).rejects.toThrow(/managed in Live/);
      await expect(operations.acceptInvite({})).rejects.toThrow(/managed in Live/);
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe.runIf(isolated)("neutral member recipient proof against isolated PostgreSQL", () => {
  let db: DatabaseService;
  let core: CampusModelCoreService;
  let people: ParticipationPeopleService;
  let operations: OperationsService;
  beforeAll(() => {
    requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    db = new DatabaseService();
    core = new CampusModelCoreService(db);
    const invitations = new PersonAccountInvitationsService(db, core, core, core);
    operations = new OperationsService(db, {} as never, invitations);
    people = new ParticipationPeopleService(db, new SchoolEventService(db, core), core, core, core, core);
  });
  afterAll(async () => { await db?.destroy(); });

  async function fixture(existingAccount: "verified" | "unverified" | null = null) {
    const suffix = randomUUID();
    const owner = await db.insertInto("users").values({ username: `proof-owner-${suffix}`,
      email: `proof-owner-${suffix}@example.test`, password_hash: await hashPassword(password),
      first_name: "Synthetic", last_name: "Owner", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, owner, "Asia/Kolkata"));
    const user: AuthUser = { ...owner, active_school_id: schoolId };
    const person = await people.create({ authUser: user, requestId: randomUUID() } as AuthenticatedRequest, schoolId,
      { first_name: "Synthetic invited person", last_name: "", idempotency_key: randomUUID() });
    const email = `proof-recipient-${suffix}@example.test`;
    if (existingAccount) await db.insertInto("users").values({ username: `proof-recipient-${suffix}`, email,
      password_hash: await hashPassword(password), first_name: "Existing name", last_name: "", role: "member",
      email_verified_at: existingAccount === "verified" ? new Date() : null }).execute();
    const settings = settingsModule.config();
    const configSpy = vi.spyOn(settingsModule, "config").mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: false });
    const invite = await operations.invite(user, schoolId, { role: "member", person_id: person.id, email, idempotency_key: randomUUID() });
    configSpy.mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true });
    let code = "";
    const mail = vi.spyOn(transport, "sendTransactionalEmail").mockImplementation(input => {
      expect(input.to).toBe(email);
      expect(input.text).not.toMatch(/https?:/);
      code = /Your confirmation code is:\s*(\d{6})/.exec(input.text)![1]!;
      return Promise.resolve();
    });
    const accept = (extra: Record<string, unknown> = {}) => operations.acceptInvite({ email, token: invite.token,
      password, first_name: "One Complete Name", ...extra });
    return { user, schoolId, person, email, invite, configSpy, settings, mail, accept,
      proof: () => operations.recipientProof({ email, token: invite.token }), code: () => code };
  }

  it("refuses forwarded invitation-only joining, then uses independent mail proof and one Name", async () => {
    const f = await fixture();
    await expect(f.accept()).rejects.toThrow(/separate code/);
    expect(await db.selectFrom("users").select("id").where("email", "=", f.email).executeTakeFirst()).toBeUndefined();
    const response = await f.proof();
    expect(response).toMatchObject({ campus: { id: f.schoolId }, verification_required: true, delivery: "email_accepted" });
    expect(JSON.stringify(response)).not.toContain(f.code());
    expect(f.code()).not.toBe(f.invite.token);
    const stored = await db.selectFrom("school_invitations").select(["recipient_proof_hash", "recipient_proof_expires_at", "recipient_proof_sent_at", "expires_at"])
      .where("id", "=", f.invite.id).executeTakeFirstOrThrow();
    expect(stored.recipient_proof_hash).not.toBe(f.code());
    expect(stored.recipient_proof_expires_at!.getTime()).toBeLessThanOrEqual(stored.expires_at.getTime());
    expect(stored.recipient_proof_expires_at!.getTime() - stored.recipient_proof_sent_at!.getTime()).toBeLessThanOrEqual(600_000);
    const accepted = await f.accept({ recipient_proof: f.code() });
    expect(accepted).toMatchObject({ accepted: true, school_id: f.schoolId, role: "member", accepted_user_id: expect.any(String) });
    const account = await db.selectFrom("users").select(["first_name", "last_name", "email_verified_at"]).where("id", "=", accepted.accepted_user_id).executeTakeFirstOrThrow();
    expect(account).toMatchObject({ first_name: "One Complete Name", last_name: "", email_verified_at: expect.any(Date) });
    expect(await db.selectFrom("school_invitations").select("recipient_proof_hash").where("id", "=", f.invite.id).executeTakeFirstOrThrow()).toEqual({ recipient_proof_hash: null });
    await expect(f.proof()).rejects.toThrow(/invalid, expired or already used/);
    await expect(f.accept({ recipient_proof: f.code() })).rejects.toThrow(/invalid, expired or already used/);
  });

  it("rate-limits resends without rotating the still-valid code", async () => {
    const f = await fixture();
    await f.proof();
    expect(await f.proof()).toMatchObject({ delivery: "cooldown", retry_after_seconds: expect.any(Number) });
    expect(f.mail).toHaveBeenCalledTimes(1);
    const wrong = f.code() === "000000" ? "000001" : "000000";
    await expect(f.accept({ recipient_proof: wrong })).rejects.toThrow(/invalid or expired/);
    await expect(f.accept({ recipient_proof: f.code() })).resolves.toMatchObject({ accepted: true });
  });

  it("fails closed when email is disabled even in DEMO mode", async () => {
    const f = await fixture();
    f.configSpy.mockReturnValue({ ...f.settings, INVITATION_EMAIL_ENABLED: false, DEMO_MODE: true });
    expect(await f.proof()).toMatchObject({ verification_required: true, delivery: "unavailable" });
    expect(f.mail).not.toHaveBeenCalled();
    await expect(f.accept({ recipient_proof: "000000" })).rejects.toThrow(/invalid or expired/);
  });

  it("clears proof on an uncertain email result without logging or returning provider errors", async () => {
    const f = await fixture();
    f.mail.mockRejectedValueOnce(new Error("private provider exception"));
    const response = await f.proof();
    expect(response).toMatchObject({ verification_required: true, delivery: "unavailable" });
    expect(JSON.stringify(response)).not.toMatch(/private provider|development_token|recipient_proof|token/);
    expect(await db.selectFrom("school_invitations").select("recipient_proof_hash").where("id", "=", f.invite.id).executeTakeFirstOrThrow()).toEqual({ recipient_proof_hash: null });
    await expect(f.accept({ recipient_proof: "000000" })).rejects.toThrow(/invalid or expired/);
  });

  it("requires proof plus current password for an unverified existing account", async () => {
    const f = await fixture("unverified");
    await expect(f.accept()).rejects.toThrow(/separate code/);
    await f.proof();
    await expect(f.accept({ recipient_proof: f.code(), password: "wrong-password" })).rejects.toThrow(/existing account password/);
    await expect(f.accept({ recipient_proof: f.code() })).resolves.toMatchObject({ accepted: true });
  });

  it("expires independent proof without consuming the still-live invitation", async () => {
    const f = await fixture();
    await f.proof();
    await sql`UPDATE school_invitations SET recipient_proof_sent_at=now()-interval '11 minutes',
      recipient_proof_expires_at=now()-interval '1 minute' WHERE id=${f.invite.id}::uuid`.execute(db);
    await expect(f.accept({ recipient_proof: f.code() })).rejects.toThrow(/invalid or expired/);
    await expect(f.proof()).resolves.toMatchObject({ delivery: "email_accepted" });
    await expect(f.accept({ recipient_proof: f.code() })).resolves.toMatchObject({ accepted: true });
  });

  it("uses the current password, not an extra code, for an already verified account", async () => {
    const f = await fixture("verified");
    expect(await f.proof()).toMatchObject({ verification_required: false, delivery: "not_required" });
    expect(f.mail).not.toHaveBeenCalled();
    await expect(f.accept({ password: "wrong-password" })).rejects.toThrow(/existing account password/);
    await expect(f.accept()).resolves.toMatchObject({ accepted: true });
  });

  it("recovers an uncertain accepted result only by explicit current-password verification, without regranting access", async () => {
    const f = await fixture();
    await f.proof();
    const accepted = await f.accept({ recipient_proof: f.code() });
    await expect(f.accept()).rejects.toThrow(/invalid, expired or already used/);
    await expect(f.accept({ recover_accepted: true, password: "not-the-password" })).rejects.toThrow(/could not be confirmed/);
    expect(await f.accept({ recover_accepted: true })).toEqual(accepted);
    expect((await db.selectFrom("school_memberships").select("id").where("school_id", "=", f.schoolId)
      .where("user_id", "=", accepted.accepted_user_id).execute())).toHaveLength(1);
    await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${f.schoolId}::uuid
      AND user_id=${accepted.accepted_user_id}::uuid`.execute(db);
    await expect(f.accept({ recover_accepted: true })).rejects.toThrow(/could not be confirmed/);
    expect(await db.selectFrom("school_memberships").select("is_active").where("school_id", "=", f.schoolId)
      .where("user_id", "=", accepted.accepted_user_id).executeTakeFirstOrThrow()).toEqual({ is_active: false });
  });

  it("does not turn a pending-result check into a new acceptance", async () => {
    const f = await fixture();
    await f.proof();
    await expect(f.accept({ recover_accepted: true, recipient_proof: f.code() })).rejects.toThrow(/not been confirmed/);
    expect(await db.selectFrom("users").select("id").where("email", "=", f.email).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("school_invitations").select("accepted_at").where("id", "=", f.invite.id).executeTakeFirstOrThrow())
      .toEqual({ accepted_at: null });
  });

  it("does not recover a retired canonical person or verify a proof after acceptance", async () => {
    const f = await fixture();
    await f.proof();
    await f.accept({ recipient_proof: f.code() });
    await sql`UPDATE school_people SET retired_at=now() WHERE school_id=${f.schoolId}::uuid AND id=${f.person.id}::uuid`.execute(db);
    await expect(f.accept({ recover_accepted: true })).rejects.toThrow(/could not be confirmed/);
    await expect(f.proof()).rejects.toThrow(/invalid, expired or already used/);
  });

  it("rejects expired, revoked, and replaced invitation credentials and clears proof when resent", async () => {
    const f = await fixture();
    await f.proof();
    await sql`UPDATE school_invitations SET created_at=now()-interval '2 minutes' WHERE id=${f.invite.id}::uuid`.execute(db);
    const resent = await operations.resendInvitation(f.user, f.schoolId, f.invite.id);
    expect(resent.token).not.toBe(f.invite.token);
    expect(await db.selectFrom("school_invitations").select(["recipient_proof_hash", "recipient_proof_sent_at"]).where("id", "=", f.invite.id).executeTakeFirstOrThrow())
      .toEqual({ recipient_proof_hash: null, recipient_proof_sent_at: null });
    await expect(f.accept({ recipient_proof: f.code() })).rejects.toThrow(/invalid, expired or already used/);
    await sql`UPDATE school_invitations SET revoked_at=now() WHERE id=${f.invite.id}::uuid`.execute(db);
    await expect(operations.recipientProof({ email: f.email, token: resent.token })).rejects.toThrow(/invalid, expired or already used/);
    const expired = await fixture();
    await sql`UPDATE school_invitations SET expires_at=now()-interval '1 second' WHERE id=${expired.invite.id}::uuid`.execute(db);
    await expect(expired.proof()).rejects.toThrow(/invalid, expired or already used/);
  });

  it("rechecks the inviter and independently caps failed confirmation requests", async () => {
    const f = await fixture();
    await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
    await expect(f.proof()).rejects.toThrow(/inviter no longer/);
    expect(f.mail).not.toHaveBeenCalled();
    const email = `unknown-${randomUUID()}@example.test`;
    for (let n = 0; n < 10; n++) await expect(operations.recipientProof({ email, token: "000000" })).rejects.toThrow(/invalid, expired or already used/);
    await expect(operations.recipientProof({ email, token: "000000" })).rejects.toThrow(/Too many confirmation requests/);
  });
});
