import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalyticsOverview } from '../../packages/contracts/src/wire/features/analytics/api';
import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { nativeInsightsAnalyticsPath, nativeInsightsContextHref, nativeInsightsFilters, nativeInsightsHref, nativeInsightsOptions, nativeInsightsResponseMatches, nativeInsightsRoute, resolveNativeInsightsAccess } from '../src/lib/native-insights';

const staff = (kind: 'institution' | 'assigned'): WorkspaceAreaSurface => ({ key: kind, label: kind, href: `/areas/insights?scope=${kind}`, capabilities: [], scopes: [] });
const learner = (kind: 'self' | 'dependent', studentId: string): WorkspaceAreaSurface => ({ key: `overview:${kind}:${studentId}`, label: studentId, href: `/areas/insights?scope=${kind}&student_id=${studentId}`, capabilities: [], scopes: [{ kind, id: studentId, label: `Learner ${studentId}` }] });
const manifest = (surfaces: WorkspaceAreaSurface[] = [staff('institution'), staff('assigned'), learner('self', 'me'), learner('dependent', 'child-a'), learner('dependent', 'child-b')]): WorkspaceManifest => ({ context: { actor_user_id: 'actor', institution_id: 'school', environment: { kind: 'live' } }, areas: [{ key: 'insights', label: 'Insights', href: '/areas/insights', capabilities: [], scopes: [], surfaces }] }) as unknown as WorkspaceManifest;
const source = manifest();
const access = (scope: string, studentId?: string) => {
  const result = resolveNativeInsightsAccess(source, `/areas/insights?${new URLSearchParams({ scope, ...(studentId ? { student_id: studentId } : {}) })}`);
  assert.ok(result); return result;
};
const institution = access('institution'), assigned = access('assigned'), dependent = access('dependent', 'child-b');
const response = (portal: AnalyticsOverview['portal'] = 'principal'): AnalyticsOverview => ({ portal, generated_at: '2026-10-28T09:00:00Z', student: null, selected_student: null,
  term: { id: 'term', name: 'Current term', starts_on: '2026-07-01', ends_on: '2026-12-31', attendance_threshold: 75 },
  range: { period: 'term', from: '2026-07-01', to: '2026-10-28', capped: false }, scope_label: 'All classes', classes: [{ id: 'class-a', name: 'Class A' }], selected_class_id: null,
  institution: null, registers: null, attendance: null, assessments: null });

test('institution and assigned links resolve to their own data reads instead of another chooser', () => {
  assert.equal(institution.audience, 'principal'); assert.equal(assigned.audience, 'teacher');
  assert.equal(nativeInsightsAnalyticsPath('school', institution, '/areas/insights?scope=institution'), '/api/v1/schools/school/analytics/principal/?period=term');
  assert.equal(nativeInsightsAnalyticsPath('school', assigned, '/areas/insights?scope=assigned'), '/api/v1/schools/school/analytics/teacher/?period=term');
  assert.equal(resolveNativeInsightsAccess(source, '/areas/insights')?.kind, 'institution');
  assert.equal(resolveNativeInsightsAccess(manifest([staff('assigned')]), '/areas/insights')?.kind, 'assigned');
  assert.equal(resolveNativeInsightsAccess(manifest([learner('dependent', 'child'), learner('self', 'me')]), '/areas/insights')?.kind, 'self');
});

test('explicit invalid, duplicate and mixed scope selectors never substitute another context', () => {
  for (const search of ['scope=missing', 'scope=', 'scope=institution&student_id=child-b', 'scope=assigned&student_id=', 'student_id=child-b', 'scope=self&student_id=child-b', 'scope=dependent&student_id=foreign', 'scope=dependent&student_id=', 'scope=institution&scope=assigned', 'scope=institution&scope=institution', 'scope=dependent&student_id=child-b&student_id=child-b']) {
    assert.equal(resolveNativeInsightsAccess(source, `/areas/insights?${search}`), null, search);
  }
  assert.equal(resolveNativeInsightsAccess(manifest([staff('assigned')]), '/areas/insights?scope=institution'), null);
  assert.equal(resolveNativeInsightsAccess(source, '/areas/insights-pretend?scope=institution'), null);
});

