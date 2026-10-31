import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceGovernanceRoute, WorkspacePoliciesRoute } from "./GovernanceRoutes";
import { getGovernanceWorkspace, getPublishedPolicies } from "./api";

const auth = vi.hoisted(() => ({
  user: { id: "operator-1", active_school_id: "school-1" },
  memberships: [{ role: "staff", school_id: "school-1", school_name: "Cambridge International School" }],
  refresh: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  getGovernanceWorkspace: vi.fn(),
  getPublishedPolicies: vi.fn(),
}));
vi.mock("./GovernanceAdminPage", () => ({
  GovernanceAdminPage: ({ schoolId, schoolName }: { schoolId: string; schoolName?: string }) => <div>Governance for {schoolName} ({schoolId})</div>,
}));
vi.mock("./PolicyLibraryPage", () => ({
  PolicyLibraryPage: ({ schoolId, schoolName }: { schoolId: string; schoolName?: string }) => <div>Policies for {schoolName} ({schoolId})</div>,
}));
vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function show(route: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{route}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(getGovernanceWorkspace).mockResolvedValue({} as Awaited<ReturnType<typeof getGovernanceWorkspace>>);
  vi.mocked(getPublishedPolicies).mockResolvedValue({ policies: [], membership_roles: ["staff"] });
});

afterEach(() => vi.clearAllMocks());

describe("canonical governance workspace context", () => {
  it("uses the active institution without selecting an administrator persona", async () => {
    show(<WorkspaceGovernanceRoute />);

    expect(await screen.findByText("Governance for Cambridge International School (school-1)")).toBeVisible();
    expect(getGovernanceWorkspace).toHaveBeenCalledWith("school-1");
  });

  it("uses the same neutral institution context for published policies", async () => {
    show(<WorkspacePoliciesRoute />);

    expect(await screen.findByText("Policies for Cambridge International School (school-1)")).toBeVisible();
    await waitFor(() => expect(getPublishedPolicies).toHaveBeenCalledWith("school-1"));
  });
});
