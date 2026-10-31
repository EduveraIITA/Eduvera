import assert from 'node:assert/strict';
import test from 'node:test';
import { campusActivityEvidence, campusKpiResponse, campusKpiSeriesSegments, campusKpiValue, campusPublishedSnapshot, campusPublishedSourceHref, type CampusPublishedScope } from '../src/lib/campus-published-operations';
import type { RawCampusViewResponse } from '../../packages/contracts/src/campus-view-normalize';
import type { CampusKpiResponse, CampusKpiSeriesPoint } from '../../packages/contracts/src/wire/features/campus-view/kpiApi';

const from = '2026-10-29T09:00:00Z', at = '2026-10-29T10:00:00Z', until = '2026-10-29T11:00:00Z';
const scope: CampusPublishedScope = { schoolId: 'school', campusId: 'campus', environment: { mode: 'live' } };
const snapshot = (): RawCampusViewResponse => ({
  schema_version: 1, school: { id: 'school', name: 'School', timezone: 'Asia/Kolkata' }, selected_campus_id: 'campus', generated_at: at, as_of: at, plan: null, operations: null,
  campuses: [{ id: 'campus', name: 'Campus', code: 'MAIN', is_primary: true }],
  motion: { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: at, environment: { kind: 'live', namespace_id: 'live:school' },
    subjects: [{ subject_key: 'group', kind: 'group', claims: [{ id: 'planned', space_id: 'room', starts_at: from, ends_at: until, expected_count: 12, spatial_claim: 'expected_context_only', source: { domain: 'timetable', record_id: 'schedule', revision: 2 } }] }],
    points: [{ id: 'gate', space_id: 'gate', observed_at: at, dimension: 'accepted', spatial_claim: 'point_observation_only', source: { domain: 'gate', record_id: 'entry', revision: null } }],
    limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: ['Schedule intent and point evidence only.'] },
  spaces: [{ id: 'room', campus_id: 'campus', parent_space_id: null, name: 'Learning room', code: 'R1', kind: 'classroom', capacity: 40, floor_id: null, floor_label: null, state_dimension: 'expected',
    expected_now: [{ id: 'occurrence', occurrence_id: 'occurrence', space_id: 'room', title: 'Robotics', slot_type: 'class', class_label: 'Year 8', subject_label: 'Robotics', teacher: { id: 'teacher', label: 'Teacher' }, expected_count: 12, starts_at: from, ends_at: until, state: 'in_progress', dimension: 'expected', spatial_claim: 'expected_context_only', source: { domain: 'timetable', record_id: 'schedule', revision: 2, label: 'Published schedule' } }],
    assertions: { expected: [{ assertion_id: 'assertion', dimension: 'expected', context: { title: 'Robotics', expected_count: 12 }, valid_from: from, valid_until: until, observed_at: null,
      source: { domain: 'timetable', label: 'Published schedule', record_id: 'schedule' }, freshness: { status: 'current_at_as_of', expires_at: null }, spatial_claim: 'expected_context_only' }], observed: [], accepted: [] } }],
  activity: [{ id: 'capture', occurred_at: at, kind: 'attendance', action: 'register.capture', subject_label: null, item_count: 1, state: 'pending', actor_label: 'Teacher', source: { label: 'Attendance' } }],
  day_activity: [{ id: 'day', occurred_at: from, ends_at: until, title: 'Robotics', detail: 'Expected only', state_dimension: 'expected', state: 'in_progress', source_label: 'Published schedule', space_id: 'room', spatial_claim: 'expected_context_only' }],
  signals: [{ id: 'signal', severity: 'review', class_label: 'Year 8', activity_label: 'Cross-check', owner: 'attendance' }],
});

