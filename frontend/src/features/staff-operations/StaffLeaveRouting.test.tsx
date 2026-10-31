import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError } from "../../lib/api";
import { AuthorizedStaffLeaveDecisionPage, StaffOperationsPage, StaffOperationsWorkspacePage } from "./StaffOperationsPage";
import {
  decideStaffLeave, enableLeaveReviewRouting, getLeaveReviewRouting, getStaffWorkspace, previewStaffLeaveImpact, rerouteStaffLeave, submitStaffLeave,
  type AdminStaffWorkspace, type CoverageTask, type LeaveReviewReadiness, type ReviewRouteBasis, type StaffLeaveImpact, type StaffLeaveRequest, type StaffProfile, type TeacherStaffWorkspace,
} from "./api";
import { clearPendingStaffLeaveCommandsForTests } from "./pendingLeaveCommand";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(),
  decideStaffLeave: vi.fn(), rerouteStaffLeave: vi.fn(), submitStaffLeave: vi.fn(),
  enableLeaveReviewRouting: vi.fn(), getLeaveReviewRouting: vi.fn(),
  previewStaffLeaveImpact: vi.fn(), getStaffWorkspace: vi.fn(),
}));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("../attention/AttentionOpenAcknowledgement", () => ({ AttentionOpenAcknowledgement: () => null }));

const profile: StaffProfile = { id: "staff-1", user_id: "requester", staff_code: "T1", first_name: "Kavita", last_name: "Mehta", email: "kavita@example.test", phone: "", staff_kind: "teaching", designation: "Teacher", department: "Learning", employment_type: "full_time", joined_on: null, status: "active", revision: 1 };
const priorReviewer = { user_id: "former-reviewer", name: "Former reviewer" };
const currentReviewer = { user_id: "new-reviewer", name: "Nisha Rao" };
const request: StaffLeaveRequest = { id: "leave-1", staff_profile_id: profile.id, policy_id: "policy", policy_name: "Casual leave", policy_code: "CASUAL", first_name: "Kavita", last_name: "Mehta", staff_code: "T1", designation: "Teacher", starts_on: "2026-10-27", ends_on: "2026-10-27", portion: "full_day", requested_days: "1", reason: "A family appointment", handover_note: "", status: "submitted", revision: 3, decision_note: "", submitted_at: "2026-10-26T08:00:00Z", affected_periods: 1, review_route: { state: "needs_reassignment", reviewer: priorReviewer, current_reviewer: currentReviewer, can_reroute: true } };
const ready: LeaveReviewReadiness = { state: "ready", reviewer: currentReviewer, reason: null, can_configure: false };
const basis: ReviewRouteBasis = { rule: { id: "rule", revision: 1 }, office: { id: "office", revision: 2 }, appointment: { id: "appointment", revision: 3 }, person: { id: "person", revision: 4 }, sources: [{ id: "source", revision: 5 }] };
const workspace: TeacherStaffWorkspace = { mode: "staff", academic_year: "2026-27", profile, policies: [], balances: [{ policy_id: "policy", code: "CASUAL", name: "Casual leave", annual_allowance: "12", adjustments: "0", used: "0", pending: "1" }], requests: [request], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], leave_review_readiness: ready };
const emptyImpact: StaffLeaveImpact = { state: "empty", as_of: "2026-10-26T09:00:00Z", time_zone: "Asia/Kolkata", starts_on: "2026-10-27", ends_on: "2026-10-27", portion: "full_day", items: [], total: 0, truncated: false, scope: "published_timetable_and_dated_responsibilities", limitations: ["This is published planned work, not physical attendance."], staff_profile_revision: 1, policy_revision: 1 };
const activity: StaffLeaveImpact["items"][number] = { id: "class:one:2026-10-27", kind: "class", date: "2026-10-27", starts_at: "09:00:00", ends_at: "10:00:00", title: "Programming lab", location: "Lab 203", class_label: "BCA A", source: { kind: "schedule", id: "class-one", revision: 2, version: 1 } };

