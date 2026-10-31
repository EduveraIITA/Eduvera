import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceWorkItem } from '../../packages/contracts/src/workspace';
import { workspaceWorkRecovery, workspaceWorkRecoveryId } from '../src/lib/workspace-work-recovery';

const item: WorkspaceWorkItem = {
  id: 'domain:leave-1', kind: 'request', urgency: 'normal', title: 'Personal leave',
  status_label: 'Review route unavailable', href: '/work?item=domain%3Aleave-1&unavailable=route', action_label: 'Review in Work',
};

test('Work recovery accepts a single bounded opaque identity and owning unavailable reason', () => {
  assert.equal(workspaceWorkRecoveryId(item.id, 'source'), item.id);
  assert.equal(workspaceWorkRecoveryId(item.id, 'route'), item.id);
  assert.equal(workspaceWorkRecoveryId(item.id), item.id);
  assert.equal(workspaceWorkRecoveryId('584fba18-3584-491c-b00e-032406f7cb31', 'route'), '584fba18-3584-491c-b00e-032406f7cb31');
});

test('ambiguous, unsupported and malformed Work recovery query values select nothing', () => {
  for (const value of [undefined, null, '', ['domain:leave-1'], ['domain:leave-1', 'other'], 1, ' x', 'x ', 'x\n', 'x\u0000', 'x'.repeat(513)]) {
    assert.equal(workspaceWorkRecoveryId(value, 'route'), null);
  }
  for (const reason of [['route'], ['source', 'route'], null, '', 'decide', 'route'.repeat(200)]) {
    assert.equal(workspaceWorkRecoveryId(item.id, reason), null);
  }
});

test('known Work recovery exposes only the exact current projection title and status', () => {
  assert.deepEqual(workspaceWorkRecovery([{ ...item, id: 'other', title: 'Other current work' }, item], item.id), {
    title: 'Personal leave',
    explanation: 'The source link is unavailable. No decision has been recorded. Check the owning area or contact its responsible coordinator.',
    status: 'Review route unavailable',
  });
  assert.equal('href' in workspaceWorkRecovery([item], item.id)!, false);
});

test('foreign or closed Work identity never echoes the query or another scope record', () => {
  const result = workspaceWorkRecovery([item], 'foreign-private-id');
  assert.deepEqual(result, {
    title: 'This item is no longer in your current queue',
    explanation: 'It may have been resolved or your access may have changed. No records were changed.',
    status: null,
  });
  assert.doesNotMatch(JSON.stringify(result), /foreign-private-id|Personal leave/);
});

test('recovery re-resolves the current manifest after a record disappears', () => {
  assert.equal(workspaceWorkRecovery([item], item.id)?.title, item.title);
  assert.equal(workspaceWorkRecovery([], item.id)?.title, 'This item is no longer in your current queue');
  assert.equal(workspaceWorkRecovery([{ ...item, status_label: null }], item.id)?.status, null);
});

test('no selection or malformed selection does not open a recovery panel', () => {
  for (const id of [undefined, null, '', 'x\n', 'x'.repeat(513)]) assert.equal(workspaceWorkRecovery([item], id), null);
});