test('relationship access requires exact contribution key, declared scope and destination identity', () => {
  assert.equal(dependent.studentId, 'child-b'); assert.equal(dependent.audience, 'parent'); assert.equal(dependent.contextLabel, 'Learner child-b insights');
  assert.equal(nativeInsightsHref(dependent), '/areas/insights?scope=dependent&student_id=child-b');
  const selected = resolveNativeInsightsAccess(manifest([learner('dependent', 'child-b')]), '/areas/insights?scope=dependent');
  assert.equal(selected?.studentId, 'child-b');
  const wrongScope = { ...learner('dependent', 'child-b'), scopes: [{ kind: 'dependent' as const, id: 'child-a' }] };
  const wrongHref = { ...learner('dependent', 'child-b'), href: '/areas/insights?scope=dependent&student_id=child-a' };
  assert.equal(nativeInsightsOptions(manifest([wrongScope, wrongHref])).length, 0);
  assert.equal(nativeInsightsOptions(manifest([staff('institution'), staff('institution')])).length, 0);
});

test('query order and retained reporting filters preserve the selected work context', () => {
  const href = '/areas/insights/attendance?period=90&compare=class&class=class-a&scope=assigned';
  assert.equal(resolveNativeInsightsAccess(source, href)?.kind, 'assigned');
  assert.deepEqual(nativeInsightsFilters(href, assigned), { period: '90', classId: 'class-a', comparison: 'class' });
  assert.equal(nativeInsightsAnalyticsPath('school', assigned, href), '/api/v1/schools/school/analytics/teacher/?period=90&class_id=class-a');
  assert.equal(nativeInsightsAnalyticsPath('foreign', assigned, href), null);
  assert.equal(nativeInsightsAnalyticsPath('school', institution, href), null, 'a retained institution object cannot read an assigned URL');
  assert.equal(nativeInsightsAnalyticsPath('school', assigned, '/areas/insights?scope=assigned&scope=assigned'), null);
  assert.equal(nativeInsightsAnalyticsPath('school', assigned, '/areas/insights?scope=assigned&student_id=child-b'), null);
});

test('family requests carry exact learner and omit retained staff class filters', () => {
  assert.equal(nativeInsightsAnalyticsPath('school', dependent, '/areas/insights/attendance?scope=dependent&student_id=child-b&class=class-a&period=30'), '/api/v1/schools/school/analytics/parent/?period=30&student_id=child-b');
  assert.equal(nativeInsightsAnalyticsPath('school', access('self', 'me'), '/areas/insights?scope=self&student_id=me'), '/api/v1/schools/school/analytics/student/?period=term&student_id=me');
  assert.equal(nativeInsightsAnalyticsPath('school', dependent, '/areas/insights?scope=dependent&student_id=child-a'), null);
  assert.equal(nativeInsightsAnalyticsPath('school', dependent, '/areas/insights/progress?scope=dependent&student_id=child-b'), null);
});

test('ambiguous class and period filters fail closed while one old class alias is canonicalized', () => {
  for (const search of ['period=30&period=90', 'class=class-a&class=class-b', 'class=class-a&class_id=class-b', 'compare=class&compare=subject']) {
    assert.equal(nativeInsightsFilters(`/areas/insights?scope=assigned&${search}`, assigned), null, search);
  }
  assert.equal(nativeInsightsFilters('/areas/insights?scope=assigned&class=class-a&class_id=class-a', assigned)?.classId, 'class-a');
  assert.equal(nativeInsightsFilters('/areas/insights?scope=assigned&period=unknown', assigned)?.period, 'term');
  assert.equal(nativeInsightsHref(assigned, 'results', '/areas/insights?scope=institution&insight_class=class-a&period=90'), '/areas/insights/results?scope=assigned&period=90&class=class-a');
  assert.equal(nativeInsightsFilters('/areas/insights/institution?scope=institution&class=class-a', institution)?.classId, undefined);
});

test('canonical topic classification keeps institution review distinct from analytics and unsupported paths', () => {
  for (const topic of ['attendance', 'results', 'progress', 'institution', 'registers']) assert.equal(nativeInsightsRoute(`/areas/insights/${topic}`).kind, 'analytics');
  for (const topic of ['review', 'recording', 'followups', 'learning-review', 'operations', 'finance']) {
    assert.equal(nativeInsightsRoute(`/areas/insights/${topic}`).kind, 'institution-review');
    assert.equal(nativeInsightsAnalyticsPath('school', institution, `/areas/insights/${topic}?scope=institution`), null);
    assert.throws(() => nativeInsightsHref(assigned, topic as 'review'));
  }
  assert.deepEqual(nativeInsightsRoute('/areas/insights/review/child-b?scope=institution'), { kind: 'institution-review', topic: 'review', studentId: 'child-b' });
  for (const href of ['https://outside.example/areas/insights', '/areas/insights/not-a-topic', '/areas/insights/attendance/child-b', '/areas/insights/finance/child-b', '/areas/insights/review/a%2Fb']) assert.equal(nativeInsightsRoute(href).kind, 'invalid', href);
  assert.equal(nativeInsightsAnalyticsPath('school', assigned, '/areas/insights/registers?scope=assigned'), null);
});