function mount({ data = workspace, actor = "requester", review = false, path = "/areas/responsibilities/leave", refresh = vi.fn().mockResolvedValue(undefined) }: { data?: TeacherStaffWorkspace; actor?: string; review?: boolean; path?: string; refresh?: () => Promise<void> } = {}) {
  const page = (current: TeacherStaffWorkspace) => review
    ? <AuthorizedStaffLeaveDecisionPage schoolId="campus" actorId={actor} requestId={request.id} data={current} refresh={refresh} />
    : <StaffOperationsPage portal="teacher" schoolId="campus" actorId={actor} data={current} refresh={refresh} />;
  const result = render(<MemoryRouter initialEntries={[path]}>{page(data)}</MemoryRouter>);
  return { ...result, refresh, replaceData: (next: TeacherStaffWorkspace) => result.rerender(<MemoryRouter initialEntries={[path]}>{page(next)}</MemoryRouter>) };
}

beforeEach(() => {
  vi.clearAllMocks(); clearPendingStaffLeaveCommandsForTests();
  vi.mocked(rerouteStaffLeave).mockResolvedValue({ ...request, revision: 4 });
  vi.mocked(enableLeaveReviewRouting).mockResolvedValue({ confirmed: true, replayed: false });
  vi.mocked(previewStaffLeaveImpact).mockResolvedValue(emptyImpact);
});
afterEach(() => { cleanup(); clearPendingStaffLeaveCommandsForTests(); });

