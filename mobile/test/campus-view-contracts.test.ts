import assert from 'node:assert/strict';
import test from 'node:test';
import { activityTruthDimension, normalizeCampusView, type RawAssertion, type RawCampusViewResponse } from '../../packages/contracts/src/campus-view-normalize';
import * as records from '../../packages/contracts/src/campus-scene-records';
import * as capacity from '../../packages/contracts/src/campus-room-capacity';


import type { CampusViewOverlay, CampusViewResponse } from '../../packages/contracts/src/campus-view';

const assertion = (changes: Partial<RawAssertion> = {}): RawAssertion => ({
  assertion_id: 'assertion', dimension: 'expected', context: null,
  valid_from: '2026-10-29T09:00:00Z', valid_until: '2026-10-29T11:00:00Z', observed_at: null,
  source: { label: 'Published schedule', domain: 'timetable', record_id: 'schedule' },
  freshness: { status: 'current_at_as_of', expires_at: null }, spatial_claim: 'expected_context_only', ...changes,
});
const raw = (): RawCampusViewResponse => ({
  schema_version: 1, school: { id: 'school', name: 'School' },
  campuses: [{ id: 'campus', name: 'Campus', code: 'MAIN', is_primary: true }], selected_campus_id: 'campus',
  generated_at: '2026-10-29T10:00:00Z', as_of: '2026-10-29T10:00:00Z', plan: null, operations: null,
  spaces: [{ id: 'room', campus_id: 'campus', parent_space_id: null, name: 'Learning room', code: 'R1', kind: 'classroom', capacity: 40,
    floor_id: null, floor_label: null, state_dimension: 'expected', expected_activity: 'Fallback activity',
    assertions: { expected: [], observed: [], accepted: [] } }], activity: [], signals: [],
});


test('raw normalization retains assertion provenance, bounded truth and exact owning source routes', () => {
  const source = raw();
  source.spaces[0].assertions.expected.push(assertion({ context: { subject_name: '  Robotics  ', class_label: ' Year 8 ', teacher_label: ' Teacher ', period_label: ' P2 ', expected_count: 12, occurrence_id: ' occurrence ' } }));
  source.spaces[0].assertions.observed.push(assertion({ assertion_id: 'capture', dimension: 'observed', context: { assessment_id: 'assessment/a' }, source: { label: 'Assessment office', domain: 'assessments', record_id: 'assessment-record' }, freshness: { status: 'point_in_time', expires_at: '2026-10-29T10:30:00Z' }, spatial_claim: 'point_observation_only' }));
  source.spaces[0].assertions.accepted.push(assertion({ assertion_id: 'accepted', dimension: 'accepted', target_path: '/exact/owner', source: { label: 'Gate', domain: 'gate', target_path: '/secondary/owner' }, spatial_claim: 'bounded_space_presence' }));
  const original = structuredClone(source), result = normalizeCampusView(source), room = result.spaces[0];
  assert.deepEqual(source, original);
  assert.equal(room.floor_id, ''); assert.equal(room.floor_label, ''); assert.deepEqual(room.expected_now, []); assert.equal(room.gate_activity_today, null); assert.equal(room.day_activity_count, 0);
  assert.deepEqual(room.assertions.expected[0], { id: 'assertion', dimension: 'expected', label: 'Robotics', detail: 'Year 8 · Teacher · P2', source_label: 'Published schedule', valid_from: '2026-10-29T09:00:00Z', valid_until: '2026-10-29T11:00:00Z', observed_at: null, expires_at: null, freshness: 'not_applicable', spatial_claim: 'expected_context_only', count: 12, target_path: '/areas/timetable/planning', source_domain: 'timetable', source_record_id: 'schedule', occurrence_id: 'occurrence' });
  assert.equal(room.assertions.observed[0].freshness, 'historical');
  assert.equal(room.assertions.observed[0].target_path, '/areas/assessments/manage?assessment=assessment%2Fa');
  assert.equal(room.assertions.accepted[0].target_path, '/exact/owner');
  assert.equal(room.assertions.accepted[0].freshness, 'fresh');
});

