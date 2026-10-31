import type { AssignedClassesWorkspaceResponse, TeacherAttendanceResponse, TeacherClassSummary } from '../../../packages/contracts/src/wire/features/operations/api';
import type { NativePendingScope } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';
import { academicCatalogueUuid } from './people-academic-catalogue';

export type AssignedAcademicClasses = AssignedClassesWorkspaceResponse & { context: { institution_id: string; environment: { kind: 'live' | 'simulation'; namespace_id: string | null }; as_of: string } };
export type AcademicClassUpdate = { id: string; class_section_id: string; kind: 'note' | 'comment' | 'change'; title: string; body: string; occurred_at: string; unread: boolean; notification_id: string | null; total: number };
export function peopleAcademicHref(href: string, values: Record<string, string>) { const params = new URLSearchParams(href.split('?')[1] ?? ''); Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key)); return href.split('?')[0] + (params.size ? `?${params}` : ''); }
export function assignedAcademicClassesPath(date: string, id?: string) { return `/api/v1/areas/people/classes/${id ? `${id}/` : ''}?${new URLSearchParams({ date })}`; }
export function assignedAcademicClassRoute(href: string, today: string) {
  const url = new URL(href, 'https://thatcampus.invalid'), match = /^\/areas\/people\/classes(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname), date = url.searchParams.get('date') ?? today, section = url.searchParams.get('section') ?? 'overview';
  if (!match || match[1] && !academicCatalogueUuid(match[1]) || !nativeCalendarValidDate(date) || !['overview', 'students', 'notes'].includes(section) || ['date', 'section', 'school'].some(key => url.searchParams.getAll(key).length > 1)) return null;
  return { date, section: section as 'overview' | 'students' | 'notes', classId: match[1], school: url.searchParams.get('school') };
}
export function assignedAcademicClassesMatch(value: unknown, scope: Pick<NativePendingScope, 'schoolId' | 'mode' | 'namespaceId'>, date: string): value is AssignedAcademicClasses {
  const data = value as AssignedAcademicClasses | null;
  return !!data && data.date === date && data.context?.institution_id === scope.schoolId && data.context.environment.kind === scope.mode && data.context.environment.namespace_id === scope.namespaceId && Number.isFinite(Date.parse(data.context.as_of)) && Array.isArray(data.classes) && data.classes.every(item => academicCatalogueUuid(item.class_section_id) && typeof item.class_name === 'string');
}
export function assignedAcademicClassMatch(value: unknown, schoolId: string, classId: string, date: string): value is TeacherAttendanceResponse {
  const data = value as TeacherAttendanceResponse | null;
  return !!data && data.class?.id === classId && data.class.school_id === schoolId && data.date === date && Array.isArray(data.roster) && Array.isArray(data.periods) && !!data.register && Number.isSafeInteger(data.register.revision);
}
export function assignedAcademicClassStatus(cls: TeacherClassSummary) {
  if (cls.submission_authorized === false) return 'Attendance needs review';
  if (cls.submission_status === 'locked') return 'Attendance locked';
  if (cls.submission_status === 'submitted') return 'Attendance submitted';
  if (cls.instructional === false || cls.student_count === 0 || cls.periods_today === 0) return 'No attendance due';
  if (cls.date_open === false) return 'Upcoming';
  if (cls.can_mark === false) return 'Attendance · view only';
  return cls.marked_count > 0 || cls.submission_status === 'in_progress' ? `${cls.marked_count}/${cls.student_count} marked` : 'Attendance not started';
}
