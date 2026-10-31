import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNewPeopleReviewExpiry, enrollmentChangeInput, enrollmentInput, guardianAuthorityBelongsToPerson, guardianAuthorityInput, peopleReviewExpired, validatePeopleReview, validateRetainedPeopleReview, workProfileInput, type EnrollmentChangeReview, type EnrollmentHistory, type EnrollmentOption, type EnrollmentReview, type GuardianAuthority, type PeopleReviewCommitScope } from '../src/lib/people-lifecycle';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingInput } from '../src/lib/native-pending-action';

const school = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', classId = '33333333-3333-4333-8333-333333333333', termId = '44444444-4444-4444-8444-444444444444', reviewId = '55555555-5555-4555-8555-555555555555', student = '66666666-6666-4666-8666-666666666666';
const option: EnrollmentOption = { class_section_id: classId, term_id: termId, class_name: 'Class 7A', term_name: 'Current term', starts_on: '2026-06-01', ends_on: '2027-03-31', today: '2026-10-27', next_roll: 12 };
const intake = { schoolId: school, personId: person, revision: 3, admission: ' tc-17 ', birth: '', enrolledOn: '2026-10-27', roll: '12', option };
const current: EnrollmentHistory = { id: reviewId, class_section_id: classId, term_id: termId, class_name: 'Class 7A', term_name: 'Current term', roll_number: 12, enrolled_on: '2026-06-01', inactive_from: null, exit_kind: null, exit_reason: null, revision: 7 };
const authority: GuardianAuthority = { id: reviewId, student_id: student, guardian_id: person, student_name: 'Learner', guardian_name: 'Guardian', revision: 3, enabled: false, valid_from: null, valid_until: null, source: 'reviewed', effective: false, today: '2026-10-27', history: [] };

