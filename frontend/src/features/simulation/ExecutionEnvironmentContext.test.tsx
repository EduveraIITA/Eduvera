import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExecutionEnvironmentProvider,
  useExecutionEnvironment,
  useSimulationExecutionEnvironment,
} from "./ExecutionEnvironmentContext";
import {
  ExecutionEnvironmentInvariantError,
  LIVE_EXECUTION_ENVIRONMENT,
  createSimulationExecutionEnvironment,
  executionEnvironmentFromWire,
} from "./executionEnvironment";

function EnvironmentProbe() {
  const environment = useExecutionEnvironment();
  return (
    <output>
      {environment.mode === "live"
        ? "live"
        : environment.unavailable === true
          ? `${environment.runId} unavailable`
          : `${environment.runId} at ${environment.virtualClock.now}`}
    </output>
  );
}

function SimulationProbe() {
  const environment = useSimulationExecutionEnvironment();
  return <output>{environment.namespaceId}</output>;
}

describe("ExecutionEnvironmentProvider", () => {
  afterEach(cleanup);

  it("makes a validated simulation descriptor available to descendants", () => {
    const environment = createSimulationExecutionEnvironment({
      namespaceId: "namespace-1",
      runId: "run-1",
      virtualClock: {
        now: "2026-10-19T09:15:00.000+05:30",
        timeZone: "Asia/Kolkata",
      },
    });

    render(
      <ExecutionEnvironmentProvider environment={environment}>
        <EnvironmentProbe />
      </ExecutionEnvironmentProvider>,
    );

    expect(screen.getByText(/run-1 at 2026-10-19/)).toBeInTheDocument();
  });

  it("fails closed when the hook is outside a provider", () => {
    expect(() => render(<EnvironmentProbe />)).toThrow(
      ExecutionEnvironmentInvariantError,
    );
  });

  it("does not let a simulation-only surface consume live context", () => {
    expect(() =>
      render(
        <ExecutionEnvironmentProvider environment={LIVE_EXECUTION_ENVIRONMENT}>
          <SimulationProbe />
        </ExecutionEnvironmentProvider>,
      ),
    ).toThrow("requires an isolated simulation execution environment");
  });

  it("does not let an executable simulation surface consume an unavailable tombstone", () => {
    const unavailable = executionEnvironmentFromWire({
      mode: "simulation",
      unavailable: true,
      unavailable_reason: "run_unavailable",
      namespace_id: "scenario:one:run:two",
      run_id: "two",
    });
    expect(() =>
      render(
        <ExecutionEnvironmentProvider environment={unavailable}>
          <SimulationProbe />
        </ExecutionEnvironmentProvider>,
      ),
    ).toThrow("requires an isolated simulation execution environment");
  });
});
