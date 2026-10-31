import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { CampusSceneWorkspace, SceneCampus } from "../campus-scenes/api";
import type { CampusSceneDocument } from "../campus-scenes/types";
import WholeCampusSetupPage from "./WholeCampusSetupPage";

const auth = vi.hoisted(() => ({ user: { id: "owner", active_school_id: "school-1" }, memberships: [{ school_id: "school-1", school_name: "Lotus Institute", role: "admin" }], refresh: vi.fn() }));
vi.mock("../auth/AuthContext", async original => ({ ...await original<typeof import("../auth/AuthContext")>(), useAuth: () => auth }));
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../campus-scenes/CampusSceneCanvas", () => ({ CampusSceneCanvas: ({ onSelectElement }: { onSelectElement: (id: string) => void }) => <button onClick={() => onSelectElement("library-feature")}>Select library in saved layout</button> }));
vi.mock("../campus-scenes/useSceneLighting", () => ({ useSceneLighting: () => ({ lighting: "day", sunlight: {} }) }));

const campus: SceneCampus = { id: "campus-1", name: "Lotus Main Campus", code: "MAIN", is_primary: true, timezone: "Asia/Kolkata" };
const document: CampusSceneDocument = { schema_version: 1, name: "Lotus campus", bounds: { width: 100, height: 100, unit: "relative" }, source: { kind: "manual", label: "Our site plan" }, elements: [
  { id: "library-feature", kind: "building", label: "Library", asset_key: "library", space_id: "library", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }] } },
  { id: "gate-feature", kind: "fixture", label: "Main gate", asset_key: "gate", space_id: "gate", floor_id: null, review_state: "reviewed", geometry: { type: "point", points: [{ x: 20, y: 90 }] } },
  { id: "path-feature", kind: "path", label: "Library approach", space_id: null, floor_id: null, review_state: "reviewed", geometry: { type: "polyline", points: [{ x: 20, y: 90 }, { x: 20, y: 40 }] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: "gate", end_space_id: "library" } },
] };
function saved(draft: CampusSceneDocument | null = document, published = false): CampusSceneWorkspace { return { campus, spaces: [
  { id: "gate", campus_id: campus.id, name: "Main gate", code: "GATE", kind: "gate", parent_space_id: null },
  { id: "library", campus_id: campus.id, name: "Library", code: "LIB", kind: "building", parent_space_id: null },
], scene: { id: "scene-1", revision: 4, draft, published_version: published ? 2 : null, published: published ? { id: "scene-1", version: 2, published_at: "2026-10-26T08:00:00Z", document } : null, updated_at: "2026-10-26T08:00:00Z" } }; }
const noScene: CampusSceneWorkspace = { campus, spaces: [], scene: null };
const setup = { school_id: "school-1", working_now: [], useful_next: [
  { capability: "timetable", label: "Timetable & classes", status: "needs_setup", destination: "/areas/timetable/planning", setup_path: "/more/setup/capabilities?task=timetable", counts: {}, missing: [] },
  { capability: "gate", label: "Entry & exit", status: "needs_setup", destination: "/areas/in-out/operate", setup_path: "/more/setup/capabilities?task=gate", counts: {}, missing: [] },
  { capability: "facilities", label: "Repairs", status: "needs_setup", destination: "/areas/facilities", setup_path: "/more/setup/capabilities?task=facilities", counts: {}, missing: [], facilities_operation: { destination: "/areas/facilities?repair=own-exact-repair" } },
], available_anytime: [], options: { classes: [], staff: [], students: [], gates: [] } };
const simulation: ExecutionEnvironment = { mode: "simulation", institutionId: "school-1", namespaceId: "branch-1", runId: "run-1", worldRevision: 5, virtualClock: { now: "2026-10-26T08:00:00Z", timeZone: "Asia/Kolkata" } };
let sceneWorkspace: CampusSceneWorkspace;
let campuses: SceneCampus[];
function Location() { const location = useLocation(); return <output data-testid="guide-location">{location.pathname}{location.search}</output>; }
function mount(path = "/more/setup/whole-campus", environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (context: ExecutionEnvironment) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={context}><MemoryRouter initialEntries={[path]}><WholeCampusSetupPage /><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const rendered = render(view(environment));
  return { client, rerender: (context: ExecutionEnvironment) => rendered.rerender(view(context)) };
}
beforeEach(() => {
  vi.clearAllMocks(); sceneWorkspace = noScene; campuses = [campus]; auth.memberships[0]!.role = "admin";
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (options?.method && options.method !== "GET") return Promise.reject(new Error("The guide must not mutate on discovery."));
    if (path === "/api/v1/schools/school-1/campus-scenes/") return Promise.resolve({ campuses, can_edit: true });
    if (path === "/api/v1/schools/school-1/campus-scenes/campus-1/workspace/") return Promise.resolve(sceneWorkspace);
    if (path === "/api/v1/schools/school-1/get-started/") return Promise.resolve(setup);
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
});
afterEach(cleanup);