test('context switches retain filters and clear exact old learner and institution-only topics', () => {
  const current = '/areas/insights/review/child-a?scope=institution&date=2026-10-28&insight_days=56&class=class-a&via=attendance';
  assert.equal(nativeInsightsContextHref(assigned, current), '/areas/insights?scope=assigned&class=class-a&date=2026-10-28&insight_days=56&via=attendance');
  assert.equal(nativeInsightsContextHref(dependent, '/areas/insights/attendance?scope=self&student_id=me&period=90&compare=class'), '/areas/insights/attendance?scope=dependent&student_id=child-b&period=90&compare=class');
  assert.equal(nativeInsightsContextHref(institution, current), '/areas/insights/review?scope=institution&class=class-a&date=2026-10-28&insight_days=56&via=attendance');
});

test('wire identity rejects another school, audience, learner, period or selected class', () => {
  const href = '/areas/insights?scope=institution', value = response();
  assert.equal(nativeInsightsResponseMatches(value, 'school', institution, href), true, 'the legacy API currently omits school_id');
  assert.equal(nativeInsightsResponseMatches({ ...value, school_id: 'school' }, 'school', institution, href), true);
  for (const bad of [{ ...value, school_id: 'other' }, { ...value, portal: 'teacher' }, { ...value, audience: 'teacher' }, { ...value, selected_student: { id: 'child-a', name: 'Child' } }, { ...value, range: { ...value.range, period: '90' } }, { ...value, selected_class_id: 'class-a' }, { ...value, generated_at: 'invalid' }]) assert.equal(nativeInsightsResponseMatches(bad, 'school', institution, href), false);
  const filteredHref = '/areas/insights?scope=assigned&class=class-a&period=30';
  const filtered = { ...response('teacher'), selected_class_id: 'class-a', range: { ...value.range, period: '30' } };
  assert.equal(nativeInsightsResponseMatches(filtered, 'school', assigned, filteredHref), true);
  assert.equal(nativeInsightsResponseMatches({ ...filtered, selected_class_id: 'class-b' }, 'school', assigned, filteredHref), false);
  assert.equal(nativeInsightsResponseMatches({ ...filtered, classes: [] }, 'school', assigned, filteredHref), false);
});

test('family wire must confirm exact learner and never includes institution-only aggregates', () => {
  const href = '/areas/insights?scope=dependent&student_id=child-b';
  const value = { ...response('parent'), student: { id: 'child-b' } };
  assert.equal(nativeInsightsResponseMatches(value, 'school', dependent, href), true);
  for (const bad of [{ ...value, student: null }, { ...value, student: { id: 'child-a' } }, { ...value, student: { id: 'child-b', school_id: 'foreign' } }, { ...value, selected_student: { id: 'child-a' } }, { ...value, institution: { classes: [] } }, { ...value, registers: { classes: [] } }]) assert.equal(nativeInsightsResponseMatches(bad, 'school', dependent, href), false);
});

function completeResponse(): AnalyticsOverview {
  const attendance = { present: 2, late: 1, half_day: 1, absent: 1, excused: 1, recorded: 6, denominator: 5, attended: 3.5, percentage: 70 };
  const assessment = { scored: 3, other: 1, average: 62.5, assessments: 2 };
  const registers = { expected: 5, submitted: 2, locked: 1, outstanding: 2, percentage: 60 };
  return { ...response(),
    attendance: { ...attendance,
      trend: [{ ...attendance, date: '2026-10-01', end: '2026-10-28' }],
      classes: [{ ...attendance, id: 'class-a', name: 'Class A' }],
      subjects: [{ id: 'subject-a', name: 'Subject A', held: 6, attended: 3.5, excused: 1, counted: 5, percentage: 70 }],
    },
    assessments: { overall: { ...assessment, distribution: [0, 0, 1, 1, 1] },
      subjects: [{ ...assessment, id: 'subject-a', name: 'Subject A' }],
      classes: [{ ...assessment, id: 'class-a', name: 'Class A' }], pipeline: [{ status: 'published', count: 2 }],
    },
    institution: { as_of: '2026-10-28', enrollment_as_of: '2026-10-28', students: 20, configured_classes: 2, populated_classes: 1, average_class_size: 20,
      teaching_staff: 3, non_teaching_staff: 2, students_per_teacher: 20 / 3, classes: [{ id: 'class-a', name: 'Class A', students: 20 }] },
    registers: { ...registers, unscheduled_classes: 0, classes: [{ ...registers, id: 'class-a', name: 'Class A', latest_unsubmitted: '2026-10-28' }] },
  };
}

