import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AcademicReportWorkspacePage, FamilyReportCardList, FamilyReportMarksheet } from "./AcademicReportWorkspacePage";
import { createGradingScheme, getGradingScheme, getReportBatch, type AcademicReportWorkspace, type FamilyReportCards, type ReportBatchDetail, type GradingPolicy } from "./api";

vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), createGradingScheme: vi.fn(), getReportBatch: vi.fn(), getGradingScheme: vi.fn() }));

describe("published report cards", () => {
  it("reviews a frozen active policy before an explicit report scheme create action", async () => {
    vi.mocked(createGradingScheme).mockReset().mockImplementation(() => new Promise(() => {}));
    const policy: GradingPolicy = { id: "policy-1", name: "College percentage", code: "COLLEGE", version: 2, status: "active", revision: 3, configuration: { schema_version: 1, result_format: "percentage", grade_point_scale: null, decimal_places: 2, aggregation: "equal", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include", bands: [{ code: "P", label: "Pass", minimum_percentage: 0, maximum_percentage: 100, grade_points: null, passed: true }] } };
    const data = { mode: "admin", schemes: [], batches: [], policies: [policy], references: { terms: [{ id: "term-1", name: "Term 1", academic_year: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31" }], classes: [{ id: "class-1", name: "Class QA", academic_year: "2026-27" }], subjects: [], assessments: [] } } satisfies AcademicReportWorkspace;
    const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/areas/reports/remarks?view=schemes"]}><AcademicReportWorkspacePage schoolId="school-1" data={data} refresh={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    const page = within(view.container);
    fireEvent.click(page.getByRole("button", { name: "New scheme" }));
    fireEvent.change(page.getByRole("textbox", { name: "Scheme name" }), { target: { value: "QA report" } });
    expect(page.getByRole("combobox", { name: "Grading policy" })).toHaveValue("policy-1");
    const continueButton = page.getByRole("button", { name: "Continue", exact: true });
    fireEvent.click(continueButton);
    expect(page.getByRole("heading", { name: "Review scheme", exact: true })).toHaveFocus();
    expect(continueButton.isConnected).toBe(false);
    expect(createGradingScheme).not.toHaveBeenCalled();
    fireEvent.click(page.getByRole("button", { name: "Back", exact: true }));
    fireEvent.submit(page.getByRole("textbox", { name: "Scheme name" }).closest("form")!);
    expect(createGradingScheme).not.toHaveBeenCalled();
    fireEvent.click(page.getByRole("button", { name: "Create scheme", exact: true }));
    await waitFor(() => expect(createGradingScheme).toHaveBeenCalledOnce());
    expect(vi.mocked(createGradingScheme).mock.calls[0]).toEqual(["school-1", expect.objectContaining({ name: "QA report", code: "QA-REPORT", grading_policy_id: "policy-1", absence_treatment: "incomplete" })]);
    expect(vi.mocked(createGradingScheme).mock.calls[0]![1]).not.toHaveProperty("bands");
    view.unmount();
  });

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

  it("keeps record evidence available on demand without concealing learner identity", () => {
    const data = {
      student: { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" },
      reports: [{ report_student_id: "report-student-1", batch_id: "batch-1", sequence: 2, published_at: "2026-10-20T03:30:00.000Z", correction_reason: "English marks corrected after independent review", scheme_id: "scheme-1", scheme_name: "Term 1 report", term_name: "Term 1", academic_year: "2026-27", outcome: "complete", overall_percentage: "0.00", overall_grade: "F", class_teacher_comment: "Revision support is arranged.", principal_comment: "", subjects: [{ id: "subject-1", subject_name: "English", color: "#2563eb", icon: "book", outcome: "complete", percentage: "0.00", grade: "F", passed: false }] }],
    } satisfies FamilyReportCards;
    const print = vi.fn();
    const view = render(<FamilyReportMarksheet data={data} report={data.reports[0]} showPrintAction onPrint={print} />);
    const page = within(view.container);

    expect(page.getAllByText("Aarav Sharma").some(element => !element.closest("details"))).toBe(true);
    expect(page.getByText("A-1")).not.toBeVisible();
    expect(page.getByText("Corrected release")).toBeVisible();
    expect(page.getByText("Revision support is arranged.")).toBeVisible();
    expect(page.getAllByText("0.00%")).toHaveLength(2);
    expect(page.getByRole("cell", { name: /Below pass/ })).toBeVisible();
    fireEvent.click(page.getByText("Record details").closest("summary")!);
    expect(page.getByText("A-1")).toBeVisible();
    expect(page.getByText("20 Oct 2026")).toBeVisible();
    expect(page.getByText("English marks corrected after independent review")).toBeVisible();
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(page.getByRole("button", { name: "Print / save marksheet" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("does not invent overall or subject scores for a withheld report", () => {
    const data = {
      student: { id: "student-1", first_name: "Aarav", last_name: "Sharma", admission_number: "A-1", class_name: "Class 7A" },
      reports: [{ report_student_id: "report-student-1", batch_id: "batch-1", sequence: 1, published_at: "2026-10-20T03:30:00.000Z", correction_reason: "", scheme_id: "scheme-1", scheme_name: "Term 1 report", term_name: "Term 1", academic_year: "2026-27", outcome: "withheld", overall_percentage: null, overall_grade: "", class_teacher_comment: "", principal_comment: "", subjects: [{ id: "subject-1", subject_name: "English", color: "#2563eb", icon: "book", outcome: "withheld", percentage: null, grade: "", passed: null }] }],
    } satisfies FamilyReportCards;
    const view = render(<FamilyReportMarksheet data={data} report={data.reports[0]} />);
    const page = within(view.container);

    expect(page.getAllByText("Withheld").length).toBeGreaterThan(0);
    expect(page.queryByText("0.00%")).not.toBeInTheDocument();
    const subjectRow = page.getByRole("cell", { name: "English" }).closest('[role="row"]')!;
    expect(within(subjectRow as HTMLElement).getAllByRole("cell", { name: "—", exact: true })).toHaveLength(2);
    expect(page.queryByRole("button", { name: "Print / save marksheet" })).not.toBeInTheDocument();
  });

  it("gives teachers a release filter without a banner, single tab or scheme controls", () => {
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const {container}=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/areas/reports/remarks?status=draft']}><AcademicReportWorkspacePage schoolId="school-1" data={{mode:'staff',schemes:[],batches:[]}} refresh={vi.fn()}/></MemoryRouter></QueryClientProvider>);
    expect(container.querySelector('.report-summary')).toBeNull();
    expect(screen.queryByRole('group',{name:'Report card workspace'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'New scheme'})).not.toBeInTheDocument();
    expect(screen.getByRole('combobox',{name:'Filter report releases'})).toHaveValue('draft');
    expect(screen.getByText('No report releases')).toBeVisible();
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
    const view = render(<QueryClientProvider client={client}><MemoryRouter><AcademicReportWorkspacePage schoolId="school-1" data={data} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></QueryClientProvider>);
    const page = within(view.container);

    expect(page.getByRole("button", { name: /Releases 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector('.report-summary')).toBeNull();
    fireEvent.change(page.getByRole('combobox',{name:'Filter report releases'}),{target:{value:'draft'}});
    expect(page.getByText('No releases with this status')).toBeVisible();
    fireEvent.change(page.getByRole('combobox',{name:'Filter report releases'}),{target:{value:'all'}});
    expect(page.queryByText("Ananya Iyer")).not.toBeInTheDocument();
    expect(getReportBatch).not.toHaveBeenCalled();
    fireEvent.click(page.getByRole("button", { name: /Term 1 report.*Release 1/ }));
    expect(await page.findByText("Ananya Iyer")).toBeInTheDocument();
    expect(page.queryByText("English")).not.toBeInTheDocument();
    fireEvent.click(page.getByRole("button", { name: /Ananya Iyer/ }));
    expect(page.getByText("English")).toBeInTheDocument();
    expect(page.getByText("Steady progress.")).toBeInTheDocument();

    view.unmount();
    vi.mocked(getReportBatch).mockClear();
    const direct = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/areas/reports/remarks?batch=batch-1"]}><AcademicReportWorkspacePage schoolId="school-1" data={data} refresh={vi.fn().mockResolvedValue(undefined)}/></MemoryRouter></QueryClientProvider>);
    expect(await within(direct.container).findByText("Ananya Iyer")).toBeVisible();
    expect(getReportBatch).toHaveBeenCalledWith("school-1", "batch-1");
    const target = direct.container.querySelector("#attention-batch-1");
    expect(target).toHaveClass("attention-focus");
    await waitFor(() => expect(target).toHaveFocus());
    direct.unmount();
    vi.mocked(getReportBatch).mockClear();
    vi.mocked(getGradingScheme).mockImplementation(() => new Promise(() => {}));
    const grading = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/areas/reports/remarks?view=schemes"]}><AcademicReportWorkspacePage schoolId="school-1" data={data} refresh={vi.fn().mockResolvedValue(undefined)}/></MemoryRouter></QueryClientProvider>);
    expect(within(grading.container).getByRole("button", { name: /Schemes 1/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(grading.container).getByRole("button", { name: /Term 1 report.*Class 7A/ }));
    expect(within(grading.container).getByText("Opening scheme…")).toBeVisible();
    expect(getGradingScheme).toHaveBeenCalledWith("school-1", "scheme-1");
    expect(getReportBatch).not.toHaveBeenCalled();
    grading.unmount();
  });

  it("offers a working retry when a report release cannot be opened", async () => {
    vi.mocked(getReportBatch).mockReset()
      .mockRejectedValueOnce(new Error("The report service is temporarily unavailable."))
      .mockRejectedValueOnce(new Error("The report service is still unavailable."));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/areas/reports/remarks?batch=batch-1"]}><AcademicReportWorkspacePage schoolId="school-1" data={{ mode: "staff", schemes: [], batches: [] }} refresh={vi.fn()} /></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t open this report release");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("still unavailable"));
    expect(getReportBatch).toHaveBeenCalledTimes(2);
  });
});
