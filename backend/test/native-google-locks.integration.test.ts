import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { CompiledQuery, Kysely, PostgresDialect, type DatabaseConnection, type Driver, type TransactionSettings } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../src/auth/auth.service.js";
import { base32Encode, encryptMfaSecret } from "../src/auth/mfa.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.NATIVE_GOOGLE_LOCKS_TEST_ISOLATED === "true";
const target = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/native_google_locks_test";
const labels = new AsyncLocalStorage<string>();
const observations: unknown[] = [];
let observer: Pool;

function barrier() {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release };
}
function notice<T>() {
  let resolve!: (value: T) => void;
  const ready = new Promise<T>(done => { resolve = done; });
  return { ready, resolve };
}
type QueryTrace = { label: string; pid: number; sql: string };

/** Hooks only pause before/after real production SQL. PostgreSQL owns all row,
 * foreign-key and transaction locks; no test lock manager substitutes for it. */
class ObservedPostgresDriver implements Driver {
  readonly trace: QueryTrace[] = [];
  before: (event: QueryTrace) => Promise<void> = () => Promise.resolve();
  after: (event: QueryTrace) => Promise<void> = () => Promise.resolve();
  private readonly owners = new WeakMap<DatabaseConnection, DatabaseConnection>();
  constructor(private readonly native: Driver) {}
  init() { return this.native.init(); }
  async acquireConnection() {
    const native = await this.native.acquireConnection();
    const pid = (await native.executeQuery<{ pid: number }>(CompiledQuery.raw("SELECT pg_backend_pid() AS pid"))).rows[0]!.pid;
    const wrapped: DatabaseConnection = {
      executeQuery: async <R>(query: CompiledQuery) => {
        const event = { label: labels.getStore() ?? "unlabelled", pid,
          sql: query.sql.toLowerCase().replaceAll('"', "").replace(/\s+/gu, " ").trim() };
        this.trace.push(event);
        await this.before(event);
        const result = await native.executeQuery<R>(query);
        await this.after(event);
        return result;
      },
      streamQuery: (query, chunk) => native.streamQuery(query, chunk),
    };
    this.owners.set(wrapped, native);
    return wrapped;
  }
  private owner(connection: DatabaseConnection) {
    const native = this.owners.get(connection);
    if (!native) throw new Error("Unknown owned PostgreSQL test lease.");
    return native;
  }
  beginTransaction(connection: DatabaseConnection, settings: TransactionSettings) { return this.native.beginTransaction(this.owner(connection), settings); }
  commitTransaction(connection: DatabaseConnection) { return this.native.commitTransaction(this.owner(connection)); }
  rollbackTransaction(connection: DatabaseConnection) { return this.native.rollbackTransaction(this.owner(connection)); }
  async releaseConnection(connection: DatabaseConnection) {
    const native = this.owner(connection); this.owners.delete(connection);
    await this.native.releaseConnection(native);
  }
  destroy() { return this.native.destroy(); }
}

