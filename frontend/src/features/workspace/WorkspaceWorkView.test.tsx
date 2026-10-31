import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ResponsibilityWorkspace, WorkspaceNavigation } from "./ResponsibilityWorkspace";
import { WorkspaceWorkView } from "./WorkspaceWorkView";
import { getWorkspaceManifest } from "./api";
import type { WorkspaceManifest, WorkspaceWorkItem } from "./types";

const auth = vi.hoisted(() => ({ user: { id: "actor-a", active_school_id: "campus" }, memberships: [{ school_id: "campus" }] }));
vi.mock("../auth/AuthContext", async original => ({ ...await original<typeof import("../auth/AuthContext")>(), useOptionalAuth: () => auth }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getWorkspaceManifest: vi.fn() }));
const entry = (index: number): WorkspaceWorkItem => ({ id: `item-${index}`, kind: "task", urgency: "normal", title: `Task ${index}`,
  href: `/areas/responsibilities/mine?assignment=${index}`, action_label: "Open task", created_at: index === 101 ? "2026-10-21T12:00:00Z" : "2026-10-20T12:00:00Z" });
const waiting: WorkspaceWorkItem = { id: "leave", kind: "request", urgency: "normal", title: "Personal leave", href: "/areas/responsibilities/leave?request=leave&request_revision=1",
  action_label: "View request", direction: "waiting", state: "needs_reassignment", owner: { user_id: "old-reviewer", label: "Neha Reviewer" }, status_label: "Review route changed — needs reassignment", created_at: "2026-10-21T09:00:00Z" };
function manifest(items: WorkspaceWorkItem[]): WorkspaceManifest {
  return { revision: "current", generated_at: "2026-10-21T12:00:00Z", context: { actor_user_id: auth.user.id, institution_id: auth.user.active_school_id, time_zone: "UTC", environment: { kind: "live" } },
    today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] }, work: { total: items.length, counts: { needs_me: items.filter(item => item.direction !== "waiting").length,
      waiting: items.filter(item => item.direction === "waiting").length }, coverage: "complete", items }, areas: [], more: { setup: [] }, freshness: { state: "current", as_of: "12:00", source_revision: "current" } };
}
function Location() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Current URL">{location.pathname}{location.search}</output><output aria-label="Return context">{JSON.stringify(location.state)}</output><button onClick={() => navigate(-1)}>Browser back</button></>; }
function show(value: WorkspaceManifest, url = "/work") { return render(<MemoryRouter initialEntries={[url]}><WorkspaceWorkView manifest={value} /><Location /></MemoryRouter>); }
afterEach(() => { cleanup(); vi.resetAllMocks(); auth.user.id = "actor-a"; auth.user.active_school_id = "campus"; });

