import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest, WorkspaceAreaSurface } from '../../packages/contracts/src/workspace';
import { academicAttendanceSource, academicAttendanceHref, academicAttendancePath, academicAttendanceHistoryPath, academicRosterPage, assertAcademicAttendanceAccess, normalizeAcademicAttendanceDetail, normalizeAcademicAttendanceHistory } from '../src/lib/academic-attendance';

const school = '11111111-1111-4111-8111-111111111111', classId = '22222222-2222-4222-8222-222222222222', otherClass = '33333333-3333-4333-8333-333333333333', term = '44444444-4444-4444-8444-444444444444', registerId = '55555555-5555-4555-8555-555555555555', sessionId = '66666666-6666-4666-8666-666666666666', student = '77777777-7777-4777-8777-777777777777';
const source = { kind: 'daily_class' as const, classSectionId: classId, date: '2026-10-27' };
const surface: WorkspaceAreaSurface = { key: 'registers', label: 'Registers', href: '/areas/attendance/registers', capabilities: ['attendance.view'], scopes: [{ kind: 'institution', id: school }] };
const manifest = { context: { actor_user_id: 'actor', institution_id: school, environment: { kind: 'live' } }, areas: [{ key: 'attendance', surfaces: [surface] }] } as unknown as WorkspaceManifest;
const expected = { actorUserId: 'actor', institutionId: school, environment: { mode: 'live' as const } };
function wire() { return { date: source.date, class: { id: classId, school_id: school, term_id: term, name: 'Class 7A', term: 'Term 1', room: 'Room 7' }, register: { id: registerId, state: 'submitted', revision: 4, submitted_by_name: 'Recorder', submitted_at: '2026-10-27T10:00:00Z' }, availability: { can_mark: false, reason: 'Submitted for review.' }, roster: [{ id: student, name: 'Learner', roll_number: 1, admission_number: 'A1', status: null, remarks: '' }], pending_evidence: [] }; }
const normalized = () => normalizeAcademicAttendanceDetail(wire(), source, school, surface);