async function fixture(status: "active" | "pending" | "absent") {
  const accountId = randomUUID(), rawSecret = randomBytes(20), secret = base32Encode(rawSecret);
  const user = (await observer.query<AuthUser>(`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role,email_verified_at)
    VALUES($1,$2,$3,'unused-synthetic-password','Synthetic','Auth lock review','staff',now()) RETURNING *`,
  [accountId, `lock.${accountId}`, `${accountId}@example.test`])).rows[0]!;
  user.active_school_id = null;
  if (status !== "absent") {
    const encrypted = encryptMfaSecret(secret);
    await observer.query(`INSERT INTO auth_mfa_factors(user_id,encrypted_secret,secret_iv,secret_tag,status,confirmed_at)
      VALUES($1,$2,$3,$4,$5::varchar,CASE WHEN $5::varchar='active' THEN now() ELSE NULL END)`,
    [accountId, encrypted.encrypted, encrypted.iv, encrypted.tag, status]);
  }
  const pool = new Pool({ connectionString: target, max: 6, connectionTimeoutMillis: 2_000,
    application_name: `native-google-locks:${accountId}`, options: "-c statement_timeout=15000 -c lock_timeout=10000" });
  const postgres = new PostgresDialect({ pool });
  const driver = new ObservedPostgresDriver(postgres.createDriver());
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => driver, createAdapter: () => postgres.createAdapter(),
    createQueryCompiler: () => postgres.createQueryCompiler(), createIntrospector: value => postgres.createIntrospector(value),
  } });
  const audit = new AuditService(db as DatabaseService);
  const auth = new AuthService(db as DatabaseService, audit, {} as never, {} as never);
  const request = { ip: "127.0.0.1", headers: { "user-agent": "owned-pg17-auth-regression" }, requestId: randomUUID() } as unknown as FastifyRequest;
  const code = () => {
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const hash = createHmac("sha1", rawSecret).update(counter).digest(), offset = hash[hash.length - 1]! & 15;
    return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  };
  return { accountId, user, auth, db, driver, request, code };
}

async function blockedBy(waiter: number, owner: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await observer.query<{ blocked: boolean }>("SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked", [waiter, owner])).rows[0]?.blocked) return;
    await setTimeout(10); // Observe a server barrier; time never decides the race.
  }
  throw new Error("The production account lock never blocked the competing MFA operation.");
}

