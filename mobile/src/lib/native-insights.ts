import type { AnalyticsAudience, AnalyticsOverview, AnalyticsPeriod } from '../../../packages/contracts/src/wire/features/analytics/api';
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { isInternalHref } from './api-policy';

export type NativeInsightsScope = 'institution' | 'assigned' | 'self' | 'dependent';
export type NativeAnalyticsTopic = 'attendance' | 'results' | 'progress' | 'institution' | 'registers';
export type NativeInstitutionInsightTopic = 'review' | 'recording' | 'followups' | 'learning-review' | 'operations' | 'finance';
export type NativeInsightsTopic = NativeAnalyticsTopic | NativeInstitutionInsightTopic;
export interface NativeInsightsAccess {
  schoolId: string;
  area: WorkspaceArea;
  surface: WorkspaceAreaSurface;
  kind: NativeInsightsScope;
  audience: AnalyticsAudience;
  studentId?: string;
  contextLabel: string;
}
export type NativeInsightsRoute =
  | { kind: 'overview'; topic: '' }
  | { kind: 'analytics'; topic: NativeAnalyticsTopic }
  | { kind: 'institution-review'; topic: NativeInstitutionInsightTopic; studentId?: string }
  | { kind: 'invalid'; topic: '' };
export interface NativeInsightsFilters {
  period: AnalyticsPeriod;
  classId?: string;
  comparison: 'class' | 'subject';
}

const analyticsTopics = new Set<string>(['attendance', 'results', 'progress', 'institution', 'registers']);
const institutionTopics = new Set<string>(['review', 'recording', 'followups', 'learning-review', 'operations', 'finance']);
const preservedFilters = ['period', 'class', 'class_id', 'compare', 'date', 'insight_days', 'insight_threshold', 'followup', 'via'] as const;
const selectorKeys = ['scope', 'student_id'] as const;

function insightUrl(href: string): URL | null {
  if (!isInternalHref(href)) return null;
  try { return new URL(href, 'https://thatcampus.invalid'); } catch { return null; }
}
function hasDuplicate(params: URLSearchParams, keys: readonly string[]) {
  return keys.some(key => params.getAll(key).length > 1);
}

