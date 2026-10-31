import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEventAdminOwner, executeEventAdminIntent, type EventAdminExecutionPorts } from '../src/features/EventAdminExecution';
import type { EventAdminIntent } from '../src/features/EventAdminPolicy';
const id = '10000000-0000-4000-8000-000000000001';
const original: EventAdminIntent = { version: 1, scope: 'account/campus/world/server', schoolId: id, kind: 'discard', targetId: id, ownerHref: `/areas/events/manage/${id}`, body: { school_id: id, expected_revision: 4, idempotency_key: id } };
function harness() {
  let focused = true, reviewed = true, pending: EventAdminIntent | null = null, sends = 0, reads = 0;
  const ports: EventAdminExecutionPorts = {
    assertCurrent() { if (!focused) throw new Error('Original focused scope changed'); },
    assertReview() { if (!reviewed) throw new Error('Reviewed source changed'); },
    persist: async value => { pending = structuredClone(value); }, clear: async () => { pending = null; },
    send: async () => { sends++; return { id, discarded: true }; },
    inspectRules: async () => { reads++; return { category: 'events', workflow: { revision: 2, event_entry_hours_before: 2, event_staff_hours_after: 3 }, domain: { revision: 2, observation_hours_before: 2, observation_hours_after: 3 } }; },
    refresh: async () => {},
  };
  return { ports, get pending() { return pending; }, get sends() { return sends; }, get reads() { return reads; }, blur() { focused = false; }, drift() { reviewed = false; } };
}
test('a delayed confirmation on another focused source or owner route sends nothing', async () => {
  assert.throws(() => assertEventAdminOwner(original, '/areas/events/manage'), /original event/);
  const blurred = harness(); blurred.blur(); await assert.rejects(executeEventAdminIntent(structuredClone(original), false, blurred.ports), /focused/); assert.equal(blurred.sends, 0); assert.equal(blurred.pending, null);
  const changed = harness(); changed.drift(); await assert.rejects(executeEventAdminIntent(structuredClone(original), false, changed.ports), /source/); assert.equal(changed.sends, 0); assert.equal(changed.pending, null);
});
test('focus or source loss while secure preparation commits retains the exact action and sends nothing', async () => {
  for (const boundary of ['focus', 'source']) {
    const h = harness(), persist = h.ports.persist;
    h.ports.persist = async value => { await persist(value); boundary === 'focus' ? h.blur() : h.drift(); };
    await assert.rejects(executeEventAdminIntent(structuredClone(original), false, h.ports), /focused|source/);
    assert.equal(h.sends, 0); assert.deepEqual(h.pending?.body, original.body);
  }
});
test('accepted own-source refresh may advance revision and never revalidates the old confirmation', async () => {
  const h = harness(); h.ports.refresh = async () => { h.drift(); };
  assert.equal(await executeEventAdminIntent(structuredClone(original), false, h.ports), 'accepted');
  assert.equal(h.sends, 1); assert.equal(h.pending, null);
});
test('lost acknowledgement retains the original exact key; accepted recovery only refreshes and clears', async () => {
  const h = harness(); h.ports.send = async () => { throw new Error('Response lost'); };
  await assert.rejects(executeEventAdminIntent(structuredClone(original), false, h.ports), /lost/); assert.deepEqual(h.pending?.body, original.body);
  const accepted = { ...original, accepted: { id, discarded: true } }, recovery = harness();
  assert.equal(await executeEventAdminIntent(accepted, true, recovery.ports), 'accepted'); assert.equal(recovery.sends, 0);
});
test('unknown unkeyed rules recovery reads only and never clears or resends', async () => {
  const h = harness(), rules: EventAdminIntent = { ...original, kind: 'rules', ownerHref: '/areas/events/manage?view=settings', body: { expected_workflow_revision: 1, expected_domain_revision: 1, event_entry_hours_before: 2, event_staff_hours_after: 3, observation_hours_before: 2, observation_hours_after: 3 } };
  let clears = 0; h.ports.clear = async () => { clears++; };
  assert.equal(await executeEventAdminIntent(rules, true, h.ports), 'rules_unconfirmed'); assert.equal(h.sends, 0); assert.equal(h.reads, 1); assert.equal(clears, 0);
});
test('late focus loss after committed clear does not persist or resend the accepted action', async () => {
  const h = harness(), clear = h.ports.clear; h.ports.clear = async () => { await clear(); h.blur(); };
  await assert.rejects(executeEventAdminIntent(structuredClone(original), false, h.ports), /focused/);
  assert.equal(h.pending, null); assert.equal(h.sends, 1);
});
test('a wrong receipt remains uncertain and cannot clear exact retained evidence', async () => {
  const h = harness(); h.ports.send = async () => ({ id, discarded: false });
  await assert.rejects(executeEventAdminIntent(structuredClone(original), false, h.ports), /exact action/);
  assert.equal(h.pending?.accepted, undefined); assert.deepEqual(h.pending?.body, original.body);
});
