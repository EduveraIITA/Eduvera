/** Chat accepts these bounded native files; campus rules may impose a lower limit. */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_MESSAGE_MAX_CHARACTERS = 4000;
export type ChatGroupType = 'student_group' | 'parent_group' | 'activity' | 'staff' | 'child_support' | 'announcement';
export interface ChatRecipient {
  id: string; name: string; detail: string; school_id: string; school_name: string;
  membership_role: 'student' | 'guardian' | 'staff' | 'admin'; student_id: string | null;
}
const uuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fileTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const roles: Record<ChatGroupType, readonly string[]> = {
  student_group: ['student', 'staff', 'admin'], parent_group: ['guardian', 'staff', 'admin'],
  activity: ['student', 'guardian', 'staff', 'admin'], staff: ['staff', 'admin'],
  child_support: ['student', 'guardian', 'staff', 'admin'], announcement: ['student', 'guardian', 'staff', 'admin'],
};
export const chatGroupLabels: Record<ChatGroupType, string> = {
  student_group: 'Student group', parent_group: 'Parent group', activity: 'Activity or trip',
  staff: 'Staff group', child_support: 'Child support', announcement: 'Announcement',
};
export function nativeChatFileType(name: string, size: number, reportedType?: string | null): string | null {
  if (!name || name.length > 255 || /[\r\n\0/\\]/.test(name) || !Number.isSafeInteger(size) || size <= 0 || size > CHAT_ATTACHMENT_MAX_BYTES) return null;
  const type = fileTypes[name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!type || reportedType && !['application/octet-stream', type].includes(reportedType.toLowerCase())) return null;
  return type;
}
export function nativeChatGroupKinds(canManage: boolean, studentId: string): ChatGroupType[] {
  return ['student_group', 'parent_group', 'activity', ...(studentId ? ['child_support'] : []), ...(canManage ? ['staff', 'announcement'] : [])] as ChatGroupType[];
}
/** The server's recipient projection is the only source of eligible identities. */
export function nativeChatRecipients(recipients: readonly ChatRecipient[], schoolId: string, groupType?: ChatGroupType) {
  const unique = new Map<string, ChatRecipient>();
  for (const recipient of recipients) {
    if (recipient.school_id !== schoolId || !uuid(recipient.id) || groupType && !roles[groupType]?.includes(recipient.membership_role)) continue;
    if (!unique.has(recipient.id)) unique.set(recipient.id, recipient);
  }
  return [...unique.values()];
}
export function nativeDirectConversation(schoolId: string, recipientId: string, studentId: string, recipients: readonly ChatRecipient[]) {
  const recipient = nativeChatRecipients(recipients, schoolId).find(recipient => recipient.id === recipientId);
  const selectedStudentId = studentId || recipient?.student_id || '';
  if (!uuid(schoolId) || !recipient || selectedStudentId && !uuid(selectedStudentId)) throw new Error('Choose a currently approved contact for this campus and learner.');
  return { school_id: schoolId, recipient_id: recipientId, ...(selectedStudentId ? { student_id: selectedStudentId } : {}) };
}
export function nativeGroupConversation(input: { schoolId: string; title: string; groupType: ChatGroupType; memberIds: string[]; studentId: string; canManage: boolean }, recipients: readonly ChatRecipient[]) {
  const title = input.title.trim(), eligible = nativeChatRecipients(recipients, input.schoolId, input.groupType);
  if (!uuid(input.schoolId) || input.studentId && !uuid(input.studentId) || !nativeChatGroupKinds(input.canManage, input.studentId).includes(input.groupType) || title.length < 3 || title.length > 180 || input.memberIds.length < 1 || input.memberIds.length > 200 || new Set(input.memberIds).size !== input.memberIds.length || input.memberIds.some(id => !eligible.some(recipient => recipient.id === id))) throw new Error('Confirm the group title, type and currently eligible members. Choose up to 200 people.');
  return { school_id: input.schoolId, title, group_type: input.groupType, member_ids: [...input.memberIds], ...(input.studentId ? { student_id: input.studentId } : {}) };
}
export function nativeChatAttachmentPath(conversationId: string, message: { id: string; conversation_id: string; is_deleted: boolean; attachment: unknown }) {
  if (!uuid(conversationId) || !uuid(message.id) || message.conversation_id !== conversationId || message.is_deleted || !message.attachment) throw new Error('This attachment does not belong to the current conversation.');
  return `/api/v1/chat/conversations/${conversationId}/messages/${message.id}/attachment/`;
}

export function nativeChatConversationMatches(conversation: { id: string; school_id: string; context_student_id: string | null }, schoolId: string, studentId = '', conversationId?: string) {
  return conversation.school_id === schoolId && (!conversationId || conversation.id === conversationId) && (!studentId || conversation.context_student_id === null || conversation.context_student_id === studentId);
}

type CreatedConversationAction = { endpoint: string; scope: { schoolId: string }; payload: { kind: string; body?: string }; refreshPath: string };
function creationContext(action: CreatedConversationAction) {
  if (!['/api/v1/chat/conversations/', '/api/v1/chat/groups/'].includes(action.endpoint) || action.payload.kind !== 'json' || typeof action.payload.body !== 'string') throw new Error('This retained action is not a conversation creation.');
  const body = JSON.parse(action.payload.body) as { school_id?: unknown; student_id?: unknown };
  if (body.school_id !== action.scope.schoolId || !uuid(action.scope.schoolId) || body.student_id !== undefined && (typeof body.student_id !== 'string' || !uuid(body.student_id))) throw new Error('The retained conversation campus or learner could not be verified.');
  return { schoolId: action.scope.schoolId, studentId: typeof body.student_id === 'string' ? body.student_id : '' };
}
/** Resolve the returned owner ID directly; directory pagination never proves creation. */
export function nativeChatCreatedReadPath(response: unknown, action: CreatedConversationAction): string {
  const context = creationContext(action), value = response as { id?: unknown } | null;
  if (!value || typeof value.id !== 'string' || !uuid(value.id)) throw new Error('The service did not identify the saved conversation. Its creation remains retained.');
  const query = new URLSearchParams(context.studentId ? { student_id: context.studentId } : {});
  return `/api/v1/chat/conversations/${value.id}/${query.size ? `?${query}` : ''}`;
}
export function nativeChatCreatedHref(href: string, detail: unknown, action: CreatedConversationAction): string {
  const context = creationContext(action), value = detail as { id?: unknown; school_id?: unknown; context_student_id?: unknown } | null;
  const expectedPath = value && typeof value.id === 'string' && uuid(value.id) ? nativeChatCreatedReadPath(value, action) : '';
  if (!value || !expectedPath || action.refreshPath !== expectedPath || value.school_id !== context.schoolId || value.context_student_id !== (context.studentId || null)) throw new Error('The saved conversation did not match the exact retained campus, learner and returned owner.');
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  if (query.get('student_id') && query.get('student_id') !== context.studentId) throw new Error('The saved conversation does not match the selected learner.');
  query.set('conversation', String(value.id));
  for (const key of ['conversation_id', 'compose', 'cursor']) query.delete(key);
  if (context.studentId) query.set('student_id', context.studentId);
  return `/areas/messages/conversations?${query}`;
}
