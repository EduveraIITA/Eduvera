import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { CampusCalendarScope } from '../../../packages/contracts/src/wire/features/calendar/campusCalendarSources';

export type NativeScheduleKind = 'self' | 'dependent' | 'assigned' | 'manage' | 'availability';
export interface NativeScheduleAccess {
  area: WorkspaceArea; surface: WorkspaceAreaSurface; kind: NativeScheduleKind; studentId?: string; relationshipLabel?: string;
}
function relationship(surface: WorkspaceAreaSurface, prefix: 'calendar' | 'schedule') {
  const match = surface.key.match(new RegExp(`^${prefix}:(self|dependent):(.+)$`));
  if (!match) return null;
  const kind = match[1] as 'self' | 'dependent', studentId = match[2]!;
  const evidence = surface.scopes.find(scope => scope.kind === kind && scope.id === studentId);
  return evidence ? { kind, studentId, relationshipLabel: evidence.label ?? undefined } : null;
}
function access(area: WorkspaceArea, surface: WorkspaceAreaSurface, prefix: 'calendar' | 'schedule'): NativeScheduleAccess | null {
  const person = relationship(surface, prefix);
  if (person) return { area, surface, ...person };
  if (prefix === 'calendar' && ['assigned', 'manage', 'availability'].includes(surface.key)) return { area, surface, kind: surface.key as 'assigned' | 'manage' | 'availability' };
  if (prefix === 'schedule' && surface.key === 'schedule') return { area, surface, kind: 'assigned' };
  return null;
}
export function nativeScheduleOptions(manifest: WorkspaceManifest, href: string): NativeScheduleAccess[] {
  const prefix = href.split('#')[0]!.split('?')[0] === '/areas/calendar' ? 'calendar' : 'schedule';
  const area = manifest.areas.find(candidate => candidate.key === (prefix === 'calendar' ? 'calendar' : 'timetable'));
  return area ? area.surfaces.flatMap(surface => { const candidate = access(area, surface, prefix); return candidate ? [candidate] : []; }) : [];
}

/** Only server-contributed surfaces and matching relationship scopes select a source adapter. */
export function resolveNativeScheduleAccess(manifest: WorkspaceManifest, href: string): NativeScheduleAccess | null {
  const path = href.split('#')[0]!.split('?')[0], calendar = path === '/areas/calendar';
  if (!calendar && !['/areas/timetable', '/areas/timetable/schedule'].includes(path!)) return null;
  const query = new URLSearchParams(href.split('#')[0]!.split('?')[1] ?? '');
  if (['scope', 'student_id', 'surface'].some(key => query.getAll(key).length > 1)) return null;
  const options = nativeScheduleOptions(manifest, href), scope = query.get('scope'), studentId = query.get('student_id')?.trim();
  if (query.has('scope') || query.has('student_id')) {
    if (scope !== 'self' && scope !== 'dependent' || query.has('surface')) return null;
    const candidates = options.filter(option => option.kind === scope);
    if (studentId) return candidates.find(option => option.studentId === studentId) ?? null;
    // Calendar's owner can resolve a single relationship; timetable requires the exact ID.
    return calendar && !query.has('student_id') && candidates.length === 1 ? candidates[0]! : null;
  }
  const surface = query.get('surface');
  if (surface) return calendar ? options.find(option => option.surface.key === surface && ['assigned', 'manage', 'availability'].includes(surface)) ?? null : null;
  if (query.has('surface')) return null;
  if (calendar) {
    const own = options.filter(option => option.kind === 'self');
    const assigned = options.find(option => option.kind === 'assigned');
    const manage = options.some(option => option.kind === 'manage');
    const relationships = options.filter(option => option.kind === 'self' || option.kind === 'dependent');
    if (own.length === 1 && relationships.length === 1 && !manage && (!assigned || assigned.surface.scopes.length > 0 && assigned.surface.scopes.every(scope => scope.kind === 'self'))) return own[0]!;
  }
  const assigned = options.find(option => option.kind === 'assigned'); if (assigned) return assigned;
  if (!calendar) return null;
  const manage = options.find(option => option.kind === 'manage'); if (manage) return manage;
  return options.length === 1 ? options[0]! : null;
}

