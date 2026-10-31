import { describe, expect, it } from 'vitest';
import { activityOccurrenceRangeInput, activityPlanInput, activityRangeInput, type ActivityOccurrence } from '../src/schedule-planning/activity.contracts.js';
import { activityOccurrenceId, firstOccurrenceConflict, occurrenceConflict, timezoneTransitionDates } from '../src/schedule-planning/activity-occurrence.engine.js';
import { isAmbiguousLocalInstant } from '../src/schedule-planning/shared-recurrence.js';

const person = '11111111-1111-4111-8111-111111111111';
const base = { idempotency_key: person, title: 'Evening activity', purpose: 'duty', timezone: 'Asia/Kolkata',
  starts_on: '2027-01-05', recurrence: 'weekly', weekdays: [2, 4], starts_at: '22:00', ends_at: '06:00', end_day_offset: 1,
  person_ids: [person] };
const occurrence = (overrides: Partial<ActivityOccurrence> = {}): ActivityOccurrence => ({
  id: 'first', school_id: person, activity_id: person, plan_version_id: person, period_id: person,
  source: 'activity', source_ref: 'source', source_revision: 1, title: 'Night duty', purpose: 'duty',
  local_date: '2027-01-05', starts_at: '2027-01-05T16:30:00.000Z', ends_at: '2027-01-06T00:30:00.000Z',
  timezone: 'Asia/Kolkata', space_id: null, attendance_mode: 'roll_call', context_kind: 'activity', context_ref: null,
  term_id: null, subject_id: null, scheduled_teacher_id: null, period_number: null, state: 'expected', revision: 1,
  recorder_person_id: null, reviewer_person_id: null,
  location_kind: 'unspecified', location_label: '', location_url: '',
  participants: [{ person_id: person, label: 'Same campus person', participation_role: 'participant', source_kind: 'person',
    source_ref: person, source_revision: 1, requirement: 'required' }], ...overrides,
});

describe('unified planning contracts and interval semantics', () => {
  it('supports optional-ended weekly work and explicit overnight duration without an academic class', () => {
    expect(activityPlanInput.parse(base)).toMatchObject({ ends_on: null, end_day_offset: 1, class_section_id: null, term_id: null });
    expect(activityPlanInput.safeParse({ ...base, end_day_offset: 0 }).success).toBe(false);
    expect(activityPlanInput.safeParse({ ...base, ends_at: '23:00' }).success).toBe(false);
  });
  it('keeps class teaching specialization explicit and permits mixed reusable participant groups', () => {
    expect(activityPlanInput.parse({ ...base, group_ids: [`group:${person}`, `class:${person}`, `team:${person}`] }).group_ids).toHaveLength(3);
    expect(activityPlanInput.safeParse({ ...base, class_section_id: person }).success).toBe(false);
    expect(activityPlanInput.safeParse({ ...base, recurrence: 'once', ends_on: '2027-01-06' }).success).toBe(false);
    expect(activityPlanInput.safeParse({ ...base, weekdays: [] }).success).toBe(false);
  });
  it('uses canonical person identity across purposes, half-open boundaries, and cancellation', () => {
    const duty = occurrence();
    expect(occurrenceConflict(duty, occurrence({ id: 'training', purpose: 'training', starts_at: '2027-01-05T20:00:00.000Z' })))
      .toMatchObject({ kind: 'person', person_id: person });
    expect(occurrenceConflict(duty, occurrence({ id: 'adjacent', starts_at: duty.ends_at, ends_at: '2027-01-06T01:30:00.000Z' }))).toBeNull();
    expect(occurrenceConflict(duty, occurrence({ id: 'cancelled', state: 'cancelled' }))).toBeNull();
    expect(occurrenceConflict(duty, duty)).toBeNull();
    expect(occurrenceConflict(occurrence({ space_id: person }), occurrence({ id: 'room', space_id: person, participants: [] }))).toMatchObject({ kind: 'space' });
    const invitation=occurrence({id:'invitation',participants:[{...duty.participants[0]!,requirement:'optional'}]});
    expect(occurrenceConflict(duty,invitation)).toBeNull();
    expect(firstOccurrenceConflict([duty],[invitation])).toBeNull();
    expect(firstOccurrenceConflict([duty],[occurrence({id:'required'})])).toMatchObject({conflict:{kind:'person'}});
  });
  it('has repeatable domain occurrence identity, environment-isolated stores and finite query windows', () => {
    expect(activityOccurrenceId(person, 'academic', 'source', '2027-01-05')).toBe(activityOccurrenceId(person, 'academic', 'source', '2027-01-05'));
    expect(activityOccurrenceId(person, 'academic', 'other', '2027-01-05')).not.toBe(activityOccurrenceId(person, 'academic', 'source', '2027-01-05'));
    expect(activityRangeInput.safeParse({ from: '2027-01-01', until: '2027-02-05' }).success).toBe(false);
    expect(activityRangeInput.parse({ from: '2027-01-01', until: '2027-02-04' }).page).toBe(1);
    expect(activityRangeInput.safeParse({ from: '2027-01-01', until: '2027-01-02', page: 0 }).success).toBe(false);
  });
  it('does not silently choose an offset during a repeated local time', () => {
    expect(isAmbiguousLocalInstant('2027-11-07T06:30:00.000Z', 'America/New_York')).toBe(true);
    expect(isAmbiguousLocalInstant('2027-11-07T07:30:00.000Z', 'America/New_York')).toBe(false);
    expect(isAmbiguousLocalInstant('2027-04-03T15:15:00.000Z', 'Australia/Lord_Howe')).toBe(true);
    expect(isAmbiguousLocalInstant('2027-11-07T06:30:00.000Z', 'Asia/Kolkata')).toBe(false);
    expect(timezoneTransitionDates('America/New_York','2027-01-01')).toEqual(['2027-03-13','2027-11-06']);
    expect(timezoneTransitionDates('Asia/Kolkata','2027-01-01')).toEqual([]);
  });
  it('separates the expected calendar from retained history without weakening range or pagination limits', () => {
    const range = { from: '2027-01-01', until: '2027-02-04' };
    expect(activityOccurrenceRangeInput.parse(range)).toMatchObject({ state: 'all', page: 1 });
    for (const state of ['expected', 'cancelled']) expect(activityOccurrenceRangeInput.parse({ ...range, state }).state).toBe(state);
    expect(activityOccurrenceRangeInput.safeParse({ ...range, state: 'deleted' }).success).toBe(false);
    expect(activityOccurrenceRangeInput.safeParse({ ...range, until: '2027-02-05', state: 'expected' }).success).toBe(false);
    expect(activityOccurrenceRangeInput.safeParse({ ...range, state: 'expected', page: 0 }).success).toBe(false);
  });
});