const point = (value: number | null, index = 0): CampusKpiSeriesPoint => ({ bucket_start: `2026-10-${String(27 + index).padStart(2, '0')}T00:00:00Z`, bucket_end: `2026-10-${String(28 + index).padStart(2, '0')}T00:00:00Z`, value, numerator: value, denominator: 100, unknown_count: value === null ? 1 : 0 });
const kpi = (): CampusKpiResponse => ({
  schema_version: 1, page: 'overview', range: 'today', generated_at: at, period: { from, to: at, timezone: 'Asia/Kolkata' }, bucket: { kind: 'hour', label: 'Hourly' }, scope: { campus_id: 'campus', campus_label: 'Campus' },
  metrics: [{ key: 'teaching.coverage', label: 'Recorded coverage', description: 'Source coverage', unit: 'percent', value: 80, numerator: 8, denominator: 10, unknown_count: 2, availability: 'partial', scope: 'selected_campus', evidence_dimensions: ['expected', 'accepted'], source_label: 'Registers', source_max_at: at, unavailable_reason: null, value_context: 'selected_period', target_path: '/areas/attendance/coordination', series: [point(80), point(null, 1)] }],
  overview: { headline_keys: ['teaching.coverage'], evidence_state: 'partial', headlines: [{ key: 'teaching.coverage', label: 'Recorded coverage', value: 80, unit: 'percent', availability: 'partial', value_context: 'current_at_as_of', secondary: { key: 'unknown', label: 'Unknown', value: null, availability: 'unavailable' } }],
    composition: { label: 'Evidence mix', unit: 'records', slices: [{ key: 'accepted', label: 'Accepted records', value: 8, tone: 'accepted' }, { key: 'unknown', label: 'Unknown', value: 2, tone: 'unknown' }] },
    bottlenecks: [{ id: 'review', label: 'Registers awaiting review', detail: 'Source records need review', count: 2, severity: 'review', scope: 'selected_campus', evidence_dimension: 'observed', source_label: 'Attendance', target_path: '/areas/attendance/coordination' }] },
});

test('accepts and normalizes exact Live snapshot without promoting planned or pending evidence', () => {
  const raw = snapshot(), original = structuredClone(raw), value = campusPublishedSnapshot(raw, scope);
  assert.ok(value); assert.deepEqual(raw, original);
  assert.equal(value.spaces[0].floor_id, ''); assert.equal(value.spaces[0].assertions.expected[0].freshness, 'not_applicable');
  assert.equal(value.spaces[0].assertions.expected[0].target_path, '/areas/timetable/planning');
  assert.deepEqual(value.activity.map(item => item.state_dimension), ['expected', 'observed']);
  assert.equal(value.motion!.points[0].spatial_claim, 'point_observation_only');
});

test('Simulation requires the exact selected namespace and institution and never borrows Live motion', () => {
  const raw = snapshot(), simulation: CampusPublishedScope = { ...scope, environment: { mode: 'simulation', namespace_id: 'simulation:run-one', institution_id: 'school' } };
  assert.equal(campusPublishedSnapshot(raw, simulation), null);
  raw.motion!.environment = { kind: 'simulation', namespace_id: 'simulation:run-one' };
  assert.ok(campusPublishedSnapshot(raw, simulation));
  assert.equal(campusPublishedSnapshot(raw, { ...simulation, environment: { ...simulation.environment, namespace_id: 'simulation:run-two' } }), null);
  assert.equal(campusPublishedSnapshot(raw, { ...simulation, environment: { ...simulation.environment, institution_id: 'other-school' } }), null);
  assert.equal(campusPublishedSnapshot(raw, { ...simulation, environment: { mode: 'simulation' } }), null);
  assert.equal(campusPublishedSnapshot(raw, scope), null);
});

test('rejects foreign school, selected campus, current directory item and Live namespace', () => {
  const mutations: Array<(value: any) => void> = [
    value => value.schema_version = 2, value => value.school.id = 'other', value => value.selected_campus_id = 'other',
    value => value.campuses = [], value => value.campuses.push({ ...value.campuses[0] }), value => value.spaces[0].campus_id = 'other',
    value => value.motion.school_id = 'other', value => value.motion.campus_id = 'other', value => value.motion.environment.namespace_id = null,
    value => value.motion.environment.namespace_id = 'live:other', value => value.motion.environment.kind = 'simulation', value => delete value.motion,
    value => value.motion.as_of = until,
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); assert.equal(campusPublishedSnapshot(value, scope), null); }
});

test('rejects malformed or unbounded motion claims without treating them as tracked positions', () => {
  const mutations: Array<(value: any) => void> = [
    value => value.motion.subjects[0].claims[0].source = null, value => value.motion.subjects[0].claims[0].spatial_claim = 'bounded_space_presence',
    value => value.motion.subjects[0].claims[0].ends_at = from, value => value.motion.subjects[0].kind = 'person',
    value => value.motion.subjects.push({ ...value.motion.subjects[0] }), value => value.motion.points[0].spatial_claim = 'expected_context_only',
    value => value.motion.points[0].source.revision = -1, value => value.motion.limits.claims = 999, value => value.motion.subjects = Array(129).fill(value.motion.subjects[0]),
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); assert.equal(campusPublishedSnapshot(value, scope), null); }
});

