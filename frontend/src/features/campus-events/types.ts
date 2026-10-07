export type CampusEventType =
  | "annual_function"
  | "excursion"
  | "sports"
  | "workshop"
  | "competition"
  | "assembly"
  | "ptm"
  | "club"
  | "class_test"
  | "other";

export type CampusEventStatus = "draft" | "published" | "cancelled" | "completed";
export type ParticipationRequirement = "mandatory" | "optional";
export type AttendanceMode = "none" | "check_in" | "check_in_out";
export type RsvpStatus = "pending" | "accepted" | "declined";
export type ConsentStatus = "not_required" | "pending" | "granted" | "denied" | "withdrawn";
export type PaymentStatus = "not_required" | "pending" | "paid";
export type EventAttendanceStatus = "not_recorded" | "present" | "late" | "excused" | "no_show" | "checked_out";
export type EventFinanceState = "not_required" | "not_invoiced" | "collectible" | "paid" | "credited" | "refund_due" | "partially_refunded" | "refunded";
export type EventSessionType = "general" | "rehearsal" | "departure" | "activity" | "return";

export interface CampusEventAudience {
  mode: "school" | "class_sections" | "students";
  class_section_ids: string[];
  student_ids: string[];
}

export interface EventAttendanceCounts {
  recorded: number;
  not_recorded: number;
  present: number;
  late: number;
  excused: number;
  no_show: number;
  checked_out: number;
}

export interface CampusEventSession {
  id: string;
  title: string;
  session_type: EventSessionType;
  venue: string;
  starts_at: string;
  ends_at: string;
  attendance_mode: AttendanceMode;
  state: "open" | "locked";
  revision: number;
  counts: EventAttendanceCounts;
  participant_student_ids: string[];
  viewer_attendance: Array<{
    student_id: string;
    expected: boolean;
    status: EventAttendanceStatus;
    checked_in_at: string | null;
    checked_out_at: string | null;
  }>;
}

export interface CampusEventChecklistItem {
  id: string;
  label: string;
  required: boolean;
  sort_order: number;
}

export interface EventViewerParticipant {
  student_id: string;
  student_name: string;
  avatar_url: string | null;
  participation_requirement: ParticipationRequirement;
  rsvp_status: RsvpStatus;
  rsvp_revision: number;
  consent_status: ConsentStatus;
  consent_revision: number;
  consent_readiness: "not_required" | "ready" | "authority_missing" | "authority_expired";
  payment_status: PaymentStatus;
  payment_amount_paise: number;
  payment_paid_paise: number;
  fee_invoice_id: string | null;
  fee_invoice_status: PaymentStatus;
  checklist_completed: number;
  checklist_total: number;
  checklist_completed_item_ids: string[];
  checklist_required: number;
  checklist_required_completed: number;
  checklist_ready: boolean;
}

export interface CampusEventPermissions {
  can_edit: boolean;
  can_publish: boolean;
  can_cancel: boolean;
  can_complete: boolean;
  can_rsvp: boolean;
  can_consent: boolean;
  can_take_attendance: boolean;
  can_view_finance_details: boolean;
  can_manage_policy: boolean;
  can_manage_audience: boolean;
  can_manage_staff: boolean;
}

export interface CampusEventDto {
  id: string;
  school_id: string;
  event_type: CampusEventType;
  subject_id: string | null;
  status: CampusEventStatus;
  title: string;
  description: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  audience: CampusEventAudience;
  participation_requirement: ParticipationRequirement;
  requires_rsvp: boolean;
  requires_guardian_consent: boolean;
  payment_required: boolean;
  payment_amount_paise: number | null;
  payment_due_on: string | null;
  payment_currency: "INR";
  academic_attendance_impact: "none";
  revision: number;
  published_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancellation_internal_reason: string | null;
  sessions: CampusEventSession[];
  checklist: CampusEventChecklistItem[];
  viewer_participants: EventViewerParticipant[];
  counts: {
    participants: number;
    mandatory: number;
    rsvp_accepted: number;
    consent_granted: number;
    checklist_ready: number;
    checklist_required_items: number;
    finance_reconciliation_required: number;
  };
  permissions: CampusEventPermissions;
  staff: Array<{ user_id: string; name: string; role: "organizer" | "duty_staff" | "attendance_taker" }>;
}

export interface CampusEventListResponse {
  items: CampusEventDto[];
  next_cursor: string | null;
}

export interface EventCatalogResponse {
  class_sections: Array<{ id: string; name: string; grade: string; section: string }>;
  students: Array<{ id: string; name: string; class_section_id: string; admission_number: string }>;
  staff: Array<{ user_id: string; name: string }>;
  subjects: Array<{ id: string; name: string; short_name: string; class_section_ids: string[] }>;
}

