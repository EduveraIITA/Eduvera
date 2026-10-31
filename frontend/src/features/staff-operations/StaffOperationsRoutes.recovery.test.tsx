import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { WorkspaceStaffSetupRoute } from "./StaffOperationsRoutes";
import { getStaffWorkspace, type AdminStaffWorkspace, type StaffProfile } from "./api";
import { assignAccessRole, type AccessRole } from "./access-api";

const { auth } = vi.hoisted(() => ({ auth: {
  user: { id: "operator-1", active_school_id: "campus" },
  memberships: [{ id: "membership", school_id: "campus", school_name: "Synthetic campus", role: "admin" }],
  refresh: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth, useOptionalAuth: () => auth }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getStaffWorkspace: vi.fn() }));
vi.mock("./access-api", async original => ({ ...await original<typeof import("./access-api")>(), assignAccessRole: vi.fn() }));
// Keep the real route/query and real assignment editor/recovery. Other staff
// workspace sections are outside this transport-to-dialog composition test.
vi.mock("./StaffOperationsPage", async () => {
  const { StaffRoleAssignments } = await import("./StaffRoleAssignments");
  return { StaffOperationsWorkspacePage: ({ schoolId, data, refresh }: {
    schoolId: string; data: AdminStaffWorkspace; refresh: () => Promise<void>;
  }) => <><output data-testid="workspace-actor">{auth.user.id}:{data.profiles[0]!.first_name}</output>
    <StaffRoleAssignments schoolId={schoolId} data={data} profile={data.profiles[0]!} refresh={refresh} /></>,
  AuthorizedStaffLeaveDecisionPage: () => null };
});

const profile: StaffProfile = { id: "profile", user_id: "staff", staff_code: "T1", first_name: "Kavita", last_name: "Synthetic", email: "kavita@example.test", phone: "", staff_kind: "teaching", designation: "Teacher", department: "Learning", employment_type: "full_time", joined_on: "2026-04-01", status: "active", revision: 1, onboarding_total: 0, onboarding_complete: 0, pending_requests: 0 };
const role: AccessRole = { id: "role", name: "Class support", description: "", context_kind: "class", permissions: ["messages.view"], source_kind: "institute", is_active: true, revision: 1, assignment_count: 0 };
const workspace: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [{ id: "class", name: "Class A" }], subjects: [], events: [] }, access_roles: [role], role_assignments: [] };
const live: ExecutionEnvironment = { mode: "live" };
const simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "scenario:qa:run:qa", runId: "qa", virtualClock: { now: "2026-10-23T12:00:00Z", timeZone: "UTC" }, runStatus: "running" };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  const tree = (environment: ExecutionEnvironment) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}>
    <MemoryRouter initialEntries={["/more/setup/responsibilities"]}><Routes>
      <Route path="/more/setup/responsibilities" element={<WorkspaceStaffSetupRoute />} />
      <Route path="/login" element={<p>Sign in again</p>} />
    </Routes></MemoryRouter>
  </ExecutionEnvironmentProvider></QueryClientProvider>;
  const view = render(tree(live));
  return { client, rerender: (environment: ExecutionEnvironment = live) => view.rerender(tree(environment)) };
}
async function openAssignment() {
  await userEvent.click(await screen.findByRole("button", { name: "Assign role", exact: true }));
  const dialog = screen.getByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Class", exact: true }), "class");
  await userEvent.click(within(dialog).getByRole("button", { name: "Assign role", exact: true }));
  return dialog;
}
beforeEach(() => {
  vi.clearAllMocks(); auth.user.id = "operator-1";
  vi.mocked(getStaffWorkspace).mockResolvedValue(workspace);
  vi.mocked(assignAccessRole).mockResolvedValue({ id: "saved" });
});
afterEach(cleanup);

