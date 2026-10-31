import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { getWorkspaceManifest } from "./api";
import { ResponsibilityWorkspace, WorkspaceExperience } from "./ResponsibilityWorkspace";
import type { WorkspaceManifest } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getWorkspaceManifest: vi.fn() };
});

const manifest: WorkspaceManifest = {
  revision: "workspace-17",
  generated_at: "2026-10-18T08:05:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    scope_label: "Main campus",
    date_label: "Sunday, 18 October",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: {
    now: [{
      id: "session-1",
      title: "Mathematics · Class 6A",
      detail: "Scheduled in Classroom 201",
      status_label: "Now",
      time_label: "9:00–9:45 AM",
      href: "/work/attendance/register-1",
      action_label: "Take attendance",
      source_label: "Published timetable",
      source_at: "8:05 AM",
      tone: "info",
    }],
    attention: { total: 2, overdue: 1, due_soon: 1 },
    next: [{
      id: "lab-1",
      title: "Prepare Computer Lab",
      time_label: "10:30 AM",
      source_label: "Lab assignment",
      tone: "neutral",
    }],
    completed_automatically: [],
  },
  work: {
    total: 2,
    items: [{
      id: "request-1",
      kind: "request",
      urgency: "due_soon",
      title: "Review a visitor request",
      detail: "Main Gate · arriving at 11:30 AM",
      action_label: "Review request",
      href: "/work/gate/requests/1",
      due_label: "Due in 20 min",
      source_label: "Gate operations",
      tone: "attention",
    }, {
      id: "task-1",
      kind: "task",
      urgency: "normal",
      title: "Complete Class 6A attendance",
      action_label: "Open register",
      href: "/work/attendance/register-1",
      source_label: "Attendance",
    }],
  },
  areas: [{
    key: "attendance",
    label: "Attendance",
    description: "Assigned registers and follow-up",
    href: "/areas/attendance",
    icon: "attendance",
    attention_count: 1,
    capabilities: ["attendance.view"],
    scopes: [{ kind: "class", id: "6a", label: "Class 6A" }],
    surfaces: [{
      key: "registers",
      label: "Registers",
      href: "/areas/attendance/registers",
      capabilities: ["attendance.view"],
      scopes: [{ kind: "class", id: "6a", label: "Class 6A" }],
    }],
  }],
  more: {
    setup: [{ key: "people", label: "People & access", description: "Responsibilities and access", href: "/setup/people", icon: "people" }],
    other: [],
  },
  freshness: { state: "current", as_of: "8:05 AM", source_revision: "source-4" },
};

function mount(environment: ExecutionEnvironment = { mode: "live", namespaceId: "live-cis" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExecutionEnvironmentProvider environment={environment}>
        <MemoryRouter><ResponsibilityWorkspace /></MemoryRouter>
      </ExecutionEnvironmentProvider>
    </QueryClientProvider>,
  );
}

