import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEditorPage } from "./EventEditorPage";
import { EventRegisterPage } from "./EventRegisterPage";
import { FamilyEventDetailPage, FamilyEventListPage } from "./FamilyEventPages";
import { OperationsEventDetailPage } from "./OperationsEventDetailPage";
import { OperationsEventListPage } from "./OperationsEventListPage";
import type { CampusEventDto, EventCatalogResponse, EventFinanceResponse, EventRegisterInput, EventRegisterResponse } from "./types";

vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, active }: { children: React.ReactNode; active: string }) => <main data-testid="operations-shell" data-active={active}>{children}</main> }));
vi.mock("../../pages/parent/ParentShell", () => ({ ParentShell: ({ children, active }: { children: React.ReactNode; active: string }) => <main data-testid="parent-shell" data-active={active}>{children}</main> }));
vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children, activeNav }: { children: React.ReactNode; activeNav: string }) => <main data-testid="student-shell" data-active={activeNav}>{children}</main> }));

afterEach(cleanup);

function eventFixture(patch: Partial<CampusEventDto> = {}): CampusEventDto {
  return {
    id: "event-1",
    school_id: "school-1",
    event_type: "excursion",
    subject_id: null,
    status: "published",
    title: "Science museum visit",
    description: "A guided museum learning day.",
    venue: "City Science Museum",
    starts_at: "2099-09-18T04:30:00.000Z",
    ends_at: "2099-09-18T11:30:00.000Z",
    audience: { mode: "class_sections", class_section_ids: ["class-7a"], student_ids: [] },
    participation_requirement: "mandatory",
    requires_rsvp: false,
    requires_guardian_consent: false,
    payment_required: false,
    payment_amount_paise: null,
    payment_due_on: null,
    payment_currency: "INR",
    academic_attendance_impact: "none",
    revision: 2,
    published_at: "2099-09-01T04:30:00.000Z",
    cancelled_at: null,
    cancellation_reason: null,
    cancellation_internal_reason: null,
    sessions: [{
      id: "session-1",
      title: "Museum programme",
      session_type: "activity",
      venue: "City Science Museum",
      starts_at: "2099-09-18T05:00:00.000Z",
      ends_at: "2099-09-18T10:00:00.000Z",
      attendance_mode: "check_in",
      state: "open",
      revision: 0,
      participant_student_ids: [],
      viewer_attendance: [],
      counts: { recorded: 0, not_recorded: 1, present: 0, late: 0, excused: 0, no_show: 0, checked_out: 0 },
    }],
    checklist: [{ id: "kit-1", label: "Water bottle", required: true, sort_order: 0 }],
    viewer_participants: [{
      student_id: "student-1",
      student_name: "Aarav Sharma",
      avatar_url: null,
      participation_requirement: "mandatory",
      rsvp_status: "pending",
      rsvp_revision: 0,
      consent_status: "not_required",
      consent_revision: 0,
      consent_readiness: "not_required",
      payment_status: "not_required",
      payment_amount_paise: 0,
      payment_paid_paise: 0,
      fee_invoice_id: null,
      fee_invoice_status: "not_required",
      checklist_completed: 0,
      checklist_total: 1,
      checklist_completed_item_ids: [],
      checklist_required: 1,
      checklist_required_completed: 0,
      checklist_ready: false,
    }],
    counts: { participants: 1, mandatory: 1, rsvp_accepted: 0, consent_granted: 0, checklist_ready: 0, checklist_required_items: 1, finance_reconciliation_required: 0 },
    permissions: { can_edit: false, can_publish: false, can_cancel: false, can_complete: false, can_rsvp: false, can_consent: false, can_take_attendance: false, can_view_finance_details: true, can_manage_policy: false, can_manage_audience: false, can_manage_staff: false },
    staff: [],
    ...patch,
  };
}

const catalog: EventCatalogResponse = {
  class_sections: [{ id: "class-7a", name: "Class 7A", grade: "7", section: "A" }],
  students: [
    { id: "student-1", name: "Aarav Sharma", class_section_id: "class-7a", admission_number: "CIS-071" },
    { id: "student-2", name: "Riddhi Kaur", class_section_id: "class-7a", admission_number: "CIS-072" },
  ],
  staff: [],
  subjects: [],
};

