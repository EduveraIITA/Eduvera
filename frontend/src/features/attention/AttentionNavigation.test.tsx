import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { ResponsibilityWorkspace, WorkspaceExperience } from "../workspace/ResponsibilityWorkspace";
import { getWorkspaceManifest } from "../workspace/api";
import type { WorkspaceManifest } from "../workspace/types";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ApiError } from "../../lib/api";

const state = vi.hoisted<{bellUnread:number;studentLookupError:boolean;emptyStudents:boolean;schoolName:string|null}>(() => ({ bellUnread: 0, studentLookupError: false, emptyStudents: false, schoolName: "Test campus" }));
vi.mock("../workspace/api", () => ({ getWorkspaceManifest: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({
  status: "authenticated", user: { id: "user-1", active_school_id: "school-1" },
  memberships: [{ role: "guardian", school_id: "school-1", school_name: state.schoolName }],
}) }));
vi.mock("../auth/useProFeatures", () => ({ useProFeatures: () => ({ enabled: false }) }));
vi.mock("../auth/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("../notifications/NotificationCenter", () => ({ NotificationCenter: () => <button type="button" aria-label={state.bellUnread ? `Notifications, ${state.bellUnread} unread` : "Notifications"} /> }));
vi.mock("../school/api", () => ({ getAccessibleStudents: () => state.studentLookupError ? Promise.reject(new Error("offline")) : Promise.resolve({ results: state.emptyStudents ? [] : [{ id: "child-2", user: { display_name: "Learner Two" }, current_enrollment: { grade: "7", section: "A" } }] }) }));

function manifest(): WorkspaceManifest {
  return {
    revision: "1", generated_at: "2026-10-19T08:00:00Z",
    context: { institution_id: "school-1", environment: { kind: "live" } },
    today: { now: [], attention: { total: 1, overdue: 0, due_soon: 1 }, next: [] },
    work: { total: 3, counts: { needs_me: 1, waiting: 2 }, coverage: "complete", items: [
      { id: "register", title: "Class 7A register", kind: "task", urgency: "due_soon", direction: "needs_me", href: "/areas/attendance/registers?class_section_id=7a&date=2026-10-19", action_label: "Open register" },
      { id: "leave-1", title: "Personal leave", kind: "request", urgency: "normal", direction: "waiting", state: "waiting_for_review", status_label: "Waiting for review", href: "/areas/responsibilities/leave?request=leave-1", action_label: "View request" },
      { id: "leave-2", title: "Medical leave", kind: "request", urgency: "normal", direction: "waiting", state: "waiting_for_review", status_label: "Waiting for review", href: "/areas/responsibilities/leave?request=leave-2", action_label: "View request" },
    ] },
    areas: [{ key: "attendance", label: "Attendance", href: "/areas/attendance", attention_count: 3, capabilities: ["attendance.view"], scopes: [], surfaces: [] }],
    more: { setup: [] }, freshness: { state: "current", as_of: "8:00 AM", source_revision: "1" },
  };
}
function show(content: React.ReactNode, path = "/today") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{mode:"live",namespaceId:"live-school-1"}}><MemoryRouter initialEntries={[path]}>{content}</MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); state.bellUnread = 0; state.studentLookupError = false; state.emptyStudents = false; state.schoolName = "Test campus"; });
afterEach(cleanup);