describe("whole-campus guidance", () => {
  it("starts from one native location without a compulsory academic, people or legal form", async () => {
    campuses = []; mount();
    expect(await screen.findByRole("heading", { name: "Give your campus a home." })).toBeVisible();
    expect(screen.getByRole("link", { name: "Add our first campus" })).toHaveAttribute("href", "/more/setup/institution/campus?setup=whole-campus&setup_step=find");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText(/Address, rooms and other details can wait/)).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  });

  it("resumes an empty saved location at layout and opens the same source editor", async () => {
    mount();
    const link = await screen.findByRole("link", { name: "Choose a layout source" });
    expect(link).toHaveAttribute("href", "/more/virtual-campus?campus_id=campus-1&edit=1&setup=whole-campus&setup_step=layout");
    expect(screen.getByRole("button", { name: "Our layout" })).toHaveAttribute("aria-current", "step");
    expect(screen.queryByText(/complete|100%/i)).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.includes("/onboarding/") || path.includes("/get-started/"))).toBe(false);
  });

  it("preserves campus and selected step in the URL and uses ordinary keyboard controls", async () => {
    const user = userEvent.setup(); mount("/more/setup/whole-campus?step=find&campus_id=campus-1");
    const continueButton = await screen.findByRole("button", { name: "Create our campus view" });
    continueButton.focus(); await user.keyboard("{Enter}");
    expect(screen.getByTestId("guide-location")).toHaveTextContent("/more/setup/whole-campus?step=layout&campus_id=campus-1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Finish later" })).toHaveAttribute("href", "/more/setup");
  });

  it("does not substitute a primary campus when an explicit campus is no longer available", async () => {
    mount("/more/setup/whole-campus?campus_id=old-campus&step=connect");
    expect(await screen.findByRole("heading", { name: "This campus is unavailable" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Connect a place/ })).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.includes("/workspace/"))).toHaveLength(0);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Campus" }), campus.id);
    expect(await screen.findByRole("heading", { name: "Start with Lotus Main Campus." })).toBeVisible();
  });

  it("rejects a saved-layout response for another campus before exposing its links", async () => {
    sceneWorkspace = { ...saved(), campus: { ...campus, id: "different-campus" } };
    mount("/more/setup/whole-campus?step=connect&campus_id=campus-1");
    expect(await screen.findByRole("heading", { name: "Your campus guide couldn’t load" })).toBeVisible();
    expect(screen.queryByText("2 places connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review campus places together" })).not.toBeInTheDocument();
  });

  it("opens a selected feature in the existing saved-draft editor without copying or publishing", async () => {
    sceneWorkspace = saved(); mount("/more/setup/whole-campus?step=layout&campus_id=campus-1");
    await userEvent.click(await screen.findByRole("button", { name: "Select library in saved layout" }));
    expect(screen.getByTestId("guide-location")).toHaveTextContent("/more/virtual-campus?campus_id=campus-1&edit=1&setup=whole-campus&setup_step=layout&setup_element=library-feature");
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method)).toBe(false);
  });

  it("keeps operational asset links optional and future records inside their native setup", async () => {
    sceneWorkspace = saved(); mount("/more/setup/whole-campus?step=connect");
    expect(await screen.findByText("2 places connected")).toBeVisible();
    expect(screen.getByText(/Decorative lights and other illustrations can stay unlinked/)).toBeVisible();
    await userEvent.click(screen.getByText("Add more detail when it’s useful", { selector: "summary" }));
    expect(screen.getByRole("link", { name: /Rooms, floors and equipment/ })).toHaveAttribute("href", "/more/setup/institution/campus?setup=whole-campus&setup_step=connect&campus_id=campus-1");
    expect(screen.getByRole("link", { name: /People and responsibilities/ })).toHaveAttribute("href", "/more/setup/people");
    expect(screen.getByRole("link", { name: /Courses and learning groups/ })).toHaveAttribute("href", "/more/setup/institution/academics");
    expect(screen.getByRole("button", { name: "Try what we have" })).toBeEnabled();
  });

  it("distinguishes a published view from a newer draft and hands publication to its owner", async () => {
    sceneWorkspace = saved({ ...document, elements: document.elements.map(item => ({ ...item, review_state: "needs_review" })) }, true);
    mount("/more/setup/whole-campus?step=share");
    expect(await screen.findByText("Campus view published · version 2")).toBeVisible();
    expect(screen.getByText(/A newer draft is waiting for review/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Review and publish in the editor" })).toHaveAttribute("href", "/more/virtual-campus?campus_id=campus-1&edit=1&setup=whole-campus&setup_step=share");
    expect(screen.getByRole("region", { name: "Before publishing this layout" })).toHaveTextContent("Review 3 items before publishing.");
    expect(screen.getByRole("link", { name: "Preview what members see" })).toHaveAttribute("href", "/more/virtual-campus?campus_id=campus-1&setup=whole-campus&setup_step=share");
    expect(await screen.findByRole("link", { name: /Repairs/ })).toHaveAttribute("href", "/areas/facilities?repair=own-exact-repair");
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method)).toBe(false);
  });

  it("uses the published campus as first value while offering only a few optional real operations", async () => {
    sceneWorkspace = saved(null, true); mount();
    expect(await screen.findByRole("link", { name: "Try our published campus" })).toBeVisible();
    const next = await screen.findByRole("region", { name: "Useful next steps" });
    expect(within(next).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByText(/publishing a view doesn’t activate every campus operation/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
  });

  it("keeps Try ahead of closed optional direction checks while preserving their review handoff", async () => {
    const withoutStepFree = { ...document, elements: document.elements.map(item => item.navigation ? { ...item, navigation: { ...item.navigation, accessible: false } } : item) };
    sceneWorkspace = saved(null, true);
    sceneWorkspace.scene!.published!.document = withoutStepFree;
    mount("/more/setup/whole-campus?step=share");
    const primary = await screen.findByRole("link", { name: "Try our published campus" });
    const summary = screen.getByText("Directions and optional details", { selector: "summary" });
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(primary.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("region", { name: "Useful checks" })).not.toBeVisible();
    await userEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("region", { name: "Useful checks" })).toHaveTextContent("no reviewed step-free route is declared");
    expect(screen.getByRole("link", { name: "Review Main gate → Library" })).toHaveAttribute("href", "/more/virtual-campus?campus_id=campus-1&edit=1&setup=whole-campus&setup_step=share&setup_element=library-feature");
  });

  it("uses selected-world source reads and never reads or saves Live onboarding preferences in Simulation", async () => {
    sceneWorkspace = saved(); const { client } = mount("/more/setup/whole-campus?step=share", simulation);
    expect(await screen.findByRole("link", { name: "Review and publish in the editor" })).toBeVisible();
    await screen.findByRole("region", { name: "Useful next steps" });
    const populated = client.getQueryCache().getAll().filter(query => query.state.data !== undefined);
    expect(populated.length).toBe(3);
    expect(populated.every(query => query.queryKey[0] === "execution-environment" && query.queryKey[1] === "simulation" && query.queryKey[2] === "branch-1" && query.queryKey[3] === "run-1")).toBe(true);
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.includes("/onboarding/"))).toBe(false);
  });

  it("discards another world’s saved-draft view while the newly selected world is loading", async () => {
    sceneWorkspace = saved(); const { rerender } = mount("/more/setup/whole-campus?step=connect");
    expect(await screen.findByText("2 places connected")).toBeVisible();
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => undefined));
    rerender(simulation);
    expect(await screen.findByText("Finding your saved campus and next useful step…")).toBeVisible();
    expect(screen.queryByText("2 places connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review campus places together" })).not.toBeInTheDocument();
  });

  it.each([
    ["unavailable Simulation", { mode: "simulation", unavailable: true, unavailableReason: "authorization_lost", institutionId: "school-1", namespaceId: "branch-1", runId: "run-1" }, "This Simulation is unavailable"],
    ["different institution", { ...simulation, institutionId: "other-school" }, "Your campus context has changed"],
  ] satisfies Array<[string, ExecutionEnvironment, string]>)("does not fall back to Live for an %s", (_, environment, title) => {
    mount(undefined, environment);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it("does not fetch admin scene workspaces for a person without setup responsibility", () => {
    auth.memberships[0]!.role = "staff"; mount();
    expect(screen.getByRole("heading", { name: "Campus setup isn’t assigned to you" })).toBeVisible();
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it("recovers from a refused directory read without disclosing stale setup links", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError("No longer authorized", 403)); mount();
    expect(await screen.findByRole("heading", { name: "Campus setup access has changed" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Campus building steps" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Choose a layout source" })).toBeVisible();
  });

  it("removes stale draft actions when a background source recheck reports revoked access", async () => {
    sceneWorkspace = saved(); const { client } = mount("/more/setup/whole-campus?step=connect");
    await screen.findByText("2 places connected");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Access changed", 403));
    await client.invalidateQueries({ queryKey: ["execution-environment", "live", "whole-campus-guide"] });
    expect(await screen.findByRole("heading", { name: "Campus setup access has changed" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Review campus places together" })).not.toBeInTheDocument();
  });

  it("keeps the map usable when optional operating suggestions fail and offers a bounded retry", async () => {
    sceneWorkspace = saved(null, true);
    vi.mocked(apiFetch).mockImplementation((path) => path.includes("get-started") ? Promise.reject(new Error("Unavailable")) : path.endsWith("/workspace/") ? Promise.resolve(sceneWorkspace) : Promise.resolve({ campuses, can_edit: true }));
    mount("/more/setup/whole-campus?step=share");
    expect(await screen.findByText("Available activities couldn’t load. Your saved campus view is unchanged.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Try our published campus" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});