test('rejects malformed raw nested evidence before normalization can render or crash', () => {
  const mutations: Array<(value: any) => void> = [
    value => value.spaces[0].assertions = null, value => value.spaces[0].assertions.expected[0].source.domain = null,
    value => value.spaces[0].assertions.expected[0].freshness = null, value => value.spaces[0].assertions.expected[0].freshness.status = 'accepted',
    value => value.spaces[0].assertions.expected[0].dimension = 'accepted', value => value.spaces[0].assertions.expected[0].spatial_claim = 'point_observation_only',
    value => value.spaces[0].assertions.expected[0].context.expected_count = Infinity,
    value => value.spaces[0].expected_now[0].teacher = [], value => value.spaces[0].expected_now[0].source.revision = '2',
    value => value.spaces[0].expected_now[0].space_id = 'another-room', value => value.activity[0].source = null,
    value => value.activity[0].state = {}, value => value.day_activity = {}, value => value.day_activity[0].occurred_at = 'invalid',
    value => { value.day_activity[0].state_dimension = 'unknown'; value.day_activity[0].spatial_claim = 'point_observation_only'; },
    value => value.day_activity[0].state_dimension = 'accepted',
    value => value.signals[0].class_label = {}, value => value.operations = { gate_movements: null },
    value => value.plan = { id: 'plan', version: '1', source_kind: 'mapped', label: 'Plan', view_box: {}, elements: [] },
    value => value.spaces = Array(10001).fill(value.spaces[0]),
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); assert.doesNotThrow(() => assert.equal(campusPublishedSnapshot(value, scope), null)); }
});

test('source links are strict canonical internal journeys and reject origin, traversal and control forms', () => {
  for (const path of ['/areas/assessments/manage?assessment=assessment%2Fa', '/work/assignment?return_to=%2Fmore', '/more/virtual-campus', '/today', '/today?date=2026-10-29']) assert.equal(campusPublishedSourceHref(path), path);
  for (const path of [null, {}, '', 'https://example.com/areas/attendance', '//evil.test/areas', '/other/area', '/areasx', '/areas//attendance', '/areas/../more', '/areas/%2e%2e/more', '/areas/%2fadmin', '/more\\evil', '/more?next=https://evil.test', '/more?next=https%3A%2F%2Fevil.test', '/more?label=%0A', '/more?label=%5Cevil', '/more?bad=%', '/more\u0000', ' /more']) assert.equal(campusPublishedSourceHref(path), null);
});

test('accepts exact scoped KPI data with partial evidence and optional overview', () => {
  const value = kpi(); assert.equal(campusKpiResponse(value, 'overview', 'today', 'campus'), value);
  const history = kpi(); history.page = 'teaching'; history.range = '1y'; delete history.overview;
  assert.equal(campusKpiResponse(history, 'teaching', '1y', 'campus'), history);
  assert.equal(campusKpiResponse(value, 'movement', 'today', 'campus'), null);
  assert.equal(campusKpiResponse(value, 'overview', '7d', 'campus'), null);
  assert.equal(campusKpiResponse(value, 'overview', 'today', 'other'), null);
  assert.equal(campusKpiResponse(value, 'overview', 'today', null), null);
  const missing = kpi(); missing.metrics[0] = { ...missing.metrics[0], value: null, numerator: 0, denominator: 0, availability: 'unavailable', series: [{ ...point(null), numerator: 0, denominator: 0 }] };
  const retained = campusKpiResponse(missing, 'overview', 'today', 'campus');
  assert.ok(retained); assert.equal(retained.metrics[0].value, null); assert.equal(retained.metrics[0].denominator, 0);
  assert.equal(retained.metrics[0].series[0].value, null); assert.deepEqual(campusKpiSeriesSegments(retained.metrics[0].series).segments, []);
  const overCapacity = kpi(); overCapacity.metrics[0].value = 125;
  assert.equal(campusKpiResponse(overCapacity, 'overview', 'today', 'campus')!.metrics[0].value, 125);
});

