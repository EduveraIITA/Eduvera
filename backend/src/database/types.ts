import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
type DateOnly = ColumnType<string, string, string>;
type TimeOnly = ColumnType<string, string, string>;
type Json = ColumnType<unknown, unknown, unknown>;
type Bytea = ColumnType<Buffer, Buffer, Buffer>;

export interface UserTable {
  id: Generated<string>;
  username: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  avatar_url: Generated<string>;
  role: "student" | "parent" | "staff" | "admin";
  is_active: Generated<boolean>;
  email_verified_at: Generated<Date | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchoolTable { id: Generated<string>; name: string; code: string; timezone: Generated<string>; attendance_submission_cutoff: Generated<string>; institution_kind: Generated<"school" | "college" | "coaching" | "hybrid">; onboarding_model: Generated<"company_managed" | "company_verified" | "self_service_coaching">; verification_status: Generated<"not_required" | "pending" | "approved" | "rejected">; created_by_user_id: string | null; created_at: Timestamp }
export interface MembershipTable { id: Generated<string>; user_id: string; school_id: string; role: "student" | "guardian" | "staff" | "admin"; is_active: Generated<boolean>; created_at: Timestamp }
export interface SchoolPersonTable { id: Generated<string>; school_id: string; first_name: string; last_name: Generated<string>; contact_phone: Generated<string>; contact_email: Generated<string>; avatar_url: Generated<string>; revision: Generated<number>; created_at: Timestamp }
export interface GuardianSchoolProfileTable { school_id: string; guardian_id: string; person_id: string }
export interface StudentTable { id: Generated<string>; person_id: Generated<string>; user_id: string | null; school_id: string; admission_number: string; date_of_birth: DateOnly | null; blood_group: string | null; emergency_contact: string | null; avatar_url: Generated<string>; created_at: Timestamp }
export interface ParentTable { id: Generated<string>; user_id: string | null; phone: Generated<string>; created_at: Timestamp }
export interface GuardianRelationshipTable { id: Generated<string>; school_id: Generated<string>; guardian_id: string; student_id: string; relationship: "mother" | "father" | "guardian"; is_primary: Generated<boolean>; can_authorize_leave: Generated<boolean>; authority_revision: Generated<number>; leave_valid_from: Generated<string|null>; leave_valid_until: Generated<string|null>; authority_source: Generated<"legacy"|"enrollment"|"reviewed">; created_at: Timestamp }
export interface AcademicTermTable { id: Generated<string>; school_id: string; academic_year: string; name: string; starts_on: DateOnly; ends_on: DateOnly; attendance_threshold: string; is_active: Generated<boolean>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface ClassSectionTable { id: Generated<string>; school_id: string; academic_year: string; grade: string; section: string; board: Generated<string>; room_number: Generated<string>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface EnrollmentTable { id: Generated<string>; student_id: string; class_section_id: string; term_id: string; roll_number: number; enrolled_on: Generated<string>; is_active: Generated<boolean> }
export interface SubjectTable { id: Generated<string>; school_id: string; code: string; name: string; short_name: string; color: Generated<string>; icon: Generated<string>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface SubjectAttendanceTable { id: Generated<string>; student_id: string; subject_id: string; term_id: string; classes_held: Generated<number>; classes_attended: Generated<number>; classes_excused: Generated<number> }
export interface AttendanceRecordTable { id: Generated<string>; student_id: string; class_section_id: string; date: DateOnly; status: "present" | "absent" | "late" | "excused" | "half_day"; check_in_at: NullableTimestamp; check_out_at: NullableTimestamp; remarks: Generated<string>; marked_by: string | null; revision: Generated<number>; source_request_id: Generated<string | null>; created_at: Timestamp; updated_at: Timestamp }
export interface AttendanceRegisterTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; state: Generated<"draft" | "submitted" | "locked">; revision: Generated<number>; submitted_by: string | null; submitted_at: NullableTimestamp; locked_by: string | null; locked_at: NullableTimestamp; reopened_by: string | null; reopened_at: NullableTimestamp; reopen_reason: string | null; created_at: Timestamp; updated_at: Timestamp }
export interface AttendanceSubmissionTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; submitted_by: string; idempotency_key: string; request_hash: string; request_id: string; register_revision: number; records_count: number; changed_count: number; result_status: Generated<number>; result_body: Generated<Json>; source_photo_session_id: string | null; capture_batch_id: string | null; capture_source: Generated<"live_app" | "offline_device" | "paper" | "office" | "photo">; observed_at: NullableTimestamp; completed_at: Timestamp; created_at: Timestamp }
export interface AttendanceRecordRevisionTable { id: Generated<number>; attendance_record_id: string; attendance_submission_id: string | null; attendance_register_id: string | null; school_id: string; student_id: string; class_section_id: string; date: DateOnly; previous_status: AttendanceRecordTable["status"] | null; new_status: AttendanceRecordTable["status"]; previous_remarks: string | null; new_remarks: Generated<string>; previous_check_in_at: NullableTimestamp; new_check_in_at: NullableTimestamp; previous_check_out_at: NullableTimestamp; new_check_out_at: NullableTimestamp; reason: string; changed_by: string; request_id: string; register_revision: number; created_at: Timestamp }
export interface AttendanceCaptureBatchTable {
  id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly;
  source: "live_app" | "offline_device" | "paper" | "office"; source_reference: Generated<string>;
  recorded_by: string; device_id: string | null; idempotency_key: string; request_hash: string;
  roster_fingerprint: string; roster_count: number; expected_register_revision: number;
  observed_at: Timestamp; roster_captured_at: Timestamp; roster_expires_at: Timestamp; received_at: Timestamp;
  status: Generated<"pending" | "accepted" | "quarantined" | "rejected">;
  accepted_submission_id: string | null; accepted_at: NullableTimestamp; resolved_by: string | null;
  resolved_at: NullableTimestamp; resolution_note: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface AttendanceObservationTable {
  id: Generated<string>; batch_id: string; school_id: string; student_id: string;
  class_section_id: string; term_id: string; date: DateOnly;
  observed_status: AttendanceRecordTable["status"]; remarks: Generated<string>;
  observed_at: Timestamp; recorded_at: Timestamp; recorded_by: string;
  source: AttendanceCaptureBatchTable["source"];
}
export interface AttendanceReconciliationCaseTable {
  id: Generated<string>; school_id: string; batch_id: string;
  reason_code: "snapshot_expired" | "roster_changed" | "register_changed" | "permission_revoked" | "assignment_changed" | "invalid_observation_time" | "source_requires_review" | "write_conflict";
  reason: string; details: Generated<Json>; state: Generated<"open" | "accepted" | "rejected">;
  opened_at: Timestamp; decided_by: string | null; decided_at: NullableTimestamp;
  decision_note: string | null; updated_at: Timestamp;
}
export interface SchoolCalendarDayTable {
  id: Generated<string>; school_id: string; date: DateOnly; is_instructional: boolean;
  label: Generated<string>; kind: Generated<"public_holiday" | "local_holiday" | "emergency_closure" | "instructional_override">;
  reason: Generated<string>; revision: Generated<number>; created_by: Generated<string | null>; updated_by: Generated<string | null>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface CurriculumSubjectTargetTable {
  school_id: string; term_id: string; class_section_id: string; subject_id: string;
  target_minutes: number; revision: Generated<number>; updated_by: string | null;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface GateEventTable { id: Generated<string>; student_id: string; occurred_at: Timestamp; direction: "in" | "out"; gate: string; source: Generated<string>; device_reference: Generated<string> }
export interface TimetableSlotTable { id: Generated<string>; class_section_id: string; term_id: string; subject_id: string | null; weekday: number; period_number: number; starts_at: TimeOnly; ends_at: TimeOnly; slot_type: Generated<"class" | "break" | "activity">; title: Generated<string>; room: Generated<string>; teacher_user_id: string | null; teacher_designation: Generated<string> }
export interface AttendancePolicyTable { id: Generated<string>; term_id: string; name: string; minimum_percentage: string; medical_document_after_days: Generated<number>; policy_text: Generated<string> }
export interface LeaveRequestTable { id: Generated<string>; student_id: string; term_id: string; requested_by: string; category: "medical" | "family" | "travel" | "personal"; starts_on: DateOnly; ends_on: DateOnly; reason: string; status: "draft" | "pending_guardian" | "authorized" | "declined" | "school_approved" | "school_rejected" | "withdrawn"; submitted_at: NullableTimestamp; guardian_authorized_by: string | null; guardian_authorized_at: NullableTimestamp; decided_by: string | null; decided_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface LeaveDocumentTable { id: Generated<string>; leave_request_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: Timestamp }
export interface LeaveAuditTable { id: Generated<string>; leave_request_id: string; actor_id: string; action: "submitted" | "document_added" | "clarification_requested" | "authorized" | "declined" | "approved" | "rejected" | "withdrawn"; from_status: string; to_status: string; note: Generated<string>; created_at: Timestamp }
export interface DiaryItemTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; item_type: "note" | "homework" | "announcement" | "schedule"; subject_id: string | null; title: string; body: string; author_id: string; due_at: NullableTimestamp; requires_acknowledgement: Generated<boolean>; published_at: Timestamp; created_at: Timestamp }
export interface DiaryAcknowledgementTable { id: Generated<string>; item_id: string; student_id: string; acknowledged_by: string; acknowledged_at: Timestamp }
export interface HomeworkCompletionTable { item_id: string; student_id: string; completed_by: string; completed_at: Timestamp }
export interface DiaryNoteTable { id: Generated<string>; item_id: string; student_id: string; author_id: string; body: string; created_at: Timestamp }
export interface NotificationTable { id: Generated<string>; recipient_id: string; kind: "attendance" | "leave" | "diary" | "general"; title: string; body: string; link: Generated<string>; metadata: Json; dedupe_key: Generated<string | null>; read_at: NullableTimestamp; created_at: Timestamp }
export interface SchoolContactTable { id: Generated<string>; school_id: string; label: string; name: string; phone: Generated<string>; email: Generated<string>; availability: Generated<string>; priority: Generated<number> }
export interface StaffProfileTable {
  id: Generated<string>; school_id: string; user_id: string | null; staff_code: string;
  first_name: string; last_name: Generated<string>; email: string; phone: Generated<string>;
  staff_kind: "teaching" | "non_teaching"; designation: string; department: Generated<string>;
  employment_type: "full_time" | "part_time" | "contract"; joined_on: DateOnly;
  status: Generated<"onboarding" | "active" | "inactive">; revision: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffOnboardingItemTable {
  id: Generated<string>; school_id: string; staff_profile_id: string;
  item_key: "identity" | "service_contract" | "qualifications" | "emergency_contact" | "account_access";
  label: string; required: Generated<boolean>; completed_at: NullableTimestamp; completed_by: string | null;
  note: Generated<string>; updated_at: Timestamp;
}
export interface StaffLeavePolicyTable {
  id: Generated<string>; school_id: string; academic_year: string; code: string; name: string;
  annual_allowance: string; carry_forward_limit: Generated<string>; requires_document_after_days: string | null;
  is_paid: Generated<boolean>; is_statutory: Generated<boolean>; is_active: Generated<boolean>;
  revision: Generated<number>; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffLeaveBalanceAdjustmentTable {
  id: Generated<string>; school_id: string; staff_profile_id: string; policy_id: string;
  days: string; reason: string; recorded_by: string; created_at: Timestamp;
}
export interface StaffLeaveRequestTable {
  id: Generated<string>; school_id: string; staff_profile_id: string; policy_id: string;
  starts_on: DateOnly; ends_on: DateOnly; portion: Generated<"full_day" | "first_half" | "second_half">;
  requested_days: string; reason: string; handover_note: Generated<string>;
  status: Generated<"submitted" | "approved" | "rejected" | "withdrawn">; revision: Generated<number>;
  submitted_at: Timestamp; decided_by: string | null; decided_at: NullableTimestamp;
  decision_note: Generated<string>; created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffLeaveRequestAuditTable {
  id: Generated<string>; school_id: string; request_id: string; actor_id: string;
  action: "submitted" | "approved" | "rejected" | "withdrawn";
  from_status: string | null; to_status: string; note: Generated<string>; created_at: Timestamp;
}
export interface StaffResponsibilityTypeTable {
  id: Generated<string>; school_id: string; code: string; name: string;
  category: "academic" | "student_support" | "event" | "examination" | "operations" | "governance";
  scope_kind: "school" | "class_section" | "event" | "scheduled_duty";
  description: Generated<string>; access_summary: Generated<string>;
  requires_acceptance: Generated<boolean>; restricted: Generated<boolean>; is_active: Generated<boolean>;
  created_at: Timestamp;
}
export interface StaffResponsibilityAssignmentTable {
  id: Generated<string>; school_id: string; responsibility_type_id: string; staff_profile_id: string;
  class_section_id: string | null; subject_id: string | null; event_id: string | null;
  scope_label: Generated<string>; location: Generated<string>; starts_on: DateOnly; ends_on: DateOnly | null;
  starts_at: TimeOnly | null; ends_at: TimeOnly | null;
  status: "offered" | "active" | "declined" | "completed" | "revoked";
  notes: Generated<string>; assigned_by: string; responded_at: NullableTimestamp;
  response_note: Generated<string>; revoked_by: string | null; revoked_at: NullableTimestamp;
  revocation_reason: Generated<string>; backup_staff_profile_id: string | null;
  revision: Generated<number>; created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffResponsibilityAuditTable {
  id: Generated<string>; school_id: string; assignment_id: string; actor_id: string;
  action: "offered" | "activated" | "accepted" | "declined" | "completed" | "revoked";
  from_status: string | null; to_status: string; note: Generated<string>; created_at: Timestamp;
}
export interface StaffCoverageTaskTable {
  id: Generated<string>; school_id: string; leave_request_id: string; absent_staff_profile_id: string;
  replacement_staff_profile_id: string | null; responsibility_assignment_id: string | null;
  source_schedule_id: string | null; class_section_id: string | null; subject_id: string | null;
  duty_date: DateOnly; period_number: number | null; starts_at: TimeOnly | null; ends_at: TimeOnly | null;
  title: string; location: Generated<string>;
  status: Generated<"open" | "offered" | "accepted" | "declined" | "completed" | "cancelled">;
  handover_note: Generated<string>; assigned_by: string | null; offered_at: NullableTimestamp;
  responded_at: NullableTimestamp; response_note: Generated<string>; revision: Generated<number>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffCoverageTaskAuditTable {
  id: Generated<string>; school_id: string; task_id: string; actor_id: string;
  action: "created" | "offered" | "accepted" | "declined" | "reassigned" | "completed" | "cancelled";
  from_status: string | null; to_status: string; note: Generated<string>; created_at: Timestamp;
}
export interface InstitutionRegulatoryProfileTable {
  school_id: string;
  institution_kind: "school" | "college" | "coaching" | "hybrid";
  country_code: string; state_code: Generated<string>; district: Generated<string>;
  management_kind: "government" | "government_aided" | "private_unaided" | "trust_society" | "corporate" | "other";
  delivery_mode: "in_person" | "online" | "hybrid";
  education_levels: string[]; regulator_codes: string[]; capability_packs: string[];
  recognition_reference: Generated<string>; affiliation_reference: Generated<string>;
  residential: Generated<boolean>; transport_provided: Generated<boolean>; minors_enrolled: Generated<boolean>;
  staff_count_band: "0_9" | "10_49" | "50_99" | "100_249" | "250_plus";
  reviewed_on: DateOnly | null; review_note: Generated<string>; revision: Generated<number>;
  updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface InstitutionPolicyFamilyTable {
  id: Generated<string>; school_id: string; code: string; title: string;
  category: "safeguarding" | "student_operations" | "privacy" | "staff" | "inclusion" | "health_safety" | "communications" | "events_transport" | "finance" | "custom";
  capability_pack: string; applicable_institution_kinds: string[]; source_references: Json;
  default_audiences: string[]; default_requires_acknowledgement: Generated<boolean>;
  risk_level: Generated<"standard" | "high">; guidance: Generated<string>;
  is_custom: Generated<boolean>; is_active: Generated<boolean>; sort_order: Generated<number>; created_at: Timestamp;
}
export interface InstitutionPolicyVersionTable {
  id: Generated<string>; school_id: string; family_id: string; version: number;
  status: Generated<"draft" | "in_review" | "published" | "retired">;
  title: string; summary: Generated<string>; body_markdown: Generated<string>; audience_roles: string[];
  requires_acknowledgement: Generated<boolean>; effective_on: DateOnly | null; review_due_on: DateOnly | null;
  source_note: Generated<string>; created_by: string; submitted_by: string | null; submitted_at: NullableTimestamp;
  reviewed_by: string | null; reviewed_at: NullableTimestamp; review_note: Generated<string>;
  review_separation_met: boolean | null; review_override_reason: Generated<string>;
  published_at: NullableTimestamp; retired_at: NullableTimestamp; revision: Generated<number>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface InstitutionPolicyAcknowledgementTable {
  id: Generated<string>; school_id: string; policy_version_id: string; user_id: string;
  membership_role: "admin" | "staff" | "guardian" | "student";
  acknowledgement_text: string; acknowledged_at: Timestamp;
}
export interface InstitutionGovernanceAuditTable {
  id: Generated<string>; school_id: string; actor_id: string; action: string;
  target_type: "regulatory_profile" | "policy_version" | "policy_acknowledgement";
  target_id: string | null; metadata: Json; created_at: Timestamp;
}
export interface RestrictedCareRoleAssignmentTable {
  id: Generated<string>; school_id: string; user_id: string;
  role_kind: "designated_lead" | "deputy_lead" | "institution_head" | "counsellor" | "external_liaison";
  route_kind: "primary" | "alternate"; valid_from: DateOnly; valid_until: DateOnly | null;
  status: Generated<"active" | "revoked">; created_by: string; revoked_by: string | null;
  revoked_at: NullableTimestamp; revocation_reason: Generated<string>; revision: Generated<number>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface RestrictedCareCaseTable {
  id: Generated<string>; school_id: string; student_id: string | null; reported_by: string; owner_user_id: string;
  intake_route: "primary" | "alternate";
  source_kind: "staff_observation" | "child_disclosure" | "guardian_report" | "student_report" | "anonymous" | "other";
  urgency: "urgent" | "priority" | "routine";
  concern_category: "sexual_safety" | "physical_safety" | "emotional_wellbeing" | "neglect" | "bullying" | "cyber_safety" | "other";
  safety_state: "immediate_action_required" | "actions_underway" | "no_immediate_danger" | "unknown";
  ordinary_handler_involved: Generated<boolean>; status: Generated<"open" | "triage" | "active" | "closed">;
  reporting_state: Generated<"assessment_required" | "reporting_required" | "reported" | "not_applicable">;
  observed_at: NullableTimestamp; opened_at: Timestamp; last_activity_at: Timestamp; closed_at: NullableTimestamp;
  closed_by: string | null; retention_review_on: DateOnly | null; legal_hold: Generated<boolean>;
  revision: Generated<number>; created_at: Timestamp; updated_at: Timestamp;
}
export interface RestrictedCareCaseAssignmentTable {
  id: Generated<string>; school_id: string; case_id: string; user_id: string;
  assignment_role: "reporter" | "owner" | "backup" | "contributor" | "reviewer";
  access_level: "intake_only" | "full"; assigned_by: string; assigned_at: Timestamp;
  revoked_by: string | null; revoked_at: NullableTimestamp; revocation_reason: Generated<string>;
}
export interface RestrictedCareCaseEntryTable {
  id: Generated<string>; school_id: string; case_id: string;
  entry_type: "intake_note" | "safety_action" | "contact" | "reporting_decision" | "case_note" | "outcome" | "handover";
  ciphertext: Bytea; content_iv: Bytea; content_tag: Bytea; key_version: Generated<number>;
  created_by: string; created_at: Timestamp;
}
export interface RestrictedCareExternalReportTable {
  id: Generated<string>; school_id: string; case_id: string;
  authority_type: "sjpu" | "local_police" | "child_welfare_committee" | "child_helpline" | "other";
  reported_at: Timestamp; reference_ciphertext: Bytea; reference_iv: Bytea; reference_tag: Bytea;
  key_version: Generated<number>; recorded_by: string; created_at: Timestamp;
}
export interface RestrictedCareAuditTable {
  id: Generated<string>; school_id: string; case_id: string | null; actor_id: string;
  action: string; metadata: Json; created_at: Timestamp;
}
export interface AuthSessionTable { token_hash: string; user_id: string; csrf_token: string; expires_at: Timestamp; created_at: Timestamp; last_seen_at: Timestamp; ip_hash: string | null; user_agent: Generated<string>; active_school_id: Generated<string | null> }
export interface AuditEventTable { id: Generated<string>; action: string; actor_id: string | null; school_id: string | null; target_type: Generated<string>; target_id: string | null; request_id: string; ip_hash: string | null; metadata: Json; created_at: Timestamp }
export interface AiConversationTable { id: Generated<string>; owner_id: string; student_id: string; title: string; status: Generated<"active" | "archived">; created_at: Timestamp; updated_at: Timestamp }
export interface AiMessageTable { id: Generated<string>; conversation_id: string; role: "user" | "assistant"; content: string; citations: Json; provider: string; model: string; status: Generated<"complete" | "error">; latency_ms: number | null; created_at: Timestamp }
export interface ApiRateLimitBucketTable { bucket_key: string; hits: number; expires_at: Timestamp }
export interface EventOutboxTable {
  id: Generated<string>;
  sequence: Generated<number>;
  delivery_sequence: Generated<number | null>;
  school_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  audience_user_ids: string[];
  payload: Json;
  idempotency_key: string;
  available_at: Timestamp;
  published_at: NullableTimestamp;
  published_by: Generated<string | null>;
  notification_user_ids: Generated<string[]>;
  notification_payload: Generated<Json | null>;
  expires_at: Timestamp;
  attempts: Generated<number>;
  last_error: string | null;
  last_attempt_at: NullableTimestamp;
  dead_lettered_at: NullableTimestamp;
  claim_expires_at: NullableTimestamp;
  created_at: Timestamp;
}
export interface EventDeliveryCursorTable {
  singleton: Generated<boolean>;
  last_sequence: Generated<number>;
  replay_floor: Generated<number>;
}
export interface EventMaintenanceLeaseTable {
  task_name: string;
  last_claimed_at: NullableTimestamp;
}
export interface PhotoAttendanceClassBindingTable { id: Generated<string>; school_id: string; class_section_id: string; provider_class_id: string; created_by: string; created_at: Timestamp; updated_at: Timestamp }
export interface PhotoAttendanceProfileTable { id: Generated<string>; school_id: string; class_section_id: string; student_id: string; provider_class_id: string; provider_student_id: string; sample_count: Generated<number>; model_id: string | null; authorization_reference: string; enrolled_by: string; enrolled_at: Timestamp; updated_at: Timestamp; revoked_at: NullableTimestamp }
export interface PhotoAttendanceSessionTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; period: string; provider_session_id: string; captured_by: string; capture_authorization_reference: string; state: Generated<"analyzed" | "applied" | "discarded" | "expired">; roster_count: number; detected_faces: Generated<number>; proposed_present: Generated<number>; model_id: string; analysis_summary: Json; observed_at: Timestamp; received_at: Timestamp; expires_at: Timestamp; applied_at: NullableTimestamp; applied_submission_id: string | null; created_at: Timestamp; updated_at: Timestamp }
export interface CampusEventTable {
  id: Generated<string>; school_id: string;
  event_type: "annual_function" | "excursion" | "sports" | "workshop" | "competition" | "assembly" | "ptm" | "club" | "class_test" | "other";
  subject_id: string | null;
  status: Generated<"draft" | "published" | "cancelled" | "completed">;
  title: string; description: Generated<string>; venue: Generated<string>;
  starts_at: Timestamp; ends_at: Timestamp;
  audience_mode: "school" | "class_sections" | "students";
  participation_requirement: "optional" | "mandatory";
  requires_rsvp: Generated<boolean>; requires_guardian_consent: Generated<boolean>;
  payment_required: Generated<boolean>; payment_amount_paise: number | null; payment_due_on: DateOnly | null;
  payment_currency: Generated<"INR">; academic_attendance_impact: Generated<"none">;
  revision: Generated<number>; created_by: string; published_by: string | null;
  published_at: NullableTimestamp; cancelled_by: string | null; cancelled_at: NullableTimestamp;
  cancellation_reason: string | null; completed_by: string | null; completed_at: NullableTimestamp;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface ClassSectionStaffAssignmentTable {
  id: Generated<string>; school_id: string; class_section_id: string; user_id: string;
  role: "class_teacher" | "subject_teacher"; subject_id: string | null;
  valid_from: DateOnly; valid_until: DateOnly | null; assigned_by: string; created_at: Timestamp;
}
export interface CampusEventClassSectionTable { school_id: string; event_id: string; class_section_id: string }
export interface CampusEventSelectedStudentTable { school_id: string; event_id: string; student_id: string }
export interface CampusEventStaffTable { school_id: string; event_id: string; user_id: string; role: "organizer" | "duty_staff" | "attendance_taker"; assigned_at: Timestamp }
export interface CampusEventSessionTable {
  id: Generated<string>; school_id: string; event_id: string; title: string;
  session_type: "general" | "rehearsal" | "departure" | "activity" | "return";
  venue: Generated<string>; starts_at: Timestamp; ends_at: Timestamp;
  attendance_mode: "none" | "check_in" | "check_in_out";
  state: Generated<"open" | "locked">; revision: Generated<number>;
  locked_by: string | null; locked_at: NullableTimestamp; lock_reason: string | null; reopened_by: string | null;
  reopened_at: NullableTimestamp; reopen_reason: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusEventSessionSelectedStudentTable { school_id: string; event_id: string; session_id: string; student_id: string }
export interface CampusEventParticipantTable {
  school_id: string; event_id: string; student_id: string;
  participation_requirement: "optional" | "mandatory";
  rsvp_status: Generated<"pending" | "accepted" | "declined">;
  fee_invoice_id: string | null;
  invited_at: Timestamp; rsvp_by: string | null; rsvp_at: NullableTimestamp;
}
export interface CampusEventSessionParticipantTable { school_id: string; event_id: string; session_id: string; student_id: string; participation_requirement: "optional" | "mandatory" }
export interface CampusEventConsentAuthorityTable {
  id: Generated<string>; school_id: string; relationship_id: string;
  status: Generated<"active">; valid_from: DateOnly; valid_until: DateOnly | null;
  source: "enrollment" | "reviewed" | "policy"; provenance: string; revision: Generated<number>;
  granted_by: string; granted_at: Timestamp; revoked_by: string | null; revoked_at: NullableTimestamp;
  revocation_reason: string | null;
}
export interface CampusEventConsentAuthorityRevocationTable {
  school_id: string; authority_id: string; relationship_id: string; revision: number;
  revoked_by: string; revoked_at: Timestamp; reason: string; request_id: string;
}
export interface CampusEventConsentTable {
  school_id: string; event_id: string; student_id: string; relationship_id: string; authority_id: string;
  status: "granted" | "denied" | "withdrawn"; note: Generated<string>; decided_by: string;
  decided_at: Timestamp; revision: Generated<number>;
}
export interface CampusEventConsentRevisionTable {
  id: Generated<number>; school_id: string; event_id: string; student_id: string;
  relationship_id: string; authority_id: string;
  previous_status: CampusEventConsentTable["status"] | null; new_status: CampusEventConsentTable["status"];
  previous_note: string | null; new_note: Generated<string>; revision: number;
  decided_by: string; request_id: string; created_at: Timestamp;
}
export interface CampusEventChecklistItemTable { id: Generated<string>; school_id: string; event_id: string; label: string; required: Generated<boolean>; sort_order: Generated<number> }
export interface CampusEventChecklistCompletionTable { school_id: string; event_id: string; item_id: string; student_id: string; completed_by: string; completed_at: Timestamp }
export interface CampusEventAttendanceRecordTable {
  id: Generated<string>; school_id: string; event_id: string; session_id: string; student_id: string;
  status: "not_recorded" | "present" | "late" | "excused" | "no_show" | "checked_out";
  note: Generated<string>; checked_in_at: NullableTimestamp; checked_out_at: NullableTimestamp;
  revision: Generated<number>; marked_by: string; marked_at: Timestamp; updated_at: Timestamp;
}
export interface CampusEventAttendanceRevisionTable {
  id: Generated<number>; school_id: string; event_id: string; session_id: string; student_id: string;
  attendance_record_id: string; previous_status: CampusEventAttendanceRecordTable["status"] | null;
  new_status: CampusEventAttendanceRecordTable["status"]; previous_note: string | null;
  new_note: Generated<string>; previous_checked_in_at: NullableTimestamp; new_checked_in_at: NullableTimestamp;
  previous_checked_out_at: NullableTimestamp; new_checked_out_at: NullableTimestamp;
  reason: string; revision: number; changed_by: string;
  request_id: string; created_at: Timestamp;
}
export interface CampusEventCommandTable { school_id: string; actor_id: string; command_key: string; operation: string; request_hash: string; result: Json; created_at: Timestamp }
export interface FeeInvoiceTable { id: Generated<string>; school_id: string; student_id: string; reference: string; description: string; amount_paise: number; due_on: DateOnly; created_by: string; created_at: Timestamp }
export interface FeePaymentTable { id: Generated<string>; school_id: string; invoice_id: string; amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; idempotency_key: string; recorded_by: string; created_at: Timestamp }
export interface CampusEventParticipantWithdrawalTable { id: Generated<string>; school_id: string; event_id: string; student_id: string; reason: string; idempotency_key: string; request_hash: string; withdrawn_by: string; withdrawn_at: Timestamp }
export interface FeeInvoiceCreditTable { id: Generated<string>; school_id: string; invoice_id: string; event_id: string; student_id: string; participant_withdrawal_id: string | null; amount_paise: number; source: "event_cancelled" | "participant_withdrawn"; reason: string; idempotency_key: string; request_hash: string; recorded_by: string; created_at: Timestamp }
export interface FeeRefundTable { id: Generated<string>; school_id: string; invoice_id: string; credit_id: string; event_id: string; student_id: string; amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; reason: string; idempotency_key: string; request_hash: string; recorded_by: string; created_at: Timestamp }
export interface ChatConversationTable { id: Generated<string>; school_id: string; kind: Generated<"direct" | "group" | "announcement">; title: Generated<string>; context_student_id: string | null; group_type: Generated<"student_group" | "parent_group" | "activity" | "staff" | "child_support" | "announcement" | null>; posting_mode: Generated<"all" | "moderators">; created_by: string; last_message_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface ChatParticipantTable { conversation_id: string; user_id: string; participant_role: Generated<"member" | "moderator">; joined_at: Timestamp; last_read_at: NullableTimestamp; is_muted: Generated<boolean>; is_active: Generated<boolean> }
export interface ChatMessageTable { id: Generated<string>; conversation_id: string; sender_id: string; client_id: string | null; body: Generated<string>; message_type: Generated<"text" | "file" | "system">; reply_to_id: string | null; is_deleted: Generated<boolean>; created_at: Timestamp; updated_at: Timestamp }
export interface ChatAttachmentTable { id: Generated<string>; message_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; created_at: Timestamp }
export interface ChatMessageReportTable { id: Generated<string>; message_id: string; reported_by: string; reason: string; status: Generated<"open" | "under_review" | "resolved" | "dismissed">; assigned_to: string | null; reviewed_by: string | null; resolution_note: Generated<string>; action_taken: Generated<"none" | "no_action" | "warning" | "restrict" | "escalate">; created_at: Timestamp; updated_at: Timestamp; resolved_at: NullableTimestamp }
export interface ChatMessagingRestrictionTable { id: Generated<string>; school_id: string; user_id: string; report_id: string; reason: string; starts_at: Timestamp; expires_at: Timestamp; created_by: string; revoked_at: NullableTimestamp; created_at: Timestamp }
export interface AssessmentCycleTable { id: Generated<string>; school_id: string; term_id: string; name: string; code: string; starts_on: DateOnly; ends_on: DateOnly; status: Generated<"draft"|"active"|"completed"|"archived">; result_label: Generated<string>; revision: Generated<number>; created_by: string; updated_by: string; created_at: Timestamp; updated_at: Timestamp }
export interface AssessmentTable { id: Generated<string>; school_id: string; cycle_id: string; class_section_id: string; subject_id: string; title: string; assessment_kind: "exam"|"class_test"|"quiz"|"assignment"|"practical"|"viva"|"project"|"other"; maximum_marks: string; weight_percent: string|null; scheduled_at: NullableTimestamp; duration_minutes: number|null; venue: Generated<string>; instructions: Generated<string>; evidence_requirement: Generated<"none"|"optional"|"required">; status: Generated<"draft"|"scheduled"|"marking"|"submitted"|"moderated"|"published"|"cancelled">; revision: Generated<number>; moderation_note: Generated<string>; submitted_by: string|null; submitted_at: NullableTimestamp; moderated_by: string|null; moderated_at: NullableTimestamp; cancelled_by: string|null; cancelled_at: NullableTimestamp; cancellation_reason: Generated<string>; created_by: string; updated_by: string; created_at: Timestamp; updated_at: Timestamp }
export interface AssessmentStaffAssignmentTable { school_id: string; assessment_id: string; user_id: string; role: "examiner"|"moderator"; assigned_by: string; assigned_at: Timestamp }
export interface AssessmentResultTable { id: Generated<string>; school_id: string; assessment_id: string; student_id: string; outcome: Generated<"unrecorded"|"scored"|"absent"|"exempt"|"withheld"|"not_evaluated">; marks: string|null; grade: Generated<string>; feedback: Generated<string>; revision: Generated<number>; recorded_by: string|null; recorded_at: NullableTimestamp; updated_at: Timestamp }
export interface AssessmentResultRevisionTable { id: Generated<number>; school_id: string; assessment_id: string; result_id: string; student_id: string; revision: number; previous_outcome: string|null; outcome: string; previous_marks: string|null; marks: string|null; previous_grade: Generated<string>; grade: Generated<string>; previous_feedback: Generated<string>; feedback: Generated<string>; reason: string; changed_by: string; created_at: Timestamp }
export interface AssessmentEvidenceTable { id: Generated<string>; school_id: string; assessment_id: string; result_id: string; student_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; uploaded_by: string; uploaded_at: Timestamp }
export interface AssessmentPublicationTable { id: Generated<string>; school_id: string; assessment_id: string; sequence: number; source_revision: number; reason: string; published_by: string; published_at: Timestamp }
export interface AssessmentPublicationResultTable { school_id: string; publication_id: string; assessment_id: string; student_id: string; source_result_id: string; source_result_revision: number; outcome: "scored"|"absent"|"exempt"|"withheld"|"not_evaluated"; marks: string|null; grade: Generated<string>; feedback: Generated<string> }
export interface AssessmentAuditTable { id: Generated<number>; school_id: string; assessment_id: string|null; actor_id: string; action: string; from_status: string|null; to_status: string|null; metadata: Json; created_at: Timestamp }

export interface Database {
  school_people: SchoolPersonTable;
  guardian_school_profiles: GuardianSchoolProfileTable;
  users: UserTable;
  schools: SchoolTable;
  school_memberships: MembershipTable;
  students: StudentTable;
  parents: ParentTable;
  guardian_relationships: GuardianRelationshipTable;
  academic_terms: AcademicTermTable;
  class_sections: ClassSectionTable;
  enrollments: EnrollmentTable;
  subjects: SubjectTable;
  subject_attendance: SubjectAttendanceTable;
  attendance_records: AttendanceRecordTable;
  attendance_registers: AttendanceRegisterTable;
  attendance_submissions: AttendanceSubmissionTable;
  attendance_record_revisions: AttendanceRecordRevisionTable;
  attendance_capture_batches: AttendanceCaptureBatchTable;
  attendance_observations: AttendanceObservationTable;
  attendance_reconciliation_cases: AttendanceReconciliationCaseTable;
  school_calendar_days: SchoolCalendarDayTable;
  curriculum_subject_targets: CurriculumSubjectTargetTable;
  gate_events: GateEventTable;
  timetable_slots: TimetableSlotTable;
  attendance_policies: AttendancePolicyTable;
  leave_requests: LeaveRequestTable;
  leave_documents: LeaveDocumentTable;
  leave_audits: LeaveAuditTable;
  diary_items: DiaryItemTable;
  diary_acknowledgements: DiaryAcknowledgementTable;
  homework_completions: HomeworkCompletionTable;
  diary_notes: DiaryNoteTable;
  notifications: NotificationTable;
  school_contacts: SchoolContactTable;
  staff_profiles: StaffProfileTable;
  staff_onboarding_items: StaffOnboardingItemTable;
  staff_leave_policies: StaffLeavePolicyTable;
  staff_leave_balance_adjustments: StaffLeaveBalanceAdjustmentTable;
  staff_leave_requests: StaffLeaveRequestTable;
  staff_leave_request_audits: StaffLeaveRequestAuditTable;
  staff_responsibility_types: StaffResponsibilityTypeTable;
  staff_responsibility_assignments: StaffResponsibilityAssignmentTable;
  staff_responsibility_audits: StaffResponsibilityAuditTable;
  staff_coverage_tasks: StaffCoverageTaskTable;
  staff_coverage_task_audits: StaffCoverageTaskAuditTable;
  institution_regulatory_profiles: InstitutionRegulatoryProfileTable;
  institution_policy_families: InstitutionPolicyFamilyTable;
  institution_policy_versions: InstitutionPolicyVersionTable;
  institution_policy_acknowledgements: InstitutionPolicyAcknowledgementTable;
  institution_governance_audits: InstitutionGovernanceAuditTable;
  restricted_care_role_assignments: RestrictedCareRoleAssignmentTable;
  restricted_care_cases: RestrictedCareCaseTable;
  restricted_care_case_assignments: RestrictedCareCaseAssignmentTable;
  restricted_care_case_entries: RestrictedCareCaseEntryTable;
  restricted_care_external_reports: RestrictedCareExternalReportTable;
  restricted_care_audits: RestrictedCareAuditTable;
  auth_sessions: AuthSessionTable;
  audit_events: AuditEventTable;
  ai_conversations: AiConversationTable;
  ai_messages: AiMessageTable;
  api_rate_limit_buckets: ApiRateLimitBucketTable;
  event_outbox: EventOutboxTable;
  event_delivery_cursor: EventDeliveryCursorTable;
  event_maintenance_leases: EventMaintenanceLeaseTable;
  photo_attendance_class_bindings: PhotoAttendanceClassBindingTable;
  photo_attendance_profiles: PhotoAttendanceProfileTable;
  photo_attendance_sessions: PhotoAttendanceSessionTable;
  campus_events: CampusEventTable;
  class_section_staff_assignments: ClassSectionStaffAssignmentTable;
  campus_event_class_sections: CampusEventClassSectionTable;
  campus_event_selected_students: CampusEventSelectedStudentTable;
  campus_event_staff: CampusEventStaffTable;
  campus_event_sessions: CampusEventSessionTable;
  campus_event_session_selected_students: CampusEventSessionSelectedStudentTable;
  campus_event_participants: CampusEventParticipantTable;
  campus_event_session_participants: CampusEventSessionParticipantTable;
  campus_event_consent_authorities: CampusEventConsentAuthorityTable;
  campus_event_consent_authority_revocations: CampusEventConsentAuthorityRevocationTable;
  campus_event_consents: CampusEventConsentTable;
  campus_event_consent_revisions: CampusEventConsentRevisionTable;
  campus_event_checklist_items: CampusEventChecklistItemTable;
  campus_event_checklist_completions: CampusEventChecklistCompletionTable;
  campus_event_attendance_records: CampusEventAttendanceRecordTable;
  campus_event_attendance_revisions: CampusEventAttendanceRevisionTable;
  campus_event_commands: CampusEventCommandTable;
  campus_event_participant_withdrawals: CampusEventParticipantWithdrawalTable;
  fee_invoices: FeeInvoiceTable;
  fee_payments: FeePaymentTable;
  fee_invoice_credits: FeeInvoiceCreditTable;
  fee_refunds: FeeRefundTable;
  chat_conversations: ChatConversationTable;
  chat_participants: ChatParticipantTable;
  chat_messages: ChatMessageTable;
  chat_attachments: ChatAttachmentTable;
  chat_message_reports: ChatMessageReportTable;
  chat_messaging_restrictions: ChatMessagingRestrictionTable;
  assessment_cycles: AssessmentCycleTable;
  assessments: AssessmentTable;
  assessment_staff_assignments: AssessmentStaffAssignmentTable;
  assessment_results: AssessmentResultTable;
  assessment_result_revisions: AssessmentResultRevisionTable;
  assessment_evidence: AssessmentEvidenceTable;
  assessment_publications: AssessmentPublicationTable;
  assessment_publication_results: AssessmentPublicationResultTable;
  assessment_audits: AssessmentAuditTable;
  chat_policies: ChatPolicyTable;
}

export type UserRow = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;


export interface ChatPolicyTable {
  school_id: string;
  student_teacher_direct_enabled: Generated<boolean>;
  guardian_teacher_direct_enabled: Generated<boolean>;
  student_group_replies: Generated<boolean>;
  guardian_group_replies: Generated<boolean>;
  attachments_enabled: Generated<boolean>;
  enforce_communication_hours: Generated<boolean>;
  communication_start: ColumnType<string, string | undefined, string>;
  communication_end: ColumnType<string, string | undefined, string>;
  retention_days: Generated<number>;
  privacy_notice_version: Generated<string>;
  updated_by: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: Timestamp;
}
