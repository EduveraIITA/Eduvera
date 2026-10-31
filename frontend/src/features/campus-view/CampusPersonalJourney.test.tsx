import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusPersonalJourney } from "./CampusPersonalJourney";
import { CampusScenePublishedView } from "../campus-scenes/CampusScenePublishedView";
import { getCampusPersonalJourney, personalJourneyMatches } from "./personalJourney.api";
import type { CampusPersonalResponse } from "./personalJourney.types";
import { getCampusSceneResources, type CampusScenePublished } from "../campus-scenes/api";
import type { CampusSceneDocument } from "../campus-scenes/types";
import { findSceneWalkingRoute, type SceneWalkingRoute } from "../campus-scenes/sceneWalking";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { personalJourneyPlaceTrail, personalWalkingDestination } from "./personalJourney";
import { CampusPersonalDirections } from "./CampusPersonalDirections";

const auth = vi.hoisted(() => ({ user: { id: "aditi", active_school_id: "school" }, memberships: [{ school_id: "school", role: "student" }] }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth, useOptionalAuth: () => auth }));
vi.mock("../campus-scenes/api", async original => ({ ...await original<typeof import("../campus-scenes/api")>(), getCampusSceneResources: vi.fn() }));
vi.mock("./personalJourney.api", async original => ({ ...await original<typeof import("./personalJourney.api")>(), getCampusPersonalJourney: vi.fn() }));
vi.mock("../campus-scenes/CampusSceneCanvas", () => ({ CampusSceneCanvas: ({ scene, walkingRoute, onSelectElement, mode }: { scene: CampusSceneDocument; walkingRoute?: SceneWalkingRoute; onSelectElement: (id: string) => void; mode: "2d" | "2.5d" }) => <div aria-label="Published map" data-mode={mode}><output aria-label="Map route">{walkingRoute?.status ?? "none"}</output>{scene.elements.map(item => <button key={item.id} onClick={() => onSelectElement(item.id)}>Select {item.label}</button>)}</div> }));