describe("responsibility-composed attention navigation", () => {
  it("keeps Today, Work, Areas and More stable while owned work and Area attention remain distinct", () => {
    show(<WorkspaceExperience manifest={manifest()} />);
    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(navigation).getAllByRole("button").map((item) => item.textContent)).toEqual(["Today", "1Work", "3Areas", "More"]);
    expect(within(navigation).getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1 work items need attention, view all work" })).toHaveAttribute("href", "/work");
    expect(screen.getByText("1 due soon")).toBeVisible();
  });
  it("opens the exact owned domain action without replacing an Area entry with an attention target", async () => {
    show(<WorkspaceExperience manifest={manifest()} />);const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Work/ }));
    expect(screen.getByRole("link", { name: "Task: Class 7A register, Open register" })).toHaveAttribute("href", "/areas/attendance/registers?class_section_id=7a&date=2026-10-19");
    await user.click(screen.getByRole("button", { name: /Areas/ }));
    expect(screen.getByRole("link", { name: /Open Attendance/ })).toHaveAttribute("href", "/areas/attendance");
  });
  it("aggregates Area attention separately from Work and caps only its visible badge", () => {
    const data = manifest();show(<WorkspaceExperience manifest={{ ...data, work: { total: 1, counts: { needs_me: 1, waiting: 0 }, coverage: "complete", items: data.work.items.filter(item => item.direction === "needs_me") }, areas: [...data.areas, { ...data.areas[0]!, key: "timetable", label: "Timetable", href: "/areas/timetable", attention_count: 100 }] }} />);
    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(navigation).getByRole("button", { name: /103 items need attention.*Areas/ })).toHaveTextContent("99+");
    expect(within(navigation).getByRole("button", { name: /1 items need attention.*Work/ })).toHaveTextContent("1");
  });
  it("keeps waiting requests discoverable without counting them as Work or Today attention", async () => {
    const data = manifest();
    show(<WorkspaceExperience manifest={{ ...data, today: { ...data.today, attention: { total: 0, overdue: 0, due_soon: 0 } }, work: { total: 2, counts: { needs_me: 0, waiting: 2 }, coverage: "complete", items: data.work.items.filter(item => item.direction === "waiting") } }} />);
    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    const workButton = within(navigation).getByRole("button", { name: "Work", exact: true });
    expect(workButton).not.toHaveTextContent("2");
    expect(within(navigation).getByRole("button", { name: /3 items need attention.*Areas/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /work items? needs? attention/ })).not.toBeInTheDocument();
    await userEvent.click(workButton);
    await userEvent.click(screen.getByRole("button", { name: "Waiting 2", exact: true }));
    expect(screen.getByRole("link", { name: /Personal leave/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Medical leave/ })).toBeVisible();
  });
  it("keeps both operations navigation surfaces canonical and separates unread notifications", () => {
    state.bellUnread = 9;const view = show(<OperationsShell active="home" title="Today"><span>Content</span></OperationsShell>);
    for (const navigation of screen.getAllByRole("navigation", { name: "Workspace" })) {
      expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/today", "/work", "/areas", "/more"]);
      expect(within(navigation).getByRole("link", { name: "More" })).not.toHaveTextContent("9");
    }
    expect(screen.getByRole("button", { name: "Notifications, 9 unread" })).toBeVisible();
    expect(view.container.querySelector(".attention-indicator--nav")).not.toBeInTheDocument();
  });
  it("preserves the selected learner inside the domain while shared navigation remains canonical", async () => {
    show(<ParentShell active="attendance" pageLabel="Attendance" selectedChildId="child-2"><a href="/areas/attendance/leave?scope=dependent&student_id=child-2">Learner leave</a></ParentShell>, "/areas/attendance/leave?scope=dependent&student_id=child-2");
    expect(screen.getByRole("link", { name: "More" })).toHaveAttribute("href", "/more");
    expect(screen.getByRole("link", { name: "Learner leave" })).toHaveAttribute("href", "/areas/attendance/leave?scope=dependent&student_id=child-2");
    expect(await screen.findByText("Learner Two · Class 7A")).toBeVisible();
  });
  it.each(["offline", "access revoked"])("does not call failed workspace attention an all-clear state: %s", async (message) => {
    vi.mocked(getWorkspaceManifest).mockRejectedValue(message === "access revoked" ? new ApiError(message,403) : new Error(message));show(<ResponsibilityWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message === "access revoked" ? "Your workspace access changed" : "We couldn’t load your workspace");
    expect(screen.queryByText("Nothing needs you right now")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh workspace" })).toBeEnabled();
  });
  it.each(["failed", "empty"])("does not substitute a demo learner for an unavailable relationship: %s", async (kind) => {
    state.studentLookupError = kind === "failed";state.emptyStudents = kind === "empty";
    show(<ParentShell active="attendance" pageLabel="Attendance"><span>Content</span></ParentShell>, "/areas/attendance/leave");
    expect(await screen.findByText("Student information unavailable")).toBeVisible();
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();
  });
  it("uses neutral school context when an authenticated guardian has no school name", () => {
    state.schoolName = null;show(<ParentShell active="home" pageLabel="Today" selectedChildId="child-2"><span>Content</span></ParentShell>);
    expect(screen.getByLabelText("School information unavailable")).toBeVisible();
    expect(screen.queryByText("Test campus")).not.toBeInTheDocument();
  });
});