describe("finite source-backed Work", () => {
  it("makes full-result search available without opening a filter or forcing the mobile keyboard", async () => {
    show(manifest(Array.from({ length: 101 }, (_, index) => entry(index + 1))));
    const search = screen.getByRole("searchbox", { name: "Search all work needing me" });
    expect(search).toBeVisible();
    expect(search).not.toHaveFocus();
    await userEvent.type(search, "Task 101");
    expect(screen.getAllByRole("link")).toHaveLength(10);
    expect(screen.queryByRole("link", { name: /Task 101,/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search work" }));
    expect(screen.getByRole("list", { name: "Open work items" })).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Task 101,/ })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear work search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("link")).toHaveLength(10);
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("work_search=");
  });
  it("pages all 101 obligations, without showing a hundred-message head as the total", async () => {
    show(manifest(Array.from({ length: 101 }, (_, index) => entry(index + 1))));
    expect(screen.getAllByRole("link")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Needs me 101" })).toBeVisible();
    expect(screen.getByText("Page 1 of 11")).toBeVisible();
    for (let page = 1; page < 11; page += 1) await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(screen.getByRole("link", { name: /Task 101,/ })).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("work_page=11");
  });
  it("searches before pagination and preserves view, search and source return context", async () => {
    show(manifest([...Array.from({ length: 101 }, (_, index) => entry(index + 1)), waiting]), "/work?work_page=2&work_date=2026-10-21");
    await userEvent.click(screen.getByRole("button", { name: "Search work" }));
    await userEvent.type(screen.getByRole("searchbox"), "Task 101");
    await userEvent.click(screen.getByRole("button", { name: "Search work" }));
    const task = screen.getByRole("link", { name: /Task 101,/ });
    expect(screen.queryByText("Page 2 of 11")).not.toBeInTheDocument();
    await userEvent.click(task);
    expect(screen.getByLabelText("Return context")).toHaveTextContent("/work?work_date=2026-10-21&work_search=Task+101");
    await userEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Task 101");
    expect(screen.getByRole("link", { name: /Task 101,/ })).toBeVisible();
  });
  it("separates waiting and changed-route state without adding waiting to an attention badge", async () => {
    const value = manifest([entry(1), waiting]);
    render(<MemoryRouter initialEntries={["/work?work_view=waiting"]}><WorkspaceWorkView manifest={value} /><WorkspaceNavigation manifest={value} active="work" onChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText("Review route changed — needs reassignment")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Task 1,/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 items need attention")).toBeVisible();
    expect(screen.queryByLabelText("2 items need attention")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Needs me 1" }));
    expect(screen.getByRole("link", { name: /Task 1,/ })).toBeVisible();
  });
  it("has explicit unavailable-source recovery and retains the list filters", async () => {
    show(manifest([waiting]), "/work?work_view=waiting&work_search=Personal&item=leave&unavailable=route");
    expect(screen.getByRole("status", { name: "Work item recovery" })).toHaveTextContent("No decision has been recorded");
    await userEvent.click(screen.getByRole("button", { name: "Return to work" }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("work_view=waiting&work_search=Personal");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("item=");
  });
  it("does not echo a foreign or closed selected item's contents", () => {
    show(manifest([]), "/work?item=foreign-source&unavailable=route");
    expect(screen.getByRole("status", { name: "Work item recovery" })).toHaveTextContent("no longer in your current queue");
    expect(screen.queryByText("foreign-source")).not.toBeInTheDocument();
  });
  it("clears search and added-date filters while keeping Waiting and unrelated URL state", async () => {
    show(manifest([entry(1), waiting]), "/work?work_view=waiting&work_search=unfindable&work_date=2026-10-21&work_page=4&scope=kept");
    expect(screen.getByRole("heading", { name: "No matching work" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("/work?work_view=waiting&scope=kept");
    expect(screen.getByRole("searchbox", { name: "Search all waiting work" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Waiting 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /Personal leave,/ })).toBeVisible();
    expect(screen.getByText("Sent to Neha Reviewer")).toBeVisible();
    expect(screen.queryByLabelText("Added on")).not.toBeInTheDocument();
  });
  it("filters by the campus-local date added, rather than its deadline", async () => {
    const value = manifest([
      { ...entry(1), created_at: "2026-10-20T23:30:00Z", due_at: "2026-10-25T09:00:00Z" },
      { ...entry(2), created_at: "2026-10-20T12:00:00Z", due_at: "2026-10-21T09:00:00Z" },
    ]);
    show({ ...value, context: { ...value.context, time_zone: "Asia/Kolkata" } }, "/work?work_date=2026-10-21");
    expect(screen.getByLabelText("Added on")).toHaveValue("2026-10-21");
    expect(screen.getByRole("link", { name: /Task 1,/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Task 2,/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("work_date=");
  });
  it("keeps source ordering and an incomplete empty queue distinct from an all-clear state", () => {
    const value = manifest([entry(8), { ...entry(3), urgency: "critical" }, entry(2)]);
    const view = show(value);
    expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual([
      expect.stringContaining("Task 8"), expect.stringContaining("Task 3"), expect.stringContaining("Task 2"),
    ]);
    view.unmount();
    const empty = manifest([]);
    show({ ...empty, work: { ...empty.work, coverage: "partial" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Some work could not be included");
    expect(screen.getByRole("heading", { name: "No work could be shown" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "No open work" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing needs you right now")).not.toBeInTheDocument();
  });
  it("keeps actor and selected campus caches independent before the next request resolves", async () => {
    let complete!: (value: WorkspaceManifest) => void;
    vi.mocked(getWorkspaceManifest).mockResolvedValueOnce(manifest([entry(1)])).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter><ResponsibilityWorkspace activeView="work" /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
    const view = render(tree());
    expect(await screen.findByRole("link", { name: /Task 1,/ })).toBeVisible();
    auth.user.id = "actor-b"; auth.user.active_school_id = "second-campus";
    view.rerender(tree());
    await waitFor(() => expect(getWorkspaceManifest).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: /Task 1,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Loading your workspace" })).toBeVisible();
    await act(async () => { complete(manifest([])); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "No open work" })).toBeVisible();
    expect(client.getQueryCache().getAll().map(query => query.queryKey)).toEqual(expect.arrayContaining([
      expect.arrayContaining(["actor-a", "campus"]), expect.arrayContaining(["actor-b", "second-campus"]),
    ]));
  });
});
