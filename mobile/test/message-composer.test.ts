import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_ATTACHMENT_MAX_BYTES, nativeChatFileType, nativeChatRecipients, nativeDirectConversation, nativeGroupConversation, nativeChatAttachmentPath, nativeChatConversationMatches, nativeChatCreatedReadPath, nativeChatCreatedHref } from '../src/lib/message-composer';
const school = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', learner = '33333333-3333-4333-8333-333333333333';
const staff = { id: person, name: 'A person', detail: 'Approved contact', school_id: school, school_name: 'Campus', membership_role: 'staff' as const, student_id: null };

test('native Chat file selection enforces types, actual byte boundaries and safe file names', () => {
  assert.equal(nativeChatFileType('photo.JPG', CHAT_ATTACHMENT_MAX_BYTES, 'image/jpeg'), 'image/jpeg');
  assert.equal(nativeChatFileType('document.docx', 1), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  for (const [name, size, type] of [['photo.jpg', CHAT_ATTACHMENT_MAX_BYTES + 1, 'image/jpeg'], ['photo.jpg', 0, 'image/jpeg'], ['photo.jpg', 1.2, 'image/jpeg'], ['photo.jpg', 100, 'application/pdf'], ['file.exe', 100, 'application/octet-stream'], ['../photo.jpg', 100, 'image/jpeg'], ['bad\n.pdf', 100, 'application/pdf']] as const) assert.equal(nativeChatFileType(name, size, type), null);
});
test('new conversations use only exact-campus server-projected contacts and preserve learner context', () => {
  assert.deepEqual(nativeDirectConversation(school, person, learner, [staff]), { school_id: school, recipient_id: person, student_id: learner });
  assert.throws(() => nativeDirectConversation(school, person, learner, [{ ...staff, school_id: learner }]));
  assert.throws(() => nativeDirectConversation(school, learner, '', [staff]));
  assert.throws(() => nativeDirectConversation(school, person, 'invalid', [staff]));
});
test('group membership deduplicates projected identities but rejects duplicated or ineligible selections', () => {
  const guardian = { ...staff, membership_role: 'guardian' as const };
  assert.deepEqual(nativeChatRecipients([guardian, staff], school, 'student_group'), [staff]);
  const input = { schoolId: school, title: ' Lesson group ', groupType: 'student_group' as const, memberIds: [person], studentId: learner, canManage: false };
  assert.equal(nativeGroupConversation(input, [staff]).title, 'Lesson group');
  for (const patch of [{ memberIds: [person, person] }, { memberIds: [learner] }, { groupType: 'staff' as const }, { groupType: 'announcement' as const }, { title: 'a' }]) assert.throws(() => nativeGroupConversation({ ...input, ...patch }, [staff]));
  assert.throws(() => nativeGroupConversation(input, [guardian]));
  assert.equal(nativeGroupConversation({ ...input, groupType: 'child_support' }, [staff]).student_id, learner);
  assert.throws(() => nativeGroupConversation({ ...input, groupType: 'child_support', studentId: '' }, [staff]));
});
test('attachment downloads rebuild the protected API path and reject cross-thread or deleted records', () => {
  const message = { id: learner, conversation_id: person, is_deleted: false, attachment: { file_url: 'https://untrusted.invalid/file' } };
  assert.equal(nativeChatAttachmentPath(person, message), `/api/v1/chat/conversations/${person}/messages/${learner}/attachment/`);
  for (const patch of [{ conversation_id: school }, { is_deleted: true }, { attachment: null }, { id: '../escape' }]) assert.throws(() => nativeChatAttachmentPath(person, { ...message, ...patch }));
});

test('learner conversation projection permits campus-wide context while refusing another learner or campus', () => {
  const conversation = { id: person, school_id: school, context_student_id: null as string | null };
  assert.equal(nativeChatConversationMatches(conversation, school, learner, person), true);
  assert.equal(nativeChatConversationMatches({ ...conversation, context_student_id: learner }, school, learner, person), true);
  assert.equal(nativeChatConversationMatches({ ...conversation, context_student_id: person }, school, learner, person), false);
  assert.equal(nativeChatConversationMatches(conversation, learner, learner, person), false);
  assert.equal(nativeChatConversationMatches(conversation, school, learner, school), false);
});

test('direct creation preserves the approved contact learner when no explicit learner is selected', () => {
  const projected = { ...staff, student_id: learner };
  assert.equal(nativeDirectConversation(school, person, '', [projected]).student_id, learner);
  assert.equal(nativeDirectConversation(school, person, school, [projected]).student_id, school);
  assert.throws(() => nativeDirectConversation(school, person, '', [{ ...projected, student_id: 'invalid' }]));
  assert.equal('student_id' in nativeDirectConversation(school, person, '', [staff]), false);
});

test('created or existing conversations open by exact returned owner independently of first directory page', () => {
  const action = { endpoint: '/api/v1/chat/conversations/', scope: { schoolId: school }, payload: { kind: 'json', body: JSON.stringify({ school_id: school, recipient_id: person, student_id: learner }) }, refreshPath: '' };
  const path = nativeChatCreatedReadPath({ id: person, created: false }, action);
  assert.equal(path, `/api/v1/chat/conversations/${person}/?student_id=${learner}`);
  const saved = { ...action, refreshPath: path }, detail = { id: person, school_id: school, context_student_id: learner };
  const href = nativeChatCreatedHref('/areas/messages/conversations?compose=direct&q=old&cursor=oldest', detail, saved);
  assert.equal(new URLSearchParams(href.split('?')[1]).get('conversation'), person);
  assert.equal(new URLSearchParams(href.split('?')[1]).get('student_id'), learner);
  assert.equal(new URLSearchParams(href.split('?')[1]).has('compose'), false);
  for (const patch of [{ id: school }, { school_id: learner }, { context_student_id: null }, { context_student_id: person }]) assert.throws(() => nativeChatCreatedHref(href, { ...detail, ...patch }, saved));
  assert.throws(() => nativeChatCreatedReadPath({ id: '../escape' }, action));
  assert.throws(() => nativeChatCreatedReadPath({ id: person }, { ...action, endpoint: '/api/v1/auth/native/logout/' }));
  assert.throws(() => nativeChatCreatedHref('/areas/messages/conversations?student_id=other', detail, saved));
});
test('a created group retains its exact detail read target across recovery', () => {
  const action = { endpoint: '/api/v1/chat/groups/', scope: { schoolId: school }, payload: { kind: 'json', body: JSON.stringify({ school_id: school, title: 'Group', member_ids: [person] }) }, refreshPath: '' };
  const saved = { ...action, refreshPath: nativeChatCreatedReadPath({ id: learner }, action) };
  assert.equal(nativeChatCreatedHref('/areas/messages/conversations?compose=group', { id: learner, school_id: school, context_student_id: null }, JSON.parse(JSON.stringify(saved))), `/areas/messages/conversations?conversation=${learner}`);
});
