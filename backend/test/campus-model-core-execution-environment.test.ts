import { describe, expect, it } from "vitest";
import type {
  ExecutionClock,
  SimulationVirtualClock,
} from "../src/campus-model-core/execution-environment.contracts.js";
import type {
  ExecutionEnvironmentValidationError,
} from "../src/campus-model-core/execution-environment.runtime.js";
import {
  assertExecutionEnvironment,
  bindExecutionEnvironmentPorts,
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
  isExecutionEnvironment,
  LIVE_EXECUTION_CAPABILITIES,
  selectExecutionDataPlane,
  SIMULATION_EXECUTION_CAPABILITIES,
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

function simulation() {
  return createSimulationExecutionEnvironment({
    institution_id: "school-cis",
    scenario_id: "staff-cover",
    run_id: "run-001",
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

describe("Campus Model Core execution environment", () => {
  it("creates an institution-scoped Live environment with production ports only", () => {
    const environment = createLiveExecutionEnvironment({
      institution_id: "school-cis",
      clock: liveClock,
    });

    expect(environment).toMatchObject({
      kind: "live",
      truth_mode: "authoritative_real",
      lifecycle: "persistent",
      institution_id: "school-cis",
      namespace_id: "live:school-cis",
      capabilities: LIVE_EXECUTION_CAPABILITIES,
    });
    expect(environment.capabilities.production_domain_commands).toBe(true);
    expect(environment.capabilities.scenario_event_sink).toBe(false);
    expect(isExecutionEnvironment(environment)).toBe(true);
  });

  it("creates a run-scoped Simulation environment with only isolated sinks", () => {
    const environment = simulation();

    expect(environment).toMatchObject({
      kind: "simulation",
      truth_mode: "transient_virtual",
      lifecycle: "transient_virtual_fork",
      institution_id: "school-cis",
      scenario_id: "staff-cover",
      run_id: "run-001",
      namespace_id: "scenario:staff-cover:run:run-001",
      source_live_namespace_id: "live:school-cis",
      source_snapshot_ref: "snapshot:campus:42",
      capabilities: SIMULATION_EXECUTION_CAPABILITIES,
    });
    expect(environment.capabilities.production_domain_commands).toBe(false);
    expect(environment.capabilities.external_notifications).toBe(false);
    expect(environment.capabilities.scenario_event_sink).toBe(true);
  });

  it("rejects mixed Live and Simulation fields even when their values are undefined", () => {
    const mixed = {
      ...createLiveExecutionEnvironment({ institution_id: "school-cis", clock: liveClock }),
      scenario_id: undefined,
      run_id: "run-001",
    };

    expect(() => assertExecutionEnvironment(mixed)).toThrowError(
      expect.objectContaining<Partial<ExecutionEnvironmentValidationError>>({
        code: "mixed_environment_fields",
      }),
    );
  });

  it("requires a Simulation namespace to include the exact scenario and run identities", () => {
    const malformed = {
      ...simulation(),
      namespace_id: "scenario:staff-cover",
    };

    expect(() => assertExecutionEnvironment(malformed)).toThrowError(
      expect.objectContaining<Partial<ExecutionEnvironmentValidationError>>({
        code: "invalid_environment_namespace",
      }),
    );
  });

  it("requires a server-verified coverage gate before a transient virtual fork can execute", () => {
    const notReady = {
      ...simulation(),
      coverage_gate: {
        status: "pending",
        manifest_ref: "coverage:campus:42",
        checked_at: "2026-10-17T06:29:00.000Z",
      },
    };

    expect(() => assertExecutionEnvironment(notReady)).toThrowError(
      expect.objectContaining<Partial<ExecutionEnvironmentValidationError>>({
        code: "invalid_environment_shape",
      }),
    );
  });

  it("rejects production capability injection and a Live clock in Simulation", () => {
    const productionEnabled = {
      ...simulation(),
      capabilities: {
        ...SIMULATION_EXECUTION_CAPABILITIES,
        connector_calls: true,
      },
    };
    const mixedClock = { ...simulation(), clock: liveClock };

    expect(() => assertExecutionEnvironment(productionEnabled)).toThrowError(
      expect.objectContaining<Partial<ExecutionEnvironmentValidationError>>({
        code: "invalid_environment_capabilities",
      }),
    );
    expect(() => assertExecutionEnvironment(mixedClock)).toThrowError(
      expect.objectContaining<Partial<ExecutionEnvironmentValidationError>>({
        code: "mixed_environment_fields",
      }),
    );
  });

  it("binds the same domain and projection contracts to either explicit environment", () => {
    interface AttendanceDomainPorts { submit(registerId: string): Promise<void> }
    interface AttendanceProjectionPorts { registers(): Promise<readonly string[]> }
    const domainPorts: AttendanceDomainPorts = { submit: () => Promise.resolve() };
    const projectionPorts: AttendanceProjectionPorts = { registers: () => Promise.resolve([]) };
    const live = createLiveExecutionEnvironment({ institution_id: "school-cis", clock: liveClock });

    const liveBinding = bindExecutionEnvironmentPorts(live, {
      domain_ports: domainPorts,
      projection_ports: projectionPorts,
    });
    const simulationBinding = bindExecutionEnvironmentPorts(simulation(), {
      domain_ports: domainPorts,
      projection_ports: projectionPorts,
    });

    expect(liveBinding.namespace_id).toBe("live:school-cis");
    expect(simulationBinding.namespace_id).toBe("scenario:staff-cover:run:run-001");
    expect(liveBinding.domain_ports).toBe(domainPorts);
    expect(simulationBinding.projection_ports).toBe(projectionPorts);
  });

  it("selects isolated data planes while preserving one domain and projection contract", () => {
    interface UnitOfWork { readonly name: string }
    interface AttendanceDomainPorts { readonly contract: "attendance-v1" }
    interface AttendanceProjectionPorts { readonly contract: "attendance-projection-v1" }
    const live = createLiveExecutionEnvironment({ institution_id: "school-cis", clock: liveClock });
    const calls: string[] = [];
    const adapters = {
      live: () => {
        calls.push("live");
        return {
          unit_of_work: { name: "postgres-live" },
          domain_ports: { contract: "attendance-v1" as const },
          projection_ports: { contract: "attendance-projection-v1" as const },
        };
      },
      simulation: () => {
        calls.push("simulation");
        return {
          unit_of_work: { name: "scenario-copy-on-write" },
          domain_ports: { contract: "attendance-v1" as const },
          projection_ports: { contract: "attendance-projection-v1" as const },
        };
      },
    };

    const liveContext = selectExecutionDataPlane<
      UnitOfWork,
      AttendanceDomainPorts,
      AttendanceProjectionPorts
    >(live, adapters);
    const simulationContext = selectExecutionDataPlane<
      UnitOfWork,
      AttendanceDomainPorts,
      AttendanceProjectionPorts
    >(simulation(), adapters);

    expect(calls).toEqual(["live", "simulation"]);
    expect(liveContext).toMatchObject({
      storage_mode: "authoritative_live_unit_of_work",
      effects_mode: "production_ports",
      unit_of_work: { name: "postgres-live" },
    });
    expect(simulationContext).toMatchObject({
      storage_mode: "isolated_copy_on_write",
      effects_mode: "sink_only",
      unit_of_work: { name: "scenario-copy-on-write" },
    });
    expect(liveContext.domain_ports.contract).toBe(simulationContext.domain_ports.contract);
    expect(liveContext.projection_ports.contract).toBe(simulationContext.projection_ports.contract);
  });
});