test('enrollment explicitly attaches the current canonical person without account or signing authority', () => {
  const body = enrollmentInput(intake);
  assert.deepEqual(body.person, { id: person, expected_revision: 3 }); assert.equal(body.admission_number, 'TC-17'); assert.equal(body.date_of_birth, null);
  assert.equal(body.guardian, null); assert.equal(body.can_authorize_leave, false); assert.equal('email' in body, false); assert.equal('first_name' in body, false);
});
test('enrollment refuses malformed rolls, placement dates and invented birth dates', () => {
  for (const patch of [{ roll: '0' }, { roll: '32768' }, { roll: '12.5' }, { enrolledOn: '2026-05-31' }, { enrolledOn: '2027-04-01' }, { birth: '2026-10-27' }, { birth: '2026-02-30' }, { revision: 0 }, { admission: 'a' }]) assert.throws(() => enrollmentInput({ ...intake, ...patch }));
});
test('class movement retains the exact enrollment revision and term', () => {
  const target = { ...option, class_section_id: student, class_name: 'Class 7B' };
  const body = enrollmentChangeInput({ schoolId: school, current, today: option.today, action: 'move_class', reason: 'Class adjustment', target, roll: '5' });
  assert.equal(body.expected_enrollment_id, current.id); assert.equal(body.expected_revision, 7); assert.equal(body.target_term_id, termId); assert.equal(body.effective_on, option.today);
  assert.throws(() => enrollmentChangeInput({ schoolId: school, current, today: option.today, action: 'move_class', reason: 'Class adjustment', target: option, roll: '5' }));
  assert.throws(() => enrollmentChangeInput({ schoolId: school, current, today: option.today, action: 'move_class', reason: 'Class adjustment', target: { ...target, term_id: person }, roll: '5' }));
});
test('withdrawal and transfer retain the source and do not include a destination placement', () => {
  for (const action of ['withdraw', 'transfer_out'] as const) {
    const body = enrollmentChangeInput({ schoolId: school, current, today: option.today, action, reason: 'Reviewed leaving arrangement', roll: '' });
    assert.equal(body.action, action); assert.equal('target_class_section_id' in body, false); assert.equal('roll_number' in body, false);
  }
});
test('authority grant requires explicit verification and prohibits backdating', () => {
  const input = { schoolId: school, source: authority, enabled: true, start: option.today, end: '2026-11-30', reason: 'School verified written authorization', verified: true };
  assert.equal(guardianAuthorityInput(input).verified, true); assert.equal(guardianAuthorityInput(input).expected_revision, 3);
  for (const patch of [{ verified: false }, { start: '2026-10-26' }, { end: '2026-10-26' }, { reason: 'short' }]) assert.throws(() => guardianAuthorityInput({ ...input, ...patch }));
});
test('authority revocation always omits grant dates and remains explicitly verified', () => {
  const body = guardianAuthorityInput({ schoolId: school, source: authority, enabled: false, start: 'stale date', end: 'stale date', reason: 'School verified authority revocation', verified: true });
  assert.equal(body.valid_from, null); assert.equal(body.valid_until, null); assert.equal(body.enabled, false);
});
test('authority deep links bind owning source IDs without relying on the first connection page', () => {
  assert.equal(guardianAuthorityBelongsToPerson(authority, [{ id: student, kind: 'learning' }]), true);
  assert.equal(guardianAuthorityBelongsToPerson(authority, [{ id: person, kind: 'guardian' }]), true);
  assert.equal(guardianAuthorityBelongsToPerson(authority, [{ id: person, kind: 'work' }]), false);
  assert.equal(guardianAuthorityBelongsToPerson(authority, [{ id: reviewId, kind: 'learning' }]), false);
});
test('canonical work attachment does not invent an account, invitation or role', () => {
  const body = workProfileInput(person, 3, { code: ' T-17 ', kind: 'teaching', designation: ' Teacher ', department: ' Science ', employment: 'unspecified', joined: '' });
  assert.deepEqual(body.person, { id: person, expected_revision: 3 }); assert.equal(body.staff_code, 'T-17'); assert.equal(body.joined_on, null);
  for (const key of ['email', 'phone', 'first_name', 'invitation', 'user_id', 'role', 'permissions']) assert.equal(key in body, false);
  assert.throws(() => workProfileInput(person, 3, { code: 'bad space', kind: 'teaching', designation: 'Teacher', department: '', employment: 'full_time', joined: '' }));
});
test('retained enrollment reviews bind campus, person, kind and selected-world scope', () => {
  const review: EnrollmentReview = { id: reviewId, expires_at: '2026-10-27T11:00:00Z', input: enrollmentInput(intake), class_name: option.class_name, term_name: option.term_name, guardian: null, warnings: [] };
  const envelope = { version: 1, scopeKey: 'actor:campus:simulation:world-a:origin', kind: 'enrollment_review' as const, personId: person, fingerprint: 'a'.repeat(64), review };
  assert.equal(validatePeopleReview(review, 'enrollment_review', school, person), true);
  assert.equal(validateRetainedPeopleReview(envelope, envelope.scopeKey, 'enrollment_review', school, person), true);
  for (const changed of [{ ...envelope, scopeKey: 'actor:campus:simulation:world-b:origin' }, { ...envelope, personId: student }, { ...envelope, fingerprint: 'invalid' }]) assert.equal(validateRetainedPeopleReview(changed, envelope.scopeKey, 'enrollment_review', school, person), false);
  assert.equal(validatePeopleReview({ ...review, input: { ...review.input, school_id: person } }, 'enrollment_review', school, person), false);
  assert.equal(validatePeopleReview({ ...review, input: { ...review.input, can_authorize_leave: true } }, 'enrollment_review', school, person), false);
});
test('lifecycle reviews bind learner, source revision and nonnegative impact', () => {
  const input = enrollmentChangeInput({ schoolId: school, current, today: option.today, action: 'withdraw', reason: 'Reviewed departure', roll: '' });
  const review: EnrollmentChangeReview = { id: person, expires_at: '2026-10-27T11:00:00Z', input: { ...input, student_id: student }, current, target: null, impact: { attendance_registers: 3, submitted_registers: 1, assessments: 2, transport_assignments: 1, departure_plans: 1 } };
  assert.equal(validatePeopleReview(review, 'enrollment_change_review', school, person, student), true);
  for (const patch of [{ input: { ...review.input, student_id: person } }, { current: { ...current, revision: 8 } }, { impact: { ...review.impact, assessments: -1 } }]) assert.equal(validatePeopleReview({ ...review, ...patch }, 'enrollment_change_review', school, person, student), false);
});

