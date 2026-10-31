import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyReportCards } from "../academic-reports/api";
import type { FamilyResults } from "./api";
import { FamilyResultsPage } from "./FamilyResultsPage";

vi.mock("../../pages/parent/ParentShell", () => ({ ParentShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children, title, backTo, onBack }: { children: ReactNode; title: string; backTo?: string; onBack?: () => void }) => {
    const navigate = useNavigate();
    return <main><h1>{title}</h1>{backTo || onBack ? <button type="button" aria-label="Go back" onClick={() => onBack ? onBack() : void navigate(backTo!)}>Back</button> : null}{children}</main>;
  },
}));

const student = { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" };
type PublishedAssessment = FamilyResults["results"][number];
type PublishedReport = FamilyReportCards["reports"][number];

function assessment(overrides: Partial<PublishedAssessment> = {}): PublishedAssessment {
  return {
    id: "assessment-1", title: "English mid-term", assessment_kind: "exam", maximum_marks: "80.00",
    scheduled_at: "2026-10-12T03:30:00.000Z", subject_name: "English", color: "#2563eb", icon: "book",
    cycle_name: "Term 1 examinations", term_name: "Term 1", academic_year: "2026-27",
    publication_id: "publication-1", sequence: 1, published_at: "2026-10-20T03:30:00.000Z",
    outcome: "scored", marks: "66.00", grade: "A", feedback: "Clear written work", ...overrides,
  };
}

function report(overrides: Partial<PublishedReport> = {}): PublishedReport {
  return {
    report_student_id: "report-student-1", batch_id: "batch-1", sequence: 1,
    published_at: "2026-10-20T03:30:00.000Z", correction_reason: "", scheme_id: "scheme-1",
    scheme_name: "Term 1 report", term_name: "Term 1", academic_year: "2026-27", outcome: "complete",
    overall_percentage: "82.50", overall_grade: "A", class_teacher_comment: "Consistent work.",
    principal_comment: "Keep progressing.", subjects: [{ id: "subject-1", subject_name: "English", color: "#2563eb",
      icon: "book", outcome: "complete", percentage: "82.50", grade: "A", passed: true, assessment_ids: ["assessment-1"] }], ...overrides,
  };
}

function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button type="button" onClick={() => void navigate(-1)}>Browser back</button><button type="button" onClick={() => void navigate(1)}>Browser forward</button></>;
}

function renderResults({
  results = [], reports, path = "/areas/assessments/results?scope=self&student_id=student-1", children = [], onSelect = vi.fn(),
}: {
  results?: PublishedAssessment[]; reports?: PublishedReport[]; path?: string;
  children?: Array<{ id: string; user: { display_name: string }; current_enrollment: { grade: string; section: string }; avatar_url: string }>;
  onSelect?: (id: string) => void;
} = {}) {
  return render(<MemoryRouter initialEntries={[path]}><HistoryControls /><FamilyResultsPage presentation="workspace" children={children} onSelect={onSelect} data={{ student, results }} reportCards={reports ? { student, reports } : undefined} /></MemoryRouter>);
}

