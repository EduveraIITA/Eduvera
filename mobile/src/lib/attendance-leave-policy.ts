import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { AttendanceAttentionProof } from './attendance-attention';
export type LeaveRelationship = 'self' | 'dependent';
export type LeaveAction = 'authorize' | 'clarify' | 'decline' | 'withdraw' | 'approve' | 'reject';
export type LeaveCategory = 'medical' | 'family' | 'travel' | 'personal';
export interface LeaveDocument { id: string; original_name: string; content_type: string; size_bytes: number; created_at: string }
export interface LeaveRecord {
  id: string; student_id: string; student?: { id: string; name: string; display_name: string; class_name?: string | null };
  category: LeaveCategory; category_label: string; starts_on: string; ends_on: string; duration_days: number; reason: string;
  status: string; status_label: string; requested_by_name: string; submitted_at: string | null;
  guardian_authorized_by_name: string | null; guardian_authorized_at: string | null; decided_by_name: string | null; decided_at: string | null;
  documents: LeaveDocument[]; audit_log: Array<{ id: string; action: string; action_label: string; from_status: string; to_status: string; note: string; actor_name: string; created_at: string }>;
  created_at?: string; updated_at?: string;
}
export interface LeaveConstraints { max_duration_days: number; medical_document_after_days: number | null; accepted_documents: string[]; max_document_size_bytes: number }
export interface LeaveSelection { relationship: LeaveRelationship; studentId: string; label: string; surface: WorkspaceAreaSurface }
export interface LeaveFile { uri: string; name: string; type: 'application/pdf' | 'image/jpeg' | 'image/png'; size: number; hash: string }
export const leaveUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function leaveOptions(manifest: WorkspaceManifest): LeaveSelection[] {
  return manifest.areas.find(area => area.key === 'attendance')?.surfaces.flatMap(surface => {
    const match = surface.key.match(/^leave:(self|dependent):(.+)$/); if (!match) return [];
    const relationship = match[1] as LeaveRelationship, studentId = match[2]!, scope = surface.scopes.find(scope => scope.kind === relationship && scope.id === studentId);
    return scope && leaveUuid(studentId) ? [{ relationship, studentId, label: scope.label || surface.label, surface }] : [];
  }) ?? [];
}
export function resolveLeaveSelection(manifest: WorkspaceManifest, href: string): { state: 'selected'; option: LeaveSelection } | { state: 'choose'; options: LeaveSelection[] } | { state: 'invalid' } {
  if (href.split('?')[0] !== '/areas/attendance/leave') return { state: 'invalid' };
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  if (['scope', 'student_id', 'leave_id', 'view', 'tab'].some(key => query.getAll(key).length > 1) || query.has('scope') && !['self', 'dependent'].includes(query.get('scope')!) || query.has('student_id') && !query.get('student_id')) return { state: 'invalid' };
  const options = leaveOptions(manifest).filter(option => (!query.has('scope') || option.relationship === query.get('scope')) && (!query.has('student_id') || option.studentId === query.get('student_id')));
  return options.length === 1 ? { state: 'selected', option: options[0]! } : options.length ? { state: 'choose', options } : { state: 'invalid' };
}
export function leaveHref(href: string, values: Record<string, string>) {
  const [path] = href.split('?'), query = new URLSearchParams(href.split('?')[1] ?? '');
  for (const [key, value] of Object.entries(values)) { if (value) query.set(key, value); else query.delete(key); }
  return `${path}${query.size ? `?${query}` : ''}`;
}
export function leaveChoiceHref(option: LeaveSelection) { return `/areas/attendance/leave?${new URLSearchParams({ scope: option.relationship, student_id: option.studentId })}`; }
export function leaveListPath(studentId: string) { if (!leaveUuid(studentId)) throw new Error('Confirm the exact learner before loading leave.'); return `/api/v1/leave-requests/?${new URLSearchParams({ student_id: studentId })}`; }
export function leaveReviewItems(manifest: WorkspaceManifest) {
  return manifest.work.items.flatMap(item => {
    const [path, search = ''] = item.href.split('?'); if (path !== '/areas/attendance/leave/review' && path !== '/areas/attendance/leave') return [];
    const query = new URLSearchParams(search), id = query.get('request');
    return query.getAll('request').length === 1 && leaveUuid(id) && !['scope', 'student_id', 'leave_id'].some(key => query.has(key)) ? [{ id, title: item.title, detail: item.detail, href: `/areas/attendance/leave/review?${new URLSearchParams({ request: id })}` }] : [];
  }).filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
}
export function leaveSourceFingerprint(record: LeaveRecord): string {
  return JSON.stringify([record.id, record.student_id, record.status, record.updated_at ?? null, record.starts_on, record.ends_on, record.category, record.reason,
    record.documents.map(document => [document.id, document.size_bytes, document.created_at]), record.audit_log.map(audit => [audit.id, audit.action, audit.created_at])]);
}
export function leaveDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value; }
export function leaveDuration(start: string, end: string) { if (!leaveDate(start) || !leaveDate(end) || end < start) throw new Error('Choose valid dates. The last day cannot be before the first day.'); return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1; }
export function newLeaveBody(input: { studentId: string; category: LeaveCategory; start: string; end: string; reason: string; file: LeaveFile | null; constraints?: LeaveConstraints }) {
  const duration = leaveDuration(input.start, input.end), reason = input.reason.trim();
  if (!leaveUuid(input.studentId) || !['medical', 'family', 'travel', 'personal'].includes(input.category)) throw new Error('Confirm the exact learner and leave category.');
  if (duration > Math.min(31, input.constraints?.max_duration_days ?? 31)) throw new Error('The leave range exceeds the current request limit.');
  if (reason.length < 5 || reason.length > 2000) throw new Error('Explain the request in 5–2000 characters.');
  if (input.category === 'medical' && input.constraints?.medical_document_after_days !== null && input.constraints?.medical_document_after_days !== undefined && duration > input.constraints.medical_document_after_days && !input.file) throw new Error('The campus requires a supporting document for this medical leave range.');
  return { student_id: input.studentId, category: input.category, starts_on: input.start, ends_on: input.end, reason };
}
export function leaveFileType(name: string, bytes: Uint8Array, maximum = 10 * 1024 * 1024): LeaveFile['type'] {
  if (!bytes.byteLength || bytes.byteLength > Math.min(maximum, 10 * 1024 * 1024)) throw new Error('Choose a nonempty PDF, JPEG or PNG within the current 10 MiB maximum.');
  if (/\.pdf$/i.test(name) && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  if (/\.jpe?g$/i.test(name) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/\.png$/i.test(name) && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  throw new Error('The selected file does not match a supported PDF, JPEG or PNG document.');
}
export function leaveMayAct(record: LeaveRecord, action: LeaveAction, context: { relationship?: LeaveRelationship; canAuthorize: boolean; schoolReview: boolean }): boolean {
  if (['authorize', 'clarify', 'decline'].includes(action)) return context.relationship === 'dependent' && context.canAuthorize && record.status === 'pending_guardian';
  if (['approve', 'reject'].includes(action)) return context.schoolReview && record.status === 'authorized';
  return !!context.relationship && ['draft', 'pending_guardian', 'authorized'].includes(record.status);
}
export function leaveExpectedStatus(action: LeaveAction) { return ({ authorize: 'authorized', clarify: 'pending_guardian', decline: 'declined', withdraw: 'withdrawn', approve: 'school_approved', reject: 'school_rejected' })[action]; }
export function leaveAttentionProof(href: string, selected: LeaveSelection, record: LeaveRecord | undefined, authority?: { student_id: string; latest_change_id: string | null; revision: number }): AttendanceAttentionProof | null {
  if (selected.relationship !== 'dependent') return null;
  const [path, search = ''] = href.split('?'), query = new URLSearchParams(search);
  if (path !== '/areas/attendance/leave' || ['scope', 'student_id', 'attention_notification_id', 'leave_id', 'authority_change_id', 'authority_revision'].some(key => query.getAll(key).length > 1) || query.get('scope') !== 'dependent' || query.get('student_id') !== selected.studentId || !leaveUuid(query.get('attention_notification_id'))) return null;
  let sourceId: string, revision: number;
  if (query.has('authority_change_id')) {
    if (!authority || authority.student_id !== selected.studentId || authority.latest_change_id !== query.get('authority_change_id') || String(authority.revision) !== query.get('authority_revision') || !leaveUuid(authority.latest_change_id)) return null;
    sourceId = authority.latest_change_id; revision = authority.revision;
  } else {
    if (!record || record.student_id !== selected.studentId || record.id !== query.get('leave_id') || !['school_approved', 'school_rejected'].includes(record.status)) return null;
    sourceId = record.id; revision = 1;
  }
  const notificationId = query.get('attention_notification_id')!; query.delete('attention_notification_id');
  return { notificationId, studentId: selected.studentId, recordId: sourceId, revision, openedTarget: href, cleanHref: `${path}${query.size ? `?${query}` : ''}`, key: JSON.stringify([href, selected.studentId, sourceId, revision]) };
}
