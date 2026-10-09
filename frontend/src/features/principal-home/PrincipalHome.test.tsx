import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrincipalHomePage } from "../../pages/operations/PrincipalPages";
import { getPrincipalHome, type PrincipalClassSummary, type PrincipalHomeResponse } from "../operations/api";
import { getPrincipalInsights } from "../principal-insights/api";
import { getAnalytics } from "../analytics/api";
import { analyticsFixture, reviewFixture } from "../principal-insights/insight-test-fixtures";
import { PrincipalAttendanceThresholdsPage, PrincipalFollowupsPage } from "./PrincipalHomeDetails";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", active_school_id: "school-1" }, memberships: [{ school_id: "school-1", role: "admin" }] }) }));
vi.mock("../principal-insights/api", () => ({ getPrincipalInsights: vi.fn() }));
vi.mock("../analytics/api", () => ({ getAnalytics: vi.fn() }));
vi.mock("../operations/api", () => ({ getPrincipalHome: vi.fn() }));
vi.mock("../../lib/schoolTime", () => ({ schoolDateToday: () => "2026-10-08" }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, backTo }: { children: ReactNode; title: string; backTo?: string }) => <main><h1>{title}</h1>{backTo ? <a href={backTo}>Back</a> : null}{children}</main> }));
vi.mock("../../pages/operations/AttendanceWorkspacePage", () => ({ AttendanceWorkspacePage: () => null }));
vi.mock("../coordination/FollowupInbox", () => ({ FollowupInbox: ({ showHeading = true }: { showHeading?: boolean }) => <section aria-label="Conversations">{showHeading ? <h2>Attendance follow-ups</h2> : null}Existing conversations</section> }));

