import { describe, expect, it } from "vitest";
import type {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
} from "kysely";
import type { SimulationVirtualClock } from "../src/campus-model-core/execution-environment.contracts.js";
import type { ExecutionEffectCoverage } from "../src/campus-model-core/execution-effects.contracts.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import {
  ExecutionEffectRouter,
  RunScopedInMemoryExecutionEffectSink,
} from "../src/campus-model-core/execution-effects.runtime.js";
import {
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import {
  evaluateSimulationApplicationCoverage,
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
  ExecutionRoutingDriver,
  REQUIRED_APPLICATION_SIMULATION_MODULES,
  type SimulationApplicationCoverageManifest,
} from "../src/database/execution-data-plane.js";
import type { ExecutionDataPlaneError } from "../src/database/execution-data-plane.js";

const now = "2026-10-17T06:30:00.000Z";
const virtualClock: SimulationVirtualClock = {
  now: () => new Date(now),
  nowIso: () => now,
  advanceBy: () => now,
  advanceTo: () => now,
};

function environment(runId = "run-001") {
  return createSimulationExecutionEnvironment({
    institution_id: "school-cis",
    scenario_id: "whole-campus",
    run_id: runId,
    virtual_clock: virtualClock,
    source_snapshot_ref: "snapshot:whole-campus:42",
    coverage_gate: {
      status: "passed",
      manifest_ref: "coverage:whole-campus:42",
      checked_at: now,
    },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
}

function completeCoverage(
  overrides: Partial<SimulationApplicationCoverageManifest> = {},
): SimulationApplicationCoverageManifest {
  return {
    manifest_ref: "coverage:whole-campus:42",
    checked_at: now,
    enabled_modules: [],
    modules: REQUIRED_APPLICATION_SIMULATION_MODULES.map((module_id) => ({
      module_id,
      capabilities: {
        snapshot: "supported",
        queries: "supported",
        commands: "supported",
        events: "supported",
        realtime: "supported",
      },
    })),
    storage_mode: "isolated_copy_on_write",
    event_outbox_mode: "isolated",
    operational_message_mode: "sink_only",
    file_storage_mode: "isolated",
    external_connector_mode: "disabled",
    realtime_mode: "isolated",
    uncovered_effects: [],
    ...overrides,
  };
}

function completeEffectCoverage(
  selectedEnvironment = environment(),
): ExecutionEffectCoverage {
  const router = new ExecutionEffectRouter();
  return router.bindSimulationSinks({
    environment: selectedEnvironment,
    sinks: EXECUTION_EFFECT_KINDS.map((kind) => (
      new RunScopedInMemoryExecutionEffectSink(
        kind,
        `sink:${selectedEnvironment.run_id}:${kind}`,
        selectedEnvironment,
      )
    )),
  });
}

interface FakeDriver extends Driver {
  readonly calls: string[];
}

function fakeDriver(label: string): FakeDriver {
  const calls: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      void query;
      calls.push(`${label}:query`);
      await Promise.resolve();
      return { rows: [] };
    },
    async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
      void query;
      calls.push(`${label}:stream`);
      await Promise.resolve();
      yield { rows: [] };
    },
  };
  return {
    calls,
    init() { calls.push(`${label}:init`); return Promise.resolve(); },
    acquireConnection() { calls.push(`${label}:acquire`); return Promise.resolve(connection); },
    beginTransaction(connection: DatabaseConnection, settings: TransactionSettings) {
      void connection;
      void settings;
      calls.push(`${label}:begin`);
      return Promise.resolve();
    },
    commitTransaction() { calls.push(`${label}:commit`); return Promise.resolve(); },
    rollbackTransaction() { calls.push(`${label}:rollback`); return Promise.resolve(); },
    savepoint(connection: DatabaseConnection, name: string, compile: QueryCompiler["compileQuery"]) {
      void connection;
      void compile;
      calls.push(`${label}:savepoint:${name}`);
      return Promise.resolve();
    },
    rollbackToSavepoint(connection: DatabaseConnection, name: string, compile: QueryCompiler["compileQuery"]) {
      void connection;
      void compile;
      calls.push(`${label}:rollback-to:${name}`);
      return Promise.resolve();
    },
    releaseSavepoint(connection: DatabaseConnection, name: string, compile: QueryCompiler["compileQuery"]) {
      void connection;
      void compile;
      calls.push(`${label}:release-savepoint:${name}`);
      return Promise.resolve();
    },
    releaseConnection() { calls.push(`${label}:release`); return Promise.resolve(); },
    destroy() { calls.push(`${label}:destroy`); return Promise.resolve(); },
  };
}

