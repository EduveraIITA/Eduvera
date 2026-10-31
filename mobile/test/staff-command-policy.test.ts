import test from 'node:test';
import assert from 'node:assert/strict';
import { staffCommandReplayable, staffCommandValid, staffReceiptMatches, type StaffPendingCommand } from '../src/features/StaffCommandPolicy';
const id = (end: number) => `10000000-0000-4000-8000-${String(end).padStart(12, '0')}`, school = id(1), profile = id(2), policy = id(3), task = id(4), commandId = id(5), base = `/api/v1/schools/${school}/staff`;
test('staff policy edits bind exact campus, policy, revision, allowances and statutory flags', () => {
  const command: StaffPendingCommand = { operation: 'policy', method: 'PATCH', path: `${base}/leave-policies/${policy}/`, label: 'Leave policy', body: { expected_revision: 3, academic_year: '2026-27', code: 'CL', name: 'Casual leave', annual_allowance: 12, carry_forward_limit: 0, requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true } }, result = { id: policy, revision: 4, name: 'Casual leave', annual_allowance: '12.00', carry_forward_limit: '0.00', requires_document_after_days: null, is_paid: true, is_statutory: false, is_active: true };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffCommandValid(command, base.replace(school, profile)), false);
  assert.equal(staffCommandReplayable(command), false);
  assert.equal(staffReceiptMatches(command, result), true);
  assert.equal(staffReceiptMatches(command, { ...result, revision: 3 }), false);
  assert.equal(staffReceiptMatches(command, { ...result, annual_allowance: '13.00' }), false);
  assert.equal(staffReceiptMatches(command, { ...result, id: profile }), false);
});
test('cover offers prove exact task, selected colleague and advanced revision; reads cannot prove an offer', () => {
  const command: StaffPendingCommand = { operation: 'coverageOffer', path: `${base}/coverage-tasks/${task}/assign/`, label: 'Cover offer', body: { expected_revision: 2, replacement_staff_profile_id: profile, note: '' } }, result = { id: task, revision: 3, status: 'offered', replacement_staff_profile_id: profile };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffCommandReplayable(command), false);
  assert.equal(staffReceiptMatches(command, result), true);
  assert.equal(staffReceiptMatches(command, { ...result, replacement_staff_profile_id: school }), false);
  assert.equal(staffReceiptMatches(command, { ...result, status: 'accepted' }), false);
  assert.equal(staffReceiptMatches(command, { coverage_tasks: [result] }), false);
});
test('balance adjustment direct receipt binds staff, policy, signed days and reason', () => {
  const command: StaffPendingCommand = { operation: 'balance', path: `${base}/balance-adjustments/`, label: 'Balance correction', body: { staff_profile_id: profile, policy_id: policy, days: -2.5, reason: 'Approved opening correction' } }, result = { id: task, staff_profile_id: profile, policy_id: policy, days: '-2.50', reason: 'Approved opening correction' };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffReceiptMatches(command, result), true);
  assert.equal(staffReceiptMatches(command, { ...result, days: '2.50' }), false);
  assert.equal(staffReceiptMatches(command, { ...result, policy_id: school }), false);
  assert.equal(staffCommandValid({ ...command, body: { ...command.body, days: 0 } }, base), false);
});
test('employment setup check requires PATCH and exact staff profile revision', () => {
  const command: StaffPendingCommand = { operation: 'onboarding', method: 'PATCH', path: `${base}/profiles/${profile}/onboarding/`, label: 'Employment check', body: { item_id: policy, completed: true, note: 'Reviewed source', expected_revision: 8 } };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffCommandValid({ ...command, method: 'POST' }, base), false);
  assert.equal(staffReceiptMatches(command, { id: profile, revision: 9, status: 'active' }), true);
  assert.equal(staffReceiptMatches(command, { id: task, revision: 9, status: 'active' }), false);
});
test('new role assignments bind the actual current role, class, subject and dates', () => {
  const command: StaffPendingCommand = { operation: 'assignRole', path: `${base}/role-assignments/`, label: 'Role assignment', body: { staff_profile_id: profile, role_id: policy, scope_id: task, subject_id: null, starts_on: '2026-10-29', ends_on: null } }, result = { id: commandId, staff_profile_id: profile, responsibility_type_id: policy, class_section_id: task, subject_id: null, starts_on: '2026-10-29', ends_on: null, status: 'active', revision: 1 };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffReceiptMatches(command, result), true);
  assert.equal(staffReceiptMatches(command, { ...result, responsibility_type_id: school }), false);
  assert.equal(staffReceiptMatches(command, { ...result, class_section_id: school }), false);
});
test('only owner-keyed staff actions can replay an unknown outcome', () => {
  const command: StaffPendingCommand = { operation: 'decision', path: `${base}/leave-requests/${task}/decision/`, label: 'Leave decision', body: { command_id: commandId, expected_revision: 2, decision: 'approved', note: '' } };
  assert.equal(staffCommandReplayable(command), true);
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffCommandValid({ ...command, body: { ...command.body, command_id: undefined } }, base), false);
  assert.equal(staffReceiptMatches(command, { id: task, revision: 3, status: 'approved' }), true);
  assert.equal(staffReceiptMatches(command, { id: task, revision: 3, status: 'rejected' }), false);
  for (const operation of ['policy', 'balance', 'onboarding', 'coverageOffer', 'coveragePolicy', 'role', 'assignRole', 'changeRole', 'endClass', 'revokeAssignment', 'assignment'] as const) assert.equal(staffCommandReplayable({ operation }), false);
});
test('leave review delivery confirmation retains exact authority revisions and server command', () => {
  const source = { id: policy, revision: 2 }, command: StaffPendingCommand = { operation: 'routing', path: `${base}/leave-review-routing/`, label: 'Review delivery', body: { command_id: commandId, confirmed: true, expected: { rule: source, office: source, appointment: source, person: source, sources: [source] } } };
  assert.equal(staffCommandValid(command, base), true);
  assert.equal(staffCommandReplayable(command), true);
  assert.equal(staffReceiptMatches(command, { confirmed: true, replayed: false }), true);
  assert.equal(staffReceiptMatches(command, { confirmed: false, replayed: false }), false);
  assert.equal(staffCommandValid({ ...command, body: { ...command.body, expected: { rule: source } } }, base), false);
});
