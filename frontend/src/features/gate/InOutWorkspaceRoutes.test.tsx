import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceInOutApprovalsRoute } from "./InOutWorkspaceRoutes";

const state = vi.hoisted(() => ({
  auth: { user: { id: "host", active_school_id: "school" }, memberships: [{ school_id: "school", school_name: "Test school", role: "staff", permissions: [] as string[] }] },
  approvals: vi.fn(), command: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => state.auth, authDestination: () => "/today" }));
vi.mock("./api", () => ({
  getVisitorApprovals: state.approvals,
  gateCommand: state.command,
  gateApprovalsQueryKey: () => ["gate-approvals", "host", "school"],
}));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, active, backTo }: { children: React.ReactNode; active: string; backTo: string }) => <div data-testid="operations-shell" data-active={active} data-back={backTo}>{children}</div> }));

function mount(path = "/work/in-out/approvals?visitor=visitor&school=school") {
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkspaceInOutApprovalsRoute /></QueryClientProvider></MemoryRouter>);
}

describe("host-addressed visitor work", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    state.approvals.mockResolvedValue([{ id: "visitor", school_id: "school", school_name: "Test school", name: "Asha", purpose: "Meeting", state: "pending", revision: 5 }]);
    state.command.mockResolvedValue({});
  });

  it("does not require gate responsibility and rechecks the exact revision", async () => {
    mount();
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-active", "work");
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("school", "visitors/visitor/approve", { expected_revision: 5 }));
  });

  it("shows an explicit unavailable state when a deep-linked request is no longer owned", async () => {
    state.approvals.mockResolvedValue([]);
    mount();
    expect(await screen.findByText("This request is no longer waiting")).toBeVisible();
  });
});
