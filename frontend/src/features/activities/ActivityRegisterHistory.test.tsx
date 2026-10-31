import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ActivityRegisterHistory, attendanceActivityTitle, attendanceHistoryStatus } from "./ActivityRegisterHistory";
import { getActivityRegisterHistoryActivities, getActivityRegisterHistoryEvidence, type ActivityRegister, type AttendanceHistoryActivity } from "./api";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getActivityRegisterHistoryActivities: vi.fn(), getActivityRegisterHistoryEvidence: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const batch: AttendanceHistoryActivity = { id: "batch-one", action: "marks", actor_name: "Meera Kapoor", recorded_at: "2026-10-20T18:29:00Z",
  reason: "Initial participation decision", people_count: 25, decision_count: 25, correction_count: 0, note_count: 0,
  status_counts: { present: 25 }, person_name: null, previous_status: null, status: null };
const register = { id: "register-1", occurrence_id: "occurrence-1", title: "Art & design", kind: "training", starts_at: "2026-10-20T17:00:00Z",
  ends_at: "2026-10-20T19:00:00Z", time_zone: "Asia/Kolkata", place_label: null, state: "draft" as const, revision: 1,
  submitted_at: null, finalized_at: null, policy_revision: 1 };
function mount(historyRegister: ActivityRegister["register"] = register) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter>
    <ActivityRegisterHistory schoolId="school-1" register={historyRegister} onClose={vi.fn()} />
  </MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
describe("recorder-oriented attendance history", () => {
  it.each([
    { label: "same-day session", overrides: { starts_at: "2026-10-20T13:50:00Z", ends_at: "2026-10-20T14:50:00Z" }, expected: "Oct 20, 2026 · 7:20 PM–8:20 PM" },
    { label: "overnight session", overrides: {}, expected: "Oct 20, 2026 · 10:30 PM–12:30 AM · ends Oct 21" },
    { label: "daily register", overrides: { source_kind: "daily_class" as const, starts_at: "2026-10-19T18:30:00Z", ends_at: "2026-10-20T18:30:00Z" }, expected: "Daily register · Oct 20, 2026" },
  ])("identifies the $label by its campus-local date without duplicating its interval", async ({ overrides, expected }) => {
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 0, total_pages: 1, activities: [] });
    mount({ ...register, ...overrides });
    expect(screen.getByText(expected)).toBeVisible();
    expect(await screen.findByText("No attendance activity has been saved yet.")).toBeVisible();
  });
  it("summarizes the complete 25-person activity instead of repeating one decision per row", async () => {
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 1, total_pages: 1, activities: [batch] });
    mount();
    expect(await screen.findByText("Meera Kapoor marked 25 people present")).toBeVisible();
    expect(screen.getByText("1 activity")).toBeVisible();
    expect(screen.queryByText("Initial participation decision")).not.toBeInTheDocument();
    expect(screen.queryByText(/Revision/)).not.toBeInTheDocument();
    expect(getActivityRegisterHistoryEvidence).not.toHaveBeenCalled();
    expect(screen.getByText(/Oct 20, 2026/, { selector: "li > time" })).toHaveTextContent(/11:59/);
  });
  it("keeps full-batch counts separate from finite individual evidence pages and retains original records", async () => {
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 1, total_pages: 1, activities: [batch] });
    vi.mocked(getActivityRegisterHistoryEvidence).mockImplementation((_school, _register, _batch, page = 1) => Promise.resolve({
      page, page_size: 20, total: 26, total_pages: 2, history: [{ id: `decision:${page}`, action: "decision", person_id: `person-${page}`, name: page === 1 ? "Aarav Sharma" : "Mira Khan",
        previous_status: null, status: "present", previous_remarks: null, remarks: "Recorded from roll call", reason: "Initial participation decision", actor_name: "Meera Kapoor",
        recorded_at: batch.recorded_at, recorded_at_exact: "2026-10-20T18:29:00.123456+00:00", register_revision: 1, capture_channel: "human_roll_call", observed_at: null }] }));
    mount();
    await userEvent.click(await screen.findByText("View 25 people & evidence"));
    expect(await screen.findByText("Aarav Sharma")).toBeVisible();
    expect(screen.getByText(/Counts above include the whole activity/)).toBeVisible();
    expect(screen.getByText("Meera Kapoor marked 25 people present")).toBeVisible();
    await userEvent.click(screen.getByText("Original record"));
    expect(screen.getByText("Initial participation decision")).toBeVisible();
    expect(screen.getByText("2026-10-20T18:29:00.123456+00:00")).toBeVisible();
    expect(screen.getByText("Register revision")).toBeVisible();
    const pages = screen.getByRole("navigation", { name: "evidence entries pages" });
    expect(pages).toHaveTextContent("Page 1 of 2 · 26 evidence entries");
    await userEvent.click(within(pages).getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Mira Khan")).toBeVisible();
    expect(getActivityRegisterHistoryEvidence).toHaveBeenLastCalledWith("school-1", "register-1", "batch-one", 2);
    expect(screen.getByText("Meera Kapoor marked 25 people present")).toBeVisible();
  });
  it("makes a correction's person, old/new status and reason immediately meaningful", async () => {
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 1, total_pages: 1,
      activities: [{ ...batch, people_count: 1, decision_count: 1, correction_count: 1, status_counts: { late: 1 }, person_name: "Aarav Sharma",
        previous_status: "absent", status: "late", reason: "Arrival confirmed by the recorder" }] });
    mount();
    expect(await screen.findByText("Meera Kapoor corrected attendance for Aarav Sharma")).toBeVisible();
    expect(screen.getByText("Absent → Late")).toBeVisible();
    expect(screen.getByText("Arrival confirmed by the recorder")).toBeVisible();
    expect(screen.queryByText(/Revision/)).not.toBeInTheDocument();
  });
  it("pages activities independently and hides cached history after authorization is denied", async () => {
    vi.mocked(getActivityRegisterHistoryActivities).mockImplementation((_school, _register, page = 1) => Promise.resolve({ page, page_size: 8,
      total: 9, total_pages: 2, activities: [{ ...batch, id: `batch-${page}`, action: page === 1 ? "submit" : "reopen", reason: page === 1 ? null : "Coordinator requested review" }] }));
    const client = mount();
    expect(await screen.findByText("Meera Kapoor submitted the register")).toBeVisible();
    await userEvent.click(within(screen.getByRole("navigation", { name: "activities pages" })).getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Meera Kapoor reopened the register for correction")).toBeVisible();
    expect(getActivityRegisterHistoryActivities).toHaveBeenLastCalledWith("school-1", "register-1", 2);
    vi.mocked(getActivityRegisterHistoryActivities).mockRejectedValue(new ApiError("Access ended", 403));
    await client.invalidateQueries();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Attendance history could not be loaded"));
    expect(screen.queryByText("Meera Kapoor reopened the register for correction")).not.toBeInTheDocument();
  });
  it("uses readable status/lifecycle wording without inferring actors or unknown actions", () => {
    expect(attendanceHistoryStatus("half_day")).toBe("Half day");
    expect(attendanceHistoryStatus("checked_out")).toBe("Checked out");
    expect(attendanceHistoryStatus(null)).toBe("Not recorded");
    expect(attendanceActivityTitle({ ...batch, action: "automatic_finalize", actor_name: "Configured automatic decision" })).toContain("finalized automatically");
    expect(attendanceActivityTitle({ ...batch, decision_count: 0, action: "legacy_unknown", actor_name: "Unknown recorded actor" }))
      .toBe("Unknown recorded actor recorded an attendance update");
  });
});
