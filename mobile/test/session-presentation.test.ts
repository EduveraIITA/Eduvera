import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetainSessionPresentation } from '../src/auth/session-presentation';
import type { SessionState } from '../src/auth/session-types';

const confirmed: SessionState = { status: 'authenticated', user: { id: 'person', username: 'person', email: '', first_name: '', last_name: '', display_name: 'Person', active_school_id: 'campus' }, memberships: [{ id: 'membership', school_id: 'campus', school_name: 'Campus', role: 'member', permissions: ['read', 'write'] }], environment: { mode: 'live', institution_id: 'campus', namespace_id: 'live:campus' }, error: null, setupRequired: false };
const copy = () => structuredClone(confirmed);
test('same-access verification retains mounted navigation and drafts without trusting loading as confirmation', () => {
  const before = copy(); before.status = 'loading';
  const after = copy(); after.user!.display_name = 'Corrected name'; after.memberships[0]!.permissions!.reverse();
  assert.equal(canRetainSessionPresentation(before, after), true);
  after.status = 'loading'; assert.equal(canRetainSessionPresentation(before, after), false);
});
test('actor, campus, world, unavailable or access changes require removal of old presentation data', () => {
  const changes: Array<(state: SessionState) => void> = [state => { state.user!.id = 'someone-else'; }, state => { state.user!.active_school_id = 'another-campus'; }, state => { state.environment.mode = 'simulation'; }, state => { state.environment.namespace_id = 'run:one'; }, state => { state.environment.run_id = 'run-two'; }, state => { state.environment.unavailable = true; }, state => { state.memberships[0]!.permissions = ['read']; }, state => { state.memberships[0]!.access_scope = 'narrower'; }, state => { state.memberships = []; }];
  for (const change of changes) { const after = copy(); change(after); assert.equal(canRetainSessionPresentation(confirmed, after), false); }
  assert.equal(canRetainSessionPresentation({ ...confirmed, user: null }, confirmed), false);
});
