import type { InsightStudent, PrincipalInsights } from '../../../packages/contracts/src/wire/features/principal-insights/api';
import { isInternalHref } from './api-policy';
import { nativeInsightsRoute } from './native-insights';

const selectors = ['scope', 'student_id', 'date', 'insight_days', 'insight_threshold', 'class', 'class_id', 'insight_class', 'insight_page'] as const;
const classAliases = ['class', 'class_id', 'insight_class'] as const;
interface InstitutionRequest {
  url: URL;
  path: string;
  days: number;
  threshold: number;
  date?: string;
  classId?: string;
  studentId?: string;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function institutionRequest(href: string): InstitutionRequest | null {
  if (!isInternalHref(href)) return null;
  const route = nativeInsightsRoute(href);
  if (route.kind !== 'overview' && route.kind !== 'institution-review') return null;
  const url = new URL(href, 'https://thatcampus.invalid'), params = url.searchParams;
  if (selectors.some(key => params.getAll(key).length > 1)) return null;
  if (params.has('scope') && params.get('scope') !== 'institution' || params.has('student_id')) return null;
  const date = params.get('date');
  if (date !== null && !calendarDate(date)) return null;
  const classes = classAliases.flatMap(key => params.get(key) ? [params.get(key)!] : []);
  if (classes.some(value => !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) || new Set(classes).size > 1) return null;
  const rawDays = Number(params.get('insight_days')), rawThreshold = Number(params.get('insight_threshold') ?? 50);
  const days = [14, 28, 56].includes(rawDays) ? rawDays : 28;
  const threshold = Number.isInteger(rawThreshold) && rawThreshold >= 1 && rawThreshold <= 99 ? rawThreshold : 50;
  const studentId = route.kind === 'institution-review' ? route.studentId : undefined;
  const path = `/areas/insights${route.topic ? `/${route.topic}` : ''}${studentId ? `/${encodeURIComponent(studentId)}` : ''}`;
  return { url, path, days, threshold, ...(date ? { date } : {}), ...(classes[0] ? { classId: classes[0] } : {}), ...(studentId ? { studentId } : {}) };
}

/** Read-only transport policy. Contribution authority is checked by the owning Insights route. */
export function nativeInstitutionInsightPath(schoolId: string, href: string): string | null {
  const request = institutionRequest(href);
  if (!schoolId.trim() || /[\u0000-\u001f\u007f]/.test(schoolId) || !request) return null;
  // Omit the default date: the ordinary API resolves the selected Live/Simulation clock.
  const params = new URLSearchParams({ days: String(request.days), threshold: String(request.threshold) });
  if (request.date) params.set('date', request.date);
  if (request.classId) params.set('class_section_id', request.classId);
  if (request.studentId) params.set('student_id', request.studentId);
  return `/api/v1/schools/${encodeURIComponent(schoolId)}/principal-insights/?${params}`;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function numbers(value: Record<string, unknown>, keys: readonly string[]) { return keys.every(key => number(value[key])); }
function strings(value: Record<string, unknown>, keys: readonly string[]) { return keys.every(key => typeof value[key] === 'string'); }
function ratio(value: unknown) { return value === null || number(value); }
function rows(value: unknown, matches: (row: Record<string, unknown>) => boolean): value is Record<string, unknown>[] { return Array.isArray(value) && value.every(row => record(row) && matches(row)); }
function student(value: unknown): value is InsightStudent {
  return record(value) && strings(value, ['id', 'name', 'class_id', 'class_name']) && !!value.id
    && numbers(value, ['expected', 'recorded', 'scored', 'points', 'previous_expected', 'previous_recorded', 'previous_scored', 'previous_points', 'missing_homework', 'open_followups', 'current', 'previous', 'change']) && typeof value.combined === 'boolean';
}

/** Reject a stale or differently scoped read before any aggregate or learner detail is displayed. */
export function nativeInstitutionInsightsMatches(value: unknown, schoolId: string, href: string): value is PrincipalInsights {
  const request = institutionRequest(href);
  if (!request || !nativeInstitutionInsightPath(schoolId, href) || !record(value) || value.school_id !== schoolId || value.class_section_id !== (request.classId ?? null) || value.threshold !== request.threshold) return false;
  if (!strings(value, ['school_name', 'generated_at', 'timezone']) || !Number.isFinite(Date.parse(value.generated_at as string)) || !calendarDate(value.operational_date)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone as string }); } catch { return false; }
  if (!record(value.period) || value.period.days !== request.days || !calendarDate(value.period.start) || !calendarDate(value.period.end) || !calendarDate(value.period.baseline_start) || !calendarDate(value.period.baseline_end)) return false;
  const expectedEnd = request.date && request.date < value.operational_date ? request.date : value.operational_date;
  if (value.period.end !== expectedEnd || value.period.start !== shiftDate(expectedEnd, 1 - request.days) || value.period.baseline_start !== shiftDate(value.period.start, -request.days) || value.period.baseline_end !== shiftDate(value.period.start, -1)) return false;
  if (!rows(value.classes, item => strings(item, ['id', 'name'])) || request.classId && !value.classes.some(item => item.id === request.classId)) return false;
  if (!record(value.attendance) || !numbers(value.attendance, ['expected', 'recorded', 'scored', 'points']) || !ratio(value.attendance.percentage) || !ratio(value.attendance.completeness)) return false;
  if (!rows(value.attendance.daily, item => calendarDate(item.date) && numbers(item, ['expected', 'recorded', 'scored', 'points']) && ratio(item.percentage))) return false;
  if (!rows(value.attendance.classes, item => strings(item, ['id', 'name']) && numbers(item, ['expected', 'recorded', 'scored', 'points']) && ratio(item.percentage) && ratio(item.completeness))) return false;
  if (!record(value.engagement) || !numbers(value.engagement, ['total', 'combined', 'without_followup']) || !Array.isArray(value.engagement.students) || !value.engagement.students.every(student) || !Array.isArray(value.engagement.without_followup_students) || !value.engagement.without_followup_students.every(student)) return false;
  const focused = value.engagement.focused_student;
  // A capped list may omit this learner. Only an explicitly returned focused row must match.
  if (focused != null && (!request.studentId || !student(focused) || focused.id !== request.studentId)) return false;
  if (!record(value.followups) || !numbers(value.followups, ['awaiting', 'review', 'resolved', 'overdue']) || !rows(value.followups.details, item => strings(item, ['id', 'student_name', 'class_id', 'attendance_date', 'state', 'owner']) && calendarDate(item.attendance_date) && typeof item.overdue === 'boolean')) return false;
  if (!rows(value.learning, item => strings(item, ['id', 'title', 'class_name', 'subject', 'published_at']) && Number.isFinite(Date.parse(item.published_at as string)) && numbers(item, ['assessed', 'below', 'roster']))) return false;
  if (!rows(value.schedule, item => calendarDate(item.date) && numbers(item, ['planned', 'unassigned', 'cancelled']))) return false;
  if (!rows(value.deadlines, item => strings(item, ['class_id', 'class_name']) && calendarDate(item.date) && numbers(item, ['homework', 'assessments', 'total']))) return false;
  return rows(value.fees, item => typeof item.band === 'string' && numbers(item, ['due_paise', 'paid_paise', 'balance_paise']));
}

