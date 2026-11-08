/** An elective change is reviewed dated work, never a financial adjustment. */
export interface ElectiveSourceRef { id: string; expected_revision: number }
export interface ElectiveChangeSelection {
  person: ElectiveSourceRef; source_offering: ElectiveSourceRef; source_enrollment: ElectiveSourceRef;
  destination_offering: ElectiveSourceRef; effective_on: string;
}
export type ElectiveCatchUp = { kind: 'not_needed'; reason: string } | { kind: 'plan'; summary: string; due_on: string | null };
export interface ElectiveFinanceReviewer { user_id: string; person_id: string; label: string; eligibility_hash: string }
export interface ElectiveChangeOptions {
  today: string; timezone: string; date_bounds: { earliest: string; latest: string };
  person: { id: string; name: string; revision: number };
  source_offering: { id: string; name: string; revision: number };
  source_enrollment: { id: string; revision: number; starts_on: string; ends_on: string | null };
  destinations: Array<{ id: string; name: string; revision: number; academic_context: {
    term_id: string; subject_id: string; course_code: string; credits: number; programme_key: string | null; revision: number;
  } }>;
  finance_reviewers: ElectiveFinanceReviewer[];
  /** Safe discovery only; open the exact review detail for current authority and actions. */
  open_reviews?: Array<{ id: string; revision: number; state: Exclude<ElectiveChangeReceipt['state'], 'applied' | 'withdrawn'>;
    destination_name: string; effective_on: string }>;
}
export interface ElectiveChangePreview {
  selection: ElectiveChangeSelection; fingerprint: string;
  academic_context: { source_revision: number; destination_revision: number };
  schedule: { state: 'ready' | 'revision_required'; impacts: Array<{
    plan_id: string; revision: number; offering_id: string; title: string; starts_on: string; ends_on: string | null; replacement_starts_on: string;
  }> };
  catch_up: { prior_destination_sessions: number; instructor_person_id: string | null };
  prior_evidence: { attendance_registers: number; assessment_results: number; assignment_attempts: number };
}
export interface ElectiveChangeRequest {
  change_id: string; command_id: string; expected_revision: 0; selection: ElectiveChangeSelection;
  preview_fingerprint: string; reason: string; catch_up: ElectiveCatchUp;
  finance_reviewer: Pick<ElectiveFinanceReviewer, 'user_id' | 'eligibility_hash'> | null; confirm_delivery: boolean;
}
export interface ElectiveChangeCommand { command_id: string; expected_revision: number }
export interface ElectiveFinanceClassification extends ElectiveChangeCommand {
  expected_ledger_basis_hash: string; outcome: 'no_financial_change' | 'requires_financial_review'; reason: string;
}
export interface ElectiveChangeReceipt {
  id: string; command_id: string; revision: number; action: 'request' | 'finance.assign' | 'finance.classify' | 'apply' | 'withdraw';
  state: 'unassigned' | 'waiting_for_finance' | 'no_financial_change' | 'requires_financial_review' | 'applied' | 'withdrawn';
  replayed: boolean; source_enrollment_id?: string; destination_enrollment_id?: string;
  effective_on?: string; schedule_revisions?: Array<{ previous_plan_id: string; plan_id: string; revision: number; command_id: string }>;
}
export interface ElectiveChangeDetail {
  id: string; revision: number; selection: ElectiveChangeSelection; reason: string; catch_up: ElectiveCatchUp;
  labels: { person: string; source_offering: string; destination_offering: string };
  preview: ElectiveChangePreview; current_preview: ElectiveChangePreview | null; preview_changed: boolean;
  state: ElectiveChangeReceipt['state']; finance: {
    reviewer: ElectiveFinanceReviewer | null; state: 'unassigned' | 'waiting' | 'reviewer_changed' | 'route_unavailable' | 'no_financial_change' | 'requires_financial_review';
    decision_id: string | null; ledger_basis_changed: boolean | null; href: string;
  };
  can_apply: boolean; can_assign_finance: boolean; can_withdraw: boolean; blockers: string[];
}
export interface ElectiveLedgerBasis {
  school_id: string; person_id: string; invoices: Array<{
    invoice_id: string; student_id: string | null; person_id: string; reference: string; due_on: string; amount_paise: number; revision: number;
    ledger: { invoice_id: string; amount_paise: number; credited_paise: number; paid_paise: number; refunded_paise: number; balance_paise: number;
      credits: Array<{ id: string; amount_paise: number }>; payments: Array<{ id: string; amount_paise: number }>; refunds: Array<{ id: string; amount_paise: number }>;
    };
  }>;
}
export interface ElectiveFinanceReview {
  id: string; revision: number; selection: ElectiveChangeSelection; reason: string; preview: ElectiveChangePreview; state: ElectiveChangeReceipt['state']; reviewer: ElectiveFinanceReviewer;
  labels: { person: string; source_offering: string; destination_offering: string };
  ledger_basis: ElectiveLedgerBasis; ledger_basis_hash: string;
  latest_decision: { id: string; reviewer_id: string; reviewer_person_id: string; outcome: 'no_financial_change' | 'requires_financial_review'; ledger_basis_hash: string; reason: string; created_at: string } | null;
  can_classify: boolean; finance_account_href: string;
}
export interface ElectiveChangeConfirmation {
  handler: 'learning.elective_change'; source_id: string; command_id: string; action: ElectiveChangeReceipt['action'];
  state: 'not_found' | 'pending' | 'not_accepted' | 'accepted'; result?: Omit<ElectiveChangeReceipt, 'replayed'>;
}
