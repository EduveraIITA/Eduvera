import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AcademicReportWorkspacePage, FamilyReportCardList } from "./AcademicReportWorkspacePage";
import { getReportBatch, type AcademicReportWorkspace, type ReportBatchDetail } from "./api";

vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), getReportBatch: vi.fn(), getGradingScheme: vi.fn() }));

describe("published report cards", () => {
  it("shows the latest immutable term release and prints it", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<FamilyReportCardList data={{
      student: { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" },
      reports: [{
        report_student_id: "report-student-1", batch_id: "batch-1", sequence: 2, published_at: "2026-10-20T03:30:00.000Z", correction_reason: "Published assessment correction",
        scheme_id: "scheme-1", scheme_name: "Term 1 report", term_name: "Term 1", academic_year: "2026-27", outcome: "complete", overall_percentage: "82.50", overall_grade: "A",
        class_teacher_comment: "Consistent work.", principal_comment: "Keep progressing.", subjects: [{ id: "subject-1", subject_name: "English", color: "#2563eb", icon: "book", outcome: "complete", percentage: "82.50", grade: "A", passed: true }],
      }],
    }} />);
    expect(screen.getAllByText("82.50%")).toHaveLength(2);
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Corrected release")).toBeInTheDocument();
    expect(screen.queryByText("Official term result · Release 2")).not.toBeInTheDocument();
    expect(screen.getByText("Term report")).toBeInTheDocument();
    expect(screen.getByText("Published school record")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it("does not add another empty card when no report is published", () => {
    const { container } = render(<FamilyReportCardList data={{ student: { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" }, reports: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the release library and learner details compact until requested", async () => {
    vi.mocked(getReportBatch).mockResolvedValue({
      batch: { id: "batch-1", scheme_id: "scheme-1", scheme_name: "Term 1 report", class_name: "Class 7A", term_name: "Term 1", academic_year: "2026-27", review_mode: "independent", sequence: 1, status: "published", revision: 1, correction_reason: "", generated_at: "2026-10-05T03:30:00.000Z", published_at: "2026-10-05T04:30:00.000Z", learner_count: 1, incomplete_count: 0, class_section_id: "class-1", review_note: "Reviewed", publication_note: "Published" },
      students: [{ id: "report-student-1", student_id: "student-1", first_name: "Ananya", last_name: "Iyer", admission_number: "CIS-061", roll_number: 1, outcome: "complete", overall_percentage: "61.25", overall_grade: "C", class_teacher_comment: "Steady progress.", principal_comment: "Keep building.", comment_revision: 1 }],
      subjects: [{ id: "report-subject-1", report_student_id: "report-student-1", subject_name: "English", color: "#7c3aed", icon: "book", outcome: "complete", percentage: "61.25", grade: "C", passed: true }],
      components: [],
    } satisfies ReportBatchDetail);
    const data = {
      mode: "admin",
      schemes: [{ id: "scheme-1", term_id: "term-1", class_section_id: "class-1", name: "Term 1 report", code: "TERM-1", status: "active", absence_treatment: "incomplete", review_mode: "independent", revision: 1, term_name: "Term 1", academic_year: "2026-27", class_name: "Class 7A", subject_count: 1, report_count: 1 }],
      batches: [{ id: "batch-1", scheme_id: "scheme-1", scheme_name: "Term 1 report", class_name: "Class 7A", term_name: "Term 1", review_mode: "independent", sequence: 1, status: "published", revision: 1, correction_reason: "", generated_at: "2026-10-05T03:30:00.000Z", published_at: "2026-10-05T04:30:00.000Z", learner_count: 1, incomplete_count: 0 }],
      references: { terms: [{ id: "term-1", name: "Term 1", academic_year: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31" }], classes: [{ id: "class-1", name: "Class 7A", academic_year: "2026-27" }], subjects: [], assessments: [] },
    } satisfies AcademicReportWorkspace;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><AcademicReportWorkspacePage portal="principal" schoolId="school-1" data={data} refresh={vi.fn().mockResolvedValue(undefined)} /></QueryClientProvider>);
    const page = within(view.container);

    expect(page.getByRole("tab", { name: /Releases 1/ })).toHaveAttribute("aria-selected", "true");
    expect(await page.findByText("Ananya Iyer")).toBeInTheDocument();
    expect(page.queryByText("English")).not.toBeInTheDocument();
    fireEvent.click(page.getByRole("button", { name: /Ananya Iyer/ }));
    expect(page.getByText("English")).toBeInTheDocument();
    expect(page.getByText("Steady progress.")).toBeInTheDocument();
  });
});
