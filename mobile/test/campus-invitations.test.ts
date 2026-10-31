import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedCampusInvitation, campusInvitationActionAllowed, campusInvitationBody, campusInvitationDeliveryPending, campusInvitationListIdentity, campusInvitationSource, campusInvitationStatus, campusInvitationsRoot, parseCampusInvitation, parseCampusInvitationWorkspace, resolveCampusInvitationRefresh } from '../src/lib/campus-invitations';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';
const school = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', student = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444', key = '55555555-5555-4555-8555-555555555555';
const scope: NativePendingScope = { actorId: 'actor', schoolId: school, mode: 'live', namespaceId: null, origin: 'https://campus.example' }, root = campusInvitationsRoot(school);
const detail = { id, school_id: school, email: 'teacher@example.test', role: 'staff', person_id: person, access_scope: 'institution', work_source_kind: null, work_source_id: null, work_access_id: null, work_visit_access_id: null, expires_at: '2026-10-29T12:00:00Z', accepted_at: null, revoked_at: null, delivery: 'queued', delivery_job_id: key, token: 'never-retain-this' };
const workspace = { invitations: [detail], staff: [{ id: person, name: 'Teacher', staff_code: 'T01', email: 'teacher@example.test' }], students: [{ id: student, name: 'Learner', admission_number: 'S01', email: null }], guardians: [{ id: key, name: 'Guardian', email: null }], roles: [], can_invite_admin: false };
const body = { email: detail.email, role: 'staff', person_id: person };
function creation(overrides: Partial<NativePendingAction> = {}): NativePendingAction { return { version: 1, domain: 'people', scope, clientId: key, ownerHref: '/more/setup/people/invitations?create=invitation', endpoint: root, refreshPath: root + 'workspace/', method: 'POST', payload: { kind: 'json', body: JSON.stringify(body) }, source: { kind: 'campus_invitation_creation', sourceId: school, revision: 0, fingerprint: JSON.stringify(body) }, phase: 'prepared', replayPolicy: 'inspect_only', createdAt: '2026-10-29T10:00:00Z', ...overrides }; }
const parsed = () => parseCampusInvitation(detail, school, id, true);
function management(action: 'resend' | 'revoke') { return creation({ endpoint: `${root}${id}/${action}/`, refreshPath: `${root}${id}/`, payload: { kind: 'json', body: '{}' }, source: campusInvitationSource(parsed()) }); }
test('workspace parsing validates rows, target identities and delivery states while omitting private credentials', () => {
  const result = parseCampusInvitationWorkspace(workspace, school); assert.equal(result.staff[0]!.reference, 'T01'); assert.equal(JSON.stringify(result).includes('never-retain-this'), false);
  for (const changed of [{ ...workspace, can_invite_admin: 'yes' }, { ...workspace, staff: [null] }, { ...workspace, students: [...workspace.students, ...workspace.students] }, { ...workspace, invitations: [{ ...detail, role: 'invented' }] }, { ...workspace, invitations: [{ ...detail, delivery: 'delivered' }] }, { ...workspace, invitations: [{ ...detail, expires_at: 'bad' }] }]) assert.throws(() => parseCampusInvitationWorkspace(changed, school));
});
test('creation uses exact current staff/student/guardian records and conditional admin authority', () => {
  const source = parseCampusInvitationWorkspace(workspace, school);
  assert.deepEqual(campusInvitationBody('staff', person, ' TEACHER@example.test ', source), body);
  assert.throws(() => campusInvitationBody('staff', '', detail.email, source)); assert.throws(() => campusInvitationBody('student', person, detail.email, source));
  assert.deepEqual(campusInvitationBody('student', student, detail.email, source), { email: detail.email, role: 'student', student_id: student });
  assert.deepEqual(campusInvitationBody('guardian', '', detail.email, source), { email: detail.email, role: 'guardian' });
  assert.throws(() => campusInvitationBody('admin', '', detail.email, source)); assert.deepEqual(campusInvitationBody('admin', '', detail.email, { ...source, can_invite_admin: true }), { email: detail.email, role: 'admin' });
});
test('directory row comparison does not invent target fields omitted by the directory wire', () => {
  const { school_id, person_id, access_scope, work_source_kind, work_source_id, work_access_id, work_visit_access_id, token, ...list } = detail;
  assert.equal(campusInvitationListIdentity(parseCampusInvitation(list, school)), campusInvitationListIdentity(parsed()));
  assert.notEqual(campusInvitationListIdentity(parsed()), campusInvitationListIdentity({ ...parsed(), delivery_job_id: person }));
});
test('invitation state and provider acceptance remain separate from recipient acceptance', () => {
  const row = parsed(); assert.equal(campusInvitationStatus(row, Date.parse('2026-10-29T10:00:00Z')), 'Pending'); assert.equal(campusInvitationStatus(row, Date.parse('2026-10-29T13:00:00Z')), 'Expired');
  assert.equal(campusInvitationStatus({ ...row, delivery: 'email_accepted' }, Date.parse('2026-10-29T10:00:00Z')), 'Pending'); assert.equal(campusInvitationStatus({ ...row, accepted_at: row.expires_at, revoked_at: row.expires_at }), 'Accepted'); assert.equal(campusInvitationDeliveryPending('sending'), true); assert.equal(campusInvitationDeliveryPending('email_accepted'), false);
});
test('legacy journal subtype rejects Simulation, another campus/owner, replay keys and retained secrets', () => {
  assert.equal(campusInvitationActionAllowed(creation(), scope), true);
  for (const changed of [creation({ replayPolicy: 'same_request' }), creation({ ownerHref: '/more/setup/people/invitations?school=' + person }), creation({ ownerHref: '/areas/people/participants' }), creation({ method: 'PATCH' }), creation({ endpoint: campusInvitationsRoot(person) }), creation({ payload: { kind: 'json', body: JSON.stringify({ ...body, token: 'secret' }) } }), creation({ source: { ...creation().source!, fingerprint: JSON.stringify({ ...body, idempotency_key: key }) } })]) assert.equal(campusInvitationActionAllowed(changed, scope), false);
  assert.equal(campusInvitationActionAllowed(creation(), { ...scope, mode: 'simulation', namespaceId: id }), false);
  const source = campusInvitationSource(parsed()); assert.equal(campusInvitationActionAllowed(management('resend'), scope), true);
  assert.equal(campusInvitationActionAllowed(management('revoke'), scope), true);
  assert.equal(campusInvitationActionAllowed(management('resend'), { ...scope, schoolId: person }), false);
  assert.equal(campusInvitationActionAllowed({ ...management('resend'), source: { ...source, fingerprint: JSON.stringify({ ...parsed(), token: 'secret' }) } }, scope), false);
});
test('first acknowledged creation resolves to its exact detail ID and never retains returned token', () => {
  const action = creation(), path = resolveCampusInvitationRefresh(detail, action); assert.equal(path, `${root}${id}/`);
  const accepted = { ...action, phase: 'accepted' as const, refreshPath: path }; assert.equal(campusInvitationActionAllowed(accepted, scope), true); assert.equal(acceptedCampusInvitation(detail, accepted).person_id, person); assert.equal(JSON.stringify(accepted).includes('never-retain-this'), false);
  for (const value of [{ ...detail, id: undefined }, { ...detail, email: 'other@example.test' }, { ...detail, expires_at: 'bad' }]) assert.throws(() => resolveCampusInvitationRefresh(value, action));
  for (const value of [{ ...detail, school_id: person }, { ...detail, person_id: student }, { ...detail, role: 'admin' }]) assert.throws(() => acceptedCampusInvitation(value, accepted));
});
test('management keeps exact access source and requires revocation after its acknowledgement', () => {
  const resend = management('resend'); assert.equal(resolveCampusInvitationRefresh(detail, resend), `${root}${id}/`); assert.throws(() => resolveCampusInvitationRefresh({ ...detail, id: key }, resend));
  const revoke = { ...management('revoke'), phase: 'accepted' as const }; assert.throws(() => resolveCampusInvitationRefresh({}, revoke)); assert.equal(resolveCampusInvitationRefresh({ revoked: true }, revoke), `${root}${id}/`);
  assert.throws(() => acceptedCampusInvitation(detail, revoke)); assert.equal(acceptedCampusInvitation({ ...detail, revoked_at: detail.expires_at }, revoke).id, id);
  assert.throws(() => acceptedCampusInvitation({ ...detail, person_id: student }, { ...resend, phase: 'accepted' }));
});
function memory() { let raw: string | null = null; const storage: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } }; return { storage, get raw() { return raw; } }; }
test('lost generic invitation acknowledgement remains inspect-only across relaunch even if list matches', async () => {
  const saved = memory(); let sends = 0, reads = 0;
  const options = { scope, domain: 'people' as const, storage: saved.storage, randomId: () => key, send: async () => { sends++; throw new Error('Response lost'); }, read: async () => { reads++; return workspace; } };
  const first = new NativePendingActionJournal(options); await first.hydrate(); const original = creation();
  const input = { endpoint: original.endpoint, body, serverKey: null, replayPolicy: 'inspect_only' as const, source: original.source };
  const context = { ownerHref: original.ownerHref, refreshPath: original.refreshPath, assertActive() {}, resolveRefreshPath: resolveCampusInvitationRefresh, accepted: acceptedCampusInvitation };
  await first.run(input, { ...context, accepted: () => {} }); assert.ok(saved.raw);
  const restarted = new NativePendingActionJournal(options); await restarted.hydrate(); assert.equal(await restarted.recover({ ...context, accepted: () => {} }), false); assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(restarted.snapshot().action?.phase, 'unknown');
});
test('acknowledged exact ID survives failed detail read and recovers by read only', async () => {
  const saved = memory(); let sends = 0, reads = 0;
  const options = { scope, domain: 'people' as const, storage: saved.storage, randomId: () => key, send: async () => { sends++; return detail; }, read: async () => { if (++reads === 1) throw new Error('Detail unavailable'); return detail; } };
  const first = new NativePendingActionJournal(options); await first.hydrate(); const original = creation(), context = { ownerHref: original.ownerHref, refreshPath: original.refreshPath, assertActive() {}, resolveRefreshPath: resolveCampusInvitationRefresh, accepted: (value: unknown, _assert: () => void, action: NativePendingAction) => { acceptedCampusInvitation(value, action); } };
  await first.run({ endpoint: original.endpoint, body, serverKey: null, replayPolicy: 'inspect_only', source: original.source }, context); assert.equal(first.snapshot().action?.phase, 'accepted'); assert.equal(JSON.stringify(JSON.parse(saved.raw!)).includes('never-retain-this'), false);
  const restarted = new NativePendingActionJournal(options); await restarted.hydrate(); assert.equal(await restarted.recover(context), true); assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(saved.raw, null);
});
