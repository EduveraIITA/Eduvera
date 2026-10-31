import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalNativeHref } from '../src/lib/navigation';
import { conversationIdFromHref, conversationListHref, nativeRouteHref } from '../src/lib/route-state';

test('the canonical conversation directory is never mistaken for a conversation ID', () => {
  assert.equal(conversationIdFromHref('/areas/messages/conversations'), null);
  assert.equal(conversationIdFromHref('/areas/messages/conversations?student_id=child-1'), null);
  assert.equal(conversationIdFromHref('/areas/messages/conversations/thread-1'), 'thread-1');
  assert.equal(conversationIdFromHref('/areas/messages/conversations?conversation_id=thread-2'), 'thread-2');
});
test('back from a conversation retains the selected child and filters', () => {
  assert.equal(conversationListHref('/areas/messages/conversations?student_id=child-1&q=Class&conversation=thread-1&message_id=message-1'), '/areas/messages/conversations?student_id=child-1&q=Class');
});
test('a retained stack screen derives its own route instead of the newly active global route', () => {
  assert.deepEqual(nativeRouteHref('areas', { path: ['people', 'participants', 'person-1'], scope: 'dependent', student_id: 'child-1' }), { path: '/areas/people/participants/person-1', href: '/areas/people/participants/person-1?scope=dependent&student_id=child-1' });
  assert.equal(nativeRouteHref('more', { path: ['account', 'security'], source: ['one', 'two'] }).href, '/more/account/security?source=one&source=two');
});
test('navigation preserves canonical scope and refuses external links', () => {
  assert.equal(canonicalNativeHref('/areas/calendar?scope=dependent&student_id=child-1'), '/areas/calendar?scope=dependent&student_id=child-1');
  assert.equal(canonicalNativeHref('/account/security'), '/more/account/security');
  for (const href of ['https://outside.example', '//outside.example', '/\\outside.example']) assert.throws(() => canonicalNativeHref(href));
});
test('current institution section deep links open their exact canonical owner and retain context', () => {
  const paths = { campus: 'institution/campus', setup: 'institution/academics', access: 'people/access', audit: 'institution/history', promotion: 'institution/promotion', rules: 'institution/operating-rules' };
  for (const [section, path] of Object.entries(paths)) {
    const expected = `/more/setup/${path}?school=school-1&rule=attendance&campus_id=campus-1`;
    assert.equal(canonicalNativeHref(`/more/setup/institution?section=${section}&school=school-1&rule=attendance&campus_id=campus-1`), expected);
    assert.deepEqual(nativeRouteHref('more', { path: ['setup', 'institution'], section, school: 'school-1', rule: 'attendance', campus_id: 'campus-1' }), { path: expected.split('?')[0], href: expected });
  }
  assert.equal(canonicalNativeHref('/more/setup/institution/campus?section=rules'), '/more/setup/institution/campus?section=rules');
  assert.equal(canonicalNativeHref('/more/setup/institution?section=other'), '/more/setup/institution?section=other');
});
