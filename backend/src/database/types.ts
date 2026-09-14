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

export interface SchoolTable { id: Generated<string>; name: string; code: string; created_at: Timestamp }
export interface MembershipTable { id: Generated<string>; user_id: string; school_id: string; role: "student" | "guardian" | "staff" | "admin"; is_active: Generated<boolean>; created_at: Timestamp }
export interface StudentTable { id: Generated<string>; user_id: string; school_id: string; admission_number: string; date_of_birth: DateOnly | null; blood_group: string | null; emergency_contact: string | null; avatar_url: Generated<string>; created_at: Timestamp }
export interface ParentTable { id: Generated<string>; user_id: string; phone: Generated<string>; created_at: Timestamp }
export interface GuardianRelationshipTable { id: Generated<string>; guardian_id: string; student_id: string; relationship: "mother" | "father" | "guardian"; is_primary: Generated<boolean>; can_authorize_leave: Generated<boolean>; created_at: Timestamp }
export interface AcademicTermTable { id: Generated<string>; school_id: string; academic_year: string; name: string; starts_on: DateOnly; ends_on: DateOnly; attendance_threshold: string; is_active: Generated<boolean> }
export interface ClassSectionTable { id: Generated<string>; school_id: string; academic_year: string; grade: string; section: string; board: Generated<string>; room_number: Generated<string> }
export interface EnrollmentTable { id: Generated<string>; student_id: string; class_section_id: string; term_id: string; roll_number: number; is_active: Generated<boolean> }
export interface SubjectTable { id: Generated<string>; school_id: string; code: string; name: string; short_name: string; color: Generated<string>; icon: Generated<string> }
export interface SubjectAttendanceTable { id: Generated<string>; student_id: string; subject_id: string; term_id: string; classes_held: Generated<number>; classes_attended: Generated<number>; classes_excused: Generated<number> }
export interface AttendanceRecordTable { id: Generated<string>; student_id: string; class_section_id: string; date: DateOnly; status: "present" | "absent" | "late" | "excused" | "half_day"; check_in_at: NullableTimestamp; check_out_at: NullableTimestamp; remarks: Generated<string>; marked_by: string | null; created_at: Timestamp; updated_at: Timestamp }
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
export interface NotificationTable { id: Generated<string>; recipient_id: string; kind: "attendance" | "leave" | "diary" | "general"; title: string; body: string; link: Generated<string>; metadata: Json; read_at: NullableTimestamp; created_at: Timestamp }
export interface SchoolContactTable { id: Generated<string>; school_id: string; label: string; name: string; phone: Generated<string>; email: Generated<string>; availability: Generated<string>; priority: Generated<number> }
export interface AuthSessionTable { token_hash: string; user_id: string; csrf_token: string; expires_at: Timestamp; created_at: Timestamp; last_seen_at: Timestamp; ip_hash: string | null; user_agent: Generated<string> }
export interface AuditEventTable { id: Generated<string>; action: string; actor_id: string | null; school_id: string | null; target_type: Generated<string>; target_id: string | null; request_id: string; ip_hash: string | null; metadata: Json; created_at: Timestamp }
export interface AiConversationTable { id: Generated<string>; owner_id: string; student_id: string; title: string; status: Generated<"active" | "archived">; created_at: Timestamp; updated_at: Timestamp }
export interface AiMessageTable { id: Generated<string>; conversation_id: string; role: "user" | "assistant"; content: string; citations: Json; provider: string; model: string; status: Generated<"complete" | "error">; latency_ms: number | null; created_at: Timestamp }
export interface ApiRateLimitBucketTable { bucket_key: string; hits: number; expires_at: Timestamp }
export interface ChatConversationTable { id: Generated<string>; school_id: string; kind: Generated<"direct" | "group" | "announcement">; title: Generated<string>; context_student_id: string | null; created_by: string; last_message_at: NullableTimestamp; created_at: Timestamp; updated_at: Timestamp }
export interface ChatParticipantTable { conversation_id: string; user_id: string; participant_role: Generated<"member" | "moderator">; joined_at: Timestamp; last_read_at: NullableTimestamp; is_muted: Generated<boolean>; is_active: Generated<boolean> }
export interface ChatMessageTable { id: Generated<string>; conversation_id: string; sender_id: string; client_id: string | null; body: Generated<string>; message_type: Generated<"text" | "file" | "system">; reply_to_id: string | null; is_deleted: Generated<boolean>; created_at: Timestamp; updated_at: Timestamp }
export interface ChatAttachmentTable { id: Generated<string>; message_id: string; storage_key: string; original_name: string; content_type: string; size_bytes: number; created_at: Timestamp }
export interface ChatMessageReportTable { id: Generated<string>; message_id: string; reported_by: string; reason: string; status: Generated<"open" | "reviewed" | "dismissed" | "actioned">; created_at: Timestamp }

export interface Database {
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
  chat_conversations: ChatConversationTable;
  chat_participants: ChatParticipantTable;
  chat_messages: ChatMessageTable;
  chat_attachments: ChatAttachmentTable;
  chat_message_reports: ChatMessageReportTable;
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
  communication_start: Generated<TimeOnly>;
  communication_end: Generated<TimeOnly>;
  retention_days: Generated<number>;
  privacy_notice_version: Generated<string>;
  updated_by: string | null;
  updated_at: Timestamp;
}
