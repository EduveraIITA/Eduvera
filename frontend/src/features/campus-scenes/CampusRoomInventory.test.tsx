import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusRoomInventory } from "./CampusRoomInventory";
import { getCampusSceneResources, type SceneResourceOptions } from "./api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";

const context = vi.hoisted((): { environment: ExecutionEnvironment; auth: { user: { id: string; active_school_id: string }; memberships: Array<{ school_id: string; role: string }> } } => ({
  environment: { mode: "live" }, auth: { user: { id: "administrator", active_school_id: "school" }, memberships: [{ school_id: "school", role: "admin" }] },
}));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => context.auth }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useOptionalExecutionEnvironment: () => context.environment }));
vi.mock("./api", () => ({ getCampusSceneResources: vi.fn() }));

function response(spaceId = "room", quantity = 24): SceneResourceOptions {
  return { items: [{ id: "seating", name: "Seminar seating", quantity, tracking_mode: "pooled", unit_label: "seats", asset_tag: null, space_id: spaceId, state: "available" }], selected: null, page: 1, page_size: 20, total: 1 };
}
function mount(initial: { spaceId?: string; canRead?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let props = { schoolId: "school", campusId: "campus", spaceId: "room", canRead: true, ...initial };
  const view = () => <QueryClientProvider client={client}><CampusRoomInventory {...props} /></QueryClientProvider>;
  const rendered = render(view());
  return { client, update(next: Partial<typeof props> = {}) { props = { ...props, ...next }; rendered.rerender(view()); } };
}
beforeEach(() => {
  context.environment = { mode: "live" };
  context.auth = { user: { id: "administrator", active_school_id: "school" }, memberships: [{ school_id: "school", role: "admin" }] };
  vi.mocked(getCampusSceneResources).mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("selected room pooled inventory", () => {
  it("loads exact native quantities without fabricating item locations or offering holding actions", async () => {
    mount();
    expect(await screen.findByText("Seminar seating")).toBeVisible();
    expect(screen.getByRole("region", { name: "Room inventory" })).toHaveTextContent("24 seats");
    expect(getCampusSceneResources).toHaveBeenCalledExactlyOnceWith("school", "campus", { search: "", page: 1, space_id: "room", tracking_mode: "pooled" }, expect.any(AbortSignal));
    expect(screen.getByText("Recorded quantities; individual positions are not mapped.")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it.each(["not-requested", "member", "other-institution", "unavailable-world"])("does not fetch private inventory for %s", reason => {
    if (reason === "member") context.auth.memberships[0]!.role = "staff";
    if (reason === "other-institution") context.auth.user.active_school_id = "other";
    if (reason === "unavailable-world") context.environment = { mode: "simulation", runId: "one", namespaceId: "run:one", unavailable: true, unavailableReason: "runtime_unavailable" };
    mount({ canRead: reason !== "not-requested" });
    expect(getCampusSceneResources).not.toHaveBeenCalled();
    expect(screen.queryByText("Seminar seating")).toBeNull();
  });
  it("pages only the selected room and resets paging on a new canonical room", async () => {
    vi.mocked(getCampusSceneResources).mockImplementation((_school, _campus, input) => Promise.resolve({ ...response(input.space_id), page: input.page, total: 21, items: response(input.space_id).items.map(item => ({ ...item, name: `${input.space_id} resources page ${input.page}` })) }));
    const mounted = mount();
    await screen.findByText("room resources page 1");
    await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(await screen.findByText("room resources page 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    mounted.update({ spaceId: "other-room" });
    expect(await screen.findByText("other-room resources page 1")).toBeVisible();
    expect(screen.queryByText("room resources page 2")).toBeNull();
    expect(getCampusSceneResources).toHaveBeenLastCalledWith("school", "campus", { search: "", page: 1, space_id: "other-room", tracking_mode: "pooled" }, expect.any(AbortSignal));
  });
  it("withdraws cached quantities during refresh, after failure and after authority is revoked", async () => {
    const mounted = mount(); await screen.findByText("Seminar seating");
    let fail!: (reason: Error) => void;
    vi.mocked(getCampusSceneResources).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    act(() => { void mounted.client.refetchQueries(); });
    await screen.findByRole("status");
    expect(screen.queryByText("Seminar seating")).toBeNull();
    await act(async () => { fail(new Error("Source unavailable")); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Room resources could not be loaded");
    expect(screen.queryByText("Seminar seating")).toBeNull();
    vi.mocked(getCampusSceneResources).mockResolvedValue(response("room", 25));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Seminar seating");
    expect(screen.getByRole("region", { name: "Room inventory" })).toHaveTextContent("25 seats");
    context.auth.memberships = []; mounted.update();
    expect(screen.queryByRole("region", { name: "Room inventory" })).toBeNull();
  });
  it("rejects a resource from another room or an incomplete quantity response", async () => {
    vi.mocked(getCampusSceneResources).mockResolvedValue(response("other-room"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Room resources could not be loaded");
    expect(screen.queryByText("Seminar seating")).toBeNull();
  });
  it("does not show a late Live response after switching to a selected Simulation", async () => {
    let finishLive!: (value: SceneResourceOptions) => void;
    vi.mocked(getCampusSceneResources).mockImplementationOnce(() => new Promise(resolve => { finishLive = resolve; }));
    const mounted = mount();
    await waitFor(() => expect(getCampusSceneResources).toHaveBeenCalledOnce());
    const signal = vi.mocked(getCampusSceneResources).mock.calls[0]?.[3];
    context.environment = { mode: "simulation", runId: "one", namespaceId: "run:one", virtualClock: { now: "2026-10-27T12:00:00Z", timeZone: "UTC" } };
    vi.mocked(getCampusSceneResources).mockResolvedValue({ ...response("room", 12), items: response("room", 12).items.map(item => ({ ...item, name: "Run-local seating" })) });
    mounted.update();
    expect(await screen.findByText("Run-local seating")).toBeVisible();
    expect(signal?.aborted).toBe(true);
    await act(async () => { finishLive(response()); await Promise.resolve(); });
    expect(screen.queryByText("Seminar seating")).toBeNull();
    expect(mounted.client.getQueryCache().find({ queryKey: ["execution-environment", "simulation", "run:one", "one", "campus-scenes", "school", "campus", "room-inventory", "administrator", "room", 1] })).toBeDefined();
  });
});
