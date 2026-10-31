import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';

export interface NativeAttendanceRelationship { relationship: 'self' | 'dependent'; studentId: string; surface: WorkspaceAreaSurface; label: string }
export type NativeAttendanceSelection = { state: 'selected'; option: NativeAttendanceRelationship } | { state: 'choose'; options: NativeAttendanceRelationship[] } | { state: 'invalid' };
export function attendanceRelationshipOptions(manifest: WorkspaceManifest): NativeAttendanceRelationship[] {
  return manifest.areas.find(area => area.key === 'attendance')?.surfaces.flatMap(surface => {
    const match = surface.key.match(/^records:(self|dependent):(.+)$/);
    if (!match) return [];
    const relationship = match[1] as 'self' | 'dependent', studentId = match[2]!;
    const scope = surface.scopes.find(value => value.kind === relationship && value.id === studentId);
    return scope ? [{ relationship, studentId, surface, label: scope.label || surface.label }] : [];
  }) ?? [];
}
export function resolveAttendanceRelationship(manifest: WorkspaceManifest, href: string): NativeAttendanceSelection {
  if (href.split('?')[0] !== '/areas/attendance/records') return { state: 'invalid' };
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  if (['scope', 'student_id'].some(key => query.getAll(key).length > 1)) return { state: 'invalid' };
  const relationship = query.get('scope'), studentId = query.get('student_id');
  if (query.has('scope') && relationship !== 'self' && relationship !== 'dependent' || query.has('student_id') && !studentId) return { state: 'invalid' };
  const options = attendanceRelationshipOptions(manifest).filter(option => (!relationship || relationship === option.relationship) && (!studentId || studentId === option.studentId));
  if (options.length === 1) return { state: 'selected', option: options[0]! };
  return options.length ? { state: 'choose', options } : { state: 'invalid' };
}
export function nativeAttendanceRecordsPath(option: NativeAttendanceRelationship): string {
  return option.relationship === 'self' ? '/api/v1/screens/student/attendance/' : `/api/v1/screens/parent/attendance/?${new URLSearchParams({ student_id: option.studentId })}`;
}
export function nativeAttendanceRecordsMatches(value: unknown, option: NativeAttendanceRelationship): boolean {
  return !!value && typeof value === 'object' && 'student' in value && !!value.student && typeof value.student === 'object' && 'id' in value.student && value.student.id === option.studentId;
}
export function attendanceRelationshipHref(href: string, option: NativeAttendanceRelationship): string {
  const query = new URLSearchParams(href.split('?')[1] ?? ''); query.set('scope', option.relationship); query.set('student_id', option.studentId);
  for (const key of ['attendance_record_id', 'attendance_revision', 'attention_notification_id', 'date']) query.delete(key);
  return `/areas/attendance/records?${query}`;
}
export function attendanceOperationalSurface(manifest: WorkspaceManifest, path: string): WorkspaceAreaSurface | null {
  const kind = path === '/areas/attendance/coordination' ? 'coordination' : path === '/areas/attendance/registers' || path === '/areas/attendance/evidence' ? 'registers' : null;
  const surfaces = manifest.areas.find(area => area.key === 'attendance')?.surfaces ?? [];
  return kind ? surfaces.find(surface => surface.key === kind) ?? (path === '/areas/attendance/evidence' ? surfaces.find(surface => surface.key === 'coordination') : null) ?? null : null;
}
