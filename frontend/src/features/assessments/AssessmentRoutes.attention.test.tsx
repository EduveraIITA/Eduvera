import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { FamilyResultsRoute } from "./AssessmentRoutes";

const mocks = vi.hoisted(() => ({
  getStudents: vi.fn(),
  getResults: vi.fn(),
  getReports: vi.fn(),
  refresh: vi.fn(),
  actorId: "guardian-1",
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: mocks.actorId, active_school_id: "school-1" }, memberships: [{ role: "guardian", school_id: "school-1" }], refresh: mocks.refresh }),
}));
vi.mock("../school/api", () => ({ getAccessibleStudents: mocks.getStudents }));
vi.mock("./api", () => ({
  getAssessmentWorkspace: vi.fn(),
  getFamilyResults: mocks.getResults,
}));
vi.mock("../academic-reports/api", () => ({ getFamilyReportCards: mocks.getReports }));
vi.mock("./AssessmentWorkspacePage", () => ({ AssessmentWorkspacePage: () => null }));
vi.mock("./FamilyResultsPage", () => ({
  FamilyResultsPage: ({ data, reportCards, onSelect, sourceNotice }: { data: { results: unknown[] }; reportCards?: { reports: unknown[] }; onSelect: (id: string) => void; sourceNotice?: React.ReactNode }) => (
    <>{sourceNotice}<output data-testid="results-page">{data.results.length}:{reportCards?.reports.length ?? 0}</output><button type="button" onClick={() => onSelect("student-2")}>Switch child</button></>
  ),
}));
vi.mock("../attention/AttentionOpenAcknowledgement", () => ({
  AttentionOpenAcknowledgement: () => <output data-testid="acknowledgement" />,
}));

const student = {
  id: "student-1",
  user: { display_name: "Aarav Sharma" },
  current_enrollment: { grade: "7", section: "A" },
  avatar_url: "",
};
const identity = {
  id: "student-1", first_name: "Aarav", last_name: "Sharma",
  admission_number: "A-1", class_name: "Class 7A",
};