const reviewExpiry = '2026-10-27T11:00:00Z', runId = '77777777-7777-4777-8777-777777777777', scenarioId = '88888888-8888-4888-8888-888888888888';
const commitScope: PeopleReviewCommitScope = { actorId: person, schoolId: school, environment: { mode: 'simulation', institution_id: school, run_id: runId, namespace_id: `scenario:${scenarioId}:run:${runId}` } };
function selectedSession(now = '2026-10-27T10:59:59Z') {
  return { authenticated: true, user: { id: person, active_school_id: school }, execution_environment: { ...commitScope.environment, virtual_clock: { now, time_zone: 'Asia/Kolkata' } } };
}

test('new Live commits check wall time and treat the exact expiry instant as expired', async () => {
  let reads = 0;
  const scope = { ...commitScope, environment: { mode: 'live' as const } };
  const readSession = async () => { reads++; throw new Error('Live must not read a virtual clock'); };
  assert.equal(await checkNewPeopleReviewExpiry(reviewExpiry, scope, { assertCurrent() {}, readSession, wallNow: () => Date.parse(reviewExpiry) - 1 }), false);
  assert.equal(await checkNewPeopleReviewExpiry(reviewExpiry, scope, { assertCurrent() {}, readSession, wallNow: () => Date.parse(reviewExpiry) }), true);
  assert.equal(reads, 0);
  assert.throws(() => peopleReviewExpired('invalid', Date.now()));
  assert.throws(() => peopleReviewExpired(reviewExpiry, Number.NaN));
});
test('new Simulation commits use only a fresh matching processed clock, regardless of wall time', async () => {
  let reads = 0;
  const options = { assertCurrent() {}, readSession: async () => { reads++; return selectedSession(); }, wallNow: () => Date.parse('2040-01-01T00:00:00Z') };
  assert.equal(await checkNewPeopleReviewExpiry(reviewExpiry, commitScope, options), false);
  assert.equal(reads, 1);
  assert.equal(await checkNewPeopleReviewExpiry(reviewExpiry, commitScope, { ...options, readSession: async () => selectedSession(reviewExpiry), wallNow: () => 0 }), true);
});
test('Simulation clock reads cannot substitute another actor, campus, run, namespace or Live context', async () => {
  const session = selectedSession();
  const invalid = [
    { ...session, authenticated: false },
    { ...session, user: { ...session.user, id: student } },
    { ...session, user: { ...session.user, active_school_id: student } },
    ...[{ mode: 'live' }, { institution_id: student }, { run_id: student }, { namespace_id: `scenario:${scenarioId}:run:${student}` }, { unavailable: true }, { virtual_clock: { now: 'invalid' } }, { virtual_clock: null }].map(patch => ({ ...session, execution_environment: { ...session.execution_environment, ...patch } })),
    null,
  ];
  for (const response of invalid) await assert.rejects(checkNewPeopleReviewExpiry(reviewExpiry, commitScope, { assertCurrent() {}, readSession: async () => response }));
});
test('an incomplete selected Simulation fails closed before reading another environment', async () => {
  let reads = 0;
  for (const patch of [{ unavailable: true }, { institution_id: student }, { run_id: undefined }, { namespace_id: `scenario:${scenarioId}:run:${student}` }]) {
    await assert.rejects(checkNewPeopleReviewExpiry(reviewExpiry, { ...commitScope, environment: { ...commitScope.environment, ...patch } }, { assertCurrent() {}, readSession: async () => { reads++; return selectedSession(); } }));
  }
  assert.equal(reads, 0);
});
test('credential or selected-world changes during a clock read prevent any new commit', async () => {
  let current = true, commits = 0;
  await assert.rejects(async () => {
    await checkNewPeopleReviewExpiry(reviewExpiry, commitScope, { assertCurrent() { if (!current) throw new Error('Original transport changed'); }, readSession: async () => { current = false; return selectedSession(); } });
    commits++;
  }, /Original transport changed/);
  assert.equal(commits, 0);
});
test('a failed processed-clock read leaves the review available for editing without a new command', async () => {
  const retained = JSON.stringify({ id: reviewId, expires_at: reviewExpiry }); let commands = 0;
  await assert.rejects(async () => {
    await checkNewPeopleReviewExpiry(reviewExpiry, commitScope, { assertCurrent() {}, readSession: async () => { throw new Error('Session unavailable'); } });
    commands++;
  }, /Session unavailable/);
  assert.equal(retained, JSON.stringify({ id: reviewId, expires_at: reviewExpiry })); assert.equal(commands, 0);
});
test('an expired unsent review never creates a pending command and the owning review stays valid to edit', async () => {
  const review: EnrollmentReview = { id: reviewId, expires_at: reviewExpiry, input: enrollmentInput(intake), class_name: option.class_name, term_name: option.term_name, guardian: null, warnings: [] };
  let journalBytes: string | null = null, writes = 0, sends = 0;
  const journal = new NativePendingActionJournal({ scope: { actorId: person, schoolId: school, mode: 'simulation', namespaceId: commitScope.environment.namespace_id!, origin: 'https://campus.example' }, domain: 'people', storage: { read: async () => journalBytes, write: async value => { writes++; journalBytes = value; }, clear: async () => { journalBytes = null; } }, randomId: () => runId, send: async () => { sends++; return {}; }, read: async () => ({}) });
  await journal.hydrate();
  if (!await checkNewPeopleReviewExpiry(review.expires_at, commitScope, { assertCurrent() {}, readSession: async () => selectedSession(reviewExpiry) })) await journal.run({ endpoint: `/api/v1/people/enrollment-reviews/${review.id}/commit`, body: {}, serverKey: 'review_id', source: { kind: 'enrollment_review', sourceId: reviewId, revision: 0, fingerprint: 'a'.repeat(64) } }, { ownerHref: '/areas/people/participants', refreshPath: `/api/v1/schools/${school}/people/participants/${person}`, assertActive() {} });
  assert.equal(writes, 0); assert.equal(sends, 0); assert.equal(journal.snapshot().action, null); assert.equal(journal.snapshot().blocked, false);
  assert.equal(validatePeopleReview(review, 'enrollment_review', school, person), true);
});
test('already-unknown reviewed commits still replay the exact receipt path after preview expiry', async () => {
  for (const kind of ['enrollment_review', 'enrollment_change_review'] as const) {
    let raw: string | null = null, loseResponse = true; const dispatched: NativePendingAction[] = [];
    const scope = { actorId: person, schoolId: school, mode: 'simulation' as const, namespaceId: commitScope.environment.namespace_id!, origin: 'https://campus.example' };
    const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
    const create = () => new NativePendingActionJournal({ scope, domain: 'people', storage, randomId: () => runId, send: async action => { dispatched.push(action); if (loseResponse) throw new Error('Response lost'); return { student_id: student }; }, read: async () => ({ id: person }) });
    const context = { ownerHref: `/areas/people/participants?person_id=${person}`, refreshPath: `/api/v1/schools/${school}/people/participants/${person}`, assertActive() {} };
    const input: NativePendingInput = { endpoint: `/api/v1/people/${kind === 'enrollment_review' ? 'enrollment-reviews' : 'enrollment-change-reviews'}/${reviewId}/commit`, body: {}, serverKey: 'review_id', source: { kind, sourceId: reviewId, revision: 0, fingerprint: 'a'.repeat(64) } };
    const first = create(); await first.hydrate(); await first.run(input, context); assert.equal(first.snapshot().action?.phase, 'unknown');
    assert.equal(peopleReviewExpired(reviewExpiry, Date.parse('2026-10-28T00:00:00Z')), true);
    loseResponse = false; const resumed = create(); await resumed.hydrate(); assert.equal(await resumed.recover(context), true);
    assert.equal(dispatched.length, 2); assert.equal(dispatched[1]!.endpoint, dispatched[0]!.endpoint); assert.deepEqual(dispatched[1]!.payload, { kind: 'json', body: '{}' }); assert.equal(raw, null);
  }
});
