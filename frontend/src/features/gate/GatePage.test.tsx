import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GatePage from "./GatePage";
import type { VisitorFilter } from "./api";

const state = vi.hoisted(() => ({
  auth: {
    status: "authenticated",
    user: { id: "guard", active_school_id: "school" },
    memberships: [{ school_id: "school", school_name: "Test school", role: "staff", permissions: ["gate.manage"] }],
  },
  command: vi.fn(),
  createVisitor: vi.fn(),
  workspace: vi.fn(),
  approvals: vi.fn(),
  findStudents: vi.fn(),
  findStaff: vi.fn(),
  student: vi.fn(),
  staff: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => state.auth, authDestination: () => "/today" }));
vi.mock("./api", () => ({
  gateCommand: state.command,
  createGateVisitor: state.createVisitor,
  getGateWorkspace: state.workspace,
  getVisitorApprovals: state.approvals,
  gateApprovalsQueryKey: () => ["gate-approvals", "guard", "school"],
  findGateStudents: state.findStudents,
  findGateStaff: state.findStaff,
  getGateStudent: state.student,
  getGateStaff: state.staff,
}));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, active, title, backTo, pageTitleTrailing }: { children: React.ReactNode; active: string; title: string; backTo: string; pageTitleTrailing?: React.ReactNode }) => <div data-testid="operations-shell" data-active={active} data-title={title} data-back={backTo}>{pageTitleTrailing}{children}</div> }));
vi.mock("./QRScanner", () => ({ default: ({ onScan }: { onScan: (value: string) => void }) => <button onClick={() => onScan("qr")}>Scan test pass</button> }));

function mount(path = "/areas/in-out/operate") {
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GatePage /></QueryClientProvider></MemoryRouter>);
}

