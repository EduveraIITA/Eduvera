import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdministrationPage from "./AdministrationPage";
import { getAdministration } from "./api";

const session = vi.hoisted(() => ({ admin: true }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => null, useAuth: () => ({ memberships: [{ role: session.admin ? "admin" : "staff", school_id: "school", school_name: "School", permissions: ["sis.manage"] }], hasPortal: () => session.admin }) }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getAdministration: vi.fn() }));
beforeEach(() => {
  session.admin = true;
  vi.mocked(getAdministration).mockResolvedValue({ school: { id: "school", name: "School", code: "S" }, students: [], terms: [], classes: [], subjects: [], members: [], invitations: [], audit: [] });
});
afterEach(cleanup);
function show(path: string) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><AdministrationPage/></MemoryRouter></QueryClientProvider>);
}
describe("Institute settings hierarchy", () => {
  it("opens a focused subpage and returns to settings", async () => {
    show("/principal/administration");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Account access" }));
    expect(screen.getByRole("heading", { name: "Account access", level: 1 })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Invitations" })).toHaveAttribute("href", "/principal/invitations?from=settings&school=school");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByRole("link", { name: "Academic setup" })).toBeVisible();
    expect(screen.queryByText("Get your institution ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Promote a class" })).not.toBeInTheDocument();
  });
  it("does not expose account access or activation to delegated school-office staff", async () => {
    session.admin = false;
    show("/teacher/administration?section=access");
    expect(await screen.findByRole("link", { name: "Academic setup" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Account access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Setup status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "School members" })).not.toBeInTheDocument();
  });
});
