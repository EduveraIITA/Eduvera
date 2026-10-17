import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoreContent } from "./MorePage";
import type { Portal } from "../auth/AuthContext";

const session = vi.hoisted<{ value: unknown; active: boolean }>(() => ({ value: null, active: true }));
const getAttentionMock = vi.hoisted(() => vi.fn());
const getAccessibleStudentsMock = vi.hoisted(() => vi.fn());
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => session.value }));
vi.mock("../attention/api", () => ({ getAttention: getAttentionMock }));
vi.mock("../school/api", () => ({ getAccessibleStudents: getAccessibleStudentsMock }));
vi.mock("../activation/api", () => ({ getActivation: () => Promise.resolve({ institution: { status: session.active ? "active" : "draft" }, summary: { completed: 2, required: 5 } }) }));
beforeEach(() => {
  window.localStorage.clear();
  session.value = null;
  session.active = true;
  getAttentionMock.mockReset();
  getAccessibleStudentsMock.mockReset();
  getAccessibleStudentsMock.mockResolvedValue({ results: [] });
  getAttentionMock.mockResolvedValue({
    portal: "principal", generated_at: "2026-10-13T08:00:00.000Z",
    summary: { total: 0, new: 0, action_required: 0, exceptions: 0, urgent: 0 },
    modules: {}, items: [],
  });
});
afterEach(cleanup);
function show(portal: Portal, path = `/${portal}/more`) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><MoreContent portal={portal}/></MemoryRouter></QueryClientProvider>);
}