describe("ResponsibilityWorkspace", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(getWorkspaceManifest).mockReset();
  });

  it("loads a source-backed Today view and uses only domain links supplied by the manifest", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount();

    expect(screen.getByLabelText("Loading your workspace")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText("Published timetable · 8:05 AM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mathematics · Class 6A, Take attendance/ })).toHaveAttribute(
      "href",
      "/work/attendance/register-1",
    );
    expect(screen.getByText("1 overdue", { exact: false })).toBeInTheDocument();
  });

  it("shows one Now heading rather than repeating a Now badge on the current activity", () => {
    render(<MemoryRouter><WorkspaceExperience manifest={manifest} /></MemoryRouter>);
    expect(screen.getAllByText("Now", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Now", level: 2 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Mathematics · Class 6A", level: 3 })).toBeVisible();
    expect(screen.getByText("9:00–9:45 AM")).toBeVisible();
    expect(screen.getByText("Scheduled in Classroom 201")).toBeVisible();
    const action = screen.getByRole("link", { name: "Mathematics · Class 6A, Take attendance" });
    expect(action).toHaveTextContent("Take attendance");
    expect(action).toHaveAttribute("href", "/work/attendance/register-1");
  });

  it("names a single real task on Today and opens its owning action directly", () => {
    const item = { ...manifest.work.items[0]!, title: "Aarav Sharma", detail: "Room 203", action_label: "Record move-in", href: "/areas/accommodation?stay_id=fictional-stay" };
    const source = { ...manifest, today: { ...manifest.today, attention: { total: 1, overdue: 0, due_soon: 0 } }, work: { total: 1, items: [item] } };
    render(<MemoryRouter><WorkspaceExperience manifest={source} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Request: Aarav Sharma, Record move-in" })).toHaveAttribute("href", item.href);
    expect(screen.getByText("Room 203")).toBeVisible();
    expect(screen.queryByText("1 item needs your attention")).not.toBeInTheDocument();
  });

  it("does not turn a Waiting row or partial queue into a single actionable Today card", () => {
    const source: WorkspaceManifest = { ...manifest, today: { ...manifest.today, attention: { total: 1, overdue: 0, due_soon: 0 } },
      work: { total: 1, items: [{ ...manifest.work.items[0]!, direction: "waiting", state: "waiting_for_review" }], coverage: "partial" } };
    render(<MemoryRouter><WorkspaceExperience manifest={source} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "1 work items need attention, view all work" })).toHaveAttribute("href", "/work");
    expect(screen.queryByRole("link", { name: "Review a visitor request, Review request" })).not.toBeInTheDocument();
  });

  it("keeps current schedule provenance available on demand without changing its owning action", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><WorkspaceExperience manifest={manifest} /></MemoryRouter>);
    const summary = screen.getByText("Schedule details");
    const details = summary.closest("details");
    const source = screen.getByText("Published timetable · 8:05 AM");
    expect(details).not.toHaveAttribute("open");
    expect(source).not.toBeVisible();
    const action = screen.getByRole("link", { name: "Mathematics · Class 6A, Take attendance" });
    expect(action).toHaveAttribute("href", "/work/attendance/register-1");
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(source).toBeVisible();
    expect(action).toHaveAttribute("href", "/work/attendance/register-1");
    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
    expect(source).toBeInTheDocument();
    expect(source).not.toBeVisible();
  });

  it("shows distinct calendar dates for same-weekday upcoming duties without changing their source order or links", () => {
    const upcoming = ["20", "27"].map((day, index) => ({ id: `duty-${day}`, title: "Overnight duty", status_label: "Next",
      time_label: `Tue, Oct ${day}, 2026, 10:00 PM`, detail: `Scheduled activity · ${index + 1} expected ${index === 0 ? "participant" : "participants"}`,
      href: `/areas/timetable/schedule?date=2026-10-${day}`, action_label: "Open timetable" }));
    render(<MemoryRouter><WorkspaceExperience manifest={{ ...manifest, today: { ...manifest.today, now: [], next: upcoming } }} /></MemoryRouter>);
    expect(screen.getByText("Tue, Oct 20, 2026, 10:00 PM")).toBeVisible();
    expect(screen.getByText("Tue, Oct 27, 2026, 10:00 PM")).toBeVisible();
    expect(screen.getByText("Scheduled activity · 1 expected participant")).toBeVisible();
    expect(screen.getByText("Scheduled activity · 2 expected participants")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Overnight duty, Open timetable" }).map(link => link.getAttribute("href")))
      .toEqual(["/areas/timetable/schedule?date=2026-10-20", "/areas/timetable/schedule?date=2026-10-27"]);
  });

  it("keeps Today, Work, Areas and More stable while the content changes", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><WorkspaceExperience manifest={manifest} /></MemoryRouter>);

    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    for (const name of ["Today", "Work", "Areas", "More"]) {
      expect(within(navigation).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: /Work/ }));
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Request: Review a visitor request/ })).toHaveAttribute("href", "/work/gate/requests/1");

    await user.click(screen.getByRole("button", { name: /Areas/ }));
    expect(screen.getByRole("heading", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Attendance" })).toHaveAttribute("href", "/areas/attendance");

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open People & access" })).toHaveAttribute("href", "/setup/people");
  });

  it("lets the shared app shell own the single page title without losing Today context", () => {
    render(<MemoryRouter><WorkspaceExperience manifest={manifest} showPageHeading={false} /></MemoryRouter>);

    expect(screen.queryByRole("heading", { name: "Today", level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("Sunday, 18 October")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all open work" })).toHaveAttribute("href", "/work");
  });

  it("shows clear empty states without inventing responsibilities", async () => {
    const user = userEvent.setup();
    const empty: WorkspaceManifest = {
      ...manifest,
      today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [], completed_automatically: [] },
      work: { total: 0, items: [] },
      areas: [],
      more: { setup: [], other: [] },
    };
    render(<MemoryRouter><WorkspaceExperience manifest={empty} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "No activities or actions to show" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByRole("heading", { name: "No open work" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Areas" }));
    expect(screen.getByRole("heading", { name: "No work areas are active" })).toBeInTheDocument();
  });

  it("filters More locally without removing any manifest-provided tool", async () => {
    const user = userEvent.setup();
    const searchable: WorkspaceManifest = {
      ...manifest,
      more: {
        ...manifest.more,
        other: [{ key: "appearance", label: "Appearance", description: "Light and dark theme", href: "/account/appearance", icon: "settings" }],
      },
    };
    render(<MemoryRouter><WorkspaceExperience manifest={searchable} initialView="more" /></MemoryRouter>);

    const search = screen.getByRole("searchbox", { name: "Search account, setup and tools" });
    expect(screen.getByRole("link", { name: "Open People & access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Appearance" })).toBeInTheDocument();

    await user.type(search, "appearance");
    expect(screen.queryByRole("link", { name: "Open People & access" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Appearance" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear tool search" }));
    expect(screen.getByRole("link", { name: "Open People & access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Appearance" })).toBeInTheDocument();
  });

  it("removes the manifest and explains when current access was revoked", async () => {
    vi.mocked(getWorkspaceManifest).mockRejectedValue(new ApiError("Responsibility ended", 403));
    mount();
    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh workspace" })).toBeInTheDocument();
  });

  it("does not show a Live manifest beneath a Simulation context", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount({
      mode: "simulation",
      namespaceId: "sim-cis",
      runId: "run-1",
      virtualClock: { now: "2026-10-18T09:00:00.000Z", timeZone: "Asia/Kolkata" },
    });
    expect(await screen.findByRole("heading", { name: "We couldn’t load your workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Mathematics · Class 6A")).not.toBeInTheDocument();
  });

  it("accepts a route-selected view without embedding a second navigation", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ExecutionEnvironmentProvider environment={{ mode: "live", namespaceId: "live-cis" }}>
          <MemoryRouter><ResponsibilityWorkspace activeView="areas" showNavigation={false} /></MemoryRouter>
        </ExecutionEnvironmentProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Areas" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
  });
});
