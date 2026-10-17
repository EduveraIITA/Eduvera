import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import type { AttentionResponse } from "./api";

const state = vi.hoisted<{
  data: AttentionResponse | undefined;
  bellUnread: number;
  attentionError: boolean;
  studentLookupError: boolean;
  emptyStudents: boolean;
  guardianSchoolName: string | null;
  useAttention: ReturnType<typeof vi.fn>;
}>(() => ({ data: undefined, bellUnread: 0, attentionError: false, studentLookupError: false, emptyStudents: false, guardianSchoolName: "Cambridge International School", useAttention: vi.fn() }));

vi.mock("./useAttention", () => ({
  useAttention: (...arguments_: unknown[]) => {
    state.useAttention(...arguments_);
    return { data: state.data, isError: state.attentionError };
  },
}));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({
    status: "authenticated",
    user: { id: "user-1", active_school_id: "school-1" },
    memberships: [
      { role: "guardian", school_id: "school-1", school_name: state.guardianSchoolName },
      { role: "admin", school_id: "school-1", school_name: "Cambridge International School" },
      { role: "staff", school_id: "school-1", school_name: "Cambridge International School", permissions: ["attendance.view", "timetable.view", "messages.view", "safeguarding.review"] },
    ],
  }),
}));
vi.mock("../auth/useProFeatures", () => ({ useProFeatures: () => ({ enabled: false }) }));
vi.mock("../auth/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("../notifications/NotificationCenter", () => ({
  NotificationCenter: () => <button type="button" aria-label={state.bellUnread ? `Notifications, ${state.bellUnread} unread` : "Notifications"} />,
}));
vi.mock("../school/api", () => ({
  getAccessibleStudents: () => state.studentLookupError ? Promise.reject(new Error("offline")) : Promise.resolve({
    results: state.emptyStudents ? [] : [{ id: "child-2", user: { display_name: "Ananya Sharma" }, current_enrollment: { grade: "7", section: "A" } }],
  }),
}));

function renderWithProviders(content: React.ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{content}</MemoryRouter></QueryClientProvider>);
}

function response(summary: AttentionResponse["summary"]): AttentionResponse {
  return { portal: "parent", generated_at: "2026-10-13T08:00:00.000Z", summary, modules: {}, items: [] };
}

beforeEach(() => {
  state.data = undefined;
  state.bellUnread = 0;
  state.attentionError = false;
  state.studentLookupError = false;
  state.emptyStudents = false;
  state.guardianSchoolName = "Cambridge International School";
  state.useAttention.mockReset();
});
afterEach(cleanup);

