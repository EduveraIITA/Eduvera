import assert from 'node:assert/strict';
import test from 'node:test';
import { careActionBody, careAttentionProof, careAvailableActions, careCurrentInstant, careHref, careIntakeBody, careRecoveryBody, careRoleAcknowledgement, careRoot, careRoute, careTeamBody, newCareIntake, parseCareDetail, parseCareOrphans, parseCareWorkspace } from '../src/lib/care-native';
const campus = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222', caseId = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444', student = '55555555-5555-4555-8555-555555555555', entry = '66666666-6666-4666-8666-666666666666', command = '77777777-7777-4777-8777-777777777777';
const at = '2026-10-29T12:00:00.000Z';
const summary = { id: caseId, student_id: student, owner_user_id: actor, intake_route: 'alternate', urgency: 'priority', concern_category: 'emotional_wellbeing', safety_state: 'unknown', status: 'active', reporting_state: 'assessment_required', opened_at: at, last_activity_at: at, revision: 3, assignment_role: 'owner', access_level: 'full', subject_name: 'Fictional learner', owner_name: 'Fictional care lead' };
const workspace = { can_manage_team: true, cases: [summary], team: [], candidates: [{ id: other, name: 'Eligible lead', email: 'lead@example.invalid', role: 'staff' }], eligible_students: [{ id: student, name: 'Fictional learner', admission_number: 'S1' }], routes: { primary: 1, alternate: 1 }, legal_notice: 'Follow the approved procedure.' };
function detailWire() { const { assignment_role, access_level, ...item } = summary; return { case: { ...item, school_id: campus, ordinary_handler_involved: true, source_kind: 'staff_observation', observed_at: null, admission_number: 'S1', reporter_name: 'Reporter' }, access: { assignment_role, access_level }, entries: [{ id: entry, entry_type: 'case_note', note: 'Protected synthetic note.', created_by: actor, created_at: at }], external_reports: [], audits: [], handover_candidates: [{ id: other, name: 'Eligible lead', role_kind: 'deputy_lead' }], source_content_omitted: false }; }
test('Care routes retain exact selectors and refuse duplicates, conflicts, empty identities and MessageReports ownership', () => {
  const href = `/areas/care/concerns?section=cases&case=${caseId}&case_revision=3&care_page=2`;
  assert.equal(careRoute(href)?.caseId, caseId); assert.equal(careRoute(href)?.revision, 3);
  for (const value of ['/areas/care/concerns?case=', '/areas/care/concerns?section=message_reports', `${href}&case=${other}`, `${href}&create=concern`, `/areas/care/concerns?section=team&case=${caseId}`, '/areas/care/concerns?case_revision=3', '/areas/care/concerns?care_page=NaN', '//foreign/areas/care/concerns', '/areas/care/concerns/other']) assert.equal(careRoute(value), null);
  assert.equal(careHref(href, { section: 'cases' }), '/areas/care/concerns?section=cases&care_page=2');
  assert.equal(careRoot(campus), `/api/v1/schools/${campus}/restricted-care`); assert.throws(() => careRoot('../other'));
});
test('Care workspace validates finite counts and current staff lists without inventing administrator case access', () => {
  assert.equal(parseCareWorkspace(workspace).cases.length, 1);
  assert.equal(parseCareWorkspace({ ...workspace, cases: [] }).cases.length, 0);
  assert.throws(() => parseCareWorkspace({ ...workspace, routes: { primary: NaN, alternate: 0 } }));
  assert.throws(() => parseCareWorkspace({ ...workspace, can_manage_team: false }));
  assert.throws(() => parseCareWorkspace({ ...workspace, cases: [summary, summary] }));
  assert.throws(() => parseCareWorkspace({ ...workspace, eligible_students: [{ id: '../student', name: 'Wrong', admission_number: 'x' }] }));
});
test('actual detail wire keeps access separate from case, verifies exact campus/case and strips audit metadata', () => {
  const wire = detailWire(), parsed = parseCareDetail({ ...wire, audits: [{ id: other, action: 'restricted_care.case.entry_added', actor_name: 'Lead', created_at: at, metadata: { protected_text: 'must never be projected' } }] }, caseId, campus, actor);
  assert.equal(parsed.access.access_level, 'full'); assert.equal(parsed.case.revision, 3); assert.deepEqual(parsed.audits[0]?.metadata, {});
  assert.throws(() => parseCareDetail(wire, other, campus, actor)); assert.throws(() => parseCareDetail(wire, caseId, other, actor));
});
test('intake-only reporter wire rejects later entries, somebody else’s intake and privileged sections', () => {
  const wire = detailWire(), reporter = { ...wire, access: { assignment_role: 'reporter', access_level: 'intake_only' }, entries: [{ ...wire.entries[0]!, entry_type: 'intake_note' }], handover_candidates: [] };
  assert.equal(parseCareDetail(reporter, caseId, campus, actor).entries.length, 1);
  for (const changed of [{ ...reporter, entries: wire.entries }, { ...reporter, entries: [{ ...reporter.entries[0]!, created_by: other }] }, { ...reporter, handover_candidates: wire.handover_candidates }, { ...reporter, audits: [{ id: other, action: 'restricted_care.case.opened', actor_name: 'Lead', created_at: at }] }]) assert.throws(() => parseCareDetail(changed, caseId, campus, actor));
});
test('Simulation omission remains explicit and never becomes a claim of empty original history', () => {
  const wire = { ...detailWire(), source_content_omitted: true, entries: [] }, parsed = parseCareDetail(wire, caseId, campus, actor);
  assert.equal(parsed.source_content_omitted, true); assert.equal(parsed.entries.length, 0);
  assert.throws(() => parseCareDetail({ ...wire, source_content_omitted: 'true' }, caseId, campus, actor));
});
test('Simulation temporal controls use the verified world clock and cannot fall back to device time', () => {
  let deviceReads = 0; const device = () => { deviceReads++; return '2040-01-01T00:00:00.000Z'; };
  assert.equal(careCurrentInstant('simulation', at, device), at);
  assert.equal(careCurrentInstant('simulation', undefined, device), ''); assert.equal(careCurrentInstant('simulation', 'not-an-instant', device), ''); assert.equal(deviceReads, 0);
  assert.equal(careCurrentInstant('live', at, device), '2040-01-01T00:00:00.000Z'); assert.equal(deviceReads, 1);
});
test('intake forces alternate route for involved handler and permits only an exact assigned student or no selection', () => {
  const base = { ...newCareIntake(), details: 'A factual synthetic intake for a test.' }, data = parseCareWorkspace(workspace);
  const body = careIntakeBody(base, data, command); assert.equal(body.student_id, null); assert.equal(body.command_id, command); assert.equal(body.observed_at, null);
  assert.equal(careIntakeBody({ ...base, student_id: student }, data, command).student_id, student);
  assert.throws(() => careIntakeBody({ ...base, ordinary_handler_involved: true }, data, command));
  assert.equal(careIntakeBody({ ...base, ordinary_handler_involved: true, intake_route: 'alternate' }, data, command).intake_route, 'alternate');
  assert.throws(() => careIntakeBody({ ...base, student_id: other }, data, command)); assert.throws(() => careIntakeBody({ ...base, details: 'short' }, data, command));
});
test('case actions come from exact access and assignment rather than team membership or a role label', () => {
  const detail = parseCareDetail(detailWire(), caseId, campus, actor);
  assert.ok(careAvailableActions(detail).includes('reassign')); assert.ok(careAvailableActions(detail).includes('external_report'));
  assert.equal(careAvailableActions({ ...detail, access: { assignment_role: 'contributor', access_level: 'full' } }).includes('external_report'), false);
  assert.equal(careAvailableActions({ ...detail, access: { assignment_role: 'reviewer', access_level: 'full' } }).includes('reassign'), false);
  assert.deepEqual(careAvailableActions({ ...detail, access: { assignment_role: 'reporter', access_level: 'intake_only' } }), []);
  assert.deepEqual(careAvailableActions({ ...detail, case: { ...detail.case, status: 'closed' } }), []);
});
test('external-report action preserves actual reported time, enforces future boundary and bounded private reference', () => {
  const detail = parseCareDetail(detailWire(), caseId, campus, actor), draft = { note: 'Private external reference', owner: '', authority: 'local_police', reportedAt: '2026-10-29T11:59:00Z', revision: 3 };
  const body = careActionBody(detail, 'external_report', draft, at, command); assert.equal(body.reported_at, '2026-10-29T11:59:00.000Z'); assert.equal(body.reference, draft.note); assert.equal(body.expected_revision, 3); assert.equal('created_at' in body, false);
  assert.throws(() => careActionBody(detail, 'external_report', { ...draft, reportedAt: '2026-10-29T12:00:01Z' }, at, command));
  assert.throws(() => careActionBody(detail, 'external_report', { ...draft, note: 'x'.repeat(1001) }, at, command));
});
test('closure, handover and stale source checks preserve human reporting and current eligible-owner rules', () => {
  const detail = parseCareDetail(detailWire(), caseId, campus, actor), draft = { note: 'A factual synthetic outcome or handover.', owner: other, authority: 'local_police', reportedAt: at, revision: 3 };
  assert.throws(() => careActionBody(detail, 'closed', draft, at, command));
  assert.equal(careActionBody({ ...detail, case: { ...detail.case, reporting_state: 'reported' } }, 'closed', draft, at, command).status, 'closed');
  assert.equal(careActionBody(detail, 'reassign', draft, at, command).owner_user_id, other);
  assert.throws(() => careActionBody(detail, 'reassign', { ...draft, owner: actor }, at, command));
  assert.throws(() => careActionBody(detail, 'case_note', { ...draft, revision: 2 }, at, command));
});
test('administrator orphan recovery exposes only routing metadata and requires exact current revision/candidate', () => {
  const parsed = parseCareOrphans({ cases: [{ id: caseId, revision: 3, intake_route: 'alternate', owner_name: 'Former lead', candidates: [{ id: other, name: 'Eligible lead', role_kind: 'deputy_lead' }], protected_note: 'not projected' }], page: 1, total: 1, pages: 1 });
  assert.equal('protected_note' in parsed.cases[0]!, false); const selected = parsed.cases[0]!;
  assert.equal(careRecoveryBody(selected, other, 'A factual synthetic recovery reason.', 3, command).owner_user_id, other);
  assert.throws(() => careRecoveryBody(selected, actor, 'A factual synthetic recovery reason.', 3, command));
  assert.throws(() => careRecoveryBody(selected, other, 'A factual synthetic recovery reason.', 2, command));
  assert.throws(() => parseCareOrphans({ cases: [], page: 1, total: 30, pages: 1 }));
});
test('care-team bodies and keyless acknowledgements use current candidate, date, source and revision', () => {
  const data = parseCareWorkspace(workspace); assert.deepEqual(careTeamBody(data, other, 'deputy_lead', 'alternate', '2026-10-29'), { user_id: other, role_kind: 'deputy_lead', route_kind: 'alternate', valid_from: '2026-10-29', valid_until: null });
  assert.throws(() => careTeamBody({ ...data, can_manage_team: false }, other, 'deputy_lead', 'alternate', '2026-10-29')); assert.throws(() => careTeamBody(data, actor, 'deputy_lead', 'alternate', '2026-10-29'));
  assert.throws(() => careTeamBody(data, other, 'deputy_lead', 'alternate', '2026-02-29'));
  const expected = { id: entry, userId: other, revision: 3, role: 'deputy_lead', route: 'alternate', status: 'revoked' };
  careRoleAcknowledgement({ id: entry, user_id: other, revision: 4, role_kind: 'deputy_lead', route_kind: 'alternate', status: 'revoked' }, expected);
  assert.throws(() => careRoleAcknowledgement({ id: entry, user_id: actor, revision: 4, role_kind: 'deputy_lead', route_kind: 'alternate', status: 'revoked' }, expected));
});
test('care attention acknowledges only the exact visible case and revision, never a different case or stale alert', () => {
  const detail = parseCareDetail(detailWire(), caseId, campus, actor), href = `/areas/care/concerns?section=cases&case=${caseId}&case_revision=3&attention_notification_id=${entry}`;
  assert.equal(careAttentionProof(href, detail)?.notificationId, entry); assert.equal(careAttentionProof(href, { ...detail, case: { ...detail.case, revision: 4 } }), null); assert.equal(careAttentionProof(href, null), null);
  assert.equal(careAttentionProof(href + `&case=${other}`, detail), null);
});
