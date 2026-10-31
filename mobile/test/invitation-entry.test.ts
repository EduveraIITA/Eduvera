import assert from 'node:assert/strict';
import test from 'node:test';
import { checkedAcceptedInvitation, checkedInvitationProof, invitationFromFragment, validateInvitationContinuation } from '../src/auth/invitation-entry';
const school = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002', invitation = '00000000-0000-4000-8000-000000000003', source = '00000000-0000-4000-8000-000000000004';
const proof = { campus: { id: school, name: 'Invited campus' }, invitation_id: invitation, verification_required: true, delivery: 'email_accepted' as const };
test('invitation fragments require the bounded original code and recipient', () => {
  assert.deepEqual(invitationFromFragment('#token=123456&email=recipient%40example.test'), { token: '123456', email: 'recipient@example.test' });
  for (const fragment of ['token=123&email=recipient%40example.test','token=123456&email=wrong','token='+ 'a'.repeat(101) +'&email=recipient%40example.test']) assert.deepEqual(invitationFromFragment(fragment), { token: '', email: '' });
});
test('proof and accepted results require exact campus and stable account identity', () => {
  assert.equal(checkedInvitationProof(proof), proof);
  assert.equal(checkedAcceptedInvitation({ school_id: school, accepted_user_id: actor, role: 'member' }, proof).accepted_user_id, actor);
  for (const bad of [{...proof, retry_after_seconds:-1},{...proof, verification_required:'yes'},{...proof, campus:{id:'wrong',name:'Other'}}]) assert.throws(() => checkedInvitationProof(bad));
  for (const bad of [{school_id:actor,accepted_user_id:actor,role:'member'},{school_id:school,accepted_user_id:'wrong',role:'member'},{school_id:school,accepted_user_id:actor,role:'owner'}]) assert.throws(() => checkedAcceptedInvitation(bad,proof));
});
test('a continuation cannot substitute another invitation, source, campus or URL', () => {
  const continuation = {kind:'facility_repair',label:'Open repair',school_id:school,invitation_id:invitation,source_id:source,href:`/areas/facilities?repair_id=${source}`};
  assert.equal(validateInvitationContinuation(continuation,school,invitation),continuation);
  for (const bad of [{...continuation,invitation_id:source},{...continuation,school_id:actor},{...continuation,href:'https://outside.example'},{...continuation,source_id:actor},{...continuation,label:'Open campus'}]) assert.throws(() => validateInvitationContinuation(bad,school,invitation));
});
