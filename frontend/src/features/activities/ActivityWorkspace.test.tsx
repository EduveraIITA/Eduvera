import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { ActivityTimetableWorkspace } from "./ActivityTimetableWorkspace";
import { ActivityAttendanceWorkspace } from "./ActivityAttendanceWorkspace";
import { getActivityCatalogue, getActivityOccurrences, getActivityPlans, getActivityRegisters, getActivityRegister, getActivityRegisterForOccurrence, type ActivityCatalogue, type ActivityOccurrence, type ActivityRegisterSummary, type ActivityRegister } from "./api";
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getActivityCatalogue: vi.fn(), getActivityOccurrences: vi.fn(), getActivityPlans: vi.fn(), getActivityRegisters: vi.fn(), getActivityRegister: vi.fn(), getActivityRegisterForOccurrence: vi.fn() }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, pageTitleTrailing }: { children: ReactNode; pageTitleTrailing?: ReactNode }) => <>{pageTitleTrailing}{children}</> }));
vi.mock("./ActivityCalendar", () => ({ ActivityCalendar: ({ occurrences, onSelect }: { occurrences: ActivityOccurrence[]; onSelect: (item: ActivityOccurrence) => void }) => <div aria-label="Activity calendar">{occurrences.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}>Calendar: {item.title}</button>)}</div> }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
const catalogue: ActivityCatalogue = { school_id: "school-1", timezone: "Pacific/Auckland", can_manage: true, people: [], groups: [], recorders: [], reviewers: [], spaces: [], classes: [], subjects: [], terms: [], purposes: ["teaching", "duty", "training", "meeting", "other"] };
const occurrence: ActivityOccurrence = { id: "occurrence-1", school_id: "school-1", activity_id: "plan-1", plan_version_id: "plan-1", title: "Mixed safety training", purpose: "training", starts_at: "2026-10-20T09:00:00Z", ends_at: "2026-10-20T10:00:00Z", local_date: "2026-10-20", timezone: "Pacific/Auckland", space_id: null, space_label: null, attendance_mode: "roll_call", source_revision: 1, source: "activity", source_ref: "plan-1", state: "expected", participants: [{ person_id: "worker", label: "Ravi Guard", participation_role: "participant", source_kind: "person", source_ref: "worker", source_revision: 1 }] };
function Location() { return <output aria-label="Current URL">{useLocation().pathname}{useLocation().search}</output>; }
function mount(node: ReactNode, url: string, environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[url]}>{node}<Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
describe("one calendar and one register queue", () => {
  it("separates date navigation from presentation and preserves the date when changing display", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20");
    const dateInput = await screen.findByLabelText("Choose date", { selector: 'input' });
    expect(dateInput).toHaveValue("2026-10-20");
    expect(screen.getByRole("button", { name: "Previous week" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next week" })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Timetable display" }), "agenda");
    expect(dateInput).toHaveValue("2026-10-20");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-20&view=agenda");
    expect(screen.queryByRole("region", { name: "Timetable options" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Find an activity on this page" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Timetable options", exact: true }));
    const options = screen.getByRole("region", { name: "Timetable options" });
    expect(options).toHaveTextContent("Times use Pacific/Auckland");
    fireEvent.keyDown(options, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Timetable options" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timetable options", exact: true })).toHaveFocus();
  });
  it("reveals page-scoped search on request and clears it on close without losing date or page", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [occurrence], page: 2, page_size: 25, total: 26, total_pages: 2 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20&page=2");
    const toggle = await screen.findByRole("button", { name: "Search activities on this page" });
    await userEvent.click(toggle);
    const input = screen.getByRole("textbox", { name: "Find an activity on this page" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "No matching activity");
    expect(screen.queryByRole("button", { name: "Calendar: Mixed safety training" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find an activity on this page" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search activities on this page" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Calendar: Mixed safety training" })).toBeVisible();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-20&page=2");
  });
  it("keeps secondary campus navigation inside options and preserves the ordinary Add workflow", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" context={<a href="/areas/calendar?surface=manage">Campus calendar</a>} />, "/areas/timetable/planning?date=2026-10-20");
    const add = await screen.findByRole("button", { name: "Schedule activity" });
    expect(add).toHaveTextContent("Add");
    expect(screen.queryByRole("link", { name: "Campus calendar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Timetable options", exact: true }));
    expect(screen.getByRole("link", { name: "Campus calendar" })).toHaveAttribute("href", "/areas/calendar?surface=manage");
    await userEvent.click(add);
    expect(screen.getByRole("dialog", { name: "Schedule activity" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(screen.queryByRole("dialog", { name: "Schedule activity" })).not.toBeInTheDocument();
  });
  it("keeps ended simulation timetables readable without scheduling controls", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [occurrence], page: 1, page_size: 25, total: 1, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20&create=attendance", { mode: "simulation", namespaceId: "namespace-one", runId: "run-one", runStatus: "completed", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } });
    expect(await screen.findByRole("button", { name: "Calendar: Mixed safety training" })).toBeVisible();
    expect(screen.getByText("1 scheduled activity")).toBeVisible();
    expect(screen.getByText(/saved timetable is read-only/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Schedule activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Schedule activity" })).not.toBeInTheDocument();
  });
  it("distinguishes a day-scoped register from a scheduled lesson interval", async () => {
    const daily: ActivityRegisterSummary = { id: "daily-register", occurrence_id: "daily-occurrence", title: "Workshop daily attendance", kind: "teaching",
      starts_at: "2026-10-19T18:30:00Z", ends_at: "2026-10-20T18:30:00Z", time_zone: "Asia/Kolkata", place_label: "",
      state: "draft", revision: 0, participant_count: 1, recorded_count: 0, can_record: true, can_review: false,
      availability_reason: null, source_kind: "daily_class", entry_mode: "participation" };
    vi.mocked(getActivityRegisters).mockResolvedValue({ date: "2026-10-20", page: 1, page_size: 20, total: 2, total_pages: 1,
      registers: [daily, { ...daily, id: "lesson-register", title: "Foundations lesson", source_kind: "scheduled_session",
        starts_at: "2026-10-20T03:30:00Z", ends_at: "2026-10-20T04:30:00Z" }] });
    mount(<ActivityAttendanceWorkspace schoolId="school-1" />, "/areas/attendance/registers");
    const dailyButton = await screen.findByRole("button", { name: /Workshop daily attendance/ });
    expect(dailyButton.querySelector('[data-product-icon="attendance"]')).toHaveAttribute("aria-hidden", "true");
    expect(dailyButton).toHaveTextContent("Daily register");
    expect(dailyButton).not.toHaveTextContent("12:00");
    const lessonButton = screen.getByRole("button", { name: /Foundations lesson/ });
    expect(lessonButton).not.toHaveTextContent("Daily register");
    expect(lessonButton).toHaveTextContent(/9:00.*10:00/);
  });
  it.each([false, true])("opens a cut-over academic context in the same participant register, including an exact occurrence shortcut (%s)", async (shortcut) => {
    const register: ActivityRegisterSummary = { id: "neutral-register", occurrence_id: "neutral-occurrence", title: "Unified academic register",
      kind: "teaching", starts_at: "2026-10-20T09:00:00Z", ends_at: "2026-10-20T10:00:00Z", time_zone: "UTC", place_label: "",
      state: "draft", revision: 0, participant_count: 0, recorded_count: 0, can_record: true, can_review: false, availability_reason: null,
      source_kind: "daily_class", entry_mode: "participation", source: { domain: "attendance", href: "/areas/attendance/registers?class_section_id=old-class", label: "Academic context" } };
    const detail: ActivityRegister = { register: { ...register, submitted_at: null, finalized_at: null, policy_revision: 0 },
      roster: [], counts: { participants: 0, recorded: 0, unrecorded: 0, present: 0, absent: 0, late: 0, excused: 0 },
      capabilities: { can_record: true, can_submit: false, can_finalize: false, can_reopen: false, can_review_evidence: false },
      allowed_statuses: ["present", "absent", "late", "excused", "half_day"], pending_evidence: [], availability_reason: null };
    vi.mocked(getActivityRegisters).mockResolvedValue({ date: "2026-10-20", page: 1, page_size: 20, total: 1, total_pages: 1, registers: [register] });
    vi.mocked(getActivityRegister).mockResolvedValue(detail); vi.mocked(getActivityRegisterForOccurrence).mockResolvedValue(detail);
    mount(<ActivityAttendanceWorkspace schoolId="school-1" />, shortcut ? "/areas/attendance/registers?occurrence_id=neutral-occurrence" : "/areas/attendance/registers");
    if (!shortcut) await userEvent.click(await screen.findByRole("button", { name: /Unified academic register/ }));
    expect(await screen.findByRole("heading", { name: "Unified academic register" })).toBeVisible();
    if (shortcut) expect(getActivityRegisterForOccurrence).toHaveBeenCalledWith("school-1", "neutral-occurrence");
    else expect(getActivityRegister).toHaveBeenCalledWith("school-1", "neutral-register");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("class_section_id=old-class");
  });
  it("forwards and clears the selected participant editor's guard for shell navigation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const registeredGuard = vi.fn<(guard: (() => boolean) | null) => void>();
    const detail: ActivityRegister = {
      register: { id: "register-guard", occurrence_id: "occurrence-guard", title: "Staff briefing", kind: "meeting", starts_at: "2026-10-20T09:00:00Z", ends_at: "2026-10-20T10:00:00Z", time_zone: "UTC", place_label: "", state: "draft", revision: 0, submitted_at: null, finalized_at: null, policy_revision: null },
      roster: [{ person_id: "worker", name: "Ravi Guard", roles: ["participant"], requirement: "required", status: null, remarks: "", observed_at: null, revision: 0 }],
      counts: { participants: 1, recorded: 0, unrecorded: 1, present: 0, absent: 0, late: 0, excused: 0 },
      capabilities: { can_record: true, can_submit: true, can_finalize: false, can_reopen: false, can_review_evidence: false },
      allowed_statuses: ["present", "absent"], pending_evidence: [], availability_reason: null,
    };
    vi.mocked(getActivityRegister).mockResolvedValue(detail);
    mount(<ActivityAttendanceWorkspace schoolId="school-1" onBeforeLeaveChange={registeredGuard} />, "/areas/attendance/registers?register_id=register-guard");
    await screen.findByRole("article", { name: "Ravi Guard" });
    expect(registeredGuard.mock.lastCall?.[0]?.()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Present", exact: true }));
    expect(registeredGuard.mock.lastCall?.[0]?.()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("register_id=register-guard");
    cleanup();
    expect(registeredGuard).toHaveBeenLastCalledWith(null);
  });
  it("opens the ordinary activity editor from attendance onboarding without an academic setup fork", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20&create=attendance");
    expect(await screen.findByRole("dialog", { name: "Set up attendance" })).toBeVisible();
    expect(screen.getByLabelText("Purpose")).toHaveValue("other");
    expect(screen.queryByText(/I teach this group/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Class$/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(screen.queryByRole("dialog", { name: "Set up attendance" })).not.toBeInTheDocument();
  });
  it("pages a bounded mixed calendar without person-category modes", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockImplementation((_school, from, until, page = 1) => Promise.resolve({ items: [{ ...occurrence, id: `occurrence-${page}` }], from, until, page, page_size: 25, total: 26, total_pages: 2 }));
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20");
    expect(await screen.findByRole("button", { name: "Calendar: Mixed safety training" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Staff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Students" })).not.toBeInTheDocument();
    expect(getActivityOccurrences).toHaveBeenCalledWith("school-1", "2026-10-20", "2026-10-20", 1);
    await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("school-1", "2026-10-20", "2026-10-20", 2));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-20&page=2");
    expect(getActivityPlans).not.toHaveBeenCalled();
  });
  it("keeps the calendar and activity list consistent after a one-off moves to another date", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [occurrence,
      { ...occurrence, id: "overnight", title: "Night coverage" },
      { ...occurrence, id: "moved-original", title: "Moved workshop", state: "cancelled" }],
    page: 1, page_size: 25, total: 2, total_pages: 1 });
    const client = mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20");
    expect(await screen.findByRole("button", { name: "Calendar: Mixed safety training" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Calendar: Night coverage" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Agenda activities on this page" })).getByRole("button", { name: /Night coverage/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Moved workshop/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 scheduled activities")).toBeVisible();
    expect(client.getQueryCache().getAll().some(query => query.queryKey.includes("occurrences") && query.queryKey.includes("expected"))).toBe(true);
  });
  it("reuses the same calendar as a scoped read-only schedule without management controls", async () => {
    vi.mocked(getActivityCatalogue).mockResolvedValue({ ...catalogue, can_manage: false });
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [occurrence], page: 1, page_size: 25, total: 1, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" planning={false} />, "/areas/timetable/schedule?date=2026-10-20");
    await userEvent.click(await screen.findByRole("button", { name: "Calendar: Mixed safety training" }));
    expect(screen.getByRole("dialog", { name: "Mixed safety training" })).toBeVisible();
    expect(screen.getByText("Ravi Guard")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Schedule activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plans & drafts" })).not.toBeInTheDocument();
  });
  it.each(["event", "examination"] as const)("opens a %s from the common calendar through its owning workflow", async (source) => {
    vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
    const sourceHref = source === "event" ? "/areas/events/manage?event=event-1" : "/areas/assessments/manage?assessment=assessment-1";
    vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [{ ...occurrence, source, source_href: sourceHref, plan_version_id: null }], page: 1, page_size: 25, total: 1, total_pages: 1 });
    mount(<ActivityTimetableWorkspace schoolId="school-1" />, "/areas/timetable/planning?date=2026-10-20");
    await userEvent.click(await screen.findByRole("button", { name: "Calendar: Mixed safety training" }));
    expect(screen.getByRole("link", { name: source === "event" ? "Open event" : "Open examination" })).toHaveAttribute("href", sourceHref);
    expect(screen.queryByRole("link", { name: "Open participant register" })).not.toBeInTheDocument();
  });
  it("uses the server campus date and routes old registers to their authoritative context", async () => {
    const register: ActivityRegisterSummary = { id: "old-register", occurrence_id: "daily-class", title: "Daily group register", kind: "daily", starts_at: "2026-10-20T09:00:00Z", ends_at: "2026-10-20T10:00:00Z", time_zone: "Pacific/Auckland", place_label: "", state: "draft", revision: 0, participant_count: 2, recorded_count: 0, can_record: true, can_review: false, availability_reason: null, source_kind: "daily_class", source: { domain: "attendance", href: "/areas/attendance/registers?class_section_id=class-1&date=2026-10-21", label: "Daily attendance" } };
    vi.mocked(getActivityRegisters).mockResolvedValue({ date: "2026-10-21", page: 1, page_size: 20, total: 1, total_pages: 1, registers: [register] });
    mount(<ActivityAttendanceWorkspace schoolId="school-1" />, "/areas/attendance/registers");
    await userEvent.click(await screen.findByRole("button", { name: /Daily group register/ }));
    expect(getActivityRegisters).toHaveBeenCalledWith("school-1", undefined, 1, { search: "", view: "all", kind: "" });
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("class_section_id=class-1&date=2026-10-21");
    expect(getActivityRegister).not.toHaveBeenCalled();
  });
});
