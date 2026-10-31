import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusSceneOperations, type CampusSceneOperationsPanel } from "./CampusSceneOperations";
import { getCampusView } from "./api";
import { getCampusSceneResourceStates } from "../campus-scenes/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { CampusSceneDocument } from "../campus-scenes/types";
import type { CampusViewResponse, CampusViewSpace } from "./types";

const auth = vi.hoisted((): { user: { active_school_id: string | null }; memberships: Array<{ role: string; school_id: string }> } => ({ user: { active_school_id: "school" }, memberships: [{ role: "admin", school_id: "school" }] }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./api", () => ({ getCampusView: vi.fn() }));
vi.mock("../campus-scenes/api", () => ({ getCampusSceneResourceStates: vi.fn() }));
vi.mock("./CampusKpiPanel", () => ({ CampusKpiPanel: () => <div>Operational KPI panel</div> }));
const building: CampusViewSpace = { id: "building", campus_id: "campus", name: "Academic block", code: "A", kind: "building", parent_space_id: null, floor_id: "", floor_label: "", capacity: null, assertions: { expected: [], accepted: [], observed: [] }, expected_now: [], day_activity_count: 0, gate_activity_today: null, state_dimension: "unknown", signal_count: 0 };
const room: CampusViewSpace = { ...building, id: "room", name: "Room 201", kind: "classroom", parent_space_id: "building", state_dimension: "expected", expected_now: [{ id: "occurrence", occurrence_id: "stable", space_id: "room", title: "Robotics club", slot_type: "activity", class_label: null, subject_label: null, teacher: null, expected_count: 8, starts_at: "2026-10-25T09:00:00Z", ends_at: "2026-10-25T11:00:00Z", state: "in_progress", dimension: "expected", spatial_claim: "expected_context_only", source: { domain: "activities", record_id: "activity", revision: 2, label: "Published activity", target_path: "/areas/activities?activity=activity" } }] };
const response: CampusViewResponse = { schema_version: 1, school: { id: "school", name: "School" }, campuses: [{ id: "campus", name: "Campus", code: "MAIN", is_primary: true, timezone: "UTC" }], selected_campus_id: "campus", as_of: "2026-10-25T10:00:00Z", generated_at: "2026-10-25T10:00:00Z", plan: null, spaces: [building, room], activity: [], signals: [], operations: null };
const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [{ id: "visual-building", kind: "building", label: "Academic block", space_id: "building", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 20 }, { x: 1, y: 20 }] } }] };