describe.runIf(enabled)("native Google MFA locks against PostgreSQL17", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.EVENT_DATABASE_URL) throw new Error("All test owners must use the exact disposable target.");
    if (process.env.TEST_DATABASE_ISOLATED !== "true") throw new Error("The explicit isolated-test database guard is required.");
    const expected = process.env.NATIVE_GOOGLE_LOCKS_EXPECT_DATABASE;
    const ownedLocal = expected && /^(?:native_google_locks|core_closure2_source)_test_\d{8}_[a-f0-9]{8}$/u.test(expected);
    const ownedCi = process.env.GITHUB_ACTIONS === "true" && expected === "thatcampus_dt_test";
    if (!expected || !ownedLocal && !ownedCi) throw new Error("An exact owned native Google test database is required.");
    observer = new Pool({ connectionString: target, max: 2, application_name: "native-google-lock-observer" });
    const current = (await observer.query<{ name: string; version: number }>("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0]!;
    expect(current.name).toBe(expected); expect(current.version).toBeGreaterThanOrEqual(170000); expect(current.version).toBeLessThan(180000);
    observations.push({ guard: current, production_auth_service: true, native_foreign_keys: true });
  });
  afterAll(async () => {
    console.info("NATIVE_GOOGLE_PG_LOCK_RECEIPT", JSON.stringify(observations));
    await observer?.end();
  });

  it("completes finalizer and primary challenge replacement without an implicit users-FK lock inversion", async () => {
    const f = await fixture("active");
    const nativeHeld = notice<QueryTrace>(), primaryWaiting = notice<QueryTrace>();
    const continueNative = barrier();
    const previous = AuthService.tokenHash(randomBytes(32).toString("base64url"));
    await observer.query("INSERT INTO auth_mfa_login_challenges(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [previous, f.accountId]);
    f.driver.after = async event => {
      if (event.label === "native" && event.sql.includes("from users") && /for (?:no key )?update$/u.test(event.sql)) { nativeHeld.resolve(event); await continueNative.ready; }
    };
    f.driver.before = event => {
      if (event.label === "primary" && event.sql.includes("from users") && event.sql.endsWith("for no key update")) primaryWaiting.resolve(event);
      return Promise.resolve();
    };
    let calls: Promise<unknown>[] = [];
    try {
      const native = labels.run("native", () => f.auth.finalizeNativeGoogleLogin(f.user, f.request)); void native.catch(() => undefined);
      const nativeLock = await nativeHeld.ready;
      const primary = labels.run("primary", () => f.auth.finishPrimaryLogin(f.user, f.request)); void primary.catch(() => undefined);
      calls = [native, primary];
      const primaryLock = await primaryWaiting.ready;
      expect(nativeLock.pid).not.toBe(primaryLock.pid);
      await blockedBy(primaryLock.pid, nativeLock.pid);
      // Primary now serializes before challenge DELETE rather than holding a
      // challenge while waiting for its account's implicit foreign-key lock.
      expect(f.driver.trace.some(event => event.label === "primary" && event.sql.startsWith("delete from auth_mfa_login_challenges"))).toBe(false);
      continueNative.release();
      const outcomes = await Promise.allSettled(calls);
      const summary = outcomes.map(value => value.status === "fulfilled"
        ? { status: value.status } : { status: value.status, code: (value.reason as { code?: string }).code });
      observations.push({ schedule: "account held / primary waits before challenge replacement", results: summary });
      expect(summary).toEqual([{ status: "fulfilled" }, { status: "fulfilled" }]);
      for (const value of outcomes) if (value.status === "fulfilled") expect(value.value).toHaveProperty("mfaChallenge");
      expect((await observer.query("SELECT 1 FROM auth_sessions WHERE user_id=$1", [f.accountId])).rowCount).toBe(0);
      expect((await observer.query("SELECT 1 FROM auth_mfa_login_challenges WHERE user_id=$1 AND token_hash=$2", [f.accountId, previous])).rowCount).toBe(0);
      expect(f.driver.trace.find(event => event.label === "native" && event.sql.includes("from users"))?.sql).toContain("for no key update");
    } finally {
      continueNative.release(); await Promise.allSettled(calls); await f.db.destroy();
    }
  });

  it("observes MFA activation committed before native finalization without issuing a bearer", async () => {
    const f = await fixture("pending");
    const activating = notice<QueryTrace>(), waiting = notice<QueryTrace>(), proceed = barrier();
    f.driver.after = async event => {
      if (event.label === "activation" && event.sql.startsWith("update auth_mfa_factors")) { activating.resolve(event); await proceed.ready; }
    };
    f.driver.before = event => {
      if (event.label === "native" && event.sql.includes("from users")) waiting.resolve(event);
      return Promise.resolve();
    };
    let calls: Promise<unknown>[] = [];
    try {
      const activation = labels.run("activation", () => f.auth.confirmMfaEnrollment(f.user, { code: f.code() }, f.request));
      void activation.catch(() => undefined); calls = [activation];
      const owner = await activating.ready;
      const native = labels.run("native", () => f.auth.finalizeNativeGoogleLogin(f.user, f.request));
      void native.catch(() => undefined); calls.push(native);
      const waiter = await waiting.ready;
      await blockedBy(waiter.pid, owner.pid);
      expect((await observer.query("SELECT 1 FROM auth_sessions WHERE user_id=$1", [f.accountId])).rowCount).toBe(0);
      proceed.release();
      await activation;
      const result = await native;
      expect("mfaChallenge" in result).toBe(true);
      expect((await observer.query("SELECT 1 FROM auth_sessions WHERE user_id=$1", [f.accountId])).rowCount).toBe(0);
      observations.push({ schedule: "activation before finalization", postgres_account_wait_observed: true, native_bearers: 0, challenge: true });
    } finally { proceed.release(); await Promise.allSettled(calls); await f.db.destroy(); }
  });

  it.each(["pending", "absent"] as const)("serializes the %s-factor writer after native session decision and commit", async status => {
    const f = await fixture(status);
    const issuing = notice<QueryTrace>(), waiting = notice<QueryTrace>(), proceed = barrier();
    f.driver.after = async event => {
      if (event.label === "native" && event.sql.startsWith("insert into auth_sessions")) { issuing.resolve(event); await proceed.ready; }
    };
    f.driver.before = event => {
      if (event.label === "writer" && event.sql.includes("from users") && event.sql.endsWith("for update")) waiting.resolve(event);
      return Promise.resolve();
    };
    let calls: Promise<unknown>[] = [];
    try {
      const native = labels.run("native", () => f.auth.finalizeNativeGoogleLogin(f.user, f.request));
      void native.catch(() => undefined); calls = [native];
      const owner = await issuing.ready;
      const writer = labels.run("writer", () => status === "pending"
        ? f.auth.confirmMfaEnrollment(f.user, { code: f.code() }, f.request)
        : f.auth.beginMfaEnrollment(f.user, f.request));
      void writer.catch(() => undefined); calls.push(writer);
      const waiter = await waiting.ready;
      await blockedBy(waiter.pid, owner.pid);
      expect((await observer.query("SELECT 1 FROM auth_sessions WHERE user_id=$1", [f.accountId])).rowCount).toBe(0);
      expect((await observer.query<{ status: string }>("SELECT status FROM auth_mfa_factors WHERE user_id=$1", [f.accountId])).rows.map(row => row.status)).toEqual(status === "pending" ? ["pending"] : []);
      proceed.release();
      const result = await native;
      expect("session" in result).toBe(true);
      await writer;
      expect((await observer.query("SELECT 1 FROM auth_sessions WHERE user_id=$1", [f.accountId])).rowCount).toBe(1);
      expect((await observer.query<{ status: string }>("SELECT status FROM auth_mfa_factors WHERE user_id=$1", [f.accountId])).rows[0]?.status).toBe(status === "pending" ? "active" : "pending");
      observations.push({ schedule: `native commit before ${status === "pending" ? "confirmation" : "absent-factor enrollment"}`,
        postgres_account_wait_observed: true, native_bearers: 1, factor_active_at_session_decision: false });
    } finally { proceed.release(); await Promise.allSettled(calls); await f.db.destroy(); }
  });

  it("does not replace an activated factor when delayed enrollment resumes", async () => {
    const f = await fixture("pending");
    const activating = notice<QueryTrace>(), waiting = notice<QueryTrace>(), proceed = barrier();
    const original = (await observer.query<{ encrypted_secret: Buffer }>("SELECT encrypted_secret FROM auth_mfa_factors WHERE user_id=$1", [f.accountId])).rows[0]!.encrypted_secret;
    f.driver.after = async event => {
      if (event.label === "activation" && event.sql.startsWith("update auth_mfa_factors")) { activating.resolve(event); await proceed.ready; }
    };
    f.driver.before = event => {
      if (event.label === "enrollment" && event.sql.includes("from users") && event.sql.endsWith("for update")) waiting.resolve(event);
      return Promise.resolve();
    };
    let calls: Promise<unknown>[] = [];
    try {
      const activation = labels.run("activation", () => f.auth.confirmMfaEnrollment(f.user, { code: f.code() }, f.request));
      void activation.catch(() => undefined); calls = [activation];
      const owner = await activating.ready;
      const enrollment = labels.run("enrollment", () => f.auth.beginMfaEnrollment(f.user, f.request));
      void enrollment.catch(() => undefined); calls.push(enrollment);
      const waiter = await waiting.ready;
      await blockedBy(waiter.pid, owner.pid);
      proceed.release();
      await activation;
      await expect(enrollment).rejects.toThrow("already active");
      const factor = (await observer.query<{ status: string; encrypted_secret: Buffer }>("SELECT status,encrypted_secret FROM auth_mfa_factors WHERE user_id=$1", [f.accountId])).rows[0]!;
      expect(factor.status).toBe("active"); expect(factor.encrypted_secret.equals(original)).toBe(true);
      observations.push({ schedule: "confirmation before enrollment", postgres_account_wait_observed: true, activated_secret_preserved: true });
    } finally { proceed.release(); await Promise.allSettled(calls); await f.db.destroy(); }
  });
});
