Warning: truncated output (original token count: 26311)
Total output lines: 1215

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
  pro_features_enabled: Generated<boolean>;
  email_verified_at: Generated<Date | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchoolTable { id: Generated<string>; name: string; code: string; timezone: Generated<string>; attendance_submission_cutoff: Generated<string>; institution_kind: Generated<"school" | "college" | "coaching" | "hybrid">; onboarding_model: Generated<"company_managed" | "company_verified" | "self_service_coaching">; verification_status: Generated<"not_required" | "pending" | "approved" | "rejected">; created_by_user_id: string | null; created_at: Timestamp }
export interface MembershipTable { id: Generated<string>; user_id: string; school_id: string; role: "student" | "guardian" | "staff" | "admin"; is_active: Generated<boolean>; created_at: Timestamp }
export interface HostedCampusLabControlTable { school_id: string; enabled: Generated<boolean>; clock_mode: Generated<"realtime"|"1m"|"15m"|"60m">; changed_by: string | null; changed_at: Timestamp }
export interface SchoolPersonTable { id: Generated<string>; school_id: string; first_name: string; last_name: Generated<string>; contact_phone: Generated<string>; contact_email: Generated<string>; avatar_url: Generated<string>; revision: Generated<number>; created_at: Timestamp }
export interface GuardianSchoolProfileTable { school_id: string; guardian_id: string; person_id: string }
export interface StudentTable { id: Generated<string>; person_id: Generated<string>; user_id: string | null; school_id: string; admission_number: string; date_of_birth: DateOnly | null; blood_group: string | null; emergency_contact: string | null; avatar_url: Generated<string>; created_at: Timestamp }
export interface ParentTable { id: Generated<string>; user_id: string | null; phone: Generated<string>; created_at: Timestamp }
export interface GuardianRelationshipTable { id: Generated<string>; school_id: Generated<string>; guardian_id: string; student_id: string; relationship: "mother" | "father" | "guardian"; is_primary: Generated<boolean>; can_authorize_leave: Generated<boolean>; authority_revision: Generated<number>; leave_valid_from: Generated<string|null>; leave_valid_until: Generated<string|null>; authority_source: Generated<"legacy"|"enrollment"|"reviewed">; created_at: Timestamp }
export interface AcademicTermTable { id: Generated<string>; school_id: string; academic_year: string; name: string; starts_on: DateOnly; ends_on: DateOnly; attendance_threshold: string; is_active: Generated<boolean>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface ClassSectionTable { id: Generated<string>; school_id: string; academic_year: string; grade: string; section: string; board: Generated<string>; room_number: Generated<string>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface EnrollmentTable { id: Generated<string>; student_id: string; class_section_id: string; term_id: string; roll_number: number; enrolled_on: Generated<string>; is_active: Generated<boolean>; inactive_from: Generated<string|null>; exit_kind: Generated<"class_move"|"withdrawn"|"transferred_out"|"term_completed"|null>; exit_reason: Generated<string|null>; ended_by: Generated<string|null>; ended_at: Generated<Date|null>; revision: Generated<number> }
export interface StudentEnrollmentChangeReviewTable { id:Generated<string>; school_id:string; student_id:string; created_by:string; expected_enrollment_id:string; expected_revision:number; action:"move_class"|"withdraw"|"transfer_out"; input:Json; impact:Json; expires_at:Generated<Date>; committed_at:Generated<Date|null>; result_enrollment_id:string|null; created_at:Generated<Date> }
export interface SubjectTable { id: Generated<string>; school_id: string; code: string; name: string; short_name: string; color: Generated<string>; icon: Generated<string>; revision: Generated<number>; updated_at: Timestamp; updated_by: string | null }
export interface SubjectAttendanceTable { id: Generated<string>; student_id: string; subject_id: string; term_id: string; classes_held: Generated<number>; classes_attended: Generated<number>; classes_excused: Generated<number> }
export interface AttendanceRecordTable { id: Generated<string>; student_id: string; class_section_id: string; date: DateOnly; status: "present" | "absent" | "late" | "excused" | "half_day"; check_in_at: NullableTimestamp; check_out_at: NullableTimestamp; remarks: Generated<string>; marked_by: string | null; revision: Generated<number>; source_request_id: Generated<string | null>; created_at: Timestamp; updated_at: Timestamp }
export interface AttendanceRegisterTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; state: Generated<"draft" | "submitted" | "locked">; revision: Generated<number>; submitted_by: string | null; submitted_at: NullableTimestamp; locked_by: string | null; locked_at: NullableTimestamp; reopened_by: string | null; reopened_at: NullableTimestamp; reopen_reason: string | null; auto_finalize_at: NullableTimestamp; finalization_policy_revision: number | null; finalization_source: "manual" | "automatic" | null; created_at: Timestamp; updated_at: Timestamp }
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
export interface GateEventTable { id: Generated<string>; student_id: string; occurred_at: Timestamp; direction: "in" | "out"; gate: string; source: Generated<string>; device_reference: Generated<string>; recorded_by: Generated<string|null>; command_id: Generated<string|null> }
export interface GateStaffEventTable { id: Generated<string>; school_id: string; staff_profile_id: string; occurred_at: Timestamp; direction: "in" | "out"; gate: string; source: Generated<string>; recorded_by: string; command_id: string }
export interface TimetableSlotTable { id: Generated<string>; class_section_id: string; term_id: string; subject_id: string | null; weekday: number; period_number: number; starts_at: TimeOnly; ends_at: TimeOnly; slot_type: Generated<"class" | "break" | "activity">; title: Generated<string>; room: Generated<string>; space_id: string | null; teacher_user_id: string | null; teacher_designation: Generated<string>; revision: Generated<number>; updated_by: string | null; updated_at: Timestamp }
export interface AttendancePolicyTable { id: Generated<string>; term_id: string; name: string; minimum_percentage: string; medical_document_after_days: Generated<number>; policy_text: Generated<string> }
export interface LeaveRequestTable { id: Generated<string>; student_id: string; term_id: string; requested_by: string; category: "medical" | "family" | "travel" | "personal"; starts_on: DateOnly; ends_on: DateOnly; reason: string; status: "draft" | "pending_guardian" | "authorized" | "declined" | "school_approved" | "school_rejected" | "withdrawn"; submitted_at: NullableTimestamp; guardian_authorized_by: string | null; guardian_authorized_at: NullableTimestamp; decided_by: string | null; decided_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface LeaveDocumentTable { id: Generated<string>; leave_request_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: Timestamp }
export interface LeaveAuditTable { id: Generated<string>; leave_request_id: string; actor_id: string; action: "submitted" | "document_added" | "clarification_requested" | "authorized" | "declined" | "approved" | "rejected" | "withdrawn"; from_status: string; to_status: string; note: Generated<string>; created_at: Timestamp }
export interface DiaryItemTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; item_type: "note" | "homework" | "announcement" | "schedule"; subject_id: string | null; title: string; body: string; author_id: string; due_at: NullableTimestamp; requires_acknowledgement: Generated<boolean>; published_at: Timestamp; created_at: Timestamp }
export interface DiaryAcknowledgementTable { id: Generated<string>; item_id: string; student_id: string; acknowledged_by: string; acknowledged_at: Timestamp }
export interface HomeworkCompletionTable { item_id: string; student_id: string; completed_by: string; completed_at: Timestamp }
export interface DiaryNoteTable { id: Generated<string>; item_id: string; student_id: string; author_id: string; body: string; created_at: Timestamp }
export interface NotificationTable {
  id: Generated<string>; recipient_id: string; kind: "attendance" | "leave" | "diary" | "general";
  title: string; body: string; link: Generated<string>; metadata: Json;
  dedupe_key: Generated<string | null>; read_at: NullableTimestamp; created_at: Timestamp;
  attention_eligible: Generated<boolean>; attention_school_id: Generated<string | null>;
  attention_student_id: Generated<string | null>; attention_class_section_id: Generated<string | null>;
  attention_portal: Generated<"parent" | "teacher" | "principal" | null>;
  attention_module: Generated<
    "leave" | "results" | "calendar" | "timetable" | "attendance" |
    "events" | "fees" | "safeguarding" | "policies" | "departure" |
    "staff" | "responsibilities" | "transport" | null
  >;
  attention_source_kind: Generated<
    "student_leave_decision" | "staff_leave_decision" | "assessment_publication" |
    "report_publication" | "day_plan_publication" | "timetable_publication" | "calendar_change" |
    "attendance_outcome" | "event_cancellation" | "event_withdrawal" | "event_refund" |
    "fee_review_decision" | "guardian_leave_authority" | "restricted_care_update" |
    "policy_publication" | "departure_request_decision" | "transport_trip_cancellation" |
    "transport_rider_exception" | "departure_handover_exception" | "departure_plan_exception" |
    "responsibility_offer" | "responsibility_response" | "responsibility_revocation" |
    "coverage_offer" | "coverage_response" | "staff_leave_review" |
    "transport_swap" | "transport_swap_approval" | "transport_swap_response" |
    "transport_swap_decision" | null
  >;
  attention_source_id: Generated<string | null>; attention_source_revision: Generated<number | null>;
  attention_topic_key: Generated<string | null>;
}
export interface SchoolContactTable { id: Generated<string>; school_id: string; label: string; name: string; phone: Generated<string>; email: Generated<string>; availability: Generated<string>; priority: Generated<number> }
export interface StaffProfileTable {
  id: Generated<string>; school_id: string; user_id: string | null; person_id: Generated<string>; staff_code: string;
  first_name: string; last_name: Generated<string>; email: string; phone: Generated<string>;
  staff_kind: "teaching" | "non_teaching"; designation: string; department: Generated<string>;
  employment_type: "full_time" | "part_time" | "contract"; joined_on: DateOnly;
  status: Generated<"onboarding" | "active" | "inactive">; revision: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface InstitutionCampusTable {
  id: Generated<string>; school_id: string; parent_campus_id: string | null; name: string; code: string;
  campus_type: "main" | "branch" | "learning_centre" | "virtual";
  status: Generated<"active" | "inactive">; is_primary: Generated<boolean>;
  address_line: Generated<string>; city: Generated<string>; state: Generated<string>;
  postal_code: Generated<string>; timezone: Generated<string>; revision: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusSpaceTable {
  id: Generated<string>; school_id: string; campus_id: string; parent_space_id: string | null;
  name: string; code: string;
  kind: "building" | "wing" | "floor" | "classroom" | "laboratory" | "library" | "office" | "auditorium" | "sports_area" | "workshop" | "staff_room" | "gate" | "outdoor_area" | "virtual" | "other";
  capacity: number | null; is_accessible: Generated<boolean>; is_bookable: Generated<boolean>;
  status: Generated<"active" | "inactive">; attributes: Json; revision: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusResourceTypeTable {
  id: Generated<string>; school_id: string; code: string; name: string;
  category: "computer" | "display" | "tablet" | "lab_equipment" | "furniture" | "vehicle" | "network" | "safety" | "other";
  tracking_mode: "pooled" | "individual"; unit_label: Generated<string>; is_active: Generated<boolean>;
  revision: Generated<number>; created_by: string | null; updated_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusResourceHoldingTable {
  id: Generated<string>; school_id: string; campus_id: string; space_id: string | null;
  resource_type_id: string; name: string; quantity: Generated<number>; asset_tag: string | null;
  state: Generated<"available" | "unavailable" | "retired">;
  notes: Generated<string>; revision: Generated<number>; created_by: string | null; updated_by: string | null;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface ClassCampusPlacementTable {
  id: Generated<string>; school_id: string; class_section_id: string; campus_id: string; home_space_id: string | null;
  is_primary: Generated<boolean>; effective_from: DateOnly; effective_until: DateOnly | null; revision: Generated<number>;
  assigned_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface StaffCampusAssignmentTable {
  id: Generated<string>; school_id: string; staff_profile_id: string; campus_id: string;
  is_primary: Generated<boolean>; effective_from: DateOnly; effective_until: DateOnly | null;
  revision: Generated<number>; assigned_by: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface InstitutionSetupAuditTable {
  id: Generated<string>; school_id: string; actor_id: string; action: string;
  target_type: string; target_id: string | null; metadata: Json; created_at: Timestamp;
}
export interface OperationalRealmTable {
  id: Generated<string>; realm_kind: Generated<string>; legacy_school_id: string | null;
  status: Generated<"setup" | "active" | "suspended" | "closed">;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface ExecutionEnvironmentNamespaceTable {
  namespace_id: string; realm_id: string; environment_kind: "live" | "simulation";
  source_namespace_id: string | null; status: Generated<"active" | "expired" | "closed">;
  expires_at: NullableTimestamp; created_at: Timestamp;
}
export interface ModelSemanticTypeDefinitionTable {
  id: Generated<string>; namespace: string; type_key: string; definition_kind: "entity" | "relationship";
  version: number; owning_domain: string; status: "approved" | "active" | "deprecated" | "retired";
  definition: Json; content_hash: string; approved_by_authority: string;
  activated_at: NullableTimestamp; retired_at: NullableTimestamp; created_at: Timestamp;
}
export interface ModelProtocolSchemaDefinitionTable {
  id: Generated<string>; namespace: string; schema_key: string;
  protocol_kind: "event" | "observation" | "assertion" | "message" | "command" | "outcome";
  version: number; owning_domain: string; status: "approved" | "active" | "deprecated" | "retired";
  schema_document: Json; content_hash: string; approved_by_authority: string;
  activated_at: NullableTimestamp; retired_at: NullableTimestamp; created_at: Timestamp;
}
export interface ModelCapabilityManifestTable {
  id: Generated<string>; namespace: string; capability_key: string; version: number;
  status: "approved" | "active" | "deprecated" | "retired"; adapter_key: string;
  compatible_core_range: string; manifest: Json; content_hash: string;
  approved_by_authority: string; activated_at: NullableTimestamp;
  retired_at: NullableTimestamp; created_at: Timestamp;
}
export interface RealmModelContractActivationTable {
  id: Generated<string>; realm_id: string;
  contract_kind: "semantic_type" | "protocol_schema" | "capability_manifest";
  contract_key: string; contract_id: string; contract_version: number;
  status: "active" | "suspended" | "retired";
  effective_from: Timestamp; effective_until: NullableTimestamp;
  activated_by_authority: string; created_at: Timestamp;
}
export interface CampusModelEntityTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  kind: string; domain: string; domain_id: string;
  label: string; lifecycle_state: "planned" | "active" | "inactive" | "retired" | "archived";
  source_revision: Generated<number>; metadata: Json; revision: Generated<number>;
  semantic_type_definition_id: Generated<string | null>; semantic_type_version: Generated<number | null>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelRelationshipTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  relation_type: string; source_entity_id: string;
  target_entity_id: string; effective_from: Timestamp; effective_until: NullableTimestamp;
  source_domain: string; source_record_id: string; source_revision: Generated<number>;
  semantic_type_definition_id: Generated<string | null>; semantic_type_version: Generated<number | null>;
  metadata: Json; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelAgentTable {
  id: Generated<string>; school_id: string; agent_kind: "human" | "team" | "device" | "integration" | "software";
  user_id: string | null; person_id: Generated<string | null>; external_ref: string | null; label: string;
  status: Generated<"active" | "suspended" | "revoked">; metadata: Json;
  revision: Generated<number>; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelAgentAuthorityTable {
  id: Generated<string>; school_id: string; agent_id: string; capability: string;
  scope_entity_id: string | null; effective_from: Timestamp; effective_until: NullableTimestamp;
  grant_source: string; grant_reference_id: string; approved_by: string | null;
  operating_rule_version_ref: string | null; constraints: Json; revoked_at: NullableTimestamp;
  revoked_by: string | null; created_at: Timestamp;
}
export interface CampusModelAgentEndpointTable {
  id: Generated<string>; school_id: string; agent_id: string;
  endpoint_kind: "account" | "external_channel"; provider: string;
  user_id: string | null; external_subject: string | null;
  status: "active" | "suspended" | "revoked";
  effective_from: Timestamp; effective_until: NullableTimestamp;
  source_domain: string; source_record_id: string; source_revision: number;
  linked_by_user_id: string | null; metadata: Generated<Json>; revision: Generated<number>;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelAgentEndpointTransitionTable {
  id: Generated<string>; school_id: string; endpoint_id: string; agent_id: string;
  transition_kind: "ended" | "revoked";
  previous_status: "active" | "suspended" | "revoked";
  next_status: "active" | "suspended" | "revoked";
  previous_effective_until: NullableTimestamp; effective_at: Timestamp;
  resulting_endpoint_revision: number; reason: string;
  source_domain: string; source_record_id: string; source_revision: number;
  actor_user_id: string; idempotency_key: string; request_hash: string;
  created_at: Timestamp;
}
export interface CampusModelBehaviourVersionTable {
  id: Generated<string>; school_id: string; behaviour_key: string; version: number;
  status: "draft" | "approved" | "retired";
  effective_from: Timestamp; effective_until: NullableTimestamp;
  configuration: Json; configuration_schema_version: number;
  created_by_agent_id: string; approved_by_agent_id: string | null;
  approved_at: NullableTimestamp; created_at: Timestamp; retired_at: NullableTimestamp;
}
export interface CampusModelEventSubscriptionTable {
  id: Generated<string>; school_id: string; behaviour_version_id: string;
  subscription_key: string; source_domain: string; event_type: string; reaction_kind: string;
  message_kind: "request" | "task" | "offer" | "update";
  message_schema_version: number; recipient_selector: Json;
  response_due_after_seconds: number | null; expires_after_seconds: number | null;
  max_attempts: number; retry_after_seconds: number | null; priority: number;
  created_at: Timestamp;
}
export interface CampusModelReactionTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; trigger_event_id: string;
  source_outbox_event_id: string; behaviour_version_id: string; subscription_id: string;
  recipient_agent_id: string; reaction_kind: string;
  state: "queued" | "delivered" | "acknowledged" | "completed" | "expired" | "cancelled" | "dead_letter";
  selector_snapshot: Json; behaviour_snapshot: Json; correlation_id: string;
  causation_event_id: string | null; attempt_count: number; max_attempts: number;
  next_attempt_at: NullableTimestamp; response_due_at: NullableTimestamp; expires_at: NullableTimestamp;
  idempotency_key: string; request_hash: string; created_at: Timestamp; updated_at: Timestamp;
  completed_at: NullableTimestamp;
}
export interface CampusModelCoordinationExceptionTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; trigger_event_id: string; source_outbox_event_id: string;
  exception_code: "configuration_missing" | "configuration_invalid" | "selector_invalid" | "recipient_unresolved" | "recipient_unauthorized";
  status: "open" | "resolved"; selector_key: string; explanation: string; details: Json;
  correlation_id: string; created_at: Timestamp; resolved_at: NullableTimestamp;
  resolved_by_agent_id: string | null;
}
export interface CampusModelOperationalMessageTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; reaction_id: string; sender_agent_id: string;
  recipient_agent_id: string; owner_agent_id: string;
  message_kind: "request" | "task" | "offer" | "update";
  state: "queued" | "delivered" | "acknowledged" | "responded" | "expired" | "cancelled" | "dead_letter";
  subject: string; summary: string; payload: Json; schema_version: number;
  correlation_id: string; causation_event_id: string | null; source_outbox_event_id: string;
  dispatch_outbox_event_id: string | null; response_due_at: NullableTimestamp; expires_at: NullableTimestamp;
  queued_at: Timestamp; delivered_at: NullableTimestamp; acknowledged_at: NullableTimestamp;
  responded_at: NullableTimestamp; expired_at: NullableTimestamp; cancelled_at: NullableTimestamp;
  dead_lettered_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelOperationalMessageOutcomeTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; message_id: string; sequence: number;
  state: "delivered" | "acknowledged" | "responded" | "expired" | "cancelled" | "dead_letter";
  actor_agent_id: string | null; source_outbox_event_id: string | null; code: string;
  explanation: string; response: Json | null; occurred_at: Timestamp;
  idempotency_key: string; request_hash: string; created_at: Timestamp;
}
export interface CampusModelObservationTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  kind: string; subject_entity_id: string;
  context_entity_id: string | null; captured_by_agent_id: string; source_type: string;
  source_ref: string | null; source_record_id: string; observed_at: Timestamp; received_at: Timestamp;
  evidence_refs: Generated<string[]>; payload: Json; schema_version: Generated<number>;
  state: Generated<"pending" | "accepted" | "rejected" | "quarantined" | "superseded">;
  idempotency_key: string; request_hash: string; domain_event_id: string | null; created_at: Timestamp;
  protocol_schema_definition_id: Generated<string | null>; protocol_schema_version: Generated<number | null>;
  capability_manifest_id: Generated<string | null>; capability_manifest_version: Generated<number | null>;
}
export interface CampusModelCommandTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  command_type: string; target_entity_id: string | null;
  actor_agent_id: string; state: Generated<"pending" | "review_required" | "accepted" | "rejected" | "conflicted" | "expired" | "failed" | "uncertain" | "cancelled">;
  requested_at: Timestamp; effective_at: NullableTimestamp; expected_revision: number | null;
  authority_evidence: Generated<string[]>; operating_rule_version_ref: string | null;
  authority_receipt_id: string | null;
  correlation_id: string; causation_id: string | null; idempotency_key: string;
  source_domain: string; safe_context: Json; request_hash: string; handler_key: string;
  handler_version: number; configuration_refs: Json; execution_started_at: NullableTimestamp;
  completed_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp;
}
export interface CampusModelCommandOutcomeTable {
  id: Generated<number>; realm_id: string; environment_namespace_id: string;
  command_id: string; sequence: number;
  status: "review_required" | "accepted" | "rejected" | "conflicted" | "expired" | "failed" | "uncertain" | "cancelled";
  code: string; explanation: string; resulting_entity_id: string | null;
  resulting_revision: number | null; domain_event_id: string | null; metadata: Json; recorded_at: Timestamp;
}
export interface CampusModelExecutionSnapshotTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  snapshot_kind: "live_activation" | "simulation_fork" | "rehearsal"; source_snapshot_ref: string;
  core_contract_version: string; configuration_hash: string; source_recorded_at: Timestamp;
  sealed_at: Timestamp; sealed_by_authority: string; metadata: Json; created_at: Timestamp;
}
export interface CampusModelExecutionSnapshotItemTable {
  id: Generated<string>; snapshot_id: string; realm_id: string; environment_namespace_id: string;
  item_kind: "operating_rule" | "behaviour" | "domain_configuration" | "semantic_contract" | "protocol_contract" | "capability_manifest" | "terminology";
  item_key: string; version_ref: string; content_hash: string; effective_from: Timestamp;
  effective_until: NullableTimestamp; source_ref: string; metadata: Json; created_at: Timestamp;
}
export interface CampusModelExecutionActorBindingTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  source_agent_id: string; execution_actor_id: Generated<string>;
  actor_mode: "live_agent" | "simulation_counterpart" | "delegate"; binding_key: string;
  snapshot_id: string | null; behaviour_policy_version_ref: string | null;
  authority_snapshot_ref: string | null; status: "active" | "suspended" | "revoked";
  effective_from: Timestamp; effective_until: NullableTimestamp; created_at: Timestamp;
}
export interface CampusModelAuthoritySnapshotGrantTable {
  id: Generated<string>; snapshot_id: string; school_id: string; realm_id: string;
  environment_namespace_id: string; source_authority_id: string; agent_id: string;
  capability: string; scope_entity_id: string | null; effective_from: Timestamp;
  effective_until: NullableTimestamp; operating_rule_version_ref: string | null;
  constraints: Json; content_hash: string; created_at: Timestamp;
}
export interface CampusModelAuthorityReceiptTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  actor_agent_id: string; execution_actor_id: string | null; capability: string; purpose: string;
  scope_entity_id: string | null; decision: "allowed" | "denied"; reason_codes: string[];
  authority_source_refs: Json; operating_rule_refs: Json; evaluated_at: Timestamp;
  valid_until: NullableTimestamp; correlation_id: string; causation_id: string | null;
  idempotency_key: string; request_hash: string; created_at: Timestamp;
}
export interface CampusModelEnvironmentProjectionCheckpointTable {
  realm_id: string; environment_namespace_id: string; consumer: string;
  last_delivery_sequence: Generated<number>; last_event_id: string | null;
  state: Generated<"active" | "rebuilding" | "failed" | "paused">;
  lease_owner: string | null; lease_until: NullableTimestamp; last_error_code: string | null;
  updated_at: Timestamp;
}
export interface ModelSnapshotAdapterDefinitionTable {
  id: Generated<string>; namespace: string; adapter_key: string; version: number; module_id: string;
  capability_manifest_id: string; handler_key: string; capture_schema_version: number;
  restore_schema_version: number; content_hash: string;
  status: "approved" | "active" | "deprecated" | "retired";
  approved_by_authority: string; created_at: Timestamp;
}
export interface RealmSnapshotAdapterActivationTable {
  id: Generated<string>; realm_id: string; adapter_definition_id: string; adapter_version: number;
  module_id: string; required: Generated<boolean>; status: "active" | "suspended" | "retired";
  effective_from: Timestamp; effective_until: NullableTimestamp; activated_by_authority: string; created_at: Timestamp;
}
export interface CampusModelSnapshotProvisionTable {
  id: Generated<string>; school_id: string; realm_id: string; source_environment_namespace_id: string;
  source_snapshot_ref: string; state: "collecting" | "blocked" | "ready" | "restoring" | "restored" | "expired" | "failed";
  requested_modules: string[]; missing_modules: Generated<string[]>; expected_adapter_count: number;
  coverage_hash: string; manifest_hash: string | null; source_recorded_at: Timestamp; expires_at: Timestamp;
  requested_by_agent_id: string; authority_receipt_id: string; correlation_id: string;
  idempotency_key: string; request_hash: string; failure_code: string | null; created_at: Timestamp; sealed_at: NullableTimestamp;
}
export interface CampusModelSnapshotExpectedAdapterTable {
  provision_id: string; realm_id: string; source_environment_namespace_id: string;
  adapter_definition_id: string; adapter_version: number; module_id: string;
  capture_schema_version: number; restore_schema_version: number; content_hash: string;
}
export interface CampusModelSnapshotContributionTable {
  id: Generated<string>; provision_id: string; realm_id: string; source_environment_namespace_id: string;
  adapter_definition_id: string; adapter_version: number; module_id: string; artifact_ref: string;
  artifact_hash: string; restore_schema_version: number; record_count: number; source_revision_watermark: string;
  privacy_transform_ref: string; capture_schema_version: number; captured_at: Timestamp;
  metadata: Json; created_at: Timestamp;
}
export interface CampusModelSnapshotRestoreTable {
  id: Generated<string>; provision_id: string; execution_snapshot_id: string; realm_id: string;
  target_environment_namespace_id: string; state: "restoring" | "ready" | "failed" | "expired";
  expected_adapter_count: number; restored_adapter_count: Generated<number>; manifest_hash: string;
  started_at: Timestamp; completed_at: NullableTimestamp; failure_code: string | null; created_at: Timestamp;
}
export interface CampusModelSnapshotRestoreContributionTable {
  restore_id: string; realm_id: string; target_environment_namespace_id: string;
  adapter_definition_id: string; adapter_version: number; artifact_hash: string; restore_schema_version: number;
  restored_record_count: number; restored_at: Timestamp; receipt: Json;
}
export interface CampusModelProjectionRecoveryJobTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  consumer: string; mode: "rebuild" | "replay" | "verify";
  state: "scheduled" | "leased" | "running" | "retry_scheduled" | "completed" | "failed" | "cancelled" | "quarantined";
  from_sequence: number; through_sequence: number | null; attempt_count: Generated<number>;
  max_attempts: number; retry_policy_ref: string; retry_delays_seconds: number[];
  available_at: Timestamp; lease_owner: string | null; lease_until: NullableTimestamp;
  last_error_code: string | null; requested_by_agent_id: string; authority_receipt_id: string;
  correlation_id: string; idempotency_key: string; request_hash: string; created_at: Timestamp; updated_at: Timestamp; completed_at: NullableTimestamp;
}
export interface CampusModelProjectionReplayQuarantineTable {
  id: Generated<string>; job_id: string; realm_id: string; environment_namespace_id: string;
  event_id: string; delivery_sequence: number; error_code: string; schema_ref: string | null;
  safe_diagnostics: Json; status: "open" | "released" | "discarded";
  quarantined_at: Timestamp; resolved_at: NullableTimestamp; resolved_by_agent_id: string | null;
}
export interface CampusModelEnvironmentRetentionJobTable {
  id: Generated<string>; school_id: string; realm_id: string; environment_namespace_id: string;
  state: "scheduled" | "leased" | "running" | "completed" | "failed" | "cancelled";
  delete_after: Timestamp; available_at: Timestamp; artifact_classes: string[]; retention_policy_ref: string;
  scheduled_by_agent_id: string; authority_receipt_id: string; correlation_id: string;
  idempotency_key: string; request_hash: string;
  lease_owner: string | null; lease_until: NullableTimestamp; attempt_count: Generated<number>;
  max_attempts: number; retry_delays_seconds: number[]; deleted_counts: Json; last_error_code: string | null;
  created_at: Timestamp; completed_at: NullableTimestamp;
}
export interface StaffLeaveCommandTable {
  id: Generated<string>; school_id: string; actor_id: string; command_id: string;
  command_type: "submit" | "decide" | "withdraw"; target_request_id: string;
  request_hash: string; result: Json; outbox_event_id: string;
  correlation_id: string; causation_event_id: string | null;
  authority_receipt: Json; coordination_receipt: Json; created_at: Timestamp;
}
export interface CampusModelProjectionCheckpointTable {
  consumer: string; last_delivery_sequence: Generated<number>; last_event_id: string | null; updated_at: Timestamp;
}
export interface CampusModelEventTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; event_kind: "plan" | "observation" | "decision" | "command_outcome" | "domain_event";
  event_type: string; subject_entity_id: string; context_entity_id: string | null; actor_agent_id: string | null;
  source_domain: string; source_record_id: string; source_revision: number; event_at: Timestamp;
  effective_from: Timestamp; effective_until: NullableTimestamp; recorded_at: Timestamp;
  correlation_id: string; causation_event_id: string | null; supersedes_event_id: string | null;
  provenance: Json; payload: Json; schema_version: Generated<number>; idempotency_key: string; request_hash: string;
  source_outbox_event_id: string | null;
  journal_sequence: Generated<string>;
}
export interface CampusModelScheduleOccurrenceTable {
  id: Generated<string>; school_id: string; realm_id: Generated<string>; environment_namespace_id: Generated<string>; source_event_id: string; schedule_entity_id: string;
  period_entity_id: string; class_entity_id: string; subject_entity_id: string | null;
  responsible_agent_id: str…6311 tokens truncated…: "class_teacher" | "subject_teacher"; subject_id: string | null;
  valid_from: DateOnly; valid_until: DateOnly | null; assigned_by: string; created_at: Timestamp;
}
export interface CampusEventClassSectionTable { school_id: string; event_id: string; class_section_id: string }
export interface CampusEventSelectedStudentTable { school_id: string; event_id: string; student_id: string }
export interface CampusEventStaffTable {
  school_id: string; event_id: string; user_id: string;
  role: "organizer" | "duty_staff" | "attendance_taker"; assigned_at: Timestamp;
  access_role_id: Generated<string | null>; access_revision: Generated<number>;
}
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
export interface FeePaymentTable { id: Generated<string>; school_id: string; invoice_id: string; amount_paise: number; method: "cash" | "bank_transfer" | "cheque" | "razorpay_test"; reference: string; idempotency_key: string; recorded_by: string; created_at: Timestamp }
export interface CampusEventParticipantWithdrawalTable { id: Generated<string>; school_id: string; event_id: string; student_id: string; reason: string; idempotency_key: string; request_hash: string; withdrawn_by: string; withdrawn_at: Timestamp }
export interface FeeInvoiceCreditTable { id: Generated<string>; school_id: string; invoice_id: string; event_id: string; student_id: string; participant_withdrawal_id: string | null; amount_paise: number; source: "event_cancelled" | "participant_withdrawn"; reason: string; idempotency_key: string; request_hash: string; recorded_by: string; created_at: Timestamp }
export interface FeeRefundTable { id: Generated<string>; school_id: string; invoice_id: string; credit_id: string; event_id: string; student_id: string; amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; reason: string; idempotency_key: string; request_hash: string; recorded_by: string; created_at: Timestamp }
export interface ChatConversationTable { id: Generated<string>; school_id: string; kind: Generated<"direct" | "group" | "announcement">; title: Generated<string>; context_student_id: string | null; group_type: Generated<"student_group" | "parent_group" | "activity" | "staff" | "child_support" | "announcement" | null>; posting_mode: Generated<"all" | "moderators">; created_by: string; last_message_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp; class_section_id: Generated<string | null>; }
export interface ChatParticipantTable { conversation_id: string; user_id: string; participant_role: Generated<"member" | "moderator">; joined_at: Timestamp; last_read_at: NullableTimestamp; is_muted: Generated<boolean>; is_active: Generated<boolean> }
export interface ChatMessageTable { id: Generated<string>; conversation_id: string; sender_id: string; client_id: string | null; body: Generated<string>; message_type: Generated<"text" | "file" | "system">; reply_to_id: string | null; is_deleted: Generated<boolean>; created_at: Timestamp; updated_at: Timestamp }
export interface ChatAttachmentTable { id: Generated<string>; message_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; created_at: Timestamp }
export interface ChatMessageReportTable { id: Generated<string>; message_id: string; reported_by: string; reason: string; status: Generated<"open" | "under_review" | "resolved" | "dismissed">; assigned_to: string | null; reviewed_by: string | null; resolution_note: Generated<string>; action_taken: Generated<"none" | "no_action" | "warning" | "restrict" | "escalate">; created_at: Timestamp; updated_at: Timestamp; resolved_at: NullableTimestamp }
export interface ChatMessagingRestrictionTable { id: Generated<string>; school_id: string; user_id: string; report_id: string; reason: string; starts_at: Timestamp; expires_at: Timestamp; created_by: string; revoked_at: NullableTimestamp; created_at: Timestamp }
export interface AssessmentCycleTable { id: Generated<string>; school_id: string; term_id: string; name: string; code: string; starts_on: DateOnly; ends_on: DateOnly; status: Generated<"draft"|"active"|"completed"|"archived">; result_label: Generated<string>; revision: Generated<number>; created_by: string; updated_by: string; created_at: Timestamp; updated_at: Timestamp }
export interface AssessmentTable { id: Generated<string>; school_id: string; cycle_id: string; class_section_id: string; subject_id: string; title: string; assessment_kind: "exam"|"class_test"|"quiz"|"assignment"|"practical"|"viva"|"project"|"other"; maximum_marks: string; weight_percent: string|null; scheduled_at: NullableTimestamp; duration_minutes: number|null; venue: Generated<string>; instructions: Generated<string>; evidence_requirement: Generated<"none"|"optional"|"required">; status: Generated<"draft"|"scheduled"|"marking"|"submitted"|"moderated"|"published"|"cancelled">; revision: Generated<number>; moderation_note: Generated<string>; submitted_by: string|null; submitted_at: NullableTimestamp; moderated_by: string|null; moderated_at: NullableTimestamp; cancelled_by: string|null; cancelled_at: NullableTimestamp; cancellation_reason: Generated<string>; created_by: string; updated_by: string; created_at: Timestamp; updated_at: Timestamp }
export interface AssessmentStaffAssignmentTable {
  school_id: string; assessment_id: string; user_id: string; role: "examiner"|"moderator";
  assigned_by: string; assigned_at: Timestamp;
  access_role_id: Generated<string | null>; access_revision: Generated<number>;
}
export interface AssessmentResultTable { id: Generated<string>; school_id: string; assessment_id: string; student_id: string; outcome: Generated<"unrecorded"|"scored"|"absent"|"exempt"|"withheld"|"not_evaluated">; marks: string|null; grade: Generated<string>; feedback: Generated<string>; revision: Generated<number>; recorded_by: string|null; recorded_at: NullableTimestamp; updated_at: Timestamp }
export interface AssessmentResultRevisionTable { id: Generated<number>; school_id: string; assessment_id: string; result_id: string; student_id: string; revision: number; previous_outcome: string|null; outcome: string; previous_marks: string|null; marks: string|null; previous_grade: Generated<string>; grade: Generated<string>; previous_feedback: Generated<string>; feedback: Generated<string>; reason: string; changed_by: string; created_at: Timestamp }
export interface AssessmentEvidenceTable { id: Generated<string>; school_id: string; assessment_id: string; result_id: string; student_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; uploaded_by: string; uploaded_at: Timestamp }
export interface AssessmentPublicationTable { id: Generated<string>; school_id: string; assessment_id: string; sequence: number; source_revision: number; reason: string; published_by: string; published_at: Timestamp }
export interface AssessmentPublicationResultTable { school_id: string; publication_id: string; assessment_id: string; student_id: string; source_result_id: string; source_result_revision: number; outcome: "scored"|"absent"|"exempt"|"withheld"|"not_evaluated"; marks: string|null; grade: Generated<string>; feedback: Generated<string> }
export interface AssessmentAuditTable { id: Generated<number>; school_id: string; assessment_id: string|null; actor_id: string; action: string; from_status: string|null; to_status: string|null; metadata: Json; created_at: Timestamp }
export interface AssessmentOperationPolicyTable { school_id:string; readiness_minutes_before:Generated<number>; attendance_close_after_minutes:Generated<number>; minimum_invigilators:Generated<number>; require_all_candidate_attendance:Generated<boolean>; post_completion_marking_mode:Generated<"manual"|"automatic">; revision:Generated<number>; updated_by:string|null; updated_at:Timestamp }
export interface AssessmentSittingTable { id:Generated<string>; school_id:string; assessment_id:string; campus_id:string; space_id:string; starts_at:Timestamp; ends_at:Timestamp; state:Generated<"planning"|"ready"|"in_progress"|"completed"|"cancelled">; policy_revision:number; policy_snapshot:Json; roster_frozen_at:NullableTimestamp; started_by:string|null; started_at:NullableTimestamp; completed_by:string|null; completed_at:NullableTimestamp; cancelled_by:string|null; cancelled_at:NullableTimestamp; cancellation_reason:Generated<string>; revision:Generated<number>; created_by:string; updated_by:string; created_at:Timestamp; updated_at:Timestamp }
export interface AssessmentSittingInvigilatorTable { id:Generated<string>; school_id:string; sitting_id:string; assessment_id:string; user_id:string; status:Generated<"offered"|"accepted"|"declined"|"revoked">; response_note:Generated<string>; revision:Generated<number>; assigned_by:string; assigned_at:Timestamp; responded_at:NullableTimestamp; updated_at:Timestamp }
export interface AssessmentInvigilationOfferBindingTable {
  id:Generated<string>; school_id:string; assignment_id:string; sitting_id:string; assessment_id:string;
  route_round:number; status:"offered"|"accepted"|"declined"|"expired"|"cancelled";
  source_assignment_revision:number; source_outbox_event_id:string; response_outbox_event_id:string|null;
  routed_by:string; selected_user_id:string; behaviour_version_id:string; subscription_id:string;
  model_event_id:string; reaction_id:string; message_id:string; correlation_id:string;
  selector_key:string; required_capability:string; response_due_at:Timestamp; expires_at:Timestamp;
  behaviour_snapshot:Json; selector_snapshot:Json; explanation:string;
  routed_at:Timestamp; responded_at:NullableTimestamp;
}
export interface AssessmentInvigilationCommandTable {
  school_id:string; actor_id:string; command_id:string; assignment_id:string;
  command_type:"respond"; decision:"accepted"|"declined"; request_hash:string;
  source_assignment_revision:number; resulting_assignment_revision:number; result:Json;
  response_outbox_event_id:string; message_id:string; correlation_id:string; created_at:Timestamp;
}
export interface AssessmentSittingCandidateTable { id:Generated<string>; school_id:string; sitting_id:string; assessment_id:string; student_id:string; enrollment_id:string; roll_number_snapshot:number|null; frozen_at:Timestamp }
export interface AssessmentCandidateAttendanceTable { id:Generated<string>; school_id:string; sitting_id:string; candidate_id:string; student_id:string; status:Generated<"unrecorded"|"present"|"late"|"absent"|"left_early">; observed_at:NullableTimestamp; note:Generated<string>; revision:Generated<number>; recorded_by:string|null; updated_at:Timestamp }
export interface AssessmentSittingIncidentTable { id:Generated<string>; school_id:string; sitting_id:string; candidate_id:string|null; student_id:string|null; category:"conduct"|"health"|"materials"|"timing"|"other"; severity:"info"|"minor"|"major"; summary:string; observed_at:Timestamp; state:Generated<"open"|"resolved">; resolution:Generated<string>; recorded_by:string; resolved_by:string|null; resolved_at:NullableTimestamp; revision:Generated<number>; created_at:Timestamp; updated_at:Timestamp }
export interface AssessmentOperationAuditTable { id:Generated<number>; school_id:string; assessment_id:string|null; sitting_id:string|null; actor_id:string; action:string; from_state:string|null; to_state:string|null; metadata:Json; created_at:Timestamp }
export interface GradingSchemeTable { id: Generated<string>; school_id: string; term_id: string; class_section_id: string; name: string; code: string; status: Generated<"draft"|"active"|"archived">; absence_treatment: Generated<"incomplete"|"zero">; review_mode: Generated<"owner_review"|"independent">; revision: Generated<number>; created_by: string; updated_by: string; activated_by: string|null; activated_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface GradingSchemeBandTable { id: Generated<string>; school_id: string; scheme_id: string; code: string; label: string; minimum_percentage: string; maximum_percentage: string; display_order: number }
export interface GradingSchemeSubjectTable { id: Generated<string>; school_id: string; scheme_id: string; subject_id: string; pass_percentage: string|null; display_order: Generated<number>; created_at: Timestamp }
export interface GradingComponentTable { id: Generated<string>; school_id: string; scheme_subject_id: string; code: string; name: string; weight_percentage: string; display_order: number }
export interface GradingComponentAssessmentTable { school_id: string; component_id: string; assessment_id: string; added_at: Timestamp }
export interface GradingReportBatchTable { id: Generated<string>; school_id: string; scheme_id: string; sequence: number; status: Generated<"draft"|"reviewed"|"published"|"cancelled">; revision: Generated<number>; source_scheme_revision: number; source_fingerprint: string; correction_reason: Generated<string>; generated_by: string; generated_at: Timestamp; reviewed_by: string|null; reviewed_at: NullableTimestamp; review_note: Generated<string>; published_by: string|null; published_at: NullableTimestamp; publication_note: Generated<string> }
export interface GradingReportStudentTable { id: Generated<string>; school_id: string; batch_id: string; student_id: string; outcome: "complete"|"incomplete"|"withheld"; overall_percentage: string|null; overall_grade: Generated<string>; class_teacher_comment: Generated<string>; principal_comment: Generated<string>; comment_revision: Generated<number>; comment_updated_by: string|null; comment_updated_at: NullableTimestamp }
export interface GradingReportSubjectTable { id: Generated<string>; school_id: string; batch_id: string; report_student_id: string; scheme_subject_id: string; subject_id: string; outcome: "complete"|"incomplete"|"exempt"|"withheld"; percentage: string|null; grade: Generated<string>; pass_percentage: string|null; passed: boolean|null }
export interface GradingReportComponentTable { id: Generated<string>; school_id: string; batch_id: string; report_subject_id: string; component_id: string; component_name: string; weight_percentage: string; outcome: "complete"|"incomplete"|"exempt"; percentage: string|null; weighted_points: string|null; source_assessment_count: number }
export interface GradingReportAssessmentSourceTable { school_id: string; batch_id: string; report_component_id: string; assessment_id: string; publication_id: string; student_id: string; outcome: "scored"|"absent"|"exempt"|"withheld"|"not_evaluated"; marks: string|null; maximum_marks: string; normalized_percentage: string|null }
export interface GradingReportAuditTable { id: Generated<number>; school_id: string; scheme_id: string|null; batch_id: string|null; actor_id: string; action: string; from_status: string|null; to_status: string|null; metadata: Json; created_at: Timestamp }
export interface SchoolNoticeRecipientTable {
  id: Generated<string>; school_id: string; notice_id: string; recipient_key: string;
  recipient_role: "guardian"|"staff"|"admin"; user_id: string|null; guardian_id: string|null;
  student_id: string|null; recipient_name: string; contact_phone: Generated<string>;
  contact_email: Generated<string>; opened_at: NullableTimestamp; responded_at: NullableTimestamp;
  response_value: string|null; response_note: Generated<string>;
  response_channel: "app"|"sms"|"paper"|"phone"|"in_person"|null;
  response_observed_at: NullableTimestamp; response_recorded_by: string|null;
  last_seen_notice_revision: Generated<number>; revision: Generated<number>;
  created_at: Timestamp; updated_at: Timestamp;
}
export type DepartureMode = "guardian_pickup"|"authorized_collector"|"independent_departure"|"school_transport"|"external_transport";
export interface DeparturePolicyTable { school_id:string; enabled:Generated<boolean>; enabled_modes:Generated<string[]>; change_cutoff:Generated<string>; location_retention_hours:Generated<number>; location_stale_seconds:Generated<number>; minimum_location_interval_seconds:Generated<number>; maximum_location_accuracy_metres:Generated<number>; revision:Generated<number>; updated_by:string|null; updated_at:Timestamp }
export interface DepartureCollectionAuthorityTable { id:Generated<string>; school_id:string; student_id:string; guardian_relationship_id:string|null; collector_person_id:string|null; valid_from:DateOnly; valid_until:DateOnly|null; status:Generated<"active"|"revoked">; verification_method:"school_record"|"in_person"|"document"|"guardian_confirmed"; verification_note:Generated<string>; revision:Generated<number>; granted_by:string; granted_at:Timestamp; revoked_by:string|null; revoked_at:NullableTimestamp; revocation_reason:string|null; created_at:Timestamp }
export interface TransportRouteTable { id:Generated<string>; school_id:string; code:string; name:string; service_kind:Generated<"institution_managed"|"contracted">; vehicle_label:Generated<string>; provider_name:Generated<string>; status:Generated<"active"|"inactive">; revision:Generated<number>; created_by:string; updated_by:string; created_at:Timestamp; updated_at:Timestamp }
export interface TransportStopTable { id:Generated<string>; school_id:string; route_id:string; direction:"to_institution"|"from_institution"; sequence:number; name:string; planned_time:TimeOnly|null; latitude:string|null; longitude:string|null; created_at:Timestamp }
export interface TransportStudentAssignmentTable { id:Generated<string>; school_id:string; student_id:string; route_id:string; stop_id:string; direction:"to_institution"|"from_institution"; valid_from:DateOnly; valid_until:DateOnly|null; status:Generated<"active"|"ended">; created_by:string; created_at:Timestamp }
export interface TransportServicePatternTable { id:Generated<string>; school_id:string; route_id:string; label:string; direction:"to_institution"|"from_institution"; weekdays:number[]; departure_time:TimeOnly; primary_collector_user_id:string; backup_collector_user_id:string|null; valid_from:DateOnly; valid_until:DateOnly|null; status:Generated<"active"|"inactive">; revision:Generated<number>; created_by:string; updated_by:string; created_at:Timestamp; updated_at:Timestamp }
export interface TransportTripTable { id:Generated<string>; school_id:string; route_id:string; service_date:DateOnly; direction:"to_institution"|"from_institution"; assigned_collector_user_id:string; service_pattern_id:string|null; scheduled_departure_time:TimeOnly; backup_collector_user_id:string|null; collector_assignment_status:Generated<"pending"|"accepted"|"declined">; assignment_accepted_at:NullableTimestamp; assignment_declined_at:NullableTimestamp; assignment_note:Generated<string>; state:Generated<"planned"|"boarding"|"in_progress"|"completed"|"cancelled">; roster_frozen_at:NullableTimestamp; departed_at:NullableTimestamp; completed_at:NullableTimestamp; cancelled_at:NullableTimestamp; cancellation_reason:Generated<string>; location_started_at:NullableTimestamp; location_ended_at:NullableTimestamp; revision:Generated<number>; created_by:string; created_at:Timestamp; updated_at:Timestamp; collector_access_role_id: Generated<string | null>; backup_access_role_id: Generated<string | null>; }
export interface TransportTripRosterTable { school_id:string; trip_id:string; student_id:string; stop_id:string; state:Generated<"expected"|"boarded"|"dropped"|"not_riding"|"exception">; revision:Generated<number>; boarded_at:NullableTimestamp; dropped_at:NullableTimestamp; recorded_by:string|null; outcome_note:Generated<string>; updated_at:Timestamp }
export interface TransportLocationSampleTable { id:Generated<number>; school_id:string; trip_id:string; recorded_by:string; latitude:string; longitude:string; accuracy_metres:string; heading_degrees:string|null; speed_metres_per_second:string|null; observed_at:Timestamp; received_at:Timestamp }
export interface TransportDutySwapRequestTable { id:Generated<string>; school_id:string; request_type:"cover"|"exchange"; requester_trip_id:string; target_trip_id:string|null; requester_user_id:string; target_user_id:string; requester_trip_revision:number; target_trip_revision:number|null; reason:string; status:Generated<"submitted"|"accepted"|"rejected"|"approved"|"declined_by_school"|"cancelled">; response_note:Generated<string>; target_responded_at:NullableTimestamp; decided_by:string|null; decided_at:NullableTimestamp; decision_note:Generated<string>; revision:Generated<number>; created_at:Timestamp; updated_at:Timestamp }
export interface TransportDutyChangeCommandTable { id:Generated<string>; school_id:string; actor_id:string; command_id:string; command_type:"request"|"respond"|"decide"; target_swap_id:string; request_hash:string; result:Json; outbox_event_id:string; correlation_id:string; causation_event_id:string|null; authority_receipt:Json|null; coordination_receipt:Json; created_at:Timestamp }
export interface DeparturePlanTable { id:Generated<string>; school_id:string; student_id:string; service_date:DateOnly; revision:number; is_current:Generated<boolean>; mode:DepartureMode; state:Generated<"planned"|"change_pending"|"ready"|"completed"|"exception"|"cancelled">; authority_id:string|null; trip_id:string|null; stop_id:string|null; external_arrangement:Generated<string>; source:"default"|"guardian_request"|"office_assisted"|"administrator"|"transport_assignment"; source_reference_id:string|null; supersedes_plan_id:string|null; approved_by:string|null; approved_at:NullableTimestamp; created_by:string; created_at:Timestamp; updated_at:Timestamp }
export interface DepartureChangeRequestTable { id:Generated<string>; school_id:string; student_id:string; service_date:DateOnly; current_plan_id:string|null; requested_mode:DepartureMode; requested_authority_id:string|null; requested_trip_id:string|null; requested_stop_id:string|null; external_arrangement:Generated<string>; reason:string; channel:"app"|"phone"|"paper"|"in_person"; requester_user_id:string|null; requester_person_id:string|null; recorded_by:string; status:Generated<"submitted"|"approved"|"rejected"|"withdrawn">; revision:Generated<number>; decided_by:string|null; decided_at:NullableTimestamp; decision_note:Generated<string>; created_at:Timestamp; updated_at:Timestamp }
export interface DepartureHandoverTable { id:Generated<string>; school_id:string; plan_id:string; student_id:string; outcome:"handed_over"|"departed_independently"|"transport_boarded"|"transport_dropped"|"refused"|"no_show"|"escalated"; authority_id:string|null; authority_snapshot:Generated<unknown>; evidence_method:"school_record"|"in_person_verification"|"phone_verification"|"transport_roster"|"staff_observation"; note:Generated<string>; occurred_at:Timestamp; recorded_by:string; recorded_at:Timestamp }
export interface DepartureAuditTable { id:Generated<number>; school_id:string; actor_id:string; action:string; target_type:string; target_id:string; metadata:Json; created_at:Timestamp }

export interface Database {
  school_people: SchoolPersonTable;
  guardian_school_profiles: GuardianSchoolProfileTable;
  users: UserTable;
  schools: SchoolTable;
  school_memberships: MembershipTable;
  hosted_campus_lab_controls: HostedCampusLabControlTable;
  students: StudentTable;
  parents: ParentTable;
  guardian_relationships: GuardianRelationshipTable;
  academic_terms: AcademicTermTable;
  class_sections: ClassSectionTable;
  enrollments: EnrollmentTable;
  student_enrollment_change_reviews: StudentEnrollmentChangeReviewTable;
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
  gate_staff_events: GateStaffEventTable;
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
  institution_campuses: InstitutionCampusTable;
  campus_spaces: CampusSpaceTable;
  campus_resource_types: CampusResourceTypeTable;
  campus_resource_holdings: CampusResourceHoldingTable;
  class_campus_placements: ClassCampusPlacementTable;
  staff_campus_assignments: StaffCampusAssignmentTable;
  institution_setup_audits: InstitutionSetupAuditTable;
  operational_realms: OperationalRealmTable;
  execution_environment_namespaces: ExecutionEnvironmentNamespaceTable;
  model_semantic_type_definitions: ModelSemanticTypeDefinitionTable;
  model_protocol_schema_definitions: ModelProtocolSchemaDefinitionTable;
  model_capability_manifests: ModelCapabilityManifestTable;
  realm_model_contract_activations: RealmModelContractActivationTable;
  campus_model_entities: CampusModelEntityTable;
  campus_model_relationships: CampusModelRelationshipTable;
  campus_model_agents: CampusModelAgentTable;
  campus_model_agent_authorities: CampusModelAgentAuthorityTable;
  campus_model_agent_endpoints: CampusModelAgentEndpointTable;
  campus_model_agent_endpoint_transitions: CampusModelAgentEndpointTransitionTable;
  campus_model_behaviour_versions: CampusModelBehaviourVersionTable;
  campus_model_event_subscriptions: CampusModelEventSubscriptionTable;
  campus_model_reactions: CampusModelReactionTable;
  campus_model_coordination_exceptions: CampusModelCoordinationExceptionTable;
  campus_model_operational_messages: CampusModelOperationalMessageTable;
  campus_model_operational_message_outcomes: CampusModelOperationalMessageOutcomeTable;
  campus_model_observations: CampusModelObservationTable;
  campus_model_commands: CampusModelCommandTable;
  campus_model_command_outcomes: CampusModelCommandOutcomeTable;
  campus_model_execution_snapshots: CampusModelExecutionSnapshotTable;
  campus_model_execution_snapshot_items: CampusModelExecutionSnapshotItemTable;
  campus_model_execution_actor_bindings: CampusModelExecutionActorBindingTable;
  campus_model_authority_snapshot_grants: CampusModelAuthoritySnapshotGrantTable;
  campus_model_authority_receipts: CampusModelAuthorityReceiptTable;
  campus_model_environment_projection_checkpoints: CampusModelEnvironmentProjectionCheckpointTable;
  model_snapshot_adapter_definitions: ModelSnapshotAdapterDefinitionTable;
  realm_snapshot_adapter_activations: RealmSnapshotAdapterActivationTable;
  campus_model_snapshot_provisions: CampusModelSnapshotProvisionTable;
  campus_model_snapshot_expected_adapters: CampusModelSnapshotExpectedAdapterTable;
  campus_model_snapshot_contributions: CampusModelSnapshotContributionTable;
  campus_model_snapshot_restores: CampusModelSnapshotRestoreTable;
  campus_model_snapshot_restore_contributions: CampusModelSnapshotRestoreContributionTable;
  campus_model_projection_recovery_jobs: CampusModelProjectionRecoveryJobTable;
  campus_model_projection_replay_quarantine: CampusModelProjectionReplayQuarantineTable;
  campus_model_environment_retention_jobs: CampusModelEnvironmentRetentionJobTable;
  campus_model_projection_checkpoints: CampusModelProjectionCheckpointTable;
  campus_model_events: CampusModelEventTable;
  campus_model_schedule_occurrences: CampusModelScheduleOccurrenceTable;
  staff_profiles: StaffProfileTable;
  staff_onboarding_items: StaffOnboardingItemTable;
  staff_leave_policies: StaffLeavePolicyTable;
  staff_leave_balance_adjustments: StaffLeaveBalanceAdjustmentTable;
  staff_leave_requests: StaffLeaveRequestTable;
  staff_leave_request_audits: StaffLeaveRequestAuditTable;
  staff_leave_commands: StaffLeaveCommandTable;
  staff_responsibility_types: StaffResponsibilityTypeTable;
  school_custom_role_duties: SchoolCustomRoleDutyTable;
  school_access_exceptions: SchoolAccessExceptionTable;
  staff_responsibility_assignments: StaffResponsibilityAssignmentTable;
  staff_responsibility_audits: StaffResponsibilityAuditTable;
  staff_coverage_tasks: StaffCoverageTaskTable;
  staff_coverage_task_audits: StaffCoverageTaskAuditTable;
  staff_coverage_offer_routes: StaffCoverageOfferRouteTable;
  staff_timetable_substitutions: StaffTimetableSubstitutionTable;
  staff_coverage_commands: StaffCoverageCommandTable;
  staff_coverage_policies: StaffCoveragePolicyTable;
  institution_regulatory_profiles: InstitutionRegulatoryProfileTable;
  institution_policy_families: InstitutionPolicyFamilyTable;
  institution_policy_versions: InstitutionPolicyVersionTable;
  institution_policy_acknowledgements: InstitutionPolicyAcknowledgementTable;
  institution_governance_audits: InstitutionGovernanceAuditTable;
  institution_authority_sources: InstitutionAuthoritySourceTable;
  institution_governance_offices: InstitutionGovernanceOfficeTable;
  institution_governance_bodies: InstitutionGovernanceBodyTable;
  institution_governance_seats: InstitutionGovernanceSeatTable;
  institution_governance_appointments: InstitutionGovernanceAppointmentTable;
  institution_authority_mandates: InstitutionAuthorityMandateTable;
  institution_decision_matter_rules: InstitutionDecisionMatterRuleTable;
  restricted_care_role_assignments: RestrictedCareRoleAssignmentTable;
  restricted_care_cases: RestrictedCareCaseTable;
  restricted_care_case_assignments: RestrictedCareCaseAssignmentTable;
  restricted_care_case_entries: RestrictedCareCaseEntryTable;
  restricted_care_external_reports: RestrictedCareExternalReportTable;
  restricted_care_audits: RestrictedCareAuditTable;
  auth_sessions: AuthSessionTable;
  auth_session_execution_environments: AuthSessionExecutionEnvironmentTable;
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
  assessment_operation_policies: AssessmentOperationPolicyTable;
  assessment_sittings: AssessmentSittingTable;
  assessment_sitting_invigilators: AssessmentSittingInvigilatorTable;
  assessment_invigilation_offer_bindings: AssessmentInvigilationOfferBindingTable;
  assessment_invigilation_commands: AssessmentInvigilationCommandTable;
  assessment_sitting_candidates: AssessmentSittingCandidateTable;
  assessment_candidate_attendance: AssessmentCandidateAttendanceTable;
  assessment_sitting_incidents: AssessmentSittingIncidentTable;
  assessment_operation_audits: AssessmentOperationAuditTable;
  grading_schemes: GradingSchemeTable;
  grading_scheme_bands: GradingSchemeBandTable;
  grading_scheme_subjects: GradingSchemeSubjectTable;
  grading_components: GradingComponentTable;
  grading_component_assessments: GradingComponentAssessmentTable;
  grading_report_batches: GradingReportBatchTable;
  grading_report_students: GradingReportStudentTable;
  grading_report_subjects: GradingReportSubjectTable;
  grading_report_components: GradingReportComponentTable;
  grading_report_assessment_sources: GradingReportAssessmentSourceTable;
  grading_report_audits: GradingReportAuditTable;
  school_notice_recipients: SchoolNoticeRecipientTable;
  departure_policies: DeparturePolicyTable;
  departure_collection_authorities: DepartureCollectionAuthorityTable;
  transport_routes: TransportRouteTable;
  transport_stops: TransportStopTable;
  transport_student_assignments: TransportStudentAssignmentTable;
  transport_service_patterns: TransportServicePatternTable;
  transport_trips: TransportTripTable;
  transport_trip_roster: TransportTripRosterTable;
  transport_location_samples: TransportLocationSampleTable;
  transport_duty_swap_requests: TransportDutySwapRequestTable;
  transport_duty_change_commands: TransportDutyChangeCommandTable;
  departure_plans: DeparturePlanTable;
  departure_change_requests: DepartureChangeRequestTable;
  departure_handovers: DepartureHandoverTable;
  departure_audits: DepartureAuditTable;
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
  revision: Generated<number>;
  updated_by: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: Timestamp;
}
