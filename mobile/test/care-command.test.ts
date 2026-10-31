import assert from 'node:assert/strict';
import test from 'node:test';
import { CareCommandJournal, exactCareRefusal, parseCareConfirmation, parseCareReceipt, parseCareReferences, serializeCareReferences, type CareReference } from '../src/lib/care-command';
const command = '11111111-1111-4111-8111-111111111111', caseId = '22222222-2222-4222-8222-222222222222', receiptId = '33333333-3333-4333-8333-333333333333', foreign = '44444444-4444-4444-8444-444444444444';
const scope = JSON.stringify(['https://campus.example', JSON.stringify(['actor', 'campus', 'simulation', 'run-a'])]);
const reference: CareReference = { commandId: command, caseId, slot: `case:${caseId}`, kind: 'action', expectedRevision: 3, phase: 'unknown', everUncertain: true };
const result = { id: caseId, revision: 4, receipt_id: receiptId, action: 'restricted_care.case.entry_added', receipt: 'Server receipt.' };
function fixture(initial: string | null = null) {
  let raw = initial, current = true, writes = 0, denied = false, confirmation: unknown = { state: 'not_found' };
  const stored: string[] = [];
  const journal = new CareCommandJournal({ scopeKey: scope, randomId: () => command, read: async () => raw, write: async value => { writes++; if (denied) throw new Error('storage denied'); raw = value; stored.push(value); }, capture: () => ({ assertCurrent() { if (!current) throw new Error('scope changed'); } }), confirm: async () => confirmation });
  return { journal, stored, get raw() { return raw; }, get writes() { return writes; }, deny(value: boolean) { denied = value; }, rebind() { current = false; }, confirm(value: unknown) { confirmation = value; } };
}
const context = (accepted: (value: unknown) => Promise<void> | void = () => {}) => ({ assertActive() {}, accepted });
test('durable Care whitelist rejects protected narrative, retry bodies and foreign scope instead of serializing them', () => {
  const raw = serializeCareReferences(scope, [reference]); assert.deepEqual(parseCareReferences(raw, scope), [reference]);
  for (const extra of [{ note: 'synthetic secret' }, { details: 'synthetic secret' }, { body: '{"note":"synthetic secret"}' }, { operation: 'callable draft' }]) assert.throws(() => serializeCareReferences(scope, [{ ...reference, ...extra }]));
  assert.throws(() => parseCareReferences(raw, scope + 'foreign')); assert.throws(() => parseCareReferences('{broken', scope));
  assert.throws(() => serializeCareReferences(scope, [{ ...reference, slot: `case:${foreign}` }]));
  assert.throws(() => serializeCareReferences(scope, [reference, reference]));
});
test('exact receipt/confirmation validates original case, next revision, action and receipt identity', () => {
  assert.equal(parseCareReceipt(result, reference).revision, 4);
  for (const row of [{ ...result, id: foreign }, { ...result, revision: 5 }, { ...result, receipt_id: 'wrong' }, { ...result, action: 'unrelated.changed' }, { ...result, action: undefined }]) assert.throws(() => parseCareReceipt(row, reference));
  assert.equal(parseCareConfirmation({ state: 'accepted', result }, reference).state, 'accepted'); assert.throws(() => parseCareConfirmation({ state: 'accepted', result: { ...result, id: foreign } }, reference)); assert.throws(() => parseCareConfirmation({ state: 'success' }, reference));
});
test('only exact owner refusal proof can retire a previously uncertain command', () => {
  const proof = { confirmation: 'not_accepted', receipt_state: 'absent', command_id: command, case_id: caseId, reason: 'stream_advanced' }, refusal = (value: unknown) => ({ status: 409, details: { error: { code: 'care_command_refused', fields: { care_command_refused: value } } } });
  assert.equal(exactCareRefusal(refusal(proof), reference), true);
  for (const changed of [{ ...proof, command_id: foreign }, { ...proof, case_id: foreign }, { ...proof, receipt_state: 'accepted' }, { ...proof, reason: 'ordinary_conflict' }]) assert.equal(exactCareRefusal(refusal(changed), reference), false);
});
test('protected request bytes remain session memory only while durable values are opaque references', async () => {
  const f = fixture(); await f.journal.hydrate(); let sends = 0;
  const narrative = 'A protected synthetic narrative that must not enter durable storage.';
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async id => { sends++; assert.equal(id, command); assert.ok(narrative); throw new Error('reply lost'); } }, context());
  assert.equal(sends, 1); assert.ok(f.raw); assert.equal(f.stored.some(value => value.includes(narrative)), false); assert.equal(f.stored.some(value => /"(?:note|details|body|operation)"/.test(value)), false);
  assert.equal(f.journal.snapshot().references[0]?.everUncertain, true);
});
test('reload cannot recreate a callable private draft, resubmit or substitute another payload', async () => {
  const f = fixture(serializeCareReferences(scope, [reference])); await f.journal.hydrate();
  await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, []); assert.equal(await f.journal.retry(command, context()), false);
  let replacements = 0; assert.equal(await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { replacements++; return result; } }, context()), false); assert.equal(replacements, 0); assert.equal(f.journal.snapshot().references.length, 1);
});
test('lost response is checked first; explicit same-session retry preserves original body and key', async () => {
  const f = fixture(); await f.journal.hydrate(); let attempts = 0; const bodies: string[] = [], original = JSON.stringify({ command_id: command, expected_revision: 3, note: 'Original synthetic private note.' });
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async id => { attempts++; assert.equal(id, command); bodies.push(original); if (attempts === 1) throw new Error('reply lost'); return result; } }, context());
  assert.equal(await f.journal.retry(command, context()), false); assert.equal(attempts, 1);
  await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, [command]);
  assert.equal(await f.journal.retry(command, context()), true); assert.deepEqual(bodies, [original, original]); assert.deepEqual(parseCareReferences(f.raw, scope), []);
});
test('accepted result with failed refresh clears private retry bytes and later recovery only reads', async () => {
  const f = fixture(); await f.journal.hydrate(); let sends = 0;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { sends++; return result; } }, context(async () => { throw new Error('refresh unavailable'); }));
  const retained = f.journal.snapshot().references[0]!; assert.equal(retained.phase, 'accepted'); assert.equal(f.journal.hasPrivate(retained), false); assert.ok(parseCareReferences(f.raw, scope)[0]?.receipt);
  await f.journal.check(command, context()); assert.equal(sends, 1); assert.equal(f.journal.snapshot().references.length, 0);
});
test('later generic access denial cannot discard an earlier uncertain save', async () => {
  const f = fixture(); await f.journal.hydrate(); let attempts = 0;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { attempts++; throw attempts === 1 ? new Error('reply lost') : Object.assign(new Error('access revoked'), { status: 403 }); } }, context());
  await f.journal.check(command, context()); await f.journal.retry(command, context()); assert.equal(f.journal.snapshot().references.length, 1); assert.equal(f.journal.snapshot().references[0]?.phase, 'unknown');
});
test('typed permanent refusal releases only its original slot and requires a source review', async () => {
  const f = fixture(); await f.journal.hydrate();
  const proof = { confirmation: 'not_accepted', receipt_state: 'absent', command_id: command, case_id: caseId, reason: 'reporting_incomplete' };
  const refusal = { status: 409, details: { error: { code: 'care_command_refused', fields: { care_command_refused: proof } } } };
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { throw refusal; } }, context());
  assert.equal(f.journal.snapshot().references.length, 0); assert.deepEqual(f.journal.snapshot().reviewNeeded, [`case:${caseId}`]); f.journal.reviewed(`case:${caseId}`); assert.deepEqual(f.journal.snapshot().reviewNeeded, []);
});
test('denied reference persistence sends nothing and preserves the opaque original intent for recovery', async () => {
  const f = fixture(); await f.journal.hydrate(); f.deny(true); let sends = 0;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { sends++; return result; } }, context());
  assert.equal(sends, 0); assert.equal(f.journal.snapshot().blocked, true); assert.equal(f.journal.snapshot().references.length, 1);
  f.deny(false); await f.journal.check(command, context()); assert.equal(f.journal.snapshot().blocked, false); assert.equal(sends, 0);
});
test('actor/world loss cannot accept a late write response or release its reference', async () => {
  const f = fixture(); await f.journal.hydrate(); let accepted = false;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { f.rebind(); return result; } }, context(() => { accepted = true; }));
  assert.equal(accepted, false); assert.equal(f.journal.snapshot().references[0]?.phase, 'unknown'); assert.equal(f.journal.snapshot().references.length, 1);
});
test('leaving Care drops callable private retry but retains checkable opaque receipt identity', async () => {
  const f = fixture(); await f.journal.hydrate();
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { throw new Error('reply lost'); } }, context());
  await f.journal.check(command, context()); assert.equal(f.journal.hasPrivate(reference), true); f.journal.dropPrivate();
  assert.equal(f.journal.hasPrivate(reference), false); assert.deepEqual(f.journal.snapshot().retryReady, []); assert.equal(f.journal.snapshot().references[0]?.commandId, command);
});
test('an accepted handover receipt confirms without requiring the former owner’s full case access', async () => {
  const handover = { id: result.id, revision: result.revision, receipt_id: result.receipt_id, action: 'restricted_care.case.reassigned' }, accepted: CareReference = { ...reference, phase: 'accepted', receipt: handover };
  const f = fixture(serializeCareReferences(scope, [accepted])); await f.journal.hydrate(); let refreshes = 0;
  await f.journal.check(command, context(value => { assert.equal((value as typeof handover).action, handover.action); refreshes++; }));
  assert.equal(refreshes, 1); assert.equal(f.journal.snapshot().references.length, 0);
});
test('a fresh pending or failed confirmation withdraws an earlier explicit retry option', async () => {
  const f = fixture(); await f.journal.hydrate(); let sends = 0;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { sends++; throw new Error('reply lost'); } }, context());
  await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, [command]);
  f.confirm({ state: 'pending' }); await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, []);
  assert.equal(await f.journal.retry(command, context()), false); assert.equal(sends, 1);
  f.confirm({ state: 'not_found' }); await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, [command]);
  f.confirm({ state: 'accepted', result: { ...result, id: foreign } }); await f.journal.check(command, context()); assert.deepEqual(f.journal.snapshot().retryReady, []);
  assert.equal(await f.journal.retry(command, context()), false); assert.equal(sends, 1);
});
test('corrupt storage is kept intact and blocks replacement saves until its original bytes validate', async () => {
  const f = fixture('{unreadable private metadata'); await f.journal.hydrate(); let sends = 0;
  assert.equal(f.journal.snapshot().ready, true); assert.equal(f.journal.snapshot().blocked, true);
  assert.equal(await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { sends++; return result; } }, context()), false);
  await f.journal.retryStorage(); assert.equal(f.journal.snapshot().blocked, true); assert.equal(f.raw, '{unreadable private metadata'); assert.equal(f.writes, 0); assert.equal(sends, 0);
});
test('intake fixes the original case identity and never starts another concern after a lost reply', async () => {
  const f = fixture(); await f.journal.hydrate(); let sends = 0;
  await f.journal.start({ kind: 'intake', expectedRevision: 0, operation: async id => { sends++; assert.equal(id, command); throw new Error('reply lost'); } }, context());
  const retained = f.journal.snapshot().references[0]!; assert.equal(retained.caseId, command); assert.equal(retained.expectedRevision, 0);
  assert.equal(await f.journal.start({ kind: 'intake', expectedRevision: 0, operation: async () => { sends++; return result; } }, context()), false);
  f.confirm({ state: 'accepted', result: { id: command, revision: 1, receipt_id: receiptId } }); await f.journal.check(command, context());
  assert.equal(sends, 1); assert.equal(f.journal.snapshot().references.length, 0);
});
test('accepted receipt storage rejects protected extra fields and clear failure cannot trigger a resend', async () => {
  const accepted: CareReference = { ...reference, phase: 'accepted', receipt: { id: caseId, revision: 4, receipt_id: receiptId, action: result.action } };
  for (const extra of [{ note: 'synthetic protected text' }, { receipt: 'synthetic protected text' }, { command_body: 'synthetic protected text' }]) assert.throws(() => serializeCareReferences(scope, [{ ...accepted, receipt: { ...accepted.receipt!, ...extra } }]));
  const f = fixture(); await f.journal.hydrate(); let sends = 0;
  await f.journal.start({ kind: 'action', caseId, expectedRevision: 3, operation: async () => { sends++; return result; } }, context(() => { f.deny(true); }));
  assert.equal(f.journal.snapshot().blocked, true); assert.equal(f.journal.snapshot().references[0]?.phase, 'accepted'); assert.equal(f.journal.hasPrivate(reference), false);
  f.deny(false); await f.journal.check(command, context()); assert.equal(sends, 1); assert.equal(f.journal.snapshot().references.length, 0);
});
test('receipt storage denial can recover by re-reading without replacing or clearing unread original bytes', async () => {
  let denied = true, reads = 0, writes = 0;
  const original = serializeCareReferences(scope, [reference]);
  const journal = new CareCommandJournal({ scopeKey: scope, randomId: () => foreign, read: async () => { reads++; if (denied) throw new Error('encrypted storage denied'); return original; }, write: async () => { writes++; }, capture: () => ({ assertCurrent() {} }), confirm: async () => ({ state: 'not_found' }) });
  await journal.hydrate(); assert.equal(journal.snapshot().blocked, true); assert.equal(journal.snapshot().references.length, 0);
  denied = false; await journal.retryStorage(); assert.equal(journal.snapshot().blocked, false); assert.deepEqual(journal.snapshot().references, [reference]); assert.equal(reads, 2); assert.equal(writes, 0);
});
