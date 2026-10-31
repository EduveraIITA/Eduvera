import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedPlans, assessmentPlans, chooseEvent, preservationView, weeks, fixture } from './seed-aaranya-calendar-connected.mjs';
import { AARANYA_OPTIONAL_EVENT_CANDIDATES as candidates } from './aaranya-calendar-year.mjs';

const day = weekday => ({ weekday, menu_text: 'SYNTHETIC DEMO MENU — Rice and dal.', starts_at: '12:30', ends_at: '14:00', end_day_offset: 0,
  space_id: 'canonical-dining-place', operator_person_id: 'retained-operator', start_fold: 'reject', end_fold: 'reject', irrelevant_dto_field: 'must not leak' });
const context = { cohort: { id: 'cohort' }, faculty: { user_id: 'faculty' }, faculty_person_id: 'faculty-person', director: { user_id: 'director' },
  subjects: [{ id: 'actual-subject-1', name: 'Programming Practices', examiner_user_id: 'faculty' }, { id: 'actual-subject-2', name: 'Machine Learning', examiner_user_id: 'other-faculty' }],
  eligibleSpaces: [{ id: 'canonical-room', name: 'Seminar room' }, { id: 'other-room', name: 'Project studio' }],
  services: Object.fromEntries(['lunch', 'dinner'].map(key => [key, { service: { id: `${key}-service`, revision: 2 }, plan: { timezone: 'Asia/Kolkata', days: Array.from({ length: 7 }, (_, i) => day(i + 1)) } }])) };

test('only the three explicit weeks are extended for both native services', () => {
  const plans = connectedPlans(context);
  assert.equal(plans.length, 6); assert.equal(weeks.length, 3);
  for (const plan of plans) {
    assert.equal(plan.fields.days.length, 7);
    assert.match(plan.fields.label, /^Week of \d{1,2} (Nov|Dec|Feb) 202[67]$/);
    assert.doesNotMatch(plan.fields.label, /Aravali|Courtyard|dinner|lunch/);
    assert.ok(plan.fields.ends_on); assert.equal(plan.fields.service_expected_revision, 2);
    assert.match(plan.fields.note, /Fictional Aaranya development calendar; not an official schedule/);
    assert.ok(plan.fields.note.includes(fixture));
    assert.equal(plan.fields.days[0].operator_person_id, 'retained-operator');
    assert.equal(plan.fields.days[0].irrelevant_dto_field, undefined);
    assert.equal(plan.fields.count_total, undefined); assert.equal(plan.fields.observed_at, undefined);
  }
  assert.deepEqual(plans.map(p => p.fields.starts_on).sort(), ['2026-11-09', '2026-11-09', '2026-12-21', '2026-12-21', '2027-02-08', '2027-02-08']);
});
test('events use actual cohort, canonical venue, optional RSVP and no observation register', () => {
  const event = chooseEvent(candidates[0], context, []);
  assert.equal(event.fields.space_id, 'canonical-room'); assert.equal(event.fields.staff[0].user_id, 'faculty');
  assert.deepEqual(event.fields.audience.class_section_ids, ['cohort']); assert.equal(event.fields.requires_rsvp, true);
  assert.equal(event.fields.participation_requirement, 'optional'); assert.equal(event.fields.sessions[0].attendance_mode, 'none');
  assert.equal(event.fields.payment_required, false); assert.equal(event.fields.payment_amount_paise, null);
  assert.equal(event.preflight.adjusted_before_publication, false);
});
test('actual cohort clashes move the candidate before publication; room-only clashes select another room', () => {
  const candidate = candidates[0], block = { starts_at: `${candidate.date}T13:00:00+05:30`, ends_at: `${candidate.date}T16:30:00+05:30`, state: 'expected' };
  const event = chooseEvent(candidate, context, [{ ...block, context_ref: 'cohort' }]);
  assert.equal(event.fields.starts_at, `${candidate.date}T17:00:00+05:30`); assert.equal(event.preflight.adjusted_before_publication, true);
  assert.equal(chooseEvent(candidate, context, [{ ...block, space_id: 'canonical-room' }]).fields.space_id, 'other-room');
});
test('required actual faculty commitment blocks a candidate, but its retained own event is not a new clash', () => {
  const candidate = candidates[0], block = { source_ref: 'our-event', starts_at: `${candidate.date}T00:00:00+05:30`, ends_at: `${candidate.date}T23:59:00+05:30`,
    state: 'expected', participants: [{ person_id: 'faculty-person', requirement: 'required' }] };
  assert.throws(() => chooseEvent(candidate, context, [block]), /No conflict-free/);
  assert.equal(chooseEvent(candidate, context, [block], { id: 'our-event' }).preflight.adjusted_before_publication, false);
});
test('two genuine subject assessments stay nonphysical, unmarked, and retain distinct real moderator', () => {
  const plans = assessmentPlans(context); assert.equal(plans.length, 2);
  for (const [i, planned] of plans.entries()) {
    assert.ok(['project', 'quiz'].includes(planned.fields.assessment_kind)); assert.equal(planned.fields.subject_id, context.subjects[i].id);
    assert.equal(planned.fields.class_section_id, 'cohort'); assert.equal(planned.fields.space_id, null);
    assert.deepEqual(planned.fields.invigilator_user_ids, []); assert.notEqual(planned.fields.examiner_user_id, planned.fields.moderator_user_id);
    assert.equal(planned.fields.results, undefined); assert.equal(planned.fields.marks, undefined);
    assert.match(planned.fields.instructions, /No marks, result, candidate attendance or physical sitting/);
    assert.ok(planned.fields.scheduled_at >= '2026-11-01' && planned.fields.scheduled_at < '2026-12-19');
  }
});
test('preservation compares real source configuration and evidence, not newly created aggregate lists', () => {
  const source = { services: { lunch: { id: 'service', revision: 2, coordinator_person_id: 'coordinator', sessions: [] } },
    sourcePlans: { lunch: { id: 'old-plan', state: 'published', revision: 2, days: [day(1)] } },
    monday: { id: 'old-session', revision: 1, count_total: null, count_receipt_id: null },
    issue: { id: 'old-private-issue', revision: 1, state: 'open', history: [] } };
  const before = preservationView(source, { preserved: 'same-cohorts-and-terms' });
  source.services.lunch.sessions = [{ id: 'new-native-session' }];
  assert.deepEqual(preservationView(source, { preserved: 'same-cohorts-and-terms' }), before);
  source.monday.count_total = 8; source.monday.count_receipt_id = 'new-physical-evidence';
  assert.notDeepEqual(preservationView(source, { preserved: 'same-cohorts-and-terms' }), before);
});
