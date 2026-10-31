import assert from 'node:assert/strict';
import test from 'node:test';
import type { InsightStudent, PrincipalInsights } from '../../packages/contracts/src/wire/features/principal-insights/api';
import { nativeInstitutionInsightHref, nativeInstitutionInsightPage, nativeInstitutionInsightPath, nativeInstitutionInsightsMatches } from '../src/lib/native-institution-insights';

const overview = '/areas/insights?scope=institution';
const learner = (id: string): InsightStudent => ({ id, name: `Learner ${id}`, class_id: 'class-a', class_name: 'Class A', expected: 20, recorded: 20, scored: 20, points: 14, previous_expected: 20, previous_recorded: 20, previous_scored: 20, previous_points: 18, missing_homework: 2, open_followups: 0, current: 70, previous: 90, change: -20, combined: true });
const response = (): PrincipalInsights => ({
  school_id: 'school', school_name: 'Campus', generated_at: '2026-10-28T10:00:00Z', timezone: 'Asia/Kolkata', operational_date: '2026-10-28', class_section_id: null, threshold: 50,
  period: { start: '2026-10-01', end: '2026-10-28', baseline_start: '2026-09-03', baseline_end: '2026-09-30', days: 28 }, classes: [{ id: 'class-a', name: 'Class A' }],
  attendance: { expected: 20, recorded: 20, scored: 20, points: 14, percentage: 70, completeness: 100, daily: [{ date: '2026-10-28', expected: 1, recorded: 1, scored: 1, points: 1, percentage: 100 }], classes: [{ id: 'class-a', name: 'Class A', expected: 20, recorded: 20, scored: 20, points: 14, percentage: 70, completeness: 100 }] },
  engagement: { total: 1, combined: 1, without_followup: 1, students: [learner('learner-a')], without_followup_students: [learner('learner-a')], focused_student: null },
  followups: { awaiting: 1, review: 0, resolved: 0, overdue: 0, details: [{ id: 'followup-a', student_name: 'Learner A', class_id: 'class-a', attendance_date: '2026-10-28', state: 'awaiting_response', owner: 'Owner', overdue: false }] },
  learning: [{ id: 'assessment-a', title: 'Assessment', class_name: 'Class A', subject: 'Subject', assessed: 10, below: 2, roster: 10, published_at: '2026-10-27T10:00:00Z' }],
  schedule: [{ date: '2026-10-28', planned: 5, unassigned: 0, cancelled: 0 }], deadlines: [{ date: '2026-10-28', class_id: 'class-a', class_name: 'Class A', homework: 1, assessments: 0, total: 1 }], fees: [{ band: 'Due today', due_paise: 10000, paid_paise: 4000, balance_paise: 6000 }],
});

test('overview and all institution review topics use the same ordinary read without a device-clock date', () => {
  const expected = '/api/v1/schools/school/principal-insights/?days=28&threshold=50';
  assert.equal(nativeInstitutionInsightPath('school', overview), expected);
  assert.equal(nativeInstitutionInsightPath('school', '/areas/insights'), expected);
  for (const topic of ['review', 'recording', 'followups', 'learning-review', 'operations', 'finance']) assert.equal(nativeInstitutionInsightPath('school', `/areas/insights/${topic}?scope=institution`), expected, topic);
  assert.equal(nativeInstitutionInsightPath('school', '/areas/insights/review/learner%20A?scope=institution'), `${expected}&student_id=learner+A`);
  assert.equal(nativeInstitutionInsightPath('school/name', overview), '/api/v1/schools/school%2Fname/principal-insights/?days=28&threshold=50');
});

test('explicit review filters retain valid dates, supported windows, threshold and canonical class identity', () => {
  for (const key of ['class', 'class_id', 'insight_class']) {
    const href = `/areas/insights/learning-review?scope=institution&date=2024-02-29&insight_days=56&insight_threshold=63&${key}=class-a&insight_page=9`;
    assert.equal(nativeInstitutionInsightPath('school', href), '/api/v1/schools/school/principal-insights/?days=56&threshold=63&date=2024-02-29&class_section_id=class-a');
  }
  assert.equal(nativeInstitutionInsightPath('school', `${overview}&insight_days=14&insight_threshold=1`), '/api/v1/schools/school/principal-insights/?days=14&threshold=1');
  assert.equal(nativeInstitutionInsightPath('school', `${overview}&class=class-a&class_id=class-a`), '/api/v1/schools/school/principal-insights/?days=28&threshold=50&class_section_id=class-a');
  for (const invalid of ['insight_days=90&insight_threshold=0', 'insight_days=word&insight_threshold=50.5', 'insight_days=&insight_threshold=100']) assert.equal(nativeInstitutionInsightPath('school', `${overview}&${invalid}`), '/api/v1/schools/school/principal-insights/?days=28&threshold=50');
  for (const date of ['2026-02-29', '2026-02-30', '2026-2-01', 'not-a-date', '']) assert.equal(nativeInstitutionInsightPath('school', `${overview}&date=${date}`), null, date);
});

test('untrusted routes, mixed contexts and repeated selectors fail closed instead of choosing another report', () => {
  for (const href of ['https://outside.example/areas/insights', '//outside.example/areas/insights', '/areas/insights/../insights', '/areas/insights/attendance?scope=institution', '/areas/insights/review/a%2Fb?scope=institution', '/areas/insights/finance/learner-a?scope=institution', '/areas/insights?scope=assigned', '/areas/insights?scope=', `${overview}&student_id=learner-a`, '/areas/insights/review/learner-a?scope=institution&student_id=learner-a', `${overview}&scope=institution`, `${overview}&date=2026-10-28&date=2026-10-28`, `${overview}&insight_days=14&insight_days=28`, `${overview}&insight_threshold=50&insight_threshold=60`, `${overview}&class=class-a&class=class-a`, `${overview}&class=class-a&class_id=class-b`, `${overview}&insight_page=1&insight_page=2`]) assert.equal(nativeInstitutionInsightPath('school', href), null, href);
  assert.equal(nativeInstitutionInsightPath('', overview), null);
});