test('daily class/day and scheduled session links preserve exact ordinary API sources', () => {
  const daily = academicAttendanceSource(`/areas/attendance/registers?class_section_id=${classId}&date=2026-10-27`);
  assert.deepEqual(daily, source);
  assert.deepEqual(academicAttendanceSource(`/areas/attendance/registers?class_section_id=${classId}&date=2026-10-27#queue`), source);
  assert.equal(academicAttendancePath(source), `/api/v1/attendance-registers/${classId}/?date=2026-10-27`);
  assert.equal(academicAttendanceHistoryPath(source), `/api/v1/attendance-registers/${classId}/history/?date=2026-10-27`);
  const session = academicAttendanceSource(`/areas/attendance/registers?session_id=${sessionId}&date=2026-10-27&student_id=${student}`);
  assert.ok(session);
  assert.equal(academicAttendancePath(session), `/api/v1/attendance-model/sessions/${sessionId}`);
  assert.equal(academicAttendanceHistoryPath(session), `/api/v1/attendance-model/sessions/${sessionId}/history`);
  assert.match(academicAttendanceHref(session), new RegExp(`student_id=${student}`));
  assert.equal(academicAttendanceSource('/areas/attendance/registers?date=2026-10-27'), null);
});
test('ambiguous, invalid, missing-day and mixed attendance source links fail before any read', () => {
  for (const query of [`class_section_id=${classId}`, `class_section_id=${classId}&date=2026-02-30`, `session_id=not-a-session`, `session_id=${sessionId}&session_id=${registerId}`, `class_section_id=${classId}&date=2026-10-27&session_id=${sessionId}`, `class_section_id=${classId}&date=2026-10-27&register_id=${registerId}`, `session_id=${sessionId}&student_id=`, `class_section_id=${classId}&date=2026-10-27&review_case=${registerId}`, `class_section_id=${classId}&date=2026-10-27&scope=dependent`]) assert.throws(() => academicAttendanceSource(`/areas/attendance/registers?${query}`), query);
});
test('coordination parsing is not a coordination authority grant', () => {
  assert.deepEqual(academicAttendanceSource(`/areas/attendance/coordination?class_section_id=${classId}&date=2026-10-27`), source);
  const onlyCoordination = { ...manifest, areas: [{ key: 'attendance', surfaces: [{ ...surface, key: 'coordination', href: '/areas/attendance/coordination' }] }] } as unknown as WorkspaceManifest;
  assert.throws(() => assertAcademicAttendanceAccess(onlyCoordination, source, expected), /register responsibility/);
  assert.equal(assertAcademicAttendanceAccess(manifest, source, expected).key, 'registers');
});
test('actor, institution, world, unavailable and foreign class scopes remain closed', () => {
  for (const context of [{ ...expected, actorUserId: 'other' }, { ...expected, institutionId: otherClass }, { ...expected, environment: { mode: 'simulation' as const, namespace_id: 'world' } }]) assert.throws(() => assertAcademicAttendanceAccess(manifest, source, context), /account, campus and environment/);
  const sim = { ...manifest, context: { ...manifest.context, environment: { kind: 'simulation', namespace_id: 'world', virtual_now: '2026-10-27T10:00:00Z' } } } as WorkspaceManifest;
  assert.equal(assertAcademicAttendanceAccess(sim, source, { ...expected, environment: { mode: 'simulation', namespace_id: 'world' } }).key, 'registers');
  assert.throws(() => assertAcademicAttendanceAccess(sim, source, { ...expected, environment: { mode: 'simulation', namespace_id: 'world', unavailable: true } }));
  const foreign = { ...manifest, areas: [{ key: 'attendance', surfaces: [{ ...surface, scopes: [{ kind: 'class', id: otherClass }] }] }] } as unknown as WorkspaceManifest;
  assert.throws(() => assertAcademicAttendanceAccess(foreign, source, expected), /register responsibility/);
});
test('owning daily response validates identity and preserves unrecorded status', () => {
  const data = normalized();
  assert.equal(data.register.revision, 4); assert.equal(data.roster[0]?.status, null); assert.equal(data.availability.canMark, false);
  for (const patch of [{ date: '2026-10-28' }, { class: { ...wire().class, id: otherClass } }, { class: { ...wire().class, school_id: otherClass } }, { class: { ...wire().class, term_id: null } }, { register: { ...wire().register, revision: '4' } }, { attendance_scope: 'scheduled_session' }]) assert.throws(() => normalizeAcademicAttendanceDetail({ ...wire(), ...patch }, source, school, surface));
});
test('scheduled response must match exact session, register, dated class scope and selected learner', () => {
  const selected = { kind: 'scheduled_session' as const, sessionId, date: source.date, studentId: student };
  const value = { ...wire(), attendance_scope: 'scheduled_session', session: { id: sessionId, subject_name: 'Maths', starts_at: '09:00:00', ends_at: '09:45:00' }, register: { ...wire().register, id: sessionId } };
  assert.equal(normalizeAcademicAttendanceDetail(value, selected, school, surface).session?.id, sessionId);
  for (const patch of [{ session: { ...value.session, id: registerId } }, { register: { ...value.register, id: registerId } }, { date: '2026-10-28' }]) assert.throws(() => normalizeAcademicAttendanceDetail({ ...value, ...patch }, selected, school, surface));
  assert.throws(() => normalizeAcademicAttendanceDetail(value, selected, school, { ...surface, scopes: [{ kind: 'class', id: otherClass }] }));
  assert.throws(() => normalizeAcademicAttendanceDetail(value, { ...selected, studentId: otherClass }, school, surface), /focused learner/);
});
test('duplicate learners, missing decisions and unknown statuses never become attendance', () => {
  const row = wire().roster[0]!;
  for (const roster of [[row, row], [{ ...row, status: undefined }], [{ ...row, status: 'automatically_present' }], [{ ...row, id: null }]]) assert.throws(() => normalizeAcademicAttendanceDetail({ ...wire(), roster }, source, school, surface), /roster/);
  assert.throws(() => normalizeAcademicAttendanceDetail(wire(), { ...source, studentId: otherClass }, school, surface), /focused learner/);
});
test('empty draft with no register is legitimate; accepted state requires a saved identity', () => {
  assert.equal(normalizeAcademicAttendanceDetail({ ...wire(), register: { id: null, state: 'draft', revision: 0 }, roster: [] }, source, school, surface).register.id, null);
  assert.throws(() => normalizeAcademicAttendanceDetail({ ...wire(), register: { id: null, state: 'submitted', revision: 4 } }, source, school, surface), /identity or revision/);
});
test('roster pages are bounded to eight, clamp after filtering and never substitute a learner', () => {
  const rows = Array.from({ length: 19 }, (_, index) => ({ ...normalized().roster[0]!, id: String(index), name: `Learner ${index}`, admissionNumber: `A${index}`, status: index % 2 ? 'absent' as const : null }));
  assert.equal(academicRosterPage(rows, '', false, 1).rows.length, 8);
  assert.deepEqual(academicRosterPage(rows, 'A18', false, 3).rows.map(row => row.id), ['18']);
  assert.equal(academicRosterPage(rows, '', true, 1).total, 10);
  assert.equal(academicRosterPage(rows, 'foreign', false, 1).total, 0);
  assert.equal(academicRosterPage(rows, '', false, 99).page, 3);
});
test('history is bound to the same campus/class/term/day/register and cannot roll back revision', () => {
  const basis = normalized(), value = { date: basis.date, class: wire().class, register: wire().register, submissions: [{ id: sessionId, register_revision: 4, records_count: 1, changed_count: 1, created_at: '2026-10-27T10:00:00Z', submitted_by_name: 'Recorder' }], revisions: [] };
  assert.equal(normalizeAcademicAttendanceHistory(value, source, basis).length, 1);
  for (const patch of [{ date: '2026-10-26' }, { class: { ...value.class, school_id: otherClass } }, { class: { ...value.class, term_id: otherClass } }, { register: { ...value.register, id: sessionId } }, { register: { ...value.register, revision: 3 } }]) assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, ...patch }, source, basis), /history/);
  assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, submissions: [{ ...value.submissions[0], register_revision: 5 }] }, source, basis), /revision/);
  assert.throws(() => normalizeAcademicAttendanceHistory(value, { ...source, classSectionId: otherClass }, basis), /source/);
  assert.throws(() => normalizeAcademicAttendanceHistory(value, { ...source, date: '2026-10-26' }, basis), /source/);
  assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, submissions: [{ ...value.submissions[0], records_count: -1 }] }, source, basis), /counts/);
});

