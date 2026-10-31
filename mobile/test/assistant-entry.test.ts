import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantEntryAvailable, assistantPerspective } from '../src/lib/assistant-access';

test('an Assistant entry requires confirmed Pro, available Live context and a current perspective', () => {
  assert.equal(assistantEntryAvailable({ mode: 'live' }, true, 'principal'), true);
  assert.equal(assistantEntryAvailable({ mode: 'live' }, undefined, 'principal'), false);
  assert.equal(assistantEntryAvailable({ mode: 'live' }, false, 'principal'), false);
  assert.equal(assistantEntryAvailable({ mode: 'simulation' }, true, 'principal'), false);
  assert.equal(assistantEntryAvailable({ mode: 'live', unavailable: true }, true, 'principal'), false);
  assert.equal(assistantEntryAvailable({ mode: 'live' }, true, null), false);
});

test('stale campus and assigned-only access cannot expose an institution Assistant entry', () => {
  const user = { id: 'actor', username: 'director', email: 'director@example.invalid', first_name: 'Campus', last_name: 'Director', display_name: 'Director', active_school_id: 'school', role: 'admin' };
  const memberships = [{ id: 'membership', school_id: 'school', school_name: 'Campus', role: 'admin', access_scope: 'assigned_work' }];
  assert.equal(assistantPerspective(user, memberships, 'school'), null);
  assert.equal(assistantPerspective(user, memberships, 'another-school'), null);
  assert.equal(assistantEntryAvailable({ mode: 'live' }, true, assistantPerspective(user, memberships, 'school')), false);
  assert.equal(assistantPerspective(user, [{ ...memberships[0]!, access_scope: 'institution' }], 'school'), 'principal');
});
