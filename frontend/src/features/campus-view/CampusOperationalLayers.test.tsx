import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusOperationalLayers } from "./CampusOperationalLayers";
import { getCampusOperationalLayers } from "./campusOperational.api";
import { campusBlockedLiftIds } from "./campusOperational";
import type { CampusMapAsset, CampusOperationalProjection } from "./campusOperational.types";
import type { CampusScenePublished } from "../campus-scenes/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { portalReturnTarget } from "../navigation/portalReturnState";

const auth = vi.hoisted(() => ({ user: { id: "student", active_school_id: "school" }, memberships: [{ school_id: "school", role: "student" }] }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./campusOperational.api", async original => ({ ...await original<typeof import("./campusOperational.api")>(), getCampusOperationalLayers: vi.fn() }));
const publication: CampusScenePublished = { campus: { id: "campus", name: "Aaranya", code: "A", timezone: "UTC" }, can_edit: false,
  places: [{ id: "building", name: "Academic block", code: "A", kind: "building", parent_space_id: null }, { id: "floor", name: "First floor", code: "F1", kind: "floor", parent_space_id: "building" }, { id: "room", name: "Seminar room", code: "101", kind: "classroom", parent_space_id: "floor" }],
  scene: { id: "scene", version: 1, published_at: "2026-10-27T06:00:00Z", document: { schema_version: 1, name: "Aaranya", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed plan" }, elements: [
    { id: "visual-building", label: "Academic block", kind: "building", space_id: "building", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }] } },
    { id: "lamp", label: "Courtyard lamp", kind: "fixture", asset_key: "lamp", holding_id: "lamp-holding", space_id: "building", floor_id: null, review_state: "reviewed", geometry: { type: "point", points: [{ x: 60, y: 40 }] } },
    { id: "lift", label: "Academic lift", kind: "fixture", asset_key: "equipment", holding_id: "lift-holding", space_id: "building", floor_id: null, parent_element_id: "visual-building", navigation_connector: { kind: "lift", status: "open", accessible: true, from_floor_id: null, to_floor_id: "floor" }, review_state: "reviewed", geometry: { type: "point", points: [{ x: 20, y: 40 }] } },
  ] } } };
