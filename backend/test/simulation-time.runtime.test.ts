import { describe, expect, it } from "vitest";
import {
  advanceTarget,
  greatestCommonCheckpointDuration,
  metricDelta,
  nextSimulationWakeAt,
  projectedVirtualNow,
  simulationReachedEnd,
} from "../src/simulation/simulation-time.runtime.js";
import type { PersistedSimulationRun } from "../src/simulation/simulation.contracts.js";

const virtualStart = "2026-10-19T03:30:00.000Z";
const wallStart = "2026-10-19T06:00:00.000Z";

function clockRun(
  overrides: Partial<Pick<PersistedSimulationRun,
    "status" | "speed" | "virtual_started_at" | "virtual_now" | "wall_anchor_at" | "virtual_anchor_at" | "end_at">> = {},
) {
  return {
    status: "running" as const,
    speed: 20,
    virtual_started_at: virtualStart,
    virtual_now: virtualStart,
    wall_anchor_at: wallStart,
    virtual_anchor_at: virtualStart,
    end_at: null,
    ...overrides,
  };
}

describe("durable Simulation virtual time", () => {
  it("advances at the selected speed without mutating committed time", () => {
    expect(projectedVirtualNow(
      clockRun(),
      "2026-10-19T06:01:00.000Z",
    )).toBe("2026-10-19T03:50:00.000Z");

    expect(projectedVirtualNow(
      clockRun({ speed: 100 }),
      "2026-10-19T06:01:00.000Z",
    )).toBe("2026-10-19T05:10:00.000Z");
  });

  it("keeps paused and stopped worlds fixed even when wall time continues", () => {
    for (const status of ["draft", "paused", "stopped", "completed"] as const) {
      expect(projectedVirtualNow(
        clockRun({ status, wall_anchor_at: null, virtual_anchor_at: null }),
        "2026-10-20T06:00:00.000Z",
      )).toBe(virtualStart);
    }
  });

  it("caps an uncommitted projection at the optional virtual end", () => {
    expect(projectedVirtualNow(
      clockRun({ end_at: "2026-10-19T04:00:00.000Z" }),
      "2026-10-19T06:05:00.000Z",
    )).toBe("2026-10-19T04:00:00.000Z");
    expect(simulationReachedEnd(
      "2026-10-19T04:00:00.000Z",
      "2026-10-19T04:00:00.000Z",
    )).toBe(true);
    expect(simulationReachedEnd(virtualStart, null)).toBe(false);
  });

  it("never moves behind a committed checkpoint when wall time moves backwards", () => {
    expect(projectedVirtualNow(
      clockRun({
        virtual_now: "2026-10-19T04:15:00.000Z",
        virtual_anchor_at: virtualStart,
      }),
      "2026-10-19T05:59:00.000Z",
    )).toBe("2026-10-19T04:15:00.000Z");
  });

  it("aligns every worker advance to a shared five-minute virtual checkpoint", () => {
    expect(advanceTarget({
      run: clockRun(),
      wall_now: "2026-10-21T06:00:00.000Z",
    })).toBe("2026-10-19T03:35:00.000Z");

    expect(advanceTarget({
      run: clockRun(),
      wall_now: "2026-10-19T06:10:00.000Z",
      max_step_ms: 60 * 60 * 1_000,
    })).toBe("2026-10-19T03:35:00.000Z");

    expect(advanceTarget({
      run: clockRun({
        virtual_now: "2026-10-19T03:32:00.000Z",
        virtual_anchor_at: "2026-10-19T03:32:00.000Z",
        wall_anchor_at: "2026-10-19T06:00:06.000Z",
      }),
      wall_now: "2026-10-19T06:01:00.000Z",
    })).toBe("2026-10-19T03:35:00.000Z");
  });

  it("wakes for the earliest event, end or checkpoint quantum in wall time", () => {
    expect(nextSimulationWakeAt({
      wall_now: wallStart,
      virtual_now: virtualStart,
      speed: 20,
      end_at: null,
      next_event_at: "2026-10-19T03:32:00.000Z",
    })).toBe("2026-10-19T06:00:06.000Z");

    expect(nextSimulationWakeAt({
      wall_now: wallStart,
      virtual_now: virtualStart,
      speed: 20,
      end_at: "2026-10-19T03:31:00.000Z",
      next_event_at: "2026-10-19T03:32:00.000Z",
    })).toBe("2026-10-19T06:00:03.000Z");

    expect(nextSimulationWakeAt({
      wall_now: wallStart,
      virtual_now: virtualStart,
      speed: 20,
      end_at: null,
      next_event_at: null,
    })).toBe("2026-10-19T06:00:15.000Z");
  });

  it("uses the durable clock anchor to catch up immediately after a late worker or restart", () => {
    expect(nextSimulationWakeAt({
      wall_now: "2026-10-19T06:01:00.000Z",
      wall_anchor_at: wallStart,
      virtual_anchor_at: virtualStart,
      virtual_now: "2026-10-19T03:35:00.000Z",
      virtual_started_at: virtualStart,
      speed: 20,
      end_at: null,
      next_event_at: null,
    })).toBe("2026-10-19T06:01:00.001Z");
  });
});

describe("Simulation comparison alignment", () => {
  it("uses only the greatest checkpoint completed by every selected run", () => {
    expect(greatestCommonCheckpointDuration([
      [0, 300_000, 600_000, 900_000],
      [0, 300_000, 600_000],
      [0, 600_000, 1_200_000],
    ])).toBe(600_000);

    expect(greatestCommonCheckpointDuration([
      [0, 300_000, 600_000],
      [0, 300_000, 600_000],
    ], 450_000)).toBe(300_000);
  });

  it("refuses to compare runs without a common completed checkpoint", () => {
    expect(() => greatestCommonCheckpointDuration([
      [300_000],
      [600_000],
    ])).toThrow(/do not yet share/i);
  });

  it("keeps unknown metrics unknown and avoids a misleading percentage from zero", () => {
    expect(metricDelta(10, 15)).toEqual({ delta: 5, delta_percent: 50 });
    expect(metricDelta(0, 5)).toEqual({ delta: 5, delta_percent: null });
    expect(metricDelta(null, 5)).toEqual({ delta: null, delta_percent: null });
  });
});