describe("responsibility-composed In & Out workspace", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    state.auth.memberships[0] = { school_id: "school", school_name: "Test school", role: "staff", permissions: ["gate.manage"] };
    state.workspace.mockResolvedValue({ visitors: [], hosts: [], pending: 0, activity: [] });
    state.approvals.mockResolvedValue([]);
    state.findStudents.mockResolvedValue([]);
    state.findStaff.mockResolvedValue([]);
  });

  it("uses total counts and finite server pages to reach an older inside visitor without skipping confirmation", async () => {
    const counts = { all: 126, active: 26, pending: 25, approved: 0, inside: 1, closed: 100 };
    state.workspace.mockImplementation((_school: string, options: { visitorPage: number; visitorFilter: VisitorFilter }) => Promise.resolve({
      visitors: options.visitorPage === 2
        ? [{ id: "older", school_id: "school", name: "Older inside visitor", purpose: "Meeting", state: "inside", revision: 42 }]
        : [{ id: "new", school_id: "school", name: "Newer pending visitor", purpose: "Meeting", state: "pending", revision: 1 }],
      hosts: [], pending: 25, activity: [], visitor_counts: counts,
      visitor_pagination: { page: options.visitorPage, page_size: 25, total: options.visitorFilter === "active" ? 26 : 126, total_pages: options.visitorFilter === "active" ? 2 : 6, has_previous: options.visitorPage > 1, has_next: options.visitorPage === 1, filter: options.visitorFilter },
    }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Visitors at the gate 1 inside · 25 awaiting approval" }));
    expect(await screen.findByRole("option", { name: "Inside · 1" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Filter visitors" })).toHaveValue("active"));
    expect(screen.getByText("Page 1 of 2 · 26 visitors")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Older inside visitor" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Visitor requests" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorPage: 2, visitorFilter: "active" }));
    expect(state.command).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter visitors" }), { target: { value: "inside" } });
    await waitFor(() => expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorPage: 1, visitorFilter: "inside" })));
  });

  it("resolves a linked visitor independently of the selected page and retains exact revision confirmation", async () => {
    const visitor = { id: "older", school_id: "school", name: "Linked older visitor", purpose: "Meeting", state: "inside", revision: 42 };
    state.workspace.mockResolvedValue({ visitors: [], focused_visitor: visitor, hosts: [], pending: 0, activity: [] });
    state.command.mockResolvedValue({ saved: true, visitor: { ...visitor, state: "out", revision: 43 } });
    mount("/areas/in-out/operate?section=visitors&visitor=older");
    expect(await screen.findByRole("heading", { name: "Linked older visitor" })).toBeVisible();
    expect(state.workspace).toHaveBeenCalledWith("school", expect.objectContaining({ visitorId: "older" }));
    expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Exit" }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("school", "visitors/older/out", { expected_revision: 42 }));
  });

  it("explains an unavailable exact visitor instead of showing unrelated page rows", async () => {
    state.workspace.mockResolvedValue({ visitors: [{ id: "other", school_id: "school", name: "Unrelated visitor", purpose: "Meeting", state: "inside", revision: 1 }], focused_visitor: null, hosts: [], pending: 0, activity: [] });
    mount("/areas/in-out/operate?section=visitors&visitor=missing");
    expect(await screen.findByRole("heading", { name: "Visitor unavailable" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Unrelated visitor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Exit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open visitor queue" })).toBeVisible();
  });

  it("uses the shared shell and composes operate, approvals and records without a persona portal", async () => {
    mount();
    expect(await screen.findByRole("button", { name: /^Scan QR/ })).toBeVisible();
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-active", "areas");
    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-back", "/areas/in-out");
    expect(screen.getByRole("button", { name: "Operate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Approvals" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Records" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Switch Hindi / English" }));
    expect(screen.getByRole("button", { name: /^QR स्कैन करें/ })).toBeVisible();
    expect(localStorage.getItem("thatcampus:in-out-language:guard:school")).toBe("hi");
  });

  it("opens a records deep link directly and renders accepted evidence", async () => {
    state.workspace.mockResolvedValue({ visitors: [], hosts: [], pending: 0, activity: [{ id: "event", kind: "staff", person_id: "staff", name: "Meera Das", avatar_url: null, detail: "Security", direction: "in", occurred_at: "2026-10-18T06:00:00.000Z", state: null }] });
    mount("/areas/in-out/operate?section=records");
    expect(await screen.findByRole("heading", { name: "Recent records" })).toBeVisible();
    expect(await screen.findByText("Meera Das")).toBeVisible();
    expect(screen.getByText("Security")).toBeVisible();
  });

  it("opens the current visitor queue in one click while entry and exit still require their own confirmation", async () => {
    state.workspace.mockResolvedValue({ visitors: [
      { id: "inside", school_id: "school", name: "Inside Visitor", purpose: "Meeting", state: "inside", revision: 3 },
      { id: "approved", school_id: "school", name: "Approved Visitor", purpose: "Meeting", state: "approved", revision: 2 },
      { id: "pending", school_id: "school", name: "Pending Visitor", purpose: "Meeting", state: "pending", revision: 1 },
    ], hosts: [], pending: 1, activity: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Visitors at the gate 1 inside · 1 approved · 1 awaiting approval" }));
    expect(await screen.findByRole("heading", { name: "Visitor requests" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Confirm Exit" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm Entry" })).toBeVisible();
    expect(screen.getByText("Waiting for the host’s decision.")).toBeVisible();
    expect(state.command).not.toHaveBeenCalled();
  });

  it("does not add the contextual shortcut to records or show it for completed visits", async () => {
    state.workspace.mockResolvedValue({ visitors: [{ id: "past", school_id: "school", name: "Past Visitor", purpose: "Delivery", state: "out", revision: 4 }], hosts: [], pending: 0, activity: [] });
    mount();await waitFor(() => expect(state.workspace).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Visitors at the gate/ })).not.toBeInTheDocument();
    cleanup();
    state.workspace.mockResolvedValue({ visitors: [{ id: "inside", school_id: "school", name: "Inside Visitor", purpose: "Delivery", state: "inside", revision: 2 }], hosts: [], pending: 0, activity: [] });
    mount("/areas/in-out/operate?section=records");
    expect(await screen.findByText("Inside Visitor")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Visitors at the gate/ })).not.toBeInTheDocument();
  });

  it("records a staff boundary movement through the same authorized workspace", async () => {
    const match = { id: "staff-1", name: "Meera Das", avatar_url: "", staff_code: "EMP-1", designation: "Lab assistant", department: "Science", direction: "out", last_movement_at: null, revision: 4 };
    state.findStaff.mockResolvedValue([match]);
    state.staff.mockResolvedValue(match);
    state.command.mockResolvedValue({ saved: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Record manually/ }));
    fireEvent.click(screen.getByRole("button", { name: /Find student or staff/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Staff" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Meera" } });
    fireEvent.click(await screen.findByRole("button", { name: "View Meera Das" }));
    expect(await screen.findByRole("heading", { name: "Meera Das" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("school", "staff-movements", expect.objectContaining({ staff_profile_id: "staff-1", direction: "in", identity_verified: true, command_id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown })));
    expect(await screen.findByText("Movement recorded")).toBeVisible();
  });

  it("does not claim a scanned visitor entered until the movement is accepted", async () => {
    const visitor = { id: "visitor", school_id: "school", name: "Asha", purpose: "Meeting", revision: 2, state: "approved" };
    state.command.mockResolvedValueOnce({ kind: "visitor", visitor }).mockResolvedValueOnce({ saved: true, visitor: { ...visitor, revision: 3, state: "inside" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Scan QR/ }));
    fireEvent.click(screen.getByText("Scan test pass"));
    expect(await screen.findByText("Asha")).toBeVisible();
    expect(screen.queryByText("Visitor entry recorded")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Entry" }));
    await waitFor(() => expect(state.command).toHaveBeenLastCalledWith("school", "visitors/visitor/in", { expected_revision: 2 }));
    expect(await screen.findByText("Movement recorded")).toBeVisible();
  });

  it("fails closed when the person has no current gate responsibility", () => {
    state.auth.memberships[0] = { ...state.auth.memberships[0], role: "staff", permissions: [] };
    mount();
    expect(screen.queryByTestId("operations-shell")).not.toBeInTheDocument();
    expect(state.workspace).not.toHaveBeenCalled();
  });
});
