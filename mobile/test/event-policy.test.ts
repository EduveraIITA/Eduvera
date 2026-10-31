import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEventFinance, assertEventRead, assertNativeEvent, changeEventObservation, eventActionRefreshPath, eventCancellationInput, eventDetailRead, eventFinanceRead, eventInputFromSource, eventMoneyInput, eventObservationRecords, eventRefundInput, eventWithdrawalInput, newEventInput, resolveNativeEventRoute, validateEventInput, type EventCatalog, type EventFinance, type EventFinanceItem, type EventInput, type NativeEvent } from '../src/lib/event-policy';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingInput, type NativePendingScope } from '../src/lib/native-pending-action';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const school = id(1), actor = id(2), eventId = id(3), sessionId = id(4), student = id(5), sibling = id(6), classA = id(7), classB = id(8), staff = id(9), place = id(10), key = id(11), check = id(12);
const catalog: EventCatalog = { class_sections: [{ id: classA, name: '7A' }, { id: classB, name: '7B' }], students: [{ id: student, name: 'Learner A', class_section_id: classA, admission_number: 'A' }, { id: sibling, name: 'Learner B', class_section_id: classB, admission_number: 'B' }], staff: [{ user_id: staff, name: 'Current staff member' }], subjects: [], places: [{ id: place, name: 'Hall', campus_id: id(13), campus_name: 'Main campus' }] };
function input(): EventInput { return { ...newEventInput('2026-10-27T08:00:00Z'), title: 'Campus programme', venue: 'Main hall' }; }
function source(): NativeEvent { const value = input(); return { ...value, id: eventId, school_id: school, revision: 3, status: 'draft', cancellation_reason: null, cancellation_internal_reason: null, sessions: value.sessions.map(item => ({ ...item, id: sessionId, state: 'open', revision: 1, counts: { recorded: 0, not_recorded: 0 } })), viewer_participants: [], permissions: { can_edit: true, can_publish: true, can_cancel: false, can_complete: false, can_manage_policy: true, can_manage_audience: true, can_manage_staff: true, can_rsvp: false, can_consent: false, can_take_attendance: false, can_view_finance_details: true }, staff: [] }; }
const item: EventFinanceItem = { student_id: student, student_name: 'Learner A', participation_state: 'accepted', withdrawal_id: null, withdrawn_at: null, can_withdraw: true, finance_state: 'refund_due', currency: 'INR', invoice_id: id(20), invoice_amount_paise: 10000, credited_paise: 10000, paid_paise: 10000, refunded_paise: 0, collectible_balance_paise: 0, refund_due_paise: 10000, refunds: [] };
const finance = (): EventFinance => ({ event: { id: eventId, title: 'Campus programme', status: 'published' }, items: [{ ...item, refunds: [] }], counts: { reconciliation_required: 1, withdrawn: 0 }, permissions: { can_view_finance_details: true, can_record_refund: true } });
const scope: NativePendingScope = { actorId: actor, schoolId: school, mode: 'simulation', namespaceId: `scenario:${id(21)}:run:${id(22)}`, origin: 'https://campus.example' };
const context = { ownerHref: '/areas/events/manage/new', refreshPath: `/api/v1/campus-events?school_id=${school}&limit=10`, assertActive() {}, resolveRefreshPath: eventActionRefreshPath, accepted(value: unknown, _guard: () => void, action: NativePendingAction) { assertEventRead(value, action); } };
const creation = (): NativePendingInput => ({ endpoint: '/api/v1/campus-events', body: { ...input(), school_id: school }, serverKey: 'idempotency_key', source: { kind: 'event_creation', sourceId: school, revision: 0, fingerprint: 'a'.repeat(64) } });
function memory() { let raw: string | null = null; let writes = 0; return { storage: { read: async () => raw, write: async (value: string) => { writes++; raw = value; }, clear: async () => { raw = null; } }, get raw() { return raw; }, get writes() { return writes; } }; }

