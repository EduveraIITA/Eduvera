import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { getWorkspaceManifest } from "./api";
import type { WorkspaceManifest } from "./types";
import { useWorkspaceManifest } from "./useWorkspaceManifest";
import { WorkspaceState } from "./WorkspaceState";

vi.mock("./api", () => ({ getWorkspaceManifest: vi.fn() }));

const live: ExecutionEnvironment = { mode: "live", institutionId: "campus" };
const simulation: ExecutionEnvironment = {
  mode: "simulation", institutionId: "campus", namespaceId: "simulation:first", runId: "first",
  virtualClock: { now: "2026-10-26T06:00:00.000Z", timeZone: "Asia/Kolkata" },
};

function manifest(revision: string): WorkspaceManifest {
  return { revision } as WorkspaceManifest;
}

function Probe({ name = "workspace" }: { readonly name?: string }) {
  const query = useWorkspaceManifest();
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (query.error) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  return <output aria-label={name}>{query.data?.revision}</output>;
}

function mount(children: ReactNode, environment: ExecutionEnvironment = live) {
  // Deliberately enable the global transient retry policy: the shared hook must
  // still expose a failure immediately rather than silently inheriting it.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
  const tree = (content: ReactNode, scope: ExecutionEnvironment) => <QueryClientProvider client={client}>
    <ExecutionEnvironmentProvider environment={scope}>{content}</ExecutionEnvironmentProvider>
  </QueryClientProvider>;
  const view = render(tree(children, environment));
  return {
    client,
    rerender: (content: ReactNode, scope = environment) => view.rerender(tree(content, scope)),
  };
}

describe("shared workspace loading", () => {
  beforeEach(() => { vi.mocked(getWorkspaceManifest).mockReset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shares one in-flight read between simultaneous workspace boundaries", async () => {
    let finish!: (value: WorkspaceManifest) => void;
    vi.mocked(getWorkspaceManifest).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(<><Probe name="shell" /><Probe name="domain" /></>);
    expect(getWorkspaceManifest).toHaveBeenCalledOnce();
    act(() => finish(manifest("same revision")));
    expect(await screen.findByLabelText("shell")).toHaveTextContent("same revision");
    expect(screen.getByLabelText("domain")).toHaveTextContent("same revision");
    expect(getWorkspaceManifest).toHaveBeenCalledOnce();
  });

  it("reuses a fresh manifest on remount but refreshes after its existing freshness window", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValueOnce(manifest("first")).mockResolvedValue(manifest("refreshed"));
    const view = mount(<Probe key="first" />);
    expect(await screen.findByLabelText("workspace")).toHaveTextContent("first");
    view.rerender(<Probe key="fresh route" />);
    expect(screen.getByLabelText("workspace")).toHaveTextContent("first");
    expect(getWorkspaceManifest).toHaveBeenCalledOnce();

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 15_001);
    view.rerender(<Probe key="stale route" />);
    expect(await screen.findByText("refreshed")).toBeInTheDocument();
    expect(getWorkspaceManifest).toHaveBeenCalledTimes(2);
  });

  it("shows the existing recovery action after one failed read and only retries explicitly", async () => {
    vi.mocked(getWorkspaceManifest).mockRejectedValueOnce(new ApiError("Service busy", 503))
      .mockResolvedValue(manifest("recovered"));
    mount(<Probe />);
    expect(await screen.findByRole("heading", { name: "We couldn’t load your workspace" })).toBeVisible();
    expect(getWorkspaceManifest).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Loading your workspace")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh workspace" }));
    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(getWorkspaceManifest).toHaveBeenCalledTimes(2);
  });

  it("never reuses a fresh Live manifest for Simulation or a sibling run", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValueOnce(manifest("Live"))
      .mockResolvedValueOnce(manifest("First run")).mockResolvedValueOnce(manifest("Sibling run"));
    const view = mount(<Probe />);
    expect(await screen.findByText("Live")).toBeInTheDocument();
    view.rerender(<Probe />, simulation);
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(await screen.findByText("First run")).toBeInTheDocument();
    view.rerender(<Probe />, { ...simulation, namespaceId: "simulation:sibling", runId: "sibling" });
    expect(screen.queryByText("First run")).not.toBeInTheDocument();
    expect(await screen.findByText("Sibling run")).toBeInTheDocument();
    expect(getWorkspaceManifest).toHaveBeenCalledTimes(3);
    view.rerender(<Probe />, live);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(getWorkspaceManifest).toHaveBeenCalledTimes(3);
  });

  it("does not read any workspace when the selected isolated world is unavailable", async () => {
    mount(<Probe />, {
      mode: "simulation", unavailable: true, unavailableReason: "data_plane_unavailable",
      institutionId: "campus", namespaceId: "simulation:missing", runId: "missing",
    });
    await waitFor(() => expect(getWorkspaceManifest).not.toHaveBeenCalled());
  });
});
