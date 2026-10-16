import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizedStaffLeaveDecisionRoute } from "./StaffOperationsRoutes";
import { getStaffWorkspace } from "./api";

const { auth } = vi.hoisted(() => ({
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
  AuthorizedStaffLeaveDecisionPage: (props: { portal: string; schoolId: string; actorId: string; requestId: string }) => (
    <output data-testid="decision-page">{JSON.stringify(props)}</output>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStaffWorkspace).mockResolvedValue({ mode: "staff" } as never);
});

describe("AuthorizedStaffLeaveDecisionRoute", () => {
  it("uses an active staff context without requiring a principal portal", async () => {
    const requestId = "10000000-0000-4000-a000-000000000001";
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/work/staff-leave?school=school-1&request=${requestId}&context=teacher`]}>
          <Routes><Route path="/work/staff-leave" element={<AuthorizedStaffLeaveDecisionRoute />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getStaffWorkspace).toHaveBeenCalledWith("school-1", requestId));
    const decisionPage = await screen.findByTestId("decision-page");
    expect(decisionPage).toHaveTextContent('"portal":"teacher"');
    expect(decisionPage).toHaveTextContent('"actorId":"decision-owner"');
  });
});