test('KPI validation rejects malformed period, bucket, metric, source and overview fields', () => {
  const mutations: Array<(value: any) => void> = [
    value => value.schema_version = 2, value => value.period.timezone = 'invalid/timezone', value => value.period.to = 'invalid',
    value => value.period.from = until, value => value.bucket.kind = 'year', value => value.metrics = {},
    value => value.metrics[0].value = NaN, value => value.metrics[0].unknown_count = -1, value => value.metrics[0].evidence_dimensions = ['unknown'],
    value => value.metrics[0].source_label = {}, value => value.metrics[0].source_max_at = 'invalid', value => value.metrics[0].series = null,
    value => value.metrics[0].series[0].bucket_end = value.metrics[0].series[0].bucket_start, value => value.metrics[0].series[0].value = Infinity,
    value => value.metrics[0].series[0].denominator = -1, value => value.metrics[0].series = Array(801).fill(point(1)),
    value => value.metrics.push(value.metrics[0]), value => value.overview = null,
    value => value.overview.headlines[0].secondary.availability = 'complete', value => value.overview.composition.slices[0].value = -1,
    value => value.overview.bottlenecks[0].evidence_dimension = 'tracked', value => value.overview.headline_keys = {},
  ];
  for (const mutate of mutations) { const value = kpi(); mutate(value); assert.doesNotThrow(() => assert.equal(campusKpiResponse(value, 'overview', 'today', 'campus'), null)); }
});

test('formats null as missing evidence while preserving zero, percentage and minute units', () => {
  assert.equal(campusKpiValue(null, 'count'), 'Not enough evidence');
  assert.equal(campusKpiValue(NaN, 'count'), 'Not enough evidence');
  assert.equal(campusKpiValue(0, 'count'), '0'); assert.equal(campusKpiValue(82.55, 'percent'), '82.6%');
  assert.equal(campusKpiValue(12.5, 'minutes'), '12.5 min'); assert.equal(campusKpiValue(12000, 'people'), '12,000');
});

test('series breaks missing evidence into distinct segments and retains original interval positions', () => {
  const plot = campusKpiSeriesSegments([point(10), point(null), point(20), point(0), point(null), point(30)], 300, 90);
  assert.equal(plot.max, 30);
  assert.deepEqual(plot.segments.map(segment => segment.map(item => item.index)), [[0], [2, 3], [5]]);
  assert.deepEqual(plot.segments.flat().map(item => item.x), [0, 120, 180, 300]);
  assert.equal(plot.segments[1][1].value, 0); assert.equal(plot.segments[1][1].y, 90);
  assert.equal(plot.segments[2][0].y, 0);
});

test('all-null series stay empty; finite clamps never create points for null or nonfinite evidence', () => {
  assert.deepEqual(campusKpiSeriesSegments([point(null), point(null)]), { segments: [], max: 1 });
  assert.deepEqual(campusKpiSeriesSegments([], 300, 96, 'percent'), { segments: [], max: 100 });
  const plot = campusKpiSeriesSegments([point(-10), point(Infinity), point(150)], NaN, -10, 'percent');
  assert.deepEqual(plot.segments.map(segment => segment.map(item => item.index)), [[0], [2]]);
  assert.equal(plot.max, 100); assert.equal(plot.segments[0][0].y, 96); assert.equal(plot.segments[1][0].y, 0);
  assert.ok(plot.segments.flat().every(item => Number.isFinite(item.x) && Number.isFinite(item.y)));
  assert.equal(campusKpiSeriesSegments([point(5)], 100, 40).segments[0][0].x, 50);
});

test('activity labels retain expected plans and accepted point events as distinct evidence', () => {
  const item = { id: 'item', occurred_at: at, title: 'Item', detail: 'Source', source_label: 'Source', state_dimension: 'expected' as const };
  assert.equal(campusActivityEvidence({ ...item, state: 'in_progress' }), 'In progress · Expected plan');
  assert.equal(campusActivityEvidence({ ...item, state: 'upcoming' }), 'Later today · Expected plan');
  assert.equal(campusActivityEvidence({ ...item, state: 'ended' }), 'Earlier today · Expected plan');
  assert.equal(campusActivityEvidence({ ...item, state_dimension: 'accepted', spatial_claim: 'point_observation_only' }), 'Accepted point event');
  assert.equal(campusActivityEvidence({ ...item, state_dimension: 'observed', spatial_claim: 'point_observation_only' }), 'Observed point event');
  assert.equal(campusActivityEvidence({ ...item, state_dimension: 'accepted' }), 'Accepted record');
  assert.equal(campusActivityEvidence({ ...item, state_dimension: 'unknown' }), 'Recorded state needs review');
  assert.equal(campusActivityEvidence({ ...item, state_dimension: 'unknown', spatial_claim: 'point_observation_only' }), 'Recorded state needs review');
});
