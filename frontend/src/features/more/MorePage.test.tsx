import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoreContent } from "./MorePage";
import type { Portal } from "../auth/AuthContext";

const session = vi.hoisted<{ value: unknown; active: boolean }>(() => ({ value: null, active: true }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => session.value }));
vi.mock("../operations/api", () => ({ getPrincipalHome: () => Promise.resolve({ more_attention: { events: 1 } }), getTeacherHome: () => Promise.resolve({}) }));
vi.mock("../activation/api", () => ({ getActivation: () => Promise.resolve({ institution: { status: session.active ? "active" : "draft" }, summary: { completed: 2, required: 5 } }) }));
beforeEach(() => { window.localStorage.clear(); session.value = null; session.active = true; });
afterEach(cleanup);
function show(portal: Portal, path = `/${portal}/more`) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><MoreContent portal={portal}/></MemoryRouter></QueryClientProvider>);
}

describe("settings-style More", () => {
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
    show("principal");
    expect(await screen.findByRole("link", { name: "Open Events & activities, action needed" })).toBeVisible();
    if (active) expect(screen.queryByText("Finish setup")).not.toBeInTheDocument();
    else expect(await screen.findByText("Finish setup")).toBeVisible();
  });
});
