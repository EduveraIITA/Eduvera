/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
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
  space_id?: string | null;
  use_event_space?: boolean;
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
  space_id?: string | null;
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