function renderRoute(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/parent/more", path]} initialIndex={1}>
        <LocationProbe />
        <HistoryBack />
        <Routes><Route path="/parent/results" element={<FamilyResultsRoute portal="parent" />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function HistoryBack() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Browser back</button>;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  mocks.actorId = "guardian-1";
  mocks.refresh.mockResolvedValue(undefined);
  mocks.getStudents.mockResolvedValue({ results: [student] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("family result attention targets", () => {
  it("opens an exact assessment even if the unrelated report-card request fails", async () => {
    mocks.getResults.mockResolvedValue({
      student: identity,
      results: [{ id: "assessment-1", publication_id: "publication-1" }],
    });
    mocks.getReports.mockRejectedValue(new Error("report service unavailable"));

    renderRoute("/parent/results?student_id=student-1&assessment_id=assessment-1&publication_id=publication-1&attention_notification_id=10000000-0000-4000-a000-000000000001");

    expect(await screen.findByTestId("acknowledgement")).toBeInTheDocument();
    expect(screen.getByTestId("results-page")).toHaveTextContent("1:0");
  });

  it("opens an exact report card even if the unrelated assessment request fails", async () => {
    mocks.getResults.mockRejectedValue(new Error("assessment service unavailable"));
    mocks.getReports.mockResolvedValue({
      student: identity,
      reports: [{ batch_id: "batch-1" }],
    });

    renderRoute("/parent/results?student_id=student-1&report_batch_id=batch-1&attention_notification_id=10000000-0000-4000-a000-000000000001");

    expect(await screen.findByTestId("acknowledgement")).toBeInTheDocument();
    expect(screen.getByTestId("results-page")).toHaveTextContent("0:1");
  });

  it("clears the prior child's exact target when the family switches children", async () => {
    mocks.getResults.mockResolvedValue({ student: identity, results: [{ id: "assessment-1", publication_id: "publication-1" }] });
    mocks.getReports.mockResolvedValue({ student: identity, reports: [{ batch_id: "batch-1" }] });
    renderRoute("/parent/results?student_id=student-1&assessment_id=assessment-1&publication_id=publication-1&report_batch_id=batch-1&attention_notification_id=10000000-0000-4000-a000-000000000001&period=30&view=summary");
    await screen.findByRole("button", { name: "Switch child" });

    fireEvent.click(screen.getByRole("button", { name: "Switch child" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/results?student_id=student-2"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("assessment_id");
    expect(screen.getByTestId("location")).not.toHaveTextContent("publication_id");
    expect(screen.getByTestId("location")).not.toHaveTextContent("report_batch_id");
    expect(screen.getByTestId("location")).not.toHaveTextContent("attention_notification_id");
    expect(screen.getByTestId("location")).toHaveTextContent("period=30");
    expect(screen.getByTestId("location")).toHaveTextContent("view=summary");

    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/more"));
  });

  it("shows an honest partial library and retries only the failed assessment source", async () => {
    mocks.getResults.mockRejectedValueOnce(new Error("Assessment service unavailable"))
      .mockResolvedValueOnce({ student: identity, results: [{ id: "assessment-1", publication_id: "publication-1" }] });
    mocks.getReports.mockResolvedValue({ student: identity, reports: [{ batch_id: "batch-1" }] });
    renderRoute("/parent/results?student_id=student-1");

    expect(await screen.findByTestId("results-page")).toHaveTextContent("0:1");
    expect(screen.getByText("Assessment results couldn’t be loaded. Term reports are available.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    await waitFor(() => expect(screen.getByTestId("results-page")).toHaveTextContent("1:1"));
    expect(mocks.getResults).toHaveBeenCalledTimes(2);
    expect(mocks.getReports).toHaveBeenCalledOnce();
    expect(screen.queryByText("Assessment results couldn’t be loaded. Term reports are available.")).not.toBeInTheDocument();
  });

  it("shows an honest partial library and retries only the failed term report source", async () => {
    mocks.getResults.mockResolvedValue({ student: identity, results: [{ id: "assessment-1", publication_id: "publication-1" }] });
    mocks.getReports.mockRejectedValueOnce(new Error("Report service unavailable"))
      .mockResolvedValueOnce({ student: identity, reports: [{ batch_id: "batch-1" }] });
    renderRoute("/parent/results?student_id=student-1");

    expect(await screen.findByTestId("results-page")).toHaveTextContent("1:0");
    expect(screen.getByText("Term reports couldn’t be loaded. Assessment results are available.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    await waitFor(() => expect(screen.getByTestId("results-page")).toHaveTextContent("1:1"));
    expect(mocks.getReports).toHaveBeenCalledTimes(2);
    expect(mocks.getResults).toHaveBeenCalledOnce();
    expect(screen.queryByText("Term reports couldn’t be loaded. Assessment results are available.")).not.toBeInTheDocument();
  });

  it("waits for both ordinary library sources before reporting an empty result set", async () => {
    let finishReports!: (value: { student: typeof identity; reports: unknown[] }) => void;
    mocks.getResults.mockResolvedValue({ student: identity, results: [] });
    mocks.getReports.mockImplementation(() => new Promise(resolve => { finishReports = resolve; }));
    renderRoute("/parent/results?student_id=student-1");

    await waitFor(() => expect(mocks.getReports).toHaveBeenCalledOnce());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("results-page")).not.toBeInTheDocument();
    await act(async () => { finishReports({ student: identity, reports: [{ batch_id: "batch-1" }] }); await Promise.resolve(); });
    expect(await screen.findByTestId("results-page")).toHaveTextContent("0:1");
  });

  it("does not acknowledge a stale publication or substitute its current release", async () => {
    mocks.getResults.mockResolvedValue({ student: identity, results: [{ id: "assessment-1", publication_id: "current-publication" }] });
    mocks.getReports.mockResolvedValue({ student: identity, reports: [] });
    renderRoute("/parent/results?student_id=student-1&assessment_id=assessment-1&publication_id=old-publication&attention_notification_id=10000000-0000-4000-a000-000000000001");

    await screen.findByTestId("results-page");
    expect(screen.queryByTestId("acknowledgement")).not.toBeInTheDocument();
    expect(screen.getByText("This published result no longer matches an available record. It was not marked as opened.")).toBeVisible();
  });

  it("keeps delayed Live family results out of the selected Simulation and another actor's cache", async () => {
    const simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "scenario:results:run:one", runId: "results-run-one", virtualClock: { now: "2026-10-26T09:00:00.000Z", timeZone: "Asia/Kolkata" } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const liveAssessments = { student: identity, results: [{ id: "live-assessment-1" }, { id: "live-assessment-2" }] };
    const liveReports = { student: identity, reports: [{ batch_id: "live-report-1" }, { batch_id: "live-report-2" }] };
    const runAssessments = { student: identity, results: [{ id: "run-assessment-1" }] };
    const runReports = { student: identity, reports: [{ batch_id: "run-report-1" }] };
    let finishLiveAssessments!: (value: typeof liveAssessments) => void;
    let finishLiveReports!: (value: typeof liveReports) => void;
    mocks.getResults.mockImplementationOnce(() => new Promise(resolve => { finishLiveAssessments = resolve; })).mockResolvedValue(runAssessments);
    mocks.getReports.mockImplementationOnce(() => new Promise(resolve => { finishLiveReports = resolve; })).mockResolvedValue(runReports);
    const domainKey = (domain: string, actor: string) => [domain, "family", "school-1", "student-1", "actor", actor] as const;
    client.setQueryData(executionEnvironmentQueryKey(simulation, domainKey("assessments", "another-guardian")), liveAssessments);
    client.setQueryData(executionEnvironmentQueryKey(simulation, domainKey("academic-reports", "another-guardian")), liveReports);
    const tree = (environment: ExecutionEnvironment) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={["/parent/results?student_id=student-1"]}><FamilyResultsRoute portal="parent" /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
    const view = render(tree({ mode: "live" }));
    await waitFor(() => { expect(mocks.getResults).toHaveBeenCalledOnce(); expect(mocks.getReports).toHaveBeenCalledOnce(); });
    expect(screen.queryByTestId("results-page")).not.toBeInTheDocument();

    view.rerender(tree(simulation));
    expect(await screen.findByTestId("results-page")).toHaveTextContent("1:1");
    expect(mocks.getResults).toHaveBeenCalledTimes(2);
    expect(mocks.getReports).toHaveBeenCalledTimes(2);
    await act(async () => { finishLiveAssessments(liveAssessments); finishLiveReports(liveReports); await Promise.resolve(); });
    expect(screen.getByTestId("results-page")).toHaveTextContent("1:1");
    for (const [domain, liveData, runData] of [["assessments", liveAssessments, runAssessments], ["academic-reports", liveReports, runReports]] as const) {
      expect(client.getQueryData(executionEnvironmentQueryKey({ mode: "live" }, domainKey(domain, "guardian-1")))).toEqual(liveData);
      expect(client.getQueryData(executionEnvironmentQueryKey(simulation, domainKey(domain, "guardian-1")))).toEqual(runData);
      expect(client.getQueryData(executionEnvironmentQueryKey(simulation, domainKey(domain, "another-guardian")))).toEqual(liveData);
    }
  });

  it("offers recovery without reading family data or cached Live records in an unavailable Simulation", async () => {
    const environment: ExecutionEnvironment = { mode: "simulation", unavailable: true, unavailableReason: "authorization_lost", namespaceId: "scenario:results:run:lost", runId: "lost-results-run" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(executionEnvironmentQueryKey({ mode: "live" }, ["assessments", "family", "school-1", "student-1", "actor", "guardian-1"]), { student: identity, results: [{ id: "live-assessment" }] });
    client.setQueryData(executionEnvironmentQueryKey({ mode: "live" }, ["academic-reports", "family", "school-1", "student-1", "actor", "guardian-1"]), { student: identity, reports: [{ batch_id: "live-report" }] });
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={["/parent/results?student_id=student-1"]}><FamilyResultsRoute portal="parent" /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("results-page")).not.toBeInTheDocument();
    expect(mocks.getStudents).not.toHaveBeenCalled();
    expect(mocks.getResults).not.toHaveBeenCalled();
    expect(mocks.getReports).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.getStudents).not.toHaveBeenCalled();
    expect(mocks.getResults).not.toHaveBeenCalled();
    expect(mocks.getReports).not.toHaveBeenCalled();
  });
});
