import { describe, expect, it } from "vitest";
import { SIMULATION_WORLD_METRIC_CATALOGUE, simulationMetricLabel } from "../src/simulation/simulation-metrics.js";

describe("Simulation metric definitions", () => {
  it("distinguishes submission from finalization while retaining stable metric identities", () => {
    expect(SIMULATION_WORLD_METRIC_CATALOGUE.submitted_registers).toEqual({
      key: "submitted_registers", label: "New attendance submissions since snapshot", unit: "registers",
    });
    expect(SIMULATION_WORLD_METRIC_CATALOGUE.finalized_registers).toEqual({
      key: "finalized_registers", label: "Attendance registers finalized since snapshot", unit: "registers",
    });
    expect(simulationMetricLabel("submitted_registers", "Completed attendance registers"))
      .toBe("New attendance submissions since snapshot");
  });

  it("preserves unknown metric labels rather than inventing a metric or sample", () => {
    expect(simulationMetricLabel("another_domain", "Recorded label")).toBe("Recorded label");
    expect(simulationMetricLabel("another_domain", null)).toBeNull();
    expect(simulationMetricLabel("constructor", null)).toBeNull();
  });
});
