import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider, useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { WorkspaceManifest } from "../workspace/types";
import { WorkspaceInsightsRoute, type InsightsWorkspaceTopic } from "./InsightsWorkspaceRoutes";

const state = vi.hoisted(() => ({ manifest: undefined as WorkspaceManifest | undefined, error: null as Error | null, pending: false,
  analytics: vi.fn<(input: { audience: string; studentId: string | null; environment: string }) => void>() }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => ({ data: state.manifest, error: state.error, isPending: state.pending, refetch: vi.fn() }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, backTo, children }: { title: string; backTo: string; children: ReactNode }) => <><h1>{title}</h1><Link to={backTo}>Back</Link>{children}</> }));
vi.mock("./AnalyticsPage", () => ({ default: function AnalyticsPage({ portal }: { portal: string }) {
  const [search] = useSearchParams(), environment = useExecutionEnvironment();
  state.analytics({ audience: portal, studentId: search.get("student_id"), environment: environment.mode });
  return <div data-testid="insights-body">{portal} reporting content</div>;
} }));
vi.mock("../principal-insights/PrincipalInsightsPage", () => ({ PrincipalInsightsPage: () => <div>Institution review content</div> }));

const surfaces: WorkspaceManifest["areas"][number]["surfaces"] = [
  { key: "institution", label: "Institution insights", description: "Institution-wide attendance, learning, operations and finance", href: "/areas/insights?scope=institution", capabilities: ["insights.manage"], scopes: [{ kind: "institution", id: "school-1", label: "Test campus" }] },
  { key: "assigned", label: "My work insights", href: "/areas/insights?scope=assigned", capabilities: ["attendance.view"], scopes: [{ kind: "class", id: "class-1", label: "Class 6A" }] },
  { key: "overview:dependent:student-2", label: "Mira insights", href: "/areas/insights?scope=dependent&student_id=student-2", capabilities: ["insights.view"], scopes: [{ kind: "dependent", id: "student-2", label: "Mira" }] },
];
function manifest(available = surfaces): WorkspaceManifest {
  return {
    revision: "compact-insights", generated_at: "2026-10-20T12:00:00Z",
    context: { institution_id: "school-1", environment: { kind: "live", namespace_id: "live:school-1" } },
    today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] }, work: { total: 0, items: [] },
    areas: [{ key: "insights", label: "Insights", href: "/areas/insights", capabilities: ["insights.view"], scopes: [], surfaces: available }],
    more: { setup: [], groups: [] }, freshness: { state: "current", as_of: "Now", source_revision: "one" },
  };
}
const simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "simulation:run-1", runId: "run-1", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "Asia/Kolkata" } };
function Location() { const location = useLocation(); return <output data-testid="location" data-state={JSON.stringify(location.state)}>{location.pathname}{location.search}{location.hash}</output>; }
function show(path = "/areas/insights", topic?: InsightsWorkspaceTopic, environment: ExecutionEnvironment = { mode: "live" }) {
  const url = new URL(path, "https://thatcampus.invalid");
  return render(<ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[{ pathname: url.pathname, search: url.search, hash: url.hash, state: { from: "areas", page: 2 } }]}>
    <WorkspaceInsightsRoute topic={topic} /><Location />
  </MemoryRouter></ExecutionEnvironmentProvider>);
}
beforeEach(() => { state.manifest = manifest(); state.error = null; state.pending = false; state.analytics.mockReset(); });
afterEach(cleanup);

describe("compact Insights scope presentation", () => {
  it("starts with reporting content instead of a redundant card for a single institution view", () => {
    state.manifest = manifest([surfaces[0]!]);
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
    expect(screen.getByTestId("insights-body")).toHaveTextContent("principal reporting content");
    expect(screen.queryByRole("region", { name: "Insights scope" })).not.toBeInTheDocument();
    expect(screen.queryByText("Current view")).not.toBeInTheDocument();
    expect(screen.queryByText(/Institution-wide attendance/)).not.toBeInTheDocument();
  });

  it("offers only genuine authorized views and preserves reporting filters while switching", async () => {
    show("/areas/insights/attendance?scope=institution&period=90&date=2026-10-20&class=class-1&compare=class", "attendance");
    const scope = screen.getByRole("combobox", { name: "Choose insights scope" });
    expect(within(scope).getAllByRole("option").map(option => option.textContent)).toEqual(["Institution insights", "My work insights", "Mira insights"]);
    expect(screen.getByText("View", { exact: true })).toBeVisible();
    expect(screen.queryByText("Current view")).not.toBeInTheDocument();
    await userEvent.selectOptions(scope, "overview:dependent:student-2");
    const destination = new URL(screen.getByTestId("location").textContent, "https://thatcampus.invalid");
    expect(destination.pathname).toBe("/areas/insights/attendance");
    expect(Object.fromEntries(destination.searchParams)).toEqual({ scope: "dependent", student_id: "student-2", period: "90", class: "class-1", compare: "class", date: "2026-10-20" });
    expect(scope).toHaveValue("overview:dependent:student-2");
    expect(state.analytics).toHaveBeenLastCalledWith({ audience: "parent", studentId: "student-2", environment: "live" });
  });

  it("returns an institution-only topic to the safe overview when changing to assigned work", async () => {
    show("/areas/insights/review?scope=institution&date=2026-10-20&insight_days=28", "review");
    expect(screen.getByText("Institution review content")).toBeVisible();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Choose insights scope" }), "assigned");
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/insights?scope=assigned&date=2026-10-20&insight_days=28");
  });

  it("keeps a sole dependent identifiable and binds its exact resolved identity before rendering reports", () => {
    state.manifest = manifest([surfaces[2]!]);
    show("/areas/insights/results?period=30&date=2026-10-20#recorded", "results");
    expect(screen.getByText("Mira insights", { exact: true })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Choose insights scope" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/insights/results?period=30&date=2026-10-20&scope=dependent&student_id=student-2#recorded");
    expect(screen.getByTestId("location")).toHaveAttribute("data-state", JSON.stringify({ from: "areas", page: 2 }));
    expect(state.analytics).toHaveBeenCalled();
    expect(state.analytics.mock.calls.every(([call]) => call.studentId === "student-2" && call.audience === "parent")).toBe(true);
  });

  it("retains the selected relationship in the same Simulation workspace", () => {
    const live = manifest();
    state.manifest = { ...live, context: { ...live.context, environment: { kind: "simulation", namespace_id: "simulation:run-1", virtual_now: "2026-10-20T12:00:00Z" } } };
    show("/areas/insights?scope=dependent&student_id=student-2", undefined, simulation);
    expect(screen.getByRole("combobox", { name: "Choose insights scope" })).toHaveValue("overview:dependent:student-2");
    expect(state.analytics).toHaveBeenLastCalledWith({ audience: "parent", studentId: "student-2", environment: "simulation" });
  });

  it.each(["wrong world", "unavailable world", "revoked view"] as const)("does not expose report content or a scope switcher for a %s", reason => {
    if (reason === "revoked view") state.error = new ApiError("Access ended", 403);
    const environment: ExecutionEnvironment = reason === "unavailable world"
      ? { mode: "simulation", unavailable: true, unavailableReason: "authorization_lost", namespaceId: "simulation:run-1", runId: "run-1" }
      : reason === "wrong world" ? simulation : { mode: "live" };
    show("/areas/insights", undefined, environment);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("insights-body")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Choose insights scope" })).not.toBeInTheDocument();
    expect(state.analytics).not.toHaveBeenCalled();
  });
});
