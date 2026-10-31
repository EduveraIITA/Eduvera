import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { nativeCalendarContributedDestination, nativeCalendarSourceScope, nativeCalendarTimetableDestination, nativeRelationshipTimetableMatches, nativeRelationshipTimetablePath, nativeScheduleOptions, resolveNativeScheduleAccess } from '../src/lib/schedule-access';

const relationship = (prefix: 'calendar' | 'schedule', kind: 'self' | 'dependent', id: string): WorkspaceAreaSurface => ({
  key: `${prefix}:${kind}:${id}`, label: `${id} schedule`, href: `/areas/${prefix === 'calendar' ? 'calendar' : 'timetable/schedule'}?scope=${kind}&student_id=${id}`,
  capabilities: ['read'], scopes: [{ kind, id, label: id }],
});
const surface = (key: string): WorkspaceAreaSurface => ({ key, label: key, href: `/areas/calendar?surface=${key}`, capabilities: ['read'], scopes: [] });
function manifest(calendar: WorkspaceAreaSurface[], timetable = calendar.filter(item => item.key.startsWith('calendar:')).map(item => ({ ...item, key: item.key.replace('calendar:', 'schedule:') }))): WorkspaceManifest {
  const area = (key: string, surfaces: WorkspaceAreaSurface[]): WorkspaceArea => ({ key, label: key, href: `/areas/${key}`, capabilities: [], scopes: [], surfaces });
  return { context: { actor_user_id: 'actor', institution_id: 'campus', environment: { kind: 'live' } }, areas: [area('calendar', calendar), area('timetable', timetable)] } as unknown as WorkspaceManifest;
}

test('explicit child context selects only its own parent timetable adapter even when actor has campus management', () => {
  const source = manifest([surface('manage'), relationship('calendar', 'dependent', 'child-a'), relationship('calendar', 'dependent', 'child-b')]);
  const chosen = resolveNativeScheduleAccess(source, '/areas/calendar?scope=dependent&student_id=child-b')!;
  assert.equal(chosen.kind, 'dependent'); assert.equal(chosen.studentId, 'child-b');
  assert.equal(nativeRelationshipTimetablePath(chosen, '2026-10-27'), '/api/v1/screens/parent/timetable/week/?date=2026-10-27&student_id=child-b');
  assert.equal(nativeRelationshipTimetableMatches({ student: { id: 'child-b' } }, chosen), true);
  assert.equal(nativeRelationshipTimetableMatches({ student: { id: 'child-a' } }, chosen), false);
  assert.equal(nativeRelationshipTimetableMatches({ items: [] }, chosen), false);
});

test('fragment focus never becomes part of a final relationship identity or route path',()=>{
  const source=manifest([relationship('calendar','dependent','child-a')]);
  assert.equal(resolveNativeScheduleAccess(source,'/areas/calendar?scope=dependent&student_id=child-a#day-detail')?.studentId,'child-a');
  assert.equal(resolveNativeScheduleAccess(source,'/areas/timetable/schedule?scope=dependent&student_id=child-a#period-detail')?.studentId,'child-a');
  assert.equal(nativeScheduleOptions(source,'/areas/calendar#day-detail').length,1);
});

test('self adapter is selected from exact contributed student identity and verifies its returned identity', () => {
  const source = manifest([relationship('calendar', 'self', 'learner')]);
  const chosen = resolveNativeScheduleAccess(source, '/areas/timetable/schedule?scope=self&student_id=learner')!;
  assert.equal(nativeRelationshipTimetablePath(chosen, '2026-10-27'), '/api/v1/screens/student/timetable/week/?date=2026-10-27');
  assert.equal(nativeRelationshipTimetableMatches({ student: { id: 'learner' } }, chosen), true);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/timetable/schedule?scope=self'), null);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/timetable/schedule?scope=self&student_id=another'), null);
});

test('several children require an explicit choice and never fall back to an acting-person agenda', () => {
  const source = manifest([relationship('calendar', 'dependent', 'a'), relationship('calendar', 'dependent', 'b')]);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar'), null);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar?scope=dependent'), null);
  assert.equal(nativeScheduleOptions(source, '/areas/calendar').length, 2);
  assert.equal(resolveNativeScheduleAccess(manifest([relationship('calendar', 'dependent', 'only')]), '/areas/calendar?scope=dependent')?.studentId, 'only');
});

test('key alone cannot grant relationship access without matching server scope evidence', () => {
  const forged = relationship('calendar', 'dependent', 'child');
  const source = manifest([{ ...forged, scopes: [{ kind: 'dependent', id: 'another' }] }]);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar?scope=dependent&student_id=child'), null);
  assert.equal(nativeScheduleOptions(source, '/areas/calendar').length, 0);
});

