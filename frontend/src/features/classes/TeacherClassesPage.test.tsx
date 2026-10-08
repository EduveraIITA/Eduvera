import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTeacherAttendance, getTeacherHome, type TeacherAttendanceResponse, type TeacherClassSummary } from "../operations/api";
import { getTeacherDay, type TeacherDay } from "../day-plans/api";
import { apiFetch } from "../../lib/api";
import TeacherClassesPage from "./TeacherClassesPage";
import TeacherClassPage from "./TeacherClassPage";
import { classStatus } from "./classWorkspace";

const access = vi.hoisted(() => ({ permissions: ["attendance.view", "attendance.record", "timetable.view"] }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ memberships: [{ school_id: "school-1", role: "staff", permissions: access.permissions }] }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, backTo, children }: { title: string; backTo?: string; children: ReactNode }) => <><h1>{title}</h1>{backTo ? <Link to={backTo}>Go back</Link> : null}{children}</> }));
vi.mock("../operations/api", () => ({ getTeacherHome: vi.fn(), getTeacherAttendance: vi.fn() }));
vi.mock("../day-plans/api", () => ({ getTeacherDay: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const cls: TeacherClassSummary = { class_section_id: "7a", class_name: "Class 7A", grade: "7", section: "A", room_number: "204", term_name: "Term 1", academic_year: "2026–27", starts_at: "09:00", ends_at: "09:45", student_count: 2, marked_count: 1, attending_count: 1, absent_count: 0, subjects: ["Mathematics"], submission_status: "in_progress", can_mark: true, instructional: true, date_open: true, periods_today: 1 };
const home = { date: "2026-10-08", teacher: { id: "teacher", name: "Meera", role: "staff" as const }, classes: [cls], weekly_timetable: [], home_actions: [] };
const register: TeacherAttendanceResponse = {
  date: "2026-10-08", class: { id: "7a", school_id: "school-1", term_id: "term", name: "Class 7A", grade: "7", section: "A", room: "204", board: "CBSE", term: "Term 1" },
  periods: [], register: { state: "draft", revision: 0, submitted_by: null, submitted_at: null, locked_by: null, locked_at: null },
  roster: [{ id: "student-1", name: "Ananya Iyer", roll_number: 1, admission_number: "CIS-001", avatar_url: "", status: "half_day", remarks: "", attendance_id: null, updated_at: null }, { id: "student-2", name: "Aarav Sharma", roll_number: 2, admission_number: "CIS-002", avatar_url: "", status: null, remarks: "", attendance_id: null, updated_at: null }],
  continuity_snapshot: { roster_fingerprint: "x", roster_count: 2, captured_at: "x", expires_at: "x", token: "x" }, latest_capture: null,
};
const day: TeacherDay = { date: "2026-10-08", context: { today: "2026-10-08", local_time: "09:00", timezone: "Asia/Kolkata", is_instructional: true, label: null }, periods: [{ id: "p1", class_section_id: "7a", class_name: "Class 7A", day_plan_id: null, plan_version: null, owner_name: null, period_number: 1, starts_at: "09:00", ends_at: "09:45", title: "Algebra", slot_type: "class", room: "204", teacher_user_id: "teacher", teacher_name: "Meera", cancelled: false, materials: ["Geometry kit"], notice: "Bring your workbook", coverage_status: "not_required", response_revision: 0, response_note: "", response_source: null, responded_at: null }] };

function show(path = "/teacher/classes?date=2026-10-08") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/teacher/classes" element={<TeacherClassesPage />} />
    <Route path="/teacher/classes/:classId" element={<TeacherClassPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  access.permissions = ["attendance.view", "attendance.record", "timetable.view"];
  vi.mocked(getTeacherHome).mockResolvedValue(home);
  vi.mocked(getTeacherAttendance).mockResolvedValue(register);
  vi.mocked(getTeacherDay).mockResolvedValue(day);
  vi.mocked(apiFetch).mockResolvedValue({ results: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("teacher class directory and detail pages", () => {
  it("shows lesson times and scoped activity links without treating recent notes as unread", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ results: [
      { id: "n", class_section_id: "7a", kind: "note", unread: false, total: 3 },
      { id: "c", class_section_id: "7a", kind: "comment", unread: false, total: 3 },
      { id: "s", class_section_id: "7a", kind: "change", unread: true, total: 3 },
      { id: "x", class_section_id: "another-class", kind: "comment", unread: false, total: 1 },
    ] });
    show();
    expect(await screen.findByText(/P1 9:00 AM–9:45 AM/)).toBeVisible();
    const activity = await screen.findByRole("link", { name: "1 recent comment · 1 recent note · 1 unread change" });
    expect(activity).toHaveAttribute("href", "/teacher/classes/7a?date=2026-10-08&section=notes");
    expect(screen.queryByText(/unread note|2 recent comments/)).not.toBeInTheDocument();
  });
  it("keeps cancelled lessons visible and reports activity failures without a false zero", async () => {
    vi.mocked(getTeacherDay).mockResolvedValue({ ...day, periods: [{ ...day.periods[0]!, cancelled: true }] });
    vi.mocked(apiFetch).mockRejectedValue(new Error("offline"));
    show();
    expect(await screen.findByText(/9:45 AM \(cancelled\)/)).toBeVisible();
    expect(await screen.findByText("Class updates are temporarily unavailable.")).toBeVisible();
    expect(screen.queryByText(/0 updates|No new updates/)).not.toBeInTheDocument();
  });
  it("marks only an explicitly reviewed schedule notification as read", async () => {
    const user = userEvent.setup();
    const update = { id: "notice", class_section_id: "7a", kind: "change", title: "Schedule changed", body: "Review period 1", occurred_at: "2026-10-08T08:00:00Z", unread: true, notification_id: "notification-1", total: 1 };
    vi.mocked(apiFetch).mockResolvedValue({ results: [update] });
    show("/teacher/classes/7a?date=2026-10-08&section=notes");
    await screen.findByRole("heading", { name: "Schedule changed" });
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/read/"), expect.anything());
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/read/") ? {} : { results: [{ ...update, unread: false }] }));
    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/notifications/notification-1/read/", { method: "POST" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument());
  });
  it("opens a separate class page and returns to the dated directory", async () => {
    const user = userEvent.setup(); show();
    const list = await screen.findByRole("list", { name: "Your classes" });
    expect(screen.queryByText("Assigned classes")).not.toBeInTheDocument();
    expect(getTeacherAttendance).not.toHaveBeenCalled();
    await waitFor(() => expect(getTeacherDay).toHaveBeenCalled());
    expect(within(list).getByRole("link")).toHaveAttribute("href", "/teacher/classes/7a?date=2026-10-08");
    await user.click(within(list).getByRole("link"));
    expect(await screen.findByRole("heading", { level: 1, name: "Class 7A" })).toBeVisible();
    expect(screen.queryByRole("list", { name: "Your classes" })).not.toBeInTheDocument();
    expect(await screen.findByText("CBSE")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Algebra" })).toBeVisible();
    expect(screen.getByText("Geometry kit", { exact: false })).toBeVisible();
    expect(screen.getByRole("link", { name: /Open register/ })).toHaveAttribute("href", "/teacher/attendance?class_section_id=7a&date=2026-10-08");
    await user.click(screen.getByRole("link", { name: "Go back" }));
    expect(await screen.findByRole("list", { name: "Your classes" })).toBeVisible();
    expect(screen.getByLabelText("Choose date")).toHaveValue("2026-10-08");
  });
  it("supports direct links to a searchable roster with honest attendance states", async () => {
    const user = userEvent.setup(); show("/teacher/classes/7a?date=2026-10-08&section=students");
    expect(await screen.findByRole("list", { name: "Class roster" })).toBeVisible();
    expect(screen.getByText("Half day")).toBeVisible();
    expect(screen.getByText("Not marked")).toBeVisible();
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "CIS-002");
    expect(within(screen.getByRole("list", { name: "Class roster" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Aarav Sharma")).toBeVisible();
    expect(getTeacherDay).not.toHaveBeenCalled();
  });
  it("preserves the selected class and section when changing dates", async () => {
    show("/teacher/classes/7a?date=2026-10-08&section=students");
    await screen.findByRole("list", { name: "Class roster" });
    fireEvent.change(screen.getByLabelText("Choose date"), { target: { value: "2026-10-07" } });
    await waitFor(() => expect(getTeacherAttendance).toHaveBeenCalledWith("7a", "2026-10-07"));
    expect(screen.getByRole("button", { name: "Students" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/teacher/classes?date=2026-10-07");
  });
  it("does not fetch a roster or notes for a class outside current assignments", async () => {
    show("/teacher/classes/not-assigned?date=2026-10-08&section=notes");
    expect(await screen.findByText(/not available in your assignments/)).toBeVisible();
    expect(getTeacherAttendance).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("reports loading and errors instead of an empty or zero class list", async () => {
    vi.mocked(getTeacherHome).mockReturnValue(new Promise(() => undefined));
    const view = show();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your classes");
    expect(screen.queryByText(/0 students|No classes/)).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(getTeacherHome).mockRejectedValue(new Error("Offline"));
    show(); expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your classes");
    vi.mocked(getTeacherHome).mockResolvedValue({ ...home, classes: [] });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No classes assigned for this date.")).toBeVisible();
  });
  it("hides timetable actions and requests when that permission is absent", async () => {
    access.permissions = ["attendance.view"];
    show("/teacher/classes/7a?date=2026-10-08");
    await screen.findByText("CBSE");
    expect(screen.queryByRole("link", { name: "Your timetable" })).not.toBeInTheDocument();
    expect(getTeacherDay).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Take attendance/ })).not.toBeInTheDocument();
  });
  it("does not hide lesson failures as no lessons", async () => {
    vi.mocked(getTeacherDay).mockRejectedValue(new Error("Offline"));
    show("/teacher/classes/7a?date=2026-10-08");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load lessons");
    expect(screen.queryByText(/No lessons with/)).not.toBeInTheDocument();
  });
  it("loads notes on demand and does not expose student-specific acknowledgements or private replies", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValue({ results: [{ id: "note", class_section_id: "7a", kind: "note", occurred_at: "2026-10-08T09:00:00Z", title: "Practice fractions", body: "Complete all exercises", unread: false, total: 1 }] });
    show("/teacher/classes/7a?date=2026-10-08"); await screen.findByText("CBSE");
    expect(apiFetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Updates" }));
    expect(await screen.findByRole("heading", { name: "Practice fractions" })).toBeVisible();
    expect(screen.queryByText(/Acknowledged at home|Private reply/)).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/screens/teacher/class-updates/?date=2026-10-08");
  });
  it("reports failed notes and roster requests rather than empty content", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Unavailable"));
    const view = show("/teacher/classes/7a?date=2026-10-08&section=notes");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load class updates");
    expect(screen.queryByText("No class updates in this period.")).not.toBeInTheDocument();
    view.unmount(); vi.mocked(getTeacherAttendance).mockRejectedValue(new Error("Forbidden"));
    show("/teacher/classes/7a?date=2026-10-08&section=students");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load class details");
    expect(screen.queryByRole("list", { name: "Class roster" })).not.toBeInTheDocument();
  });
  it("distinguishes no attendance due, locked and review-required classes", () => {
    expect(classStatus({ ...cls, periods_today: 0, marked_count: 0 })).toBe("No attendance due");
    expect(classStatus({ ...cls, submission_status: "locked" })).toBe("Attendance locked");
    expect(classStatus({ ...cls, submission_authorized: false })).toBe("Attendance needs review");
  });
});
