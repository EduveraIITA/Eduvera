export type NativeChatReportStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';
export type NativeChatModerationAction = 'start' | 'assign' | 'resolve' | 'dismiss' | 'warning' | 'restrict' | 'escalate';
export interface NativeChatActionMessage { id: string; conversation_id: string; body: string; is_mine: boolean; is_deleted: boolean; message_type: string; editable_until?: string; created_at: string; is_reported_by_me: boolean }
export interface NativeChatReviewer { id: string; name: string; role: string }
export interface NativeChatReport {
  id: string; message_id: string; conversation_id: string; conversation_title: string; conversation_kind: string;
  reason: string; status: NativeChatReportStatus; reported_by: string; reporter_name: string; sender_id: string; sender_name: string;
  assigned_to: string | null; assignee_name: string | null; reviewer_role: string; can_assign: boolean;
  message_body: string; message_created_at: string; created_at: string; updated_at: string; resolved_at: string | null;
  resolution_note: string; action_taken: string; context_messages: Array<{ id: string; sender_name: string; body: string; created_at: string; is_flagged: boolean }>;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function nativeChatCanEdit(message: NativeChatActionMessage, now: number) {
  const created = Date.parse(message.created_at), until = Date.parse(message.editable_until ?? '');
  return message.is_mine && !message.is_deleted && message.message_type !== 'system' && !!message.body.trim() && Number.isFinite(now) && Number.isFinite(created) && Number.isFinite(until) && now >= created && now < until;
}
export function nativeChatCanReport(message: NativeChatActionMessage) { return !message.is_mine && !message.is_deleted && !message.is_reported_by_me; }
export function nativeChatMessageCommand(kind: 'edit' | 'report', message: NativeChatActionMessage, conversationId: string, text: string, now: number) {
  if (!uuid(conversationId) || !uuid(message.id) || message.conversation_id !== conversationId) throw new Error('Open the exact current conversation before acting on this message.');
  const value = text.trim();
  if (kind === 'edit' ? !nativeChatCanEdit(message, now) || value.length < 1 || value.length > 4000 : !nativeChatCanReport(message) || value.length < 3 || value.length > 500) throw new Error(kind === 'edit' ? 'This message is no longer editable. Use 1–4000 characters during its allowed edit window.' : 'Choose an unreported message from another person and add a reason of 3–500 characters.');
  return { endpoint: `/api/v1/chat/conversations/${conversationId}/messages/${message.id}/${kind === 'report' ? 'report/' : ''}`, method: kind === 'edit' ? 'PATCH' as const : 'POST' as const, body: kind === 'edit' ? { body: value } : { reason: value }, replayPolicy: 'inspect_only' as const };
}
export function nativeChatMessageActionReadPath(response: unknown, action: { endpoint: string; refreshPath: string }) {
  const match = action.endpoint.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages\/([^/]+)\/(report\/)?$/), value = response as { id?: unknown; edited?: unknown; status?: unknown; updated_at?: unknown } | null;
  if (!match || !uuid(match[1]) || !uuid(match[2]) || !value || !uuid(value.id)) throw new Error('The service did not identify the accepted message action.');
  if (match[3] ? value.status !== 'open' : value.id !== match[2] || value.edited !== true || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new Error('The response did not confirm this exact message action.');
  if (!action.refreshPath.startsWith(`/api/v1/chat/conversations/${match[1]}/messages/`)) throw new Error('The retained read does not belong to this conversation.');
  return action.refreshPath;
}
export function nativeChatReportMatches(value: unknown, reportId: string): value is NativeChatReport {
  const report = value as NativeChatReport | null;
  return !!report && uuid(report.id) && report.id === reportId && uuid(report.message_id) && uuid(report.conversation_id) && uuid(report.sender_id) && uuid(report.reported_by) && ['open', 'under_review', 'resolved', 'dismissed'].includes(report.status) && Number.isFinite(Date.parse(report.updated_at));
}
export function nativeChatReportFingerprint(report: NativeChatReport) { return JSON.stringify([report.id, report.updated_at, report.status, report.assigned_to, report.action_taken, report.resolution_note]); }
export function nativeChatReviewers(reviewers: readonly NativeChatReviewer[], report: NativeChatReport) { return reviewers.filter((reviewer, index) => uuid(reviewer.id) && reviewer.id !== report.sender_id && reviewer.id !== report.reported_by && reviewers.findIndex(other => other.id === reviewer.id) === index); }
export function nativeChatModerationCommand(report: NativeChatReport, actorId: string, action: NativeChatModerationAction, note: string, assigneeId: string, restrictionDays: number, reviewers: readonly NativeChatReviewer[]) {
  if (!nativeChatReportMatches(report, report.id) || !uuid(actorId) || !['open', 'under_review'].includes(report.status) || !report.can_assign && report.assigned_to !== actorId) throw new Error('This report is closed or no longer assigned to you.');
  if (!['start', 'assign', 'resolve', 'dismiss', 'warning', 'restrict', 'escalate'].includes(action)) throw new Error('Choose a supported report action.');
  const conflict = actorId === report.sender_id || actorId === report.reported_by;
  const selectedAssignee = assigneeId || actorId;
  if (conflict && (action !== 'assign' || !report.can_assign || selectedAssignee === actorId)) throw new Error('Assign an independent reviewer before taking any decision on this report.');
  if (action === 'assign' && !report.can_assign) throw new Error('You cannot reassign this report.');
  if (report.can_assign && !nativeChatReviewers(reviewers, report).some(reviewer => reviewer.id === selectedAssignee)) throw new Error('Choose a currently eligible independent reviewer.');
  const text = note.trim();
  if (text.length > 1000 || !['start', 'assign'].includes(action) && text.length < 3) throw new Error('Add a review note of 3–1000 characters before taking this decision.');
  if (action === 'restrict' && (!Number.isSafeInteger(restrictionDays) || restrictionDays < 1 || restrictionDays > 30)) throw new Error('Choose a messaging restriction of 1–30 days.');
  const body: Record<string, unknown> = { note: text, ...(report.can_assign ? { assigned_to: selectedAssignee } : {}) };
  if (action === 'start' || action === 'assign') Object.assign(body, { status: 'under_review', action: 'none' });
  else if (action === 'resolve') Object.assign(body, { status: 'resolved', action: 'no_action' });
  else if (action === 'dismiss') body.status = 'dismissed';
  else Object.assign(body, { action, ...(action === 'restrict' ? { restriction_days: restrictionDays } : {}) });
  return { endpoint: `/api/v1/chat/reports/${report.id}/`, method: 'PATCH' as const, body, replayPolicy: 'inspect_only' as const };
}
export function nativeChatRetainedKind(action: { endpoint: string; method: string } | null) {
  if (!action) return 'send';
  if (/\/reports\/[^/]+\/$/.test(action.endpoint)) return 'moderation';
  if (/\/messages\/[^/]+\/report\/$/.test(action.endpoint)) return 'report';
  if (action.method === 'PATCH' && /\/messages\/[^/]+\/$/.test(action.endpoint)) return 'edit';
  return ['/api/v1/chat/conversations/', '/api/v1/chat/groups/'].includes(action.endpoint) ? 'creation' : 'send';
}
export function nativeChatModerationReadPath(response: unknown, action: { endpoint: string; refreshPath: string; payload: { kind: string; body?: string } }) {
  const match = action.endpoint.match(/^\/api\/v1\/chat\/reports\/([^/]+)\/$/), value = response as { id?: unknown; status?: unknown; assigned_to?: unknown; action_taken?: unknown; resolution_note?: unknown; updated_at?: unknown } | null;
  if (!match || !uuid(match[1]) || !value || value.id !== match[1] || action.refreshPath !== action.endpoint || action.payload.kind !== 'json' || typeof action.payload.body !== 'string') throw new Error('The service did not identify this exact moderation action.');
  const body = JSON.parse(action.payload.body) as { action?: string; status?: string; assigned_to?: string; note?: string };
  const status = ['warning', 'restrict'].includes(body.action ?? '') ? 'resolved' : body.action === 'escalate' ? 'under_review' : body.status;
  const outcome = status === 'dismissed' ? 'no_action' : body.action ?? 'none';
  if (value.status !== status || value.action_taken !== outcome || body.assigned_to !== undefined && value.assigned_to !== body.assigned_to || body.note && value.resolution_note !== body.note || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new Error('The service response did not confirm the requested status, reviewer and outcome.');
  return action.refreshPath;
}
