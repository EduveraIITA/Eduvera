import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TeacherDayPanel } from "../day-plans/TeacherDayPage";
import { getTeacherDay, type TeacherDay } from "../day-plans/api";
import { ActivityOccurrenceDetail } from "../activities/ActivityOccurrenceDetail";
import type { ActivityOccurrence } from "../activities/api";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ memberships: [] }) }));
vi.mock("../day-plans/api", async original => ({ ...(await original<typeof import("../day-plans/api")>()), getTeacherDay: vi.fn() }));
const href = "/areas/timetable/session?class_section_id=class-1&period_number=2&date=2026-10-24";
const period: TeacherDay["periods"][number] = { id: "period-1", period_number: 2, subject_id: "subject-1", starts_at: "09:00:00", ends_at: "10:00:00", title: "Programming", slot_type: "class", room: "Lab 2", teacher_user_id: "teacher-1", teacher_name: "Meera", cancelled: false, materials: [], coverage_status: "not_required", response_revision: 0, response_note: "", response_source: null, responded_at: null, class_name: "BCA", class_section_id: "class-1", day_plan_id: null, plan_version: null, notice: "", owner_name: null };
const occurrence: ActivityOccurrence = { id: "occurrence-1", school_id: "school", activity_id: "plan-1", plan_version_id: "version-1", title: "Programming", purpose: "teaching", starts_at: "2026-10-24T09:00:00Z", ends_at: "2026-10-24T10:00:00Z", local_date: "2026-10-24", timezone: "UTC", space_id: null, space_label: "Lab 2", attendance_mode: "roll_call", source_revision: 1, source: "academic", source_ref: "period-1", state: "expected", participants: [] };
function schedule(teachingHref?: string) {
  vi.mocked(getTeacherDay).mockResolvedValue({ date: "2026-10-24", context: { today: "2026-10-24", local_time: "09:00", timezone: "UTC", is_instructional: true, label: null }, periods: [{ ...period, ...(teachingHref ? { teaching_session_href: teachingHref } : {}) }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TeacherDayPanel date="2026-10-24" schoolContext={{ id: "school" }} /></MemoryRouter></QueryClientProvider>);
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("exact teaching-session entry links", () => {
  it("uses only a server-composed teacher entry, replacing the loose class register shortcut", async () => {
    schedule(href); expect(await screen.findByRole("link", { name: "Open session" })).toHaveAttribute("href", href); expect(screen.queryByRole("link", { name: "Open class register" })).not.toBeInTheDocument();
  });
  it("keeps existing attendance entry when the teaching capability is absent", async () => {
    schedule(); expect(await screen.findByRole("link", { name: "Open class register" })).toBeVisible(); expect(screen.queryByRole("link", { name: "Open session" })).not.toBeInTheDocument();
  });
  it("does not invent teaching access from a teaching occurrence alone", () => {
    render(<MemoryRouter><ActivityOccurrenceDetail occurrence={occurrence} planning={false} onClose={vi.fn()} /></MemoryRouter>); expect(screen.queryByRole("link", { name: "Open session" })).not.toBeInTheDocument();
  });
  it("opens the exact authorized occurrence handoff when supplied", () => {
    render(<MemoryRouter><ActivityOccurrenceDetail occurrence={{ ...occurrence, teaching_session_href: href }} planning={false} onClose={vi.fn()} /></MemoryRouter>); expect(screen.getByRole("link", { name: "Open session" })).toHaveAttribute("href", href);
  });
});
