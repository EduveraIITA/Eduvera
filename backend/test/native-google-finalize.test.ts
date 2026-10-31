import "reflect-metadata";
import { createHmac } from "node:crypto";
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  type CompiledQuery, type DatabaseConnection, type Driver, type QueryResult } from "kysely";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { base32Encode, encryptMfaSecret } from "../src/auth/mfa.js";
import type { AuditService } from "../src/common/audit.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import type { RolesService } from "../src/roles/roles.service.js";
import type { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";

vi.mock("../src/config.js", () => ({ config: () => ({ COOKIE_SECRET: "isolated-native-finalizer-fixture-secret-32-bytes", SESSION_TTL_SECONDS: 3600 }) }));

const user: AuthUser = { id: "00000000-0000-4000-8000-000000000001", username: "native.finalizer", email: "native@example.test",
  first_name: "Native", last_name: "Account", role: "staff", is_active: true, email_verified_at: new Date(), active_school_id: "00000000-0000-4000-8000-000000000002" };
const request = { ip: "127.0.0.1", headers: { "user-agent": "controlled-test" }, requestId: "00000000-0000-4000-8000-000000000003" } as unknown as FastifyRequest;
const secretBytes = Buffer.from("native-mfa-test-secret");
const secret = base32Encode(secretBytes);

function currentTotp(): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", secretBytes).update(counter).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
type Factor = { status: "pending" | "active"; encrypted_secret: Buffer; secret_iv: Buffer; secret_tag: Buffer };
function pendingFactor(): Factor {
  const encrypted = encryptMfaSecret(secret);
  return { status: "pending", encrypted_secret: encrypted.encrypted, secret_iv: encrypted.iv, secret_tag: encrypted.tag };
}
type Trace = { connection: number; sql: string; parameters: readonly unknown[] };
type Session = { row: Record<string, unknown>; activeAtCreation: boolean; connection: number };

/** A controlled database schedule, not a PostgreSQL substitute. Row waits occur
 * only for FOR UPDATE actually emitted by the production methods. Each Kysely
 * transaction owns a distinct connection and commits/rolls back staged effects. */
class LockingDriver implements Driver {
  factor: Factor | null = pendingFactor();
  accountActive = true;
  membershipActive = true;
  sessions: Session[] = [];
  challenges: Record<string, unknown>[] = [];
  audits: Record<string, unknown>[] = [];
  recoveryCodes: unknown[] = [];
  trace: Trace[] = [];
  commits = 0;
  rollbacks = 0;
  failAudit = false;
  readonly blocked = deferred<{ table: string; connection: number }>();
  private sequence = 0;
  private locks = new Map<string, FixtureConnection>();
  private releases = new Map<string, ReturnType<typeof deferred<void>>[]>();
  private pause: { kind: "activation" | "session"; entered: ReturnType<typeof deferred<void>>; resume: ReturnType<typeof deferred<void>> } | undefined;

  init() { return Promise.resolve(); }
  acquireConnection() { return Promise.resolve(new FixtureConnection(++this.sequence, this)); }
  beginTransaction(connection: DatabaseConnection) { (connection as FixtureConnection).transaction = true; return Promise.resolve(); }
  async commitTransaction(connection: DatabaseConnection) {
    const current = connection as FixtureConnection;
    for (const apply of current.effects) apply();
    current.effects = [];
    this.commits += 1;
    this.releaseLocks(current);
  }
  rollbackTransaction(connection: DatabaseConnection) {
    const current = connection as FixtureConnection;
    current.effects = [];
    this.rollbacks += 1;
    this.releaseLocks(current);
    return Promise.resolve();
  }
  releaseConnection() { return Promise.resolve(); }
  destroy() { return Promise.resolve(); }

  pauseNext(kind: "activation" | "session") {
    const pause = { kind, entered: deferred<void>(), resume: deferred<void>() };
    this.pause = pause;
    return pause;
  }
  async pauseAt(kind: "activation" | "session") {
    const pause = this.pause;
    if (pause?.kind !== kind) return;
    this.pause = undefined;
    pause.entered.resolve(undefined);
    await pause.resume.promise;
  }
  async lock(table: string, connection: FixtureConnection) {
    if (!connection.transaction) throw new Error("Row lock outside transaction.");
    while (this.locks.has(table) && this.locks.get(table) !== connection) {
      const release = deferred<void>();
      this.releases.set(table, [...(this.releases.get(table) ?? []), release]);
      this.blocked.resolve({ table, connection: connection.id });
      await release.promise;
    }
    this.locks.set(table, connection);
  }
  private releaseLocks(connection: FixtureConnection) {
    for (const [table, owner] of this.locks) {
      if (owner !== connection) continue;
      this.locks.delete(table);
      const waiting = this.releases.get(table) ?? [];
      this.releases.delete(table);
      for (const waiter of waiting) waiter.resolve(undefined);
    }
  }
  private insertedRow(sql: string, query: CompiledQuery): Record<string, unknown> {
    const columns = /^insert into \w+\s*\(([^)]+)\)/u.exec(sql)?.[1]?.split(",").map(column => column.trim());
    if (!columns) throw new Error(`Unrecognized INSERT: ${sql}`);
    return Object.fromEntries(columns.map((column, index) => [column, query.parameters[index]]));
  }
  async execute(connection: FixtureConnection, query: CompiledQuery): Promise<QueryResult<unknown>> {
    const sql = query.sql.toLowerCase().replaceAll('"', "").replace(/\s+/gu, " ").trim();
    this.trace.push({ connection: connection.id, sql, parameters: query.parameters });
    if (!connection.transaction) throw new Error(`Unexpected query outside transaction: ${sql}`);
    const affected = { rows: [], numAffectedRows: 1n };
    if (sql.startsWith("select") && sql.includes("from users")) {
      if (/\bfor (?:no key )?update\b/u.test(sql) && this.accountActive) await this.lock("users", connection);
      return { rows: this.accountActive ? [{ ...user, is_active: this.accountActive, password_hash: "unused" }] : [] };
    }
    if (sql.startsWith("select") && sql.includes("from school_memberships")) {
      if (sql.includes("for update") && this.membershipActive) await this.lock("school_memberships", connection);
      return { rows: this.membershipActive ? [{ school_id: user.active_school_id }] : [] };
    }
    if (sql.startsWith("select") && sql.includes("from auth_mfa_factors")) {
      // PostgreSQL does not lock a missing row. The account lock must protect it.
      if (sql.includes("for update") && this.factor) await this.lock("auth_mfa_factors", connection);
      const factor = connection.factor ?? this.factor;
      return { rows: factor ? [{ ...factor, active: factor.status === "active" }] : [] };
    }
    if (sql.startsWith("update auth_mfa_factors")) {
      const factor = connection.factor ?? this.factor;
      if (!factor) throw new Error("Cannot activate absent factor.");
      connection.factor = { ...factor, status: "active" };
      connection.effects.push(() => { this.factor = connection.factor!; });
      await this.pauseAt("activation");
      return affected;
    }
    if (sql.startsWith("delete from auth_mfa_recovery_codes")) {
      connection.effects.push(() => { this.recoveryCodes = []; });
      return affected;
    }
    if (sql.startsWith("insert into auth_mfa_recovery_codes")) {
      connection.effects.push(() => { this.recoveryCodes.push(query.parameters[1]); });
      return affected;
    }
    if (sql.startsWith("delete from auth_mfa_login_challenges")) {
      connection.effects.push(() => { this.challenges = this.challenges.filter(row => row.user_id !== query.parameters[0]); });
      return affected;
    }
    if (sql.startsWith("insert into auth_mfa_login_challenges")) {
      const row = this.insertedRow(sql, query);
      connection.effects.push(() => { this.challenges.push(row); });
      return affected;
    }
    if (sql.startsWith("insert into auth_sessions")) {
      const session = { row: this.insertedRow(sql, query), activeAtCreation: (connection.factor ?? this.factor)?.status === "active", connection: connection.id };
      await this.pauseAt("session");
      connection.effects.push(() => { this.sessions.push(session); });
      return affected;
    }
    if (sql.startsWith("insert into audit_events")) {
      if (this.failAudit) throw new Error("Controlled audit insert failure.");
      const row = this.insertedRow(sql, query);
      connection.effects.push(() => { this.audits.push(row); });
      return affected;
    }
    throw new Error(`Unrecognized controlled query: ${sql}`);
  }
}

