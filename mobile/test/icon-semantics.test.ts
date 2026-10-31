import assert from 'node:assert/strict';
import test from 'node:test';
import { iconAreaForDestination, iconForDestination, productIconDefinitions } from '../src/ui/icon-semantics';

test('different choices in the reported menus have distinct meaningful glyphs', () => {
  for (const routes of [
    ['/areas/in-out/visits', '/areas/in-out/operate', '/areas/in-out/manage'],
    ['/areas/attendance/registers', '/areas/attendance/thresholds'],
    ['/areas/assessments/assigned', '/areas/assessments/manage', '/areas/assessments/results'],
    ['/areas/timetable/schedule', '/areas/timetable/planning', '/areas/timetable/session'],
    ['/areas/departure/plan', '/areas/departure/operate', '/areas/departure/manage'],
  ]) {
    const glyphs = routes.map(href => productIconDefinitions[iconForDestination(href)][0]);
    assert.equal(new Set(glyphs).size, routes.length, routes.join(', '));
  }
});
test('identifiers, search text and return links cannot masquerade as a screen meaning', () => {
  for (const href of ['/areas/attendance/records?scope=self&student_id=person', '/areas/attendance/records?next=/areas/people']) assert.equal(iconForDestination(href), 'attendanceRecords');
  for (const search of ['student', 'guardian', 'calendar', 'insight', 'care']) assert.equal(iconForDestination(`/areas/resources?search=${search}`), 'resources');
  assert.equal(iconForDestination('/more/setup/people/invitations?person_id=student'), 'invitations');
  assert.equal(iconForDestination('/areas/messages/assignments?class_section_id=one'), 'assignments');
});
test('only explicit owning view selectors refine the same canonical destination', () => {
  assert.equal(iconForDestination('/areas/people/participants?view=groups&search=person'), 'groups');
  assert.equal(iconForDestination('/areas/people/participants?search=groups'), 'people');
  assert.equal(iconForDestination('/areas/resources?view=mine'), 'loans');
  assert.equal(iconForDestination('/areas/insights?scope=institution'), 'institutionInsights');
  assert.equal(iconForDestination('/areas/insights?scope=assigned&student_id=person'), 'insights');
  assert.equal(iconForDestination('/more/setup/capabilities?task=assignments'), 'assignments');
});
test('active feature names exist and an unknown meaning never silently becomes Books', () => {
  for (const name of ['events', 'verification', 'assignments', 'examinations', 'performance', 'staff'] as const) assert.ok(productIconDefinitions[name]);
  assert.equal(iconForDestination('/new-unreviewed-feature', 'new-unknown-name'), 'unknown');
  for (const name of ['toString', 'constructor', '__proto__']) {
    assert.equal(iconForDestination('/new-unreviewed-feature', name), 'unknown');
    assert.equal(iconForDestination(`/more/setup/capabilities?task=${name}`), 'unknown');
  }
  assert.equal(productIconDefinitions.unknown[0], 'Question');
  assert.equal(productIconDefinitions.assistant[0], 'Assistant');
});

test('area identity stays consistent across child choices and follows cross-link destinations', () => {
  const examples = {
    attendance: ['/areas/attendance/registers', '/areas/attendance/thresholds', '/areas/attendance/leave'],
    gate: ['/areas/in-out/visits', '/areas/in-out/operate', '/areas/in-out/manage', '/work/in-out/approvals'],
    assessments: ['/areas/assessments/assigned', '/areas/assessments/manage', '/areas/assessments/results'],
    insights: ['/areas/insights/attendance', '/areas/insights/registers', '/areas/insights/results'],
    messages: ['/areas/messages/assignments', '/areas/messages/diary'],
    responsibilities: ['/areas/responsibilities/leave', '/areas/responsibilities/coverage'],
    neutral: ['/more/setup'],
    today: ['/today'], work: ['/work'], areas: ['/areas'], more: ['/more'],
  };
  for (const [area, routes] of Object.entries(examples)) {
    for (const href of routes) assert.equal(iconAreaForDestination(href, productIconDefinitions[iconForDestination(href)][1]), area, href);
  }
  assert.equal(iconAreaForDestination('/areas/people/records?next=/areas/insights', 'insights'), 'people');
  for (const href of ['https://other.invalid/areas/people', '//other.invalid/areas/people', '/areas/constructor', '/areas/peoplefake']) assert.equal(iconAreaForDestination(href), 'neutral');
  assert.equal(productIconDefinitions.assistant[1], 'brand');
  assert.equal(productIconDefinitions.completed[1], 'status-positive');
  assert.equal(productIconDefinitions.unknown[1], 'neutral');
});

test('dock and header have stable restrained accents independent of selection and unread state', () => {
  for (const name of ['today', 'work', 'areas', 'more', 'profile', 'notifications'] as const) assert.equal(productIconDefinitions[name][1], name);
});