test('filter links keep the exact nested review learner and topic while applying query changes', () => {
  const source = '/areas/insights/review/learner%20A/?scope=institution&date=2026-10-28&class=class-a&insight_page=2&via=attendance#principal-deadlines';
  const result = nativeInstitutionInsightHref(source, { insight_days: '56', insight_page: null, date: null });
  assert.equal(result, '/areas/insights/review/learner%20A?scope=institution&class=class-a&via=attendance&insight_days=56#principal-deadlines');
  assert.equal(nativeInstitutionInsightHref('/areas/insights/finance', { class: 'class-a', scope: 'institution' }), '/areas/insights/finance?class=class-a&scope=institution');
  for (const sourceHref of ['https://outside.example/areas/insights', '/areas/insights?scope=institution&scope=assigned', '/areas/insights/not-supported']) assert.throws(() => nativeInstitutionInsightHref(sourceHref, {}));
  assert.throws(() => nativeInstitutionInsightHref(overview, { scope: 'assigned' }));
  assert.throws(() => nativeInstitutionInsightHref(overview, { student_id: 'learner-a' }));
});

test('response identity confirms institution, exact class, period, threshold and selected-world dates', () => {
  const value = response();
  assert.equal(nativeInstitutionInsightsMatches(value, 'school', overview), true);
  assert.equal(nativeInstitutionInsightsMatches(value, 'school', `${overview}&date=2026-12-31`), true, 'the server clamps a future date to its own operational date');
  assert.equal(nativeInstitutionInsightsMatches(value, 'school', `${overview}&date=2026-10-20`), false, 'a retained earlier review must not display the default current report');
  const selected = { ...value, class_section_id: 'class-a' };
  assert.equal(nativeInstitutionInsightsMatches(selected, 'school', `${overview}&class_id=class-a`), true);
  for (const bad of [{ ...value, school_id: 'other' }, { ...value, class_section_id: 'class-a' }, { ...value, threshold: 60 }, { ...value, period: { ...value.period, days: 56 } }, { ...value, period: { ...value.period, start: '2026-10-02' } }, { ...value, operational_date: '2026-10-29' }, { ...value, generated_at: 'invalid' }, { ...value, timezone: 'Invalid/Zone' }]) assert.equal(nativeInstitutionInsightsMatches(bad, 'school', overview), false);
  assert.equal(nativeInstitutionInsightsMatches({ ...selected, classes: [] }, 'school', `${overview}&class=class-a`), false);
});

test('nested learner review accepts capped-list absence but never a mismatched focused learner', () => {
  const value = response(), href = '/areas/insights/review/learner-b?scope=institution';
  assert.equal(nativeInstitutionInsightsMatches(value, 'school', href), true, 'missing requested learner is an honest UI missing state');
  assert.equal(nativeInstitutionInsightsMatches({ ...value, engagement: { ...value.engagement, focused_student: learner('learner-b') } }, 'school', href), true);
  assert.equal(nativeInstitutionInsightsMatches({ ...value, engagement: { ...value.engagement, focused_student: learner('learner-a') } }, 'school', href), false);
  assert.equal(nativeInstitutionInsightsMatches({ ...value, engagement: { ...value.engagement, focused_student: learner('learner-b') } }, 'school', overview), false, 'an old focused row must not leak into institution overview');
});

test('basic wire array and row validation rejects malformed data before native lists render it', () => {
  const value = response();
  const bad = [{ ...value, classes: [null] }, { ...value, attendance: { ...value.attendance, daily: {} } }, { ...value, attendance: { ...value.attendance, classes: [null] } }, { ...value, engagement: { ...value.engagement, students: [{ id: 'learner-a' }] } }, { ...value, followups: { ...value.followups, details: [{ ...value.followups.details[0], class_id: null }] } }, { ...value, learning: [{ ...value.learning[0], assessed: NaN }] }, { ...value, schedule: null }, { ...value, deadlines: [false] }, { ...value, fees: [{ ...value.fees[0], balance_paise: '6000' }] }];
  for (const malformed of bad) assert.equal(nativeInstitutionInsightsMatches(malformed, 'school', overview), false);
  assert.equal(nativeInstitutionInsightsMatches({ ...value, engagement: { total: 0, combined: 0, without_followup: 0, students: [], without_followup_students: [] }, learning: [], schedule: [], deadlines: [], fees: [] }, 'school', overview), true);
});

test('bounded client pagination clamps stale pages and handles empty and invalid page inputs', () => {
  const items = Array.from({ length: 19 }, (_, index) => index + 1);
  assert.deepEqual(nativeInstitutionInsightPage(items, '3'), { rows: [17, 18, 19], page: 3, pageSize: 8, total: 19, totalPages: 3 });
  assert.deepEqual(nativeInstitutionInsightPage(items, 900).rows, [17, 18, 19]);
  for (const invalid of [undefined, null, 'word', '2.5', '-1', NaN, Infinity, 0, -5]) assert.equal(nativeInstitutionInsightPage(items, invalid).page, 1);
  assert.equal(nativeInstitutionInsightPage(items, 2, 5).rows[0], 6);
  assert.equal(nativeInstitutionInsightPage(items, 2, 0).pageSize, 8);
  assert.deepEqual(nativeInstitutionInsightPage([], 20), { rows: [], page: 1, pageSize: 8, total: 0, totalPages: 1 });
  assert.equal(items.length, 19, 'pagination preserves the owning read array');
});
