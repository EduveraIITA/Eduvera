import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEditorLinks } from "./ScenarioEditorLinks";
import type { WorkspaceManifest } from "../workspace/types";

const state = vi.hoisted(() => ({ query: { isPending: false, isError: false, data: null as WorkspaceManifest | null, refetch: vi.fn() } }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => state.query }));
vi.mock("./ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => ({ mode: "simulation", namespaceId: "sim-1" }) }));

function manifest(): WorkspaceManifest {
  return {
    revision: "1", generated_at: "2026-10-19T00:00:00Z",
    context: { institution_id: "school", environment: { kind: "simulation", namespace_id: "sim-1", virtual_now: "2026-10-19T00:00:00Z" } },
    today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] }, work: { total: 0, items: [] }, areas: [],
    more: { setup: ["people", "institution", "capabilities", "responsibilities"].map((key) => ({ key, label: key, href: `/more/setup/${key}` })) },
    freshness: { state: "current", as_of: "Now", source_revision: "1" },
  };
}
function show() { render(<MemoryRouter><ScenarioEditorLinks /></MemoryRouter>); }
beforeEach(() => { state.query = { isPending: false, isError: false, data: manifest(), refetch: vi.fn() }; });
afterEach(cleanup);

describe("scenario editor discovery", () => {
  it("uses authorized setup paths when a fresh administrator has no domain surfaces", () => {
    show();
    expect(screen.getByRole("link", { name: /People/ })).toHaveAttribute("href", "/more/setup/people");
    expect(screen.getByRole("link", { name: /^Timetable/ })).toHaveAttribute("href", "/more/setup/capabilities?task=timetable");
    expect(screen.getByRole("link", { name: /Staff availability/ })).toHaveAttribute("href", "/more/setup/responsibilities");
    expect(screen.getByText("Review timetable prerequisites and planning responsibility")).toBeVisible();
  });
  it("prefers an exact contributed domain editor", () => {
    state.query.data = { ...manifest(), areas: [{ key: "people", label: "People", href: "/areas/people", capabilities: ["sis.manage"], scopes: [], surfaces: [{ key: "records", label: "Records", href: "/areas/people/records", capabilities: ["sis.manage"], scopes: [] }] }] };
    show();expect(screen.getByRole("link", { name: /People/ })).toHaveAttribute("href", "/areas/people/records");
  });
  it("prefers shared people and groups without restricting the timetable to teaching",()=>{
    state.query.data={...manifest(),areas:[{key:"people",label:"People",href:"/areas/people",capabilities:["sis.manage"],scopes:[],surfaces:[
      {key:"records",label:"Records",href:"/areas/people/records",capabilities:["sis.manage"],scopes:[]},
      {key:"participants",label:"People & groups",href:"/areas/people/participants",capabilities:["sis.manage"],scopes:[]},
    ]},{key:"timetable",label:"Timetable",href:"/areas/timetable",capabilities:["schedule.manage"],scopes:[],surfaces:[
      {key:"planning",label:"Planning",href:"/areas/timetable/planning",capabilities:["schedule.manage"],scopes:[]},
    ]}]};
    show();
    expect(screen.getByRole("link",{name:/^People/})).toHaveAttribute("href","/areas/people/participants");
    expect(screen.getByText("Change activities, participants, times and places")).toBeVisible();
  });
  it("does not turn an Area directory into permission for an unlisted editor", () => {
    state.query.data = { ...manifest(), more: { setup: [] }, areas: [{ key: "people", label: "People", href: "/areas/people", capabilities: ["attendance.view"], scopes: [], surfaces: [{ key: "classes", label: "Classes", href: "/areas/people/classes", capabilities: ["attendance.view"], scopes: [] }] }] };
    show();expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByText("This editor requires an effective responsibility in the captured campus.")).toHaveLength(5);
  });
  it("never uses a Live catalogue beneath a Simulation theme", () => {
    state.query.data = { ...manifest(), context: { institution_id: "school", environment: { kind: "live" } } };
    show();expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t confirm your scenario editors");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("explains loading and failed permission discovery", () => {
    state.query.isPending = true;show();expect(screen.getByRole("status")).toBeVisible();cleanup();
    state.query.isPending = false;state.query.isError = true;show();expect(screen.getByRole("button", { name: "Refresh editors" })).toBeVisible();
  });
});
