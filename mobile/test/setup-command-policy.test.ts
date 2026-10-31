import test from 'node:test';
import assert from 'node:assert/strict';
import { setupCommandPath, setupCommandRead, setupIntentValid, setupReceiptMatches, setupReplayable, type SetupIntent } from '../src/features/SetupCommandPolicy';
import { categoryRuleBodyValid, workflowRulesValid, type InstitutionWorkflowRules } from '../src/features/InstitutionRulesPolicy';
const schoolId = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', key = '10000000-0000-4000-8000-000000000003', actor = '10000000-0000-4000-8000-000000000004';
const base = { version: 1 as const, schoolId, scope: 'exactOriginActorCampusWorld' };
const intent = (operation: SetupIntent['operation'], body: Record<string, unknown>, rest: Partial<SetupIntent> = {}): SetupIntent => ({ ...base, operation, resource: schoolId, method: 'POST', body, ...rest });
const rules: InstitutionWorkflowRules = { revision: 3, attendance_submission_cutoff: '14:00', attendance_academic_mode: 'daily_class', attendance_campus_mode: 'entry_exit', attendance_academic_channels: ['staff_roll_call'], attendance_campus_channels: ['staff_entry'], attendance_self_check_in_mode: 'staff_review', attendance_session_open_before_minutes: 10, attendance_session_close_after_minutes: 30, attendance_finalization_mode: 'principal_review', attendance_auto_finalize_minutes: 60, attendance_overdue_reminder_minutes: 10, attendance_overdue_escalation_minutes: 20, event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 15, message_edit_minutes: 5, message_attachment_mb: 10 };
test('commands bind exact actor/world/campus and owning endpoint, never arbitrary URL', () => {
  const value = intent('policySubmit', { expected_revision: 4 }, { resource: id });
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupIntentValid(value, 'another-world', schoolId), false);
  assert.equal(setupIntentValid(value, base.scope, id), false);
  assert.equal(setupCommandPath(value), `/api/v1/schools/${schoolId}/governance/policy-versions/${id}/submit/`);
  assert.equal(setupCommandRead(value), `/api/v1/schools/${schoolId}/governance/workspace/`);
  assert.equal(setupIntentValid({ ...value, resource: '../profile' }, base.scope, schoolId), false);
});
test('unkeyed governance and rule saves cannot replay an unknown outcome', () => {
  for (const operation of ['authorityDraft', 'regulatoryProfile', 'policyDraft', 'policySubmit', 'policyReview', 'promotion', 'workflow', 'category', 'examPolicy'] as const) assert.equal(setupReplayable({ operation }), false);
  assert.equal(setupReplayable({ operation: 'organization' }), true);
  assert.equal(setupReplayable({ operation: 'invigilationPolicy' }), true);
});
test('policy draft receipt proves family, version, revision and exact content', () => {
  const value = intent('policyDraft', { title: 'Attendance policy', summary: 'Reviewed school policy', body_markdown: 'Exact reviewed content', audience_roles: ['staff', 'guardian'], requires_acknowledgement: true, effective_on: '2026-10-29', review_due_on: null, source_note: 'Institution source', expected_revision: 2 }, { resource: 'attendance_policy', proof: { familyId: id, versionId: key } });
  const result = { ...value.body, school_id: schoolId, family_id: id, id: key, revision: 3, status: 'draft', audience_roles: ['guardian', 'staff'] };
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, result), true);
  for (const changed of [{ school_id: id }, { family_id: key }, { id }, { body_markdown: 'Other text' }, { revision: 4 }, { status: 'published' }]) assert.equal(setupReceiptMatches(value, { ...result, ...changed }), false);
  assert.equal(setupIntentValid({ ...value, body: { ...value.body, review_due_on: '2026-10-28' } }, base.scope, schoolId), false);
});
test('review direct result binds exact version, decision and recorded note', () => {
  const value = intent('policyReview', { expected_revision: 8, decision: 'publish', note: 'Approved exact version', override_reason: '' }, { resource: id });
  const result = { school_id: schoolId, id, revision: 9, status: 'published', review_note: value.body.note };
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, result), true);
  assert.equal(setupReceiptMatches(value, { ...result, status: 'draft' }), false);
  assert.equal(setupReceiptMatches(value, { ...result, review_note: 'Another note' }), false);
});
test('authority draft verifies named officeholder and explicitly linked current user', () => {
  const value = intent('authorityDraft', { legal_operator_name: 'Institution Trust', lead_officeholder_name: 'Asha Rao', lead_is_current_user: true, authority_basis_title: 'Reviewed trust instrument', authority_reference: 'Resolution 12' }, { proof: { actorUserId: actor } });
  const result = { sources: [{ id, code: 'institution_foundation', title: value.body.authority_basis_title, issuer: value.body.legal_operator_name, reference: value.body.authority_reference, verification_state: 'recorded' }], offices: [{ appointment_id: key, first_name: 'Asha', last_name: 'Rao', linked_user_id: actor }], rules: [] };
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, result), true);
  assert.equal(setupReceiptMatches(value, { ...result, offices: [{ ...result.offices[0], linked_user_id: id }] }), false);
  assert.equal(setupReceiptMatches(value, { ...result, offices: [{ ...result.offices[0], first_name: 'Someone' }] }), false);
});
test('organization keyed replay tolerates JSONB object order but rejects changed tree or revision', () => {
  const nodes = [{ id, parent_id: null, kind: 'department', name: 'Sciences', description: '', tone: 'teal', head_staff_id: null, member_ids: [] }], value = intent('organization', { nodes, expected_revision: 2, request_id: key }, { method: 'PUT' });
  const reordered = nodes.map(node => Object.fromEntries(Object.entries(node).reverse()));
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, { nodes: reordered, revision: 3, replayed: true }), true);
  assert.equal(setupReceiptMatches(value, { nodes: [{ ...nodes[0], name: 'Other' }], revision: 3, replayed: true }), false);
  assert.equal(setupReceiptMatches(value, { nodes, revision: 4, replayed: true }), false);
  assert.equal(setupIntentValid({ ...value, method: 'POST' }, base.scope, schoolId), false);
});
test('invigilation recovery binds campus, reason, exact recipients and revision', () => {
  const value = intent('invigilationPolicy', { expected_revision: 0, idempotency_key: key, enabled: true, recipient_person_ids: [id, actor], response_due_minutes: 60, expires_after_minutes: 120, approval_note: 'Reviewed campus arrangement' });
  const result = { school_id: schoolId, policy: { ...value.body, revision: 1, recipient_person_ids: [actor, id] } };
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, result), true);
  assert.equal(setupReceiptMatches(value, { ...result, school_id: id }), false);
  assert.equal(setupReceiptMatches(value, { ...result, policy: { ...result.policy, approval_note: 'Other reason' } }), false);
  assert.equal(setupIntentValid({ ...value, body: { ...value.body, expires_after_minutes: 59 } }, base.scope, schoolId), false);
});
test('attendance save validates reminder order and preserves unrelated workflow values', () => {
  const { revision, ...fields } = rules, value = intent('workflow', { ...fields, expected_revision: revision });
  assert.equal(workflowRulesValid(rules), true);
  assert.equal(workflowRulesValid({ ...rules, attendance_overdue_escalation_minutes: 10 }), false);
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, { ...rules, revision: 4 }), true);
  assert.equal(setupReceiptMatches(value, { ...rules, revision: 4, message_edit_minutes: 0 }), false);
  assert.equal(setupIntentValid({ ...value, body: { expected_revision: revision } }, base.scope, schoolId), false);
});
test('category changes bind both independent policy revisions and original windows', () => {
  const body = { expected_workflow_revision: 3, expected_domain_revision: 2, journey_lead_minutes: 15, enabled: true, enabled_modes: ['guardian_pickup'], change_cutoff: '13:00', location_retention_hours: 24, location_stale_seconds: 90 }, value = intent('category', body, { resource: 'departure' });
  const result = { category: 'departure', workflow: { ...rules, revision: 4 }, domain: { revision: 3, enabled: true, enabled_modes: ['guardian_pickup'], change_cutoff: '13:00', location_retention_hours: 24, location_stale_seconds: 90 } };
  assert.equal(categoryRuleBodyValid('departure', body), true);
  assert.equal(categoryRuleBodyValid('departure', { ...body, enabled_modes: [] }), false);
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, result), true);
  assert.equal(setupReceiptMatches(value, { ...result, domain: { ...result.domain, revision: 4 } }), false);
  assert.equal(setupReceiptMatches(value, { ...result, workflow: { ...result.workflow, journey_lead_minutes: 20 } }), false);
});
test('promotion sends reviewed mapping and accepts only an explicit confirmed count', () => {
  const value = intent('promotion', { source_term_id: id, target_term_id: key, mappings: [{ from_class_id: id, to_class_id: actor }], confirm: true });
  assert.equal(setupIntentValid(value, base.scope, schoolId), true);
  assert.equal(setupReceiptMatches(value, { count: 20, confirmed: true }), true);
  assert.equal(setupReceiptMatches(value, { count: 20, confirmed: false }), false);
  assert.equal(setupReceiptMatches(value, { count: -1, confirmed: true }), false);
});
