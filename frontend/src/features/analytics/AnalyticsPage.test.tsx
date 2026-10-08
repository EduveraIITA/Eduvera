import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { TestQueryProvider } from "../../test/TestQueryProvider";
import type { Portal } from "../auth/AuthContext";
import AnalyticsPage, { AnalyticsContent } from "./AnalyticsPage";
import { AssessmentProgress, AttendanceBreakdown, AttendanceTrend, ComparisonBars } from "./AnalyticsCharts";
import { getAnalytics, type AnalyticsOverview } from "./api";

vi.mock("./api", () => ({ getAnalytics: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user", active_school_id: "school" }, memberships: ["admin", "staff", "student", "guardian"].map(role => ({ role, school_id: "school", school_name: "Our school" })) }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, backTo }: { children: ReactNode; title: string; backTo?: string }) => <><h1>{title}</h1>{backTo ? <Link to={backTo}>Back to Analytics</Link> : null}{children}</> }));
vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children, pageTitle, backTo }: { children: ReactNode; pageTitle: string; backTo?: string }) => <><h1>{pageTitle}</h1>{backTo ? <Link to={backTo}>Back to Analytics</Link> : null}{children}</> }));
vi.mock("../../pages/parent/ParentShell", () => ({ ParentShell: ({ children, pageLabel, backTo, onSelectChild }: { children: ReactNode; pageLabel: string; backTo?: string; onSelectChild: (id: string) => void }) => <><h1>{pageLabel}</h1>{backTo ? <Link to={backTo}>Back to Analytics</Link> : null}<button onClick={() => onSelectChild("child-b")}>Switch child</button>{children}</> }));

