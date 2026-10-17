import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, forwardRef, useImperativeHandle, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import {
  ApplicationExecutionEnvironmentProvider,
  EXECUTION_ENVIRONMENT_SIGNAL_KEY,
  useApplicationExecutionEnvironment,
  type ApplicationExecutionEnvironmentValue,
} from "./ApplicationExecutionEnvironment";
import { useExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { createSimulationExecutionEnvironment, executionEnvironmentFromWire } from "./executionEnvironment";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";

vi.mock("./executionEnvironmentApi", () => ({ selectExecutionEnvironment: vi.fn() }));

const selectMock = vi.mocked(selectExecutionEnvironment);

const EnvironmentProbe = forwardRef<ApplicationExecutionEnvironmentValue>(function EnvironmentProbe(_props, ref) {
  const environment = useExecutionEnvironment();
  const application = useApplicationExecutionEnvironment();
  useImperativeHandle(ref, () => application, [application]);
  return <div>
    <output>{environment.mode === "live" ? "live" : `${environment.namespaceId}:${environment.runId}`}</output>
    <button type="button" onClick={() => void application.enterSimulation("run-1")}>Enter</button>
    <button type="button" onClick={() => void application.returnToLive()}>Return</button>
    {application.switchError ? <p role="alert">{application.switchError}</p> : null}
  </div>;
});

function CacheProbe() {
  const queryClient = useQueryClient();
  return <output data-testid="cache">{String(queryClient.getQueryData(["live-record"]) ?? "empty")}</output>;
}

function LocalStateProbe() {
  const [value, setValue] = useState("");
  return <input aria-label="Local campus draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

function renderProvider(
  confirmedEnvironment?: Parameters<typeof ApplicationExecutionEnvironmentProvider>[0]["confirmedEnvironment"],
  refreshConfirmedEnvironment?: () => Promise<ReturnType<typeof useExecutionEnvironment> | null>,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const applicationRef = createRef<ApplicationExecutionEnvironmentValue>();
  queryClient.setQueryData(["live-record"], "live data");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApplicationExecutionEnvironmentProvider confirmedEnvironment={confirmedEnvironment} refreshConfirmedEnvironment={refreshConfirmedEnvironment}>
        <EnvironmentProbe ref={applicationRef} />
        <CacheProbe />
        <LocalStateProbe />
      </ApplicationExecutionEnvironmentProvider>
    </QueryClientProvider>,
  );
  return { ...view, applicationRef, queryClient };
}

const simulation = createSimulationExecutionEnvironment({
  namespaceId: "scenario-1",
  runId: "run-1",
  virtualClock: {
    now: "2026-10-19T09:15:00.000+05:30",
    timeZone: "Asia/Kolkata",
  },
  expiresAt: "2099-10-19T12:00:00.000Z",
});

const unavailableSimulation = executionEnvironmentFromWire({
  mode: "simulation",
  unavailable: true,
  unavailable_reason: "data_plane_unavailable",
  namespace_id: "scenario:scenario-1:run:run-1",
  run_id: "run-1",
  scenario_id: "scenario-1",
  institution_id: "school-1",
  expires_at: "2099-10-19T12:00:00.000Z",
});

describe("ApplicationExecutionEnvironmentProvider", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("defaults to the authoritative live environment when the server has not confirmed another context", () => {
    renderProvider();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("only reflects an explicitly supplied server-confirmed environment", () => {
    renderProvider(simulation);
    expect(screen.getByText("scenario-1:run-1")).toBeInTheDocument();
  });

  it("keeps the route mounted and clears Live cache only after the server confirms Simulation", async () => {
    selectMock.mockResolvedValue(simulation);
    const storageSignal = vi.spyOn(Storage.prototype, "setItem");
    const { queryClient } = renderProvider();
    expect(screen.getByTestId("cache")).toHaveTextContent("live data");
    await userEvent.type(screen.getByRole("textbox", { name: "Local campus draft" }), "Live-only draft");

    await userEvent.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => expect(screen.getByText("scenario-1:run-1")).toBeInTheDocument());
    expect(queryClient.getQueryData(["live-record"])).toBeUndefined();
    expect(screen.getByRole("textbox", { name: "Local campus draft" })).toHaveValue("");
    expect(selectMock).toHaveBeenCalledWith({ mode: "simulation", run_id: "run-1" });
    const signalValue = storageSignal.mock.calls.find(([key]) => key === EXECUTION_ENVIRONMENT_SIGNAL_KEY)?.[1];
    expect(signalValue).toBeDefined();
    expect(JSON.parse(signalValue!)).toEqual(expect.objectContaining({
      version: 1,
      kind: "session-environment-changed",
    }));
    expect(signalValue).not.toContain("run-1");
    expect(signalValue).not.toContain("scenario-1");
    storageSignal.mockRestore();
  });

  it("fails closed on a stale run without clearing or relabelling Live data", async () => {
    selectMock.mockRejectedValue(new ApiError("expired", 410));
    const { applicationRef } = renderProvider();

    await act(async () => {
      expect(await applicationRef.current!.enterSimulation("run-1")).toBe(false);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByTestId("cache")).toHaveTextContent("live data");
  });

  it("returns to Live through the same server-owned selector", async () => {
    selectMock.mockResolvedValue({ mode: "live" });
    renderProvider(simulation);

    await userEvent.click(screen.getByRole("button", { name: "Return" }));

    await waitFor(() => expect(screen.getByText("live")).toBeInTheDocument());
    expect(selectMock).toHaveBeenCalledWith({ mode: "live" });
  });

  it("blocks all campus children for an unavailable Simulation and offers explicit recovery", async () => {
    selectMock.mockResolvedValue({ mode: "live" });
    const { queryClient } = renderProvider(unavailableSimulation);

    expect(screen.getByRole("heading", { name: "Simulation unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/Live campus data has not been shown or used as a fallback/i)).toBeInTheDocument();
    expect(screen.queryByText("scenario:scenario-1:run:run-1:run-1")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["live-record"])).toBe("live data");

    await userEvent.click(screen.getByRole("button", { name: "Return to Live" }));

    await waitFor(() => expect(screen.getByText("live")).toBeInTheDocument());
    expect(selectMock).toHaveBeenCalledWith({ mode: "live" });
    expect(queryClient.getQueryData(["live-record"])).toBeUndefined();
  });

  it("revalidates an expired simulation and installs only the server-confirmed fallback", async () => {
    const expiredSimulation = createSimulationExecutionEnvironment({
      namespaceId: "scenario-expired",
      runId: "run-expired",
      virtualClock: simulation.virtualClock,
      expiresAt: "2020-10-19T12:00:00.000Z",
    });
    const refresh = vi.fn().mockResolvedValue({ mode: "live" } as const);
    const { queryClient } = renderProvider(expiredSimulation, refresh);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("live")).toBeInTheDocument());
    expect(queryClient.getQueryData(["live-record"])).toBeUndefined();
  });

  it("re-reads the server session and clears cache when another tab changes the shared cookie", async () => {
    const refresh = vi.fn().mockResolvedValue(simulation);
    const { queryClient } = renderProvider(undefined, refresh);
    const signal = JSON.stringify({
      version: 1,
      kind: "session-environment-changed",
      senderId: "another-tab",
      nonce: "signal-1",
    });

    window.dispatchEvent(new StorageEvent("storage", {
      key: EXECUTION_ENVIRONMENT_SIGNAL_KEY,
      newValue: signal,
    }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("scenario-1:run-1")).toBeInTheDocument());
    expect(queryClient.getQueryData(["live-record"])).toBeUndefined();
  });

  it("blocks stale campus content when cross-tab confirmation fails and recovers on retry", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const { queryClient } = renderProvider(undefined, refresh);

    window.dispatchEvent(new StorageEvent("storage", {
      key: EXECUTION_ENVIRONMENT_SIGNAL_KEY,
      newValue: JSON.stringify({
        version: 1,
        kind: "session-environment-changed",
        senderId: "another-tab",
        nonce: "signal-offline",
      }),
    }));

    expect(await screen.findByRole("heading", { name: "Environment not confirmed" })).toBeInTheDocument();
    expect(screen.queryByText("live")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["live-record"])).toBe("live data");

    refresh.mockResolvedValueOnce(simulation);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("scenario-1:run-1")).toBeInTheDocument());
    expect(queryClient.getQueryData(["live-record"])).toBeUndefined();
  });
});
