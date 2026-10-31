import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdministrationPage from "./AdministrationPage";
import { getAdministration, getInstitutionSetup } from "./api";
import type { SchoolMembership } from "../auth/AuthContext";

const session = vi.hoisted(() => ({ admin: true, activeSchoolId: "school", memberships: null as SchoolMembership[] | null }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { active_school_id: session.activeSchoolId }, memberships: session.memberships ?? [{ role: session.admin ? "admin" : "staff", school_id: "school", school_name: "School", permissions: ["sis.manage"] }] }) }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getAdministration: vi.fn(), getInstitutionSetup: vi.fn() }));
vi.mock("./CampusReplicaManager", () => ({ CampusReplicaManager: ({ schoolId, initialCampusId }: { schoolId: string; initialCampusId?: string }) => <p>Campus owner {schoolId} · {initialCampusId}</p> }));
vi.mock("./OperatingRules", () => ({ OperatingRules: () => <p>Operating rules content</p> }));
beforeEach(() => {
  session.admin = true;
  session.activeSchoolId = "school";
  session.memberships = null;
  vi.mocked(getAdministration).mockResolvedValue({ school: { id: "school", name: "School", code: "S" }, students: [], terms: [], classes: [], subjects: [], members: [], invitations: [], audit: [] });
  vi.mocked(getInstitutionSetup).mockResolvedValue({ campuses: [{ id: "east", status: "active" }], readiness: [], summary: { campuses: 1, spaces: 0, classes: 0, staff: 0 } } as never);
});
afterEach(cleanup);
function show(path: string) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><AdministrationPage/><LocationProbe/></MemoryRouter></QueryClientProvider>);
}
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
describe("Institute settings hierarchy", () => {
  it("keeps a guided native edit on the current institution even when another membership is first", async () => {
    session.activeSchoolId = "school-2";
    session.memberships = [
      { id: "first", role: "admin", school_id: "school", school_name: "First institute" },
      { id: "active", role: "admin", school_id: "school-2", school_name: "Current institute" },
    ];
    show("/more/setup/institution/campus?setup=whole-campus&setup_step=connect&campus_id=east");
    expect(await screen.findByText("Campus owner school-2 · east")).toBeVisible();
    expect(getAdministration).toHaveBeenCalledWith("school-2");
    expect(getAdministration).not.toHaveBeenCalledWith("school");
    expect(await screen.findByRole("link", { name: "Return to campus guide" })).toHaveAttribute("href", "/more/setup/whole-campus?step=connect&campus_id=east");
  });
  it("refuses a conflicting institution parameter instead of silently editing either campus", async () => {
    show("/more/setup/institution/campus?setup=whole-campus&setup_step=connect&school=other&campus_id=east");
    expect(await screen.findByRole("heading", { name: "Your campus context has changed" })).toBeVisible();
    expect(screen.queryByText(/Campus owner/)).not.toBeInTheDocument();
    expect(getAdministration).not.toHaveBeenCalled();
  });
  it("does not show a redundant institution selector for one campus with multiple roles", async () => {
    session.memberships = [
      { id: "staff", role: "staff", school_id: "school", school_name: "School", permissions: ["sis.manage"] },
      { id: "admin", role: "admin", school_id: "school", school_name: "School" },
    ];
    show("/more/setup/institution");
    expect(await screen.findByRole("link", { name: "Account access" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Operating rules" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Institution" })).not.toBeInTheDocument();
    expect(session.memberships).toHaveLength(2);
  });

  it("keeps equally named institutions separately selectable by ID", async () => {
    session.memberships = [
      { id: "admin-1", role: "admin", school_id: "school", school_name: "School" },
      { id: "staff-1", role: "staff", school_id: "school", school_name: "School", permissions: ["sis.manage"] },
      { id: "admin-2", role: "admin", school_id: "school-2", school_name: "School" },
    ];
    show("/more/setup/institution");
    const institution = screen.getByRole("combobox", { name: "Institution" });
    expect(within(institution).getAllByRole("option", { name: "School" }).map((option) => (option as HTMLOptionElement).value)).toEqual(["school", "school-2"]);
    await userEvent.setup().selectOptions(institution, "school-2");
    expect(institution).toHaveValue("school-2");
    expect(getAdministration).toHaveBeenCalledWith("school-2");
  });

  it("opens a focused subpage and returns to settings", async () => {
    show("/more/setup/institution");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Account access" }));
    expect(screen.getByRole("heading", { name: "Account access", level: 1 })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Invitations" })).toHaveAttribute("href", "/more/setup/people/invitations?from=settings&school=school");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByRole("link", { name: "Academic structure" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Capabilities" })).toHaveAttribute("href", "/more/setup/capabilities");
    expect(screen.getByRole("link", { name: "Organisation verification" })).toHaveAttribute("href", "/more/verification");
    expect(screen.queryByText("Get your institution ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Promote a class" })).not.toBeInTheDocument();
  });
  it("does not expose account access, progressive setup or verification to delegated school-office staff", async () => {
    session.admin = false;
    show("/more/setup/people/access");
    expect(await screen.findByRole("link", { name: "Academic structure" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Account access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Capabilities" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Organisation verification" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "School members" })).not.toBeInTheDocument();
  });
  it("moves back one level at a time from an operating-rule editor", async () => {
    show("/more/setup/institution/operating-rules?school=school&rule=events");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Operating rules", level: 1 })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/more/setup/institution/operating-rules?school=school");

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/more/setup/institution?school=school");

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/more");
  });
});
