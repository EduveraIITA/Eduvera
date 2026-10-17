import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../../lib/api";
import { EnvironmentMarker } from "./EnvironmentMarker";
import {
  ApplicationExecutionEnvironmentProvider,
  useApplicationExecutionEnvironment,
} from "./ApplicationExecutionEnvironment";
import { ExecutionEnvironmentProvider } from "./ExecutionEnvironmentContext";
import {
  LIVE_EXECUTION_ENVIRONMENT,
  createSimulationExecutionEnvironment,
  type ExecutionEnvironment,
} from "./executionEnvironment";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";

const auth = vi.hoisted(() => ({ status: "authenticated", refresh: vi.fn() }));

vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => auth,
}));
vi.mock("./executionEnvironmentApi", () => ({ selectExecutionEnvironment: vi.fn() }));

function EnterSimulationButton() {
  const applicationEnvironment = useApplicationExecutionEnvironment();
  return <button type="button" onClick={() => void applicationEnvironment.enterSimulation("run-1")}>Enter test simulation</button>;
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderMarker(path: string, environment: ExecutionEnvironment) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExecutionEnvironmentProvider environment={environment}>
        <EnvironmentMarker />
      </ExecutionEnvironmentProvider>
    </MemoryRouter>,
  );
}

describe("EnvironmentMarker", () => {
  afterEach(() => {
    auth.status = "authenticated";
    auth.refresh.mockReset();
    vi.mocked(selectExecutionEnvironment).mockReset();
    cleanup();
  });

  it("marks an authenticated operational route as live", () => {
    renderMarker("/principal/timetable", LIVE_EXECUTION_ENVIRONMENT);
    expect(screen.getByLabelText("Live campus environment")).toHaveTextContent("Live");
  });

  it("marks cross-role work items as part of the selected environment", () => {
    renderMarker("/work/staff-leave", LIVE_EXECUTION_ENVIRONMENT);
    expect(screen.getByLabelText("Live campus environment")).toBeInTheDocument();
  });

  it.each(["/login", "/onboarding/start", "/account/security"])(
    "does not render over the non-operational route %s",
    (path) => {
      renderMarker(path, LIVE_EXECUTION_ENVIRONMENT);
      expect(screen.queryByLabelText("Live campus environment")).not.toBeInTheDocument();
    },
  );

  it("does not render without an authenticated session", () => {
    auth.status = "anonymous";
    renderMarker("/principal", LIVE_EXECUTION_ENVIRONMENT);
    expect(screen.queryByLabelText("Live campus environment")).not.toBeInTheDocument();
  });

  it("shows server-confirmed simulation time without exposing a client-side switch", () => {
    const simulation = createSimulationExecutionEnvironment({
      namespaceId: "scenario-1",
      runId: "run-1",
      virtualClock: {
        now: "2026-10-19T09:15:00.000+05:30",
        timeZone: "Asia/Kolkata",
      },
    });

    renderMarker("/principal/attendance", simulation);

    expect(screen.getByLabelText("Simulation environment")).toHaveTextContent("Simulation");
    expect(screen.getByLabelText("Simulation environment")).toHaveTextContent("19 Oct");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Return to Live from the compact marker without changing route", async () => {
    const simulation = createSimulationExecutionEnvironment({
      namespaceId: "scenario-1",
      runId: "run-1",
      virtualClock: {
        now: "2026-10-19T09:15:00.000+05:30",
        timeZone: "Asia/Kolkata",
      },
      expiresAt: "2099-10-20T09:15:00.000Z",
    });
    vi.mocked(selectExecutionEnvironment).mockResolvedValue({ mode: "live" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/principal/attendance"]}>
          <ApplicationExecutionEnvironmentProvider confirmedEnvironment={simulation}>
            <EnvironmentMarker />
            <LocationProbe />
          </ApplicationExecutionEnvironmentProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Return to Live/i }));
    expect(selectExecutionEnvironment).toHaveBeenCalledWith({ mode: "live" });
    expect(screen.getByLabelText("Live campus environment")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/attendance");
  });

  it("shows a failed entry beside the Live marker and leaves Live selected", async () => {
    vi.mocked(selectExecutionEnvironment).mockRejectedValue(new ApiError("not operable", 409));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/principal/attendance"]}>
          <ApplicationExecutionEnvironmentProvider confirmedEnvironment={LIVE_EXECUTION_ENVIRONMENT}>
            <EnvironmentMarker />
            <EnterSimulationButton />
          </ApplicationExecutionEnvironmentProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Enter test simulation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not ready for the full application/i);
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Live campus environment")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss environment message" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