export interface NativeInstitutionInsightPage<T> { rows: T[]; page: number; pageSize: number; total: number; totalPages: number }

/** Lists are already bounded by the owning read model; pagination never requests another context. */
export function nativeInstitutionInsightPage<T>(items: readonly T[], requestedPage: unknown, pageSize = 8): NativeInstitutionInsightPage<T> {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 8;
  const total = items.length, totalPages = Math.max(1, Math.ceil(total / size));
  const raw = typeof requestedPage === 'number' || typeof requestedPage === 'string' && /^\d+$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Number.isSafeInteger(raw) ? Math.min(totalPages, Math.max(1, raw)) : 1;
  return { rows: items.slice((page - 1) * size, page * size), page, pageSize: size, total, totalPages };
}

/** Retain the canonical topic and exact nested learner when updating review filters. */
export function nativeInstitutionInsightHref(href: string, changes: Record<string, string | null>): string {
  const request = institutionRequest(href);
  if (!request) throw new Error('This institution Insights destination is unavailable.');
  const params = new URLSearchParams(request.url.searchParams);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key); else params.set(key, value);
  }
  const search = params.toString(), next = `${request.path}${search ? `?${search}` : ''}${request.url.hash}`;
  if (!institutionRequest(next)) throw new Error('These institution Insights filters are unavailable.');
  return next;
}