test('foreign, incomplete, duplicate or mixed scope parameters fail closed', () => {
  const source = manifest([surface('assigned'), surface('manage'), relationship('calendar', 'dependent', 'child')]);
  for (const query of ['scope=other', 'student_id=child', 'scope=dependent&student_id=unknown', 'scope=dependent&student_id=child&surface=manage', 'scope=dependent&scope=self&student_id=child', 'scope=dependent&student_id=child&student_id=other', 'surface=planning', 'surface=']) {
    assert.equal(resolveNativeScheduleAccess(source, `/areas/calendar?${query}`), null, query);
  }
  assert.equal(resolveNativeScheduleAccess(source, '/areas/timetable/planning?scope=dependent&student_id=child'), null);
});

test('acting-person activity adapter requires its own contributed responsibility surface', () => {
  const source = manifest([surface('assigned'), surface('manage'), surface('availability')], [{ ...surface('schedule'), href: '/areas/timetable/schedule' }]);
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar')?.kind, 'assigned');
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar?surface=manage')?.kind, 'manage');
  assert.equal(resolveNativeScheduleAccess(source, '/areas/calendar?surface=availability')?.kind, 'availability');
  const chosen = resolveNativeScheduleAccess(source, '/areas/timetable/schedule')!;
  assert.equal(chosen.kind, 'assigned'); assert.equal(nativeRelationshipTimetablePath(chosen, '2026-10-27'), null);
  assert.equal(resolveNativeScheduleAccess(manifest([], []), '/areas/calendar'), null);
});

test('Calendar prefers one exact own learner only over self-only assigned responsibility', () => {
  const self = relationship('calendar', 'self', 'learner');
  const assigned = { ...surface('assigned'), scopes: [{ kind: 'self' as const, id: 'learner' }] };
  assert.equal(resolveNativeScheduleAccess(manifest([assigned, self]), '/areas/calendar')?.kind, 'self');
  assert.equal(resolveNativeScheduleAccess(manifest([surface('assigned'), self]), '/areas/calendar')?.kind, 'assigned');
  assert.equal(resolveNativeScheduleAccess(manifest([assigned, surface('manage'), self]), '/areas/calendar')?.kind, 'assigned');
  assert.equal(resolveNativeScheduleAccess(manifest([assigned, self, relationship('calendar', 'dependent', 'child')]), '/areas/calendar')?.kind, 'assigned');
});

test('Calendar source links require exact independently contributed domain scope and path', () => {
  const base = manifest([relationship('calendar', 'dependent', 'child')]);
  const selected = resolveNativeScheduleAccess(base, '/areas/calendar?scope=dependent&student_id=child')!;
  const area = (key: string, keyStem: string, href: string): WorkspaceArea => ({ key, label: key, href, capabilities: [], scopes: [], surfaces: [{ key: `${keyStem}:dependent:child`, label: key, href, capabilities: [], scopes: [{ kind: 'dependent', id: 'child' }] }] });
  assert.equal(nativeCalendarContributedDestination(base, selected, 'events'), undefined);
  const source = { ...base, areas: [...base.areas, area('events', 'calendar', '/areas/events/calendar?scope=dependent&student_id=child')] };
  assert.equal(nativeCalendarContributedDestination(source, selected, 'events'), '/areas/events/calendar?scope=dependent&student_id=child');
  for (const href of ['https://foreign.test/areas/events/calendar?scope=dependent&student_id=child', '/areas/events/manage?scope=dependent&student_id=child', '/areas/events/calendar?scope=dependent&student_id=another', '/areas/events/calendar?scope=dependent&scope=self&student_id=child']) {
    const changed = { ...source, areas: source.areas.map(item => item.key === 'events' ? area('events', 'calendar', href) : item) };
    assert.equal(nativeCalendarContributedDestination(changed, selected, 'events'), undefined, href);
  }
  const emptyScope = { ...source, areas: source.areas.map(item => item.key === 'events' ? { ...item, surfaces: item.surfaces.map(item => ({ ...item, scopes: [] })) } : item) };
  assert.equal(nativeCalendarContributedDestination(emptyScope, selected, 'events'), undefined);
});

test('Calendar availability grants no Events or Assessments and timetable links retain exact person', () => {
  const source = manifest([surface('availability')]);
  const availability = resolveNativeScheduleAccess(source, '/areas/calendar')!;
  assert.equal(nativeCalendarSourceScope(source, availability).includeDining, true);
  assert.equal(nativeCalendarSourceScope(source, availability).eventHref, undefined);
  assert.equal(nativeCalendarSourceScope(source, availability).assessmentHref, undefined);
  assert.equal(nativeCalendarTimetableDestination(source, availability, new URLSearchParams()), null);
  const family = manifest([relationship('calendar', 'dependent', 'child')], [relationship('schedule', 'dependent', 'child')]);
  const selected = resolveNativeScheduleAccess(family, '/areas/calendar?scope=dependent&student_id=child')!;
  const href = nativeCalendarTimetableDestination(family, selected, new URLSearchParams({ date: '2026-11-01', view: 'month', q: 'private search', class_section_id: 'class-a' }))!;
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('student_id'), 'child'); assert.equal(params.get('scope'), 'dependent');
  assert.equal(params.get('date'), '2026-11-01'); assert.equal(params.get('class_section_id'), 'class-a');
  assert.equal(params.has('view'), false); assert.equal(params.has('q'), false);
});
