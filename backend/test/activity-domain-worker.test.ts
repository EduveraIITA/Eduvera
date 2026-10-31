import { describe, expect, it, vi } from "vitest";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionNow } from "../src/campus-model-core/execution-time.runtime.js";

describe("native domain-worker registrations", () => {
  it("rejects duplicate registration and supports an exact scoped unregister", () => {
    const events = new SchoolEventService({} as DatabaseService);
    const unregister = events.registerDomainWork("attendance", () => Promise.resolve(0));
    expect(() => events.registerDomainWork("attendance", () => Promise.resolve(1))).toThrow("already registered");
    unregister();
    expect(() => events.registerDomainWork("attendance", () => Promise.resolve(1))).not.toThrow();
  });

  it("advances the same callback in virtual time, serializes one namespace and isolates a sibling run", async () => {
    const scope = new ExecutionDataPlaneScope();
    const events = new SchoolEventService({} as DatabaseService, undefined, undefined, scope);
    const privateEvents = events as unknown as {
      enqueueOverdueRegisters: () => Promise<number>;
      publishPendingInSelectedEnvironment: () => Promise<number>;
    };
    privateEvents.enqueueOverdueRegisters = vi.fn(() => Promise.resolve(0));
    privateEvents.publishPendingInSelectedEnvironment = vi.fn(() => Promise.resolve(0));
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const calls: Array<{ namespace: string; at: string }> = [];
    events.registerDomainWork("attendance", async () => {
      calls.push({ namespace: scope.current()!.namespace_id, at: executionNow().toISOString() });
      await held;
    });
    const environment = (runId: string, at: string) => simulationRequestEnvironment({
      institution_id: "10000000-0000-4000-a000-000000000001", scenario_id: "10000000-0000-4000-a000-000000000002",
      run_id: runId, virtual_now: at, source_snapshot_ref: "sha256:worker-test", manifest_ref: "worker-test", checked_at: at,
    });
    const first = environment("10000000-0000-4000-a000-000000000003", "2027-01-01T22:30:00Z");
    const sibling = environment("10000000-0000-4000-a000-000000000004", "2028-01-02T04:30:00Z");
    const work = [scope.run(first, () => events.advanceSimulationDomainWork()), scope.run(first, () => events.advanceSimulationDomainWork()),
      scope.run(sibling, () => events.advanceSimulationDomainWork())];
    // Each call awaits reminders before reaching the registered sole writer.
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(calls).toEqual([{ namespace: first.namespace_id, at: "2027-01-01T22:30:00.000Z" },
      { namespace: sibling.namespace_id, at: "2028-01-02T04:30:00.000Z" }]);
    release();
    await Promise.all(work);
    await expect(events.advanceSimulationDomainWork()).rejects.toThrow("isolated execution environment");
  });
});
