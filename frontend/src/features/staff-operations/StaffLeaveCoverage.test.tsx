import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { assignCoverage, type AdminStaffWorkspace, type CoverageTask, type StaffProfile } from "./api";
import { CoverageBoard } from "./StaffLeaveCoverage";

vi.mock("./api", async original => ({ ...(await original<typeof import("./api")>()), assignCoverage: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const absent: StaffProfile = {
  id: "aditi", user_id: "aditi-account", staff_code: "S-1", first_name: "Aditi", last_name: "Menon",
  email: "", phone: "", staff_kind: "teaching", designation: "Lecturer", department: "IT",
  employment_type: "full_time", joined_on: "2026-04-01", status: "active", revision: 1,
};
const colleague: StaffProfile = { ...absent, id: "dhruv", user_id: "dhruv-account", first_name: "Dhruv", last_name: "Anand" };
const task: CoverageTask = {
  id: "it502", leave_request_id: "leave-aditi", absent_staff_profile_id: absent.id,
  replacement_staff_profile_id: null, absent_first_name: absent.first_name, absent_last_name: absent.last_name,
  absent_designation: absent.designation, replacement_first_name: null, replacement_last_name: null,
  replacement_user_id: null, class_name: "IT 502", subject_name: "Programming", duty_date: "2026-10-27",
  period_number: 2, starts_at: "11:30", ends_at: "13:30", title: "Programming practical", location: "A103",
  status: "open", handover_note: "Continue linked lists", response_note: "", revision: 4,
};
const workspace = (tasks: CoverageTask[] = [task]): AdminStaffWorkspace => ({
  mode: "admin", academic_year: "2026-27", profiles: [absent, colleague,
    { ...colleague, id: "inactive", first_name: "Inactive", status: "inactive" },
    { ...colleague, id: "passive", first_name: "Passive", user_id: null }],
  onboarding_items: [], policies: [], balances: [], requests: [], work_types: [], responsibility_types: [],
  assignments: [], coverage_tasks: tasks, references: { classes: [], subjects: [], events: [] },
});

function board(data = workspace(), refresh = vi.fn().mockResolvedValue(undefined), embedded = true) {
  return render(<ExecutionEnvironmentProvider environment={{ mode: "live" }}>
    <CoverageBoard schoolId="aaranya" data={data} refresh={refresh} embedded={embedded} leaveRequestId={embedded ? "leave-aditi" : undefined} />
  </ExecutionEnvironmentProvider>);
}

describe("Leave coverage in context", () => {
  it("selects without sending and offers only after the explicit action, using the current revision", async () => {
    const user = userEvent.setup();
    vi.mocked(assignCoverage).mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue(undefined);
    board(workspace(), refresh);
    expect(screen.getByRole("heading", { name: "Cover for this leave" })).toBeVisible();
    const select = screen.getByRole("combobox", { name: "Cover teacher for Programming practical" });
    expect(within(select).queryByRole("option", { name: /Aditi|Inactive|Passive/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offer cover" })).toBeDisabled();
    await user.selectOptions(select, colleague.id);
    expect(assignCoverage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Offer cover" }));
    expect(assignCoverage).toHaveBeenCalledExactlyOnceWith("aaranya", task.id, {
      replacement_staff_profile_id: colleague.id, note: "Cover offered by school office.", expected_revision: 4,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows only the exact leave's records, including accepted cover and its retained replacement", () => {
    const accepted: CoverageTask = { ...task, id: "accepted", title: "Tutorial", status: "accepted", revision: 6,
      replacement_staff_profile_id: colleague.id, replacement_user_id: colleague.user_id,
      replacement_first_name: colleague.first_name, replacement_last_name: colleague.last_name };
    board(workspace([task, accepted, { ...task, id: "unrelated", leave_request_id: "leave-other", title: "Unrelated activity" }]));
    expect(screen.getByText("Programming practical")).toBeVisible();
    expect(screen.getByText("Tutorial")).toBeVisible();
    expect(screen.getByText("Cover accepted")).toBeVisible();
    expect(screen.getByText("Replacement: Dhruv Anand")).toBeVisible();
    expect(screen.queryByText("Unrelated activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage history")).not.toBeInTheDocument();
  });

  it("keeps standalone resolved records in history without claiming they are open", async () => {
    board(workspace([{ ...task, status: "expired_unconfirmed", fallback_label: "No outcome recorded" }]), undefined, false);
    expect(screen.getByRole("heading", { name: "Leave coverage" })).toBeVisible();
    expect(screen.getByText("0 need cover")).toBeVisible();
    expect(screen.getByText("No uncovered classes or shifts.")).toBeVisible();
    await userEvent.click(screen.getByText("Coverage history"));
    expect(screen.getByText("Unconfirmed")).toBeVisible();
    expect(screen.getByText("No outcome recorded")).toBeVisible();
  });

  it("does not repeat a saved offer when its refresh fails; recovery only reads", async () => {
    const user = userEvent.setup();
    vi.mocked(assignCoverage).mockResolvedValue({});
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValue(undefined);
    board(workspace(), refresh);
    await user.selectOptions(screen.getByRole("combobox"), colleague.id);
    await user.click(screen.getByRole("button", { name: "Offer cover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The offer was saved");
    expect(screen.queryByRole("button", { name: "Offer cover" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(assignCoverage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Offer saved");
  });

  it.each([
    [new Error("Connection lost"), "The offer result is unconfirmed"],
    [new ApiError("This activity changed", 409), "Refresh before offering cover"],
  ])("requires refresh-only recovery for an unknown or stale command result", async (cause, message) => {
    const user = userEvent.setup();
    vi.mocked(assignCoverage).mockRejectedValue(cause);
    const refresh = vi.fn().mockResolvedValue(undefined);
    board(workspace(), refresh);
    await user.selectOptions(screen.getByRole("combobox"), colleague.id);
    await user.click(screen.getByRole("button", { name: "Offer cover" }));
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    await user.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(assignCoverage).toHaveBeenCalledTimes(1);
  });

  it("retains a rejected choice for correction without treating a validation failure as saved", async () => {
    vi.mocked(assignCoverage).mockRejectedValue(new ApiError("Dhruv has a timetable clash", 400));
    board();
    await userEvent.selectOptions(screen.getByRole("combobox"), colleague.id);
    await userEvent.click(screen.getByRole("button", { name: "Offer cover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("timetable clash");
    expect(screen.getByRole("combobox")).toHaveValue(colleague.id);
    expect(screen.getByRole("button", { name: "Offer cover" })).toBeEnabled();
    expect(screen.queryByText("Offer saved")).not.toBeInTheDocument();
  });

  it("locks selection and repeated activation while the offer is in flight", async () => {
    let resolveOffer!: (value: object) => void;
    vi.mocked(assignCoverage).mockImplementation(() => new Promise(resolve => { resolveOffer = resolve; }));
    board();
    await userEvent.selectOptions(screen.getByRole("combobox"), colleague.id);
    await userEvent.click(screen.getByRole("button", { name: "Offer cover" }));
    expect(screen.getByRole("combobox")).toBeDisabled();
    const sending = screen.getByRole("button", { name: "Sending…" });
    expect(sending).toBeDisabled();
    await userEvent.click(sending);
    expect(assignCoverage).toHaveBeenCalledTimes(1);
    resolveOffer({});
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled());
  });

  it("fails closed when embedded without an exact leave identity, even with a focused task", () => {
    render(<CoverageBoard schoolId="aaranya" data={workspace()} refresh={vi.fn()} embedded focusCoverageId={task.id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cover duty unavailable");
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("uses the refreshed native status after an accepted offer rather than retaining stale offering controls", async () => {
    vi.mocked(assignCoverage).mockResolvedValue({});
    const view = board();
    await userEvent.selectOptions(screen.getByRole("combobox"), colleague.id);
    await userEvent.click(screen.getByRole("button", { name: "Offer cover" }));
    const offered: CoverageTask = { ...task, status: "offered", revision: 5,
      replacement_staff_profile_id: colleague.id, replacement_user_id: colleague.user_id,
      replacement_first_name: colleague.first_name, replacement_last_name: colleague.last_name };
    view.rerender(<ExecutionEnvironmentProvider environment={{ mode: "live" }}>
      <CoverageBoard schoolId="aaranya" data={workspace([offered])} refresh={vi.fn()} embedded leaveRequestId="leave-aditi" />
    </ExecutionEnvironmentProvider>);
    expect(screen.getByText("Awaiting reply")).toBeVisible();
    expect(screen.getByText("Offered to Dhruv Anand")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Offer cover" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh status" })).not.toBeInTheDocument();
    expect(assignCoverage).toHaveBeenCalledTimes(1);
  });

  it("does not carry a selected colleague into a different execution world", async () => {
    const view = board();
    await userEvent.selectOptions(screen.getByRole("combobox"), colleague.id);
    view.rerender(<ExecutionEnvironmentProvider environment={{ mode: "simulation", namespaceId: "isolated-leave",
      runId: "run-leave", virtualClock: { now: "2026-10-26T10:00:00Z", timeZone: "Asia/Kolkata" } }}>
      <CoverageBoard schoolId="aaranya" data={workspace()} refresh={vi.fn()} embedded leaveRequestId="leave-aditi" />
    </ExecutionEnvironmentProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Offer cover" })).toBeDisabled();
    expect(assignCoverage).not.toHaveBeenCalled();
  });
});
