import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest, WorkspaceAreaSurface } from '../../packages/contracts/src/workspace';
import { attendanceOperationalSurface, attendanceRelationshipOptions, nativeAttendanceRecordsMatches, nativeAttendanceRecordsPath, resolveAttendanceRelationship } from '../src/lib/attendance-access';
import { assertWorkspaceManifestContext } from '../../packages/contracts/src/workspace-normalizer';
const surface = (relationship: 'self' | 'dependent', id: string): WorkspaceAreaSurface => ({ key: `records:${relationship}:${id}`, label: id, href: `/areas/attendance/records?scope=${relationship}&student_id=${id}`, capabilities: ['read'], scopes: [{ kind: relationship, id, label: id }] });
const manifest = (surfaces: WorkspaceAreaSurface[]): WorkspaceManifest => ({ context: { actor_user_id: 'actor', institution_id: 'campus', environment: { kind: 'live' } }, areas: [{ key: 'attendance', label: 'Attendance', href: '/areas/attendance', capabilities: [], scopes: [], surfaces }] }) as unknown as WorkspaceManifest;
test('two children require a choice; foreign, mixed and duplicate learner scopes fail closed', () => {
  const value = manifest([surface('dependent', 'a'), surface('dependent', 'b')]);
  assert.equal(resolveAttendanceRelationship(value, '/areas/attendance/records?scope=dependent').state, 'choose');
  for (const suffix of ['scope=dependent&student_id=missing', 'scope=self&student_id=a', 'scope=other', 'student_id=', 'scope=dependent&scope=self&student_id=a', 'scope=dependent&student_id=a&student_id=b']) assert.equal(resolveAttendanceRelationship(value, `/areas/attendance/records?${suffix}`).state, 'invalid', suffix);
  const selected = resolveAttendanceRelationship(value, '/areas/attendance/records?scope=dependent&student_id=b');
  assert.equal(selected.state, 'selected'); if (selected.state !== 'selected') return;
  assert.equal(nativeAttendanceRecordsPath(selected.option), '/api/v1/screens/parent/attendance/?student_id=b');
  assert.equal(nativeAttendanceRecordsMatches({ student: { id: 'a' } }, selected.option), false); assert.equal(nativeAttendanceRecordsMatches({ student: { id: 'b' } }, selected.option), true);
});
test('self report uses exact manifest learner and verifies response identity', () => {
  const selection = resolveAttendanceRelationship(manifest([surface('self', 'me')]), '/areas/attendance/records?scope=self');
  assert.equal(selection.state, 'selected'); if (selection.state !== 'selected') return;
  assert.equal(nativeAttendanceRecordsPath(selection.option), '/api/v1/screens/student/attendance/'); assert.equal(nativeAttendanceRecordsMatches({ student: { id: 'other' } }, selection.option), false);
});
test('relationship key without matching scope evidence grants no report access', () => {
  const source = surface('dependent', 'a'); assert.equal(attendanceRelationshipOptions(manifest([{ ...source, scopes: [{ kind: 'dependent', id: 'b' }] }])).length, 0);
  assert.equal(resolveAttendanceRelationship(manifest([source]), '/areas/attendance/registers?scope=dependent&student_id=a').state, 'invalid');
});
test('evidence requires an operational surface; manifest actor and world must match', () => {
  const source = manifest([surface('dependent', 'a')]); assert.equal(attendanceOperationalSurface(source, '/areas/attendance/evidence'), null);
  assert.throws(() => assertWorkspaceManifestContext(source, { actorUserId: 'different', institutionId: 'campus', environment: { mode: 'live' } }));
  assert.throws(() => assertWorkspaceManifestContext(source, { actorUserId: 'actor', institutionId: 'campus', environment: { mode: 'simulation', namespace_id: 'world' } }));
  const coordinator: WorkspaceAreaSurface = { key: 'coordination', label: 'Review', href: '/areas/attendance/coordination', capabilities: ['review'], scopes: [] };
  assert.equal(attendanceOperationalSurface(manifest([coordinator]), '/areas/attendance/evidence')?.key, 'coordination'); assert.equal(attendanceOperationalSurface(manifest([coordinator]), '/areas/attendance/registers'), null);
});