describe("settings-style More", () => {
  it("puts the optional timetable experience in principal Account settings only", () => {
    show("principal");
    expect(screen.getByRole("link", { name: "Open Experimental settings" })).toHaveAttribute("href", "/principal/experimental");
  });

  it("places Campus view directly in admin More and hides it without admin authority", () => {
    session.value = { status: "authenticated", user: { id: "admin", active_school_id: "school" }, memberships: [{ role: "admin", school_id: "school" }] };
    const adminView = show("principal");
    expect(screen.getByRole("link", { name: "Open Campus view" })).toHaveAttribute("href", "/principal/campus");
    expect(screen.getByRole("heading", { name: "School overview" })).toBeVisible();
    adminView.unmount();

    session.value = { status: "authenticated", user: { id: "staff", active_school_id: "school" }, memberships: [{ role: "staff", school_id: "school" }] };
    show("principal");
    expect(screen.queryByRole("link", { name: "Open Campus view" })).not.toBeInTheDocument();
  });

  it.each(["principal", "teacher", "parent", "student"] as const)("makes Analytics discoverable from %s More", portal => {
    show(portal);
    expect(screen.getByRole("link", { name: "Open Insights" })).toHaveAttribute("href", `/${portal}/insights`);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "charts" } });
    expect(screen.getByRole("link", { name: "Open Insights" })).toBeVisible();
  });
  it("keeps the originating portal and selected child on account-security navigation", () => {
    show("parent", "/parent/more?student_id=child-2");
    expect(screen.getByRole("link", { name: "Open Account security" })).toHaveAttribute("href", "/account/security?from=%2Fparent%2Fmore%3Fstudent_id%3Dchild-2");
  });
  it.each(["principal", "teacher", "parent", "student"] as const)("defaults %s to grouped lists and retains the grid choice", portal => {
    const view = show(portal);
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelectorAll(".more-grid--list").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(window.localStorage.getItem("omnischool:more-layout:anonymous")).toBe("grid");
    view.unmount();
    show(portal);
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("finds nested tasks with their hierarchy and clears empty search", () => {
    show("principal");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "invite staff" } });
    expect(screen.getByRole("link", { name: "Open Invite staff" })).toHaveAttribute("href", "/principal/invitations?role=staff&from=staff");
    expect(screen.getByText("People › Staff")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknownxyz" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching tools");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("heading", { name: "People" })).toBeVisible();
  });

  it("preserves the selected child in search and both layouts", () => {
    show("parent", "/parent/more?student_id=child-2");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "marksheet" } });
    expect(screen.getByRole("link", { name: "Open Results" })).toHaveAttribute("href", "/parent/results?student_id=child-2");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByRole("link", { name: "Open Results" })).toHaveAttribute("href", "/parent/results?student_id=child-2");
  });

  it.each([true, false])("shows Finish setup only for incomplete institutions (active=%s)", async active => {
    session.active = active;
    session.value = { status: "authenticated", user: { id: "admin" }, memberships: [{ role: "admin", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "principal", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 },
      modules: { events: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/principal/events", first_item_href: "/principal/events/event-1" } },
      items: [],
    });
    show("principal");
    expect(await screen.findByRole("link", { name: "Review Events & activities, 1 action required" }))
      .toHaveAttribute("href", "/principal/events/event-1");
    if (active) expect(screen.queryByText("Finish setup")).not.toBeInTheDocument();
    else expect(await screen.findByText("Finish setup")).toBeVisible();
  });

  it("shows scoped Requests and Notices attention from the shared read model", async () => {
    session.value = { status: "authenticated", user: { id: "guardian" }, memberships: [{ role: "guardian", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "parent", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 5, new: 2, action_required: 3, exceptions: 0, urgent: 0 },
      modules: {
        requests: { total: 3, new: 0, action_required: 3, exceptions: 0, urgent: 0, href: "/parent/requests?student_id=child-2", first_item_href: "/parent/requests/request-1?student_id=child-2" },
        notices: { total: 2, new: 2, action_required: 0, exceptions: 0, urgent: 0, href: "/parent/notices?student_id=child-2", first_item_href: "/parent/notices/notice-1?student_id=child-2" },
      },
      items: [],
    });
    show("parent", "/parent/more?student_id=child-2");

    expect(await screen.findByRole("link", { name: "Open Requests, 3 actions required" })).toHaveAttribute("href", "/parent/requests?student_id=child-2");
    expect(screen.getByRole("link", { name: "Read Notices, 2 new notices" })).toHaveAttribute("href", "/parent/notices/notice-1?student_id=child-2");
    expect(getAttentionMock).toHaveBeenCalledWith("parent", "child-2");
  });

  it("exposes principal student-leave attention in its owning module", async () => {
    session.value = { status: "authenticated", user: { id: "admin" }, memberships: [{ role: "admin", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "principal", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 },
      modules: {
        leave: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/principal/student-leave", first_item_href: "/principal/student-leave?request=leave-1" },
      },
      items: [],
    });

    show("principal");

    expect(await screen.findByRole("link", { name: "Review Student leave, 1 action required" }))
      .toHaveAttribute("href", "/principal/student-leave?request=leave-1");
  });

  it("surfaces an exact principal calendar change on the combined timetable tile", async () => {
    session.value = { status: "authenticated", user: { id: "admin" }, memberships: [{ role: "admin", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "principal", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 1, new: 1, action_required: 0, exceptions: 0, urgent: 0 },
      modules: {
        calendar: {
          total: 1, new: 1, action_required: 0, exceptions: 0, urgent: 0,
          href: "/principal/calendar",
          first_item_href: "/principal/calendar?date=2026-10-14&calendar_change_id=calendar-1&attention_notification_id=notification-1",
        },
      },
      items: [],
    });

    show("principal");

    expect(await screen.findByRole("link", { name: "Read Timetable, 1 new timetable" }))
      .toHaveAttribute("href", "/principal/calendar?date=2026-10-14&calendar_change_id=calendar-1&attention_notification_id=notification-1");
  });

  it("opens the next exact calendar item when the combined tile contains only new information", async () => {
    session.value = { status: "authenticated", user: { id: "admin" }, memberships: [{ role: "admin", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "principal", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 2, new: 2, action_required: 0, exceptions: 0, urgent: 0 },
      modules: {
        calendar: {
          total: 2, new: 2, action_required: 0, exceptions: 0, urgent: 0,
          href: "/principal/calendar",
          first_item_href: "/principal/calendar?date=2026-10-14&calendar_change_id=calendar-1&attention_notification_id=notification-1",
        },
      },
      items: [],
    });

    show("principal");

    expect(await screen.findByRole("link", { name: "Read Timetable, 2 new timetable" }))
      .toHaveAttribute("href", "/principal/calendar?date=2026-10-14&calendar_change_id=calendar-1&attention_notification_id=notification-1");
  });

  it("shows authorized teacher attention on delegated module tiles", async () => {
    getAttentionMock.mockResolvedValue({
      portal: "teacher",
      generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0 },
      modules: {
        people: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/teacher/students", first_item_href: "/teacher/students/import?import=import-1" },
      },
      items: [],
    });
    session.value = {
      status: "authenticated",
      user: { id: "teacher" },
      memberships: [{ role: "staff", school_id: "school-1", school_name: "School", permissions: ["sis.manage"] }],
    };

    show("teacher", "/teacher/more");

    expect(await screen.findByRole("link", { name: "Review Students & guardians, 1 action required" }))
      .toHaveAttribute("href", "/teacher/students/import?import=import-1");
  });

  it("keeps primary attendance attention out of More instead of duplicating the Attendance tab", async () => {
    getAttentionMock.mockResolvedValue({
      portal: "teacher",
      generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 2, new: 0, action_required: 2, exceptions: 0, urgent: 0 },
      modules: {
        registers: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/teacher/attendance", first_item_href: "/teacher/attendance?class_section_id=class-1" },
        attendance: { total: 1, new: 0, action_required: 1, exceptions: 0, urgent: 0, href: "/teacher/followups", first_item_href: "/teacher/followups?followup=followup-1" },
      },
      items: [],
    });
    session.value = {
      status: "authenticated",
      user: { id: "teacher" },
      memberships: [{ role: "staff", school_id: "school-1", school_name: "School", permissions: ["attendance.view"] }],
    };

    show("teacher", "/teacher/more");

    expect(await screen.findByRole("link", { name: "Open Requests" }))
      .toHaveAttribute("href", "/teacher/requests");
    expect(screen.queryByRole("link", { name: /Registers/ })).not.toBeInTheDocument();
  });

  it("keeps an exact single parent target scoped to the selected child", async () => {
    session.value = { status: "authenticated", user: { id: "guardian" }, memberships: [{ role: "guardian", school_id: "school" }] };
    getAttentionMock.mockResolvedValue({
      portal: "parent", generated_at: "2026-10-13T08:00:00.000Z",
      summary: { total: 1, new: 1, action_required: 0, exceptions: 0, urgent: 0 },
      modules: {
        messages: { total: 1, new: 1, action_required: 0, exceptions: 0, urgent: 0, href: "/parent/messages", first_item_href: "/parent/messages?conversation=room-101" },
      },
      items: [],
    });

    show("parent", "/parent/more?student_id=child-2");

    expect(await screen.findByRole("link", { name: "Read Messages, 1 new messages" }))
      .toHaveAttribute("href", "/parent/messages?conversation=room-101&student_id=child-2");
  });

  it("does not request the adult attention inbox for a student", () => {
    session.value = { status: "authenticated", user: { id: "student" }, memberships: [{ role: "student", school_id: "school" }] };
    show("student");
    expect(getAttentionMock).not.toHaveBeenCalled();
  });

  it("shows a compact retry state when shared attention cannot be loaded", async () => {
    session.value = { status: "authenticated", user: { id: "admin" }, memberships: [{ role: "admin", school_id: "school" }] };
    getAttentionMock.mockRejectedValue(new Error("offline"));

    show("principal");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Attention status is unavailable.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("shows an unavailable state when parent child scope cannot be established", async () => {
    session.value = { status: "authenticated", user: { id: "guardian" }, memberships: [{ role: "guardian", school_id: "school" }] };
    getAccessibleStudentsMock.mockRejectedValue(new Error("offline"));

    show("parent");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Attention status is unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(getAccessibleStudentsMock).toHaveBeenCalledTimes(2);
    expect(getAttentionMock).not.toHaveBeenCalled();
  });

  it("does not present a false all-clear when an authenticated guardian has no linked learner", async () => {
    session.value = { status: "authenticated", user: { id: "guardian" }, memberships: [{ role: "guardian", school_id: "school" }] };
    getAccessibleStudentsMock.mockResolvedValue({ results: [] });

    show("parent");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No linked learner is available");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(getAttentionMock).not.toHaveBeenCalled();
  });
});
