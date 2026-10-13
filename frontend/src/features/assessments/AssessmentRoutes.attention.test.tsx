import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyResultsRoute } from "./AssessmentRoutes";

const mocks = vi.hoisted(() => ({
  getStudents: vi.fn(),
  getResults: vi.fn(),
  getReports: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ memberships: [{ role: "guardian", school_id: "school-1" }] }),
}));
vi.mock("../school/api", () => ({ getAccessibleStudents: mocks.getStudents }));
vi.mock("./api", () => ({
  getAssessmentWorkspace: vi.fn(),
  getFamilyResults: mocks.getResults,
}));
vi.mock("../academic-reports/api", () => ({ getFamilyReportCards: mocks.getReports }));
vi.mock("./AssessmentWorkspacePage", () => ({
  AssessmentWorkspacePage: () => null,
  FamilyResultsPage: ({ data, reportCards, onSelect }: { data: { results: unknown[] }; reportCards?: { reports: unknown[] }; onSelect: (id: string) => void }) => (
    <><output data-testid="results-page">{data.results.length}:{reportCards?.reports.length ?? 0}</output><button type="button" onClick={() => onSelect("student-2")}>Switch child</button></>
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
});