describe("attention navigation", () => {
  it("scopes the parent More path to the selected child", () => {
    state.data = response({ total: 2, new: 2, action_required: 0, exceptions: 0, urgent: 0 });
    renderWithProviders(
      <ParentShell active="attendance" pageLabel="Attendance" selectedChildId="child-2"><span>Content</span></ParentShell>,
      "/parent/attendance?student_id=child-2",
    );

    expect(state.useAttention).toHaveBeenCalledWith("parent", "child-2");
    const more = screen.getByRole("link", { name: "More, 2 new items" });
    expect(more).toHaveAttribute("href", "/parent/more?student_id=child-2");
    expect(more.querySelector(".attention-indicator--nav")).toBeInTheDocument();
  });

  it("shows the descendant More dot in principal desktop and mobile navigation", () => {
    state.data = { ...response({ total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 }), portal: "principal" };
    const view = renderWithProviders(
      <OperationsShell portal="principal" active="home" title="Overview"><span>Content</span></OperationsShell>,
      "/principal",
    );

    const moreLinks = view.container.querySelectorAll('a[aria-label="More, 1 action required"]');
    expect(moreLinks).toHaveLength(2);
    expect(view.container.querySelectorAll(".attention-indicator--nav")).toHaveLength(2);
  });

  it("does not turn a global notification count into More attention", () => {
    state.bellUnread = 9;
    state.data = { ...response({ total: 0, new: 0, action_required: 0, exceptions: 0, urgent: 0 }), portal: "principal" };
    const view = renderWithProviders(
      <OperationsShell portal="principal" active="home" title="Overview"><span>Content</span></OperationsShell>,
      "/principal",
    );

    expect(screen.getByRole("button", { name: "Notifications, 9 unread" })).toBeInTheDocument();
    expect(view.container.querySelectorAll('a[aria-label="More"]')).toHaveLength(2);
    expect(view.container.querySelector(".attention-indicator--nav")).not.toBeInTheDocument();
  });

  it("marks the owning parent tab as well as the aggregate More destination", () => {
    state.data = {
      ...response({ total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 }),
      modules: {
        attendance: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/parent/attendance?student_id=child-2", first_item_href: "/parent/home?student_id=child-2&followup=f-1" },
      },
    };
    renderWithProviders(
      <ParentShell active="home" pageLabel="Home" selectedChildId="child-2"><span>Content</span></ParentShell>,
      "/parent/home?student_id=child-2",
    );

    expect(screen.getByRole("link", { name: "Attendance, 1 action required" })).toHaveAttribute("href", "/parent/attendance?student_id=child-2");
    expect(screen.getByRole("link", { name: "More, 1 action required" })).toBeInTheDocument();
  });

  it("combines teacher register and follow-up attention on the Attendance destination", () => {
    state.data = {
      ...response({ total: 3, new: 0, action_required: 3, exceptions: 0, urgent: 0 }),
      portal: "teacher",
      modules: {
        registers: { total: 2, new: 0, action_required: 2, exceptions: 0, urgent: 0, href: "/teacher/attendance", first_item_href: "/teacher/attendance?class_section_id=7a" },
        attendance: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/teacher/attendance", first_item_href: "/teacher?followup=f-1" },
      },
    };
    const view = renderWithProviders(
      <OperationsShell portal="teacher" active="home" title="Today"><span>Content</span></OperationsShell>,
      "/teacher",
    );

    expect(view.container.querySelectorAll('a[aria-label="Attendance, 3 actions required"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('a[aria-label="Attendance, 3 actions required"]')[0]).toHaveAttribute("href", "/teacher/attendance");
  });

  it("combines schedule and calendar attention on the Timetable destination", () => {
    state.data = {
      ...response({ total: 3, new: 1, action_required: 2, exceptions: 0, urgent: 0 }),
      portal: "principal",
      modules: {
        weekly: { total: 2, new: 0, action_required: 2, exceptions: 0, urgent: 0, href: "/principal/timetable", first_item_href: "/principal/timetable/day?plan=plan-1" },
        calendar: { total: 1, new: 1, action_required: 0, exceptions: 0, urgent: 0, href: "/principal/calendar", first_item_href: "/principal/calendar?date=2026-10-15" },
      },
    };
    const view = renderWithProviders(
      <OperationsShell portal="principal" active="home" title="Overview"><span>Content</span></OperationsShell>,
      "/principal",
    );

    expect(view.container.querySelectorAll('a[aria-label="Timetable, 2 actions required"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('a[aria-label="Timetable, 2 actions required"]')[0]).toHaveAttribute("href", "/principal/timetable");
  });

  it("keeps an operations tab stable when one exact attention target exists", () => {
    state.data = {
      ...response({ total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 }),
      portal: "principal",
      modules: {
        attendance: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/principal/attendance", first_item_href: "/principal/followups?followup=f-9" },
      },
    };
    const view = renderWithProviders(
      <OperationsShell portal="principal" active="home" title="Overview"><span>Content</span></OperationsShell>,
      "/principal",
    );

    const links = view.container.querySelectorAll('a[aria-label="Attendance, 1 action required"]');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/principal/attendance");
    expect(links[1]).toHaveAttribute("href", "/principal/attendance");
  });

  it("does not present a failed attention read as an all-clear state", () => {
    state.attentionError = true;
    const view = renderWithProviders(
      <OperationsShell portal="principal" active="home" title="Overview"><span>Content</span></OperationsShell>,
      "/principal",
    );

    expect(view.container.querySelectorAll('a[aria-label="More, attention status unavailable"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('a[aria-label="Attendance, attention status unavailable"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('a[aria-label="Timetable, attention status unavailable"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('a[aria-label="Messages, attention status unavailable"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('a[aria-label="Student concerns, attention status unavailable"]')).toHaveLength(1);
    expect(view.container.querySelectorAll(".attention-indicator--unavailable")).toHaveLength(7);
  });

  it("does not present failed parent module reads as clear", () => {
    state.attentionError = true;
    const view = renderWithProviders(
      <ParentShell active="home" pageLabel="Home" selectedChildId="child-2"><span>Content</span></ParentShell>,
      "/parent/home?student_id=child-2",
    );

    expect(screen.getByRole("link", { name: "Attendance, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diary, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "More, attention status unavailable" })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".attention-indicator--unavailable")).toHaveLength(3);
  });

  it("does not present a failed parent child-scope lookup as clear", async () => {
    state.studentLookupError = true;
    const view = renderWithProviders(
      <ParentShell active="home" pageLabel="Home"><span>Content</span></ParentShell>,
      "/parent/home",
    );

    expect(await screen.findByRole("link", { name: "Attendance, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diary, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "More, attention status unavailable" })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".attention-indicator--unavailable")).toHaveLength(3);
  });

  it("does not present an authenticated guardian with no linked learner as clear", async () => {
    state.emptyStudents = true;
    const view = renderWithProviders(
      <ParentShell active="attendance" pageLabel="Attendance"><span>Content</span></ParentShell>,
      "/parent/attendance",
    );

    expect(await screen.findByRole("link", { name: "Attendance, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diary, attention status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "More, attention status unavailable" })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".attention-indicator--unavailable")).toHaveLength(3);
    expect(state.useAttention).toHaveBeenLastCalledWith("parent", undefined);
    expect(
      await screen.findByText("Student information unavailable"),
    ).toBeVisible();
    expect(screen.queryByText(/Aarav Sharma/)).not.toBeInTheDocument();
  });

  it("uses neutral school context when an authenticated guardian profile has no school name", () => {
    state.guardianSchoolName = null;
    renderWithProviders(
      <ParentShell active="home" pageLabel="Home" selectedChildId="child-2"><span>Content</span></ParentShell>,
      "/parent/home?student_id=child-2",
    );

    expect(screen.getByLabelText("School information unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Cambridge International School")).not.toBeInTheDocument();
  });
});