function mount(options: { environment?: ExecutionEnvironment; scene?: CampusSceneDocument | null; initialPanel?: CampusSceneOperationsPanel; svgMarkers?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let environment = options.environment ?? { mode: "live" as const };
  const element = () => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter><CampusSceneOperations schoolId="school" campusId="campus" scene={options.scene === undefined ? scene : options.scene} initialPanel={options.initialPanel}>{bridge => <>
    <div data-testid="physical-map">Physical campus layout</div><div data-testid="map-controls">{bridge.mapControls}</div>{bridge.controls}
    <output aria-label="Selected place">{bridge.selectedSpaceId}</output>
    <output aria-label="Canonical places">{JSON.stringify(bridge.places)}</output>
    <output aria-label="Canonical places state">{bridge.placesState}</output>
    <output aria-label="Unavailable fixtures">{bridge.unavailableFixtureIds.join(",")}</output>
    <output aria-label="Operational dialog state">{String(bridge.dialogOpen)}</output>
    <output aria-label="Room inspection state">{bridge.inspectionState?.("room")}</output>
    <output aria-label="Missing place inspection state">{bridge.inspectionState?.("unmapped")}</output>
    <button type="button" onClick={bridge.closeDialog}>Close operational drilldown</button>
    <button type="button" onClick={() => bridge.onSelectPlace("room")}>Select place only</button>
    <button type="button" onClick={() => bridge.onInspectPlace("room")}>Inspect selected place</button>
    {bridge.markersFor(scene, null).map(marker => options.svgMarkers ? <svg key={marker.id}><g role="button" tabIndex={0} aria-label={`${marker.label} ${marker.count}`} onKeyDown={event => { if (event.key === "Enter") bridge.onSelectMarker(marker.id); }}><text>{marker.label}</text></g></svg> : <button type="button" key={marker.id} onClick={() => bridge.onSelectMarker(marker.id)}>{marker.label} {marker.count}</button>)}
  </>}</CampusSceneOperations></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const rendered = render(element());
  return { client, switchWorld(next: ExecutionEnvironment) { environment = next; rendered.rerender(element()); }, rerender() { rendered.rerender(element()); } };
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => { auth.user.active_school_id = "school"; auth.memberships = [{ role: "admin", school_id: "school" }]; vi.mocked(getCampusView).mockResolvedValue(response); vi.mocked(getCampusSceneResourceStates).mockResolvedValue({ generated_at: response.generated_at, items: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("unified campus operations bridge", () => {
  it("exposes minimal canonical places including unmapped rooms without leaking operational records or another campus", async () => {
    vi.mocked(getCampusView).mockResolvedValue({ ...response, spaces: [building, { ...room, capacity: 24 }, { ...room, id: "remote-room", campus_id: "remote-campus" }] });
    mount();
    await waitFor(() => expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("available"));
    expect(JSON.parse(screen.getByLabelText("Canonical places").textContent)).toEqual([
      { id: "building", campus_id: "campus", parent_space_id: null, name: "Academic block", code: "A", kind: "building", capacity: null },
      { id: "room", campus_id: "campus", parent_space_id: "building", name: "Room 201", code: "A", kind: "classroom", capacity: 24 },
    ]);
    expect(screen.getByLabelText("Canonical places")).not.toHaveTextContent(/Robotics|assertions|expected_now|remote-room/);
  });
  it("restores the exact keyboard-focused SVG marker after its evidence dialog closes", async () => {
    mount({ svgMarkers: true }); await screen.findByText("Operational totals are unavailable.");
    fireEvent.change(screen.getByRole("combobox", { name: "Activity layer" }), { target: { value: "expected" } });
    const marker = screen.getByRole("button", { name: "Expected · Academic block 1" });
    expect(marker).toBeInstanceOf(SVGElement);
    marker.focus(); fireEvent.keyDown(marker, { key: "Enter" });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Academic block");
    fireEvent.click(screen.getByRole("button", { name: "Close evidence records" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(marker).toHaveFocus());
  });
  it("qualifies an exact place inspection while current oversight loads and after it fails", async () => {
    let resolve!: (value: CampusViewResponse) => void;
    vi.mocked(getCampusView).mockReturnValue(new Promise(value => { resolve = value; }));
    const mounted = mount();
    expect(screen.getByLabelText("Room inspection state")).toHaveTextContent("loading");
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("loading");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    fireEvent.click(screen.getByRole("button", { name: "Inspect selected place" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { resolve(response); });
    await waitFor(() => expect(screen.getByLabelText("Room inspection state")).toHaveTextContent("available"));
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("available");
    expect(screen.getByLabelText("Missing place inspection state")).toHaveTextContent("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Inspect selected place" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Room 201");
    vi.mocked(getCampusView).mockRejectedValue(new Error("Current snapshot unavailable"));
    await act(async () => { await mounted.client.refetchQueries({ queryKey: ["execution-environment", "live", "campus-view", "school", "campus"], exact: true }); });
    await waitFor(() => expect(screen.getByLabelText("Room inspection state")).toHaveTextContent("unavailable"));
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    expect(getCampusView).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("physical-map")).toBeVisible();
  });
  it("exposes a pending initial panel only when its current native dialog is rendered", async () => {
    let resolve!: (value: CampusViewResponse) => void;
    vi.mocked(getCampusView).mockReturnValue(new Promise(value => { resolve = value; }));
    mount({ initialPanel: "spaces" });
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { resolve(response); });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Campus spaces");
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Close operational drilldown" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
  });
  it("closes an owned drilldown through the workspace lifecycle without clearing its place selection", async () => {
    mount(); await screen.findByText("Operational totals are unavailable.");
    const trigger = screen.getByRole("button", { name: "Inspect selected place" });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Room 201");
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Close operational drilldown" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
    expect(screen.getByLabelText("Selected place")).toHaveTextContent("room");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("restores the native space-sheet trigger after its parent workspace can leave inert state", async () => {
    mount(); await screen.findByText("Operational totals are unavailable.");
    const trigger = screen.getByRole("button", { name: "Inspect selected place" });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Room 201");
    fireEvent.click(screen.getByRole("button", { name: "Close space details" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("drops dialog lifecycle state when its authority or selected world disappears", async () => {
    const mounted = mount(); await screen.findByText("Operational totals are unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Inspect selected place" }));
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("true");
    auth.memberships = [{ role: "member", school_id: "school" }]; mounted.rerender();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
    auth.memberships = [{ role: "admin", school_id: "school" }]; mounted.rerender();
    await screen.findByText("Operational totals are unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Inspect selected place" }));
    mounted.switchWorld({ mode: "simulation", runId: "one", namespaceId: "run:one", unavailable: true, unavailableReason: "runtime_unavailable" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByLabelText("Operational dialog state")).toHaveTextContent("false");
  });
  it.each(["member", "other-school", "no-active-school"])("never fetches oversight for %s while preserving the physical view", async mode => {
    if (mode === "member") auth.memberships = [{ role: "member", school_id: "school" }];
    if (mode === "other-school") auth.user.active_school_id = "other";
    if (mode === "no-active-school") auth.user.active_school_id = null;
    mount(); await act(async () => {});
    expect(getCampusView).not.toHaveBeenCalled(); expect(screen.getByTestId("physical-map")).toBeVisible();
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    expect(getCampusSceneResourceStates).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Campus operations" })).toBeNull();
  });
  it("separates selecting a place from explicitly opening its evidence", async () => {
    mount(); await screen.findByText("Operational totals are unavailable.");
    expect(within(screen.getByTestId("map-controls")).getByRole("combobox", { name: "Activity layer" })).toBeEnabled();
    expect(within(screen.getByRole("region", { name: "Campus operations" })).queryByRole("combobox", { name: "Activity layer" })).toBeNull();
    expect(screen.getAllByRole("combobox", { name: "Activity layer" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Select place only" }));
    expect(screen.getByLabelText("Selected place")).toHaveTextContent("room");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect selected place" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Room 201");
    expect(screen.getByRole("link", { name: "Open activity source" })).toHaveAttribute("href", "/areas/activities?activity=activity");
  });
  it("projects an unmapped room onto its canonical building and opens the original source", async () => {
    mount(); await screen.findByText("Operational totals are unavailable.");
    fireEvent.change(screen.getByRole("combobox", { name: "Activity layer" }), { target: { value: "expected" } });
    const marker = screen.getByRole("button", { name: "Expected · Academic block 1" });
    marker.focus(); fireEvent.click(marker);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Academic block");
    expect(screen.getByText("Robotics club")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "/areas/activities?activity=activity");
    fireEvent.click(screen.getByRole("button", { name: "Close evidence records" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(marker).toHaveFocus());
  });
  it("retains lists without a published scene and does not invent a schematic", async () => {
    mount({ scene: null });
    expect(await screen.findByRole("heading", { name: "Campus places" })).toBeVisible();
    expect(screen.getByTestId("map-controls")).toBeEmptyDOMElement();
    expect(within(screen.getByRole("region", { name: "Campus operations" })).getByRole("combobox", { name: "Activity layer" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Spaces" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Campus spaces");
    expect(screen.queryByText(/schematic/i)).toBeNull();
  });
  it("keeps the map usable on projection failure and rejects mismatched campus responses", async () => {
    vi.mocked(getCampusView).mockResolvedValue({ ...response, selected_campus_id: "other" });
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("Campus operations could not be loaded");
    expect(screen.getByLabelText("Canonical places state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Canonical places")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByTestId("physical-map")).toBeVisible();
    expect(screen.getByRole("button", { name: "Spaces" })).toBeDisabled();
  });
  it("isolates Live, Simulation and sibling caches and blocks unavailable worlds", async () => {
    const mounted = mount(); await screen.findByText("Operational totals are unavailable.");
    const world = (runId: string): ExecutionEnvironment => ({ mode: "simulation", runId, namespaceId: `run:${runId}`, virtualClock: { now: response.as_of, timeZone: "UTC" } });
    mounted.switchWorld(world("one")); await waitFor(() => expect(getCampusView).toHaveBeenCalledTimes(2));
    mounted.switchWorld(world("two")); await waitFor(() => expect(getCampusView).toHaveBeenCalledTimes(3));
    const keys = mounted.client.getQueryCache().getAll().map(query => query.queryKey);
    expect(keys).toContainEqual(["execution-environment", "simulation", "run:two", "two", "campus-view", "school", "campus"]);
    mounted.switchWorld({ mode: "simulation", runId: "two", namespaceId: "run:two", unavailable: true, unavailableReason: "runtime_unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("Simulation is recovered");
    expect(getCampusView).toHaveBeenCalledTimes(3);
  });
  it("delegates linked asset status and lighting to the shared member-scoped projection", async () => {
    const fixture = { id: "lamp", label: "Avenue lamp", kind: "fixture" as const, asset_key: "lamp" as const, holding_id: "holding", space_id: null, floor_id: null, review_state: "reviewed" as const, geometry: { type: "point" as const, points: [{ x: 50, y: 50 }] } };
    mount({ scene: { ...scene, elements: [...scene.elements, fixture] } });
    await screen.findByText("Operational totals are unavailable.");
    expect(getCampusSceneResourceStates).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unavailable fixtures")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Resource status" })).toBeNull();
  });
});
