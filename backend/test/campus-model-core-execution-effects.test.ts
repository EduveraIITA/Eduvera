import type { ExecutionEffectBoundaryError } from "../src/campus-model-core/execution-effects.runtime.js";
import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionEffectIntent,
  ExecutionEffectKind,
  LiveExecutionEffectReceipt,
  ProductionExecutionEffectPort,
  SimulationExecutionEffectSink,
} from "../src/campus-model-core/execution-effects.contracts.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import {
  ExecutionEffectRouter,
  RunScopedInMemoryExecutionEffectSink,
} from "../src/campus-model-core/execution-effects.runtime.js";
import type {
  ExecutionClock,
  SimulationVirtualClock,
} from "../src/campus-model-core/execution-environment.contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";

const instant = "2026-10-17T06:30:00.000Z";

const liveClock: ExecutionClock = {
  now: () => new Date(instant),
  nowIso: () => instant,
};

const virtualClock: SimulationVirtualClock = {
  now: () => new Date(instant),
  nowIso: () => instant,
  advanceBy: () => instant,
  advanceTo: () => instant,
};

function liveEnvironment() {
  return createLiveExecutionEnvironment({
    institution_id: "school-cis",
    clock: liveClock,
  });
}

function simulationEnvironment(runId = "run-001") {
  return createSimulationExecutionEnvironment({
    institution_id: "school-cis",
    scenario_id: "staff-cover",
    run_id: runId,
    virtual_clock: virtualClock,
    source_snapshot_ref: "snapshot:campus:42",
    coverage_gate: {
      status: "passed",
      manifest_ref: "coverage:campus:42",
      checked_at: "2026-10-17T06:29:00.000Z",
    },
    expires_at: "2026-10-17T07:30:00.000Z",
  });
}

function intent(
  namespaceId: string,
  overrides: Partial<ExecutionEffectIntent> = {},
): ExecutionEffectIntent {
  return {
    kind: "external_notification",
    effect_id: "effect-attendance-reminder-1",
    schema_name: "attendance.reminder.requested",
    schema_version: 1,
    institution_id: "school-cis",
    namespace_id: namespaceId,
    idempotency_key: "attendance:register-9:reminder:1",
    correlation_id: "trace-register-9",
    causation_id: "event-register-due-9",
    requested_at: instant,
    actor_agent_id: "software-attendance-coordinator",
    logical_target: { kind: "human_agent", ref: "teacher-kavita" },
    privacy_class: "institution_internal",
    payload: { template: "attendance_reminder", register_ref: "register-9" },
    ...overrides,
  };
}

function simulationSinks(
  environment: ReturnType<typeof simulationEnvironment>,
): SimulationExecutionEffectSink[] {
  return EXECUTION_EFFECT_KINDS.map((kind) => (
    new RunScopedInMemoryExecutionEffectSink(kind, `sink:${kind}`, environment)
  ));
}

function livePort(
  kind: ExecutionEffectKind,
  execute?: ProductionExecutionEffectPort["execute"],
): ProductionExecutionEffectPort {
  const portId = `production:${kind}`;
  return {
    mode: "production",
    kind,
    port_id: portId,
    execute: execute ?? (({ environment, intent: effectIntent }) => Promise.resolve({
      environment_kind: "live",
      effect_kind: kind,
      effect_id: effectIntent.effect_id,
      idempotency_key: effectIntent.idempotency_key,
      namespace_id: environment.namespace_id,
      port_id: portId,
      status: "accepted",
      recorded_at: environment.clock.nowIso(),
      provider_receipt_ref: "provider-receipt:1",
    } satisfies LiveExecutionEffectReceipt)),
  };
}

