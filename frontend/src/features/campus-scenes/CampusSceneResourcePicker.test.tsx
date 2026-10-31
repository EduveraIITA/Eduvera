import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusSceneResourcePicker } from "./CampusSceneResourcePicker";
import { getCampusSceneResources, type SceneResourceOptions } from "./api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";

const context = vi.hoisted((): { environment: ExecutionEnvironment } => ({ environment: { mode: "live" } }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useOptionalExecutionEnvironment: () => context.environment }));
vi.mock("./api", () => ({ getCampusSceneResources: vi.fn() }));
const lamp = { id: "resource-1", name: "Courtyard lamp", asset_tag: "L-01", space_id: "courtyard", state: "unavailable" as const };
const result: SceneResourceOptions = { items: [lamp], selected: null, page: 1, page_size: 20, total: 1 };
const empty = new Set<string>();
beforeEach(() => { context.environment = { mode: "live" }; vi.clearAllMocks(); vi.mocked(getCampusSceneResources).mockResolvedValue(result); });
afterEach(cleanup);

describe("campus fixture resource links", () => {
  it("searches only after an explicit action and prevents reuse of another fixture's resource", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), onChange = vi.fn();
    const { rerender } = render(<QueryClientProvider client={client}><CampusSceneResourcePicker schoolId="school" campusId="main" holdingId={null} linkedElsewhere={new Set([lamp.id])} disabled={false} onChange={onChange} /></QueryClientProvider>);
    expect(getCampusSceneResources).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Link resource" }));
    expect(await screen.findByRole("button", { name: "Link Courtyard lamp, L-01" })).toBeDisabled();
    await userEvent.type(screen.getByRole("searchbox", { name: "Resource name or asset tag" }), "lamp");
    expect(getCampusSceneResources).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Search resources" }));
    await waitFor(() => expect(getCampusSceneResources).toHaveBeenLastCalledWith("school", "main", { search: "lamp", page: 1 }, expect.any(AbortSignal)));
    rerender(<QueryClientProvider client={client}><CampusSceneResourcePicker schoolId="school" campusId="main" holdingId={null} linkedElsewhere={empty} disabled={false} onChange={onChange} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Link Courtyard lamp, L-01" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(lamp.id);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
  it("resolves an existing link independently of search results and leaves it recoverable after a search error", async () => {
    vi.mocked(getCampusSceneResources).mockResolvedValue({ ...result, items: [], selected: lamp, total: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), onChange = vi.fn();
    render(<QueryClientProvider client={client}><CampusSceneResourcePicker schoolId="school" campusId="main" holdingId={lamp.id} linkedElsewhere={empty} disabled={false} onChange={onChange} /></QueryClientProvider>);
    expect(await screen.findByText("Courtyard lamp · L-01")).toBeVisible();
    expect(getCampusSceneResources).toHaveBeenCalledWith("school", "main", { search: "", page: 1, holding_id: lamp.id }, expect.any(AbortSignal));
    await userEvent.click(screen.getByRole("button", { name: "Change resource" }));
    vi.mocked(getCampusSceneResources).mockRejectedValue(new Error("offline"));
    await userEvent.type(screen.getByRole("searchbox"), "missing");
    await userEvent.click(screen.getByRole("button", { name: "Search resources" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your current link is unchanged");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Clear resource link" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });
  it("cancels the prior world's lookup and never displays its late resource response in Simulation", async () => {
    let finishLive!: (result: SceneResourceOptions) => void;
    vi.mocked(getCampusSceneResources).mockImplementationOnce(() => new Promise(resolve => { finishLive = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => <QueryClientProvider client={client}><CampusSceneResourcePicker schoolId="school" campusId="main" holdingId={lamp.id} linkedElsewhere={empty} disabled={false} onChange={vi.fn()} /></QueryClientProvider>;
    const { rerender } = render(view());
    await waitFor(() => expect(getCampusSceneResources).toHaveBeenCalledTimes(1));
    context.environment = { mode: "simulation", namespaceId: "simulation:run", runId: "run", virtualClock: { now: "2026-10-25T04:00:00Z", timeZone: "UTC" } };
    vi.mocked(getCampusSceneResources).mockResolvedValue({ ...result, selected: { ...lamp, name: "Run-local lamp" } });
    rerender(view());
    expect(await screen.findByText("Run-local lamp · L-01")).toBeVisible();
    expect(vi.mocked(getCampusSceneResources).mock.calls[0]?.[3]?.aborted).toBe(true);
    await act(async () => { finishLive({ ...result, selected: lamp }); await Promise.resolve(); });
    expect(screen.queryByText("Courtyard lamp · L-01")).not.toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ["execution-environment", "simulation", "simulation:run", "run", "campus-scenes", "school", "main", "resources", "", 1, lamp.id] })).toBeDefined();
  });
  it("does not borrow Live resources when the selected Simulation is unavailable", () => {
    context.environment = { mode: "simulation", unavailable: true, unavailableReason: "authorization_lost", namespaceId: "simulation:run", runId: "run" };
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><CampusSceneResourcePicker schoolId="school" campusId="main" holdingId={lamp.id} linkedElsewhere={empty} disabled={false} onChange={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Simulation is recovered");
    expect(getCampusSceneResources).not.toHaveBeenCalled();
  });
});
