import assert from 'node:assert/strict';
import test from 'node:test';
import { completePeopleEditor, peopleEditorCanRetain, peopleEditorHasChanges } from '../src/lib/people-editor-policy';

test('an interrupted fresh read retains the same cached editor source; explicit access loss withdraws it', () => {
  const source = { id: 'person-1', revision: 7, profile: { contact_email: 'saved@example.test' } };
  for (const error of [null, new Error('Offline'), { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }]) assert.equal(peopleEditorCanRetain(source, error), true);
  for (const status of [401, 403, 404, 410]) assert.equal(peopleEditorCanRetain(source, { status }), false);
  assert.equal(peopleEditorCanRetain(undefined, new Error('Offline')), false);
  assert.equal(peopleEditorCanRetain(null, null), false);
  assert.equal(source.profile.contact_email, 'saved@example.test');
});

test('saved contact and employment defaults are clean; text, reason and checked values are meaningful edits', () => {
  const baseline = { name: 'Asha', email: 'asha@example.test', phone: '123456', reason: '', completed: false };
  assert.equal(peopleEditorHasChanges(baseline, { ...baseline }), false);
  for (const patch of [{ name: 'Asha R' }, { email: 'other@example.test' }, { phone: '' }, { reason: 'Corrected contact' }, { completed: true }]) assert.equal(peopleEditorHasChanges(baseline, { ...baseline, ...patch }), true);
  assert.equal(peopleEditorHasChanges(baseline, baseline), false);
});

test('dated membership and authority drafts protect selections and dates without marking saved selections dirty', () => {
  const baseline = { members: ['person-a', 'person-b'], parent: 'group-1', effectiveOn: '', enabled: true, until: '' };
  assert.equal(peopleEditorHasChanges(baseline, { ...baseline, members: ['person-b', 'person-a'].sort() }), false);
  for (const patch of [{ members: ['person-a'] }, { parent: '' }, { effectiveOn: '2026-11-01' }, { enabled: false }, { until: '2026-12-01' }]) assert.equal(peopleEditorHasChanges(baseline, { ...baseline, ...patch }), true);
  assert.deepEqual(baseline.members, ['person-a', 'person-b']);
});

test('a changed context before the clean editor commit never invokes its close or parent callback', async () => {
  let callbacks = 0;
  await assert.rejects(completePeopleEditor({ assertCurrent() { throw new Error('The focused source changed'); }, run() { callbacks++; } }), /source changed/);
  assert.equal(callbacks, 0);
});

test('an acknowledged close may unmount its own editor without becoming a false failure', async () => {
  let mounted = true, callbacks = 0;
  await completePeopleEditor({ assertCurrent() { assert.equal(mounted, true); }, async run() { callbacks++; mounted = false; } });
  assert.equal(callbacks, 1);
  assert.equal(mounted, false);
});