test('complete analytics accepts fractional attendance and averages plus honest nullable ratios', () => {
  const value = completeResponse(), href = '/areas/insights?scope=institution';
  assert.equal(nativeInsightsResponseMatches(value, 'school', institution, href), true);
  value.attendance!.percentage = null;
  value.attendance!.trend[0]!.percentage = null;
  value.attendance!.classes[0]!.percentage = null;
  value.attendance!.subjects[0]!.percentage = null;
  value.assessments!.overall.average = null;
  value.assessments!.classes[0]!.average = null;
  value.assessments!.subjects[0]!.average = null;
  value.institution!.average_class_size = null;
  value.institution!.students_per_teacher = null;
  value.registers!.percentage = null;
  value.registers!.classes[0]!.percentage = null;
  value.registers!.classes[0]!.latest_unsubmitted = null;
  assert.equal(nativeInsightsResponseMatches(value, 'school', institution, href), true);
});

test('malformed analytics rows fail closed before native reducers, charts or date labels consume them', () => {
  const value = completeResponse(), href = '/areas/insights?scope=institution';
  const malformed = [
    { ...value, attendance: { ...value.attendance, trend: [null] } },
    { ...value, attendance: { ...value.attendance, classes: [null] } },
    { ...value, attendance: { ...value.attendance, subjects: [null] } },
    { ...value, attendance: { ...value.attendance, trend: [{ ...value.attendance!.trend[0], date: '2026-02-30' }] } },
    { ...value, attendance: { ...value.attendance, classes: [{ ...value.attendance!.classes[0], name: null }] } },
    { ...value, attendance: { ...value.attendance, subjects: [{ ...value.attendance!.subjects[0], counted: '5' }] } },
    { ...value, assessments: { ...value.assessments, pipeline: [null] } },
    { ...value, assessments: { ...value.assessments, pipeline: [{ status: null, count: 2 }] } },
    { ...value, assessments: { ...value.assessments, pipeline: [{ status: 'published', count: '2' }] } },
    { ...value, assessments: { ...value.assessments, subjects: [null] } },
    { ...value, assessments: { ...value.assessments, classes: [{ ...value.assessments!.classes[0], average: undefined }] } },
    { ...value, institution: { ...value.institution, classes: [null] } },
    { ...value, institution: { ...value.institution, classes: [{ ...value.institution!.classes[0], students: null }] } },
    { ...value, registers: { ...value.registers, classes: [null] } },
    { ...value, registers: { ...value.registers, classes: [{ ...value.registers!.classes[0], latest_unsubmitted: 'not-a-date' }] } },
  ];
  for (const bad of malformed) assert.equal(nativeInsightsResponseMatches(bad, 'school', institution, href), false);
});

test('nonnumeric, nonfinite or omitted analytics scalars cannot become confirmed metrics', () => {
  const value = completeResponse(), href = '/areas/insights?scope=institution';
  for (const badNumber of [undefined, null, '2', NaN, Infinity, -Infinity]) {
    const malformed = [
      { ...value, term: { ...value.term, attendance_threshold: badNumber } },
      { ...value, attendance: { ...value.attendance, attended: badNumber } },
      { ...value, attendance: { ...value.attendance, trend: [{ ...value.attendance!.trend[0], denominator: badNumber }] } },
      { ...value, assessments: { ...value.assessments, overall: { ...value.assessments!.overall, scored: badNumber } } },
      { ...value, assessments: { ...value.assessments, overall: { ...value.assessments!.overall, distribution: [0, 0, badNumber, 0, 0] } } },
      { ...value, institution: { ...value.institution, teaching_staff: badNumber } },
      { ...value, registers: { ...value.registers, submitted: badNumber } },
    ];
    for (const bad of malformed) assert.equal(nativeInsightsResponseMatches(bad, 'school', institution, href), false);
    if (badNumber !== null) {
      assert.equal(nativeInsightsResponseMatches({ ...value, assessments: { ...value.assessments, overall: { ...value.assessments!.overall, average: badNumber } } }, 'school', institution, href), false);
    }
  }
  for (const malformed of [
    { ...value, range: { ...value.range, capped: 'false' } },
    { ...value, term: { ...value.term, ends_on: '2026-02-30' } },
    { ...value, institution: { ...value.institution, as_of: 'invalid' } },
    { ...value, assessments: { ...value.assessments, overall: { ...value.assessments!.overall, distribution: [0, 0] } } },
    { ...value, attendance: undefined }, { ...value, assessments: undefined }, { ...value, institution: undefined }, { ...value, registers: undefined },
  ]) assert.equal(nativeInsightsResponseMatches(malformed, 'school', institution, href), false);
});
