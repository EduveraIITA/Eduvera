/* eslint-disable */
// @ts-nocheck
import { apiFetch } from "../../lib/api";

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
  privacy_notice_version: string;
  can_manage: boolean;
}

export interface ChatRecipient {
  id: string;
  name: string;
  role: "student" | "parent" | "staff" | "admin";
  membership_role: "student" | "guardian" | "staff" | "admin";
  detail: string;
  school_id: string;
  school_name: string;
  student_id: string | null;
  avatar_url: string | null;
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
  created_at: string;
  updated_at: string;
  attachment: ChatAttachment | null;
}

function withQuery(path: string, values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  return query.size ? `${path}?${query.toString()}` : path;
}

export function getChatConversations() {
  return apiFetch<{ results: ChatConversation[] }>("/api/v1/chat/conversations/");
}

export function getChatRecipients(studentId?: string) {
  return apiFetch<{ results: ChatRecipient[] }>(
    withQuery("/api/v1/chat/recipients/", { student_id: studentId }),
  );
}

export function createChatConversation(recipientId: string, studentId?: string) {
  return apiFetch<{ id: string; created: boolean }>("/api/v1/chat/conversations/", {
    method: "POST",
    body: JSON.stringify({ recipient_id: recipientId, student_id: studentId }),
  });
}

export function getChatMessages(conversationId: string, before?: string) {
  return apiFetch<{ results: ChatMessage[]; has_more: boolean }>(
    withQuery(`/api/v1/chat/conversations/${conversationId}/messages/`, { before }),
  );
}

export function sendChatMessage(
  conversationId: string,
  input: { body: string; clientId: string; file?: File },
) {
  if (input.file) {
    const form = new FormData();
    form.set("body", input.body);
    form.set("client_id", input.clientId);
    form.set("file", input.file);
    return apiFetch<{ id: string; created_at?: string }>(
      `/api/v1/chat/conversations/${conversationId}/messages/`,
      { method: "POST", body: form },
    );
  }
  return apiFetch<{ id: string; created_at?: string }>(
    `/api/v1/chat/conversations/${conversationId}/messages/`,
    {
      method: "POST",
      body: JSON.stringify({ body: input.body, client_id: input.clientId }),
    },
  );
}

export function markChatRead(conversationId: string) {
  return apiFetch(`/api/v1/chat/conversations/${conversationId}/read/`, { method: "POST" });
}

export function deleteChatMessage(conversationId: string, messageId: string) {
  return apiFetch(`/api/v1/chat/conversations/${conversationId}/messages/${messageId}/`, {
    method: "DELETE",
  });
}

export function reportChatMessage(conversationId: string, messageId: string, reason: string) {
  return apiFetch(
    `/api/v1/chat/conversations/${conversationId}/messages/${messageId}/report/`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function createChatGroup(input: { title: string; group_type: ChatGroupType; member_ids: string[]; school_id?: string; student_id?: string }) {
  return apiFetch<{ id: string }>("/api/v1/chat/groups/", { method: "POST", body: JSON.stringify(input) });
}
export function getChatPolicy() { return apiFetch<ChatPolicy>("/api/v1/chat/policy/"); }
export function updateChatPolicy(input: Partial<Omit<ChatPolicy, "school_id" | "can_manage" | "privacy_notice_version">>) {
  return apiFetch<ChatPolicy>("/api/v1/chat/policy/", { method: "PATCH", body: JSON.stringify(input) });
}
