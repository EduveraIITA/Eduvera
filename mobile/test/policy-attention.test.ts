import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublishedPolicy } from '../../packages/contracts/src/wire/features/governance/api';
import { policyAcknowledgementMatches, policyAttentionProof } from '../src/lib/policy-attention';
const id = '11111111-1111-4111-8111-111111111111', notification = '22222222-2222-4222-8222-222222222222';
const policy = { id, version: 3, revision: 9 } as PublishedPolicy;
const target = `/more/policies?policy=${id}&policy_revision=9&attention_notification_id=${notification}`;
test('policy attention needs the exact successfully loaded publication revision', () => {
  const proof = policyAttentionProof(target, [policy])!;
  assert.equal(proof.openedTarget, target); assert.equal(proof.notificationId, notification);
  assert.equal(proof.cleanHref, `/more/policies?policy=${id}&policy_revision=9`);
  assert.equal(policyAttentionProof(target, [{ ...policy, revision: 10 }]), null);
  assert.equal(policyAttentionProof(target, []), null);
  assert.equal(policyAttentionProof(target.replace('policy_revision=9', 'policy_revision=0'), [policy]), null);
  assert.equal(policyAttentionProof(`${target}&policy_revision=9`, [policy]), null);
  assert.equal(policyAttentionProof(target.replace('/more/policies', '/more/governance'), [policy]), null);
  assert.equal(policyAttentionProof(target.replace(notification, 'foreign'), [policy]), null);
});
test('acknowledgement receipts must identify the exact actor campus and policy version', () => {
  const receipt = { id: notification, policy_version_id: id, school_id: 'school', user_id: 'actor', acknowledged_at: '2026-10-29T05:00:00Z' };
  assert.equal(policyAcknowledgementMatches(receipt, policy, 'actor', 'school'), true);
  for (const change of [{ user_id: 'other' }, { school_id: 'other' }, { policy_version_id: notification }, { acknowledged_at: 'unknown' }, { id: '' }]) assert.equal(policyAcknowledgementMatches({ ...receipt, ...change }, policy, 'actor', 'school'), false);
});
