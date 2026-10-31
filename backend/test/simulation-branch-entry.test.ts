import { CompiledQuery } from "kysely";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { SimulationBranchDriver, type SimulationBranch } from "../src/database/simulation-branch.driver.js";
import type { StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";

const branch: SimulationBranch = {
  run_id: "30000000-0000-4000-8000-000000000001", school_id: "10000000-0000-4000-8000-000000000001",
  scenario_id: "20000000-0000-4000-8000-000000000001", namespace_id: "scenario:entry-test",
  schema_name: "dt_entry_test", snapshot_id: "40000000-0000-4000-8000-000000000001",
  virtual_now: "2026-10-25T00:00:00.000Z", time_zone: "UTC", revision: 1,
};
const snapshot: StoredSimulationSnapshot = {
  id: branch.snapshot_id, origin_run_id: null, school_id: branch.school_id, captured_at: branch.virtual_now,
  content_hash: "entry-test", template_schema: "dt_entry_template", counts: {}, time_zone: "UTC",
  catalogue: { tables: [], functions: [], views: [], extensions: [], extension_objects: [] },
  compatibility_manifest: null, compatibility_hash: null,
};
const result = (released = true) => ({ rows: [{ released }], rowCount: 1, command: "SELECT" });
function fixture() {
  const query = vi.fn<(sql: string, parameters?: unknown[]) => Promise<ReturnType<typeof result>>>(() => Promise.resolve(result()));
  const client = { query, release: vi.fn(), end: vi.fn(() => Promise.resolve()) };
  const pool = { connect: vi.fn(() => Promise.resolve(client)) };
  return { query, client, driver: new SimulationBranchDriver(pool as unknown as Pool, branch, snapshot) };
}
function expectDiscarded(client: ReturnType<typeof fixture>["client"]) {
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(client.release).toHaveBeenCalledWith(true);
}

describe("Simulation explicit transaction entry lifecycle", () => {
  it("waits before BEGIN, bridges the same key and preserves requested settings on a reusable lease", async () => {
    const { query, client, driver } = fixture();
    const first = await driver.acquireConnection();
    query.mockClear();
    await driver.beginTransaction(first, { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(query.mock.calls).toEqual([
      ["SELECT pg_advisory_lock(hashtextextended($1,0))", [`cow:${branch.run_id}`]],
      ["BEGIN ISOLATION LEVEL repeatable read READ ONLY"],
      ["SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`cow:${branch.run_id}`]],
      ["SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released", [`cow:${branch.run_id}`]],
    ]);
    expect(client.release).not.toHaveBeenCalled();
    await driver.rollbackTransaction(first);
    await driver.releaseConnection(first);
    await driver.releaseConnection(first);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenLastCalledWith(false);
    const next = await driver.acquireConnection();
    expect(next).not.toBe(first);
    await driver.beginTransaction(next, { isolationLevel: "serializable", accessMode: "read write" });
    expect(query).toHaveBeenCalledWith("BEGIN ISOLATION LEVEL serializable READ WRITE");
    await driver.commitTransaction(next);
    await driver.releaseConnection(next);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it.each(["SELECT pg_advisory_lock(", "BEGIN", "SELECT pg_advisory_xact_lock(", "SELECT pg_advisory_unlock("])(
    "discards once when transaction entry fails at %s", async (prefix) => {
      const { query, client, driver } = fixture();
      const connection = await driver.acquireConnection();
      const failure = new Error(`entry failure at ${prefix}`);
      query.mockImplementation((sql) => sql.startsWith(prefix) ? Promise.reject(failure) : Promise.resolve(result()));
      await expect(driver.beginTransaction(connection, { isolationLevel: "repeatable read" })).rejects.toBe(failure);
      expectDiscarded(client);
      const calls = query.mock.calls.length;
      await driver.releaseConnection(connection);
      await driver.releaseConnection(connection);
      await expect(connection.executeQuery(CompiledQuery.raw("SELECT 1"))).rejects.toThrow("released");
      expect(query.mock.calls).toHaveLength(calls);
      expectDiscarded(client);
    },
  );

  it("rejects a lost targeted session gate and destroys its lease", async () => {
    const { query, client, driver } = fixture();
    const connection = await driver.acquireConnection();
    query.mockImplementation((sql) => Promise.resolve(result(!sql.startsWith("SELECT pg_advisory_unlock("))));
    await expect(driver.beginTransaction(connection, {})).rejects.toThrow("entry gate was lost");
    expectDiscarded(client);
    await driver.releaseConnection(connection);
    expectDiscarded(client);
  });

  it("preserves the original entry error when discard and physical close also fail", async () => {
    const { query, client, driver } = fixture();
    const connection = await driver.acquireConnection();
    const failure = new Error("original acquisition failure");
    query.mockRejectedValue(failure);
    client.release.mockImplementation(() => { throw new Error("pool release failure"); });
    client.end.mockRejectedValue(new Error("physical close failure"));
    await expect(driver.beginTransaction(connection, {})).rejects.toBe(failure);
    await driver.releaseConnection(connection);
    expectDiscarded(client);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("rejects nested BEGIN before I/O while preserving savepoint operations and the outer gate", async () => {
    const { query, client, driver } = fixture();
    const connection = await driver.acquireConnection();
    await driver.beginTransaction(connection, { isolationLevel: "repeatable read" });
    const calls = query.mock.calls.length;
    await expect(driver.beginTransaction(connection, {})).rejects.toThrow("already active");
    expect(query.mock.calls).toHaveLength(calls);
    await driver.savepoint(connection, "nested_work");
    await driver.rollbackToSavepoint(connection, "nested_work");
    await driver.releaseSavepoint(connection, "nested_work");
    expect(query).toHaveBeenCalledWith('SAVEPOINT "nested_work"');
    expect(query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT "nested_work"');
    expect(query).toHaveBeenCalledWith('RELEASE SAVEPOINT "nested_work"');
    expect(client.release).not.toHaveBeenCalled();
    await driver.rollbackTransaction(connection);
    await driver.releaseConnection(connection);
  });

  it("cannot report successful entry after concurrent release of a waiting lease", async () => {
    const { query, client, driver } = fixture();
    const connection = await driver.acquireConnection();
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    query.mockImplementation(async (sql) => { if (sql.startsWith("SELECT pg_advisory_lock(")) await gate; return result(); });
    const entry = driver.beginTransaction(connection, { isolationLevel: "repeatable read" });
    const calls = query.mock.calls.length;
    await expect(driver.beginTransaction(connection, {})).rejects.toThrow("already active");
    expect(query.mock.calls).toHaveLength(calls);
    await driver.releaseConnection(connection);
    expectDiscarded(client);
    unlock();
    await expect(entry).rejects.toThrow("entry gate was lost");
    await driver.releaseConnection(connection);
    expectDiscarded(client);
  });

  it.each(["ROLLBACK", "RESET ALL"])("destroys a lease instead of pooling it after %s cleanup fails", async (statement) => {
    const { query, client, driver } = fixture();
    const connection = await driver.acquireConnection();
    await driver.beginTransaction(connection, {});
    const failure = new Error(`${statement} failed`);
    query.mockImplementation((sql) => sql === statement ? Promise.reject(failure) : Promise.resolve(result()));
    await expect(driver.releaseConnection(connection)).rejects.toBe(failure);
    expectDiscarded(client);
    await driver.releaseConnection(connection);
    expectDiscarded(client);
  });
});
