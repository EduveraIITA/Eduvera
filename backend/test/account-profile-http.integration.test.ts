import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { CompiledQuery } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSimulationBranch, SimulationBranchDriver, simulationBranchSchema } from "../src/database/simulation-branch.driver.js";
import type { StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { IsolatedAppHttp, type IsolatedHttpSession } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.ACCOUNT_PROFILE_HTTP_TEST_ISOLATED === "true";
const target = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/account_profile_unused_test";
const app = new IsolatedAppHttp();
const ownedSchemas = new Set<string>();
const observations: unknown[] = [];
type User = { id: string; username: string; email: string; first_name: string; last_name: string; role: string; active_school_id: string };
type ProfileResponse = { user: User; changed: boolean; scope: "account" };
let pool: Pool;
let session: IsolatedHttpSession;
let user: User;
let password: string;
let immutableAccount: unknown;
let immutableMemberships: unknown;
let immutablePerson: { id: string; first_name: string; last_name: string; revision: number };
let ownsMetadata = false;
const path = "/api/v1/auth/profile/";
const applicationName = `account-profile-native:${randomUUID()}`;
const quoted = (value: string) => {
  if (!/^[a-z_][a-z_0-9]*$/u.test(value)) throw new Error("Invalid owned fixture schema.");
  return `"${value}"`;
};

async function stableAccount() {
  const result = (await pool.query<{ id: string; username: string; email: string; password_hash: string; role: string; is_active: boolean; avatar_url: string | null; email_verified_at: Date | null }>(
    "SELECT id,username,email,password_hash,role,is_active,avatar_url,email_verified_at FROM public.users WHERE id=$1", [user.id],
  )).rows[0]!;
  const { password_hash, ...values } = result;
  return { ...values, credential_digest: createHash("sha256").update(password_hash).digest("hex") };
}

async function memberships() {
  return (await pool.query("SELECT id,school_id,role,is_active FROM public.school_memberships WHERE user_id=$1 ORDER BY id", [user.id])).rows;
}

async function canonicalPerson() {
  const rows = (await pool.query<{ id: string; first_name: string; last_name: string; revision: number }>(
    "SELECT id,first_name,last_name,revision FROM public.school_people WHERE school_id=$1 AND retired_at IS NULL ORDER BY id", [user.active_school_id],
  )).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function currentUser(): Promise<User> {
  return (await session.json<{ user: User }>("/api/v1/auth/me/")).user;
}

async function auditRows() {
  return (await pool.query<{ actor_id: string; school_id: string | null; target_id: string; metadata: unknown }>(
    "SELECT actor_id,school_id,target_id,metadata FROM public.audit_events WHERE actor_id=$1 AND action='auth.account_name.changed' ORDER BY created_at,id", [user.id],
  )).rows;
}

async function assertUnchangedCampusAndCredentials() {
  expect(await stableAccount()).toEqual(immutableAccount);
  expect(await memberships()).toEqual(immutableMemberships);
  expect(await canonicalPerson()).toEqual(immutablePerson);
  expect((await currentUser()).active_school_id).toBe(user.active_school_id);
}

describe.runIf(enabled)("account profile through the isolated compiled authenticated app", () => {
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_ISOLATED !== "true") throw new Error("Explicit isolated test mode is required.");
    const expected = process.env.ACCOUNT_PROFILE_EXPECT_DATABASE;
    if (!expected) throw new Error("Set the exact expected account-profile test database name.");
    pool = new Pool({ connectionString: target, max: 5, application_name: applicationName,
      options: "-c statement_timeout=15000 -c lock_timeout=10000" });
    const identity = (await pool.query<{ name: string; version: number }>(
      "SELECT current_database() AS name,current_setting('server_version_num')::int AS version",
    )).rows[0]!;
    expect(identity.name).toBe(expected);
    expect(identity.version).toBeGreaterThanOrEqual(170000);
    expect(identity.version).toBeLessThan(180000);
    const directory = new URL("../migrations/", import.meta.url);
    const files = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
    const applied = (await pool.query<{ name: string; checksum: string }>("SELECT name,checksum FROM public.node_schema_migrations ORDER BY name")).rows;
    expect(applied.map(row => row.name)).toEqual(files);
    for (const row of applied) expect(row.checksum).toBe(createHash("sha256").update(await readFile(new URL(row.name, directory))).digest("hex"));
    expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname='dt_simulation'")).rows).toEqual([]);
    expect((await pool.query(`SELECT count(*) FILTER(WHERE relation.relkind IN ('r','p'))::int AS tables,
      count(*) FILTER(WHERE relation.relkind='v')::int AS views FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public'`)).rows[0]).toEqual({ tables: 406, views: 18 });
    observations.push({ guard: identity, matching_migrations: files.length, public_relations: { tables: 406, views: 18 } });
    await app.start(target);
    session = app.session();
    await session.json("/api/v1/auth/csrf/");
    password = `Profile-Fixture-${randomUUID()}!`;
    const response = await session.request("/api/v1/auth/register/", "POST", { email: `profile-${randomUUID()}@example.test`, password });
    expect(response.status).toBe(201);
    const registration = await response.json() as { user: User };
    user = registration.user;
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(user.active_school_id).toMatch(/^[0-9a-f-]{36}$/u);
    immutableAccount = await stableAccount();
    immutableMemberships = await memberships();
    immutablePerson = await canonicalPerson();
    observations.push({ owned_fixture: { account_id: user.id, school_id: user.active_school_id, person_id: immutablePerson.id },
      creation: "one ordinary registration; no SQL authority, session or identity fixture" });
  }, 40_000);

  afterAll(async () => {
    await app.stop();
    if (!pool) return;
    try {
      if (ownsMetadata) {
        for (const schema of [...ownedSchemas].reverse()) await pool.query(`DROP SCHEMA IF EXISTS ${quoted(schema)} CASCADE`);
        await pool.query("DROP SCHEMA dt_simulation CASCADE");
        expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])", [["dt_simulation", ...ownedSchemas]])).rows).toEqual([]);
      }
      expect((await pool.query(`SELECT lock.pid FROM pg_locks lock JOIN pg_stat_activity activity ON activity.pid=lock.pid
        WHERE lock.locktype='advisory' AND activity.application_name=$1`, [applicationName])).rows).toEqual([]);
      expect((await pool.query(`SELECT count(*) FILTER(WHERE relation.relkind IN ('r','p'))::int AS tables,
        count(*) FILTER(WHERE relation.relkind='v')::int AS views FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public'`)).rows[0]).toEqual({ tables: 406, views: 18 });
      observations.push({ cleanup: "exact newly owned COW schemas removed; no fixture advisory locks; public404/18 unchanged",
        identity_fixture: "one owned ordinary-registration account/workspace retained as native evidence; no unsupported deletion" });
      console.info("ACCOUNT_PROFILE_NATIVE_RECEIPT", JSON.stringify(observations));
    } finally { await pool.end(); }
  });

  it("rejects anonymous, CSRF-free and extra-field attempts before changing any account or person", async () => {
    const body = { first_name: "Nila", last_name: "Rao", expected_first_name: "", expected_last_name: "" };
    expect((await app.session().request(path, "PATCH", body)).status).toBe(401);
    expect((await session.request(path, "PATCH", body, false)).status).toBe(403);
    for (const extra of [{ user_id: randomUUID() }, { email: "other@example.test" }, { role: "admin" }, { school_id: randomUUID() }]) {
      expect((await session.request(path, "PATCH", { ...body, ...extra })).status).toBe(400);
    }
    for (const invalid of [{ ...body, first_name: "", last_name: "" }, { ...body, first_name: "Control\nName" }]) {
      expect((await session.request(path, "PATCH", invalid)).status).toBe(400);
    }
    expect(await auditRows()).toEqual([]);
    expect(await currentUser()).toMatchObject({ first_name: "", last_name: "" });
    await assertUnchangedCampusAndCredentials();
  });

  it("changes only its own account name, trims desired values and makes identical retries harmless", async () => {
    const body = { first_name: "  Nila  ", last_name: "  Rao  ", expected_first_name: "", expected_last_name: "" };
    expect(await session.json<ProfileResponse>(path, "PATCH", body)).toMatchObject({ changed: true, scope: "account", user: { id: user.id, first_name: "Nila", last_name: "Rao" } });
    expect(await session.json<ProfileResponse>(path, "PATCH", body)).toMatchObject({ changed: false, scope: "account" });
    expect((await session.request(path, "PATCH", { ...body, first_name: "Other" })).status).toBe(409);
    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: user.id, target_id: user.id, school_id: null,
      metadata: { fields: ["first_name", "last_name"], scope: "account" } });
    expect(JSON.stringify(audit)).not.toMatch(/Nila|Rao|password|cookie|token/iu);
    await assertUnchangedCampusAndCredentials();
    observations.push({ self_update: true, strict_body: true, csrf: true, identical_retry_no_duplicate_audit: true,
      stale_different_name: 409, canonical_person_memberships_credentials_unchanged: true });
  });

  it("serializes concurrent different names while allowing the winning request's identical retry", async () => {
    const requests = [
      { first_name: "Tara", last_name: "Sen", expected_first_name: "Nila", expected_last_name: "Rao" },
      { first_name: "Rohan", last_name: "Das", expected_first_name: "Nila", expected_last_name: "Rao" },
    ];
    const results = await Promise.all(requests.map(body => session.request(path, "PATCH", body)));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const winner = requests[results.findIndex(result => result.status === 200)]!;
    expect(await currentUser()).toMatchObject({ first_name: winner.first_name, last_name: winner.last_name });
    expect(await session.json<ProfileResponse>(path, "PATCH", winner)).toMatchObject({ changed: false });
    expect(await auditRows()).toHaveLength(2);
    await assertUnchangedCampusAndCredentials();
    observations.push({ concurrent_different_updates: [200, 409], winning_retry_changed: false, duplicate_audits: false });
  });

  it("keeps captured users and canonical person names frozen when the Live account name changes", async () => {
    const before = await currentUser();
    const template = `dt_template_${randomUUID().replaceAll("-", "")}`;
    ownedSchemas.add(template);
    await pool.query("CREATE SCHEMA dt_simulation");
    ownsMetadata = true;
    await pool.query(`CREATE TABLE dt_simulation.snapshots(id uuid PRIMARY KEY,school_id uuid NOT NULL);
      CREATE TABLE dt_simulation.snapshot_tables(snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),
        table_name text NOT NULL,rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),PRIMARY KEY(snapshot_id,table_name));
      CREATE TABLE dt_simulation.worlds(run_id uuid PRIMARY KEY,school_id uuid NOT NULL,scenario_id uuid NOT NULL,
        namespace_id text NOT NULL UNIQUE,snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),schema_name text NOT NULL UNIQUE,
        virtual_now timestamptz NOT NULL,time_zone text NOT NULL,revision bigint NOT NULL DEFAULT 1,domain_read_only boolean NOT NULL DEFAULT false);
      CREATE TABLE dt_simulation.materialized_tables(run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),table_name text NOT NULL,PRIMARY KEY(run_id,table_name))`);
    await pool.query(`CREATE SCHEMA ${quoted(template)};
      CREATE TABLE ${quoted(template)}.users(id uuid PRIMARY KEY,first_name text NOT NULL,last_name text NOT NULL);
      CREATE TABLE ${quoted(template)}.school_people(id uuid PRIMARY KEY,first_name text NOT NULL,last_name text NOT NULL)`);
    const snapshot: StoredSimulationSnapshot = { id: randomUUID(), origin_run_id: null, school_id: user.active_school_id,
      captured_at: "2026-10-26T00:00:00.000Z", content_hash: createHash("sha256").update("profile mechanical capture").digest("hex"),
      template_schema: template, catalogue: { tables: ["users", "school_people"].map(name => ({ name, columns: ["id", "first_name", "last_name"],
        foreign_keys: [], triggers: [], trigger_functions: [], defaults: [] })), functions: [], views: [], extensions: [], extension_objects: [] },
      counts: { users: 1, school_people: 1 }, time_zone: "UTC", compatibility_manifest: null, compatibility_hash: null };
    const capturedUser = { id: user.id, first_name: before.first_name, last_name: before.last_name };
    const capturedPerson = { id: immutablePerson.id, first_name: immutablePerson.first_name, last_name: immutablePerson.last_name };
    await pool.query("INSERT INTO dt_simulation.snapshots(id,school_id) VALUES($1,$2)", [snapshot.id, user.active_school_id]);
    for (const [table, row] of [["users", capturedUser], ["school_people", capturedPerson]] as const) {
      await pool.query("INSERT INTO dt_simulation.snapshot_tables(snapshot_id,table_name,rows) VALUES($1,$2,$3::jsonb)", [snapshot.id, table, JSON.stringify([row])]);
    }
    const run = randomUUID();
    ownedSchemas.add(simulationBranchSchema(run));
    const branch = await createSimulationBranch(pool, snapshot, { run_id: run, school_id: user.active_school_id, scenario_id: randomUUID(), namespace_id: `profile-native:${run}` });
    const driver = new SimulationBranchDriver(pool, branch, snapshot);
    const connection = await driver.acquireConnection();
    try {
      expect(await session.json<ProfileResponse>(path, "PATCH", { first_name: "Leela", last_name: "Nair",
        expected_first_name: before.first_name, expected_last_name: before.last_name })).toMatchObject({ changed: true, scope: "account" });
      // GROUP BY exercises the real materializer/PK path after Live changed, using only frozen minimal columns.
      expect((await connection.executeQuery(CompiledQuery.raw("SELECT id,first_name,last_name FROM users GROUP BY id"))).rows).toEqual([capturedUser]);
      expect((await connection.executeQuery(CompiledQuery.raw("SELECT id,first_name,last_name FROM school_people"))).rows).toEqual([capturedPerson]);
      expect((await pool.query("SELECT table_name FROM dt_simulation.materialized_tables WHERE run_id=$1", [run])).rows).toEqual([{ table_name: "users" }]);
      expect((await pool.query("SELECT rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='users'", [snapshot.id])).rows[0]?.rows).toEqual([capturedUser]);
      await assertUnchangedCampusAndCredentials();
      expect(await currentUser()).toMatchObject({ first_name: "Leela", last_name: "Nair" });
      expect(await auditRows()).toHaveLength(3);
      observations.push({ live_http_account_update: true, captured_columns: ["id", "first_name", "last_name"],
        real_cow_users_materialized: true, frozen_account_name_unchanged: true, canonical_person_unchanged: true,
        selected_institution_unchanged: true, credentials_in_snapshot: false });
    } finally { await driver.releaseConnection(connection); await driver.destroy(); }
  });

  it("rejects a revoked cookie and keeps ordinary password login and campus context intact", async () => {
    const cookies = new Map((session as unknown as { cookies: Map<string, string> }).cookies);
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    expect((await session.request("/api/v1/auth/logout/", "POST", {})).status).toBe(204);
    const revoked = await fetch(app.base + path, { method: "PATCH", headers: { Cookie: cookie,
      "Content-Type": "application/json", "X-CSRFToken": cookies.get("csrftoken") ?? "" },
    body: JSON.stringify({ first_name: "Revoked", last_name: "Attempt", expected_first_name: "Leela", expected_last_name: "Nair" }) });
    expect(revoked.status).toBe(401);
    expect(await auditRows()).toHaveLength(3);
    await session.login(user.email, password, user.active_school_id);
    expect(await currentUser()).toMatchObject({ id: user.id, first_name: "Leela", last_name: "Nair", active_school_id: user.active_school_id });
    await assertUnchangedCampusAndCredentials();
    await session.request("/api/v1/auth/logout/", "POST", {});
    observations.push({ revoked_cookie_http: 401, normal_password_login_after_change: true, stable_identity_and_campus: true,
      public_delegated_and_hosted_flags: "separate pure service/guard tests; no forged SQL session flags" });
  });
});