function scheduledHistoryFixture() {
  const selected = { kind: 'scheduled_session' as const, sessionId, date: source.date };
  const statuses = ['present', 'present', 'absent', 'present'] as const;
  const learners = [student, '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
  const saved = { ...wire(), attendance_scope: 'scheduled_session', session: { id: sessionId, subject_name: 'Science', starts_at: '09:00:00', ends_at: '09:45:00' }, register: { ...wire().register, id: sessionId, revision: 1 }, roster: learners.map((id, index) => ({ id, name: `Fictional learner ${index + 1}`, status: statuses[index], remarks: '' })) };
  const basis = normalizeAcademicAttendanceDetail(saved, selected, school, surface);
  const value = { date: basis.date, class: saved.class, register: saved.register,
    submissions: [{ id: registerId, register_revision: 1, records_count: 4, changed_count: 4, created_at: '2026-10-27T10:00:00Z', submitted_by_name: 'Recorder' }],
    revisions: learners.map((id, index) => ({ id: String(-index - 1), student_id: id, student_name: `Fictional learner ${index + 1}`, previous_status: null, new_status: statuses[index], previous_remarks: null, new_remarks: '', reason: 'Observed attendance', register_revision: 1, created_at: '2026-10-27T10:00:00Z', changed_by_name: 'Recorder' })) };
  return { selected, basis, value };
}

test('scheduled history accepts owning UUID submissions and negative bigint correction IDs without changing revision or learner decisions', () => {
  const { selected, basis, value } = scheduledHistoryFixture();
  const items = normalizeAcademicAttendanceHistory(value, selected, basis);
  assert.equal(items.length, 5);
  assert.deepEqual(items.filter(item => item.kind === 'correction').map(item => item.id).sort(), ['correction:-1', 'correction:-2', 'correction:-3', 'correction:-4']);
  assert.equal(items.find(item => item.kind === 'submission')?.detail, '4 recorded · 4 changed');
  assert.equal(items.find(item => item.id === 'correction:-3')?.detail, 'Fictional learner 3 · Absent · Observed attendance');
  assert.equal(items.every(item => item.revision === 1 && item.actor === 'Recorder'), true);
});

test('daily and scheduled correction identifiers preserve the full PostgreSQL bigint string range exactly', () => {
  const { selected, basis, value } = scheduledHistoryFixture();
  for (const id of ['1', '-1', '9007199254740993', '-9007199254740993', '9223372036854775807', '-9223372036854775808']) {
    const revisions = [{ ...value.revisions[0]!, id }];
    assert.equal(normalizeAcademicAttendanceHistory({ ...value, revisions }, selected, basis).find(item => item.kind === 'correction')?.id, `correction:${id}`);
    const daily = { ...value, register: wire().register, revisions: revisions.map(row => ({ ...row, register_revision: 4 })), submissions: [] };
    assert.equal(normalizeAcademicAttendanceHistory(daily, source, normalized())[0]?.id, `correction:${id}`);
  }
});

test('academic history refuses malformed, rounded, duplicate and wrongly typed correction identifiers', () => {
  const { selected, basis, value } = scheduledHistoryFixture();
  for (const id of [registerId, 1, -1, 9007199254740992, null, '', '0', '-0', '01', '-01', '+1', '1.0', '1e3', ' 1', '1 ', '9223372036854775808', '-9223372036854775809']) {
    assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, revisions: [{ ...value.revisions[0], id }] }, selected, basis), /unverified revision/);
  }
  assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, revisions: [value.revisions[0], value.revisions[0]] }, selected, basis), /unverified revision/);
  assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, submissions: [{ ...value.submissions[0], id: '-1' }] }, selected, basis), /unverified revision/);
});

