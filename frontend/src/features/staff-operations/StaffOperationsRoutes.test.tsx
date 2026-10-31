import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizedStaffLeaveDecisionRoute,
  WorkspaceCoverageRoute,
  WorkspaceResponsibilitiesRoute,
  WorkspaceStaffLeaveRoute,
  WorkspaceStaffSetupRoute,
} from "./StaffOperationsRoutes";
import { getStaffWorkspace } from "./api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ApiError } from "../../lib/api";

const { auth, readFailure } = vi.hoisted(() => ({
  readFailure: vi.fn(),
  auth: {
    status: "authenticated" as const,
    user: { id: "decision-owner", email_verified: true },
    memberships: [{
      id: "membership-other",
      school_id: "school-other",
      school_name: "Another Campus",
      role: "staff" as const,
      permissions: [],
    }, {
      id: "membership-1",
      school_id: "school-1",
      school_name: "Cambridge International School",
      role: "staff" as const,
      permissions: [],
    }],
    refresh: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./api", () => ({ getStaffWorkspace: vi.fn() }));
vi.mock("./StaffOperationsPage", () => ({
  StaffOperationsPage: () => null,
  StaffOperationsWorkspacePage: (props: { surface: string; schoolId: string; actorId: string }) => (
    <output data-testid="workspace-page">{JSON.stringify(props)}</output>
  ),
  AuthorizedStaffLeaveDecisionPage: (props: { schoolId: string; actorId: string; requestId: string; refresh: () => Promise<void> }) => (
    <><output data-testid="decision-page">{JSON.stringify(props)}</output><button onClick={() => { void props.refresh().catch(readFailure); }}>Refresh decision</button></>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStaffWorkspace).mockResolvedValue({ mode: "staff" } as never);
});
afterEach(cleanup);

describe("AuthorizedStaffLeaveDecisionRoute", () => {
  it("uses an active staff context without requiring a principal portal", async () => {
    const requestId = "10000000-0000-4000-a000-000000000001";
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ExecutionEnvironmentProvider environment={{ mode: "live" }}>
        <MemoryRouter initialEntries={[`/work/staff-leave?school=school-1&request=${requestId}&context=teacher`]}>
          <Routes><Route path="/work/staff-leave" element={<AuthorizedStaffLeaveDecisionRoute />} /></Routes>
        </MemoryRouter>
        </ExecutionEnvironmentProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getStaffWorkspace).toHaveBeenCalledWith("school-1", requestId));
    const decisionPage = await screen.findByTestId("decision-page");
    expect(decisionPage).not.toHaveTextContent('"portal"');
    expect(decisionPage).toHaveTextContent('"actorId":"decision-owner"');
  });

  it.each([
    ["/more/setup/responsibilities", WorkspaceStaffSetupRoute, "setup"],
    ["/areas/responsibilities/mine", WorkspaceResponsibilitiesRoute, "responsibilities"],
    ["/areas/responsibilities/coverage", WorkspaceCoverageRoute, "coverage"],
    ["/areas/responsibilities/leave", WorkspaceStaffLeaveRoute, "leave"],
  ] as const)("loads the neutral %s workspace", async (path, RouteComponent, surface) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ExecutionEnvironmentProvider environment={{ mode: "live" }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={path} element={<RouteComponent />} /></Routes>
        </MemoryRouter>
        </ExecutionEnvironmentProvider>
      </QueryClientProvider>,
    );

    const workspace = await screen.findByTestId("workspace-page");
    expect(workspace).toHaveTextContent(`"surface":"${surface}"`);
    expect(workspace).not.toHaveTextContent('"portal"');
  });

  it.each([503, 403])("keeps only recoverable cached decision data after a %s refetch failure", async status => {
    const requestId = "10000000-0000-4000-a000-000000000001";
    const failure = new ApiError(status === 403 ? "Decision access ended" : "Temporarily unavailable", status);
    vi.mocked(getStaffWorkspace).mockResolvedValueOnce({ mode: "staff" } as never).mockRejectedValueOnce(failure);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}>
      <MemoryRouter initialEntries={[`/work/staff-leave?school=school-1&request=${requestId}`]}>
        <AuthorizedStaffLeaveDecisionRoute />
      </MemoryRouter>
    </ExecutionEnvironmentProvider></QueryClientProvider>);
    expect(await screen.findByTestId("decision-page")).toBeVisible();
    expect(client.getQueryCache().getAll()[0]!.queryKey).toEqual(["execution-environment", "live", "staff-operations", "school-1", "actor", "decision-owner", requestId, "authorized-leave-decision"]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh decision" }));
    await waitFor(() => expect(readFailure).toHaveBeenCalledWith(failure));
    expect(auth.refresh).not.toHaveBeenCalled();
    if (status === 503) expect(screen.getByTestId("decision-page")).toBeVisible();
    else expect(screen.queryByTestId("decision-page")).not.toBeInTheDocument();
  });
});