const publication: CampusScenePublished = {
  campus: { id: "campus", name: "Aaranya", code: "AIT", timezone: "UTC" }, can_edit: false,
  places: [
    { id: "gate", name: "North gate", code: "N", kind: "gate", parent_space_id: null },
    { id: "building", name: "Academic block", code: "A", kind: "building", parent_space_id: null },
    { id: "floor", name: "First floor", code: "F1", kind: "floor", parent_space_id: "building" },
    { id: "room", name: "Classroom 101", code: "101", kind: "classroom", parent_space_id: "floor", capacity: 40 },
  ],
  scene: { id: "scene", version: 1, published_at: "2026-10-26T10:00:00Z", document: { schema_version: 1, name: "Aaranya", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [
    { id: "academic", kind: "building", label: "Academic block", space_id: "building", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 60, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 60, y: 40 }] } },
    { id: "classroom", kind: "room", label: "Classroom 101", space_id: "room", floor_id: "floor", parent_element_id: "academic", review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 65, y: 15 }, { x: 75, y: 15 }, { x: 75, y: 25 }, { x: 65, y: 25 }] } },
    { id: "walk", kind: "path", label: "Main walk", space_id: null, floor_id: null, review_state: "reviewed", geometry: { type: "polyline", points: [{ x: 10, y: 50 }, { x: 75, y: 50 }, { x: 75, y: 40 }] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: "gate", end_space_id: "building" } },
  ] } },
};
function response(): CampusPersonalResponse {
  const item = { id: "session-1", kind: "teaching_session" as const, title: "Distributed Systems", detail: "M.Tech Data Engineering", starts_at: "2026-10-26T10:30:00Z", ends_at: "2026-10-26T11:30:00Z", state: "upcoming" as const, space_id: "room", place_label: "Classroom 101", target_path: "/areas/timetable/session?session_id=one&date=2026-10-26", action_label: "Open session", dimension: "expected" as const, spatial_claim: "expected_context_only" as const, source: { domain: "teaching_sessions", record_id: "one", revision: 1, label: "Published timetable" } };
  return { schema_version: 1, school_id: "school", campus_id: "campus", as_of: "2026-10-26T10:00:00Z", local_date: "2026-10-26", timezone: "UTC", environment: { kind: "live", namespace_id: "live:school" }, freshness: { status: "current", as_of: "2026-10-26T10:00:00Z" }, places: publication.places, now: [], next: [item], destinations: [item], limitations: [] };
}
function SessionDestination() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Return destination">{(location.state as { portalReturnTo?: string })?.portalReturnTo}</output><button onClick={() => navigate(-1)}>Back to campus</button></>; }
function openDay() {
  if (screen.queryByRole("complementary", { name: "My campus day" })) return;
  if (!screen.queryByRole("complementary", { name: "Map tools" })) fireEvent.click(screen.getByRole("button", { name: "Map tools" }));
  fireEvent.click(screen.getByRole("button", { name: "My day" }));
}
function mount(path = "/more/virtual-campus", published = publication, initialBlocked: readonly string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let environment: ExecutionEnvironment = { mode: "live" };
  let blocked = initialBlocked;
  const element = () => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><Routes><Route path="/more/virtual-campus" element={<CampusPersonalJourney schoolId="school" campusId="campus" publication={published} blockedConnectorIds={blocked}>{personal => <><output aria-label="Personal selection intent">{personal.selection?.intent ?? "none"}</output><CampusScenePublishedView schoolId="school" data={published} personal={personal} /></>}</CampusPersonalJourney>} /><Route path="/areas/timetable/session" element={<SessionDestination />} /></Routes></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const rendered = render(element());
  openDay();
  return { client, rerender() { rendered.rerender(element()); }, switchWorld(next: ExecutionEnvironment) { environment = next; rendered.rerender(element()); }, blockConnectors(ids: readonly string[]) { blocked = ids; rendered.rerender(element()); } };
}
beforeEach(() => { auth.user.id = "aditi"; auth.user.active_school_id = "school"; auth.memberships = [{ school_id: "school", role: "student" }]; vi.mocked(getCampusPersonalJourney).mockResolvedValue(response()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("personal campus journey", () => {
  it.each(["2.5d", "2d"] as const)("preserves the chosen %s outdoor perspective after opening a room and requesting directions", async mode => {
    mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    if (mode === "2d") {
      await userEvent.click(screen.getByRole("button", { name: "Map tools" }));
      await userEvent.click(screen.getByRole("button", { name: "Flat plan" }));
      openDay();
    }
    expect(screen.getByLabelText("Published map")).toHaveAttribute("data-mode", mode);
    await userEvent.click(screen.getByRole("button", { name: "Show place" }));
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    expect(screen.getByLabelText("Published map")).toHaveAttribute("data-mode", "2d");
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    expect(screen.queryByRole("combobox", { name: "Floor" })).toBeNull();
    expect(screen.getByLabelText("Published map")).toHaveAttribute("data-mode", mode);
    await userEvent.click(screen.getByRole("button", { name: "Map tools" }));
    expect(screen.getByRole("button", { name: mode === "2d" ? "Flat plan" : "2.5D" })).toHaveAttribute("aria-pressed", "true");
  });
  it("opens the student's assigned room, routes from a chosen gate and reaches the actual session with return context", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Distributed Systems" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Start from" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    const start = screen.getByRole("combobox", { name: "Start from" });
    expect(start).toHaveValue("");
    await userEvent.selectOptions(start, "gate");
    expect(screen.getByText("Outdoor walk to Academic block")).toBeVisible();
    expect(screen.getByText("75 m along the published paths")).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
    expect(screen.getByText(/Indoor route not mapped/)).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Start from" })).toBeNull();
    expect(screen.getByRole("status", { name: "Walking route ready" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Show destination details" }));
    expect(screen.getByLabelText("Personal selection intent")).toHaveTextContent("journey");
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    await userEvent.click(screen.getByRole("button", { name: "Select Classroom 101" }));
    expect(screen.getByLabelText("Personal selection intent")).toHaveTextContent("explore");
    expect(within(screen.getByRole("region", { name: "Selected place context" })).getByRole("heading", { name: "Classroom 101" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Show Classroom 101 on map" })).toHaveAttribute("aria-current", "location");
    expect(screen.queryByRole("region", { name: "Room inventory" })).toBeNull();
    expect(getCampusSceneResources).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Activity at this place", { exact: true }));
    expect(screen.getByText("Published capacity: 40")).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "Distributed Systems, Open session" }));
    expect(screen.getByLabelText("Return destination")).toHaveTextContent("/more/virtual-campus?");
    expect(screen.getByLabelText("Return destination")).toHaveTextContent("journey=session-1");
    expect(screen.getByLabelText("Return destination")).toHaveTextContent("walk_from=gate");
    await userEvent.click(screen.getByRole("button", { name: "Back to campus" }));
    expect(within(screen.getByRole("region", { name: "Selected place context" })).getByRole("heading", { name: "Classroom 101" })).toBeVisible();
    openDay();
    expect(screen.getByRole("button", { name: /Route options.*From North gate/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
    await userEvent.click(screen.getByRole("button", { name: "Campus" }));
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
  });
  it("honours step-free settings and never invents a route across a closed path", async () => {
    const published = structuredClone(publication); published.scene!.document.elements[2]!.navigation!.accessible = false;
    mount(undefined, published); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    await userEvent.click(screen.getByRole("button", { name: /^Route options/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Step-free paths only/ }));
    expect(screen.getByText(/No connected open path matches/)).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("unavailable");
  });
  it("returns to My day after its source action even when a prior map selection had explore intent", async () => {
    mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Show place" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Classroom 101" }));
    expect(within(screen.getByRole("region", { name: "Selected place context" })).getByRole("heading", { name: "Classroom 101" })).toBeVisible();
    expect(screen.getByLabelText("Personal selection intent")).toHaveTextContent("explore");
    openDay();
    await userEvent.click(screen.getByRole("link", { name: "Open session" }));
    expect(screen.getByLabelText("Return destination")).toHaveTextContent("map_panel=day");
    await userEvent.click(screen.getByRole("button", { name: "Back to campus" }));
    expect(screen.getByRole("complementary", { name: "My campus day" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Distributed Systems" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Floor" })).toHaveDisplayValue("First floor");
  });
  it("reaches the exact room on a complete reviewed indoor network and withdraws a newly unavailable lift", async () => {
    const published = structuredClone(publication), scene = published.scene!.document;
    published.places.push({ id: "ground", name: "Ground floor", code: "G", kind: "floor", parent_space_id: "building" });
    const path = (id: string, floor: string, points: { x: number; y: number }[], destination: string | null) => ({ id, kind: "path" as const, label: id, space_id: null, floor_id: floor, parent_element_id: "academic", review_state: "reviewed" as const, geometry: { type: "polyline" as const, points }, navigation: { walkable: true, accessible: true, status: "open" as const, start_space_id: null, end_space_id: destination } });
    scene.elements.push(path("ground-corridor", "ground", [{ x: 75, y: 40 }, { x: 75, y: 30 }], null), path("upper-corridor", "floor", [{ x: 75, y: 30 }, { x: 70, y: 25 }], "room"),
      { id: "entrance", kind: "fixture", label: "Academic entrance", floor_id: null, space_id: null, parent_element_id: "academic", asset_key: "equipment", review_state: "reviewed", geometry: { type: "point", points: [{ x: 75, y: 40 }] }, navigation_connector: { kind: "entrance", accessible: true, status: "open", from_floor_id: null, to_floor_id: "ground" } },
      { id: "lift", kind: "fixture", label: "Academic lift", floor_id: "ground", space_id: null, parent_element_id: "academic", holding_id: "lift-holding", asset_key: "equipment", review_state: "reviewed", geometry: { type: "point", points: [{ x: 75, y: 30 }] }, navigation_connector: { kind: "lift", accessible: true, status: "open", from_floor_id: "ground", to_floor_id: "floor" } });
    vi.mocked(getCampusPersonalJourney).mockResolvedValue({ ...response(), places: published.places });
    const mounted = mount(undefined, published);
    await userEvent.click(await screen.findByRole("button", { name: "Directions" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Step-free paths only" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    expect(screen.getByText("Walk to Classroom 101")).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
    expect(screen.queryByText(/Indoor route not mapped/)).toBeNull();
    await userEvent.click(screen.getByText("Route steps · 2 connections", { exact: true }));
    expect(screen.getByText("Take the lift · Academic lift")).toBeVisible();
    mounted.blockConnectors(["lift"]);
    expect(screen.getByLabelText("Map route")).toHaveTextContent("unavailable");
    expect(screen.getByText(/No connected open path matches/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Step-free paths only" })).toBeChecked();
    mounted.blockConnectors([]);
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
  });
  it("removes stale directions when an activity moves or is cancelled", async () => {
    const mounted = mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    const key = ["execution-environment", "live", "campus-view", "mine", "school", "aditi", "campus", "current"];
    const moved = response(); moved.next[0]!.space_id = "building"; moved.next[0]!.source.revision = 2;
    act(() => { mounted.client.setQueryData(key, moved); });
    expect(await screen.findByText(/Your activity or its place changed/)).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
    expect(screen.queryByRole("region", { name: "Selected place context" })).toBeNull();
    const cancelled = response(); cancelled.now = []; cancelled.next = []; cancelled.destinations = [];
    act(() => { mounted.client.setQueryData(key, cancelled); });
    expect(await screen.findByRole("heading", { name: "Your campus is yours to explore" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open session" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
  });
  it("retains the map on error and rejects a different campus's retained response", async () => {
    vi.mocked(getCampusPersonalJourney).mockResolvedValue({ ...response(), campus_id: "other-campus" });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your campus activities could not be loaded");
    expect(screen.getByLabelText("Published map")).toBeVisible();
    expect(screen.queryByText("Distributed Systems")).toBeNull();
  });
  it("partitions private data by actor and world and never loads an unavailable world", async () => {
    const mounted = mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    auth.user.id = "faculty";
    vi.mocked(getCampusPersonalJourney).mockResolvedValue({ ...response(), now: [], next: [], destinations: [] });
    mounted.rerender();
    expect(await screen.findByRole("heading", { name: "Your campus is yours to explore" })).toBeVisible();
    expect(screen.queryByText("Distributed Systems")).toBeNull();
    const simulation = { mode: "simulation" as const, runId: "one", namespaceId: "run:one", virtualClock: { now: "2026-10-26T11:00:00Z", timeZone: "UTC" } };
    vi.mocked(getCampusPersonalJourney).mockResolvedValue({ ...response(), environment: { kind: "simulation", namespace_id: "run:one" } });
    mounted.switchWorld(simulation);
    openDay();
    await screen.findByRole("heading", { name: "Distributed Systems" });
    expect(mounted.client.getQueryCache().getAll().map(query => query.queryKey)).toContainEqual(["execution-environment", "simulation", "run:one", "one", "campus-view", "mine", "school", "faculty", "campus", "2026-10-26T11:00:00Z"]);
    const calls = vi.mocked(getCampusPersonalJourney).mock.calls.length;
    mounted.switchWorld({ mode: "simulation", runId: "one", namespaceId: "run:one", unavailable: true, unavailableReason: "runtime_unavailable" });
    openDay();
    expect(screen.getByRole("alert")).toHaveTextContent("Simulation is recovered");
    expect(getCampusPersonalJourney).toHaveBeenCalledTimes(calls);
    expect(screen.queryByText("Distributed Systems")).toBeNull();
  });
  it("does not request personal data after active institution access is removed", async () => {
    auth.user.active_school_id = "elsewhere"; mount(); await act(async () => {});
    expect(getCampusPersonalJourney).not.toHaveBeenCalled(); expect(screen.getByLabelText("Published map")).toBeVisible();
  });
  it("supports keyboard directions controls and preserves a route through a successful refresh", async () => {
    const mounted = mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    const directions = screen.getByRole("button", { name: "Directions" }); directions.focus(); await userEvent.keyboard("{Enter}");
    expect(directions).toHaveFocus(); expect(directions).toHaveAttribute("aria-expanded", "true");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(getCampusPersonalJourney).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Route options.*From North gate/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
    expect(mounted.client.getQueryCache().getAll()[0]?.state.data).toBeDefined();
  });
  it("clears retained private activities and directions when a refresh loses access", async () => {
    mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    vi.mocked(getCampusPersonalJourney).mockRejectedValue(new Error("Access denied"));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your campus activities could not be loaded");
    expect(screen.queryByRole("heading", { name: "Distributed Systems" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open session" })).toBeNull();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
  });
  it("keeps an unmapped assignment honest and rejects external source URLs", async () => {
    const data = response(); data.next[0]!.space_id = "missing-room"; data.next[0]!.target_path = "https://outside.invalid/action";
    vi.mocked(getCampusPersonalJourney).mockResolvedValue(data); mount();
    expect(await screen.findByText("The assigned place is not mapped in this layout yet.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show place" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open session" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    expect(screen.getByText("This destination does not have a reviewed entrance connection yet.")).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
    expect(screen.queryByRole("button", { name: "Show destination details" })).toBeNull();
  });
  it("can refresh directions to the next assignment after the selected session is cancelled", async () => {
    const mounted = mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    const next = response(); next.next[0]!.id = "replacement-session"; next.next[0]!.title = "Advanced Algorithms";
    act(() => { mounted.client.setQueryData(["execution-environment", "live", "campus-view", "mine", "school", "aditi", "campus", "current"], next); });
    expect(await screen.findByText(/Your activity or its place changed/)).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    expect(screen.queryByText(/Your activity or its place changed/)).toBeNull();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("available");
    expect(screen.getByRole("heading", { name: "Advanced Algorithms" })).toBeVisible();
  });
  it("preserves an unrelated place the person chose to explore when the assigned destination moves", async () => {
    const mounted = mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    await userEvent.click(screen.getByRole("button", { name: "Select Academic block" }));
    expect(screen.getByRole("region", { name: "Academic block explorer" })).toBeVisible();
    expect(screen.getByLabelText("Personal selection intent")).toHaveTextContent("explore");
    const moved = response(); moved.next[0]!.space_id = null; moved.next[0]!.source.revision = 2;
    act(() => { mounted.client.setQueryData(["execution-environment", "live", "campus-view", "mine", "school", "aditi", "campus", "current"], moved); });
    expect(await screen.findByRole("region", { name: "Academic block explorer" })).toBeVisible();
    expect(screen.getByLabelText("Personal selection intent")).toHaveTextContent("explore");
    expect(screen.getByRole("button", { name: "Show Classroom 101 on map" })).toBeVisible();
    expect(screen.getByLabelText("Map route")).toHaveTextContent("none");
  });
  it("reopens route choices without losing the origin or step-free preference", async () => {
    mount(); await screen.findByRole("heading", { name: "Distributed Systems" });
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Step-free paths only" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Start from" }), "gate");
    expect(screen.getByRole("button", { name: /Route options.*Step-free/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status", { name: "Walking route ready" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /^Route options/ }));
    expect(screen.getByRole("combobox", { name: "Start from" })).toHaveValue("gate");
    expect(screen.getByRole("checkbox", { name: "Step-free paths only" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Close directions" }));
    await userEvent.click(screen.getByRole("button", { name: "Directions" }));
    expect(screen.getByRole("checkbox", { name: "Step-free paths only" })).toBeChecked();
  });
  it("bounds selected-place activities to the nearest two until More activities is opened", async () => {
    const data = response(), first = data.next[0]!;
    data.destinations = [0, 1, 2, 3, 4].map(index => ({ ...first, id: `study-${index}`, title: `Study session ${index}`, starts_at: `2026-10-${String(26 + index).padStart(2, "0")}T10:30:00Z`, ends_at: `2026-10-${String(26 + index).padStart(2, "0")}T11:30:00Z` }));
    data.next = [data.destinations[0]!]; vi.mocked(getCampusPersonalJourney).mockResolvedValue(data);
    mount(); await screen.findByRole("heading", { name: "Study session 0" });
    await userEvent.click(screen.getByRole("button", { name: "Show place" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Classroom 101" }));
    expect(within(screen.getByRole("region", { name: "Selected place context" })).getByRole("heading", { name: "Classroom 101" })).toBeVisible();
    await userEvent.click(screen.getByText("Activity at this place", { exact: true }));
    expect(screen.getByRole("link", { name: "Study session 0, Open session" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Study session 1, Open session" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Study session 2, Open session" })).not.toBeVisible();
    await userEvent.click(screen.getByText("More activities · 3", { exact: true }));
    expect(screen.getByRole("link", { name: "Study session 2, Open session" })).toBeVisible();
    openDay();
    expect(screen.getAllByRole("link").filter(link => link.classList.contains("campus-scene-button--primary"))).toHaveLength(1);
    const day = screen.getByText("Your day · 5 activities", { exact: true });
    await userEvent.click(day);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Your places and activities" }), "study-1");
    expect(day.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Study session 1" })).toHaveFocus();
  });
  it("retains focus when new path availability automatically closes focused route options", async () => {
    const props = { item: response().next[0]!, origins: publication.places, originId: "gate", onOrigin: vi.fn(), accessibleOnly: false, onAccessible: vi.fn(), destination: publication.places[1]!, trail: publication.places.slice(1), onShowRoom: vi.fn(), stale: false, placeMapped: true };
    const { rerender } = render(<CampusPersonalDirections {...props} route={{ status: "unavailable", reason: "no_path", fromSpaceId: "gate", toSpaceId: "building" }} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Step-free paths only" }));
    rerender(<CampusPersonalDirections {...props} route={findSceneWalkingRoute(publication.scene!.document, { fromSpaceId: "gate", toSpaceId: "building" })} />);
    expect(screen.getByRole("status", { name: "Walking route ready" })).toHaveFocus();
    expect(screen.queryByRole("checkbox", { name: "Step-free paths only" })).toBeNull();
  });
});

describe("personal place resolution", () => {
  it("uses exact authored ancestor endpoints and stops canonical cycles", () => {
    expect(personalWalkingDestination(publication.scene!.document, publication.places, "room")?.id).toBe("building");
    expect(personalWalkingDestination(publication.scene!.document, publication.places, "unknown")).toBeNull();
    expect(personalJourneyPlaceTrail([{ ...publication.places[1]!, parent_space_id: "room" }, ...publication.places.slice(2)], "room")).toHaveLength(3);
  });
  it("fails closed for Live versus Simulation namespace mismatches", () => {
    expect(personalJourneyMatches(response(), "school", "campus", { mode: "live" })).toBe(true);
    expect(personalJourneyMatches({ ...response(), environment: { kind: "live", namespace_id: "live:other-school" } }, "school", "campus", { mode: "live" })).toBe(false);
    expect(personalJourneyMatches({ ...response(), environment: { kind: "live", namespace_id: null } }, "school", "campus", { mode: "live" })).toBe(true);
    expect(personalJourneyMatches(response(), "school", "campus", { mode: "simulation", runId: "one", namespaceId: "run:one", virtualClock: { now: response().as_of, timeZone: "UTC" } })).toBe(false);
  });
});
