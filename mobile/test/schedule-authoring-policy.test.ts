import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';
import { scheduleActivityInput, scheduleActivityRefreshPath, scheduleActivityRoot } from '../src/lib/schedule-planning-policy';
import { academicScheduleRead, academicScheduleRefreshPath, cleanSchedulePeriod, validateSchedulePeriods } from '../src/lib/schedule-academic-policy';
import { dayPlanOptions, dayPlanRead, dayPlanRefreshPath, cleanDayPeriod, validateDayPeriods } from '../src/lib/schedule-day-policy';
import type { ActivityCatalogue, ActivityPlanInput } from '../../packages/contracts/src/wire/features/activities/api';
import type { ScheduleScreen } from '../../packages/contracts/src/wire/features/schedule-planning/api';
import type { PlanOptions } from '../../packages/contracts/src/wire/features/day-plans/api';

const school = '10000000-0000-4000-8000-000000000001', source = '10000000-0000-4000-8000-000000000002', key = '10000000-0000-4000-8000-000000000003', term = '10000000-0000-4000-8000-000000000004', person = '10000000-0000-4000-8000-000000000005';
const scope: NativePendingScope = { schoolId: school, actorId: person, mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const root = scheduleActivityRoot(school);
function record(endpoint: string, refreshPath: string, body: Record<string, unknown>, kind: string, sourceId = source, revision = 3, extras: Partial<NativePendingAction> = {}): NativePendingAction { return { version: 1, domain: 'schedule', scope, clientId: key, ownerHref: '/areas/timetable/planning?date=2026-10-29', endpoint, refreshPath, method: 'POST', phase: 'prepared', replayPolicy: 'same_request', createdAt: '2026-10-29T00:00:00Z', source: { kind, sourceId, revision }, payload: { kind: 'json', body: JSON.stringify({ idempotency_key: key, ...body }) }, ...extras }; }
const catalogue: ActivityCatalogue = { school_id: school, timezone: 'Asia/Kolkata', can_manage: true, people: [{ id: person, label: 'Person', affiliations: [] }], recorders: [{ id: person, label: 'Recorder' }], reviewers: [{ id: person, label: 'Reviewer' }], groups: [], spaces: [{ id: source, label: 'Hall' }], classes: [], terms: [], subjects: [], purposes: ['duty', 'teaching', 'other'] };
const input: ActivityPlanInput = { title: 'Duty', purpose: 'duty', description: '', timezone: 'Asia/Kolkata', starts_on: '2026-10-29', ends_on: '2026-10-29', recurrence: 'once', weekdays: [], starts_at: '09:00', ends_at: '10:00', end_day_offset: 0, space_id: null, person_ids: [person], group_ids: [], lead_person_id: null, recorder_person_id: null, reviewer_person_id: null, attendance_mode: 'none', class_section_id: null, term_id: null, subject_id: null, location_kind: 'unspecified', location_label: '', location_url: '' };
test('real shared journal permits strict activity payload and rejects another school, source or endpoint', () => {
  const draft = record(root + '/plans', root + '/catalogue', input as unknown as Record<string, unknown>, 'activity_plan', school, 0);
  assert.equal(validateNativePendingAction(draft, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...draft, endpoint: root + '/registers/source/marks' }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...draft, endpoint: scheduleActivityRoot(source) + '/plans' }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...draft, source: { kind: 'activity_plan', sourceId: source, revision: 0 } }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...draft, payload: { kind: 'json', body: JSON.stringify({ ...input, school_id: school, idempotency_key: key }) } }, scope, 'schedule'), false);
});
test('activity mutation methods, exact revision, initial and accepted read identities are bound', () => {
  const edit = record(`${root}/plans/${source}`, `${root}/plans/${source}`, { ...input, expected_revision: 3 }, 'activity_plan', source, 3, { method: 'PUT' });
  assert.equal(validateNativePendingAction(edit, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...edit, method: 'POST' }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...edit, source: { kind: 'activity_plan', sourceId: source, revision: 4 } }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...edit, refreshPath: `${root}/plans/${person}` }, scope, 'schedule'), false);
  const replacement = record(`${root}/plans/${source}/revise`, `${root}/plans/${source}`, { expected_revision: 3, starts_on: '2026-10-30', reason: 'Changed duty' }, 'activity_plan');
  assert.equal(validateNativePendingAction(replacement, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...replacement, phase: 'accepted', refreshPath: `${root}/plans/${key}` }, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...replacement, phase: 'accepted' }, scope, 'schedule'), false);
});
test('activity receipt validates key-derived creation/replacement ID, state and next revision', () => {
  const creation = record(root + '/plans', root + '/catalogue', { ...input }, 'activity_plan', school, 0), created = { ...input, id: key, school_id: school, revision: 1, state: 'draft', source: 'activity' };
  assert.equal(scheduleActivityRefreshPath(created, creation), `${root}/plans/${key}`);
  assert.throws(() => scheduleActivityRefreshPath({ ...created, id: source }, creation));
  assert.throws(() => scheduleActivityRefreshPath({ ...created, school_id: source }, creation));
  const published = record(`${root}/plans/${source}/publish`, `${root}/plans/${source}`, { expected_revision: 3 }, 'activity_plan');
  assert.equal(scheduleActivityRefreshPath({ ...created, id: source, revision: 4, state: 'published' }, published), `${root}/plans/${source}`);
  assert.throws(() => scheduleActivityRefreshPath({ ...created, id: source, revision: 5, state: 'published' }, published));
});
test('activity validation retains overnight and canonical context without inventing attendance authority', () => {
  assert.equal(scheduleActivityInput({ ...input, starts_at: '22:00', ends_at: '06:00', end_day_offset: 1 }, catalogue).end_day_offset, 1);
  assert.throws(() => scheduleActivityInput({ ...input, starts_at: '22:00', ends_at: '06:00' }, catalogue));
  assert.throws(() => scheduleActivityInput({ ...input, attendance_mode: 'roll_call' }, catalogue));
  assert.throws(() => scheduleActivityInput({ ...input, person_ids: [term] }, catalogue));
  assert.throws(() => scheduleActivityInput({ ...input, location_kind: 'online', location_url: 'javascript:alert(1)' }, catalogue));
  assert.throws(() => scheduleActivityInput(input, { ...catalogue, can_manage: false }));
  assert.deepEqual(scheduleActivityInput(input, catalogue).person_ids, [person]);
});
test('academic shared gate binds school body, term and exact saved version', () => {
  const draft = record('/api/v1/schedule-planning/drafts', academicScheduleRead(term), { school_id: school, term_id: term, class_section_id: source, starts_on: '2026-11-01', ends_on: '2026-11-30' }, 'academic_schedule', school, 0);
  assert.equal(validateNativePendingAction(draft, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...draft, refreshPath: academicScheduleRead(person) }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...draft, payload: { kind: 'json', body: JSON.stringify({ school_id: source, idempotency_key: key, term_id: term, class_section_id: source }) } }, scope, 'schedule'), false);
  const save = record(`/api/v1/schedule-planning/${source}/save`, academicScheduleRead(term, source), { school_id: school, expected_revision: 3, periods: [] }, 'academic_schedule');
  assert.equal(validateNativePendingAction(save, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...save, refreshPath: academicScheduleRead(term, person) }, scope, 'schedule'), false);
  assert.equal(academicScheduleRefreshPath({ id: source, revision: 4 }, save), academicScheduleRead(term, source));
  assert.throws(() => academicScheduleRefreshPath({ id: person, revision: 4 }, save));
});
test('legacy setting actions are inspect-only and bound to exact technical context', () => {
  const body = { term_id: term, class_section_id: source, subject_id: person, target_minutes: 100, expected_revision: 3, reason: 'Curriculum reviewed' }, target = record('/api/v1/principal/timetable/targets/', academicScheduleRead(term), {}, 'curriculum_target', source, 3, { replayPolicy: 'inspect_only', payload: { kind: 'json', body: JSON.stringify(body) } });
  assert.equal(validateNativePendingAction(target, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...target, replayPolicy: 'same_request' }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...target, refreshPath: academicScheduleRead(person) }, scope, 'schedule'), false);
});
test('Daily Plan shared gate and receipts retain exact school, class date and plan ID', () => {
  const start = record('/api/v1/day-plans', dayPlanOptions(school, '2026-10-29'), { school_id: school, class_section_id: source, date: '2026-10-29' }, 'day_plan', school, 0);
  assert.equal(validateNativePendingAction(start, scope, 'schedule'), true);
  assert.equal(validateNativePendingAction({ ...start, refreshPath: dayPlanOptions(source, '2026-10-29') }, scope, 'schedule'), false);
  assert.equal(validateNativePendingAction({ ...start, refreshPath: dayPlanOptions(school, '2026-10-30') }, scope, 'schedule'), false);
  assert.equal(dayPlanRefreshPath({ id: source, revision: 2 }, start), dayPlanRead(school, source));
  const publish = record(`/api/v1/day-plans/${source}/publish`, dayPlanRead(school, source), { school_id: school, expected_revision: 3 }, 'day_plan');
  assert.equal(validateNativePendingAction(publish, scope, 'schedule'), true);
  assert.equal(dayPlanRefreshPath({ id: source, revision: 4, version: 2 }, publish), dayPlanRead(school, source));
  assert.throws(() => dayPlanRefreshPath({ id: person, revision: 4, version: 2 }, publish));
  assert.throws(() => dayPlanRefreshPath({ id: source, revision: 4 }, publish));
});
test('period serialization preserves canonical places and planned materials without API-only metadata', () => {
  const period = { id: source, weekday: 7, period_number: 1, starts_at: '09:00:00', ends_at: '10:00:00', subject_id: null, teacher_user_id: person, title: 'Teaching', slot_type: 'class' as const, room: 'Room' };
  const academic = { teachers: [{ id: person, name: 'Teacher' }], subjects: [] } as unknown as ScheduleScreen;
  assert.deepEqual(validateSchedulePeriods([period], academic), [cleanSchedulePeriod(period)]);
  assert.throws(() => validateSchedulePeriods([period, { ...period, id: key }], academic));
  const daily = { ...period, space_id: term, cancelled: false, materials: ['Book'] }, options = { teachers: [{ id: person, name: 'Teacher' }], subjects: [] } as unknown as PlanOptions;
  const clean = cleanDayPeriod(daily); assert.equal(clean.space_id, term); assert.deepEqual(clean.materials, ['Book']); assert.equal('id' in clean, false); assert.deepEqual(validateDayPeriods([daily], options), [clean]);
});
test('academic and Daily Plan accepted-source recovery survives restart without duplicate creation', async () => {
  const scenarios = [
    { action: record('/api/v1/schedule-planning/drafts', academicScheduleRead(term), { school_id: school, term_id: term, class_section_id: source, starts_on: '2026-11-01', ends_on: '2026-11-30' }, 'academic_schedule', school, 0), receipt: { id: source, revision: 1 }, resolve: academicScheduleRefreshPath, expected: academicScheduleRead(term, source) },
    { action: record('/api/v1/day-plans', dayPlanOptions(school, '2026-10-29'), { school_id: school, class_section_id: source, date: '2026-10-29' }, 'day_plan', school, 0), receipt: { id: source, revision: 1 }, resolve: dayPlanRefreshPath, expected: dayPlanRead(school, source) },
    { action: record(root + '/plans', root + '/catalogue', { ...input }, 'activity_plan', school, 0), receipt: { ...input, id: key, school_id: school, state: 'draft', revision: 1, source: 'activity' }, resolve: scheduleActivityRefreshPath, expected: `${root}/plans/${key}` },
  ];
  for (const scenario of scenarios) {
    let raw: string | null = null, sends = 0;
    const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } }, context = { ownerHref: scenario.action.ownerHref, refreshPath: scenario.action.refreshPath, assertActive() {}, resolveRefreshPath: scenario.resolve };
    const original = new NativePendingActionJournal({ scope, domain: 'schedule', storage, randomId: () => key, send: async () => { sends++; return scenario.receipt; }, read: async () => { throw new Error('Accepted source temporarily unavailable'); } });
    await original.hydrate(); assert.equal(await original.run({ endpoint: scenario.action.endpoint, body: JSON.parse(scenario.action.payload.kind === 'json' ? scenario.action.payload.body : '{}'), source: scenario.action.source, serverKey: 'idempotency_key' }, context), false);
    assert.equal(JSON.parse(raw!).phase, 'accepted'); assert.equal(JSON.parse(raw!).refreshPath, scenario.expected);
    const resumed = new NativePendingActionJournal({ scope, domain: 'schedule', storage, randomId: () => person, send: async () => { sends++; throw new Error('Duplicate creation forbidden'); }, read: async action => { assert.equal(action.refreshPath, scenario.expected); return scenario.receipt; } });
    await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1); assert.equal(raw, null);
  }
});
test('legacy closure receipt validates exactly returned native rows without inventing school_id fields', () => {
  const body = { term_id: term, starts_on: '2026-11-01', ends_on: '2026-11-02', kind: 'local_holiday', label: 'Campus holiday', reason: 'Published closure' }, action = record('/api/v1/principal/calendar/closures/', academicScheduleRead(term), {}, 'school_closure', school, 0, { replayPolicy: 'inspect_only', payload: { kind: 'json', body: JSON.stringify(body) } });
  const response = { created: true, results: [{ id: source, date: '2026-11-01', revision: 1, kind: body.kind, label: body.label, reason: body.reason }, { id: person, date: '2026-11-02', revision: 1, kind: body.kind, label: body.label, reason: body.reason }] };
  assert.equal(academicScheduleRefreshPath(response, action), academicScheduleRead(term));
  assert.throws(() => academicScheduleRefreshPath({ ...response, results: response.results.slice(0, 1) }, action));
});
