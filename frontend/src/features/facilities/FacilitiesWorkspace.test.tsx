import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { actOnRepair, getFacilities, getFacilitiesOptions, getRepair } from "./facilitiesApi";
import { FacilitiesWorkspace, FacilitiesWorkspaceRoute } from "./FacilitiesWorkspaceRoute";
import { repairFixture, repairOptions, repairSettings, repairsPage } from "./facilities.test-fixtures";

vi.mock("./facilitiesApi", async original => ({ ...await original<typeof import("./facilitiesApi")>(), actOnRepair: vi.fn(), getFacilities: vi.fn(), getFacilitiesOptions: vi.fn(), getRepair: vi.fn() }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "actor" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title }: { children: ReactNode; title: string }) => <><h1>{title}</h1>{children}</> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(getFacilities).mockResolvedValue(repairsPage()); vi.mocked(getRepair).mockResolvedValue(repairFixture());
  vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: { context: { institution_id: "school", actor_user_id: "actor", time_zone: "Asia/Kolkata", environment: { kind: "live" } }, areas: [{ key: "facilities" }] }, refetch: vi.fn() } as unknown as ReturnType<typeof useWorkspaceManifest>);
});
function Location() { const location = useLocation(); return <output aria-label="Location">{location.search}</output>; }
function mount({ path = "/areas/facilities", environment = { mode: "live" }, route = false }: { path?: string; environment?: ExecutionEnvironment; route?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}>{route ? <FacilitiesWorkspaceRoute /> : <FacilitiesWorkspace schoolId="school" actorId="actor" timezone="Asia/Kolkata" />}<Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>); return client;
}
describe("native Repairs workspace", () => {
  it("resolves an exact map selection before opening the ordinary report form", async () => {
    vi.mocked(getFacilitiesOptions).mockResolvedValue(repairOptions({ selected: { holding: { id: "lamp-holding", label: "Courtyard lamp", asset_tag: "L-1", map_status_supported: true }, place: { id: "courtyard", label: "Courtyard" } } }));
    mount({ path: "/areas/facilities?report=1&holding_id=lamp-holding&space_id=courtyard" });
    const dialog = await screen.findByRole("dialog", { name: "Report a problem" });
    expect(dialog).toHaveTextContent("Courtyard lamp");
    expect(getFacilitiesOptions).toHaveBeenCalledWith("school", "", 1, undefined, { holding_id: "lamp-holding", space_id: "courtyard" }, expect.any(AbortSignal));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Location")).not.toHaveTextContent("holding_id");
  });
  it("does not trust forged or changed prefill identities and offers a normal correction path", async () => {
    vi.mocked(getFacilitiesOptions).mockResolvedValue(repairOptions({ selected: { holding: { id: "different-holding", label: "Another asset", asset_tag: null }, place: null } }));
    mount({ path: "/areas/facilities?report=1&holding_id=lamp-holding" });
    expect(await screen.findByRole("alert")).toHaveTextContent("selected asset or place could not be confirmed");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start a report without this selection" }));
    expect(screen.getByRole("dialog", { name: "Report a problem" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Another asset" })).toBeNull();
  });
  it("removes formerly private source caches after an accepted access transfer, without clearing another world", async () => {
    vi.mocked(getFacilitiesOptions).mockResolvedValue(repairOptions());
    vi.mocked(actOnRepair).mockResolvedValue(repairFixture({ revision: 2, access_transferred: true }));
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ repairs: [], totals: { open: 0, awaiting_verification: 0, closed: 0 } }));
    const client = mount({ path: "/areas/facilities?repair_id=repair-1" }), user = userEvent.setup();
    await screen.findByRole("region", { name: "Repair summary" });
    // Any in-flight observer refetch after the committed transfer is denied by
    // the owning API; it must not restore a previously permitted snapshot.
    vi.mocked(getRepair).mockRejectedValue(new ApiError("This repair is no longer in your work", 403));
    const root = executionEnvironmentQueryKey({ mode: "live" }, ["facilities", "school", "actor"]), oldDetail = [...root, "repair", "repair-1", 2], oldList = [...root, "list", "all", "closed", "pipe", 3];
    const sibling = ["execution-environment", "simulation", "simulation:other", "other-run", "facilities", "school", "actor", "repair", "repair-1", 1];
    client.setQueryData(oldDetail, { private: "old repair evidence" }); client.setQueryData(oldList, { private: "old repair title" }); client.setQueryData(sibling, { separateWorld: true });
    await user.click(screen.getByText("Change responsibility", { selector: "summary" })); await user.click(screen.getByRole("button", { name: "Change handler" })); await user.click(screen.getByRole("button", { name: "Choose person" })); await user.click(await screen.findByRole("button", { name: /Asha Patel/ }));
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Taking over this repair"); await user.click(screen.getByRole("button", { name: "Change responsible person" }));
    expect(await screen.findByText("Responsibility transferred. This repair is no longer in your current view.")).toBeVisible();
    expect(client.getQueryData([...root, "repair", "repair-1", 1])).toBeUndefined(); expect(client.getQueryData(oldDetail)).toBeUndefined(); expect(client.getQueryData(oldList)).toBeUndefined(); expect(client.getQueryData(sibling)).toEqual({ separateWorld: true });
    expect(screen.queryByText("Leaking pipe below the washbasin")).not.toBeInTheDocument();
  });
  it.each<ExecutionEnvironment>([{ mode: "live" }, { mode: "simulation", namespaceId: "simulation:repairs", runId: "repairs-run", virtualClock: { now: "2026-10-24T09:00:00Z", timeZone: "Asia/Kolkata" }, runStatus: "running" }])("keeps the same UI and partitions reads in $mode", async environment => {
    const client = mount({ environment });
    expect(await screen.findByRole("link", { name: /Leaking pipe/ })).toHaveAttribute("href", "/areas/facilities?repair_id=repair-1");
    expect(client.getQueryCache().findAll()[0]!.queryKey).toContain(environment.mode === "live" ? "live" : "simulation:repairs");
  });
  it("preserves filter and page when opening an exact repair and returning", async () => {
    mount({ path: "/areas/facilities?view=all&state=closed&search=pipe&page=2" }); const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: /Leaking pipe/ })); await screen.findByRole("region", { name: "Repair summary" });
    expect(getRepair).toHaveBeenCalledWith("school", "repair-1", 1); expect(screen.getByLabelText("Location")).toHaveTextContent("state=closed&search=pipe&page=2&repair_id=repair-1");
    await user.click(screen.getByRole("button", { name: "Back to repairs" })); await screen.findByRole("link", { name: /Leaking pipe/ });
    expect(screen.getByLabelText("Location")).toHaveTextContent("?view=all&state=closed&search=pipe&page=2");
  });
  it("opens an exact Work link without requiring a management list", async () => {
    mount({ path: "/areas/facilities?repair_id=repair-1" }); await screen.findByRole("region", { name: "Repair summary" }); expect(getFacilities).not.toHaveBeenCalled();
  });
  it("shows only minimum first-use setup, without a building or inventory prerequisite", async () => {
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ repairs: [], settings: repairSettings({ configured: false, revision: 0, handler_person_id: null }) })); mount();
    expect(await screen.findByRole("button", { name: "Set up repairs" })).toBeEnabled(); expect(screen.queryByRole("button", { name: "Report problem" })).not.toBeInTheDocument();
  });
  it("does not invent management actions for a reporter", async () => {
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ can_manage: false, settings: repairSettings({ can_manage: false }) })); mount();
    expect(await screen.findByRole("button", { name: "Report problem" })).toBeEnabled(); expect(screen.queryByRole("button", { name: "Repair settings" })).not.toBeInTheDocument(); expect(screen.queryByRole("navigation", { name: "Repair views" })).not.toBeInTheDocument();
  });
  it("shows assigned work without requiring or fetching withheld campus settings", async () => {
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ can_manage: false, can_report: false, settings: repairSettings({ configured: false, can_manage: false, handler_person_id: null, handler: null }) }));
    mount(); expect(await screen.findByRole("link", { name: /Leaking pipe/ })).toBeVisible();
    expect(screen.queryByText("Start with one responsible person")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Report problem" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Set up repairs" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Repair settings" })).not.toBeInTheDocument(); expect(getFacilitiesOptions).not.toHaveBeenCalled();
  });
  it("uses a calm empty assigned-work state instead of claiming campus setup is missing", async () => {
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ repairs: [], can_manage: false, can_report: false, settings: repairSettings({ configured: false, can_manage: false }), totals: { open: 0, awaiting_verification: 0, closed: 0 } }));
    mount(); expect(await screen.findByRole("heading", { name: "No assigned repairs" })).toBeVisible(); expect(screen.getByText("Work shared with you will appear here.")).toBeVisible(); expect(screen.queryByText(/appoint a repair handler/)).not.toBeInTheDocument(); expect(getFacilitiesOptions).not.toHaveBeenCalled();
  });
  it("uses server pagination and resets the page after searching", async () => {
    vi.mocked(getFacilities).mockResolvedValue(repairsPage({ pagination: { page: 1, page_size: 10, total: 21 } })); mount(); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Next" })); await waitFor(() => expect(getFacilities).toHaveBeenLastCalledWith("school", expect.objectContaining({ page: 2 })));
    await user.type(screen.getByRole("searchbox"), "light"); await user.click(screen.getByRole("button", { name: "Search repairs" })); await waitFor(() => expect(getFacilities).toHaveBeenLastCalledWith("school", expect.objectContaining({ page: 1, search: "light" })));
  });
  it("removes retained private data when access is revoked", async () => {
    const client = mount({ path: "/areas/facilities?repair_id=repair-1" }); await screen.findByText("Leaking pipe below the washbasin");
    vi.mocked(getRepair).mockRejectedValue(new ApiError("No longer allowed", 403)); await act(async () => { await client.invalidateQueries(); });
    await screen.findByRole("alert"); expect(screen.queryByText("Asha Patel")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Accept repair" })).not.toBeInTheDocument();
  });
  it("suppresses all reads when the selected world is unavailable", () => {
    mount({ route: true, environment: { mode: "simulation", namespaceId: "simulation:missing", runId: "missing", unavailable: true, unavailableReason: "data_plane_unavailable" } });
    expect(getFacilities).not.toHaveBeenCalled(); expect(getRepair).not.toHaveBeenCalled();
  });
});