const counts = { present: 3, absent: 1, late: 1, half_day: 1, excused: 1, recorded: 7, denominator: 6, attended: 4.5, percentage: 75 };
const data: AnalyticsOverview = {
  portal: "principal", generated_at: "2026-10-08T12:00:00Z", student: null,
  term: { id: "term", name: "Term 1", starts_on: "2026-08-01", ends_on: "2026-12-31", attendance_threshold: 85 },
  range: { period: "term", from: "2026-08-01", to: "2026-10-08", capped: false }, scope_label: "All classes",
  classes: [{ id: "class-a", name: "Class 7A" }, { id: "class-b", name: "Class 7B" }],
  institution: { as_of: "2026-10-08", enrollment_as_of: "2026-10-08", students: 51, configured_classes: 3, populated_classes: 2, average_class_size: 25.5, teaching_staff: 5, non_teaching_staff: 2, students_per_teacher: 10.2,
    classes: [{ id: "class-a", name: "Class 7A", students: 25 }, { id: "class-b", name: "Class 7B", students: 26 }, { id: "class-c", name: "Class 7C", students: 0 }] },
  registers: { expected: 40, submitted: 20, locked: 10, outstanding: 10, percentage: 75, unscheduled_classes: 0,
    classes: [{ id: "class-a", name: "Class 7A", expected: 40, submitted: 20, locked: 10, outstanding: 10, percentage: 75, latest_unsubmitted: "2026-10-07" }] },
  attendance: { ...counts, trend: [{ ...counts, date: "2026-08-01", end: "2026-08-31" }, { ...counts, percentage: null, date: "2026-09-01", end: "2026-09-30" }, { ...counts, date: "2026-10-01", end: "2026-10-08" }], classes: [{ ...counts, id: "class-a", name: "Class 7A" }],
    subjects: [{ id: "maths", name: "Mathematics", held: 12, attended: 9, excused: 2, counted: 10, percentage: 90 }] },
  assessments: { overall: { average: 80, scored: 3, other: 1, assessments: 4, distribution: [0,0,0,0,3] }, classes: [{ id: "class-a", name: "Class 7A", average: 80, scored: 3, other: 1, assessments: 4 }], subjects: [{ id: "maths", name: "Mathematics", average: 80, scored: 3, other: 1, assessments: 4 }], pipeline: [{ status: "published", count: 3 }, { status: "submitted", count: 1 }] },
};
beforeEach(() => { vi.mocked(getAnalytics).mockResolvedValue(data); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show(portal: Portal, search = "") {
  return render(<TestQueryProvider><MemoryRouter initialEntries={[`/${portal}/analytics${search}`]}><Routes>
    <Route path={`/${portal}/analytics`} element={<AnalyticsPage portal={portal} />} />
    {(["attendance", "results", "progress", "institution", "registers"] as const).map(topic => <Route key={topic} path={`/${portal}/analytics/${topic}`} element={<AnalyticsPage portal={portal} topic={topic} />} />)}
  </Routes><Location /></MemoryRouter></TestQueryProvider>);
}

describe("role-specific Analytics", () => {
  it("shows a compact institution snapshot with a separate current-record drill-down", async () => {
    show("principal", "?period=90");
    const snapshot = await screen.findByRole("link", { name: "Explore institution snapshot" });
    expect(snapshot).toHaveTextContent("51"); expect(snapshot).toHaveTextContent("Active staff7");
    expect(snapshot).toHaveTextContent("Average class size25.5");
    fireEvent.click(snapshot);
    expect(await screen.findByRole("heading", { name: "Students & classes" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Analytics period" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Enrolment by class" })).toHaveTextContent("No active enrolments");
    expect(screen.getByRole("figure", { name: /Active staff mix/ })).toHaveAccessibleName(/Teaching: 5; Non-teaching: 2/);
    expect(screen.getByText("10.2")).toBeVisible();
    expect(screen.getByRole("link", { name: "View staff" })).toHaveAttribute("href", "/principal/staff");
    fireEvent.click(screen.getByRole("link", { name: "Back to Analytics" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/analytics?period=90");
  });
  it.each(["teacher", "parent", "student"] as const)("does not display institution data in %s even if supplied", async portal => {
    show(portal);
    await screen.findByRole("link", { name: "Explore results" });
    expect(screen.queryByRole("link", { name: "Explore institution snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Explore register submission" })).not.toBeInTheDocument();
  });
  it("hides institution totals when a class is selected instead of mixing scopes", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...data, selected_class_id: "class-a", institution: null });
    show("principal", "?class=class-a");
    await screen.findByRole("link", { name: "Explore results" });
    expect(screen.queryByRole("link", { name: "Explore institution snapshot" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore register submission" })).toHaveAttribute("href", "/principal/analytics/registers?class=class-a");
  });
  it("drills from register submission into a dated class register, retaining the period", async () => {
    show("principal", "?period=30");
    fireEvent.click(await screen.findByRole("link", { name: "Explore register submission" }));
    expect(await screen.findByRole("heading", { name: "Scheduled registers" })).toBeVisible();
    expect(screen.getByRole("figure", { name: /Scheduled register states/ })).toHaveAccessibleName(/Submitted: 20; Locked: 10; Not submitted: 10/);
    expect(screen.getByRole("link", { name: "Review 7 Oct · 10 not submitted" })).toHaveAttribute("href", "/principal/attendance?date=2026-10-07&class_section_id=class-a");
    expect(screen.getByRole("link", { name: "Back to Analytics" })).toHaveAttribute("href", "/principal/analytics?period=30");
    expect(screen.getByText(/does not mean overdue/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Published results" })).not.toBeInTheDocument();
  });
  it("does not display no schedule as either 0% or 100% submission", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...data, registers: { expected: 0, submitted: 0, locked: 0, outstanding: 0, percentage: null, unscheduled_classes: 2, classes: [] } });
    show("principal");
    const card = await screen.findByRole("link", { name: "Explore register submission" });
    expect(card).toHaveTextContent("—");
    expect(card).toHaveTextContent("No scheduled registers in this period.");
    expect(card).toHaveTextContent("2 enrolled classes have no scheduled days.");
    expect(card).not.toHaveTextContent("0%");
  });
  it.each(["principal", "teacher", "parent", "student"] as const)("opens %s analytics without an extra page heading", async portal => {
    show(portal);
    expect(await screen.findByRole("link", { name: "Explore results" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Explore attendance" })).toHaveAttribute("href", `/${portal}/analytics/attendance`);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(getAnalytics).toHaveBeenCalledWith("school", portal, "term", undefined, undefined);
    if (portal === "parent" || portal === "student") {
      expect(screen.queryByRole("heading", { name: "Attendance by class" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Explore assessment progress" })).not.toBeInTheDocument();
    } else expect(screen.getByRole("link", { name: "Explore assessment progress" })).toBeVisible();
    expect(screen.queryByText("How scores are counted")).not.toBeInTheDocument();
    expect(screen.queryByText("View chart data")).not.toBeInTheDocument();
  });
  it("retains class and period in the URL and sends them to the API", async () => {
    show("teacher", "?class=class-b&period=90");
    await screen.findByRole("link", { name: "Explore results" });
    expect(getAnalytics).toHaveBeenLastCalledWith("school", "teacher", "90", undefined, "class-b");
    fireEvent.change(screen.getByRole("combobox", { name: "Analytics period" }), { target: { value: "30" } });
    await waitFor(() => expect(getAnalytics).toHaveBeenLastCalledWith("school", "teacher", "30", undefined, "class-b"));
    expect(screen.getByTestId("location")).toHaveTextContent("class=class-b&period=30");
    fireEvent.change(screen.getByRole("combobox", { name: "Class", exact: true }), { target: { value: "" } });
    await waitFor(() => expect(getAnalytics).toHaveBeenLastCalledWith("school", "teacher", "30", undefined, undefined));
  });
  it("switches children without dropping the reporting period", async () => {
    show("parent", "/results?student_id=child-a&period=30");
    await screen.findByRole("heading", { name: "Published results" });
    fireEvent.click(screen.getByRole("button", { name: "Switch child" }));
    await waitFor(() => expect(getAnalytics).toHaveBeenLastCalledWith("school", "parent", "30", "child-b", undefined));
    expect(screen.getByTestId("location")).toHaveTextContent("student_id=child-b&period=30");
    expect(screen.getByRole("link", { name: "Back to Analytics" })).toHaveAttribute("href", "/parent/analytics?student_id=child-b&period=30");
  });
  it("hides a denied domain instead of manufacturing totals", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...data, attendance: null });
    show("teacher");
    await screen.findByRole("link", { name: "Explore results" });
    expect(screen.queryByRole("link", { name: "Explore attendance" })).not.toBeInTheDocument();
  });
  it("links a filtered class to its register and pending reviews to the right queue", () => {
    const view = render(<MemoryRouter><AnalyticsContent portal="principal" data={{ ...data, selected_class_id: "class-a" }} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "View attendance" })).toHaveAttribute("href", "/principal/attendance?date=2026-10-08&class_section_id=class-a");
    expect(screen.queryByRole("link", { name: "1 assessment awaiting review" })).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><AnalyticsContent portal="principal" topic="progress" data={data} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "1 assessment awaiting review" })).toHaveAttribute("href", "/principal/assessments?status=submitted");
    expect(screen.queryByRole("link", { name: "View attendance" })).not.toBeInTheDocument();
  });
  it("shows error and retry without stale charts or demo fallback", async () => {
    vi.mocked(getAnalytics).mockRejectedValueOnce(new Error("Access changed."));
    show("teacher");
    expect(await screen.findByRole("alert")).toHaveTextContent("Access changed");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Explore results" })).toBeVisible();
  });
  it("preserves learner context on attendance/results links and explains averages", () => {
    const student = { id: "child-a" } as NonNullable<AnalyticsOverview["student"]>;
    const view = render(<MemoryRouter><AnalyticsContent portal="parent" data={{ ...data, student }} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "View attendance" })).toHaveAttribute("href", "/parent/attendance?student_id=child-a");
    expect(screen.getByText("Below minimum")).toBeVisible();
    fireEvent.click(screen.getByText("View chart data"));
    expect(screen.getByRole("table", { name: "Attendance trend data" })).toBeVisible();
    view.rerender(<MemoryRouter><AnalyticsContent portal="parent" topic="results" data={{ ...data, student }} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "View results & feedback" })).toHaveAttribute("href", "/parent/results?student_id=child-a");
    expect(screen.getByText(/not an official term grade/)).toBeVisible();
  });
  it("uses null gaps in line charts, keeps a real zero and provides readable bar values", () => {
    const view = render(<AttendanceTrend attendance={data.attendance!} monthly />);
    expect(view.container.querySelectorAll(".analytics-trend__line")).toHaveLength(2);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/Missing periods are gaps, not zero/);
    view.rerender(<ComparisonBars label="Subject comparison" rows={[{ id: "one", name: "Maths", value: 0, detail: "1 scored result" }, { id: "two", name: "English", value: null, detail: "No scores" }]} />);
    const rows = within(screen.getByRole("list", { name: "Subject comparison" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("0%"); expect(rows[1]).toHaveTextContent("—");
  });
  it.each(["attendance", "results", "progress"] as const)("opens %s on its own page and returns with the filters intact", async topic => {
    show("principal", "?period=90&class=class-a");
    const label = topic === "progress" ? "assessment progress" : topic;
    fireEvent.click(await screen.findByRole("link", { name: `Explore ${label}` }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/principal/analytics/${topic}?period=90&class=class-a`);
    expect(screen.queryByRole("link", { name: "Explore results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Published results" })).toBe(topic === "results" ? screen.getByRole("heading", { name: "Published results" }) : null);
    expect(screen.queryByRole("heading", { name: "Recorded attendance" })).toBe(topic === "attendance" ? screen.getByRole("heading", { name: "Recorded attendance" }) : null);
    fireEvent.click(screen.getByRole("link", { name: "Back to Analytics" }));
    expect(await screen.findByRole("link", { name: "Explore results" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/analytics?period=90&class=class-a");
  });
  it("does not fall back to another topic when a bookmarked topic is denied", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...data, attendance: null });
    show("teacher", "/attendance?period=30");
    expect(await screen.findByText("This topic is not available with your current access.")).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Analytics" })).toHaveAttribute("href", "/teacher/analytics?period=30");
  });
  it("keeps doughnut counts distinct from weighted attendance and shows no pie for missing data", () => {
    const view = render(<AttendanceBreakdown attendance={counts} family />);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/7 days recorded.*Present: 3.*Half day: 1/);
    expect(view.container.querySelectorAll(".analytics-donut__segment")).toHaveLength(5);
    view.rerender(<AttendanceBreakdown attendance={{ ...counts, present: 0, absent: 0, late: 0, half_day: 0, excused: 0 }} family />);
    expect(screen.getByText("No records for this breakdown.")).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });
  it("groups overview progress without losing the exact stages in the detail chart", () => {
    const pipeline = [{ status: "draft", count: 2 }, { status: "submitted", count: 1 }, { status: "published", count: 4 }, { status: "cancelled", count: 1 }];
    const view = render(<AssessmentProgress pipeline={pipeline} compact />);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/8 assessments.*Published: 4.*In progress: 3.*Cancelled: 1/);
    view.rerender(<AssessmentProgress pipeline={pipeline} />);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/Draft: 2.*Awaiting review: 1.*Published: 4.*Cancelled: 1/);
  });
  it("keeps subject lessons separate from daily class attendance", async () => {
    show("principal", "/attendance?period=30");
    expect(await screen.findByRole("heading", { name: "Attendance by subject" })).toBeVisible();
    const subjects = screen.getByRole("list", { name: "Subject attendance comparison" });
    expect(subjects).toHaveTextContent("90%"); expect(subjects).toHaveTextContent("9 / 10 student-lessons");
    expect(screen.getByText(/not separately marked lesson attendance/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "By class" }));
    expect(screen.getByTestId("location")).toHaveTextContent("compare=class");
    expect(screen.getByRole("list", { name: "Class attendance comparison" })).toHaveTextContent("75%");
    expect(screen.queryByRole("list", { name: "Subject attendance comparison" })).not.toBeInTheDocument();
  });
  it("offers institution/class result comparisons to staff, not the family portal", async () => {
    const view = show("principal", "/results");
    expect(await screen.findByText("Institution average")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "By class" }));
    expect(screen.getByRole("list", { name: "Published class scores" })).toHaveTextContent("Class 7A");
    view.unmount();
    show("parent", "/results?compare=class");
    expect(await screen.findByText("Personal average")).toBeVisible();
    expect(screen.queryByRole("button", { name: "By class" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Published subject scores" })).toBeVisible();
    expect(screen.queryByRole("list", { name: "Published class scores" })).not.toBeInTheDocument();
  });
});