function asset(overrides: Partial<CampusMapAsset> = {}): CampusMapAsset { return { element_id: "lamp", holding_id: "lamp-holding", name: "Courtyard lamp", asset_tag: "L-1", space_id: "building", native_state: "available", reportable: true, signal: { state: "unknown", impact: null, open_reports: 0, updated_at: null }, repairs: [], ...overrides }; }
function response(): CampusOperationalProjection { return { schema_version: 1, school_id: "school", campus_id: "campus", publication: { id: "scene", version: 1 }, as_of: "2026-10-27T18:00:00Z", environment: { kind: "live", namespace_id: "live:school" }, assets: [asset()], limitations: [], activities: [
  { id: "class", layer: "classes", title: "Advanced Algorithms", detail: "Your next class", space_id: "room", holding_id: null, starts_at: "2026-10-28T09:00:00Z", ends_at: "2026-10-28T10:00:00Z", state: "upcoming", target_path: "/areas/timetable/session?session_id=class", action_label: "Open session", dimension: "expected", source: { domain: "teaching_sessions", record_id: "class", revision: 1, label: "Published timetable" } },
  { id: "event", layer: "events", title: "Robotics exhibition", detail: "Published event", space_id: null, holding_id: null, starts_at: "2026-10-28T16:00:00Z", ends_at: "2026-10-28T17:00:00Z", state: "upcoming", target_path: "/areas/events?event_id=expo", action_label: "Open event", dimension: "expected", source: { domain: "campus_events", record_id: "event", revision: 1, label: "Published event" } },
] }; }
function RouteProbe() {
  const location = useLocation(), target = portalReturnTarget(location.state, `${location.pathname}${location.search}`);
  return <><output aria-label="Current route">{location.pathname}{location.search}</output><output aria-label="Return route">{target}</output>{target ? <Link to={target}>Return to campus</Link> : null}</>;
}
function mount(path = "/more/virtual-campus", onLayoutRefresh = vi.fn(), surface: "all" | "route-warnings" = "all", svgMarkers = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let environment: ExecutionEnvironment = { mode: "live" };
  let currentSurface = surface;
  const element = () => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><RouteProbe /><CampusOperationalLayers schoolId="school" campusId="campus" publication={publication} onLayoutRefresh={onLayoutRefresh}>{bridge => <><div data-testid="published-layout">Published physical map</div>{bridge.mapControls}{currentSurface === "route-warnings" ? bridge.routeWarnings : bridge.controls}<output aria-label="Linked assets">{JSON.stringify(bridge.assets)}</output><output aria-label="Linked assets state">{bridge.assetsState}</output><output aria-label="Unlit fixtures">{bridge.faultLampIds.join(",")}</output><output aria-label="Blocked connectors">{bridge.blockedConnectorIds.join(",")}</output><output aria-label="Selected asset">{bridge.selectedAssetElementId}</output><output aria-label="Layout changed">{String(bridge.layoutChanged)}</output><output aria-label="Layer dialog state">{String(bridge.dialogOpen)}</output><button onClick={bridge.closeDialog}>Close layer drilldown</button><button onClick={() => bridge.onSelectAsset("lamp")}>Select lamp</button>{publication.scene!.document.elements.filter(item => item.holding_id).map(item => <div key={item.id}>{bridge.elementDetails(item)}</div>)}{bridge.markersFor(publication.scene!.document, null).map(marker => svgMarkers ? <svg key={marker.id}><g role="button" tabIndex={0} aria-label={marker.label} onKeyDown={event => { if (event.key === "Enter") bridge.onSelectMarker(marker.id); }}><text>{marker.label}</text></g></svg> : <button key={marker.id} onClick={() => bridge.onSelectMarker(marker.id)} aria-label={marker.label} data-expected-count={marker.expectedCount} data-tone={marker.tone}>{marker.summary}</button>)}</>}</CampusOperationalLayers></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const rendered = render(element());
  return { client, switchWorld(next: ExecutionEnvironment) { environment = next; rendered.rerender(element()); }, rerender() { rendered.rerender(element()); }, showSurface(next: "all" | "route-warnings") { currentSurface = next; rendered.rerender(element()); } };
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => { auth.user.id = "student"; auth.user.active_school_id = "school"; auth.memberships = [{ school_id: "school", role: "student" }]; vi.mocked(getCampusOperationalLayers).mockResolvedValue(response()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const key = ["execution-environment", "live", "campus-view", "operations", "school", "student", "campus", "scene", 1, "current"];

describe("member-scoped campus layers", () => {
  it("exposes only current assets whose fixture and canonical holding both match the publication", async () => {
    const data = response();
    data.assets.push(asset({ element_id: "unpublished", holding_id: "private-holding", name: "Unpublished resource" }), asset({ element_id: "lift", holding_id: "wrong-holding", name: "Mismatched resource" }));
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data);
    mount();
    await waitFor(() => expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("available"));
    expect(JSON.parse(screen.getByLabelText("Linked assets").textContent)).toEqual([asset()]);
  });
  it("restores the exact member-layer SVG marker after keyboard evidence inspection", async () => {
    mount("/more/virtual-campus?campus_layer=classes", undefined, "all", true);
    const marker = await screen.findByRole("button", { name: "Expected · Academic block" });
    expect(marker).toBeInstanceOf(SVGElement);
    marker.focus(); fireEvent.keyDown(marker, { key: "Enter" });
    expect(screen.getByRole("dialog")).toHaveTextContent("Advanced Algorithms");
    fireEvent.click(screen.getByRole("button", { name: "Close evidence records" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(marker).toHaveFocus());
  });
  it("retains the layer page when its workspace panel is unmounted and resets it for another layer", async () => {
    const data = response(), original = data.activities[0]!;
    data.activities = Array.from({ length: 17 }, (_, index) => ({ ...original, id: `class-${index}`, title: `Class ${index}`, source: { ...original.source, record_id: `class-${index}` } }));
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data);
    const mounted = mount("/more/virtual-campus?campus_layer=classes");
    await userEvent.click(await screen.findByText("Classes in your view · 17"));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("link", { name: "Class 8, Open session" })).toBeVisible();
    expect(screen.getByText("2 / 3")).toBeVisible();
    mounted.showSurface("route-warnings");
    expect(screen.queryByText("Classes in your view · 17")).toBeNull();
    mounted.showSurface("all");
    await userEvent.click(screen.getByText("Classes in your view · 17"));
    expect(screen.getByRole("link", { name: "Class 8, Open session" })).toBeVisible();
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Class 0, Open session" })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Campus layers"), "events");
    expect(screen.getByText("Events in your view · 0")).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Campus layers"), "classes");
    await userEvent.click(screen.getByText("Classes in your view · 17"));
    expect(screen.getByRole("link", { name: "Class 0, Open session" })).toBeVisible();
    expect(screen.getByText("1 / 3")).toBeVisible();
  });
  it("keeps routing warnings available without mounting the selected layer's record list", async () => {
    const mounted = mount("/more/virtual-campus?campus_layer=classes", undefined, "route-warnings");
    await screen.findByRole("button", { name: "Expected · Academic block" });
    expect(screen.getByText("Linked lift status is unavailable. Directions avoid lifts without current status.")).toBeVisible();
    expect(screen.queryByText("Classes in your view · 1")).toBeNull();
    expect(screen.queryByRole("link", { name: "Advanced Algorithms, Open session" })).toBeNull();
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    auth.memberships = []; mounted.rerender();
    expect(screen.getByText("Linked lift status is unavailable. Directions avoid lifts without current status.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Expected · Academic block" })).toBeNull();
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
  });
  it("retains layout recovery in the routing-only surface without stale layer records", async () => {
    const refresh = vi.fn();
    vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...response(), publication: { id: "scene", version: 2 } });
    mount("/more/virtual-campus?campus_layer=classes", refresh, "route-warnings");
    expect(await screen.findByRole("alert")).toHaveTextContent("The campus layout changed");
    await userEvent.click(screen.getByRole("button", { name: "Refresh campus layout" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Layout changed")).toHaveTextContent("true");
    expect(screen.queryByText("Classes in your view · 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Expected · Academic block" })).toBeNull();
  });
  it("exposes and closes its native evidence dialog while preserving the selected layer", async () => {
    mount("/more/virtual-campus?campus_layer=classes");
    const marker = await screen.findByRole("button", { name: "Expected · Academic block" });
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("false");
    marker.focus(); await userEvent.click(marker);
    expect(screen.getByRole("dialog")).toHaveTextContent("Advanced Algorithms");
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Close layer drilldown" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("false");
    expect(screen.getByLabelText("Campus layers")).toHaveValue("classes");
    await waitFor(() => expect(marker).toHaveFocus());
  });
  it("reports no open dialog when current evidence or membership is withdrawn", async () => {
    const mounted = mount("/more/virtual-campus?campus_layer=classes");
    await userEvent.click(await screen.findByRole("button", { name: "Expected · Academic block" }));
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("true");
    act(() => { mounted.client.setQueryData(key, { ...response(), activities: [] }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("false");
    act(() => { mounted.client.setQueryData(key, response()); });
    await userEvent.click(await screen.findByRole("button", { name: "Expected · Academic block" }));
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("true");
    auth.memberships = []; mounted.rerender();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByLabelText("Layer dialog state")).toHaveTextContent("false");
    expect(screen.getByTestId("published-layout")).toBeVisible();
  });
  it("shows upcoming classes in the evening without turning them into current people or presence", async () => {
    mount("/more/virtual-campus?campus_layer=classes");
    const marker = await screen.findByRole("button", { name: "Expected · Academic block" });
    expect(marker).not.toHaveAttribute("data-expected-count");
    await userEvent.click(marker);
    expect(screen.getByRole("dialog")).toHaveTextContent("Upcoming schedule");
    expect(screen.getByRole("dialog")).toHaveTextContent("Upcoming · Your next class · Scheduled place; not physical presence.");
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "/areas/timetable/session?session_id=class");
    expect(screen.queryByRole("button", { name: "Inspect linked place" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Open source" }));
    expect(screen.getByLabelText("Return route")).toHaveTextContent("/more/virtual-campus?campus_layer=classes");
  });
  it("keeps events without canonical places in their source list and never guesses a pin", async () => {
    mount("/more/virtual-campus?campus_layer=events");
    await screen.findByText("Events in your view · 1");
    expect(screen.queryByRole("button", { name: /Expected/ })).toBeNull();
    await userEvent.click(screen.getByText("Events in your view · 1"));
    expect(screen.getByRole("link", { name: "Robotics exhibition, Open event" })).toBeVisible();
    expect(screen.getByText(/Place not assigned/)).toBeVisible();
  });
  it("preserves native unavailability only for the exact published holding and offers the owning repair flow", async () => {
    const data = response(); data.assets = [asset({ native_state: "unavailable", repairs: [{ id: "own-repair", state: "reported", revision: 1, target_path: "/areas/facilities?repair_id=own-repair", action_label: "Open repair" }] }), asset({ element_id: "unknown-lamp", holding_id: "other", name: "Private unrelated lamp", native_state: "unavailable" })];
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data); mount();
    await waitFor(() => expect(screen.getByLabelText("Unlit fixtures")).toHaveTextContent(/^lamp$/));
    expect(screen.getByRole("region", { name: "Courtyard lamp status" })).toHaveTextContent("Resource availabilityUnavailable");
    expect(screen.getByRole("link", { name: "Report problem" })).toHaveAttribute("href", "/areas/facilities?report=1&holding_id=lamp-holding&space_id=building");
    expect(screen.getByRole("link", { name: /Open repair/ })).toHaveAttribute("href", "/areas/facilities?repair_id=own-repair");
    expect(screen.queryByText("Private unrelated lamp")).toBeNull();
  });
  it("keeps unknown and degraded status illustrative, and a checked repair does not override unavailable inventory", async () => {
    const mounted = mount(); await screen.findByRole("region", { name: "Courtyard lamp status" });
    expect(screen.getByLabelText("Unlit fixtures")).toBeEmptyDOMElement();
    for (const signal of [
      { state: "reported_fault" as const, impact: "not_working" as const, open_reports: 1, updated_at: response().as_of },
      { state: "awaiting_verification" as const, impact: "not_working" as const, open_reports: 1, updated_at: response().as_of },
    ]) { act(() => { mounted.client.setQueryData(key, { ...response(), assets: [asset({ signal })] }); }); await waitFor(() => expect(screen.getByLabelText("Unlit fixtures")).toHaveTextContent(/^lamp$/)); }
    act(() => { mounted.client.setQueryData(key, { ...response(), assets: [asset({ signal: { state: "reported_fault", impact: "degraded", open_reports: 1, updated_at: response().as_of } })] }); });
    await waitFor(() => expect(screen.getByLabelText("Unlit fixtures")).toBeEmptyDOMElement());
    act(() => { mounted.client.setQueryData(key, { ...response(), assets: [asset({ native_state: "unavailable", signal: { state: "verified_resolution", impact: "not_working", open_reports: 0, updated_at: response().as_of } })] }); });
    await waitFor(() => expect(screen.getByLabelText("Unlit fixtures")).toHaveTextContent(/^lamp$/));
  });
  it("blocks only an exact lift connector with a known unavailability basis", async () => {
    const data = response(); data.assets = [asset({ element_id: "lift", holding_id: "lift-holding", name: "Academic lift", native_state: "unavailable" })];
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data); mount();
    await waitFor(() => expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/));
    expect(screen.getByLabelText("Unlit fixtures")).toBeEmptyDOMElement();
  });
  it("excludes linked lifts while the initial status request is pending and restores explicit unknown status", async () => {
    let resolve!: (value: CampusOperationalProjection) => void;
    vi.mocked(getCampusOperationalLayers).mockReturnValue(new Promise(value => { resolve = value; }));
    mount();
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("loading");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByText(/Loading campus layers/)).toHaveTextContent("Linked lift status is unavailable");
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    expect(screen.getByLabelText("Layout changed")).toHaveTextContent("false");
    expect(screen.getByTestId("published-layout")).toBeVisible();
    const data = response(); data.assets.push(asset({ element_id: "lift", holding_id: "lift-holding", name: "Academic lift", native_state: "unknown" }));
    act(() => resolve(data));
    await waitFor(() => expect(screen.getByLabelText("Blocked connectors")).toBeEmptyDOMElement());
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("available");
    expect(screen.queryByText(/Linked lift status is unavailable/)).toBeNull();
    expect(screen.getByRole("region", { name: "Academic lift status" })).toHaveTextContent("Resource availabilityNot confirmed");
  });
  it("does not reopen a known faulty lift after a failed refresh and offers recovery", async () => {
    const data = response(); data.assets.push(asset({ element_id: "lift", holding_id: "lift-holding", name: "Academic lift", signal: { state: "reported_fault", impact: "not_working", open_reports: 1, updated_at: data.as_of } }));
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data);
    const mounted = mount("/more/virtual-campus?campus_layer=classes");
    await screen.findByRole("region", { name: "Academic lift status" });
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    vi.mocked(getCampusOperationalLayers).mockRejectedValue(new Error("Source unavailable"));
    await act(async () => { await mounted.client.refetchQueries({ queryKey: key }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Linked lift status is unavailable");
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    expect(screen.getByLabelText("Layout changed")).toHaveTextContent("false");
    expect(screen.getByTestId("published-layout")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Expected/ })).toBeNull();
    vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...data, assets: [asset({ element_id: "lift", holding_id: "lift-holding", name: "Academic lift" })] });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByLabelText("Blocked connectors")).toBeEmptyDOMElement());
    expect(screen.getByRole("button", { name: "Expected · Academic block" })).toBeVisible();
  });
  it("requires an exact asset response for linked lifts without excluding stairs or illustrative lifts", () => {
    const scene = publication.scene!.document, lift = scene.elements.find(element => element.id === "lift")!;
    const extended = { ...scene, elements: [...scene.elements,
      { ...lift, id: "illustrative-lift", holding_id: undefined },
      { ...lift, id: "stairs", holding_id: "stairs-holding", navigation_connector: { ...lift.navigation_connector!, kind: "stairs" as const, accessible: false } },
    ] };
    expect(campusBlockedLiftIds(extended, [])).toEqual(["lift"]);
    expect(campusBlockedLiftIds(extended, [asset({ element_id: "lift", holding_id: "wrong-holding" })])).toEqual(["lift"]);
    expect(campusBlockedLiftIds(extended, [asset({ element_id: "lift", holding_id: "lift-holding", native_state: "unknown" })])).toEqual([]);
  });
  it("retains the exact selected fixture and layer through the native report flow and rejects a changed world", async () => {
    const mounted = mount("/more/virtual-campus?campus_layer=maintenance&campus_space=building");
    await screen.findByRole("region", { name: "Courtyard lamp status" });
    await userEvent.click(screen.getByRole("button", { name: "Select lamp" }));
    expect(screen.getByLabelText("Selected asset")).toHaveTextContent(/^lamp$/);
    const origin = screen.getByLabelText("Current route").textContent;
    expect(origin).toContain("campus_asset=lamp"); expect(origin).not.toContain("campus_space=");
    await userEvent.click(screen.getByRole("link", { name: "Report problem" }));
    expect(screen.getByLabelText("Return route")).toHaveTextContent(origin);
    await userEvent.click(screen.getByRole("link", { name: "Return to campus" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent(origin);
    expect(screen.getByLabelText("Selected asset")).toHaveTextContent(/^lamp$/);
    expect(screen.getByLabelText("Campus layers")).toHaveValue("maintenance");
    vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...response(), environment: { kind: "simulation", namespace_id: "scenario:one" } });
    mounted.switchWorld({ mode: "simulation", runId: "one", namespaceId: "scenario:one", virtualClock: { now: response().as_of, timeZone: "UTC" } });
    expect(screen.getByLabelText("Selected asset")).toBeEmptyDOMElement();
  });
  it("opens a maintenance signal on its exact fixture rather than a generic building", async () => {
    const data = response(); data.assets = [asset({ signal: { state: "reported_fault", impact: "not_working", open_reports: 1, updated_at: data.as_of } })];
    vi.mocked(getCampusOperationalLayers).mockResolvedValue(data); mount("/more/virtual-campus?campus_layer=maintenance");
    await userEvent.click(await screen.findByRole("button", { name: "Reported not working · Courtyard lamp" }));
    expect(screen.getByLabelText("Selected asset")).toHaveTextContent(/^lamp$/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("requires a matching publication before showing asset status or routes and offers layout recovery", async () => {
    const refresh = vi.fn(); vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...response(), publication: { id: "scene", version: 2 } });
    mount("/more/virtual-campus?campus_layer=classes", refresh);
    expect(await screen.findByRole("alert")).toHaveTextContent("The campus layout changed");
    expect(screen.getByTestId("published-layout")).toBeVisible();
    expect(screen.getByLabelText("Layout changed")).toHaveTextContent("true");
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(screen.queryByRole("link", { name: "Report problem" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Expected/ })).toBeNull();
    expect(screen.getByLabelText("Unlit fixtures")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    await userEvent.click(screen.getByRole("button", { name: "Refresh campus layout" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("hides stale source evidence when a successful refresh removes access", async () => {
    const mounted = mount("/more/virtual-campus?campus_layer=classes");
    await userEvent.click(await screen.findByRole("button", { name: "Expected · Academic block" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Advanced Algorithms");
    act(() => { mounted.client.setQueryData(key, { ...response(), activities: [] }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Advanced Algorithms")).toBeNull();
  });
  it("retains the physical map and treats failed or mismatched source reads as unknown", async () => {
    vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...response(), campus_id: "another-campus" }); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Campus layers are unavailable");
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(screen.getByTestId("published-layout")).toBeVisible();
    expect(screen.getByLabelText("Unlit fixtures")).toBeEmptyDOMElement();
    expect(screen.queryByRole("link", { name: "Report problem" })).toBeNull();
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
  });
  it("partitions actors and worlds and never loads another active institution or an unavailable run", async () => {
    const mounted = mount(); await screen.findByRole("region", { name: "Courtyard lamp status" });
    const world: ExecutionEnvironment = { mode: "simulation", runId: "one", namespaceId: "scenario:one", virtualClock: { now: response().as_of, timeZone: "UTC" } };
    vi.mocked(getCampusOperationalLayers).mockResolvedValue({ ...response(), environment: { kind: "simulation", namespace_id: "scenario:one" } }); mounted.switchWorld(world);
    await waitFor(() => expect(getCampusOperationalLayers).toHaveBeenCalledTimes(2));
    expect(mounted.client.getQueryCache().getAll().map(query => query.queryKey)).toContainEqual(["execution-environment", "simulation", "scenario:one", "one", "campus-view", "operations", "school", "student", "campus", "scene", 1, response().as_of]);
    mounted.switchWorld({ mode: "simulation", runId: "one", namespaceId: "scenario:one", unavailable: true, unavailableReason: "runtime_unavailable" });
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(getCampusOperationalLayers).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    auth.user.active_school_id = "elsewhere"; mounted.switchWorld({ mode: "live" });
    expect(screen.getByLabelText("Linked assets state")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Linked assets")).toHaveTextContent(/^\[\]$/);
    expect(getCampusOperationalLayers).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Blocked connectors")).toHaveTextContent(/^lift$/);
    expect(screen.getByTestId("published-layout")).toBeVisible();
  });
});
