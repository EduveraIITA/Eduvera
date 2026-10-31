import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { SimulationControlBoundary, simulationControlGateKey } from "../src/simulation/simulation-control-boundary.js";

const runId = "10000000-0000-4000-8000-000000000001";

function fixture(options: { acquire_after?: number; release?: boolean; fail_query?: boolean } = {}) {
  let elapsed = 0;
  let attempts = 0;
  const queries: { text: string; values: unknown[] }[] = [];
  const release = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const client = {
    query: (text: string, values: unknown[]) => {
      queries.push({ text, values });
      if (options.fail_query) return Promise.reject(new Error("Connection interrupted after dispatch."));
      return Promise.resolve({ rows: text.includes("pg_try_advisory_lock")
        ? [{ acquired: ++attempts >= (options.acquire_after ?? 1) }]
        : [{ released: options.release ?? true }] });
    }, release,
  } as unknown as Pick<PoolClient, "query" | "release">;
  const connect = vi.fn().mockResolvedValue(client);
  const wait = vi.fn((milliseconds: number) => { elapsed += milliseconds; return Promise.resolve(); });
  const boundary = new SimulationControlBoundary(() => ({ connect, end }), {
    max_wait_ms: 30, poll_interval_ms: 10, now: () => elapsed, wait,
  });
  return { boundary, queries, release, end, connect, wait };
}

describe("bounded Simulation checkpoint control admission", () => {
  it("canonicalizes UUID casing to the same worker lock key", () => {
    const mixed = "AA000000-0000-4000-8000-000000000001";
    expect(simulationControlGateKey(mixed)).toBe("simulation-control:aa000000-0000-4000-8000-000000000001");
  });
  it("waits for the healthy checkpoint before the action and releases its dedicated gate", async () => {
    const { boundary, queries, release, wait, end } = fixture();
    let polls = 0;
    const operation = vi.fn().mockResolvedValue("paused");
    expect(await boundary.settle(runId, () => Promise.resolve(++polls < 3), operation)).toBe("paused");
    expect(wait).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledOnce();
    expect(queries.map(query => query.values)).toEqual([[simulationControlGateKey(runId)], [simulationControlGateKey(runId)]]);
    expect(queries[0]?.text).toContain("pg_try_advisory_lock");
    expect(queries[1]?.text).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledWith(false);
    await boundary.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it("serializes a second control behind the first without claiming a worker lease", async () => {
    const { boundary, queries, wait, release } = fixture({ acquire_after: 3 });
    await boundary.settle(runId, () => Promise.resolve(false), () => Promise.resolve("stopped"));
    expect(wait).toHaveBeenCalledTimes(2);
    expect(queries.filter(query => query.text.includes("pg_try_advisory_lock"))).toHaveLength(3);
    expect(queries.every(query => !query.text.includes("UPDATE"))).toBe(true);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("times out a still-processing checkpoint without running the action, then unlocks", async () => {
    const { boundary, release, queries } = fixture();
    const operation = vi.fn();
    await expect(boundary.settle(runId, () => Promise.resolve(true), operation)).rejects.toMatchObject({
      response: { code: "simulation_checkpoint_finishing" },
    });
    expect(operation).not.toHaveBeenCalled();
    expect(queries.at(-1)?.text).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("releases an acquired gate when current authority or the operation rejects", async () => {
    const { boundary, release, queries } = fixture();
    const revoked = new ConflictException("Authority was revoked while waiting.");
    await expect(boundary.settle(runId, () => Promise.resolve(false), () => Promise.reject(revoked))).rejects.toBe(revoked);
    expect(queries.at(-1)?.text).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("drops the connection if unlock cannot be confirmed", async () => {
    const { boundary, release } = fixture({ release: false });
    await boundary.settle(runId, () => Promise.resolve(false), () => Promise.resolve("stopped"));
    expect(release).toHaveBeenCalledWith(true);
  });

  it("drops an uncertain connection if lock acquisition loses its response", async () => {
    const { boundary, release } = fixture({ fail_query: true });
    await expect(boundary.settle(runId, () => Promise.resolve(false), () => Promise.resolve())).rejects.toMatchObject({
      response: { code: "simulation_control_unavailable" },
    });
    expect(release).toHaveBeenCalledWith(true);
  });

  it("reports connection-pool exhaustion without borrowing a domain connection or running the action", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("Pool timeout with internal details."));
    const boundary = new SimulationControlBoundary(() => ({ connect, end: () => Promise.resolve() }));
    const operation = vi.fn();
    await expect(boundary.settle(runId, () => Promise.resolve(false), operation)).rejects.toMatchObject({
      response: { code: "simulation_control_unavailable" },
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("times out a contended gate and never runs the campus control", async () => {
    const { boundary, release, queries } = fixture({ acquire_after: 100 });
    const operation = vi.fn();
    await expect(boundary.settle(runId, () => Promise.resolve(false), operation)).rejects.toMatchObject({
      response: { code: "simulation_checkpoint_finishing" },
    });
    expect(operation).not.toHaveBeenCalled();
    expect(queries.some(query => query.text.includes("pg_advisory_unlock"))).toBe(false);
    expect(release).toHaveBeenCalledWith(true);
  });
});