describe("Simulation application coverage", () => {
  it("passes only when every mandatory and enabled module and effect boundary is isolated", () => {
    const complete = evaluateSimulationApplicationCoverage(completeCoverage({
      enabled_modules: ["assessments"],
      modules: [
        ...completeCoverage().modules,
        {
          module_id: "assessments",
          capabilities: {
            snapshot: "supported",
            queries: "supported",
            commands: "supported",
            events: "supported",
            realtime: "not_applicable",
          },
        },
      ],
    }));

    expect(complete).toEqual({
      application_parity: true,
      missing_modules: [],
      incomplete_capabilities: [],
      unsafe_effects: [],
    });
  });

  it("reports missing modules, unsupported capability and uncovered external effects", () => {
    const modules = completeCoverage().modules
      .filter((module) => module.module_id !== "attendance")
      .map((module) => module.module_id === "timetable"
        ? { ...module, capabilities: { ...module.capabilities, commands: "unsupported" as const } }
        : module);
    const evaluation = evaluateSimulationApplicationCoverage(completeCoverage({
      modules,
      external_connector_mode: "unsupported",
      uncovered_effects: ["payment_provider"],
    }));

    expect(evaluation.application_parity).toBe(false);
    expect(evaluation.missing_modules).toContain("attendance");
    expect(evaluation.incomplete_capabilities).toContain("timetable:commands");
    expect(evaluation.unsafe_effects).toEqual(["external_connectors", "payment_provider"]);
  });
});

describe("ExecutionDataPlaneRegistry", () => {
  it("does not accept application-manifest claims without runtime effect coverage", async () => {
    const isolated = fakeDriver("isolated");
    const inputWithoutEffectCoverage = {
      environment: environment(),
      coverage: completeCoverage(),
      driver: isolated,
    } as unknown as Parameters<ExecutionDataPlaneRegistry["prepare"]>[0];

    await expect(new ExecutionDataPlaneRegistry().prepare(inputWithoutEffectCoverage))
      .rejects.toMatchObject({ code: "invalid_effect_coverage" });
    expect(isolated.calls).toEqual([]);
  });

  it("records incomplete coverage as blocked without initializing its driver", async () => {
    const registry = new ExecutionDataPlaneRegistry();
    const isolated = fakeDriver("isolated");
    const descriptor = await registry.prepare({
      environment: environment(),
      coverage: completeCoverage({ modules: [] }),
      effectCoverage: completeEffectCoverage(),
      driver: isolated,
    });

    expect(descriptor.status).toBe("blocked");
    expect(descriptor.application_parity).toBe(false);
    expect(isolated.calls).toEqual([]);
    expect(() => registry.assertReady({
      institutionId: "school-cis",
      runId: "run-001",
      namespaceId: "scenario:whole-campus:run:run-001",
    })).toThrowError(expect.objectContaining<Partial<ExecutionDataPlaneError>>({
      code: "application_parity_incomplete",
    }));
  });

  it("blocks when the exact run has no bound effect sinks, even if the manifest claims isolation", async () => {
    const selectedEnvironment = environment();
    const isolated = fakeDriver("isolated");
    const effectCoverage = new ExecutionEffectRouter().coverage(selectedEnvironment);
    const descriptor = await new ExecutionDataPlaneRegistry().prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage,
      driver: isolated,
    });

    expect(descriptor).toMatchObject({
      status: "blocked",
      application_parity: false,
    });
    expect(descriptor.unsafe_effects).toContain("effect_boundary_not_ready");
    expect(descriptor.unsafe_effects).toContain("effect_sink:external_notification");
    expect(isolated.calls).toEqual([]);
  });

  it("rejects effect coverage from another run namespace before driver initialization", async () => {
    const selectedEnvironment = environment("run-001");
    const isolated = fakeDriver("isolated");
    const otherEnvironment = environment("run-002");

    await expect(new ExecutionDataPlaneRegistry().prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage: completeEffectCoverage(otherEnvironment),
      driver: isolated,
    })).rejects.toMatchObject({ code: "invalid_effect_coverage" });
    expect(isolated.calls).toEqual([]);
  });

  it("blocks a production-reachable effect boundary before driver initialization", async () => {
    const selectedEnvironment = environment();
    const isolated = fakeDriver("isolated");
    const effectCoverage: ExecutionEffectCoverage = {
      ...completeEffectCoverage(selectedEnvironment),
      production_ports_reachable: true,
    };
    const descriptor = await new ExecutionDataPlaneRegistry().prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage,
      driver: isolated,
    });

    expect(descriptor.status).toBe("blocked");
    expect(descriptor.application_parity).toBe(false);
    expect(descriptor.unsafe_effects).toContain("production_effect_ports_reachable");
    expect(isolated.calls).toEqual([]);
  });

  it("initializes and resolves a complete independently isolated data plane", async () => {
    const registry = new ExecutionDataPlaneRegistry();
    const live = fakeDriver("live");
    const isolated = fakeDriver("isolated");
    registry.attachLiveDriver(live);
    const selectedEnvironment = environment();

    const descriptor = await registry.prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage: completeEffectCoverage(selectedEnvironment),
      driver: isolated,
    });

    expect(descriptor).toMatchObject({ status: "ready", application_parity: true });
    expect(registry.assertEnvironmentReady(selectedEnvironment)).toBe(descriptor);
    expect(registry.driverFor(selectedEnvironment)).toBe(isolated);
    expect(isolated.calls).toEqual(["isolated:init"]);
    await expect(registry.discard(selectedEnvironment.namespace_id)).resolves.toBe(true);
    expect(isolated.calls).toEqual(["isolated:init", "isolated:destroy"]);
  });

  it("rejects reuse of the Live driver as a fake isolated plane", async () => {
    const registry = new ExecutionDataPlaneRegistry();
    const live = fakeDriver("live");
    registry.attachLiveDriver(live);

    await expect(registry.prepare({
      environment: environment(),
      coverage: completeCoverage(),
      effectCoverage: completeEffectCoverage(),
      driver: live,
    })).rejects.toMatchObject({ code: "live_driver_reuse_forbidden" });
  });

  it("fails closed for an unregistered or cross-institution Simulation request", async () => {
    const registry = new ExecutionDataPlaneRegistry();
    const selectedEnvironment = environment();
    await registry.prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage: completeEffectCoverage(selectedEnvironment),
      driver: fakeDriver("isolated"),
    });

    expect(() => registry.assertReady({
      institutionId: "another-school",
      runId: selectedEnvironment.run_id,
      namespaceId: selectedEnvironment.namespace_id,
    })).toThrowError(expect.objectContaining<Partial<ExecutionDataPlaneError>>({
      code: "data_plane_identity_mismatch",
    }));
    expect(() => registry.assertReady({
      institutionId: "school-cis",
      runId: "missing-run",
      namespaceId: "scenario:missing:run:missing-run",
    })).toThrowError(expect.objectContaining<Partial<ExecutionDataPlaneError>>({
      code: "data_plane_not_found",
    }));
  });
});

