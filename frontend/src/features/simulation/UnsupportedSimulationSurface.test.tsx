import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "./ExecutionEnvironmentContext";
import { UnsupportedSimulationSurface } from "./UnsupportedSimulationSurface";
import { createSimulationExecutionEnvironment } from "./executionEnvironment";

const simulation = createSimulationExecutionEnvironment({
  namespaceId: "namespace-1",
  runId: "run-1",
  virtualClock: {
    now: "2026-10-19T09:15:00.000+05:30",
    timeZone: "Asia/Kolkata",
  },
});

describe("UnsupportedSimulationSurface", () => {
  afterEach(cleanup);

  it("explains the safe boundary without showing a live fallback", async () => {
    const user = userEvent.setup();
    const onReturnToLive = vi.fn();

    render(
      <ExecutionEnvironmentProvider environment={simulation}>
        <UnsupportedSimulationSurface
          surfaceName="Fee reconciliation"
          onReturnToLive={onReturnToLive}
        />
      </ExecutionEnvironmentProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fee reconciliation is not available in this simulation",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Live campus data stays hidden",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No live record, message or external service has been changed",
    );

    await user.click(screen.getByRole("button", { name: "Return to live campus" }));
    expect(onReturnToLive).toHaveBeenCalledOnce();
  });

  it("does not imply an unavailable action when no exit handler is supplied", () => {
    render(
      <ExecutionEnvironmentProvider environment={simulation}>
        <UnsupportedSimulationSurface surfaceName="Transport reconciliation" />
      </ExecutionEnvironmentProvider>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