test('legitimate signed correction IDs do not bypass scheduled history source, current revision, time or learner checks', () => {
  const { selected, basis, value } = scheduledHistoryFixture();
  for (const patch of [{ date: '2026-10-26' }, { class: { ...value.class, school_id: otherClass } }, { class: { ...value.class, id: otherClass } }, { class: { ...value.class, term_id: otherClass } }, { register: { ...value.register, id: registerId } }, { register: { ...value.register, revision: 0 } }]) {
    assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, ...patch }, selected, basis), /history/);
  }
  for (const patch of [{ register_revision: 2 }, { register_revision: '1' }, { created_at: 'invalid' }, { student_id: 'invalid' }, { new_status: 'inferred_present' }]) {
    assert.throws(() => normalizeAcademicAttendanceHistory({ ...value, revisions: [{ ...value.revisions[0], ...patch }] }, selected, basis), /revision|correction history/);
  }
});


test('current scheduled-session metadata has no daily signature and never becomes an offline continuity snapshot', () => {
  const selected = { kind: 'scheduled_session' as const, sessionId, date: source.date };
  // attendance-model.screenFromDb deliberately returns this non-offline DTO.
  const snapshot = { roster_fingerprint: 'a'.repeat(64), roster_count: 1, captured_at: '2026-10-27T03:00:00.000Z', expires_at: '2026-10-27T03:00:00.000Z', token: '' };
  const response = { ...wire(), attendance_scope: 'scheduled_session', session: { id: sessionId, subject_name: 'Maths', starts_at: '09:00:00', ends_at: '09:45:00' }, register: { ...wire().register, id: sessionId }, continuity_snapshot: snapshot };
  const detail = normalizeAcademicAttendanceDetail(response, selected, school, surface);
  assert.equal(detail.session?.id, sessionId); assert.equal(detail.continuitySnapshot, undefined);
  assert.equal(detail.roster[0]?.status, null); assert.equal(detail.register.revision, 4);
  for (const patch of [{ roster_count: 0 }, { roster_fingerprint: 'unverified' }, { captured_at: 'invalid' }, { token: 'a'.repeat(43) }, { expires_at: '2026-10-28T03:00:00.000Z' }]) {
    assert.throws(() => normalizeAcademicAttendanceDetail({ ...response, continuity_snapshot: { ...snapshot, ...patch } }, selected, school, surface), /snapshot|metadata/);
  }
});

test('daily continuity retains the exact signed DTO and rejects the unsigned session placeholder', () => {
  const snapshot = { roster_fingerprint: 'b'.repeat(64), roster_count: 1, captured_at: '2026-10-27T03:00:00.000Z', expires_at: '2026-10-28T03:00:00.000Z', token: 'A'.repeat(43) };
  const detail = normalizeAcademicAttendanceDetail({ ...wire(), continuity_snapshot: snapshot }, source, school, surface);
  assert.deepEqual(detail.continuitySnapshot, { fingerprint: snapshot.roster_fingerprint, count: 1, capturedAt: snapshot.captured_at, expiresAt: snapshot.expires_at, token: snapshot.token });
  for (const patch of [{ token: '' }, { token: 'A'.repeat(42) }, { token: 'A'.repeat(44) }, { token: '!'.repeat(43) }, { roster_count: 0 }, { expires_at: '2026-10-26T03:00:00.000Z' }]) {
    assert.throws(() => normalizeAcademicAttendanceDetail({ ...wire(), continuity_snapshot: { ...snapshot, ...patch } }, source, school, surface), /snapshot/);
  }
});
