import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FamilyReportCardList } from "./AcademicReportWorkspacePage";

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
    expect(screen.getByText("Correction 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it("does not add another empty card when no report is published", () => {
    const { container } = render(<FamilyReportCardList data={{ student: { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" }, reports: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
