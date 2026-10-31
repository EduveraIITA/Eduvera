import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportSchemeDialog } from "./ReportSchemeDialog";
import { createGradingScheme, type AcademicReportWorkspace, type GradingPolicy } from "./api";

vi.mock("./api", async (original) => ({ ...(await original<typeof import("./api")>()), createGradingScheme: vi.fn() }));
afterEach(cleanup);
const policy: GradingPolicy = { id: "policy-1", name: "Programme credits", code: "CREDITS", version: 2, status: "active", revision: 3, configuration: { schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2, aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include", bands: [{ code: "P", label: "Pass", minimum_percentage: 0, maximum_percentage: 100, grade_points: 8, passed: true }] } };
const data: Extract<AcademicReportWorkspace, { mode: "admin" }> = { mode: "admin", schemes: [], batches: [], policies: [policy, { ...policy, id: "draft-1", name: "Unapproved draft", status: "draft" }], references: { terms: [{ id: "term-2", name: "Semester II", academic_year: "2026-27", starts_on: "2026-10-01", ends_on: "2027-03-31" }], classes: [{ id: "class-1", name: "M.Tech Data Engineering", academic_year: "2026-27" }], subjects: [], assessments: [] } };

describe("report scheme grading context", () => {
  it("selects an active policy and requires a programme cohort and term order for GPA", async () => {
    vi.mocked(createGradingScheme).mockReset().mockResolvedValue({ id: "scheme-1" } as Awaited<ReturnType<typeof createGradingScheme>>);
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<ReportSchemeDialog schoolId="school-1" data={data} close={vi.fn()} saved={saved} onCreatePolicy={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Grading policy" })).toHaveValue("policy-1");
    expect(screen.queryByRole("option", { name: /Unapproved draft/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Scheme name" }), { target: { value: "Semester II progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("button", { name: "Create scheme" })).not.toBeInTheDocument();
    expect(createGradingScheme).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Programme key/ }), { target: { value: "MTECH-DE-2026" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Term number/ }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Review scheme" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Create scheme" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("scheme-1"));
    expect(createGradingScheme).toHaveBeenCalledWith("school-1", expect.objectContaining({ grading_policy_id: "policy-1", programme_key: "MTECH-DE-2026", term_index: 2 }));
  });

  it("offers policy setup rather than silently creating an unconfigured report", () => {
    const createPolicy = vi.fn();
    render(<ReportSchemeDialog schoolId="school-1" data={{ ...data, policies: [] }} close={vi.fn()} saved={vi.fn()} onCreatePolicy={createPolicy} />);
    expect(screen.getByRole("heading", { name: "Set up a grading policy first" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create scheme" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create grading policy" }));
    expect(createPolicy).toHaveBeenCalledOnce();
  });

  it("keeps term and class academic years aligned even when future classes are listed first", async () => {
    vi.mocked(createGradingScheme).mockReset().mockResolvedValue({ id: "scheme-2" } as Awaited<ReturnType<typeof createGradingScheme>>);
    const yearData = { ...data, policies: [{ ...policy, configuration: { ...policy.configuration, result_format: "percentage" as const, grade_point_scale: null, aggregation: "equal" as const, bands: policy.configuration.bands.map((band) => ({ ...band, grade_points: null })) } }], references: { ...data.references,
      terms: [data.references.terms[0]!, { ...data.references.terms[0]!, id: "term-future", name: "Future term", academic_year: "2027-28" }, { ...data.references.terms[0]!, id: "term-past", name: "Past term", academic_year: "2025-26" }, { ...data.references.terms[0]!, id: "term-unconfigured", name: "Unconfigured term", academic_year: "2028-29" }],
      classes: [{ id: "class-future", name: "Future class", academic_year: "2027-28" }, { id: "class-past", name: "Past class", academic_year: "2025-26" }, data.references.classes[0]!, { id: "class-current-2", name: "Current class II", academic_year: "2026-27" }],
    } };
    render(<ReportSchemeDialog schoolId="school-1" data={yearData} close={vi.fn()} saved={vi.fn()} onCreatePolicy={vi.fn()} />);
    const term = screen.getByRole("combobox", { name: "Term" });
    const cohort = screen.getByRole("combobox", { name: "Class" });
    expect(term).toHaveValue("term-2");
    expect(cohort).toHaveValue("class-1");
    expect(within(cohort).getAllByRole("option")).toHaveLength(2);
    expect(within(cohort).queryByRole("option", { name: /Future class/ })).not.toBeInTheDocument();
    expect(within(cohort).queryByRole("option", { name: /Past class/ })).not.toBeInTheDocument();
    fireEvent.change(cohort, { target: { value: "class-current-2" } });
    fireEvent.change(term, { target: { value: "term-past" } });
    expect(cohort).toHaveValue("class-past");
    fireEvent.change(term, { target: { value: "term-unconfigured" } });
    expect(cohort).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("No classes are available for 2028-29");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2 Review" })).toBeDisabled();
    fireEvent.change(term, { target: { value: "term-future" } });
    expect(cohort).toBeEnabled();
    expect(cohort).toHaveValue("class-future");
    fireEvent.change(screen.getByRole("textbox", { name: "Scheme name" }), { target: { value: "Future report" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create scheme" }));
    await waitFor(() => expect(createGradingScheme).toHaveBeenCalledWith("school-1", expect.objectContaining({ term_id: "term-future", class_section_id: "class-future" })));
  });

  it("limits generated scheme codes to 32 characters and preserves a manually edited code", () => {
    render(<ReportSchemeDialog schoolId="school-1" data={data} close={vi.fn()} saved={vi.fn()} onCreatePolicy={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: "Scheme name" });
    const code = screen.getByRole("textbox", { name: "Code" });
    fireEvent.change(name, { target: { value: "Semester I consolidated postgraduate engineering progress report" } });
    expect(code).toHaveValue("SEMESTER-I-CONSOLIDATED-POSTGRAD");
    expect((code as HTMLInputElement).value.length).toBeLessThanOrEqual(32);
    fireEvent.change(code, { target: { value: "MY-REPORT-CODE" } });
    fireEvent.change(name, { target: { value: "Semester II progress report" } });
    expect(code).toHaveValue("MY-REPORT-CODE");
  });

  it("blocks creation if the selected year's classes become unavailable during review", () => {
    const percentageData: typeof data = { ...data, policies: [{ ...policy, configuration: { ...policy.configuration, result_format: "percentage", grade_point_scale: null, aggregation: "equal", bands: policy.configuration.bands.map((band) => ({ ...band, grade_points: null })) } }] };
    const props = { schoolId: "school-1", close: vi.fn(), saved: vi.fn(), onCreatePolicy: vi.fn() };
    const view = render(<ReportSchemeDialog {...props} data={percentageData} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Scheme name" }), { target: { value: "Semester II report" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Create scheme" })).toBeEnabled();
    view.rerender(<ReportSchemeDialog {...props} data={{ ...percentageData, references: { ...percentageData.references, classes: [] } }} />);
    expect(screen.getByRole("button", { name: "Create scheme" })).toBeDisabled();
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("No classes are available for 2026-27");
  });
});
