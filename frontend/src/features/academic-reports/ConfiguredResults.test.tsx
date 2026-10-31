import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FamilyReportMarksheet } from "./AcademicReportWorkspacePage";
import { AssessmentMarksheet } from "../assessments/AssessmentMarksheet";
import type { FamilyReportCards, ResultPolicySnapshot } from "./api";
import type { FamilyResults } from "../assessments/api";

afterEach(cleanup);
const policy: ResultPolicySnapshot = { policy_id: "policy-1", name: "Institute credit policy", code: "CREDIT", version: 3, semantic_fingerprint: "frozen-3", configuration: { schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2, aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include", bands: [{ code: "A", label: "Excellent", minimum_percentage: 0, maximum_percentage: 100, grade_points: 9, passed: true }] } };
const data: FamilyReportCards = { student: { id: "student-1", first_name: "Aditi", last_name: "Vyas", admission_number: "AIT26017", class_name: "M.Tech Semester II" }, reports: [{ report_student_id: "report-1", batch_id: "batch-1", sequence: 1, published_at: "2026-10-26T10:00:00Z", correction_reason: "", scheme_id: "scheme-1", scheme_name: "Semester II results", term_name: "Semester II", academic_year: "2026-27", outcome: "complete", overall_percentage: "84.25", overall_grade: "A", gpa: "8.75", cgpa: "8.40", credit_total: "16", credit_points: "140", cumulative_credits: "32", cumulative_credit_points: "268.8", result_policy: policy, class_teacher_comment: "Steady progress.", principal_comment: "", subjects: [{ id: "subject-1", subject_name: "Distributed Systems", course_code: "CS602", credits: "4", grade_points: "9", color: "#2563eb", icon: "book", outcome: "complete", percentage: "84.25", grade: "A", passed: true }], cumulative_sources: [{ course_code: "CS602", credits: 4, grade_points: 9, passed: true, outcome: "complete", term_index: 2, batch_id: "batch-1", report_student_id: "report-1", report_subject_id: "subject-1", percentage: 84.25, included: true, reason: "latest_attempt" }] }] };

describe("published college result formats", () => {
  it("keeps full learner identity and narrow metric labels readable in the shared report styles", () => {
    // Source guard only; browser acceptance owns actual phone geometry.
    const css = readFileSync(resolve(process.cwd(), "src/features/academic-reports/academic-reports.css"), "utf8");
    const identityRule = css.match(/\.report-learner-identity strong,\s*\.report-learner-identity small\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(identityRule).toContain("white-space: normal");
    expect(identityRule).toContain("overflow-wrap: anywhere");
    expect(identityRule).not.toContain("ellipsis");
    expect(css).toMatch(/@media\s*\(max-width:\s*360px\)\s*\{\s*\.report-policy-facts\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
  it("prints the report release’s class, not the learner’s class after a transfer", () => {
    render(<FamilyReportMarksheet data={{ ...data, student: { ...data.student, class_name: "Current class B" } }} report={{ ...data.reports[0]!, class_name: "Historical class A" }} printing />);
    expect(screen.getByText("Class").nextElementSibling).toHaveTextContent("Historical class A");
    expect(screen.queryByText("Current class B")).not.toBeInTheDocument();
  });

  it("does not substitute a current class when the report’s historical context is unavailable", () => {
    render(<FamilyReportMarksheet data={{ ...data, student: { ...data.student, class_name: "Current class B" } }} report={{ ...data.reports[0]!, class_name: null }} printing />);
    expect(screen.getByText("Class").nextElementSibling).toHaveTextContent("Not recorded");
    expect(screen.queryByText("Current class B")).not.toBeInTheDocument();
  });
  it("shows frozen SGPA and CGPA with course points and credits, without an invented conversion", () => {
    render(<FamilyReportMarksheet data={data} report={data.reports[0]!} />);
    const summary = screen.getByLabelText("Overall result");
    expect(within(summary).getByText("8.75 / 10")).toBeVisible();
    expect(within(summary).getByText("8.40")).toBeVisible();
    expect(within(summary).queryByText("84.25%")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Subject results" });
    expect(within(table).getByRole("columnheader", { name: "Credits" })).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: "Points" })).toBeVisible();
    expect(within(table).queryByRole("columnheader", { name: "Score" })).not.toBeInTheDocument();
    expect(within(table).getByText("CS602")).toBeVisible();
    expect(screen.getByText(/Institute credit policy · Version 3/)).not.toBeVisible();
    expect(screen.getByText(/CS602 · Term 2 · 4 credits · 9 points · Included/)).not.toBeVisible();
  });

  it("shows a clear reason when earlier terms cannot produce CGPA", () => {
    render(<FamilyReportMarksheet data={data} report={{ ...data.reports[0]!, cgpa: null, cgpa_unavailable_reason: "missing_prior_terms" }} />);
    expect(screen.getByText("Earlier terms are not all published.")).toBeVisible();
    expect(screen.getByText("8.75 / 10")).toBeVisible();
    expect(screen.queryByText("8.40")).not.toBeInTheDocument();
  });

  it("keeps a grade-only report focused on grades and retains its frozen policy when printed", () => {
    const gradePolicy: ResultPolicySnapshot = { ...policy, configuration: { ...policy.configuration, result_format: "grade", grade_point_scale: null, aggregation: "equal" } };
    render(<FamilyReportMarksheet data={data} report={{ ...data.reports[0]!, result_policy: gradePolicy }} printing />);
    const summary = screen.getByLabelText("Overall result");
    expect(within(summary).getByText("A")).toBeVisible();
    expect(within(summary).queryByText("CGPA")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Subject results" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(within(table).queryByRole("columnheader", { name: "Score" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Points" })).not.toBeInTheDocument();
    expect(screen.getByText(/Institute credit policy · Version 3/)).toBeVisible();
  });

  it("labels assessment points separately from GPA and preserves original marks in record details", () => {
    const result: FamilyResults["results"][number] = { id: "assessment-1", title: "Distributed Systems examination", assessment_kind: "exam", maximum_marks: "80", scheduled_at: "2026-10-20T10:00:00Z", subject_name: "Distributed Systems", color: "#2563eb", icon: "book", cycle_name: "Semester II examinations", term_name: "Semester II", academic_year: "2026-27", class_name: "Historical class A", publication_id: "publication-1", sequence: 1, published_at: "2026-10-26T10:00:00Z", outcome: "scored", marks: "66", grade: "A", percentage: "82.50", grade_points: "9", result_policy: policy, feedback: "" };
    render(<AssessmentMarksheet data={{ student: data.student, results: [result] }} result={result} printing={false} onPrint={() => undefined} />);
    const summary = screen.getByLabelText("Assessment result");
    expect(within(summary).getByText("Grade points")).toBeVisible();
    expect(within(summary).getByText("9.00 / 10")).toBeVisible();
    expect(within(summary).queryByText("SGPA")).not.toBeInTheDocument();
    expect(within(summary).queryByText("82.50%")).not.toBeInTheDocument();
    expect(screen.getByText("66 / 80")).not.toBeVisible();
    expect(screen.getByText("Class").nextElementSibling).toHaveTextContent("Historical class A");
    expect(screen.queryByText("M.Tech Semester II")).not.toBeInTheDocument();
  });
});