export interface CampusEventInput {
  event_type: CampusEventType;
  subject_id: string | null;
  title: string;
  description: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  audience: CampusEventAudience;
  participation_requirement: ParticipationRequirement;
  requires_rsvp: boolean;
  requires_guardian_consent: boolean;
  payment_required: boolean;
  payment_amount_paise: number | null;
  payment_due_on: string | null;
  sessions: Array<{
    id?: string;
    title: string;
    session_type: EventSessionType;
    venue: string;
    starts_at: string;
    ends_at: string;
    attendance_mode: AttendanceMode;
    participant_student_ids?: string[];
  }>;
  checklist: Array<{ id?: string; label: string; required: boolean }>;
  staff?: Array<{ user_id: string; role: "organizer" | "duty_staff" | "attendance_taker" }>;
}

export interface EventRegisterRow {
  student_id: string;
  student_name: string;
  admission_number: string;
  avatar_url: string | null;
  participation_requirement: ParticipationRequirement;
  rsvp_status: RsvpStatus;
  consent_required: boolean;
  consent_status: ConsentStatus;
  consent_readiness: "not_required" | "ready" | "authority_missing" | "authority_expired";
  payment_status: PaymentStatus;
  payment_amount_paise: number;
  payment_paid_paise: number;
  fee_invoice_id: string | null;
  attendance_status: EventAttendanceStatus;
  note: string;
  record_revision: number;
  checked_in_at: string | null;
  checked_out_at: string | null;
  checklist_ready: boolean;
  participation_ready: boolean;
  readiness_blockers: Array<"guardian_consent" | "required_checklist">;
  readiness_contradiction_note: string | null;
}

export interface EventRegisterResponse {
  event: { id: string; title: string; status: CampusEventStatus };
  session: Pick<CampusEventSession, "id" | "title" | "session_type" | "starts_at" | "ends_at" | "attendance_mode" | "state" | "revision">;
  counts: EventAttendanceCounts & { participants: number };
  rows: EventRegisterRow[];
  permissions: { can_take_attendance: boolean; can_lock: boolean; can_reopen: boolean; attendance_disabled_reason?: string | null; lock_disabled_reason?: string | null };
}

export interface EventRegisterInput {
  expected_revision: number;
  records: Array<{ student_id: string; status: EventAttendanceStatus; note: string; observed_at: string | null; readiness_contradiction_note: string | null }>;
  idempotency_key: string;
  reason?: string;
}

export interface EventAttendanceHistoryResponse {
  event: { id: string; title: string };
  session: { id: string; title: string };
  items: Array<{
    id: string | number;
    student_id: string;
    student_name: string;
    revision: number;
    previous_status: EventAttendanceStatus | null;
    new_status: EventAttendanceStatus;
    previous_note: string | null;
    new_note: string | null;
    previous_checked_in_at: string | null;
    new_checked_in_at: string | null;
    previous_checked_out_at: string | null;
    new_checked_out_at: string | null;
    reason: string | null;
    changed_by: string;
    changed_by_name: string;
    created_at: string;
  }>;
}

export interface EventFinanceParticipant {
  student_id: string;
  student_name: string;
  admission_number: string;
  avatar_url: string | null;
  participation_state: "pending" | "accepted" | "declined" | "withdrawn";
  withdrawn_at: string | null;
  can_withdraw: boolean;
  finance_state: EventFinanceState;
  currency: "INR";
  invoice_id: string | null;
  invoice_amount_paise: number;
  credited_paise: number;
  paid_paise: number;
  refunded_paise: number;
  collectible_balance_paise: number;
  refund_due_paise: number;
  refunds: Array<{
    id: string;
    amount_paise: number;
    method: "cash" | "bank_transfer" | "cheque";
    reference: string;
    reason: string;
    recorded_at: string;
  }>;
}

export interface EventFinanceResponse {
  event: { id: string; title: string; status: CampusEventStatus };
  items: EventFinanceParticipant[];
  counts: { reconciliation_required: number; withdrawn: number };
  permissions: { can_view_finance_details: boolean; can_record_refund: boolean };
}

export interface ConsentAuthorityRecord {
  relationship_id: string;
  relationship_revision: number;
  guardian_name: string;
  id: string | null;
  status: "active" | "revoked" | null;
  valid_from: string | null;
  valid_until: string | null;
  source: string | null;
  provenance: string | null;
  revision: number | null;
  granted_at: string | null;
  revoked_at: string | null;
  effective: boolean;
}
