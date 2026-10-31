import { useState, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { setAppearance } from "../appearance";
import CampusScenePage from "./CampusScenePage";
import { getCampusSceneDirectory, getCampusScenePublished, getCampusSceneWorkspace, reopenCampusScene } from "./api";
import type { CampusSceneDocument } from "./types";
import type { CampusSceneOperationsBridge } from "./sceneOperations.types";
import type { CampusViewOverlay } from "../campus-view/types";
const state = vi.hoisted(() => ({ admin: false, otherSchoolAdmin: false, simulationControls: false, unavailable: false, operationMount: vi.fn(), inspectPlace: vi.fn(), editorMount: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { active_school_id: "school-1" }, memberships: [{ school_id: "school-1", school_name: "Green Valley", role: state.admin ? "admin" : "member" }, ...(state.otherSchoolAdmin ? [{ school_id: "school-2", school_name: "Other school", role: "admin" }] : [])] }) }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useOptionalExecutionEnvironment: () => state.simulationControls ? { mode: "simulation", namespaceId: "test", runId: "test-run", institutionId: "school-1", ...(state.unavailable ? { unavailable: true, unavailableReason: "authorization_lost" } : { virtualClock: { now: "2026-10-27T08:00:00Z", timeZone: "Asia/Kolkata" } }) } : { mode: "live" } }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, layout, contentHasHeading }: { children: ReactNode; title: string; layout?: string; contentHasHeading?: boolean }) => <main data-layout={layout}>{!contentHasHeading && layout !== "canvas" ? <h1>{title}</h1> : null}{state.simulationControls && !state.unavailable && layout !== "canvas" ? <aside aria-label="Selected simulation">Owning Simulation controls</aside> : null}{children}</main> }));
vi.mock("../simulation/SimulationSessionControls", () => ({ SimulationSessionControls: () => state.simulationControls && !state.unavailable ? <aside aria-label="Selected simulation">Owning Simulation controls</aside> : null }));
vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: ({ scene, onSelectElement, lighting }: { lighting?: "day" | "night"; scene: CampusSceneDocument; onSelectElement: (id: string) => void }) => <div aria-label="Campus canvas" data-lighting={lighting}>{scene.elements.map(item => <button type="button" key={item.id} onClick={() => onSelectElement(item.id)}>Canvas {item.label}</button>)}</div> }));
vi.mock("./CampusSceneEditorSession", () => ({ CampusSceneEditorSession: (props: { onDirtyChange: (dirty: boolean) => void; initialElementId?: string; initialPanel?: string; scopeBlocked?: boolean }) => { const [key] = useState(() => crypto.randomUUID()); const [unknown, setUnknown] = useState(false); state.editorMount(props); return <div>Editable campus draft<button onClick={() => props.onDirtyChange(true)}>Edit local draft</button><button onClick={() => setUnknown(true)}>Start unknown save</button>{unknown ? <output data-testid="unknown-save-key">{key}</output> : null}</div>; } }));
vi.mock("../campus-view/CampusSceneOperations", () => ({ CampusSceneOperations: function Operations(props: { children: (bridge: CampusSceneOperationsBridge) => ReactNode; scene: CampusSceneDocument | null; schoolId: string; campusId: string; initialPanel?: string; overlay?: CampusViewOverlay | null }) {
  const [revision, setRevision] = useState(1);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  state.operationMount(props);
  return props.children({ markersFor: () => [], selectedSpaceId, selectedMarkerId: null, unavailableFixtureIds: [], onSelectPlace: setSelectedSpaceId, onInspectPlace: state.inspectPlace, onSelectMarker: () => undefined, controls: <section aria-label="Campus operations"><p>Recorded activity revision {revision}</p><button onClick={() => setRevision(value => value + 1)}>Refresh recorded activity</button><button onClick={() => setSelectedSpaceId("place-room")}>Select recorded classroom</button></section> });
} }));
vi.mock("./api", () => ({ getCampusSceneDirectory: vi.fn(), getCampusScenePublished: vi.fn(), getCampusSceneWorkspace: vi.fn(), reopenCampusScene: vi.fn() }));
afterEach(() => { cleanup(); setAppearance("system"); });
const document: CampusSceneDocument = { schema_version: 1, name: "Green Valley", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed campus plan" }, elements: [
  { id: "learning", kind: "building", label: "Learning building", geometry: { type: "polygon", points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 10, y: 40 }] }, space_id: "place-building", floor_id: null, review_state: "reviewed", levels: 2 },
  { id: "classroom", kind: "room", label: "Classroom A", parent_element_id: "learning", geometry: { type: "polygon", points: [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }] }, space_id: "place-room", floor_id: "place-floor", review_state: "reviewed" },
] };
beforeEach(() => {
  state.admin = false; state.otherSchoolAdmin = false; state.simulationControls = false; state.unavailable = false; vi.clearAllMocks();
  vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: false });
  vi.mocked(getCampusScenePublished).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, can_edit: false, scene: { id: "scene", version: 5, document, published_at: "2026-10-25T10:00:00Z" }, places: [{ id: "place-floor", name: "First floor", code: "F1", kind: "floor", parent_space_id: "place-building" }, { id: "place-room", name: "Classroom A", code: "A", kind: "classroom", parent_space_id: "place-floor" }] });
});
function mount(path = "/more/virtual-campus", overlay?: CampusViewOverlay) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const content = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><CampusScenePage overlay={overlay} /></MemoryRouter></QueryClientProvider>; const view = render(content()); return Object.assign(client, { refreshPage: () => view.rerender(content()) }); }
describe("virtual campus route", () => {
  it("expands the same mounted map and relocates the existing session controls exactly once", async () => {
    state.simulationControls = true;
    mount();
    const map = await screen.findByLabelText("Campus canvas");
    expect(screen.getAllByRole("heading", { level: 1, name: "Virtual campus" })).toHaveLength(1);
    expect(screen.getAllByRole("complementary", { name: "Selected simulation" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Full screen map", exact: true }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("data-layout", "canvas"));
    expect(screen.getByLabelText("Campus canvas")).toBe(map);
    expect(screen.getAllByRole("complementary", { name: "Selected simulation" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Exit full screen", exact: true }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("data-layout", "immersive"));
    expect(screen.getByLabelText("Campus canvas")).toBe(map);
    expect(screen.getAllByRole("complementary", { name: "Selected simulation" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Full screen map", exact: true })).toHaveFocus();
  });
  it("keeps access recovery visible inside an expanded map without duplicating the warning", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true });
    const client = mount();
    await screen.findByLabelText("Campus canvas");
    await userEvent.click(screen.getByRole("button", { name: "Full screen map", exact: true }));
    vi.mocked(getCampusSceneDirectory).mockRejectedValueOnce(new ApiError("Access unavailable", 403));
    await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], exact: true }); });
    const recovery = await screen.findByRole("button", { name: "Refresh campus access" });
    const workspace = screen.getByRole("region", { name: "Campus map workspace" });
    expect(workspace).toContainElement(recovery);
    expect(recovery).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Refresh campus access" })).toHaveLength(1);
    expect(screen.getByLabelText("Campus canvas")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Campus activity", exact: true })).not.toBeInTheDocument();
  });
  it("restores a titled recovery screen when an expanded selected Simulation becomes unavailable", async () => {
    state.simulationControls = true;
    const client = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Full screen map", exact: true }));
    act(() => {
      state.unavailable = true;
      client.refreshPage();
    });
    expect(await screen.findByText(/This Simulation is unavailable/)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Virtual campus" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("data-layout", "immersive"));
    expect(screen.queryByRole("button", { name: "Exit full screen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Simulation" })).toBeVisible();
  });
  it("returns only to the fixed setup guide with current campus and protects a local draft", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    mount("/more/virtual-campus?campus_id=main&edit=1&setup=whole-campus&setup_step=layout&setup_element=classroom&return_to=https://example.com");
    await screen.findByText("Editable campus draft");
    expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ initialElementId: "classroom", initialPanel: undefined }));
    const back = screen.getByRole("link", { name: "Return to setup guide" });
    expect(back).toHaveAttribute("href", "/more/setup/whole-campus?campus_id=main&step=layout");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Edit local draft" })); await userEvent.click(back);
    expect(confirm).toHaveBeenCalledWith("Leave this campus draft? Unsaved changes will be lost."); expect(screen.getByText("Editable campus draft")).toBeVisible();
    confirm.mockRestore();
  });
  it("retains a pending editor key when a cached directory refresh fails", async () => {
    state.admin = true; vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true }); vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    const client = mount("/more/virtual-campus?campus_id=main&edit=1"); await userEvent.click(await screen.findByRole("button", { name: "Start unknown save" })); const key = screen.getByTestId("unknown-save-key").textContent;
    vi.mocked(getCampusSceneDirectory).mockRejectedValueOnce(new Error("Directory refresh unavailable")); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], exact: true }); });
    expect(await screen.findByText(/campus list could not refresh/)).toBeVisible(); expect(screen.getByTestId("unknown-save-key")).toHaveTextContent(key); await waitFor(() => expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBlocked: false })));
  });
  it("keeps an unconfirmed editor mounted but disables writes during directory authority loss and recovery", async () => {
    state.admin = true; const directory = { campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true }; vi.mocked(getCampusSceneDirectory).mockResolvedValue(directory); vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    const client = mount("/more/virtual-campus?campus_id=main&edit=1"); await userEvent.click(await screen.findByRole("button", { name: "Start unknown save" })); const key = screen.getByTestId("unknown-save-key").textContent;
    vi.mocked(getCampusSceneDirectory).mockRejectedValueOnce(new ApiError("Access unavailable", 403)); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], exact: true }); });
    expect(screen.getByTestId("unknown-save-key")).toHaveTextContent(key); await waitFor(() => expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBlocked: true })));
    vi.mocked(getCampusSceneDirectory).mockResolvedValue(directory); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], exact: true }); }); expect(screen.getByTestId("unknown-save-key")).toHaveTextContent(key); await waitFor(() => expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBlocked: false })));
  });
  it("keeps an unconfirmed editor key when its campus disappears or cached workspace access fails", async () => {
    state.admin = true; vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true }); vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    const client = mount("/more/virtual-campus?campus_id=main&edit=1"); await userEvent.click(await screen.findByRole("button", { name: "Start unknown save" })); const key = screen.getByTestId("unknown-save-key").textContent;
    vi.mocked(getCampusSceneWorkspace).mockRejectedValueOnce(new ApiError("Workspace access unavailable", 403)); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "main", "workspace"], exact: true }); }); expect(screen.getByTestId("unknown-save-key")).toHaveTextContent(key); await waitFor(() => expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBlocked: true })));
    act(() => { client.setQueryData(["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], { campuses: [], can_edit: false }); }); expect(screen.getByTestId("unknown-save-key")).toHaveTextContent(key); await waitFor(() => expect(state.editorMount).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBlocked: true })));
  });
  it("retains a cached published drawing but removes oversight and edit entry after current directory access fails", async () => {
    state.admin = true; vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true }); vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true });
    const client = mount(); expect(await screen.findByRole("button", { name: "Edit campus view" })).toBeVisible(); await userEvent.click(screen.getByRole("button", { name: "Map tools", exact: true })); await userEvent.click(screen.getByRole("button", { name: "Campus activity", exact: true })); expect(screen.getByRole("region", { name: "Campus operations" })).toBeVisible();
    vi.mocked(getCampusSceneDirectory).mockRejectedValueOnce(new ApiError("Access unavailable", 403)); await act(async () => { await client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "directory"], exact: true }); });
    expect(screen.getByRole("button", { name: "Canvas Learning building" })).toBeVisible(); await waitFor(() => expect(screen.queryByRole("button", { name: "Edit campus view" })).not.toBeInTheDocument()); expect(screen.queryByRole("region", { name: "Campus operations" })).not.toBeInTheDocument();
  });
  it("lets a member explore published buildings and named floors without requesting an administrator workspace", async () => {
    const client = mount("/more/virtual-campus?edit=1");
    await userEvent.click(await screen.findByRole("button", { name: "Canvas Learning building" }));
    await userEvent.click(screen.getByRole("button", { name: "Show First floor on map" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByRole("button", { name: "Canvas Classroom A" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit campus view" })).not.toBeInTheDocument();
    expect(getCampusSceneWorkspace).not.toHaveBeenCalled();
    expect(state.operationMount).not.toHaveBeenCalled();
    act(() => { setAppearance("dark"); });
    expect(screen.getByLabelText("Campus canvas")).toHaveAttribute("data-lighting", "night");
    act(() => { setAppearance("light"); });
    expect(screen.getByLabelText("Campus canvas")).toHaveAttribute("data-lighting", "day");
    expect(getCampusSceneWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: "Campus lighting preview" })).not.toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ["execution-environment", "live", "campus-scenes", "live:global", "school-1", "main", "published"] })).toBeDefined();
  });
  it("requires an explicit reopen before an administrator edits a published version", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true });
    vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: null, published_version: 5, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    vi.mocked(reopenCampusScene).mockResolvedValue({ id: "scene", revision: 6, document, draft: document, published_version: 5, replayed: false });
    mount();
    const edit = await screen.findByRole("button", { name: "Edit campus view" });
    const context = screen.getByRole("group", { name: "Campus context" });
    expect(within(context).getByText("Main campus")).toBeVisible();
    expect(within(context).getByRole("button", { name: "Edit campus view" })).toBe(edit);
    expect(screen.queryByText("Published campus view")).not.toBeInTheDocument();
    await userEvent.click(edit);
    expect(await screen.findByRole("heading", { name: "Start the next version" })).toBeVisible();
    expect(reopenCampusScene).not.toHaveBeenCalled();
    vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 6, draft: document, published_version: 5, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    await userEvent.click(screen.getByRole("button", { name: "Start a new draft" }));
    await waitFor(() => expect(reopenCampusScene).toHaveBeenCalledWith("school-1", "main", 5, expect.any(String)));
    expect(await screen.findByText("Editable campus draft")).toBeVisible();
  });
  it("keeps the compact campus selector accessible and protects an unsaved draft on a campus switch", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [
      { id: "main", name: "Main campus", code: "MAIN", is_primary: true },
      { id: "east", name: "East campus", code: "EAST", is_primary: false },
    ], can_edit: true });
    vi.mocked(getCampusSceneWorkspace).mockResolvedValue({ campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount("/more/virtual-campus?edit=1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit local draft" }));
    const campus = within(screen.getByRole("group", { name: "Campus context" })).getByRole("combobox", { name: "Campus" });
    await userEvent.selectOptions(campus, "east");
    expect(confirm).toHaveBeenCalledWith("Switch campuses? Unsaved changes in this draft will be lost.");
    expect(campus).toHaveValue("main");
    expect(getCampusSceneWorkspace).not.toHaveBeenCalledWith("school-1", "east", expect.anything());
    expect(screen.getByText("Editable campus draft")).toBeVisible();
  });
  it("does not request a campus ID outside the authorized directory", async () => {
    mount("/more/virtual-campus?campus_id=other-institution");
    expect(await screen.findByRole("heading", { name: "Campus unavailable" })).toBeVisible();
    expect(getCampusScenePublished).not.toHaveBeenCalled();
    expect(getCampusSceneWorkspace).not.toHaveBeenCalled();
  });
  it("preserves the mounted editor when another person publishes during local editing", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    const workspace = { campus: { id: "main", name: "Main campus", code: "MAIN" }, spaces: [], scene: { id: "scene", revision: 5, draft: document, published_version: 4, published: null, updated_at: "2026-10-25T10:00:00Z" } };
    vi.mocked(getCampusSceneWorkspace).mockResolvedValue(workspace);
    const client = mount("/more/virtual-campus?edit=1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit local draft" }));
    act(() => { client.setQueryData(["execution-environment", "live", "campus-scenes", "live:global", "school-1", "main", "workspace"], { ...workspace, scene: { ...workspace.scene, revision: 6, draft: null, published_version: 6 } }); });
    expect(screen.getByText("Editable campus draft")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Start the next version" })).not.toBeInTheDocument();
  });
  it("does not mount oversight for an administrator of another institution even with stale editor capabilities", async () => {
    state.otherSchoolAdmin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true });
    mount("/more/virtual-campus?panel=activity&edit=1");
    expect(await screen.findByRole("button", { name: "Canvas Learning building" })).toBeVisible();
    expect(state.operationMount).not.toHaveBeenCalled();
    expect(getCampusSceneWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Edit campus view" })).not.toBeInTheDocument();
  });
  it("carries the panel and development overlay into the same map and preserves the floor while activity refreshes", async () => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true });
    const overlay: CampusViewOverlay = { status: "running", badge_label: "Simulated", zones: [], activity: [] };
    mount("/more/virtual-campus?panel=activity", overlay);
    await userEvent.click(await screen.findByRole("button", { name: "Map tools", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Campus activity", exact: true }));
    await screen.findByRole("region", { name: "Campus operations" });
    expect(state.operationMount).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-1", campusId: "main", initialPanel: "activity", overlay, scene: document }));
    await userEvent.click(screen.getByRole("button", { name: "Select recorded classroom" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    await userEvent.click(screen.getByText("Activity at this place"));
    await userEvent.click(screen.getByRole("button", { name: "View recorded activity" }));
    expect(state.inspectPlace).toHaveBeenCalledWith("place-room");
    await userEvent.click(screen.getByRole("button", { name: "Map tools", exact: true })); await userEvent.click(screen.getByRole("button", { name: "Campus activity", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh recorded activity" }));
    expect(screen.getByText("Recorded activity revision 2")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByRole("button", { name: "Canvas Classroom A" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Canvas Learning building" })).not.toBeInTheDocument();
    expect(document.elements[1]?.geometry.points[0]).toEqual({ x: 15, y: 15 });
  });
  it.each(["empty", "error"])("keeps authorized operational lists available when the map is %s", async (condition) => {
    state.admin = true;
    vi.mocked(getCampusSceneDirectory).mockResolvedValue({ campuses: [{ id: "main", name: "Main campus", code: "MAIN", is_primary: true }], can_edit: true });
    if (condition === "error") vi.mocked(getCampusScenePublished).mockRejectedValue(new Error("Map unavailable"));
    else vi.mocked(getCampusScenePublished).mockResolvedValue({ ...(await getCampusScenePublished("", "")), can_edit: true, scene: null });
    mount();
    expect(await screen.findByRole("region", { name: "Campus operations" })).toBeVisible();
    expect(state.operationMount).toHaveBeenCalledWith(expect.objectContaining({ scene: null }));
    expect(screen.queryByLabelText("Campus canvas")).not.toBeInTheDocument();
    expect(condition === "error" ? screen.getByText("Map unavailable") : screen.getByRole("button", { name: "Create campus view" })).toBeVisible();
  });
});