describe("ExecutionRoutingDriver", () => {
  it("routes unchanged database calls to Live by default and to a ready isolated plane in Simulation", async () => {
    const scope = new ExecutionDataPlaneScope();
    const registry = new ExecutionDataPlaneRegistry();
    const live = fakeDriver("live");
    const isolated = fakeDriver("isolated");
    const routing = new ExecutionRoutingDriver(live, scope, registry);
    await routing.init();
    const selectedEnvironment = environment();
    await registry.prepare({
      environment: selectedEnvironment,
      coverage: completeCoverage(),
      effectCoverage: completeEffectCoverage(selectedEnvironment),
      driver: isolated,
    });

    const liveConnection = await routing.acquireConnection();
    await liveConnection.executeQuery({ sql: "select 1", parameters: [], query: undefined } as unknown as CompiledQuery);
    await routing.releaseConnection(liveConnection);

    await scope.run(selectedEnvironment, async () => {
      const simulationConnection = await routing.acquireConnection();
      await routing.beginTransaction(simulationConnection, {});
      await simulationConnection.executeQuery({ sql: "select 1", parameters: [], query: undefined } as unknown as CompiledQuery);
      await routing.commitTransaction(simulationConnection);
      await routing.releaseConnection(simulationConnection);
    });

    expect(live.calls).toEqual(["live:init", "live:acquire", "live:query", "live:release"]);
    expect(isolated.calls).toEqual([
      "isolated:init",
      "isolated:acquire",
      "isolated:begin",
      "isolated:query",
      "isolated:commit",
      "isolated:release",
    ]);
    await routing.destroy();
  });

  it("never falls back to Live when a Simulation request has no ready plane", async () => {
    const scope = new ExecutionDataPlaneScope();
    const registry = new ExecutionDataPlaneRegistry();
    const live = fakeDriver("live");
    const routing = new ExecutionRoutingDriver(live, scope, registry);
    await routing.init();
    const liveCallsBefore = [...live.calls];

    await expect(scope.run(environment("missing-run"), () => routing.acquireConnection()))
      .rejects.toMatchObject({ code: "data_plane_not_found" });
    expect(live.calls).toEqual(liveCallsBefore);
    await routing.destroy();
  });
});