describe("staff route refresh and assignment recovery with real query state", () => {
  it("retains a confirmed dialog when the real refetch fails and retries only the read", async () => {
    vi.mocked(getStaffWorkspace).mockResolvedValueOnce(workspace).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(workspace);
    mount(); const dialog = await openAssignment();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The change was saved. Couldn’t refresh assignments");
    expect(dialog).toBeVisible(); expect(within(dialog).getByRole("combobox", { name: "Role" })).toBeDisabled();
    expect(auth.refresh).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Refresh assignments" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(assignAccessRole).toHaveBeenCalledTimes(1); expect(getStaffWorkspace).toHaveBeenCalledTimes(3); expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it("retains an unconfirmed dialog after failed recovery instead of implying a saved assignment", async () => {
    vi.mocked(assignAccessRole).mockRejectedValue(new TypeError("response lost"));
    vi.mocked(getStaffWorkspace).mockResolvedValueOnce(workspace).mockRejectedValueOnce(new ApiError("Service unavailable", 503));
    mount(); const dialog = await openAssignment();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("not confirmed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Refresh assignments" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(dialog).toBeVisible(); expect(within(dialog).getByRole("combobox", { name: "Role" })).toBeDisabled();
    expect(assignAccessRole).toHaveBeenCalledTimes(1); expect(auth.refresh).not.toHaveBeenCalled();
  });

  it.each([401, 403])("does not retain cached editable staff data after an explicit %s refusal", async status => {
    vi.mocked(getStaffWorkspace).mockResolvedValueOnce(workspace).mockRejectedValueOnce(new ApiError("Access ended", status));
    mount(); await openAssignment();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("workspace-actor")).not.toBeInTheDocument();
    if (status === 401) expect(await screen.findByText("Sign in again")).toBeVisible();
    else expect(screen.getByRole("alert")).toHaveTextContent("couldn't sync");
    expect(assignAccessRole).toHaveBeenCalledTimes(1);
  });

  it("qualifies cached staff data by actor and world, and never queries an unavailable world", async () => {
    const { client, rerender } = mount();
    expect(await screen.findByTestId("workspace-actor")).toHaveTextContent("operator-1:Kavita");
    let resolveActor!: (value: AdminStaffWorkspace) => void;
    vi.mocked(getStaffWorkspace).mockReturnValueOnce(new Promise(done => { resolveActor = done; }));
    auth.user.id = "operator-2"; rerender();
    expect(screen.queryByTestId("workspace-actor")).not.toBeInTheDocument();
    await act(() => Promise.resolve(resolveActor({ ...workspace, profiles: [{ ...profile, first_name: "Second actor data" }] })));
    expect(await screen.findByTestId("workspace-actor")).toHaveTextContent("operator-2:Second actor data");
    rerender(simulation);
    expect(await screen.findByTestId("workspace-actor")).toHaveTextContent("operator-2:Kavita");
    const keys = client.getQueryCache().getAll().map(query => query.queryKey);
    expect(keys).toContainEqual(["execution-environment", "live", "staff-operations", "campus", "actor", "operator-1", "setup", "list"]);
    expect(keys).toContainEqual(["execution-environment", "live", "staff-operations", "campus", "actor", "operator-2", "setup", "list"]);
    expect(keys).toContainEqual(["execution-environment", "simulation", simulation.namespaceId, simulation.runId, "staff-operations", "campus", "actor", "operator-2", "setup", "list"]);
    const calls = vi.mocked(getStaffWorkspace).mock.calls.length;
    rerender({ mode: "simulation", unavailable: true, unavailableReason: "authorization_lost", namespaceId: simulation.namespaceId, runId: simulation.runId });
    expect(screen.queryByTestId("workspace-actor")).not.toBeInTheDocument(); expect(getStaffWorkspace).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("keeps an initial failed load an error rather than rendering invented staff data", async () => {
    vi.mocked(getStaffWorkspace).mockRejectedValue(new TypeError("offline")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't sync");
    expect(screen.queryByRole("button", { name: "Assign role", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getStaffWorkspace).toHaveBeenCalledTimes(2));
  });
});