describe("staff leave review routing", () => {
  it("uses affected work for pending and rejected requests before native cover tasks exist", () => {
    for (const status of ["submitted", "rejected"] as const) {
      mount({ data: { ...workspace, can_review_staff_leave: true, requests: [{ ...request, status, coverage_tasks: 0, affected_periods: 2 }] }, review: true, actor: currentReviewer.user_id });
      expect(screen.getByText("2 classes or shifts")).toBeVisible();
      expect(screen.queryByText("0 classes or shifts")).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("previews concrete dated work only after valid policy, dates and day portion are available", async () => {
    vi.mocked(previewStaffLeaveImpact).mockResolvedValue({ ...emptyImpact, state: "ready", items: [activity], total: 1 });
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-27" } });
    expect(previewStaffLeaveImpact).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-27" } });
    expect(await screen.findByText("Programming lab")).toBeVisible();
    expect(screen.getByText(/09:00–10:00 · BCA A · Lab 203/)).toBeVisible();
    expect(vi.mocked(previewStaffLeaveImpact).mock.calls[0]?.[1]).toEqual({ policy_id: "policy", starts_on: "2026-10-27", ends_on: "2026-10-27", portion: "full_day" });
    expect(screen.getByText("Preview only. Approval checks the current work again.")).toBeVisible();
    expect(screen.getByText(emptyImpact.limitations[0]!)).not.toBeVisible();
    expect(submitStaffLeave).not.toHaveBeenCalled();
  });

  it("does not turn an unavailable preview into zero work or block an otherwise valid submission", async () => {
    vi.mocked(previewStaffLeaveImpact).mockRejectedValueOnce(new TypeError("Service unavailable"));
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "Keep this draft");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-27" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-27" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t check affected work");
    expect(screen.queryByText("No published classes or dated duties found.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry work preview" }));
    expect(await screen.findByText("No published classes or dated duties found.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue("Keep this draft");
  });

  it("ignores late preview responses after dates change and keeps an in-flight preview informational", async () => {
    let first!: (value: StaffLeaveImpact) => void;
    let second!: (value: StaffLeaveImpact) => void;
    vi.mocked(previewStaffLeaveImpact).mockReturnValueOnce(new Promise(done => { first = done; })).mockReturnValueOnce(new Promise(done => { second = done; }));
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-27" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-27" } });
    await waitFor(() => expect(previewStaffLeaveImpact).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Checking published classes");
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-28" } });
    await waitFor(() => expect(previewStaffLeaveImpact).toHaveBeenCalledTimes(2));
    await act(() => Promise.resolve(first({ ...emptyImpact, state: "ready", items: [activity], total: 1 })));
    expect(screen.queryByText("Programming lab")).not.toBeInTheDocument();
    await act(() => Promise.resolve(second({ ...emptyImpact, ends_on: "2026-10-28" })));
    expect(await screen.findByText("No published classes or dated duties found.")).toBeVisible();
  });

  it("keeps large previews finite and discloses a truncated source rather than presenting a complete list", async () => {
    vi.mocked(previewStaffLeaveImpact).mockResolvedValue({ ...emptyImpact, state: "ready", total: 9, truncated: true, items: Array.from({ length: 6 }, (_, index) => ({ ...activity, id: `class-${index}`, title: `Class ${index + 1}` })) });
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-27" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-27" } });
    expect(await screen.findByText("Class 4")).toBeVisible();
    expect(screen.queryByText("Class 5")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 6 of 9 affected activities.")).toBeVisible();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Affected work pages" })).getByRole("button", { name: "Next" }));
    expect(screen.getByText("Class 5")).toBeVisible();
    expect(screen.queryByText("Class 1")).not.toBeInTheDocument();
  });

  it("gives staff an honest empty-policy handoff without granting setup access", () => {
    mount({ data: { ...workspace, balances: [] }, path: "/areas/responsibilities/leave?create=leave" });
    expect(screen.getByText("Ask a campus administrator to make a leave policy available.")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Leave type" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Open leave settings" })).not.toBeInTheDocument();
  });

  it("links an existing admin workspace to its native leave settings when no active policy exists", () => {
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [], onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [], references: { classes: [], subjects: [], events: [] } };
    render(<MemoryRouter><StaffOperationsWorkspacePage surface="leave" schoolId="campus" actorId="admin" data={data} refresh={async () => {}} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Open leave settings" })).toHaveAttribute("href", "/more/setup/responsibilities?section=policies");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("embeds the exact approved leave's cover only for an existing admin workspace", () => {
    const approved = { ...request, status: "approved" as const, coverage_open: 1 };
    const cover: CoverageTask = { id: "cover-one", leave_request_id: request.id, absent_staff_profile_id: profile.id, replacement_staff_profile_id: null,
      absent_first_name: profile.first_name, absent_last_name: profile.last_name, absent_designation: profile.designation,
      replacement_first_name: null, replacement_last_name: null, replacement_user_id: null, class_name: "BCA A", subject_name: "Programming",
      duty_date: request.starts_on, period_number: 1, starts_at: "09:00", ends_at: "10:00", title: "Programming lab", location: "Lab 203",
      status: "open", handover_note: "", response_note: "", revision: 2 };
    const data: AdminStaffWorkspace = { mode: "admin", academic_year: "2026-27", profiles: [profile], onboarding_items: [], policies: [], balances: [], requests: [approved], work_types: [], responsibility_types: [], assignments: [], coverage_tasks: [cover, { ...cover, id: "other-cover", leave_request_id: "unrelated-leave", title: "Another person's activity" }], references: { classes: [], subjects: [], events: [] } };
    render(<MemoryRouter initialEntries={["/areas/responsibilities/leave?request=leave-1"]}><StaffOperationsWorkspacePage surface="leave" schoolId="campus" actorId="admin" data={data} refresh={async () => {}} /></MemoryRouter>);
    expect(document.querySelector("#attention-leave-1")).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Cover for this leave" })).toBeVisible();
    expect(screen.getByText("Programming lab")).toBeVisible();
    expect(screen.queryByText("Another person's activity")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Arrange cover" })).not.toBeInTheDocument();
    cleanup();
    mount({ data: { ...workspace, can_review_staff_leave: true, requests: [approved] }, review: true, actor: currentReviewer.user_id });
    expect(screen.queryByRole("link", { name: "Arrange cover" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cover for this leave" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask a campus administrator to arrange the remaining cover.")).toBeVisible();
  });

  it("keeps personal leave history compact and opens its policy, duration, decision and coverage on demand", async () => {
    const approved = { ...request, status: "approved" as const, decision_note: "Cover is arranged.", coverage_filled: 1 };
    const withdrawn = { ...request, id: "withdrawn-leave", policy_name: "Medical leave", status: "withdrawn" as const, reason: "Plans have changed" };
    mount({ data: { ...workspace, requests: [approved, withdrawn] } });
    const details = document.querySelector<HTMLDetailsElement>("#attention-leave-1")!;
    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent("Casual leave");
    expect(details.querySelector("summary")).not.toHaveTextContent("Kavita Mehta");
    expect(within(details).getByText("A family appointment")).not.toBeVisible();
    expect(document.querySelector("#attention-withdrawn-leave")).not.toHaveAttribute("open");
    await userEvent.click(within(details).getByText("Casual leave"));
    expect(within(details).getByText("A family appointment")).toBeVisible();
    expect(within(details).getByText("1 day")).toBeVisible();
    expect(within(details).getByText("1 class or shift")).toBeVisible();
    expect(within(details).getByText("Decision: Cover is arranged.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).not.toBeInTheDocument();
  });

  it("opens the attention-focused personal history record and labels active coverage as activities", () => {
    mount({ data: { ...workspace, requests: [{ ...request, status: "approved" }] }, path: "/areas/responsibilities/leave?request=leave-1" });
    expect(document.querySelector("#attention-leave-1")).toHaveAttribute("open");
    expect(screen.getByText("A family appointment")).toBeVisible();
    cleanup();
    mount();
    expect(screen.getByText("1 activity")).toBeVisible();
    expect(document.querySelector(".staff-request--personal")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeVisible();
    expect(screen.queryByText("DURATION")).not.toBeInTheDocument();
    expect(screen.queryByText("COVERAGE")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 periods?/)).not.toBeInTheDocument();
  });

  it("keeps decided names and dates wrapping with status below the copy on narrow phones", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/staff-operations/staff-operations.css"), "utf8");
    const copy = css.match(/\.staff-request__summary-copy strong, \.staff-request__summary-copy small \{([^}]+)\}/)?.[1];
    expect(copy).toContain("white-space: normal");
    expect(copy).toContain("overflow-wrap: anywhere");
    expect(copy).not.toMatch(/ellipsis|overflow:\s*hidden/);
    expect(css).toContain(".staff-my-requests .staff-request--personal > header { display: grid; grid-template-columns: 36px minmax(0, 1fr);");
    expect(css).toContain(".staff-my-requests .staff-request--personal > header > .staff-status { grid-column: 2; justify-self: start; margin: 0;");
    expect(css).toContain(".staff-request--decided > summary > .staff-status { grid-column: 2; grid-row: 2;");
    expect(css).toContain(".staff-page .workspace-sections { display: flex; flex-wrap: wrap; gap: 8px;");
    expect(css).toContain('.staff-page .workspace-sections a[aria-current="page"]');
    expect(css).toContain(".staff-request__dates { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;");
  });

  it("lets an exact staff reviewer enable routing and decide through the existing Review view", async () => {
    const readiness = { state: "needs_configuration" as const, reviewer: currentReviewer, reason: "Review delivery is not enabled.", can_configure: true };
    const currentRequest = { ...request, review_route: { state: "current" as const, reviewer: currentReviewer, current_reviewer: currentReviewer, can_reroute: false } };
    const data = { ...workspace, profile: { ...profile, id: "reviewer-profile", user_id: currentReviewer.user_id }, can_review_staff_leave: true, leave_review_readiness: readiness, requests: [currentRequest] };
    vi.mocked(getLeaveReviewRouting).mockResolvedValue({ ...readiness, expected: basis });
    vi.mocked(decideStaffLeave).mockResolvedValue({ ...currentRequest, status: "approved", revision: 4 });
    const view = mount({ data, actor: currentReviewer.user_id });
    expect(screen.getByRole("link", { name: "To review", exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "To review", exact: true }));
    expect(screen.getByRole("heading", { name: "Staff leave" })).toBeVisible();
    expect(screen.getByRole("link", { name: "To review", exact: true })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enable review requests" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and enable" }));
    await waitFor(() => expect(enableLeaveReviewRouting).toHaveBeenCalledTimes(1));
    view.replaceData({ ...data, leave_review_readiness: ready });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decideStaffLeave).toHaveBeenCalledTimes(1));
    expect(vi.mocked(decideStaffLeave).mock.calls[0]?.slice(0, 2)).toEqual(["campus", "leave-1"]);
    expect(vi.mocked(decideStaffLeave).mock.calls[0]?.[2].decision).toBe("approved");
    expect(vi.mocked(decideStaffLeave).mock.calls[0]?.[2].expected_revision).toBe(3);
    expect(screen.queryByRole("button", { name: "Apply for leave" })).not.toBeInTheDocument();
  });

  it("does not expose Review to ordinary staff or grant it from a URL parameter", () => {
    mount({ path: "/areas/responsibilities/leave?view=review" });
    expect(screen.queryByRole("link", { name: "To review", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Leave sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My leave" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable review requests" })).not.toBeInTheDocument();
  });

  it("shows the actual waiting reviewer and a clear changed-route action for the requester", async () => {
    mount();
    expect(screen.getByText("Reviewer changed")).toBeVisible();
    expect(screen.getByText(/Previously sent to Former reviewer. Nisha Rao is now responsible./)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send to current reviewer" }));
    await waitFor(() => expect(rerouteStaffLeave).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rerouteStaffLeave).mock.calls[0]?.slice(0, 2)).toEqual(["campus", "leave-1"]);
    expect(vi.mocked(rerouteStaffLeave).mock.calls[0]?.[2].expected_revision).toBe(3);
    expect(vi.mocked(rerouteStaffLeave).mock.calls[0]?.[2].command_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires the new reviewer to take over before exposing a decision", async () => {
    const data = { ...workspace, can_review_staff_leave: true };
    const view = mount({ data, actor: currentReviewer.user_id, review: true });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Take over review" }));
    await waitFor(() => expect(rerouteStaffLeave).toHaveBeenCalledTimes(1));
    view.replaceData({ ...data, requests: [{ ...request, revision: 4, review_route: { state: "current", reviewer: currentReviewer, current_reviewer: currentReviewer, can_reroute: false } }] });
    expect(screen.getByText("Nisha Rao")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(decideStaffLeave).not.toHaveBeenCalled();
  });

  it("does not grant the former reviewer a decision or takeover action", () => {
    mount({ data: { ...workspace, can_review_staff_leave: true, requests: [{ ...request, review_route: { ...request.review_route!, can_reroute: false } }] }, actor: priorReviewer.user_id, review: true });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take over review" })).not.toBeInTheDocument();
  });

  it("replays an unknown reroute with the same command and blocks competing withdrawal", async () => {
    vi.mocked(rerouteStaffLeave).mockRejectedValueOnce(new TypeError("response lost"));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Send to current reviewer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeDisabled();
    const first = vi.mocked(rerouteStaffLeave).mock.calls[0]![2];
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(rerouteStaffLeave).toHaveBeenCalledTimes(2));
    expect(vi.mocked(rerouteStaffLeave).mock.calls[1]![2]).toEqual(first);
  });

  it("refreshes only the read after a confirmed reroute whose refresh failed", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(undefined);
    mount({ refresh }); await userEvent.click(screen.getByRole("button", { name: "Send to current reviewer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The request was sent to the current reviewer.");
    expect(screen.getByRole("button", { name: "Send to current reviewer" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(rerouteStaffLeave).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh read after stale revision rather than silently retrying a changed write", async () => {
    vi.mocked(rerouteStaffLeave).mockRejectedValueOnce(new ApiError("This request changed", 409));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Send to current reviewer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This request changed");
    expect(screen.queryByRole("button", { name: "Retry same action" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
    expect(rerouteStaffLeave).toHaveBeenCalledTimes(1);
  });

  it("locks every request action while a reroute is in flight", async () => {
    let resolve!: (value: StaffLeaveRequest) => void;
    vi.mocked(rerouteStaffLeave).mockReturnValue(new Promise(done => { resolve = done; }));
    mount({ data: { ...workspace, requests: [request, { ...request, id: "leave-2" }] } });
    await userEvent.click(screen.getAllByRole("button", { name: "Send to current reviewer" })[0]!);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    await act(() => Promise.resolve(resolve({ ...request, revision: 4 })));
  });

  it("preserves an entered leave draft while setup is handed to the reviewer", async () => {
    const data = { ...workspace, leave_review_readiness: { state: "needs_configuration" as const, reviewer: currentReviewer, reason: "Review delivery is not enabled.", can_configure: true } };
    vi.mocked(getLeaveReviewRouting).mockResolvedValue({ ...data.leave_review_readiness, expected: basis });
    const view = mount({ data, path: "/areas/responsibilities/leave?create=leave" });
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "A family appointment");
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enable review requests" })).not.toBeInTheDocument();
    expect(getLeaveReviewRouting).not.toHaveBeenCalled();
    expect(enableLeaveReviewRouting).not.toHaveBeenCalled();
    view.replaceData({ ...data, leave_review_readiness: ready });
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue("A family appointment");
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    expect(submitStaffLeave).not.toHaveBeenCalled();
  });

  it("shows unavailable review without pretending an ordinary staff member can configure it", () => {
    mount({ data: { ...workspace, leave_review_readiness: { state: "unavailable", reason: "Ask the campus leave authority to appoint a reviewer.", reviewer: null, can_configure: false } }, path: "/areas/responsibilities/leave?create=leave" });
    expect(screen.getByText("Ask the campus leave authority to appoint a reviewer.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enable review requests" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reason" })).toBeEnabled();
  });

  it("retains the exact route-setup confirmation after response loss", async () => {
    const readiness = { state: "needs_configuration" as const, reviewer: currentReviewer, reason: "Review delivery is not enabled.", can_configure: true };
    vi.mocked(getLeaveReviewRouting).mockResolvedValue({ ...readiness, expected: basis });
    vi.mocked(enableLeaveReviewRouting).mockRejectedValueOnce(new TypeError("response lost"));
    mount({ data: { ...workspace, profile: { ...profile, id: "reviewer-profile", user_id: currentReviewer.user_id },
      can_review_staff_leave: true, leave_review_readiness: readiness }, actor: currentReviewer.user_id,
      path: "/areas/responsibilities/leave?view=review" });
    await userEvent.click(screen.getByRole("button", { name: "Enable review requests" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and enable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByRole("button", { name: "Cancel setup" })).toBeDisabled();
    const original = vi.mocked(enableLeaveReviewRouting).mock.calls[0]![1];
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(enableLeaveReviewRouting).toHaveBeenCalledTimes(2));
    expect(vi.mocked(enableLeaveReviewRouting).mock.calls[1]![1]).toEqual(original);
    expect(screen.getByRole("heading", { name: "Staff leave" })).toBeVisible();
  });

  it("keeps a submitted draft locked after response loss and retries only its original material", async () => {
    vi.mocked(submitStaffLeave).mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(request);
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-27" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-27" } });
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "A family appointment");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByRole("textbox", { name: "Reason" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const original = vi.mocked(submitStaffLeave).mock.calls[0]![1];
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(submitStaffLeave).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitStaffLeave).mock.calls[1]![1]).toEqual(original);
  });

  it("does not invent missing readiness for legacy response fixtures", () => {
    mount({ data: { ...workspace, leave_review_readiness: undefined }, path: "/areas/responsibilities/leave?create=leave" });
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    expect(screen.queryByText("Leave review needs setup")).not.toBeInTheDocument();
  });

  it("shows only the selected leave type's usable balance, deducting pending days without adding other policies", async () => {
    mount({ data: { ...workspace, balances: [workspace.balances[0]!, {
      policy_id: "medical", code: "MEDICAL", name: "Medical leave", annual_allowance: "30", adjustments: "2", used: "3", pending: "4",
    }] }, path: "/areas/responsibilities/leave?create=leave" });
    expect(screen.getByText("11 days available · 1 pending")).toBeVisible();
    expect(screen.queryByText(/40 days available|41 days available/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Leave type/ }), "medical");
    expect(screen.getByText("25 days available · 4 pending")).toBeVisible();
    expect(screen.queryByText("11 days available · 1 pending")).not.toBeInTheDocument();
  });

  it("defaults to full-day leave while keeping half-day and handover controls secondary", async () => {
    mount({ path: "/areas/responsibilities/leave?create=leave" });
    const portion = screen.getByLabelText("Day type");
    expect(portion).toHaveValue("full_day");
    expect(portion).not.toBeVisible();
    expect(screen.getByLabelText("Handover note")).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "Reason" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Send request" })).toBeVisible();
    await userEvent.click(screen.getByText("Half-day or handover", { selector: "summary" }));
    expect(portion).toBeVisible();
    expect(screen.getByLabelText("Handover note")).toBeVisible();
    expect(submitStaffLeave).not.toHaveBeenCalled();
  });

  it("asks for a decline reason only after Decline, and never sends an empty rejection", async () => {
    const currentRequest = { ...request, review_route: { state: "current" as const, reviewer: currentReviewer, current_reviewer: currentReviewer, can_reroute: false } };
    vi.mocked(decideStaffLeave).mockResolvedValue({ ...currentRequest, status: "rejected", revision: 4 });
    mount({ data: { ...workspace, can_review_staff_leave: true, requests: [currentRequest] }, actor: currentReviewer.user_id, review: true });
    expect(screen.queryByRole("textbox", { name: "Reason for declining" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Decline", exact: true }));
    const reason = screen.getByRole("textbox", { name: "Reason for declining" });
    expect(reason).toBeVisible();
    expect(reason).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline request" })).toBeDisabled();
    expect(decideStaffLeave).not.toHaveBeenCalled();
    await userEvent.type(reason, "Required laboratory duty cannot be reassigned that day");
    await userEvent.click(screen.getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(decideStaffLeave).toHaveBeenCalledTimes(1));
    expect(decideStaffLeave).toHaveBeenCalledWith("campus", request.id, expect.objectContaining({
      decision: "rejected", note: "Required laboratory duty cannot be reassigned that day", expected_revision: 3,
    }));
  });

  it("loads a reviewer's concrete work only on request and retains the exact leave revision and identity", async () => {
    const currentRequest = { ...request, review_route: { state: "current" as const, reviewer: currentReviewer, current_reviewer: currentReviewer, can_reroute: false } };
    const otherRequest = { ...currentRequest, id: "someone-else", staff_profile_id: "another-person", reason: "Private unrelated request" };
    const data = { ...workspace, can_review_staff_leave: true, requests: [currentRequest, otherRequest] };
    vi.mocked(getStaffWorkspace).mockResolvedValue({ ...data, requests: [
      { ...currentRequest, affected_work: { ...emptyImpact, state: "ready", total: 1, items: [activity] } },
      { ...otherRequest, affected_work: { ...emptyImpact, state: "ready", total: 1, items: [{ ...activity, id: "unrelated", title: "Private unrelated activity" }] } },
    ] });
    mount({ data, actor: currentReviewer.user_id, review: true });
    expect(getStaffWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByText("Private unrelated request")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("View affected activities", { selector: "summary" }));
    expect(await screen.findByText("Programming lab")).toBeVisible();
    expect(getStaffWorkspace).toHaveBeenCalledExactlyOnceWith("campus", request.id);
    expect(screen.queryByText("Private unrelated activity")).not.toBeInTheDocument();
    expect(decideStaffLeave).not.toHaveBeenCalled();
  });
});