describe("Campus Model Core external-effect boundary", () => {
  it("routes Live effects only through the registered production port", async () => {
    const environment = liveEnvironment();
    const implementation = livePort("external_notification");
    const execute = vi.fn<ProductionExecutionEffectPort["execute"]>(
      (input) => implementation.execute(input),
    );
    const router = new ExecutionEffectRouter();
    router.registerProductionPort(livePort("external_notification", execute));

    const receipt = await router.route(
      environment,
      intent(environment.namespace_id),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(receipt).toMatchObject({
      environment_kind: "live",
      effect_kind: "external_notification",
      namespace_id: "live:school-cis",
      port_id: "production:external_notification",
      status: "accepted",
    });
  });

  it("routes Simulation effects to the exact run sink without touching Live ports", async () => {
    const environment = simulationEnvironment();
    const implementation = livePort("external_notification");
    const execute = vi.fn<ProductionExecutionEffectPort["execute"]>(
      (input) => implementation.execute(input),
    );
    const router = new ExecutionEffectRouter();
    router.registerProductionPort(livePort("external_notification", execute));
    const sinks = simulationSinks(environment);
    const notificationSink = sinks.find((sink) => sink.kind === "external_notification");
    router.bindSimulationSinks({ environment, sinks });

    const receipt = await router.route(
      environment,
      intent(environment.namespace_id),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      environment_kind: "simulation",
      effect_kind: "external_notification",
      namespace_id: "scenario:staff-cover:run:run-001",
      run_id: "run-001",
      status: "captured",
    });
    expect(notificationSink).toBeInstanceOf(RunScopedInMemoryExecutionEffectSink);
    expect((notificationSink as RunScopedInMemoryExecutionEffectSink<"external_notification">).records())
      .toHaveLength(1);
  });

  it("never falls back to a Live port when a Simulation sink set is absent", async () => {
    const environment = simulationEnvironment();
    const implementation = livePort("external_notification");
    const execute = vi.fn<ProductionExecutionEffectPort["execute"]>(
      (input) => implementation.execute(input),
    );
    const router = new ExecutionEffectRouter();
    router.registerProductionPort(livePort("external_notification", execute));

    await expect(router.route(environment, intent(environment.namespace_id)))
      .rejects.toMatchObject({
        code: "simulation_sink_set_missing",
      });
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires an explicit run-scoped sink for every reviewed external-effect kind", () => {
    const environment = simulationEnvironment();
    const incomplete = simulationSinks(environment).filter((sink) => sink.kind !== "file_write");
    const router = new ExecutionEffectRouter();

    expect(() => router.bindSimulationSinks({ environment, sinks: incomplete }))
      .toThrowError(expect.objectContaining<Partial<ExecutionEffectBoundaryError>>({
        code: "invalid_simulation_sink_set",
      }));
    expect(router.coverage(environment)).toMatchObject({
      status: "blocked",
      production_ports_reachable: false,
      missing_kinds: EXECUTION_EFFECT_KINDS,
    });
  });

  it("rejects a sink from another run even when its effect kind matches", () => {
    const selected = simulationEnvironment("run-001");
    const other = simulationEnvironment("run-002");
    const sinks = simulationSinks(selected);
    sinks[0] = new RunScopedInMemoryExecutionEffectSink(
      sinks[0]!.kind,
      "sink:wrong-run",
      other,
    );

    expect(() => new ExecutionEffectRouter().bindSimulationSinks({ environment: selected, sinks }))
      .toThrowError(expect.objectContaining<Partial<ExecutionEffectBoundaryError>>({
        code: "simulation_sink_scope_mismatch",
      }));
  });

  it("does not allow a run's sink boundary to be silently rebound", () => {
    const environment = simulationEnvironment();
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks: simulationSinks(environment) });

    expect(() => router.bindSimulationSinks({
      environment,
      sinks: simulationSinks(environment),
    })).toThrowError(expect.objectContaining<Partial<ExecutionEffectBoundaryError>>({
      code: "simulation_sink_set_already_bound",
    }));
  });

  it("rejects a sink receipt that claims another Simulation run", async () => {
    const environment = simulationEnvironment();
    const sinks = simulationSinks(environment);
    const invalidSink: SimulationExecutionEffectSink = {
      mode: "sink_only",
      kind: "external_notification",
      sink_id: "sink:external_notification",
      namespace_id: environment.namespace_id,
      scenario_id: environment.scenario_id,
      run_id: environment.run_id,
      capture: ({ intent: effectIntent }) => Promise.resolve({
        environment_kind: "simulation",
        effect_kind: effectIntent.kind,
        effect_id: effectIntent.effect_id,
        idempotency_key: effectIntent.idempotency_key,
        namespace_id: "scenario:staff-cover:run:run-002",
        scenario_id: environment.scenario_id,
        run_id: "run-002",
        sink_id: "sink:external_notification",
        sink_record_id: "sink:wrong-run",
        status: "captured",
        recorded_at: instant,
      }),
    };
    sinks[sinks.findIndex((sink) => sink.kind === "external_notification")] = invalidSink;
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks });

    await expect(router.route(environment, intent(environment.namespace_id)))
      .rejects.toMatchObject({
        code: "invalid_effect_receipt",
      });
  });

  it("rejects cross-environment intents before resolving any port", async () => {
    const environment = simulationEnvironment();
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks: simulationSinks(environment) });

    await expect(router.route(environment, intent("live:school-cis")))
      .rejects.toMatchObject({
        code: "effect_environment_mismatch",
      });
  });

  it("deduplicates identical scenario effects and rejects changed-payload key reuse", async () => {
    const environment = simulationEnvironment();
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks: simulationSinks(environment) });
    const effect = intent(environment.namespace_id);

    const first = await router.route(environment, effect);
    const duplicate = await router.route(environment, effect);
    const changed = intent(environment.namespace_id, {
      payload: { template: "attendance_reminder", register_ref: "register-10" },
    });

    expect(first.status).toBe("captured");
    expect(duplicate.status).toBe("deduplicated");
    await expect(router.route(environment, changed))
      .rejects.toMatchObject({
        code: "effect_idempotency_conflict",
      });
  });

  it("makes Simulation effects unreachable after the run sinks are discarded", async () => {
    const environment = simulationEnvironment();
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks: simulationSinks(environment) });

    expect(router.discardSimulationSinks(environment)).toBe(true);
    expect(router.coverage(environment)).toMatchObject({
      status: "blocked",
      production_ports_reachable: false,
    });
    await expect(router.route(environment, intent(environment.namespace_id)))
      .rejects.toMatchObject({
        code: "simulation_sink_set_missing",
      });
  });

  it("reports explicit Live and Simulation coverage without claiming call-site adoption", () => {
    const live = liveEnvironment();
    const simulation = simulationEnvironment();
    const router = new ExecutionEffectRouter();
    router.registerProductionPort(livePort("external_notification"));
    router.bindSimulationSinks({ environment: simulation, sinks: simulationSinks(simulation) });

    expect(router.coverage(live)).toMatchObject({
      environment_kind: "live",
      status: "blocked",
      configured_kinds: ["external_notification"],
      production_ports_reachable: true,
    });
    expect(router.coverage(simulation)).toMatchObject({
      environment_kind: "simulation",
      status: "ready",
      configured_kinds: EXECUTION_EFFECT_KINDS,
      missing_kinds: [],
      production_ports_reachable: false,
    });
  });
});