function locationParams() {
  return new URL(screen.getByTestId("location").textContent, "https://thatcampus.test").searchParams;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("published family results", () => {
  it.each(["/areas/reports/progress", "/areas/assessments/results"])("leaves a directly opened %s library through the actual Areas list", path => {
    renderResults({ path, results: [assessment()] });
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/areas$/);
  });

  it("keeps the learner context explicit in the composed workspace", () => {
    const onSelect = vi.fn();
    renderResults({ children: [
      { id: "student-1", user: { display_name: "Aarav Sharma" }, current_enrollment: { grade: "7", section: "A" }, avatar_url: "" },
      { id: "student-2", user: { display_name: "Mira Sharma" }, current_enrollment: { grade: "5", section: "B" }, avatar_url: "" },
    ], onSelect });

    expect(screen.getByRole("heading", { name: "Results & progress" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Choose learner" }), { target: { value: "student-2" } });
    expect(onSelect).toHaveBeenCalledWith("student-2");
  });

  it("offers compact records before opening a full marksheet", () => {
    renderResults({ results: [assessment()] });

    const link = screen.getByRole("link", { name: "English mid-term", exact: true });
    expect(link).toBeVisible();
    expect(link).toHaveAccessibleDescription(/66\.00\/80\.00/);
    expect(screen.getByText("Aarav Sharma", { exact: true })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print / save marksheet" })).not.toBeInTheDocument();
    fireEvent.click(link);

    expect(locationParams().get("assessment_id")).toBe("assessment-1");
    expect(locationParams().get("publication_id")).toBe("publication-1");
    expect(screen.getByRole("region", { name: "Published result" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "English mid-term" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Subject results" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Print / save marksheet" })).toBeVisible();
  });

  it("retains exact corrected marks, feedback and record identity", () => {
    renderResults({ results: [assessment({ sequence: 2 })], path: "/areas/assessments/results?student_id=student-1&assessment_id=assessment-1&publication_id=publication-1" });

    const result = screen.getByRole("region", { name: "Published result" });
    expect(within(result).getByText("82.50%")).toBeVisible();
    expect(within(result).getByText("66.00/80.00")).toBeVisible();
    expect(within(result).getByText("Corrected release")).toBeVisible();
    expect(within(result).getByText("Clear written work")).toBeVisible();
    fireEvent.click(within(result).getByText("Record details").closest("summary")!);
    for (const element of within(result).getAllByText("Aarav Sharma")) expect(element).toBeVisible();
    expect(within(result).getByText("A-1")).toBeVisible();
    expect(within(result).getByText("Reference")).toBeVisible();
    expect(within(result).getByText("PUBLICAT")).toBeVisible();
  });

  it("deduplicates term-covered assessments only in All and keeps the assessment source available", () => {
    renderResults({ results: [assessment(), assessment({ id: "assessment-2", publication_id: "publication-2", title: "Mathematics class test", subject_name: "Mathematics" })], reports: [report()] });

    expect(screen.getByRole("link", { name: "Term 1 report", exact: true })).toBeVisible();
    expect(screen.getByRole("link", { name: "Mathematics class test", exact: true })).toBeVisible();
    expect(screen.queryByRole("link", { name: "English mid-term", exact: true })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Result type" }), { target: { value: "assessment" } });
    expect(screen.getByRole("link", { name: "English mid-term", exact: true })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Term 1 report", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "English mid-term", exact: true }));
    expect(screen.getByRole("heading", { name: "English mid-term" })).toBeVisible();
  });

  it("searches across years before pagination and clears the search when closed", () => {
    renderResults({ results: [assessment(), assessment({ id: "assessment-2", publication_id: "publication-2", title: "Mathematics unit test", subject_name: "Mathematics", academic_year: "2025-26" })] });

    expect(screen.queryByRole("textbox", { name: "Search results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mathematics unit test", exact: true })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Academic year" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Search results", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search results" }), { target: { value: "mathematics" } });
    expect(locationParams().get("result_search")).toBe("mathematics");
    expect(screen.getByRole("link", { name: "Mathematics unit test", exact: true })).toBeVisible();
    expect(screen.queryByRole("link", { name: "English mid-term", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(locationParams().has("result_search")).toBe(false);
    expect(screen.getByRole("link", { name: "English mid-term", exact: true })).toBeVisible();
    expect(screen.getByRole("link", { name: "Mathematics unit test", exact: true })).toBeVisible();
  });

  it("uses finite pages while filters search the complete result set", () => {
    renderResults({ results: Array.from({ length: 12 }, (_, index) => assessment({ id: `assessment-${index + 1}`, publication_id: `publication-${index + 1}`, title: `Assessment ${index + 1}`, subject_name: index === 11 ? "Biology" : "English" })) });

    expect(screen.getByText("1–10 of 12 results")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /^Assessment \d+$/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Next results page" }));
    expect(locationParams().get("result_page")).toBe("2");
    expect(screen.getByText("11–12 of 12 results")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /^Assessment \d+$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Search results", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search results" }), { target: { value: "Biology" } });
    expect(screen.getByRole("link", { name: "Assessment 12", exact: true })).toBeVisible();
    expect(locationParams().get("result_page")).not.toBe("2");
    expect(screen.queryByRole("button", { name: "Next results page" })).not.toBeInTheDocument();
  });

  it("returns to the same list URL, filters and page after opening a result", () => {
    const results = Array.from({ length: 12 }, (_, index) => assessment({ id: `assessment-${index + 1}`, publication_id: `publication-${index + 1}`, title: `English assessment ${index + 1}` }));
    const path = "/areas/assessments/results?scope=self&student_id=student-1&result_year=all&result_kind=assessment&result_search=English&result_page=2";
    renderResults({ results, path });
    const record = screen.getAllByRole("link", { name: /^English assessment \d+$/ })[0]!;
    const title = record.textContent;
    fireEvent.click(record);
    expect(locationParams().get("result_page")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent(path);
    expect(locationParams().has("assessment_id")).toBe(false);
    expect(screen.getByRole("combobox", { name: "Academic year" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Result type" })).toHaveValue("assessment");
    expect(screen.getByRole("textbox", { name: "Search results" })).toHaveValue("English");
    expect(screen.getByText("11–12 of 12 results")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /^English assessment \d+$/ }).some(link => link.textContent === title)).toBe(true);
  });

  it("supports browser Back and Forward between the library and exact selected record", () => {
    renderResults({ results: [assessment()] });
    fireEvent.click(screen.getByRole("link", { name: "English mid-term", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(screen.getByRole("link", { name: "English mid-term", exact: true })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Published result" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));
    expect(screen.getByRole("region", { name: "Published result" })).toBeVisible();
    expect(locationParams().get("publication_id")).toBe("publication-1");
  });

  it("opens the exact attention-linked assessment even when the library filters exclude it", () => {
    renderResults({ results: [assessment(), assessment({ id: "assessment-2", publication_id: "publication-2", title: "Earlier Mathematics result", academic_year: "2025-26" })], path: "/areas/assessments/results?student_id=student-1&result_year=2026-27&result_search=English&assessment_id=assessment-2&publication_id=publication-2" });

    expect(screen.getByRole("heading", { name: "Earlier Mathematics result" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "English mid-term" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "English mid-term", exact: true })).not.toBeInTheDocument();
  });

  it("opens the exact report batch without mounting neighboring assessment documents", () => {
    renderResults({ results: [assessment()], reports: [report()], path: "/areas/reports/progress?student_id=student-1&report_batch_id=batch-1" });
    const result = screen.getByRole("region", { name: "Published result" });
    expect(within(result).getByRole("heading", { name: "Term 1 report" })).toBeVisible();
    expect(within(result).getByRole("table", { name: "Subject results" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "English mid-term" })).not.toBeInTheDocument();
  });

  it.each([
    "assessment_id=assessment-1&publication_id=old-publication",
    "assessment_id=unknown&publication_id=publication-1",
    "report_batch_id=unknown-batch",
  ])("does not substitute another record for an unavailable target (%s)", target => {
    renderResults({ results: [assessment()], reports: [report()], path: `/areas/assessments/results?student_id=student-1&${target}` });
    expect(screen.getByText("Published result unavailable")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print / save marksheet" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Back to results" }));
    expect(screen.getByRole("link", { name: "Term 1 report", exact: true })).toBeVisible();
    expect(locationParams().has("assessment_id")).toBe(false);
    expect(locationParams().has("publication_id")).toBe(false);
    expect(locationParams().has("report_batch_id")).toBe(false);
  });

  it("keeps a scored zero visible without converting it into an unknown result", () => {
    renderResults({ results: [assessment({ marks: "0.00", grade: "F" })], path: "/areas/assessments/results?student_id=student-1&assessment_id=assessment-1&publication_id=publication-1" });
    const result = screen.getByRole("region", { name: "Published result" });
    expect(within(result).getByText("0.00/80.00")).toBeVisible();
    expect(within(result).getByText("0.00%")).toBeVisible();
  });

  it.each(["absent", "withheld", "exempt", "not_evaluated"] as const)("does not invent a score or percentage for %s", outcome => {
    renderResults({ results: [assessment({ outcome, marks: null, grade: "" })], path: "/areas/assessments/results?student_id=student-1&assessment_id=assessment-1&publication_id=publication-1" });
    const result = screen.getByRole("region", { name: "Published result" });
    expect(within(result).getAllByText(outcome.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())).length).toBeGreaterThan(0);
    expect(within(result).queryByText("0.00%")).not.toBeInTheDocument();
    expect(within(result).queryByText("0.00/80.00")).not.toBeInTheDocument();
    expect(within(result).queryByText("82.50%")).not.toBeInTheDocument();
  });

  it("prints only the selected published record", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderResults({ results: [assessment(), assessment({ id: "assessment-2", publication_id: "publication-2", title: "Mathematics class test" })] });
    fireEvent.click(screen.getByRole("link", { name: "Mathematics class test", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Print / save marksheet" }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Mathematics class test" })).toBeInTheDocument();
    expect(screen.queryByText("English mid-term")).not.toBeInTheDocument();
    fireEvent(window, new Event("afterprint"));
  });

  it("distinguishes an unpublished library from a search with no matches", () => {
    const view = renderResults();
    expect(screen.getByText("No published results")).toBeVisible();
    view.unmount();
    renderResults({ results: [assessment()], path: "/areas/assessments/results?student_id=student-1&result_search=Biology" });
    expect(screen.getByText("No matching results")).toBeVisible();
    expect(screen.queryByText("No published results")).not.toBeInTheDocument();
  });
});
