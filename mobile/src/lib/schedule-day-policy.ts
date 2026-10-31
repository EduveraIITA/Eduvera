import type { DayPlan, PeriodInput, PlanOptions } from '../../../packages/contracts/src/wire/features/day-plans/api';
import type { NativePendingAction } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function dayPlanRead(school: string, id: string) { return `/api/v1/day-plans/${encodeURIComponent(id)}?school_id=${encodeURIComponent(school)}`; }
export function dayPlanOptions(school: string, date: string) { return `/api/v1/day-plans/options?${new URLSearchParams({ school_id: school, date })}`; }
export function dayPlanRefreshPath(value: unknown, action: NativePendingAction) {
  const result = value as { id?: unknown; revision?: unknown; version?: unknown } | null, body = action.payload.kind === 'json' ? JSON.parse(action.payload.body) : null, starting = action.endpoint === '/api/v1/day-plans', match = /^\/api\/v1\/day-plans\/([0-9a-f-]{36})\/(save|publish|discard)$/i.exec(action.endpoint);
  if (!result || !body || !uuid(result.id) || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1 || !starting && (result.id !== match?.[1] || result.revision !== body.expected_revision + 1) || match?.[2] === 'publish' && (!Number.isSafeInteger(result.version) || Number(result.version) < 1)) throw new Error('The Daily Plan receipt did not match this exact action.');
  return dayPlanRead(action.scope.schoolId, result.id);
}
export function validDayPlan(value: unknown, school: string, id: string): value is DayPlan {
  const plan = value as DayPlan | null; return !!plan && plan.id === id && plan.school_id === school && Number.isSafeInteger(plan.revision) && plan.revision > 0 && nativeCalendarValidDate(plan.date) && Array.isArray(plan.periods) && Array.isArray(plan.versions) && Array.isArray(plan.conflicts);
}
export function cleanDayPeriod(period: PeriodInput): PeriodInput { return { subject_id: period.subject_id ?? null, period_number: period.period_number, starts_at: period.starts_at.slice(0, 5), ends_at: period.ends_at.slice(0, 5), title: period.title.trim(), slot_type: period.slot_type, room: period.room.trim(), space_id: period.space_id ?? null, teacher_user_id: period.teacher_user_id, cancelled: period.cancelled, materials: [...period.materials] }; }
export function validateDayPeriods(periods: PeriodInput[], options: PlanOptions) {
  if (periods.length > 24 || new Set(periods.map(period => period.period_number)).size !== periods.length) throw new Error('Use at most 24 periods with unique numbers.');
  for (const period of periods) if (!Number.isSafeInteger(period.period_number) || period.period_number < 1 || period.period_number > 24 || !period.title.trim() || period.title.length > 120 || period.room.length > 80 || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(period.starts_at) || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(period.ends_at) || period.ends_at.slice(0, 5) <= period.starts_at.slice(0, 5) || period.teacher_user_id && !options.teachers.some(teacher => teacher.id === period.teacher_user_id) || period.subject_id && !options.subjects.some(subject => subject.id === period.subject_id) || period.materials.length > 12 || period.materials.some(material => !material.trim() || material.length > 120)) throw new Error('Review period titles, times, current teachers and planned materials.');
  return periods.map(cleanDayPeriod);
}
