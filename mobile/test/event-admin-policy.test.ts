import test from 'node:test';
import assert from 'node:assert/strict';
import { eventAdminIntentValid, eventAdminPath, eventAdminReceiptMatches, exactEventAttention, type EventAdminIntent } from '../src/features/EventAdminPolicy';
const schoolId = '10000000-0000-4000-8000-000000000001', eventId = '10000000-0000-4000-8000-000000000002', studentId = '10000000-0000-4000-8000-000000000003', key = '10000000-0000-4000-8000-000000000004', relationship = '10000000-0000-4000-8000-000000000005', authority = '10000000-0000-4000-8000-000000000006';
const base = { version: 1 as const, scope: 'exactActorCampusWorldOrigin', schoolId, targetId: eventId, ownerHref: '/areas/events/manage' };
test('discard accepts exact keyed deleted-aggregate receipt rather than unavailable detail', () => {
  const intent: EventAdminIntent = { ...base, kind: 'discard', body: { school_id: schoolId, expected_revision: 4, idempotency_key: key } };
  assert.equal(eventAdminIntentValid(intent, base.scope, schoolId), true);
  assert.equal(eventAdminPath(intent), `/api/v1/campus-events/${eventId}/discard`);
  assert.equal(eventAdminReceiptMatches(intent, { id: eventId, discarded: true }), true);
  assert.equal(eventAdminReceiptMatches(intent, { id: studentId, discarded: true }), false);
  assert.equal(eventAdminReceiptMatches(intent, { id: eventId, status: 'draft', revision: 5 }), false);
  assert.equal(eventAdminIntentValid(intent, 'different-world', schoolId), false);
  assert.equal(eventAdminIntentValid(intent, base.scope, studentId), false);
});
test('authority grant binds relationship, learner, revision, verified dates and evidence', () => {
  const intent: EventAdminIntent = { ...base, kind: 'grant', targetId: relationship, studentId, body: { school_id: schoolId, expected_revision: 0, idempotency_key: key, valid_from: '2026-10-30', valid_until: null, provenance: 'Signed reviewed source', verified: true } };
  const result = { id: authority, relationship_id: relationship, student_id: studentId, status: 'active', revision: 1, valid_from: '2026-10-30', valid_until: null, provenance: 'Signed reviewed source' };
  assert.equal(eventAdminIntentValid(intent, base.scope, schoolId), true);
  assert.equal(eventAdminReceiptMatches(intent, result), true);
  for (const changed of [{ student_id: eventId }, { relationship_id: eventId }, { revision: 2 }, { provenance: 'Other source' }, { valid_from: '2026-10-31' }]) assert.equal(eventAdminReceiptMatches(intent, { ...result, ...changed }), false);
  assert.equal(eventAdminIntentValid({ ...intent, body: { ...intent.body, verified: false } }, base.scope, schoolId), false);
  assert.equal(eventAdminIntentValid({ ...intent, body: { ...intent.body, valid_from: '2026-02-31' } }, base.scope, schoolId), false);
});
test('authority revocation proves original grant and exact lifecycle revision', () => {
  const intent: EventAdminIntent = { ...base, kind: 'revoke', targetId: relationship, studentId, authorityId: authority, body: { school_id: schoolId, expected_revision: 3, idempotency_key: key, reason: 'Authority ended' } };
  const result = { id: authority, relationship_id: relationship, student_id: studentId, status: 'revoked', revision: 4 };
  assert.equal(eventAdminIntentValid(intent, base.scope, schoolId), true);
  assert.equal(eventAdminReceiptMatches(intent, result), true);
  assert.equal(eventAdminReceiptMatches(intent, { ...result, id: eventId }), false);
});
test('unkeyed category rules require both revisions and exact saved values', () => {
  const intent: EventAdminIntent = { ...base, targetId: schoolId, kind: 'rules', body: { expected_workflow_revision: 2, expected_domain_revision: 0, event_entry_hours_before: 2, event_staff_hours_after: 24, observation_hours_before: 1, observation_hours_after: 4 } };
  const result = { category: 'events', workflow: { revision: 3, event_entry_hours_before: 2, event_staff_hours_after: 24 }, domain: { revision: 1, observation_hours_before: 1, observation_hours_after: 4 } };
  assert.equal(eventAdminIntentValid(intent, base.scope, schoolId), true);
  assert.equal(eventAdminReceiptMatches(intent, result), true);
  assert.equal(eventAdminReceiptMatches(intent, { ...result, domain: { ...result.domain, revision: 2 } }), false);
  assert.equal(eventAdminIntentValid({ ...intent, body: { ...intent.body, observation_hours_after: 169 } }, base.scope, schoolId), false);
});
test('attention is exact for current cancellation, never for outdated revisions or self scope', () => {
  const href = `/areas/events/manage/${eventId}?attention_notification_id=${key}&focus=status&event_revision=8`;
  assert.equal(exactEventAttention({ status: 'cancelled', revision: 8 }, href, null), true);
  assert.equal(exactEventAttention({ status: 'cancelled', revision: 9 }, href, null), false);
  assert.equal(exactEventAttention({ status: 'published', revision: 8 }, href, null), false);
  assert.equal(exactEventAttention({ status: 'cancelled', revision: 8 }, `${href}&scope=self`, studentId), false);
  assert.equal(exactEventAttention({ status: 'cancelled', revision: 8 }, `${href}&scope=dependent`, studentId), true);
});
