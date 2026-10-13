import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TeacherClassSummary } from "../../features/operations/api";
import type { AttentionItem, AttentionResponse } from "../../features/attention/api";
import { AttendanceWorkspacePage } from "./AttendanceWorkspacePage";

vi.mock("./OperationsShell", () => ({ OperationsShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
afterEach(cleanup);
const row = (patch: Partial<TeacherClassSummary> = {}): TeacherClassSummary => ({
  class_section_id: "7a", class_name: "Class 7A", grade: "7", section: "A", room_number: "204",
  term_name: "Term 1", academic_year: "2026-27", starts_at: null, ends_at: null,
  student_count: 25, marked_count: 0, attending_count: 0, absent_count: 0, subjects: ["Mathematics"],
  submission_status: "not_started", periods_today: 1, assigned_teachers: ["Kavita Mehta"],
  instructional: true, date_open: true, can_mark: true, availability_reason: null, submission_authorized: true, ...patch,
});
function show(portal: "teacher" | "principal", classes: TeacherClassSummary[]) {
  const onDateChange = vi.fn();
  render(<MemoryRouter><AttendanceWorkspacePage portal={portal} classes={classes} date="2026-09-18" onDateChange={onDateChange} /></MemoryRouter>);
  return onDateChange;
}

const attentionItem = (patch: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "attention:attendance_register:7a",
  source_kind: "attendance_register",
  source_id: "7a",
  module: "attendance",
  state: "action_required",
  signals: ["action_required"],
  priority: "normal",
  title: "Class 7A register is due",
  status_label: "Not started",
  subject_label: "Class 7A",
  href: "/principal/attendance?class_section_id=7a&date=2026-09-18",
  created_at: null,
  due_at: "2026-09-18T09:45:00.000Z",
  ...patch,
});

function attentionResponse(items: AttentionItem[]): AttentionResponse {
  const actionRequired = items.filter((item) => item.state === "action_required").length;
  const exceptions = items.filter((item) => item.state === "exception").length;
  return {
    portal: "principal",
    generated_at: "2026-09-18T10:00:00.000Z",
    summary: { total: items.length, new: 0, action_required: actionRequired, exceptions, urgent: exceptions },
    modules: {},
    items,
  };
}
describe("attendance class workspace", () => {
  it("keeps a non-required register read-only and never offers attendance capture", () => {
    const change = show("teacher", [row({ periods_today: 0, instructional: false, can_mark: false, availability_reason: "No scheduled lesson." })]);
    expect(screen.getByText(/No lesson on this day/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Take attendance/ })).not.toBeInTheDocument();
    expect(screen.getByText("No action required")).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Previous day'}));
    expect(change).toHaveBeenCalledWith("2026-09-17");
  });
  it("separates principal submission, review, and locked queues with real actor attribution", async () => {
    const user = userEvent.setup();
    show("principal", [row(), row({ class_section_id: "7b", class_name: "Class 7B", section: "B", submission_status: "submitted", submitted_by_name: "Kavita Mehta", marked_count: 25 }), row({ class_section_id: "8a", class_name: "Class 8A", grade: "8", submission_status: "locked", marked_count: 25 })]);
    await user.selectOptions(screen.getByRole('combobox',{name:'Filter registers'}),'submitted');
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Submitted by Kavita Mehta")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review Class 7B" })).toHaveAttribute("href", "/principal/attendance?class_section_id=7b&date=2026-09-18");
    await user.selectOptions(screen.getByRole('combobox',{name:'Filter registers'}),'locked');
    expect(within(screen.getByRole("article")).getByText("Class 8A")).toBeVisible();
  });
  it("does not count holidays, empty classes, or future dates as missing submissions", async () => {
    const user = userEvent.setup();
    show("teacher", [row({ instructional: false, can_mark: false }), row({ class_section_id: "7b", class_name: "Class 7B", section: "B", date_open: false, can_mark: false }), row({ class_section_id: "8a", class_name: "Class 8A", grade: "8", student_count: 0, can_mark: false })]);
    await user.selectOptions(screen.getByRole('combobox',{name:'Filter registers'}),'pending');
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No registers in this view")).toBeVisible();
  });
  it("does not count a submission from an unscheduled teacher as complete", () => {
    show("principal", [row({ submission_status: "submitted", submission_authorized: false, submitted_by_name: "Kavita Mehta", marked_count: 25 })]);
    expect(screen.getByText("Assignment mismatch")).toBeVisible();
    expect(screen.queryByLabelText('Register overview')).not.toBeInTheDocument();
    expect(screen.getByRole('option',{name:'To submit · 1'})).toBeInTheDocument();
    expect(screen.getByText(/assignment review is required/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Review assignment mismatch for Class 7A" })).toBeVisible();
  });
  it("shows an honest no-assignment state without auto-selecting a register", () => {
    show("teacher", []);
    expect(screen.getByText("No attendance due")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it('keeps search out of the way until requested and restores focus on close',async()=>{
    show('principal',[row(),row({class_section_id:'8a',class_name:'Class 8A',grade:'8'})]);
    expect(screen.queryByRole('textbox',{name:'Search classes'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Search classes'}));
    const input=screen.getByRole('textbox',{name:'Search classes'});
    expect(input).toHaveFocus();await userEvent.type(input,'8A');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button',{name:'Search classes'})).toHaveFocus();
  });
  it('does not hide an attendance desk failure behind its toolbar button',async()=>{
    render(<MemoryRouter><AttendanceWorkspacePage portal="principal" classes={[row()]} date="2026-09-18" onDateChange={vi.fn()} continuityError={new Error('Desk unavailable')} onContinuityDecision={vi.fn()}/></MemoryRouter>);
    expect(screen.getByRole('button',{name:'Paper & offline entries'})).toHaveAttribute('aria-expanded','false');
    await userEvent.click(screen.getByRole('button',{name:'Attendance review unavailable'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Desk unavailable');
    expect(screen.getByRole('button',{name:'Paper & offline entries'})).toHaveAttribute('aria-expanded','true');
  });
  it('uses the complete review count rather than the limited loaded case list',async()=>{
    render(<MemoryRouter><AttendanceWorkspacePage portal="principal" classes={[row()]} date="2026-10-08" onDateChange={vi.fn()} continuity={{date:'2026-10-08',summary:{pending:0,quarantined:51,accepted:0,rejected:0},cases:[]}} onContinuityDecision={vi.fn()}/></MemoryRouter>);
    expect(screen.getByRole('button',{name:'Paper & offline entries, 51 to review'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'51 entries need review'}));
    expect(screen.getByText('51 to review')).toBeVisible();
    expect(screen.queryByText('Nothing to review.')).not.toBeInTheDocument();
  });
  it('opens the review desk immediately for an exact attention link',()=>{
    render(<MemoryRouter><AttendanceWorkspacePage portal="principal" classes={[row()]} date="2026-10-08" onDateChange={vi.fn()} initialReviewCaseId="case-1" continuity={{date:'2026-10-08',summary:{pending:0,quarantined:1,accepted:0,rejected:0},cases:[{id:'case-1',batch_id:'batch-1',reason_code:'source_requires_review',reason:'Paper register needs review.',details:{},state:'open',opened_at:'2026-10-08T04:00:00.000Z',date:'2026-10-08',source:'paper',source_reference:null,observed_at:'2026-10-08T03:30:00.000Z',received_at:'2026-10-08T04:00:00.000Z',roster_count:25,expected_register_revision:0,class_section_id:'7a',class_name:'Class 7A',recorded_by_name:'Meera Kapoor',current_revision:0,register_state:'draft'}]}} onContinuityDecision={vi.fn()}/></MemoryRouter>);
    expect(screen.getByRole('button',{name:'Paper & offline entries, 1 to review'})).toHaveAttribute('aria-expanded','true');
    expect(document.getElementById('attention-review-case-case-1')).toHaveClass('is-attention-target');
    expect(screen.getByText('Paper register needs review.')).toBeVisible();
  });
  it("explains the navigation signal and marks only exact affected registers", async () => {
    const user = userEvent.setup();
    const items = [attentionItem()];
    const view = render(<MemoryRouter><AttendanceWorkspacePage portal="principal" classes={[row(), row({ class_section_id: "8a", class_name: "Class 8A", grade: "8" })]} date="2026-09-18" onDateChange={vi.fn()} attention={{ data: attentionResponse(items), isError: false, isPending: false }} /></MemoryRouter>);

    expect(screen.getByText("1 attendance item needs attention")).toBeVisible();
    expect(screen.getByText("1 register on this date")).toBeVisible();
    expect(view.container.querySelectorAll(".attendance-class-card__attention-mark")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Needs attention · 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show affected" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Class 7A")).toBeVisible();
    expect(screen.queryByText("Class 8A")).not.toBeInTheDocument();
  });
  it("routes an unplaced exception instead of scattering decorative dots", () => {
    const exception = attentionItem({
      id: "attention:attendance_reconciliation:case-1",
      source_kind: "attendance_reconciliation",
      source_id: "case-1",
      state: "exception",
      signals: ["exception"],
      priority: "urgent",
      status_label: "Reconciliation needed",
      href: "/principal/attendance?review_case=case-1",
    });
    const view = render(<MemoryRouter><AttendanceWorkspacePage portal="principal" classes={[row()]} date="2026-09-18" onDateChange={vi.fn()} attention={{ data: attentionResponse([exception]), isError: false, isPending: false }} /></MemoryRouter>);

    expect(screen.getByText("No affected register on this date · 1 other review")).toBeVisible();
    expect(screen.getByRole("link", { name: /Review exception/ })).toHaveAttribute("href", "/principal/attendance?review_case=case-1");
    expect(view.container.querySelector(".attendance-attention-summary.is-exception")).toBeInTheDocument();
    expect(view.container.querySelector(".attendance-class-card__attention-mark")).not.toBeInTheDocument();
  });
});
