import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GateAdminPage from "./GateAdminPage";

const state = vi.hoisted(() => ({
  auth: { user: { id: "admin", active_school_id: "school" }, memberships: [{ school_id: "school", school_name: "Test school", role: "admin", permissions: [] as string[] }] },
  command: vi.fn(), workspace: vi.fn(), find: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => state.auth, authDestination: () => "/today" }));
vi.mock("./api", () => ({ gateCommand: state.command, getGateWorkspace: state.workspace, findGateStudents: state.find }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cXI=") } }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, active, backTo }: { children: React.ReactNode; active: string; backTo: string }) => <div data-testid="operations-shell" data-active={active} data-back={backTo}>{children}</div> }));
function mount() { render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateAdminPage /></QueryClientProvider></MemoryRouter>); }

describe("In & Out management workspace", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.memberships[0].role = "admin";
    state.workspace.mockResolvedValue({ visitors: [], hosts: [], pending: 0, activity: [] });
    state.find.mockResolvedValue([]);
  });

  it("uses neutral canonical links for operations and responsibility setup", async () => {
    mount();
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-active", "areas");
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-back", "/areas/in-out");
    expect(screen.getByRole("link", { name: /Open checkpoint/ })).toHaveAttribute("href", "/areas/in-out/operate");
    expect(screen.getByRole("link", { name: /Assign In & Out responsibility/ })).toHaveAttribute("href", "/more/setup/responsibilities");
    await waitFor(() => expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorFilter: "all", visitorPage: 1 })));
  });

  it("preserves student and pickup pass issuance", async () => {
    state.find.mockResolvedValue([{ id: "student", name: "Aarav", class_label: "7 A", admission_number: "100", plan_state: "ready" }]);
    state.command.mockResolvedValue({ qr: "private-pass", kind: "student", name: "Aarav", expires_at: "2030-10-15T12:00:00Z" });
    mount();
    fireEvent.change(screen.getByLabelText("Find student"), { target: { value: "Aarav" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Student QR" }));
    expect(await screen.findByRole("img", { name: "student QR pass" })).toBeVisible();
    expect(state.command).toHaveBeenCalledWith("school", "passes", { student_id: "student", kind: "student" });
  });

  it("preserves optimistic-concurrency evidence for visitor decisions", async () => {
    state.workspace.mockResolvedValue({ visitors: [{ id: "visitor", school_id: "school", name: "Visitor", purpose: "Meeting", state: "pending", revision: 7 }], hosts: [], pending: 1, activity: [] });
    state.command.mockResolvedValue({});
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("school", "visitors/visitor/approve", { expected_revision: 7 }));
  });

  it("pages visitor decisions with server totals and resets to page one when a filter changes", async () => {
    state.workspace.mockImplementation((_school: string, options: { visitorPage: number; visitorFilter: string }) => Promise.resolve({
      visitors: [], hosts: [], pending: 30, activity: [],
      visitor_counts: { all: 80, active: 40, inside: 5, approved: 5, pending: 30, closed: 40 },
      visitor_pagination: { page: options.visitorPage, page_size: 25, total: 80, total_pages: 4, has_previous: options.visitorPage > 1, has_next: true, filter: options.visitorFilter },
    }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorPage: 2, visitorFilter: "all" })));
    expect(await screen.findByText("Page 2 of 4 · 80 visitors")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter visitors" }), { target: { value: "pending" } });
    await waitFor(() => expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorPage: 1, visitorFilter: "pending" })));
    expect(state.command).not.toHaveBeenCalled();
  });

  it("does not expose administrator-only pass management to ordinary staff", () => {
    state.auth.memberships[0].role = "staff";
    mount();
    expect(screen.queryByTestId("operations-shell")).not.toBeInTheDocument();
    expect(state.workspace).not.toHaveBeenCalled();
  });
});
