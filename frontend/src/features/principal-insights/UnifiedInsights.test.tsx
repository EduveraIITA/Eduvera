import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AnalyticsPage from "../analytics/AnalyticsPage";
import { LegacyAnalyticsRedirect } from "../analytics/InsightNavigation";
import { getAnalytics } from "../analytics/api";
import { PrincipalInsightsPage } from "./PrincipalInsightsPage";
import { getPrincipalInsights } from "./api";
import { analyticsFixture, reviewFixture } from "./insight-test-fixtures";

const session = vi.hoisted(() => ({ role: "admin" }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user", active_school_id: "school-1" }, memberships: [{ role: session.role, school_id: "school-1" }] }) }));
vi.mock("../analytics/api", () => ({ getAnalytics: vi.fn() }));
vi.mock("./api", () => ({ getPrincipalInsights: vi.fn() }));
vi.mock("../coordination/FollowupInbox", () => ({ FollowupInbox: ({ studentId }: { studentId: string }) => <section id="attendance-followups" aria-label="Existing follow-ups">Conversations for {studentId}</section> }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, active, backTo }: { children: ReactNode; title: string; active: string; backTo?: string }) => <><h1>{title}</h1><output>{active}</output>{backTo ? <Link to={backTo}>Back to Insights</Link> : null}{children}</> }));
vi.mock("../../pages/parent/ParentShell", () => ({ ParentShell: ({ children, pageLabel }: { children: ReactNode; pageLabel: string }) => <><h1>{pageLabel}</h1>{children}</> }));
vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children, pageTitle }: { children: ReactNode; pageTitle: string }) => <><h1>{pageTitle}</h1>{children}</> }));
let client: QueryClient;
beforeEach(() => { session.role = "admin"; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.mocked(getAnalytics).mockResolvedValue(analyticsFixture); vi.mocked(getPrincipalInsights).mockResolvedValue(reviewFixture); });
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>; }
function mount(path = "/principal/insights?period=90&date=2026-10-07") {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/:portal/analytics/*" element={<LegacyAnalyticsRedirect />} />
    <Route path="/principal/insights" element={<AnalyticsPage portal="principal" />} />
    <Route path="/principal/insights/results" element={<AnalyticsPage portal="principal" topic="results" />} />
    <Route path="/principal/insights/attendance" element={<AnalyticsPage portal="principal" topic="attendance" />} />
    {(["review", "recording", "followups", "learning-review", "operations", "finance"] as const).map(topic => <Route key={topic} path={`/principal/insights/${topic}`} element={<PrincipalInsightsPage topic={topic} />} />)}
    <Route path="/principal/insights/review/:studentId" element={<PrincipalInsightsPage topic="review" />} />
    <Route path="/teacher/insights" element={<AnalyticsPage portal="teacher" />} />
    <Route path="/parent/insights" element={<AnalyticsPage portal="parent" />} />
    <Route path="/student/insights" element={<AnalyticsPage portal="student" />} />
  </Routes><Location /></MemoryRouter></QueryClientProvider>);
}

describe("unified Insights", () => {
  it("combines trends and operational highlights without duplicate attendance summaries or setup controls", async () => {
    mount();
    await screen.findByRole("link", { name: "Explore fee balances" });
    expect(screen.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Explore attendance", exact: true })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Explore results" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "For your attention" })).toBeVisible();
    expect(screen.queryByText("School intelligence")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Review window")).not.toBeInTheDocument();
    expect(screen.queryByText("Anaya Test")).not.toBeInTheDocument();
    expect(getPrincipalInsights).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Trend period"), { target: { value: "30" } });
    await waitFor(() => expect(getAnalytics).toHaveBeenLastCalledWith("school-1", "principal", "30", undefined, undefined));
    expect(getPrincipalInsights).toHaveBeenCalledTimes(1);
  });
  it("opens focused review pages and retains reporting context on Back", async () => {
    mount();
    fireEvent.click(await screen.findByRole("link", { name: /1 student to check in with/ }));
    await screen.findByRole("heading", { name: "Attendance review" });
    expect(screen.getByText("Anaya Test")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Outstanding fees" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Review Anaya Test" }));
    expect(await screen.findByRole("heading", { name: "Next step" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Review Class 7A register" })).toHaveAttribute("href", "/principal/attendance?class_section_id=class-7&date=2026-10-07");
    expect(screen.queryByRole("combobox", { name: "Class" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Back to Insights" }));
    await screen.findByRole("link", { name: "Review Anaya Test" });
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/insights/review?period=90&date=2026-10-07");
    fireEvent.click(screen.getByRole("link", { name: "Back to Insights" }));
    await screen.findByRole("link", { name: "Explore attendance" });
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/insights?period=90&date=2026-10-07");
  });
  it("shares a class filter without discarding legacy review parameters", async () => {
    mount("/principal/insights?insight_class=class-7&insight_days=14&period=30");
    await screen.findByRole("link", { name: "Explore attendance" });
    expect(getAnalytics).toHaveBeenCalledWith("school-1", "principal", "30", undefined, "class-7");
    expect(getPrincipalInsights).toHaveBeenCalledWith("school-1", expect.any(String), 14, "class-7", 50);
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "" } });
    await waitFor(() => expect(getPrincipalInsights).toHaveBeenLastCalledWith("school-1", expect.any(String), 14, "", 50));
    expect(screen.getByTestId("location")).not.toHaveTextContent("insight_class");
  });
  it("keeps operations independent when trend data fails", async () => {
    vi.mocked(getAnalytics).mockRejectedValue(new Error("Unavailable")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Trends could not be loaded");
    expect(await screen.findByRole("link", { name: "Explore fee balances" })).toBeVisible();
  });
  it("keeps trends available when operational data fails, and retries the shared query", async () => {
    vi.mocked(getPrincipalInsights).mockRejectedValueOnce(new Error("Unavailable")); mount();
    await screen.findByText("Attention summary unavailable.");
    expect(await screen.findByRole("link", { name: "Explore attendance" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Explore fee balances" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Explore fee balances" })).toBeVisible();
  });
  it.each([["teacher", "staff"], ["parent", "guardian"], ["student", "student"]] as const)("does not request administrator insights in the %s view", async (portal, role) => {
    session.role = role; mount(`/${portal}/insights`);
    await screen.findByRole("link", { name: "Explore results" });
    expect(getPrincipalInsights).not.toHaveBeenCalled();
    expect(screen.queryByText("School operations")).not.toBeInTheDocument();
  });
  it("does not request protected data for a non-admin directly opening a topic", async () => {
    session.role = "staff"; mount("/principal/insights/finance");
    expect(await screen.findByRole("alert")).toHaveTextContent("administrator access is required");
    expect(getPrincipalInsights).not.toHaveBeenCalled();
  });
  it("redirects old analytics bookmarks with all query context intact", async () => {
    mount("/principal/analytics/results?class=class-a&period=90");
    await screen.findByRole("heading", { name: "Published results" });
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/insights/results?class=class-a&period=90");
    expect(screen.getByRole("link", { name: "Learning review Published results below a review threshold" })).toHaveAttribute("href", "/principal/insights/learning-review?class=class-a&period=90&via=results");
  });
  it("keeps old deadline links working as a focused page", async () => {
    mount("/principal/insights?date=2026-10-07&insight_days=14#principal-deadlines");
    await screen.findByRole("heading", { name: "Overlapping deadlines" });
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/insights/operations?date=2026-10-07&insight_days=14#principal-deadlines");
    expect(screen.queryByLabelText("Trend period")).not.toBeInTheDocument();
  });
  it("shows threshold controls only on learning review and preserves the end date", async () => {
    mount("/principal/insights/learning-review?date=2026-10-07&period=90");
    await screen.findByRole("heading", { name: "Results to review" });
    fireEvent.change(screen.getByLabelText("Review marks below"), { target: { value: "60" } });
    await waitFor(() => expect(getPrincipalInsights).toHaveBeenLastCalledWith("school-1", "2026-10-07", 28, "", 60));
    expect(await screen.findByText(/publication dates, not assessment dates/)).toBeVisible();
  });
  it("keeps follow-up states distinct from resolutions and displays source owners", async () => {
    mount("/principal/insights/followups");
    await screen.findByRole("heading", { name: "Open follow-ups" });
    expect(screen.getByRole("figure", { name: /Current follow-up status/ })).toHaveAccessibleName(/1 open follow-ups/);
    expect(screen.getByText(/Owner: Teacher One/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open source register" })).toHaveAttribute("href", "/principal/attendance?class_section_id=class-7&date=2026-10-05");
  });
  it("renders actual currency amounts and does not offer irrelevant historical filters on fees", async () => {
    mount("/principal/insights/finance?period=90");
    await screen.findByRole("heading", { name: "Outstanding fees" });
    expect(screen.getByRole("list", { name: "Outstanding balance by age" })).toHaveTextContent("₹60");
    expect(screen.queryByLabelText("Review window")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Trend period")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open fee ledger" })).toHaveAttribute("href", "/principal/fees");
  });
  it("keeps review controls and calculation rules secondary to the actionable list", async () => {
    mount("/principal/insights/review?date=2026-10-07");
    await screen.findByRole("link", { name: "Review Anaya Test" });
    expect(screen.getByRole("heading", { name: "1 student may need a check-in" })).toBeVisible();
    expect(screen.getByLabelText("Review window")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Review period" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/homework items/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recording completeness" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review period" }));
    expect(screen.getByLabelText("Review window")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Review window"), { target: { value: "14" } });
    await waitFor(() => expect(getPrincipalInsights).toHaveBeenLastCalledWith("school-1", "2026-10-07", 14, "", 50));
  });
  it("prioritizes people without a follow-up and reuses existing conversations for owned work", async () => {
    const owned = { ...reviewFixture.engagement.students[0], id: "student-2", name: "Ben Test", open_followups: 1 };
    vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, engagement: { ...reviewFixture.engagement, total: 2, students: [...reviewFixture.engagement.students, owned] } });
    mount("/principal/insights/review?class=class-7");
    await screen.findByRole("link", { name: "Review Anaya Test" });
    expect(screen.queryByText("Ben Test")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All 2" }));
    fireEvent.click(screen.getByRole("link", { name: "Review Ben Test" }));
    expect(await screen.findByRole("link", { name: "Review existing follow-up" })).toHaveAttribute("href", "#attendance-followups");
    expect(screen.getByRole("region", { name: "Existing follow-ups" })).toHaveTextContent("student-2");
    expect(screen.queryByRole("link", { name: "Review Class 7A register" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Insights" })).toHaveAttribute("href", "/principal/insights/review?class=class-7&followup=all");
  });
  it("separates incomplete recording from individual attendance concerns", async () => {
    mount("/principal/insights/review?date=2026-10-07&insight_days=14");
    fireEvent.click(await screen.findByRole("link", { name: /Check missing attendance records/ }));
    expect(await screen.findByRole("heading", { name: "Recording completeness" })).toBeVisible();
    expect(screen.queryByText("Anaya Test")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review attendance registers" })).toHaveAttribute("href", "/principal/attendance?date=2026-10-07");
    expect(screen.getByRole("link", { name: "Back to Insights" })).toHaveAttribute("href", "/principal/insights/review?date=2026-10-07&insight_days=14");
  });
  it("does not invent detail for students outside the authorized current review", async () => {
    mount("/principal/insights/review/not-in-scope");
    expect(await screen.findByText(/not in the current review list/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "What changed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Existing follow-ups" })).not.toBeInTheDocument();
  });
  it("avoids an all-clear claim when no decline qualifies", async () => {
    vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, engagement: { total: 0, combined: 0, without_followup: 0, students: [], without_followup_students: [] } });
    mount("/principal/insights/review");
    expect(await screen.findByRole("heading", { name: "No attendance declines to review" })).toBeVisible();
    expect(screen.getByText(/Missing records still need checking/)).toBeVisible();
    expect(screen.getByRole("link", { name: /20 student-days unrecorded/ })).toBeVisible();
  });
  it("returns a related review to its parent topic instead of skipping to the overview", async () => {
    mount("/principal/insights/results?period=90");
    fireEvent.click(await screen.findByRole("link", { name: /Learning review Published results/ }));
    await screen.findByRole("heading", { name: "Results to review" });
    fireEvent.click(screen.getByRole("link", { name: "Back to Insights" }));
    expect(await screen.findByRole("heading", { name: "Published results" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/insights/results?period=90");
    expect(screen.getByTestId("location")).not.toHaveTextContent("via=");
  });
});