test('normalization keeps pending protocol activity unknown and point evidence distinct from accepted truth', () => {
  const source = raw();
  source.day_activity = [{ id: 'scheduled', occurred_at: source.as_of, title: 'Scheduled', detail: 'Expected only', state_dimension: 'expected', source_label: 'Schedule' }];
  source.activity = [
    { id: 'attendance', occurred_at: source.as_of, kind: 'attendance', action: 'register.capture_pending', subject_label: null, item_count: 2, state: 'pending', actor_label: 'Teacher', source: { label: 'Attendance' } },
    { id: 'assessment', occurred_at: source.as_of, kind: 'examination', action: 'assessment.review', subject_label: 'Exam review', item_count: 0, state: 'review_required', actor_label: 'Office', source: { label: 'Assessments' } },
    { id: 'accepted', occurred_at: source.as_of, kind: 'setup', action: 'campus.updated', subject_label: null, item_count: 1, state: 'accepted', actor_label: 'Office', source: { label: 'Setup' } },
  ];
  source.signals = [{ id: 'cross-check', severity: 'review', person_label: 'Learner', class_label: 'Year 8', activity_label: 'Gate cross-check', gate_observed_at: ' 2026-10-29T09:59:00Z ', owner: 'attendance' }];
  const result = normalizeCampusView(source);
  assert.deepEqual(result.activity.map(item => item.state_dimension), ['expected', 'observed', 'unknown', 'accepted']);
  assert.equal(result.activity[1].title, 'register · capture pending');
  assert.equal(result.activity[1].detail, 'Teacher · 2 records · pending');
  assert.equal(result.activity[2].target_path, '/areas/assessments/manage');
  assert.deepEqual(result.signals[0], { id: 'cross-check', severity: 'review', title: 'Learner needs a cross-check', detail: 'Year 8 · Gate cross-check', occurred_at: '2026-10-29T09:59:00Z', target_path: '/areas/attendance/coordination' });
  assert.equal(activityTruthDimension('setup', 'pending'), 'unknown');
  assert.equal(activityTruthDimension('attendance', 'pending'), 'observed');
});

test('neutral evidence records preserve half-open source windows, point history and unknown space state', () => {
  const source = raw();
  source.spaces[0].assertions.expected = [assertion({ context: { title: 'Expected lesson', expected_count: 12 } })];
  source.spaces[0].assertions.observed = [assertion({ assertion_id: 'door', dimension: 'observed', source: { label: 'Door capture', domain: 'gate' }, spatial_claim: 'point_observation_only' })];
  const data = normalizeCampusView(source), current = records.campusSceneRecords(data, 'campus');
  assert.deepEqual(current.map(item => [item.dimension, item.temporal]), [['expected', 'current'], ['observed', 'historical']]);
  assert.equal(current[0].expectedCount, 12);
  data.as_of = '2026-10-29T11:00:00Z'; data.spaces[0].state_dimension = 'unknown';
  assert.deepEqual(records.campusSceneRecords(data, 'campus').map(item => [item.dimension, item.temporal]), [['observed', 'historical'], ['unknown', 'unknown']]);
  assert.deepEqual(records.campusSceneRecords(data, 'other-campus'), []);
  assert.equal(records.activeSpaceAssertion(data.spaces[0])?.id, 'assertion');
});

test('activity trail prioritizes signals and exact IDs without merging same-name assignments', () => {
  const data = normalizeCampusView(raw());
  const item = (id: string, state: 'in_progress' | 'upcoming', occurred_at: string): CampusViewResponse['activity'][number] => ({ id, state, occurred_at, title: 'Same label', detail: 'Source', source_label: 'Schedule', state_dimension: 'expected' });
  data.activity = [item('current', 'in_progress', data.as_of), item('later', 'upcoming', '2026-10-29T12:00:00Z'), item('next', 'upcoming', '2026-10-29T11:00:00Z')];
  data.signals = [{ id: 'review', severity: 'review', title: 'Check source' }];
  const overlay: CampusViewOverlay = { status: 'running', badge_label: 'Development', zones: [], activity: [{ ...data.activity[0], title: 'Old overlay copy' }] };
  const trail = records.campusActivityTrail(data, overlay);
  assert.deepEqual(trail.map(value => value.id), ['signal:review', 'current', 'next', 'later']);
  assert.equal(trail[1].title, 'Same label');
  assert.equal(records.campusDateFormatter('bad/timezone').format(new Date(data.as_of)), records.campusDateFormatter('UTC').format(new Date(data.as_of)));
});

test('capacity planning stays representative and keeps missing demand distinct from zero', () => {
  assert.equal(capacity.roomCapacityPresentation('unknown', null), null);
  assert.match(capacity.roomCapacityPresentation('room', 40)!.compactLabel, /current use unknown/);
  assert.equal(capacity.roomCapacityPresentation('room', 40, 0)!.compactLabel, '0 expected · 40 seats');
  const dense = capacity.roomCapacityPresentation('hall', 250, 300)!;
  assert.equal(dense.seats.length, 60); assert.equal(dense.overflowCount, 50); assert.equal(dense.seats.filter(seat => seat.state === 'planned').length, 60);
  assert.match(dense.accessibleSummary, /plan, not physical occupancy/);
  assert.equal(capacity.plannedHeadcount([null, 20], 0), 0);
  assert.equal(capacity.plannedHeadcount([undefined, null]), null);
  assert.equal(capacity.supportsSeatPattern(' Classroom '), true); assert.equal(capacity.supportsSeatPattern('gate'), false);
});
