import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAnalytics } from "../analytics/api";
import { getPrincipalInsights } from "../principal-insights/api";
import { analyticsFixture, reviewFixture } from "../principal-insights/insight-test-fixtures";
import { PrincipalSchoolPulse } from "./PrincipalSchoolPulse";
import { usePrincipalHomeQueries } from "./usePrincipalHomeQueries";

const auth = vi.hoisted(() => ({ user: { id: "principal", active_school_id: "school-1" }, memberships: [{ school_id: "school-1", role: "admin" }] }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../analytics/api", () => ({ getAnalytics: vi.fn() }));
vi.mock("../principal-insights/api", () => ({ getPrincipalInsights: vi.fn() }));
let client: QueryClient;
beforeEach(() => {
  auth.memberships = [{ school_id: "school-1", role: "admin" }];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getAnalytics).mockResolvedValue(analyticsFixture);
  vi.mocked(getPrincipalInsights).mockResolvedValue(reviewFixture);
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
function Content() { return <PrincipalSchoolPulse queries={usePrincipalHomeQueries("2026-10-01")} />; }
function mount() { render(<QueryClientProvider client={client}><MemoryRouter><Content /></MemoryRouter></QueryClientProvider>); }

describe("principal school pulse", () => {
  it("labels periods and counted evidence separately from the selected home date", async () => {
    mount();
    const attendance = await screen.findByRole("link", { name: "Explore term attendance" });
    expect(attendance).toHaveTextContent("75%");
    expect(attendance).toHaveTextContent("4.5 of 6 recorded student-days attended");
    expect(attendance).toHaveTextContent("Through 8 Oct · unrecorded days excluded");
    expect(attendance).toHaveAttribute("href", "/principal/insights/attendance?period=term");
    expect(within(attendance).getByRole("figure")).toHaveAccessibleName(/Missing periods are gaps, not zero/);
    const results = screen.getByRole("link", { name: "Explore published result averages" });
    expect(results).toHaveTextContent("80%");
    expect(results).toHaveTextContent("3 scored results");
    expect(results).toHaveTextContent("Term average · through 8 Oct");
    expect(results).toHaveAttribute("href", "/principal/insights/results?period=term");
    const coverage = screen.getByRole("link", { name: "Explore next seven days of teaching coverage" });
    expect(coverage).toHaveTextContent("80%");
    expect(coverage).toHaveTextContent("4 of 5 periods assigned");
    expect(coverage).toHaveTextContent("7 days from 7 Oct");
    expect(coverage).toHaveTextContent("1 still unassigned");
    expect(coverage).toHaveAttribute("href", "/principal/insights/operations");
    expect(getPrincipalInsights).toHaveBeenCalledWith("school-1", "2026-10-01", 28, "", 50);
    expect(getAnalytics).toHaveBeenCalledWith("school-1", "principal", "term");
  });
  it("does not label fees due today as overdue", async () => {
    vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, fees: [...reviewFixture.fees, { band: "Due today", due_paise: 2000, paid_paise: 0, balance_paise: 2000 }] });
    mount();
    const fees = await screen.findByRole("link", { name: "Explore outstanding fee balances" });
    expect(fees).toHaveTextContent("₹80");
    expect(fees).toHaveTextContent("₹60 overdue");
    expect(fees).not.toHaveTextContent("₹80 overdue");
    expect(fees).toHaveTextContent("Of ₹120 due by 7 Oct · future instalments excluded");
    expect(fees).toHaveAttribute("href", "/principal/insights/finance");
  });
  it("keeps empty evidence distinct from zero performance or complete coverage", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...analyticsFixture,
      attendance: { ...analyticsFixture.attendance!, percentage: null, attended: 0, denominator: 0, trend: [] },
      assessments: { ...analyticsFixture.assessments!, overall: { ...analyticsFixture.assessments!.overall, average: null, scored: 0 } },
    });
    vi.mocked(getPrincipalInsights).mockResolvedValue({ ...reviewFixture, schedule: [], fees: [] });
    mount();
    await screen.findByText("Not recorded");
    expect(screen.getByText("No scores")).toBeInTheDocument();
    expect(screen.getByText("No periods")).toBeInTheDocument();
    expect(screen.getByText(/No fees due as of 7 Oct/)).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });
  it("keeps loading explicit rather than showing fake zero metrics", () => {
    vi.mocked(getAnalytics).mockReturnValue(new Promise(() => {}));
    vi.mocked(getPrincipalInsights).mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole("status", { name: "Loading school pulse" })).toBeInTheDocument();
    expect(screen.getByText("Loading coverage and fees…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("keeps operational metrics available when academic data fails and supports retry", async () => {
    vi.mocked(getAnalytics).mockRejectedValueOnce(new Error("Unavailable")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Attendance trends and results couldn’t load.");
    expect(screen.getByRole("link", { name: "Explore outstanding fee balances" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry school pulse" }));
    await screen.findByRole("link", { name: "Explore term attendance" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps academic metrics available when operational data fails", async () => {
    vi.mocked(getPrincipalInsights).mockRejectedValue(new Error("Unavailable")); mount();
    await screen.findByText("Coverage and fee balances are unavailable.");
    expect(screen.getByRole("link", { name: "Explore published result averages" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Explore outstanding fee balances" })).not.toBeInTheDocument();
  });
  it("does not request school-wide metrics without an active-school admin membership", () => {
    auth.memberships = [{ school_id: "school-1", role: "teacher" }]; mount();
    expect(getPrincipalInsights).not.toHaveBeenCalled();
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
