import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedAcademicClassMatch, assignedAcademicClassesMatch, assignedAcademicClassesPath, assignedAcademicClassRoute, assignedAcademicClassStatus } from '../src/lib/people-academic-classes';
import type { TeacherClassSummary } from '../../packages/contracts/src/wire/features/operations/api';
const school = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', namespace = '10000000-0000-4000-8000-000000000003', date = '2026-10-29';
const summary = { class_section_id: id, class_name: 'Class 7A', student_count: 12, marked_count: 0, submission_status: 'not_started' } as TeacherClassSummary;
test('assigned-class routes preserve exact dated class and reject malformed or ambiguous selections', () => {
  assert.deepEqual(assignedAcademicClassRoute(`/areas/people/classes/${id}?date=${date}&section=students`, '2026-10-30'), { classId: id, date, section: 'students', school: null });
  assert.equal(assignedAcademicClassesPath(date, id), `/api/v1/areas/people/classes/${id}/?date=${date}`);
  for (const href of ['/areas/people/classes/not-an-id', `/areas/people/classes/${id}/extra`, '/areas/people/classes?date=2026-02-30', `/areas/people/classes?date=${date}&date=2026-10-30`, '/areas/people/classes?section=invented']) assert.equal(assignedAcademicClassRoute(href, date), null);
});
test('class lists bind current campus, world, namespace, clock context and exact requested date', () => {
  const data = { date, classes: [summary], context: { institution_id: school, environment: { kind: 'simulation', namespace_id: namespace }, as_of: '2026-10-29T09:00:00Z' } }, scope = { schoolId: school, mode: 'simulation' as const, namespaceId: namespace };
  assert.equal(assignedAcademicClassesMatch(data, scope, date), true);
  for (const changed of [{ ...scope, schoolId: id }, { ...scope, mode: 'live' as const, namespaceId: null }, { ...scope, namespaceId: id }]) assert.equal(assignedAcademicClassesMatch(data, changed, date), false);
  assert.equal(assignedAcademicClassesMatch(data, scope, '2026-10-30'), false);
  assert.equal(assignedAcademicClassesMatch({ ...data, context: undefined }, scope, date), false);
});
test('class detail cannot substitute another school, class or date', () => {
  const data = { date, class: { id, school_id: school }, roster: [], periods: [], register: { revision: 0 } };
  assert.equal(assignedAcademicClassMatch(data, school, id, date), true);
  assert.equal(assignedAcademicClassMatch(data, id, id, date), false); assert.equal(assignedAcademicClassMatch(data, school, namespace, date), false); assert.equal(assignedAcademicClassMatch(data, school, id, '2026-10-30'), false);
});
test('dated class status preserves server authority and availability before presenting marking progress', () => {
  assert.equal(assignedAcademicClassStatus({ ...summary, submission_authorized: false, submission_status: 'submitted' }), 'Attendance needs review');
  assert.equal(assignedAcademicClassStatus({ ...summary, can_mark: false }), 'Attendance · view only');
  assert.equal(assignedAcademicClassStatus({ ...summary, instructional: false, marked_count: 5 }), 'No attendance due');
  assert.equal(assignedAcademicClassStatus({ ...summary, marked_count: 5 }), '5/12 marked');
});