describe("campus event family workflows", () => {
  it("does not treat mandatory no-RSVP events as pending family actions", () => {
    render(<MemoryRouter><FamilyEventListPage audience="student" events={[eventFixture()]} /></MemoryRouter>);

    expect(screen.getByText("need action").previousElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Mandatory")).toBeVisible();
    expect(screen.queryByText("Response due")).not.toBeInTheDocument();
  });

  it("keeps parent events under the established Home navigation and offers explicit pagination", async () => {
    const onLoadMore = vi.fn();
    render(<MemoryRouter><FamilyEventListPage audience="parent" events={[eventFixture()]} hasMore onLoadMore={onLoadMore} /></MemoryRouter>);

    expect(screen.getByTestId("parent-shell")).toHaveAttribute("data-active", "events");
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more events" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("shows the real event fee before invoicing and supports consent withdrawal", async () => {
    const onConsent = vi.fn().mockResolvedValue(undefined);
    const base = eventFixture();
    const event = eventFixture({
      participation_requirement: "optional",
      requires_rsvp: true,
      requires_guardian_consent: true,
      payment_required: true,
      payment_amount_paise: 125_000,
      payment_due_on: "2099-09-10",
      viewer_participants: [{
        ...base.viewer_participants[0]!,
        participation_requirement: "optional",
        consent_status: "granted",
        consent_readiness: "ready",
        payment_status: "pending",
        fee_invoice_status: "pending",
      }],
      permissions: { ...base.permissions, can_consent: true, can_rsvp: true },
    });
    render(<MemoryRouter><FamilyEventDetailPage audience="parent" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={onConsent} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Awaiting RSVP")).toBeVisible();
    expect(screen.getAllByText("₹1,250.00")).toHaveLength(2);
    expect(screen.getByText(/Fee applies after acceptance/)).toBeVisible();
    expect(screen.queryByLabelText("Optional note")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Withdraw consent" }));
    expect(onConsent).toHaveBeenCalledWith("withdrawn", "");
  });

  it("makes the preparation checklist read-only once an event starts", () => {
    const event = eventFixture({ starts_at: "2020-09-18T04:30:00.000Z", ends_at: "2099-09-18T11:30:00.000Z" });
    render(<MemoryRouter><FamilyEventDetailPage audience="student" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByRole("button", { name: /Water bottle/ })).toBeDisabled();
    expect(screen.getByText("0/1 marked packed")).toBeVisible();
    expect(screen.getByText(/family-declared packing checklist/)).toBeVisible();
    expect(screen.getByText("The preparation checklist is now read-only.")).toBeVisible();
  });

  it("requires a guardian to respond to a paid event from the student view", () => {
    const base = eventFixture();
    const event = eventFixture({
      participation_requirement: "optional",
      requires_rsvp: true,
      payment_required: true,
      payment_amount_paise: 50_000,
      payment_due_on: "2099-09-10",
      viewer_participants: [{ ...base.viewer_participants[0]!, participation_requirement: "optional", payment_status: "pending", fee_invoice_status: "pending" }],
    });
    render(<MemoryRouter><FamilyEventDetailPage audience="student" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByText("A linked guardian must accept or decline this paid event.")).toBeVisible();
  });

  it("shows the linked family fee record when a paid event is cancelled", () => {
    const base = eventFixture();
    const event = eventFixture({
      status: "cancelled",
      payment_required: true,
      payment_amount_paise: 50_000,
      payment_due_on: "2099-09-10",
      cancelled_at: "2099-09-05T06:00:00.000Z",
      cancellation_reason: "Venue unavailable",
      cancellation_internal_reason: "Vendor failed compliance review",
      viewer_participants: [{
        ...base.viewer_participants[0]!,
        payment_status: "pending",
        payment_amount_paise: 50_000,
        fee_invoice_id: "invoice-1",
        fee_invoice_status: "pending",
      }],
    });
    render(<MemoryRouter><FamilyEventDetailPage audience="parent" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText(/Your fee record remains in the school finance ledger/)).toBeVisible();
    expect(screen.getByText(/school office will reconcile the balance/)).toBeVisible();
    expect(screen.queryByText(/Vendor failed compliance review/)).not.toBeInTheDocument();
  });

  it("withdraws an accepted optional paid place with a reason and explains ledger preservation", async () => {
    const onWithdraw = vi.fn().mockResolvedValue(undefined);
    const base = eventFixture();
    const event = eventFixture({
      participation_requirement: "optional",
      requires_rsvp: true,
      payment_required: true,
      payment_amount_paise: 125_000,
      payment_due_on: "2099-09-10",
      viewer_participants: [{
        ...base.viewer_participants[0]!,
        participation_requirement: "optional",
        rsvp_status: "accepted",
        payment_status: "pending",
        payment_amount_paise: 125_000,
        fee_invoice_id: "invoice-1",
        fee_invoice_status: "pending",
      }],
    });
    const finance: EventFinanceResponse["items"][number] = {
      student_id: "student-1",
      student_name: "Aarav Sharma",
      admission_number: "CIS-071",
      avatar_url: null,
      participation_state: "accepted",
      withdrawn_at: null,
      can_withdraw: true,
      finance_state: "collectible",
      currency: "INR",
      invoice_id: "invoice-1",
      invoice_amount_paise: 125_000,
      credited_paise: 0,
      paid_paise: 0,
      refunded_paise: 0,
      collectible_balance_paise: 125_000,
      refund_due_paise: 0,
      refunds: [],
    };
    const user = userEvent.setup();
    render(<MemoryRouter><FamilyEventDetailPage audience="parent" event={event} finance={finance} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={onWithdraw} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "Withdraw from event" }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw this event place?" });
    expect(within(dialog).getByText(/invoice will remain in the immutable school ledger/)).toBeVisible();
    await user.type(within(dialog).getByLabelText("Reason"), "Family travel changed");
    await user.click(within(dialog).getByRole("button", { name: "Withdraw place" }));
    expect(onWithdraw).toHaveBeenCalledWith("Family travel changed", expect.any(String));
  });

  it("shows a family the actual manual refund due without claiming an online refund", () => {
    const base = eventFixture();
    const event = eventFixture({
      status: "cancelled",
      payment_required: true,
      payment_amount_paise: 125_000,
      payment_due_on: "2099-09-10",
      viewer_participants: [{ ...base.viewer_participants[0]!, payment_status: "paid", payment_amount_paise: 125_000, payment_paid_paise: 80_000, fee_invoice_id: "invoice-1", fee_invoice_status: "paid" }],
    });
    const finance: EventFinanceResponse["items"][number] = {
      student_id: "student-1",
      student_name: "Aarav Sharma",
      admission_number: "CIS-071",
      avatar_url: null,
      participation_state: "accepted",
      withdrawn_at: null,
      can_withdraw: false,
      finance_state: "refund_due",
      currency: "INR",
      invoice_id: "invoice-1",
      invoice_amount_paise: 125_000,
      credited_paise: 125_000,
      paid_paise: 80_000,
      refunded_paise: 0,
      collectible_balance_paise: 0,
      refund_due_paise: 80_000,
      refunds: [],
    };
    render(<MemoryRouter><FamilyEventDetailPage audience="parent" event={event} finance={finance} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("₹800.00 manual refund due")).toBeVisible();
    expect(screen.getByText(/This app has not initiated an online refund/)).toBeVisible();
  });

  it("shows the linked child's event check-in and check-out in the parent schedule", () => {
    const base = eventFixture();
    const event = eventFixture({
      sessions: [{
        ...base.sessions[0]!,
        attendance_mode: "check_in_out",
        state: "locked",
        viewer_attendance: [{
          student_id: "student-1",
          expected: true,
          status: "checked_out",
          checked_in_at: "2099-09-18T05:05:00.000Z",
          checked_out_at: "2099-09-18T09:45:00.000Z",
        }],
      }],
    });
    render(<MemoryRouter><FamilyEventDetailPage audience="parent" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Checked out")).toBeVisible();
    expect(screen.getByText(/In 10:35 am · Out 3:15 pm/i)).toBeVisible();
    expect(screen.getByTestId("parent-shell")).toHaveAttribute("data-active", "events");
  });

  it("shows a student when they are not expected in a subset session", () => {
    const base = eventFixture();
    const event = eventFixture({
      sessions: [{
        ...base.sessions[0]!,
        viewer_attendance: [{
          student_id: "student-1",
          expected: false,
          status: "not_recorded",
          checked_in_at: null,
          checked_out_at: null,
        }],
      }],
    });
    render(<MemoryRouter><FamilyEventDetailPage audience="student" event={event} selectedStudentId="student-1" onRsvp={vi.fn()} onWithdraw={vi.fn()} onConsent={vi.fn()} onChecklist={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Not on this session roster")).toBeVisible();
    expect(screen.getByTestId("student-shell")).toHaveAttribute("data-active", "launcher");
  });
});

describe("campus event planning", () => {
  it("keeps operations events under Overview and preserves the selected tab while loading another page", async () => {
    const onLoadMore = vi.fn();
    const onViewChange = vi.fn();
    render(<MemoryRouter><OperationsEventListPage portal="principal" events={[eventFixture()]} view="draft" hasMore onLoadMore={onLoadMore} onViewChange={onViewChange} /></MemoryRouter>);

    expect(screen.getByTestId("operations-shell")).toHaveAttribute("data-active", "events");
    expect(screen.getByRole("tab", { name: "Drafts 0" })).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more events" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("keeps session subsets scoped and searchable without rendering an always-open student wall", async () => {
    render(<MemoryRouter><EventEditorPage catalog={catalog} onSave={vi.fn()} /></MemoryRouter>);
    const user = userEvent.setup();

    expect(screen.getByText("All 2 invited")).toBeVisible();
    expect(screen.queryByLabelText("Find an invited student")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Collect RSVP/ })).toBeDisabled();
    await user.click(screen.getByText("Session audience"));
    await user.click(screen.getByRole("radio", { name: "Selected participants" }));
    expect(screen.getByLabelText("Find an invited student")).toBeVisible();
    expect(screen.getByText(/1 selected · 2 shown/)).toBeVisible();
  });

  it("shows a bounded organizer the preserved audience and policy without management controls", () => {
    const base = eventFixture();
    const draft = eventFixture({
      status: "draft",
      permissions: { ...base.permissions, can_edit: true, can_manage_policy: false, can_manage_audience: false, can_manage_staff: false },
    });
    render(<MemoryRouter><EventEditorPage portal="teacher" catalog={catalog} event={draft} onSave={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Administrator-controlled policy")).toBeVisible();
    expect(screen.getByText("The published audience is controlled by a school administrator.")).toBeVisible();
    expect(screen.getByText("Class 7A")).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Event audience" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Participation requirement" })).not.toBeInTheDocument();
  });

  it("keeps internal cancellation context separate from the family notice", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const base = eventFixture();
    const event = eventFixture({ permissions: { ...base.permissions, can_cancel: true } });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsEventDetailPage portal="principal" schoolId="school-1" event={event} onCancel={onCancel} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "Cancel event" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel this event?" });
    await user.type(within(dialog).getByLabelText("Internal cancellation reason"), "Transport vendor breach");
    await user.type(within(dialog).getByLabelText("Notice shown to families"), "The visit is cancelled because transport is unavailable.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel event" }));
    expect(onCancel).toHaveBeenCalledWith("Transport vendor breach", "The visit is cancelled because transport is unavailable.");
  });

  it("does not expose fee amounts to ordinary assigned staff", () => {
    const base = eventFixture();
    const event = eventFixture({
      payment_required: true,
      payment_amount_paise: 125_000,
      payment_due_on: "2099-09-10",
      viewer_participants: [{ ...base.viewer_participants[0]!, payment_status: "pending", payment_amount_paise: 125_000, payment_paid_paise: 25_000, fee_invoice_id: "invoice-1", fee_invoice_status: "pending" }],
      permissions: { ...base.permissions, can_view_finance_details: false },
    });
    render(<MemoryRouter><OperationsEventDetailPage portal="teacher" schoolId="school-1" event={event} /></MemoryRouter>);

    expect(screen.getByText("Payment pending")).toBeVisible();
    expect(screen.queryByText("Not invoiced")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("shows ordinary assigned staff only coarse reconciliation state", () => {
    const event = eventFixture({ payment_required: true, permissions: { ...eventFixture().permissions, can_view_finance_details: false } });
    const finance: EventFinanceResponse = {
      event: { id: event.id, title: event.title, status: event.status },
      items: [{
        student_id: "student-1",
        student_name: "Aarav Sharma",
        admission_number: "CIS-071",
        avatar_url: null,
        participation_state: "accepted",
        withdrawn_at: null,
        can_withdraw: false,
        finance_state: "refund_due",
        currency: "INR",
        invoice_id: null,
        invoice_amount_paise: 0,
        credited_paise: 0,
        paid_paise: 0,
        refunded_paise: 0,
        collectible_balance_paise: 0,
        refund_due_paise: 0,
        refunds: [],
      }],
      counts: { reconciliation_required: 1, withdrawn: 0 },
      permissions: { can_view_finance_details: false, can_record_refund: false },
    };
    render(<MemoryRouter><OperationsEventDetailPage portal="teacher" schoolId="school-1" event={event} finance={finance} onRecordRefund={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Finance follow-up pending")).toBeVisible();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record refund" })).not.toBeInTheDocument();
  });

  it("uses reconciled finance state in readiness instead of a stale payment projection", () => {
    const base = eventFixture();
    const event = eventFixture({
      status: "cancelled",
      payment_required: true,
      viewer_participants: [{ ...base.viewer_participants[0]!, payment_status: "pending", fee_invoice_id: "invoice-1", fee_invoice_status: "pending" }],
    });
    const finance: EventFinanceResponse = {
      event: { id: event.id, title: event.title, status: event.status },
      items: [{
        student_id: "student-1",
        student_name: "Aarav Sharma",
        admission_number: "CIS-071",
        avatar_url: null,
        participation_state: "withdrawn",
        withdrawn_at: "2099-09-02T05:00:00.000Z",
        can_withdraw: false,
        finance_state: "credited",
        currency: "INR",
        invoice_id: "invoice-1",
        invoice_amount_paise: 125_000,
        credited_paise: 125_000,
        paid_paise: 0,
        refunded_paise: 0,
        collectible_balance_paise: 0,
        refund_due_paise: 0,
        refunds: [],
      }],
      counts: { reconciliation_required: 0, withdrawn: 1 },
      permissions: { can_view_finance_details: true, can_record_refund: true },
    };
    render(<MemoryRouter><OperationsEventDetailPage portal="principal" schoolId="school-1" event={event} finance={finance} /></MemoryRouter>);

    expect(screen.getByText("Invoice credited")).toBeVisible();
    expect(screen.queryByText("Payment pending")).not.toBeInTheDocument();
  });

  it("records a manual refund only after collecting amount, method, reference and reason", async () => {
    const onRecordRefund = vi.fn<(studentId: string, input: {
      amount_paise: number;
      method: "cash" | "bank_transfer" | "cheque";
      reference: string;
      reason: string;
      idempotency_key: string;
    }) => Promise<void>>().mockResolvedValue(undefined);
    const event = eventFixture({ payment_required: true });
    const finance: EventFinanceResponse = {
      event: { id: event.id, title: event.title, status: event.status },
      items: [{
        student_id: "student-1",
        student_name: "Aarav Sharma",
        admission_number: "CIS-071",
        avatar_url: null,
        participation_state: "withdrawn",
        withdrawn_at: "2099-09-02T05:00:00.000Z",
        can_withdraw: false,
        finance_state: "refund_due",
        currency: "INR",
        invoice_id: "invoice-1",
        invoice_amount_paise: 125_000,
        credited_paise: 125_000,
        paid_paise: 80_000,
        refunded_paise: 0,
        collectible_balance_paise: 0,
        refund_due_paise: 80_000,
        refunds: [],
      }],
      counts: { reconciliation_required: 1, withdrawn: 1 },
      permissions: { can_view_finance_details: true, can_record_refund: true },
    };
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsEventDetailPage portal="principal" schoolId="school-1" event={event} finance={finance} onRecordRefund={onRecordRefund} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "Record refund" }));
    const dialog = screen.getByRole("dialog", { name: "Record manual refund" });
    await user.clear(within(dialog).getByLabelText("Amount (INR)"));
    await user.type(within(dialog).getByLabelText("Amount (INR)"), "600");
    await user.selectOptions(within(dialog).getByLabelText("Method"), "bank_transfer");
    await user.type(within(dialog).getByLabelText("Transaction or receipt reference"), "UTR-2026-09-30");
    await user.type(within(dialog).getByLabelText("Reconciliation reason"), "Returned by school office");
    await user.click(within(dialog).getByRole("button", { name: "Record completed refund" }));

    expect(onRecordRefund).toHaveBeenCalledTimes(1);
    const [studentId, input] = onRecordRefund.mock.calls[0]!;
    expect(studentId).toBe("student-1");
    expect(input).toMatchObject({
      amount_paise: 60_000,
      method: "bank_transfer",
      reference: "UTR-2026-09-30",
      reason: "Returned by school office",
    });
    expect(input.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("event attendance register", () => {
  const register: EventRegisterResponse = {
    event: { id: "event-1", title: "Science museum visit", status: "published" },
    session: { id: "session-1", title: "Museum programme", session_type: "activity", starts_at: "2099-09-18T05:00:00.000Z", ends_at: "2099-09-18T10:00:00.000Z", attendance_mode: "check_in", state: "open", revision: 2 },
    counts: { participants: 1, recorded: 1, not_recorded: 0, present: 1, late: 0, excused: 0, no_show: 0, checked_out: 0 },
    rows: [{ student_id: "student-1", student_name: "Aarav Sharma", admission_number: "CIS-071", avatar_url: null, participation_requirement: "mandatory", rsvp_status: "accepted", consent_required: false, consent_status: "not_required", consent_readiness: "not_required", payment_status: "not_required", payment_amount_paise: 0, payment_paid_paise: 0, fee_invoice_id: null, attendance_status: "present", note: "", record_revision: 1, checked_in_at: null, checked_out_at: null, checklist_ready: true, participation_ready: true, readiness_blockers: [], readiness_contradiction_note: null }],
    permissions: { can_take_attendance: true, can_lock: true, can_reopen: false, attendance_disabled_reason: null },
  };

  it("requires a correction reason and hides statuses that are invalid before a check-in session starts", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><EventRegisterPage portal="teacher" register={register} onSave={onSave} onLock={vi.fn()} onReopen={vi.fn()} onHistory={vi.fn().mockResolvedValue({ event: register.event, session: { id: register.session.id, title: register.session.title }, items: [] })} /></MemoryRouter>);
    const user = userEvent.setup();
    const status = screen.getByLabelText("Attendance status for Aarav Sharma");

    expect(status).not.toHaveTextContent("Late");
    expect(status).not.toHaveTextContent("No-show");
    expect(status).not.toHaveTextContent("Checked out");
    await user.selectOptions(status, "excused");
    expect(screen.getByLabelText("Correction reason")).toBeVisible();
    expect(screen.getByRole("button", { name: /Save 1 changes/ })).toBeDisabled();
    await user.type(screen.getByLabelText("Correction reason"), "Verified with trip lead");
    await user.click(screen.getByRole("button", { name: /Save 1 changes/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reason: "Verified with trip lead", records: [expect.objectContaining({ student_id: "student-1", status: "excused", observed_at: null })] }));
  });

  it("opens the compact audit trail and renders an initial null state safely", async () => {
    const onHistory = vi.fn().mockResolvedValue({
      event: { id: "event-1", title: "Science museum visit" },
      session: { id: "session-1", title: "Museum programme" },
      items: [{ id: "1", student_id: "student-1", student_name: "Aarav Sharma", revision: 1, previous_status: null, new_status: "present", previous_note: null, new_note: "", previous_checked_in_at: null, new_checked_in_at: "2099-09-18T05:00:00.000Z", previous_checked_out_at: null, new_checked_out_at: null, reason: null, changed_by: "teacher-1", changed_by_name: "Kavita Mehta", created_at: "2099-09-18T05:01:00.000Z" }],
    });
    render(<MemoryRouter><EventRegisterPage portal="teacher" register={register} onSave={vi.fn()} onLock={vi.fn()} onReopen={vi.fn()} onHistory={onHistory} /></MemoryRouter>);

    await userEvent.setup().click(screen.getByRole("button", { name: "Change history" }));
    const dialog = await screen.findByRole("dialog", { name: "Change history" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText(/Not recorded/)).toBeVisible();
    expect(within(dialog).getByText(/Kavita Mehta/)).toBeVisible();
  });

  it("allows no-show after the session for an accepted optional participant", () => {
    const optionalRegister: EventRegisterResponse = {
      ...register,
      session: { ...register.session, starts_at: "2020-09-18T05:00:00.000Z", ends_at: "2020-09-18T10:00:00.000Z" },
      rows: [{ ...register.rows[0]!, participation_requirement: "optional", rsvp_status: "accepted", attendance_status: "not_recorded", record_revision: 0 }],
    };
    render(<MemoryRouter><EventRegisterPage portal="teacher" register={optionalRegister} onSave={vi.fn()} onLock={vi.fn()} onReopen={vi.fn()} onHistory={vi.fn().mockResolvedValue({ event: optionalRegister.event, session: { id: optionalRegister.session.id, title: optionalRegister.session.title }, items: [] })} /></MemoryRouter>);

    expect(screen.getByLabelText("Attendance status for Aarav Sharma")).toHaveTextContent("No-show");
  });

  it("captures the physical observation time independently from request receipt", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const unmarked: EventRegisterResponse = {
      ...register,
      rows: [{ ...register.rows[0]!, attendance_status: "not_recorded", record_revision: 0, checked_in_at: null, checked_out_at: null }],
    };
    render(<MemoryRouter><EventRegisterPage portal="teacher" register={unmarked} onSave={onSave} onLock={vi.fn()} onReopen={vi.fn()} onHistory={vi.fn().mockResolvedValue({ event: unmarked.event, session: { id: unmarked.session.id, title: unmarked.session.title }, items: [] })} /></MemoryRouter>);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Attendance status for Aarav Sharma"), "present");
    const observed = screen.getByLabelText("Observed at for Aarav Sharma");
    expect(observed).toBeRequired();
    expect((observed as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await user.click(screen.getByRole("button", { name: /Save 1 changes/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as EventRegisterInput | undefined;
    expect(saved?.records[0]?.status).toBe("present");
    expect(saved?.records[0]?.observed_at).toMatch(/Z$/);
  });

  it("excludes non-ready students from bulk marking but allows an explained physical observation", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const blocked = { ...register.rows[0]!, student_id: "student-2", student_name: "Riddhi Kaur", admission_number: "CIS-072", attendance_status: "not_recorded" as const, record_revision: 0, participation_ready: false, checklist_ready: false, consent_required: true, consent_status: "pending" as const, consent_readiness: "authority_missing" as const, readiness_blockers: ["guardian_consent", "required_checklist"] as const, readiness_contradiction_note: null };
    const readinessRegister: EventRegisterResponse = {
      ...register,
      session: { ...register.session, starts_at: "2020-09-18T05:00:00.000Z", ends_at: "2020-09-18T10:00:00.000Z" },
      rows: [{ ...register.rows[0]!, attendance_status: "not_recorded", record_revision: 0 }, blocked],
      counts: { ...register.counts, participants: 2, recorded: 0, not_recorded: 2, present: 0 },
    };
    const user = userEvent.setup();
    render(<MemoryRouter><EventRegisterPage portal="teacher" register={readinessRegister} onSave={onSave} onLock={vi.fn()} onReopen={vi.fn()} onHistory={vi.fn().mockResolvedValue({ event: readinessRegister.event, session: { id: readinessRegister.session.id, title: readinessRegister.session.title }, items: [] })} /></MemoryRouter>);

    expect(screen.getByText("Participation not ready")).toBeVisible();
    expect(screen.getByText(/Guardian consent is not ready/)).toBeVisible();
    const blockedStatus = screen.getByLabelText("Attendance status for Riddhi Kaur");
    expect(blockedStatus).not.toHaveTextContent("No-show");
    await user.click(screen.getByRole("button", { name: "Mark ready present" }));
    expect(screen.getByLabelText("Attendance status for Aarav Sharma")).toHaveValue("present");
    expect(blockedStatus).toHaveValue("not_recorded");
    await user.selectOptions(blockedStatus, "present");
    expect(screen.getByRole("button", { name: /Save 2 changes/ })).toBeDisabled();
    await user.type(screen.getByLabelText("Observed attendance explanation for Riddhi Kaur"), "Teacher verified arrival at the gate");
    await user.click(screen.getByRole("button", { name: /Save 2 changes/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as EventRegisterInput | undefined;
    expect(saved?.records).toContainEqual(expect.objectContaining({
      student_id: "student-2",
      status: "present",
      readiness_contradiction_note: "Teacher verified arrival at the gate",
    }));
  });
});
