import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationRunResources } from "./SimulationRunResources";
import { getSimulationRunResources } from "./simulationApi";

vi.mock("./simulationApi", () => ({ getSimulationRunResources: vi.fn() }));

const getResourcesMock = vi.mocked(getSimulationRunResources);

function receipt(index: number) {
  return {
    id: `effect-${index}`,
    kind: "external_notification" as const,
    schema_name: "simulation.email.send",
    status: "captured" as const,
    recorded_at: `2026-10-19T0${index}:00:00.000Z`,
    logical_target: { kind: "email", ref: `sha256:${index}` },
    payload_digest: String(index).repeat(64),
  };
}

function LocationProbe() {
  return <output aria-label="Current query">{useLocation().search}</output>;
}

function show(entry = "/more/simulation?view=results") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <SimulationRunResources schoolId="school-1" runId="run-1" runStatus="paused" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getResourcesMock.mockImplementation((_schoolId, _runId, page) => Promise.resolve({
    schema_version: 1,
    run_id: "run-1",
    counts: { effects: { external_notification: 6 }, artifacts: 2, artifact_bytes: 2_048 },
    effects: {
      page,
      page_size: 5,
      total: 6,
      results: page === 1 ? [1, 2, 3, 4, 5].map(receipt) : [6].map(receipt),
    },
  }));
});

afterEach(cleanup);

describe("SimulationRunResources", () => {
  it("shows only redacted run-local evidence and pages five receipts at a time", async () => {
    const user = userEvent.setup();
    show();

    expect(await screen.findByText("Effects captured")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getAllByText("External notification")).toHaveLength(5);
    expect(screen.getByText(/Nothing listed here was delivered to a Live recipient/i)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await waitFor(() => expect(getResourcesMock).toHaveBeenLastCalledWith("school-1", "run-1", 2, 5, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByLabelText("Current query")).toHaveTextContent("effectsPage=2"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "External-effect evidence" })).toHaveFocus());
    expect(screen.getAllByText("External notification")).toHaveLength(1);
  });
});