/** Calendar access never implies authority to another owning domain. */
export function nativeCalendarContributedDestination(manifest: WorkspaceManifest, selected: NativeScheduleAccess, areaKey: 'events' | 'assessments' | 'timetable'): string | undefined {
  const area = manifest.areas.find(candidate => candidate.key === areaKey);
  if (!area || selected.kind === 'availability') return undefined;
  if (areaKey === 'assessments' && selected.kind === 'assigned' && selected.surface.scopes.some(scope => scope.kind === 'person')) {
    // A canonical course learner has a person-bound result surface, not a
    // compatibility student relationship or an assessment-management grant.
    const people = selected.surface.scopes.filter(scope => scope.kind === 'person').map(scope => scope.id);
    const own = area.surfaces.filter(candidate => people.some(id => candidate.key === `results:mine:${id}`
      && candidate.scopes.some(scope => scope.kind === 'person' && scope.id === id)));
    if (own.length !== 1) return undefined;
    try {
      const target = new URL(own[0]!.href, 'https://thatcampus.invalid'), person = target.searchParams.get('person_id');
      if (target.origin !== 'https://thatcampus.invalid' || target.pathname !== '/areas/assessments/results' || target.hash
        || target.searchParams.getAll('scope').length !== 1 || target.searchParams.get('scope') !== 'mine'
        || target.searchParams.getAll('person_id').length !== 1 || target.searchParams.has('student_id') || !person
        || own[0]!.key !== `results:mine:${person}` || !people.includes(person)) return undefined;
      return `${target.pathname}${target.search}`;
    } catch { return undefined; }
  }
  const family = selected.kind === 'self' || selected.kind === 'dependent';
  const stem = areaKey === 'events' ? 'calendar' : areaKey === 'assessments' ? 'results' : 'schedule';
  const surface = family ? area.surfaces.find(candidate => candidate.key === `${stem}:${selected.kind}:${selected.studentId}` && candidate.scopes.some(scope => scope.kind === selected.kind && scope.id === selected.studentId))
    : area.surfaces.find(candidate => candidate.key === (areaKey === 'timetable' ? 'planning' : 'manage')) ?? area.surfaces.find(candidate => candidate.key === (areaKey === 'timetable' ? 'schedule' : 'assigned'));
  if (!surface) return undefined;
  try {
    const target = new URL(surface.href, 'https://thatcampus.invalid');
    if (target.origin !== 'https://thatcampus.invalid' || target.pathname !== `/areas/${areaKey}/${family ? stem : surface.key}`) return undefined;
    if (family && (target.searchParams.getAll('scope').length !== 1 || target.searchParams.getAll('student_id').length !== 1 || target.searchParams.get('scope') !== selected.kind || target.searchParams.get('student_id') !== selected.studentId)) return undefined;
    return `${target.pathname}${target.search}`;
  } catch { return undefined; }
}

export function nativeCalendarSourceScope(manifest: WorkspaceManifest, selected: NativeScheduleAccess): CampusCalendarScope {
  const assessmentHref = nativeCalendarContributedDestination(manifest, selected, 'assessments');
  const assessment = assessmentHref ? new URL(assessmentHref, 'https://thatcampus.invalid') : null;
  const personId = assessment?.searchParams.get('scope') === 'mine' ? assessment.searchParams.get('person_id') ?? undefined : undefined;
  return { schoolId: manifest.context.institution_id, timeZone: manifest.context.time_zone ?? 'UTC', surfaceKey: selected.surface.key, studentId: selected.studentId,
    ...(personId ? { personId } : {}), eventHref: nativeCalendarContributedDestination(manifest, selected, 'events'), assessmentHref,
    includeDining: selected.area.surfaces.some(surface => surface.key === 'availability') };
}

export function nativeCalendarTimetableDestination(manifest: WorkspaceManifest, selected: NativeScheduleAccess, current: URLSearchParams): string | null {
  const href = nativeCalendarContributedDestination(manifest, selected, 'timetable');
  if (!href) return null;
  const target = new URL(href, 'https://thatcampus.invalid');
  for (const key of ['date', 'school', 'class', 'class_section_id']) { const value = current.get(key); if (value) target.searchParams.set(key, value); }
  if (['day', 'agenda'].includes(current.get('view') ?? '')) target.searchParams.set('view', current.get('view')!);
  return `${target.pathname}${target.search}`;
}

export function nativeRelationshipTimetablePath(selected: NativeScheduleAccess, date: string): string | null {
  if (!selected.studentId || !['self', 'dependent'].includes(selected.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const query = new URLSearchParams({ date });
  if (selected.kind === 'dependent') query.set('student_id', selected.studentId);
  return `/api/v1/screens/${selected.kind === 'self' ? 'student' : 'parent'}/timetable/week/?${query}`;
}
export function nativeRelationshipTimetableMatches(value: unknown, selected: NativeScheduleAccess): boolean {
  if (!value || typeof value !== 'object' || !selected.studentId || !['self', 'dependent'].includes(selected.kind)) return false;
  const student = (value as { student?: unknown }).student;
  return !!student && typeof student === 'object' && (student as { id?: unknown }).id === selected.studentId;
}

export function nativeScheduleDestination(href: string, current: URLSearchParams): string {
  const target = new URL(href, 'https://thatcampus.invalid');
  for (const key of ['date', 'view']) { const value = current.get(key); if (value) target.searchParams.set(key, value); }
  return `${target.pathname}${target.search}`;
}
