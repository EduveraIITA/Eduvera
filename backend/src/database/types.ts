import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
type DateOnly = ColumnType<string, string, string>;
type TimeOnly = ColumnType<string, string, string>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface UserTable {
  id: Generated<string>;
  username: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: "student" | "parent" | "staff" | "admin";
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchoolTable { id: Generated<string>; name: string; code: string; timezone: Generated<string>; attendance_submission_cutoff: Generated<string>; created_at: Timestamp }
export interface MembershipTable { id: Generated<string>; user_id: string; school_id: string; role: "student" | "guardian" | "staff" | "admin"; is_active: Generated<boolean>; created_at: Timestamp }
export interface SchoolPersonTable { id: Generated<string>; school_id: string; first_name: string; last_name: Generated<string>; contact_phone: Generated<string>; contact_email: Generated<string>; revision: Generated<number>; created_at: Timestamp }
export interface GuardianSchoolProfileTable { school_id: string; guardian_id: string; person_id: string }
export interface StudentTable { id: Generated<string>; person_id: Generated<string>; user_id: string | null; school_id: string; admission_number: string; date_of_birth: DateOnly | null; blood_group: string | null; emergency_contact: string | null; avatar_url: Generated<string>; created_at: Timestamp }
export interface ParentTable { id: Generated<string>; user_id: string | null; phone: Generated<string>; created_at: Timestamp }
export interface GuardianRelationshipTable { id: Generated<string>; school_id: Generated<string>; guardian_id: string; student_id: string; relationship: "mother" | "father" | "guardian"; is_primary: Generated<boolean>; can_authorize_leave: Generated<boolean>; authority_revision: Generated<number>; leave_valid_from: Generated<string|null>; leave_valid_until: Generated<string|null>; authority_source: Generated<"legacy"|"enrollment"|"reviewed">; created_at: Timestamp }
export interface AcademicTermTable { id: Generated<string>; school_id: string; academic_year: string; name: string; starts_on: DateOnly; ends_on: DateOnly; attendance_threshold: string; is_active: Generated<boolean> }
export interface ClassSectionTable { id: Generated<string>; school_id: string; academic_year: string; grade: string; section: string; board: Generated<string>; room_number: Generated<string> }
export interface EnrollmentTable { id: Generated<string>; student_id: string; class_section_id: string; term_id: string; roll_number: number; enrolled_on: Generated<string>; is_active: Generated<boolean> }
export interface SubjectTable { id: Generated<string>; school_id: string; code: string; name: string; short_name: string; color: Generated<string>; icon: Generated<string> }
export interface SubjectAttendanceTable { id: Generated<string>; student_id: string; subject_id: string; term_id: string; classes_held: Generated<number>; classes_attended: Generated<number>; classes_excused: Generated<number> }
export interface AttendanceRecordTable { id: Generated<string>; student_id: string; class_section_id: string; date: DateOnly; status: "present" | "absent" | "late" | "excused" | "half_day"; check_in_at: NullableTimestamp; check_out_at: NullableTimestamp; remarks: Generated<string>; marked_by: string | null; revision: Generated<number>; source_request_id: Generated<string | null>; created_at: Timestamp; updated_at: Timestamp }
export interface AttendanceRegisterTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; state: Generated<"draft" | "submitted" | "locked">; revision: Generated<number>; submitted_by: string | null; submitted_at: NullableTimestamp; locked_by: string | null; locked_at: NullableTimestamp; reopened_by: string | null; reopened_at: NullableTimestamp; reopen_reason: string | null; created_at: Timestamp; updated_at: Timestamp }
export interface AttendanceSubmissionTable { id: Generated<string>; school_id: string; class_section_id: string; term_id: string; date: DateOnly; submitted_by: string; idempotency_key: string; request_hash: string; request_id: string; register_revision: number; records_count: number; changed_count: number; result_status: Generated<number>; result_body: Generated<Json>; source_photo_session_id: string | null; completed_at: Timestamp; created_at: Timestamp }
export interface AttendanceRecordRevisionTable { id: Generated<number>; attendance_record_id: string; attendance_submission_id: string | null; attendance_register_id: string | null; school_id: string; student_id: string; class_section_id: string; date: DateOnly; previous_status: AttendanceRecordTable["status"] | null; new_status: AttendanceRecordTable["status"]; previous_remarks: string | null; new_remarks: Generated<string>; previous_check_in_at: NullableTimestamp; new_check_in_at: NullableTimestamp; previous_check_out_at: NullableTimestamp; new_check_out_at: NullableTimestamp; reason: string; changed_by: string; request_id: string; register_revision: number; created_at: Timestamp }
export interface SchoolCalendarDayTable { id: Generated<string>; school_id: string; date: DateOnly; is_instructional: boolean; label: Generated<string>; created_at: Timestamp; updated_at: Timestamp }
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
export interface ChatConversationTable { id: Generated<string>; school_id: string; kind: Generated<"direct" | "group" | "announcement">; title: Generated<string>; context_student_id: string | null; group_type: Generated<"student_group" | "parent_group" | "activity" | "staff" | "child_support" | "announcement" | null>; posting_mode: Generated<"all" | "moderators">; created_by: string; last_message_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface ChatParticipantTable { conversation_id: string; user_id: string; participant_role: Generated<"member" | "moderator">; joined_at: Timestamp; last_read_at: NullableTimestamp; is_muted: Generated<boolean>; is_active: Generated<boolean> }
export interface ChatMessageTable { id: Generated<string>; conversation_id: string; sender_id: string; client_id: string | null; body: Generated<string>; message_type: Generated<"text" | "file" | "system">; reply_to_id: string | null; is_deleted: Generated<boolean>; created_at: Timestamp; updated_at: Timestamp }
export interface ChatAttachmentTable { id: Generated<string>; message_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; created_at: Timestamp }
export interface ChatMessageReportTable { id: Generated<string>; message_id: string; reported_by: string; reason: string; status: Generated<"open" | "under_review" | "resolved" | "dismissed">; assigned_to: string | null; reviewed_by: string | null; resolution_note: Generated<string>; action_taken: Generated<"none" | "no_action" | "warning" | "restrict" | "escalate">; created_at: Timestamp; updated_at: Timestamp; resolved_at: NullableTimestamp }
export interface ChatMessagingRestrictionTable { id: Generated<string>; school_id: string; user_id: string; report_id: string; reason: string; starts_at: Timestamp; expires_at: Timestamp; created_by: string; revoked_at: NullableTimestamp; created_at: Timestamp }

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
  school_calendar_days: SchoolCalendarDayTable;
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
  chat_conversations: ChatConversationTable;
  chat_participants: ChatParticipantTable;
  chat_messages: ChatMessageTable;
  chat_attachments: ChatAttachmentTable;
  chat_message_reports: ChatMessageReportTable;
  chat_messaging_restrictions: ChatMessagingRestrictionTable;
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
