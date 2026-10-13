import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ApiLeaveRequest } from "../school/api";
import { ApiError } from "../../lib/api";
import PrincipalStudentLeavePage from "./PrincipalStudentLeavePage";
import { PrincipalStudentLeaveView } from "./PrincipalStudentLeaveView";
import { getLeaveRequest, getSchoolLeaveRequests, performLeaveAction } from "../school/api";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ memberships: [{ id: "membership-1", role: "admin", school_id: "school-1", school_name: "Cambridge International School" }] }),
}));

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

vi.mock("../school/api", async (original) => ({
  ...(await original<typeof import("../school/api")>()),
  getSchoolLeaveRequests: vi.fn(),
  getLeaveRequest: vi.fn(),
  performLeaveAction: vi.fn(),
}));

function leave(id = "request-1", name = "Aarav Sharma"): ApiLeaveRequest {
  return {
    id,
    student_id: `student-${id}`,
    student: { id: `student-${id}`, name, display_name: name, admission_number: "CIS-2023-071", avatar_url: null, class_name: "Class 7A" },
    class_name: "Class 7A",
    category: "medical",
    category_label: "Medical",
    starts_on: "2026-10-14",
    ends_on: "2026-10-15",
    duration_days: 2,
    reason: "Recovery after a medical appointment.",
    status: "authorized",
    status_label: "Ready for school review",
    requested_by_name: "Pooja Sharma",
    submitted_at: "2026-10-12T09:00:00.000Z",
    guardian_authorized_by_name: "Pooja Sharma",
    guardian_authorized_at: "2026-10-12T09:05:00.000Z",
    decided_by_name: null,
    decided_at: null,
    documents: [{ id: "document-1", original_name: "medical-note.pdf", content_type: "application/pdf", size_bytes: 14500, file_url: "/api/v1/leave-requests/request-1/documents/document-1/download/" }],
    audit_log: [{ id: "audit-1", action: "authorized", action_label: "Guardian authorised", note: "", actor_name: "Pooja Sharma", created_at: "2026-10-12T09:05:00.000Z" }],
  };
}

function renderRoute(entry = "/principal/student-leave?request=request-2") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><PrincipalStudentLeavePage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(getSchoolLeaveRequests).mockResolvedValue({ results: [leave()] });
  vi.mocked(getLeaveRequest).mockResolvedValue(leave("request-2", "Rohan Verma"));
  vi.mocked(performLeaveAction).mockResolvedValue({ ...leave("request-2", "Rohan Verma"), status: "school_approved", status_label: "Approved" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PrincipalStudentLeavePage", () => {
  it("opens the exact request from attention navigation while retaining the pending queue", async () => {
    renderRoute();
    expect(await screen.findByRole("heading", { name: "Rohan Verma" })).toBeVisible();
    expect(getLeaveRequest).toHaveBeenCalledWith("request-2");
    expect(getSchoolLeaveRequests).toHaveBeenCalledWith("authorized");
    expect(screen.getByRole("link", { name: /Aarav Sharma/ })).toHaveAttribute("href", "/principal/student-leave?request=request-1");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "student-leave-request-request-2"));
  });

  it("does not describe a still-loading queue as empty after the exact request opens", async () => {
    vi.mocked(getSchoolLeaveRequests).mockImplementation(() => new Promise(() => undefined));

    renderRoute();

    expect(await screen.findByRole("heading", { name: "Rohan Verma" })).toBeVisible();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading requests");
    expect(screen.queryByText("No requests need a school decision.")).not.toBeInTheDocument();
  });

  it("shows exact-target recovery for a request that no longer exists", async () => {
    vi.mocked(getLeaveRequest).mockRejectedValue(new ApiError("Request not found.", 404));

    renderRoute();

    expect(await screen.findByRole("heading", { name: "Request not available" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the current queue" })).toHaveAttribute("href", "/principal/student-leave");
    expect(screen.queryByText("Request not found.")).not.toBeInTheDocument();
  });

  it("requires a clear reason before confirming a rejection", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><PrincipalStudentLeaveView queue={[leave()]} selected={leave()} requestedId="request-1" onDecide={onDecide} /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Not approve" }));
    const confirm = screen.getByRole("button", { name: "Confirm decision" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Dates overlap an examination.");
    await user.click(confirm);
    expect(onDecide).toHaveBeenCalledWith("reject", "Dates overlap an examination.");
  });

  it("shows approval impact before saving and removes controls after a decision", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    const view = render(<MemoryRouter><PrincipalStudentLeaveView queue={[leave()]} selected={leave()} requestedId="request-1" onDecide={onDecide} /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Approve leave" }));
    expect(screen.getByText(/instructional days will be recorded as excused/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(onDecide).toHaveBeenCalledWith("approve", "");

    view.rerender(<MemoryRouter><PrincipalStudentLeaveView queue={[]} selected={{ ...leave(), status: "school_approved", status_label: "Approved", decided_by_name: "Meera Kapoor", decided_at: "2026-10-13T06:00:00.000Z" }} requestedId="request-1" onDecide={onDecide} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("Approved by Meera Kapoor");
    expect(screen.queryByRole("button", { name: "Approve leave" })).not.toBeInTheDocument();
  });
});