const cls: PrincipalClassSummary = { id: "class-a", class_section_id: "class-a", class_name: "Class 7A", name: "Class 7A", grade: "7", section: "A", room_number: "201", term_name: "Term 1", academic_year: "2026–27", starts_at: "09:00", ends_at: "14:00", student_count: 25, marked_count: 0, attending_count: 0, absent_count: 0, late_count: 0, attendance_percentage: 0, subjects: [], submission_status: "not_started", timetable_slots: 6, unassigned_slots: 0, can_mark: true };
const data: PrincipalHomeResponse = {
  date: "2026-10-08", principal: { id: "admin", name: "Principal" },
  summary: { students: 203, marked: 0, attending: 0, absent: 0, late: 0, attendance_percentage: 0, classes_total: 8, classes_submitted: 0 },
  classes: [cls], exceptions: [{ id: "student-1", admission_number: "ST-1", name: "Anaya Test", class_section_id: "class-a", class_name: "Class 7A", recorded_days: 12, percentage: 75, threshold: 85 }],
  home_actions: [{ id: "event", kind: "event_duty", priority: "info", title: "Discovery Picnic", detail: "Upcoming school event at the park", status_label: "Upcoming event", action_label: "Review event", href: "/principal/events/event-1", source_id: "event-1", occurs_at: "2026-10-10T01:00:00Z", due_at: null }],
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, operational_date: "2026-10-08" });
  vi.mocked(getAnalytics).mockResolvedValue(analyticsFixture);
  vi.mocked(getPrincipalHome).mockResolvedValue(data);
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
function mount(props: { data?: PrincipalHomeResponse; date?: string; onDateChange?: (date: string) => void; path?: string } = {}) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[props.path ?? "/principal"]}><Routes>
    <Route path="/principal" element={<PrincipalHomePage data={props.data ?? data} date={props.date ?? data.date} onDateChange={props.onDateChange ?? vi.fn()} />} />
    <Route path="/principal/followups" element={<PrincipalFollowupsPage />} />
    <Route path="/principal/attendance/thresholds" element={<PrincipalAttendanceThresholdsPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe("focused principal overview", () => {
  it("keeps the blue daily summary without duplicate dashboards or the full class directory", async () => {
    mount();
    const hero = screen.getByRole("region", { name: "Daily snapshot for Thu, 8 October" });
    expect(hero).toHaveClass("teacher-home__day");
    expect(within(hero).getByText("Registers submitted")).toBeInTheDocument();
    expect(hero.querySelectorAll("a, button, input, select, [tabindex], progress")).toHaveLength(0);
    expect(within(hero).getByText("Students marked")).toBeInTheDocument();
    expect(within(hero).queryByText(/0 absent/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Registers to submit/ })).toHaveAttribute("href", "/principal/attendance?date=2026-10-08");
    expect(screen.getByRole("link", { name: "Timetable" })).toHaveAttribute("href", "/principal/timetable?date=2026-10-08&from=overview");
    await screen.findByRole("link", { name: /Attendance has fallen/ });
    expect(screen.queryByText("Class register coverage")).not.toBeInTheDocument();
    expect(screen.queryByText("Your review brief")).not.toBeInTheDocument();
    expect(screen.queryByText("Existing conversations")).not.toBeInTheDocument();
  });
  it("uses institution-wide evidence and dated destinations, ignoring old insight filters", async () => {
    mount({ path: "/principal?insight_days=56&class=old-class" });
    await screen.findByRole("link", { name: /Attendance has fallen/ });
    expect(getPrincipalInsights).toHaveBeenCalledWith("school-1", "2026-10-08", 28, "", 50);
    expect(getAnalytics).toHaveBeenCalledWith("school-1", "principal", "term");
    expect(screen.getByRole("link", { name: /Attendance has fallen/ })).toHaveAttribute("href", "/principal/insights/review?date=2026-10-08");
    expect(screen.getByRole("link", { name: /Arrange teacher coverage/ })).toHaveAttribute("href", "/principal/insights/operations?date=2026-10-08");
    expect(screen.getAllByRole("link", { name: /follow-up/i })).toHaveLength(2); // Follow-up row and decline context, not a duplicate inbox link.
    expect(screen.queryByText("All follow-up conversations")).not.toBeInTheDocument();
  });
  it("keeps changing date and returning to today available without clearing the date", async () => {
    const onDateChange = vi.fn(); mount({ date: "2026-10-07", onDateChange });
    fireEvent.change(screen.getByLabelText("Choose date"), { target: { value: "2026-10-06" } });
    expect(onDateChange).toHaveBeenLastCalledWith("2026-10-06");
    fireEvent.change(screen.getByLabelText("Choose date"), { target: { value: "" } });
    expect(onDateChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onDateChange).toHaveBeenLastCalledWith("2026-10-08");
    expect(await screen.findByText("Follow-ups and teacher coverage reflect today.")).toBeInTheDocument();
  });
  it("does not display Today on the current day", () => { mount(); expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument(); });
  it("keeps the first four checks visible and the remaining decisions behind one disclosure", async () => {
    mount();
    const more = await screen.findByText("3 more checks");
    const details = more.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(attention.querySelector(":scope > div > ul")?.children).toHaveLength(4);
    await userEvent.click(more);
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: /Overlapping deadlines/ })).toHaveAttribute("href", "/principal/insights/operations?date=2026-10-08#principal-deadlines");
    expect(screen.getByRole("link", { name: /Assessment decisions/ })).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /Assessment decisions/ })).toHaveAttribute("href", "/principal/insights/progress?period=term");
  });
  it("has an honest unscheduled-day state without a invented 100 percent", () => {
    mount({ data: { ...data, summary: { ...data.summary, classes_total: 0, students: 0 } } });
    expect(screen.getByText("No registers due for this date.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Operations are clear")).not.toBeInTheDocument();
  });
  it("keeps saved assignment and schedule mismatches actionable, including closed dates", () => {
    mount({ data: { ...data, classes: [{ ...cls, submission_authorized: false }, { ...cls, id: "other", can_mark: false, marked_count: 2 }] } });
    const link = screen.getByRole("link", { name: /Check saved registers/ });
    expect(link).toHaveTextContent("2");
    expect(link).toHaveAttribute("href", "/principal/attendance?date=2026-10-08");
  });
  it("shows loading instead of a false all-clear", () => {
    vi.mocked(getPrincipalInsights).mockReturnValue(new Promise(() => {})); mount();
    expect(screen.getByText("Checking follow-ups and attendance…")).toBeInTheDocument();
    expect(screen.queryByText("No additional checks flagged.")).not.toBeInTheDocument();
  });
  it("recovers an unavailable review without hiding known threshold exceptions", async () => {
    vi.mocked(getPrincipalInsights).mockRejectedValueOnce(new Error("Unavailable")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Some checks couldn’t load");
    expect(screen.getByRole("link", { name: /Below attendance minimum/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All follow-up conversations/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: /Attendance has fallen/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("uses a scoped quiet state when no additional review is flagged", async () => {
    vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, engagement: { ...reviewFixture.engagement, total: 0 }, followups: { ...reviewFixture.followups, awaiting: 0, review: 0, overdue: 0 }, schedule: [], deadlines: [] });
    vi.mocked(getAnalytics).mockResolvedValue({ ...analyticsFixture, assessments: { ...analyticsFixture.assessments!, pipeline: [] } });
    mount({ data: { ...data, exceptions: [], summary: { ...data.summary, classes_submitted: 8 } } });
    await screen.findByText("No additional checks flagged.");
    expect(screen.getByRole("link", { name: "View registers" })).toBeInTheDocument();
  });
  it("shows event date and time without repeating the event's status and explanation", () => {
    mount();
    const event = screen.getByRole("link", { name: /Discovery Picnic/ });
    expect(event).toHaveAttribute("href", "/principal/events/event-1");
    expect(event).toHaveTextContent("6:30 am");
    expect(event).not.toHaveTextContent("Upcoming school event");
  });
  it("opens the attendance minimum list separately and retains the date and evidence limits", async () => {
    mount();
    await userEvent.click(await screen.findByText("3 more checks"));
    await userEvent.click(screen.getByRole("link", { name: /Below attendance minimum/ }));
    await screen.findByRole("link", { name: /Review Anaya Test/ });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Below attendance minimum");
    expect(screen.getByText(/at least 5 recorded days/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/principal?date=2026-10-08");
    expect(screen.getByRole("link", { name: /Review Anaya Test/ })).toHaveAttribute("href", "/principal/attendance?class_section_id=class-a&date=2026-10-08");
  });
  it("labels the capped threshold sample instead of claiming an institution-wide total", async () => {
    const capped = { ...data, exceptions: Array.from({ length: 20 }, (_, i) => ({ ...data.exceptions[0]!, id: `student-${i}` })) };
    vi.mocked(getPrincipalHome).mockResolvedValue(capped); mount({ data: capped });
    await userEvent.click(await screen.findByText("3 more checks"));
    expect(screen.getByRole("link", { name: /Below attendance minimum/ })).toHaveTextContent("20 shown");
    await userEvent.click(screen.getByRole("link", { name: /Below attendance minimum/ }));
    await screen.findByText("Showing the 20 lowest attendance percentages.");
  });
  it("redirects older conversation anchors to the dedicated page without duplicate headings", async () => {
    mount({ path: "/principal?date=2026-10-08#attendance-followups" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Attendance follow-ups" })).toBeInTheDocument());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Existing conversations")).toBeInTheDocument();
  });
  it("shows the completed register state without a pending action", () => {
    mount({ data: { ...data, summary: { ...data.summary, classes_submitted: 8, marked: 203, absent: 4, late: 2 } } });
    expect(screen.getByRole("region", { name: /Daily snapshot/ })).toHaveTextContent("8 / 8");
    expect(screen.getByRole("link", { name: "View registers" })).toBeInTheDocument();
    expect(screen.getByText(/4 absent · 2 late/)).toBeInTheDocument();
    expect(screen.queryByText("Registers to submit")).not.toBeInTheDocument();
  });
  it("recovers loading errors on the separate minimum-attendance page", async () => {
    vi.mocked(getPrincipalHome).mockRejectedValueOnce(new Error("Unavailable"));
    mount({ path: "/principal/attendance/thresholds?date=2026-10-08" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Attendance couldn’t load");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: /Review Anaya Test/ });
  });
  it("handles invalid deep-linked dates without crashing the new detail pages", async () => {
    mount({ path: "/principal/attendance/thresholds?date=not-a-date" });
    await screen.findByRole("link", { name: /Review Anaya Test/ });
    expect(getPrincipalHome).toHaveBeenCalledWith("2026-10-08");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/principal?date=2026-10-08");
  });
  it("retains assigned event duty and provides an explicit empty event state", () => {
    const { unmount } = mount({ data: { ...data, home_actions: [{ ...data.home_actions[0]!, status_label: "Assigned event duty" }] } });
    expect(screen.getByText("You have an assigned duty")).toBeInTheDocument();
    unmount(); mount({ data: { ...data, home_actions: [] } });
    expect(screen.getByText("No upcoming events to show.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/principal/events");
  });
});