/** Classify canonical topics without importing the web component/router graph. */
export function nativeInsightsRoute(href: string): NativeInsightsRoute {
  const url = insightUrl(href);
  if (!url) return { kind: 'invalid', topic: '' };
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/areas/insights') return { kind: 'overview', topic: '' };
  const match = path.match(/^\/areas\/insights\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return { kind: 'invalid', topic: '' };
  const topic = match[1]!;
  if (analyticsTopics.has(topic) && !match[2]) return { kind: 'analytics', topic: topic as NativeAnalyticsTopic };
  if (institutionTopics.has(topic) && (!match[2] || topic === 'review')) {
    let studentId: string | undefined;
    try { studentId = match[2] ? decodeURIComponent(match[2]) : undefined; } catch { return { kind: 'invalid', topic: '' }; }
    if (studentId !== undefined && (!studentId.trim() || /[/\\]/.test(studentId))) return { kind: 'invalid', topic: '' };
    return { kind: 'institution-review', topic: topic as NativeInstitutionInsightTopic, ...(studentId ? { studentId } : {}) };
  }
  return { kind: 'invalid', topic: '' };
}

/** Cold/reloaded Insights has a declared parent; actual router/browser origins
 * still win. Retain only owning query context, never a supplied return URL. */
export function nativeInsightsBackParent(href: string): { href: string; title: string } | null {
  const url = insightUrl(href), route = nativeInsightsRoute(href);
  if (!url || route.kind === 'invalid') return null;
  if (route.kind === 'overview') return { href: '/areas', title: 'Areas' };
  const learnerReview = route.kind === 'institution-review' && route.topic === 'review' && !!route.studentId;
  const params = new URLSearchParams();
  for (const key of [...selectorKeys, ...preservedFilters, 'insight_class', 'insight_page', 'recording_page', 'followups_page', 'learning_page', 'coverage_page', 'deadlines_page', 'fee_bands_page']) {
    // Preserve ambiguous selectors exactly so Back cannot silently choose another
    // learner or scope. The owning access/filter checks continue to fail closed.
    for (const value of url.searchParams.getAll(key)) params.append(key, value);
  }
  return { href: `/areas/insights${learnerReview ? '/review' : ''}${params.size ? `?${params}` : ''}`, title: learnerReview ? 'Attendance review' : 'Insights' };
}

/** Contributions establish the available work; titles and membership roles do not. */
export function nativeInsightsOptions(manifest: WorkspaceManifest): NativeInsightsAccess[] {
  const areas = manifest.areas.filter(area => area.key === 'insights');
  if (areas.length !== 1) return [];
  const area = areas[0]!, schoolId = manifest.context.institution_id;
  if (!schoolId) return [];
  const options = area.surfaces.flatMap((surface): NativeInsightsAccess[] => {
    const url = insightUrl(surface.href);
    if (!url || url.pathname !== '/areas/insights' || hasDuplicate(url.searchParams, selectorKeys)) return [];
    if (surface.key === 'institution' || surface.key === 'assigned') {
      if (url.searchParams.get('scope') !== surface.key || url.searchParams.has('student_id')) return [];
      return [{ schoolId, area, surface, kind: surface.key, audience: surface.key === 'institution' ? 'principal' : 'teacher', contextLabel: surface.key === 'institution' ? 'Institution insights' : 'My work insights' }];
    }
    const relationship = surface.key.match(/^overview:(self|dependent):(.+)$/);
    if (!relationship) return [];
    const kind = relationship[1] as 'self' | 'dependent', studentId = relationship[2]!;
    const scopes = surface.scopes.filter(scope => scope.kind === kind && scope.id === studentId);
    if (scopes.length !== 1 || url.searchParams.get('scope') !== kind || url.searchParams.get('student_id') !== studentId) return [];
    return [{ schoolId, area, surface, kind, audience: kind === 'self' ? 'student' : 'parent', studentId, contextLabel: kind === 'self' ? 'My insights' : `${scopes[0]!.label || 'Learner'} insights` }];
  });
  // Ambiguous repeated contributions are not a reason to select an arbitrary one.
  return options.filter(option => options.filter(candidate => candidate.kind === option.kind && candidate.studentId === option.studentId).length === 1);
}

/** An explicit invalid selector never falls back to another authorized context. */
export function resolveNativeInsightsAccess(manifest: WorkspaceManifest, href: string): NativeInsightsAccess | null {
  const url = insightUrl(href);
  if (!url || nativeInsightsRoute(href).kind === 'invalid' || hasDuplicate(url.searchParams, selectorKeys)) return null;
  const params = url.searchParams, requested = params.get('scope'), studentId = params.get('student_id');
  const options = nativeInsightsOptions(manifest);
  if (requested === 'institution' || requested === 'assigned') {
    if (params.has('student_id')) return null;
    return options.find(option => option.kind === requested) ?? null;
  }
  if (requested === 'self' || requested === 'dependent') {
    if (params.has('student_id') && !studentId?.trim()) return null;
    return options.find(option => option.kind === requested && (!studentId || option.studentId === studentId)) ?? null;
  }
  if (params.has('scope') || params.has('student_id')) return null;
  return options.find(option => option.kind === 'institution')
    ?? options.find(option => option.kind === 'assigned')
    ?? options.find(option => option.kind === 'self')
    ?? options.find(option => option.kind === 'dependent')
    ?? null;
}

/** Family reads ignore retained staff class filters, as the owning web view does. */
export function nativeInsightsFilters(href: string, access: NativeInsightsAccess): NativeInsightsFilters | null {
  const url = insightUrl(href);
  if (!url || hasDuplicate(url.searchParams, ['period', 'class', 'class_id', 'insight_class', 'compare'])) return null;
  const params = url.searchParams, periodValue = params.get('period');
  const classes = ['class', 'class_id', 'insight_class'].flatMap(key => params.get(key)?.trim() ? [params.get(key)!] : []);
  if (new Set(classes).size > 1) return null;
  const route = nativeInsightsRoute(href), family = access.kind === 'self' || access.kind === 'dependent';
  return { period: periodValue === '30' || periodValue === '90' ? periodValue : 'term',
    ...(!family && route.topic !== 'institution' && classes[0] ? { classId: classes[0] } : {}),
    comparison: params.get('compare') === 'class' ? 'class' : 'subject' };
}

/** This path is a read-model transport discriminator, never a role selector. */
export function nativeInsightsAnalyticsPath(schoolId: string, access: NativeInsightsAccess, href: string): string | null {
  const route = nativeInsightsRoute(href), filters = nativeInsightsFilters(href, access), url = insightUrl(href);
  if (!schoolId || access.schoolId !== schoolId || !filters || !url || hasDuplicate(url.searchParams, selectorKeys) || route.kind === 'invalid' || route.kind === 'institution-review') return null;
  if (url.searchParams.has('scope') && url.searchParams.get('scope') !== access.kind) return null;
  if (url.searchParams.has('student_id') && (!url.searchParams.has('scope') || url.searchParams.get('student_id') !== access.studentId)) return null;
  if (route.kind === 'analytics' && (['institution', 'registers'].includes(route.topic) && access.kind !== 'institution' || route.topic === 'progress' && (access.kind === 'self' || access.kind === 'dependent'))) return null;
  const params = new URLSearchParams({ period: filters.period });
  if (access.studentId) params.set('student_id', access.studentId);
  if (filters.classId) params.set('class_id', filters.classId);
  return `/api/v1/schools/${encodeURIComponent(schoolId)}/analytics/${access.audience}/?${params}`;
}

/** Canonical topic links keep the selected exact contribution and reporting filters. */
export function nativeInsightsHref(access: NativeInsightsAccess, topic: NativeInsightsTopic | '' = '', sourceHref = ''): string {
  if (topic && !analyticsTopics.has(topic) && !institutionTopics.has(topic)) throw new Error('This Insights topic is unavailable.');
  if (institutionTopics.has(topic) && access.kind !== 'institution') throw new Error('This Insights topic requires the institution contribution.');
  const params = new URLSearchParams({ scope: access.kind });
  if (access.studentId) params.set('student_id', access.studentId);
  const source = insightUrl(sourceHref);
  if (source) for (const key of preservedFilters) {
    const values = source.searchParams.getAll(key);
    if (values.length === 1 && values[0]) params.set(key, values[0]);
  }
  // Migrate the retained historic class filter to the current canonical key.
  if (source && !params.has('class') && source.searchParams.getAll('insight_class').length === 1 && source.searchParams.get('insight_class')) params.set('class', source.searchParams.get('insight_class')!);
  return `/areas/insights${topic ? `/${topic}` : ''}?${params}`;
}

export function nativeInsightsContextHref(access: NativeInsightsAccess, currentHref: string): string {
  const route = nativeInsightsRoute(currentHref);
  const topic = route.kind === 'invalid' || route.kind === 'institution-review' && access.kind !== 'institution' ? '' : route.topic;
  return nativeInsightsHref(access, topic, currentHref);
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function dated(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function sourceSchoolMatches(value: Record<string, unknown>, schoolId: string) { return !('school_id' in value) || value.school_id === schoolId; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function ratio(value: unknown) { return value === null || finite(value); }
function numbers(value: Record<string, unknown>, names: readonly string[]) { return names.every(name => finite(value[name])); }
function strings(value: Record<string, unknown>, names: readonly string[]) { return names.every(name => typeof value[name] === 'string'); }
function rows(value: unknown, matches: (row: Record<string, unknown>) => boolean): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(row => record(row) && matches(row));
}
const attendanceFields = ['present', 'late', 'half_day', 'absent', 'excused', 'recorded', 'denominator', 'attended'] as const;
const registerFields = ['expected', 'submitted', 'locked', 'outstanding'] as const;
function attendanceMetric(value: Record<string, unknown>) { return numbers(value, attendanceFields) && ratio(value.percentage); }
function assessmentMetric(value: Record<string, unknown>) { return numbers(value, ['scored', 'other', 'assessments']) && ratio(value.average); }

/** The legacy wire omits school_id; verify it whenever present, never invent it. */
export function nativeInsightsResponseMatches(value: unknown, schoolId: string, access: NativeInsightsAccess, href: string): value is AnalyticsOverview {
  const filters = nativeInsightsFilters(href, access);
  if (!nativeInsightsAnalyticsPath(schoolId, access, href) || !filters || !record(value) || !sourceSchoolMatches(value, schoolId) || value.portal !== access.audience) return false;
  if ('audience' in value && value.audience !== access.audience) return false;
  if (typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at)) || typeof value.scope_label !== 'string') return false;
  if (!record(value.term) || !strings(value.term, ['id', 'name']) || !dated(value.term.starts_on) || !dated(value.term.ends_on) || !finite(value.term.attendance_threshold)) return false;
  if (!record(value.range) || value.range.period !== filters.period || !dated(value.range.from) || !dated(value.range.to) || typeof value.range.capped !== 'boolean' || !Array.isArray(value.classes)) return false;
  if (value.classes.some(item => !record(item) || typeof item.id !== 'string' || typeof item.name !== 'string')) return false;
  if (filters.classId ? value.selected_class_id !== filters.classId || !value.classes.some(item => item.id === filters.classId) : value.selected_class_id != null) return false;
  const learners = [value.student, value.selected_student].filter(item => item != null);
  if (access.studentId) {
    if (!record(value.student) || value.student.id !== access.studentId) return false;
    if (learners.some(item => !record(item) || item.id !== access.studentId || !sourceSchoolMatches(item, schoolId))) return false;
  } else if (learners.length) return false;
  if (value.attendance !== null) {
    if (!record(value.attendance) || !attendanceMetric(value.attendance)
      || !rows(value.attendance.trend, item => attendanceMetric(item) && dated(item.date) && dated(item.end))
      || !rows(value.attendance.classes, item => attendanceMetric(item) && strings(item, ['id', 'name']))
      || !rows(value.attendance.subjects, item => strings(item, ['id', 'name']) && numbers(item, ['held', 'attended', 'excused', 'counted']) && ratio(item.percentage))) return false;
  }
  if (value.assessments !== null) {
    if (!record(value.assessments) || !record(value.assessments.overall) || !assessmentMetric(value.assessments.overall)
      || !Array.isArray(value.assessments.overall.distribution) || value.assessments.overall.distribution.length !== 5 || !value.assessments.overall.distribution.every(finite)
      || !rows(value.assessments.subjects, item => assessmentMetric(item) && strings(item, ['id', 'name']))
      || !rows(value.assessments.classes, item => assessmentMetric(item) && strings(item, ['id', 'name']))
      || !rows(value.assessments.pipeline, item => typeof item.status === 'string' && finite(item.count))) return false;
  }
  if (value.institution !== null) {
    if (!record(value.institution) || access.kind !== 'institution' || !dated(value.institution.as_of) || !dated(value.institution.enrollment_as_of)
      || !numbers(value.institution, ['students', 'configured_classes', 'populated_classes', 'teaching_staff', 'non_teaching_staff'])
      || !ratio(value.institution.average_class_size) || !ratio(value.institution.students_per_teacher)
      || !rows(value.institution.classes, item => strings(item, ['id', 'name']) && finite(item.students))) return false;
  }
  if (value.registers !== null) {
    if (!record(value.registers) || access.kind !== 'institution' || !numbers(value.registers, [...registerFields, 'unscheduled_classes']) || !ratio(value.registers.percentage)
      || !rows(value.registers.classes, item => strings(item, ['id', 'name']) && numbers(item, registerFields) && ratio(item.percentage) && (item.latest_unsubmitted === null || dated(item.latest_unsubmitted)))) return false;
  }
  return true;
}
