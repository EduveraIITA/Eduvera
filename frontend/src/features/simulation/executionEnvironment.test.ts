import { describe, expect, it } from "vitest";
import {
  ExecutionEnvironmentInvariantError,
  LIVE_EXECUTION_ENVIRONMENT,
  createSimulationExecutionEnvironment,
  executionEnvironmentFromWire,
  normalizeExecutionEnvironment,
} from "./executionEnvironment";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";

const virtualClock = {
  now: "2026-10-19T09:15:00.000+05:30",
  timeZone: "Asia/Kolkata",
};

describe("execution environment descriptors", () => {
  it("keeps live execution free of simulation coordinates", () => {
    expect(normalizeExecutionEnvironment({ mode: "live" })).toBe(
      LIVE_EXECUTION_ENVIRONMENT,
    );
    expect(() =>
      normalizeExecutionEnvironment({ mode: "live", runId: undefined }),
    ).toThrow(ExecutionEnvironmentInvariantError);
    expect(() =>
      normalizeExecutionEnvironment({ mode: "live", virtualClock }),
    ).toThrow("cannot carry simulation run state");
  });

  it("requires a namespace, run and valid virtual clock for simulation", () => {
    expect(() =>
      normalizeExecutionEnvironment({
        mode: "simulation",
        namespaceId: "scenario-space",
        virtualClock,
      }),
    ).toThrow("runId");
    expect(() =>
      normalizeExecutionEnvironment({
        mode: "simulation",
        namespaceId: "scenario-space",
        runId: "run-1",
      }),
    ).toThrow("virtual clock");
    expect(() =>
      normalizeExecutionEnvironment({
        mode: "simulation",
        namespaceId: "scenario-space",
        runId: "run-1",
        virtualClock: { now: "not-a-time", timeZone: "Asia/Kolkata" },
      }),
    ).toThrow("ISO date-time");
    expect(() =>
      normalizeExecutionEnvironment({
        mode: "simulation",
        namespaceId: "scenario-space",
        runId: "run-1",
        virtualClock: { now: virtualClock.now, timeZone: "Mars/Olympus" },
      }),
    ).toThrow("valid IANA time zone");
  });

  it("normalizes and freezes trusted simulation coordinates", () => {
    const environment = createSimulationExecutionEnvironment({
      namespaceId: " namespace-1 ",
      runId: " run-1 ",
      virtualClock,
    });

    expect(environment).toEqual({
      mode: "simulation",
      namespaceId: "namespace-1",
      runId: "run-1",
      virtualClock,
    });
    expect(Object.isFrozen(environment)).toBe(true);
    expect(Object.isFrozen(environment.virtualClock)).toBe(true);
  });

  it("maps the server-owned wire descriptor without accepting missing isolation coordinates", () => {
    expect(executionEnvironmentFromWire({
      mode: "live",
      namespace_id: "live:school-1",
      institution_id: "school-1",
    })).toEqual({
      mode: "live",
      namespaceId: "live:school-1",
      institutionId: "school-1",
    });
    expect(executionEnvironmentFromWire({
      mode: "live",
      namespace_id: null,
      institution_id: null,
    })).toEqual(LIVE_EXECUTION_ENVIRONMENT);
    expect(executionEnvironmentFromWire({
      mode: "simulation",
      namespace_id: "scenario:run-1",
      run_id: "run-1",
      scenario_id: "scenario-1",
      institution_id: "school-1",
      virtual_clock: { now: virtualClock.now, time_zone: virtualClock.timeZone },
    })).toMatchObject({
      mode: "simulation",
      namespaceId: "scenario:run-1",
      runId: "run-1",
      scenarioId: "scenario-1",
      institutionId: "school-1",
      virtualClock,
    });
    expect(() => executionEnvironmentFromWire({
      mode: "simulation",
      namespace_id: "scenario:run-1",
      virtual_clock: { now: virtualClock.now, time_zone: virtualClock.timeZone },
    })).toThrow("runId");
  });

  it("maps an unavailable Simulation tombstone without fabricating a virtual clock", () => {
    const unavailable = executionEnvironmentFromWire({
      mode: "simulation",
      unavailable: true,
      unavailable_reason: "data_plane_unavailable",
      namespace_id: "scenario:scenario-1:run:run-1",
      run_id: "run-1",
      scenario_id: "scenario-1",
      institution_id: "school-1",
      expires_at: "2026-10-20T09:15:00.000Z",
    });

    expect(unavailable).toEqual({
      mode: "simulation",
      unavailable: true,
      unavailableReason: "data_plane_unavailable",
      namespaceId: "scenario:scenario-1:run:run-1",
      runId: "run-1",
      scenarioId: "scenario-1",
      institutionId: "school-1",
      expiresAt: "2026-10-20T09:15:00.000Z",
    });
    expect(unavailable).not.toHaveProperty("virtualClock");
    expect(() => executionEnvironmentQueryKey(unavailable, ["attendance"])).toThrow(
      "Unavailable simulations cannot create application query keys",
    );
  });
});

describe("executionEnvironmentQueryKey", () => {
  it("isolates live data and every simulated namespace and run", () => {
    const baseKey = ["school", "school-1", "attendance", "2026-10-19"] as const;
    const firstRun = createSimulationExecutionEnvironment({
      namespaceId: "namespace-1",
      runId: "run-1",
      virtualClock,
    });
    const secondRun = createSimulationExecutionEnvironment({
      namespaceId: "namespace-1",
      runId: "run-2",
      virtualClock,
    });

    expect(executionEnvironmentQueryKey(LIVE_EXECUTION_ENVIRONMENT, baseKey)).toEqual([
      "execution-environment",
      "live",
      ...baseKey,
    ]);
    expect(executionEnvironmentQueryKey(firstRun, baseKey)).toEqual([
      "execution-environment",
      "simulation",
      "namespace-1",
      "run-1",
      ...baseKey,
    ]);
    expect(executionEnvironmentQueryKey(secondRun, baseKey)).not.toEqual(
      executionEnvironmentQueryKey(firstRun, baseKey),
    );
    expect(baseKey).toEqual([
      "school",
      "school-1",
      "attendance",
      "2026-10-19",
    ]);
  });
});
