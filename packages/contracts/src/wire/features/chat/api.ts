/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface ChatConversation {
  id: string;
  school_id: string;
  kind: "direct" | "group" | "announcement";
  title: string;
  other_role: "student" | "parent" | "staff" | "admin";
  avatar_url: string | null;
  context_student_id: string | null;
  student_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  group_type: ChatGroupType | null;
  posting_mode: "all" | "moderators";
  participant_role: "member" | "moderator";
  member_count: number;
  can_post: boolean;
  posting_restriction?: string;
}

export type ChatGroupType = "student_group" | "parent_group" | "activity" | "staff" | "child_support" | "announcement";

export interface ChatPolicy {
  school_id: string;
  student_teacher_direct_enabled: boolean;
  guardian_teacher_direct_enabled: boolean;
  student_group_replies: boolean;
  guardian_group_replies: boolean;
  attachments_enabled: boolean;
  enforce_communication_hours: boolean;
  communication_start: string;
  communication_end: string;
  retention_days: number;
  timezone: string;
  revision: number;
  can_manage: boolean;
}

export interface ChatAttachment {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  file_url: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  message_type: "text" | "file" | "system";
  reply_to_id: string | null;
  is_deleted: boolean;
  is_mine: boolean;
  editable_until?: string;
  is_reported_by_me: boolean;
  report_status: ChatReportStatus | null;
  created_at: string;
  updated_at: string;
  attachment: ChatAttachment | null;
}

export type ChatReportStatus = "open" | "under_review" | "resolved" | "dismissed";

export interface ChatMessagePage { results: ChatMessage[]; has_more: boolean; next_cursor?: string | null; boundary_cursor?: string | null; reached_through?: boolean }