test('event routes require the exact retained relationship scope and never select a different learner', () => {
  const surfaces = [{ key: 'manage' }, { key: `calendar:dependent:${student}`, scopes: [{ kind: 'dependent', id: student }] }];
  assert.equal(resolveNativeEventRoute(`/areas/events/calendar/${eventId}?scope=dependent&student_id=${student}`, surfaces)?.studentId, student);
  for (const href of [`/areas/events/calendar/${eventId}?scope=self&student_id=${student}`, `/areas/events/calendar/${eventId}?scope=dependent&student_id=${sibling}`, `/areas/events/calendar/${eventId}?scope=dependent&student_id=${student}&student_id=${sibling}`, `/areas/events/manage/new?student_id=${student}`, '/areas/events/assigned/new']) assert.equal(resolveNativeEventRoute(href, surfaces), null);
  assert.equal(resolveNativeEventRoute(`/areas/events/calendar/${eventId}?scope=dependent&student_id=${student}`, [{ key: `calendar:dependent:${student}`, scopes: [{ kind: 'dependent', id: sibling }] }]), null);
});
test('event routes bind edit/register paths to exact UUID sources and reject mixed path/query targets', () => {
  const surfaces = [{ key: 'manage' }, { key: 'assigned' }];
  assert.equal(resolveNativeEventRoute('/areas/events/manage/new', surfaces)?.editor, true);
  assert.equal(resolveNativeEventRoute(`/areas/events/assigned/${eventId}/edit`, surfaces)?.eventId, eventId);
  assert.equal(resolveNativeEventRoute(`/areas/events/manage/${eventId}/sessions/${sessionId}/attendance`, surfaces)?.sessionId, sessionId);
  for (const href of [`/areas/events/manage/${eventId}?event_id=${id(30)}`, `/areas/events/manage/${eventId}/sessions/${sessionId}/attendance?session_id=${id(30)}`, `/areas/events/manage/${eventId}/unexpected`, '/areas/events/manage/not-an-id', `/areas/events/manage/new?event_id=${eventId}`]) assert.equal(resolveNativeEventRoute(href, surfaces), null);
});
test('draft initialization follows selected-world time and retains original source IDs without mutating source bytes', () => {
  const draft = newEventInput('2000-01-01T09:00:00Z'); assert.equal(draft.starts_at, '2000-01-08T09:00:00.000Z'); assert.throws(() => newEventInput('unconfirmed'));
  const event = source(), bytes = JSON.stringify(event), edit = eventInputFromSource(event); edit.sessions[0]!.title = 'Changed'; edit.audience.student_ids.push(student);
  assert.equal(JSON.stringify(event), bytes); assert.equal(edit.sessions[0]!.id, sessionId); assert.equal('revision' in edit.sessions[0]!, false);
});
test('draft validation rejects invalid event/session windows and out-of-event source IDs', () => {
  const event = source(), valid = eventInputFromSource(event); assert.equal(validateEventInput(valid, catalog, event).title, valid.title);
  for (const patch of [{ ends_at: valid.starts_at }, { starts_at: 'invalid' }, { sessions: [{ ...valid.sessions[0]!, starts_at: '2000-01-01T00:00:00Z' }] }, { sessions: [{ ...valid.sessions[0]!, id: id(30) }] }, { sessions: [valid.sessions[0]!, valid.sessions[0]!] }, { checklist: [{ id: check, label: 'Water', required: true }] }]) assert.throws(() => validateEventInput({ ...valid, ...patch }, catalog, event));
});
test('audience validation rejects foreign identities, duplicates and hidden mixed audience modes', () => {
  for (const audience of [{ mode: 'school' as const, class_section_ids: [classA], student_ids: [] }, { mode: 'students' as const, class_section_ids: [], student_ids: [student, student] }, { mode: 'students' as const, class_section_ids: [], student_ids: [id(30)] }, { mode: 'class_sections' as const, class_section_ids: [], student_ids: [] }]) assert.throws(() => validateEventInput({ ...input(), audience }, catalog));
});
test('a venue name never resolves an implicit mapped place or a foreign location', () => {
  assert.equal(validateEventInput({ ...input(), venue: 'Hall', space_id: null }, catalog).space_id, null);
  assert.equal(validateEventInput({ ...input(), space_id: place }, catalog).space_id, place);
  assert.throws(() => validateEventInput({ ...input(), space_id: id(30) }, catalog));
  assert.throws(() => validateEventInput({ ...input(), sessions: [{ ...input().sessions[0]!, use_event_space: true, space_id: place }] }, catalog));
});
test('changing audience never silently keeps a now-excluded learner in a saved session subset', () => {
  const event = source(); event.audience = { mode: 'students', class_section_ids: [], student_ids: [student, sibling] }; event.sessions[0]!.participant_student_ids = [student];
  assert.throws(() => validateEventInput({ ...eventInputFromSource(event), audience: { mode: 'students', class_section_ids: [], student_ids: [sibling] } }, catalog, event));
  const organizerCatalogue = { ...catalog, students: [] };
  assert.equal(validateEventInput(eventInputFromSource(event), organizerCatalogue, event).sessions[0]!.participant_student_ids[0], student);
});
test('organizer delivery edits preserve protected policy, audience and explicit staff authority', () => {
  const event = source(); Object.assign(event.permissions, { can_manage_policy: false, can_manage_audience: false, can_manage_staff: false });
  const edit = eventInputFromSource(event); edit.title = 'Reviewed programme'; edit.sessions[0]!.venue = 'Annex'; assert.equal(validateEventInput(edit, catalog, event).title, 'Reviewed programme');
  for (const patch of [{ requires_guardian_consent: true }, { participation_requirement: 'mandatory' as const }, { event_type: 'sports' as const }, { audience: { mode: 'students' as const, class_section_ids: [], student_ids: [student] } }, { staff: [{ user_id: staff, role: 'organizer' as const }] }, { sessions: [...edit.sessions, { ...input().sessions[0]! }] }]) assert.throws(() => validateEventInput({ ...edit, ...patch }, catalog, event));
});
test('only a currently editable draft can be changed and generic authoring cannot create class tests', () => {
  const event = source();
  assert.throws(() => validateEventInput(eventInputFromSource(event), catalog, { ...event, status: 'published' }));
  assert.throws(() => validateEventInput(eventInputFromSource(event), catalog, { ...event, permissions: { ...event.permissions, can_edit: false } }));
  assert.throws(() => validateEventInput({ ...input(), event_type: 'class_test', subject_id: id(30) }, catalog));
});
test('optional participation requires RSVP and fee terms remain coupled with no floating-point amount drift', () => {
  assert.throws(() => validateEventInput({ ...input(), requires_rsvp: false }, catalog));
  assert.throws(() => validateEventInput({ ...input(), payment_required: true, payment_amount_paise: 10000, payment_due_on: '2026-02-30' }, catalog));
  assert.throws(() => validateEventInput({ ...input(), payment_required: false, payment_amount_paise: 10000 }, catalog));
  assert.equal(eventMoneyInput('0.01'), 1); assert.equal(eventMoneyInput('12.29'), 1229); assert.equal(eventMoneyInput('1000000'), 100000000);
  for (const amount of ['0', '-1', '1.001', '1e2', 'Infinity', '1000000.01']) assert.throws(() => eventMoneyInput(amount));
});
test('cancellation binds current authority/revision and distinct internal/audience text', () => {
  const event = { ...source(), status: 'published' as const, permissions: { ...source().permissions, can_cancel: true } };
  assert.deepEqual(eventCancellationInput(event, ' Internal reason ', ' Audience notice '), { expected_revision: 3, internal_reason: 'Internal reason', audience_notice: 'Audience notice' });
  assert.throws(() => eventCancellationInput(event, 'ok', 'Audience notice')); assert.throws(() => eventCancellationInput({ ...event, permissions: { ...event.permissions, can_cancel: false } }, 'Internal reason', 'Audience notice'));
});
test('finance proof cannot fall back to another event, sibling, currency or malformed balance', () => {
  assert.doesNotThrow(() => assertEventFinance(finance(), eventId, student));
  for (const value of [{ ...finance(), event: { ...finance().event, id: id(30) } }, { ...finance(), items: [{ ...item, student_id: sibling }] }, { ...finance(), items: [item, { ...item, student_id: sibling }] }, { ...finance(), items: [{ ...item, refund_due_paise: -1 }] }, { ...finance(), items: [{ ...item, currency: 'USD' }] }]) assert.throws(() => assertEventFinance(value, eventId, student));
});
test('manual refunds require current permission, issued-money verification and the exact available balance', () => {
  const values = { amount: '100', method: 'bank_transfer', reference: 'School bank reference', reason: 'Refund already issued', issued: true };
  const body = eventRefundInput(item, values, true); assert.equal(body.amount_paise, 10000); assert.equal('expected_revision' in body, false); assert.equal('paid' in body, false);
  for (const patch of [{ amount: '100.01' }, { issued: false }, { method: 'online_gateway' }, { reference: '' }, { reason: 'ok' }]) assert.throws(() => eventRefundInput(item, { ...values, ...patch }, true));
  assert.throws(() => eventRefundInput(item, values, false));
});
test('paid-place withdrawal uses the exact owner permission and does not claim any refund was paid', () => {
  assert.deepEqual(eventWithdrawalInput(item, ' Family plan changed '), { reason: 'Family plan changed' });
  assert.throws(() => eventWithdrawalInput({ ...item, can_withdraw: false }, 'Family plan changed')); assert.throws(() => eventWithdrawalInput(item, 'no'));
});
test('physical event observations require an explicit observed time and exact roster membership', () => {
  const edits = { [student]: { status: 'present', note: '', observed_at: null, readiness_contradiction_note: '' } }, rows = [{ student_id: student, readiness_blockers: [] }];
  assert.throws(() => eventObservationRecords(edits, rows));
  assert.equal(eventObservationRecords({ [student]: { ...edits[student]!, observed_at: '2026-10-27T09:00:00Z' } }, rows)[0]!.observed_at, '2026-10-27T09:00:00.000Z');
  assert.throws(() => eventObservationRecords({ [sibling]: { ...edits[student]!, observed_at: '2026-10-27T09:00:00Z' } }, rows));
  assert.throws(() => eventObservationRecords({ [student]: { ...edits[student]!, observed_at: '2026-10-27T09:00:00Z' } }, [{ ...rows[0]!, readiness_blockers: ['guardian_consent'] }]));
});
test('nonphysical decisions never retain an old physical time or readiness exception', () => {
  const record = eventObservationRecords({ [student]: { status: 'excused', note: 'Approved exception', observed_at: '2026-10-27T09:00:00Z', readiness_contradiction_note: 'old physical evidence' } }, [{ student_id: student, readiness_blockers: ['guardian_consent'] }])[0]!;
  assert.equal(record.observed_at, null); assert.equal(record.readiness_contradiction_note, null);
});
test('changing check-out to a nonphysical status clears evidence and never falls back to an old check-in', () => {
  const row = { attendance_status: 'checked_out', note: '', checked_in_at: '2026-10-27T09:00:00Z', checked_out_at: '2026-10-27T10:00:00Z', readiness_contradiction_note: 'Actual observation' };
  const excused = changeEventObservation(row, undefined, { status: 'excused' });
  assert.equal(excused.observed_at, null); assert.equal(excused.readiness_contradiction_note, '');
  const present = changeEventObservation(row, excused, { status: 'present' });
  assert.equal(present.observed_at, null);
  assert.throws(() => eventObservationRecords({ [student]: present }, [{ student_id: student, readiness_blockers: [] }]));
  assert.equal(changeEventObservation(row, undefined, { status: 'present' }).observed_at, row.checked_in_at);
  assert.equal(changeEventObservation(row, { ...present, status: 'present', observed_at: row.checked_in_at }, { status: 'checked_out' }).observed_at, row.checked_out_at);
});
test('saved event source proof rejects incomplete authority and duplicate nested identities', () => {
  const event = source(); assert.doesNotThrow(() => assertNativeEvent(event, school, eventId));
  for (const value of [{ ...event, permissions: { ...event.permissions, can_edit: 'true' } }, { ...event, sessions: [event.sessions[0], event.sessions[0]] }, { ...event, checklist: [{ label: 'Water', required: true }] }, { ...event, audience: null }]) assert.throws(() => assertNativeEvent(value, school, eventId));
});
test('accepted event reads bind exact campus/event/participant and never use a different saved row as receipt', () => {
  const action: NativePendingAction = { version: 1, domain: 'events', scope, clientId: key, ownerHref: '/areas/events/manage', endpoint: `/api/v1/campus-events/${eventId}/save`, refreshPath: eventDetailRead(school, eventId), method: 'POST', payload: { kind: 'json', body: '{}' }, source: { kind: 'event', sourceId: eventId, revision: 3 }, phase: 'accepted', replayPolicy: 'same_request', createdAt: '2026-10-27T09:00:00Z' };
  assert.doesNotThrow(() => assertEventRead(source(), action));
  assert.throws(() => assertEventRead({ ...source(), school_id: id(30) }, action));
  assert.throws(() => assertEventRead({ ...source(), id: id(30) }, action));
  assert.throws(() => assertEventRead(source(), { ...action, refreshPath: eventDetailRead(school, eventId, student) }));
  const participant = { student_id: student, student_name: 'Learner A', participation_requirement: 'optional', rsvp_status: 'accepted', rsvp_revision: 1, consent_status: 'pending', consent_revision: 0, consent_readiness: 'not_required', payment_status: 'not_required', fee_invoice_id: null, checklist_completed_item_ids: [] };
  assert.doesNotThrow(() => assertEventRead({ ...source(), viewer_participants: [participant] }, { ...action, refreshPath: eventDetailRead(school, eventId, student) }));
  assert.throws(() => assertEventRead({ ...source(), viewer_participants: [{ ...participant, student_id: sibling }] }, { ...action, refreshPath: eventDetailRead(school, eventId, student) }));
  assert.throws(() => assertEventRead({ ...finance(), items: [{ ...item, student_id: sibling }] }, { ...action, refreshPath: eventFinanceRead(school, eventId, student) }));
  assert.throws(() => assertEventRead({ event: { id: eventId }, session: { id: id(30), revision: 3 } }, { ...action, refreshPath: `/api/v1/campus-events/${eventId}/sessions/${sessionId}/roster?school_id=${school}` }));
});
test('lost event-creation response recovers the same key/body and resolves the exact new detail', async () => {
  const store = memory(), sent: NativePendingAction[] = []; let lose = true;
  const create = () => new NativePendingActionJournal({ scope, domain: 'events', storage: store.storage, randomId: () => key, send: async action => { sent.push(action); if (lose) throw new Error('Lost reply'); return source(); }, read: async action => { assert.equal(action.refreshPath, eventDetailRead(school, eventId)); return source(); } });
  const first = create(); await first.hydrate(); assert.equal(await first.run(creation(), context), false); assert.equal(first.snapshot().action?.phase, 'unknown');
  lose = false; const resumed = create(); await resumed.hydrate(); assert.equal(await resumed.recover(context), true);
  assert.deepEqual(sent[0]!.payload, sent[1]!.payload); assert.equal(sent[0]!.clientId, sent[1]!.clientId); assert.equal(store.raw, null);
});
test('an accepted create with a failed source refresh recovers through reads only', async () => {
  const store = memory(); let sends = 0, failRead = true;
  const create = () => new NativePendingActionJournal({ scope, domain: 'events', storage: store.storage, randomId: () => key, send: async () => { sends++; return source(); }, read: async () => { if (failRead) throw new Error('Read unavailable'); return source(); } });
  const first = create(); await first.hydrate(); await first.run(creation(), context); assert.equal(first.snapshot().action?.phase, 'accepted');
  failRead = false; const resumed = create(); await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1);
});
test('a wrong-campus create response leaves original bytes retained and never follows its source', async () => {
  const store = memory(); let reads = 0;
  const journal = new NativePendingActionJournal({ scope, domain: 'events', storage: store.storage, randomId: () => key, send: async () => ({ ...source(), school_id: id(30) }), read: async () => { reads++; return source(); } });
  await journal.hydrate(); assert.equal(await journal.run(creation(), context), false); assert.equal(journal.snapshot().action?.phase, 'unknown'); assert.equal(reads, 0); assert.ok(store.raw);
});
test('unknown manual-refund retries retain exact learner/body after a later generic refusal', async () => {
  const store = memory(), sent: NativePendingAction[] = []; let failure: 'lost' | 'refused' | null = 'lost';
  const create = () => new NativePendingActionJournal({ scope, domain: 'events', storage: store.storage, randomId: () => key, send: async action => { sent.push(action); if (failure === 'lost') throw new Error('Lost refund response'); if (failure === 'refused') throw { status: 400 }; return finance(); }, read: async () => finance() });
  const input: NativePendingInput = { endpoint: `/api/v1/campus-events/${eventId}/participants/${student}/refunds`, body: { school_id: school, amount_paise: 10000, method: 'cash', reference: 'Cash receipt', reason: 'Refund already issued' }, serverKey: 'idempotency_key', source: { kind: 'event_finance_participant', sourceId: student, revision: 3, fingerprint: 'b'.repeat(64) } };
  const own = { ...context, ownerHref: `/areas/events/manage/${eventId}`, refreshPath: eventFinanceRead(school, eventId, student) }, first = create(); await first.hydrate(); await first.run(input, own);
  failure = 'refused'; const resumed = create(); await resumed.hydrate(); assert.equal(await resumed.recover(own), false); assert.ok(store.raw); assert.equal(resumed.snapshot().action?.phase, 'unknown');
  failure = null; assert.equal(await resumed.recover(own), true); assert.deepEqual(sent[0]!.payload, sent[2]!.payload); assert.equal(store.raw, null);
});
test('secure event-journal preparation failure prevents any campus command dispatch', async () => {
  let sends = 0; const journal = new NativePendingActionJournal({ scope, domain: 'events', storage: { read: async () => null, write: async () => { throw new Error('Keychain locked'); }, clear: async () => {} }, randomId: () => key, send: async () => { sends++; return source(); }, read: async () => source() });
  await journal.hydrate(); assert.equal(await journal.run(creation(), context), false); assert.equal(sends, 0); assert.equal(journal.snapshot().blocked, true);
});