class FixtureConnection implements DatabaseConnection {
  transaction = false;
  factor: Factor | undefined;
  effects: (() => void)[] = [];
  constructor(readonly id: number, private readonly driver: LockingDriver) {}
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> { return await this.driver.execute(this, query) as QueryResult<R>; }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error("No stream in this fixture."); }
}

function fixture() {
  const driver = new LockingDriver();
  const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => new PostgresAdapter(),
    createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: current => new PostgresIntrospector(current) } });
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const auth = new AuthService(db as DatabaseService, audit as unknown as AuditService, {} as RolesService, {} as ProgressiveWorkspaceProvisioner);
  return { db, driver, auth, audit };
}

async function expectBlocked<T>(driver: LockingDriver, work: Promise<T>) {
  const result = await Promise.race([
    driver.blocked.promise.then(value => ({ kind: "blocked" as const, ...value })),
    work.then(() => ({ kind: "completed" as const })),
  ]);
  expect(result.kind).toBe("blocked");
  if (result.kind === "blocked") expect(result.table).toBe("users");
}

describe("actual native Google finalization serialized with MFA activation", () => {
  it("requires MFA when activation holds the account lock and commits before finalization", async () => {
    const { db, driver, auth } = fixture();
    const pause = driver.pauseNext("activation");
    try {
      const activation = auth.confirmMfaEnrollment(user, { code: currentTotp() }, request);
      await pause.entered.promise;
      const finalization = auth.finalizeNativeGoogleLogin(user, request);
      await expectBlocked(driver, finalization);
      expect(driver.sessions).toHaveLength(0);
      expect(driver.factor?.status).toBe("pending");
      pause.resume.resolve(undefined);
      await expect(activation).resolves.toMatchObject({ active: true });
      const result = await finalization;
      expect(result).toHaveProperty("mfaChallenge");
      expect(result).not.toHaveProperty("session");
      expect(driver.sessions).toHaveLength(0);
      expect(driver.challenges).toHaveLength(1);
      if ("mfaChallenge" in result) expect(driver.challenges[0]?.token_hash).toBe(AuthService.tokenHash(result.mfaChallenge));
      expect(driver.audits[0]?.action).toBe("auth.login.mfa_challenged");
    } finally { pause.resume.resolve(undefined); await db.destroy(); }
  });

  it.each(["pending", "absent"] as const)("holds activation until session issuance commits when the factor was %s", async initial => {
    const { db, driver, auth } = fixture();
    if (initial === "absent") driver.factor = null;
    const pause = driver.pauseNext("session");
    try {
      const finalization = auth.finalizeNativeGoogleLogin(user, request);
      await pause.entered.promise;
      if (initial === "absent") driver.factor = pendingFactor(); // Enrollment may add a pending row; only confirmation activates it.
      const activation = auth.confirmMfaEnrollment(user, { code: currentTotp() }, request);
      await expectBlocked(driver, activation);
      expect(driver.sessions).toHaveLength(0);
      expect(driver.factor?.status).toBe("pending");
      pause.resume.resolve(undefined);
      const result = await finalization;
      expect(result).toHaveProperty("session");
      if ("session" in result) {
        expect(result.session.rawToken).toMatch(/^tc_native_[A-Za-z0-9_-]{43}$/u);
        expect(driver.sessions[0]?.row.token_hash).toBe(AuthService.tokenHash(result.session.rawToken));
      }
      await activation;
      expect(driver.sessions).toHaveLength(1);
      expect(driver.sessions[0]?.activeAtCreation).toBe(false);
      expect(driver.factor?.status).toBe("active");
      expect(driver.challenges).toHaveLength(0);
      expect(driver.audits[0]?.action).toBe("auth.login.succeeded");
      const sessionConnection = driver.sessions[0]!.connection;
      expect(driver.trace.filter(event => /insert into (auth_sessions|audit_events)/u.test(event.sql)).every(event => event.connection === sessionConnection)).toBe(true);
    } finally { pause.resume.resolve(undefined); await db.destroy(); }
  });

  it("refuses a delayed enrollment begin after confirmation commits instead of replacing the active factor", async () => {
    const { db, driver, auth, audit } = fixture();
    const originalSecret = driver.factor!.encrypted_secret;
    const pause = driver.pauseNext("activation");
    try {
      const activation = auth.confirmMfaEnrollment(user, { code: currentTotp() }, request);
      await pause.entered.promise;
      const beginning = auth.beginMfaEnrollment(user, request);
      const settled = beginning.then(value => ({ value, error: undefined }), error => ({ value: undefined, error: error as Error }));
      await expectBlocked(driver, settled);
      expect(driver.factor?.status).toBe("pending");
      pause.resume.resolve(undefined);
      await activation;
      const result = await settled;
      expect(result.value).toBeUndefined();
      expect(result.error?.message).toMatch(/already active/u);
      expect(driver.factor?.status).toBe("active");
      expect(driver.factor?.encrypted_secret).toBe(originalSecret);
      expect(driver.trace.some(event => event.sql.startsWith("insert into auth_mfa_factors"))).toBe(false);
      expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: "auth.mfa.enrollment_started" }));
    } finally { pause.resume.resolve(undefined); await db.destroy(); }
  });

  it("locks the exact auto-selected active membership inside session issuance when the grant has no selected campus", async () => {
    const { db, driver, auth } = fixture();
    try {
      const result = await auth.finalizeNativeGoogleLogin({ ...user, active_school_id: null }, request);
      expect(result.user.active_school_id).toBe(user.active_school_id);
      expect(driver.sessions[0]?.row.active_school_id).toBe(user.active_school_id);
      const lookup = driver.trace.findIndex(event => event.sql.startsWith("select distinct school_id"));
      const locked = driver.trace.findIndex(event => event.sql.includes("from school_memberships") && event.sql.includes("for update"));
      const inserted = driver.trace.findIndex(event => event.sql.startsWith("insert into auth_sessions"));
      expect(lookup).toBeGreaterThanOrEqual(0);
      expect(locked).toBeGreaterThan(lookup);
      expect(inserted).toBeGreaterThan(locked);
      expect(driver.trace[lookup]?.sql).not.toContain("for update");
      expect(driver.trace[locked]?.sql).toMatch(/user_id = \$1 and school_id = \$2 and is_active = \$3 for update/u);
      expect(driver.trace[locked]?.connection).toBe(driver.sessions[0]?.connection);
      expect(driver.commits).toBe(1);
    } finally { await db.destroy(); }
  });

  it("avoids factor-to-challenge lock inversion and limits challenge replacement to the current account", async () => {
    const { db, driver, auth } = fixture();
    driver.factor = { ...pendingFactor(), status: "active" };
    const otherUser = "00000000-0000-4000-8000-000000000099";
    driver.challenges = [{ user_id: user.id, token_hash: "old-own-challenge" }, { user_id: otherUser, token_hash: "other-account-challenge" }];
    try {
      await auth.finalizeNativeGoogleLogin(user, request);
      const accountLock = driver.trace.findIndex(event => event.sql.includes("from users") && event.sql.endsWith("for no key update"));
      const factorRead = driver.trace.findIndex(event => event.sql.includes("from auth_mfa_factors"));
      const cleanup = driver.trace.findIndex(event => event.sql.startsWith("delete from auth_mfa_login_challenges"));
      expect(accountLock).toBeGreaterThanOrEqual(0);
      expect(factorRead).toBeGreaterThan(accountLock);
      expect(driver.trace[factorRead]?.sql).not.toContain("for update");
      expect(cleanup).toBeGreaterThan(factorRead);
      expect(driver.trace[cleanup]?.sql).toMatch(/^delete from auth_mfa_login_challenges where user_id\s*=\s*\$1::uuid$/u);
      expect(driver.trace[cleanup]?.parameters).toEqual([user.id]);
      expect(driver.trace[cleanup]?.connection).toBe(driver.trace[accountLock]?.connection);
      expect(driver.challenges).toContainEqual({ user_id: otherUser, token_hash: "other-account-challenge" });
      expect(driver.challenges.filter(row => row.user_id === user.id)).toHaveLength(1);
      expect(driver.challenges.some(row => row.token_hash === "old-own-challenge")).toBe(false);
      expect(driver.sessions).toHaveLength(0);
    } finally { await db.destroy(); }
  });

  it.each(["inactive account", "revoked membership"] as const)("refuses fresh %s before issuing any credential", async reason => {
    const { db, driver, auth } = fixture();
    if (reason === "inactive account") driver.accountActive = false;
    else driver.membershipActive = false;
    try {
      await expect(auth.finalizeNativeGoogleLogin(user, request)).rejects.toThrow(reason === "inactive account" ? /unavailable/u : /access changed/u);
      expect(driver.sessions).toHaveLength(0);
      expect(driver.challenges).toHaveLength(0);
      expect(driver.audits).toHaveLength(0);
      expect(driver.rollbacks).toBe(1);
      expect(driver.commits).toBe(0);
    } finally { await db.destroy(); }
  });

  it.each(["pending", "active"] as const)("rolls back %s-factor credential creation if its transactional audit fails", async status => {
    const { db, driver, auth } = fixture();
    driver.factor = { ...pendingFactor(), status };
    driver.failAudit = true;
    try {
      await expect(auth.finalizeNativeGoogleLogin(user, request)).rejects.toThrow(/audit insert failure/u);
      expect(driver.sessions).toHaveLength(0);
      expect(driver.challenges).toHaveLength(0);
      expect(driver.audits).toHaveLength(0);
      expect(driver.rollbacks).toBe(1);
      expect(driver.commits).toBe(0);
      driver.failAudit = false;
      await auth.finalizeNativeGoogleLogin(user, request); // Rolled-back row locks must have been released.
      expect(driver.sessions.length + driver.challenges.length).toBe(1);
      expect(driver.audits).toHaveLength(1);
    } finally { await db.destroy(); }
  });
});
