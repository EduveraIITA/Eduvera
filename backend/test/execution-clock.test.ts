import { describe, expect, it } from "vitest";
import type { ExecutionClock } from "../src/campus-model-core/execution-environment.contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import {
  ScopedExecutionClock,
} from "../src/database/execution-clock.runtime.js";
import type { ExecutionClockError } from "../src/database/execution-clock.runtime.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";

const INSTITUTION_ID = "00000000-0000-4000-8000-000000000001";
const context = { institution_id: INSTITUTION_ID, time_zone: "Asia/Kolkata" } as const;

function fixedClock(instant: string): ExecutionClock {
  return {
    now: () => new Date(instant),
    nowIso: () => instant,
  };
}

describe("ScopedExecutionClock", () => {
  it("uses the injected wall clock outside a Simulation request and formats in institution time", () => {
    const scope = new ExecutionDataPlaneScope();
    const clock = new ScopedExecutionClock(scope, fixedClock("2026-10-17T20:45:10.000Z"));

    expect(clock.read(context)).toMatchObject({
      environment_kind: "live",
      namespace_id: null,
      institution_id: INSTITUTION_ID,
      iso_instant: "2026-10-17T20:45:10.000Z",
      time_zone: "Asia/Kolkata",
      local_date: "2026-10-18",
      local_time: "02:15:10",
    });
  });

  it("uses the trusted Live environment clock when the request is scoped", () => {
    const scope = new ExecutionDataPlaneScope();
    const clock = new ScopedExecutionClock(scope, fixedClock("1999-01-01T00:00:00.000Z"));
    const live = createLiveExecutionEnvironment({
      institution_id: INSTITUTION_ID,
      clock: fixedClock("2026-10-17T03:30:00.000Z"),
    });

    const reading = scope.run(live, () => clock.read(context));

    expect(reading).toMatchObject({
      environment_kind: "live",
      namespace_id: `live:${INSTITUTION_ID}`,
      iso_instant: "2026-10-17T03:30:00.000Z",
      local_date: "2026-10-17",
      local_time: "09:00:00",
    });
  });

  it("uses only the session-scoped virtual clock in Simulation", () => {
    const scope = new ExecutionDataPlaneScope();
    const clock = new ScopedExecutionClock(scope, fixedClock("1999-01-01T00:00:00.000Z"));
    const virtual = fixedClock("2026-11-02T06:15:30.000Z");
    const simulation = createSimulationExecutionEnvironment({
      institution_id: INSTITUTION_ID,
      scenario_id: "00000000-0000-4000-8000-000000000002",
      run_id: "00000000-0000-4000-8000-000000000003",
      virtual_clock: {
        ...virtual,
        advanceBy: () => { throw new Error("request clocks are read-only"); },
        advanceTo: () => { throw new Error("request clocks are read-only"); },
      },
      source_snapshot_ref: "snapshot:one",
      coverage_gate: {
        status: "passed",
        manifest_ref: "manifest:complete",
        checked_at: "2026-10-17T10:00:00.000Z",
      },
      expires_at: "2099-10-17T11:00:00.000Z",
    });

    const reading = scope.run(simulation, () => clock.read(context));

    expect(reading).toMatchObject({
      environment_kind: "simulation",
      namespace_id: simulation.namespace_id,
      iso_instant: "2026-11-02T06:15:30.000Z",
      local_date: "2026-11-02",
      local_time: "11:45:30",
    });
  });

  it("rejects cross-institution and invalid-timezone reads", () => {
    const scope = new ExecutionDataPlaneScope();
    const clock = new ScopedExecutionClock(scope, fixedClock("2026-10-17T03:30:00.000Z"));
    const live = createLiveExecutionEnvironment({
      institution_id: INSTITUTION_ID,
      clock: fixedClock("2026-10-17T03:30:00.000Z"),
    });

    expect(() => scope.run(live, () => clock.institutionDate({
      institution_id: "00000000-0000-4000-8000-000000000099",
      time_zone: "Asia/Kolkata",
    }))).toThrowError(expect.objectContaining<Partial<ExecutionClockError>>({
      code: "invalid_institution",
    }));
    expect(() => clock.institutionDate({
      institution_id: INSTITUTION_ID,
      time_zone: "not/a-timezone",
    })).toThrowError(expect.objectContaining<Partial<ExecutionClockError>>({
      code: "invalid_time_zone",
    }));
  });

  it("returns defensive Date copies instead of exposing a virtual clock's mutable object", () => {
    const retained = new Date("2026-10-17T03:30:00.000Z");
    const scope = new ExecutionDataPlaneScope();
    const clock = new ScopedExecutionClock(scope, {
      now: () => retained,
      nowIso: () => retained.toISOString(),
    });

    const first = clock.now();
    first.setUTCFullYear(2000);

    expect(retained.toISOString()).toBe("2026-10-17T03:30:00.000Z");
    expect(clock.nowIso()).toBe("2026-10-17T03:30:00.000Z");
  });
});
