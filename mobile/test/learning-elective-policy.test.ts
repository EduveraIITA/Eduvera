import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';
import { electiveChangeRead, electiveFinanceRead, electiveChangeConfirmationPath, learningElectiveCommand, learningElectiveConfirmed, learningElectiveObsolete, learningElectiveRefreshPath, type ElectiveAction } from '../src/lib/learning-elective-policy';
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const changeId = id(1), key = id(2), owner = `/areas/messages/assignments?scope=elective_change&offering_id=${id(3)}&person_id=${id(4)}`;
const scope: NativePendingScope = { actorId: id(5), schoolId: id(6), mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const selection = { person: { id: id(4), expected_revision: 2 }, source_offering: { id: id(3), expected_revision: 3 }, source_enrollment: { id: id(7), expected_revision: 1 }, destination_offering: { id: id(8), expected_revision: 2 }, effective_on: '2026-11-16' };
function body(kind: ElectiveAction) {
  const command = { command_id: key, expected_revision: kind === 'request' ? 0 : 3 };
  return kind === 'request' ? { ...command, change_id: changeId, selection, preview_fingerprint: 'a'.repeat(64), reason: 'Transfer to the approved elective.', catch_up: { kind: 'not_needed', reason: 'No destination teaching has been missed.' }, finance_reviewer: null, confirm_delivery: false }
    : kind === 'finance.assign' ? { ...command, reviewer: { user_id: id(9), eligibility_hash: 'b'.repeat(64) }, confirm_delivery: true }
      : kind === 'finance.classify' ? { ...command, expected_ledger_basis_hash: 'c'.repeat(64), outcome: 'no_financial_change', reason: 'Reviewed current account. No fee adjustment is required.' }
        : kind === 'withdraw' ? { ...command, reason: 'The learner chose to keep the current course.' } : command;
}
function action(kind: ElectiveAction, context = scope): NativePendingAction {
  const input = learningElectiveCommand(context, changeId, kind, body(kind));
  return { version: 1, scope: context, domain: 'learning', clientId: key, endpoint: input.endpoint, ownerHref: owner, refreshPath: kind === 'finance.classify' ? electiveFinanceRead(context, changeId) : electiveChangeRead(changeId),
    method: 'POST', payload: { kind: 'json', body: JSON.stringify(body(kind)) }, source: input.source!, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-11-08T00:00:00Z' };
}
function result(kind: ElectiveAction) {
  return { id: changeId, command_id: key, revision: kind === 'request' ? 1 : 4, action: kind,
    state: kind === 'request' ? 'unassigned' : kind === 'finance.assign' ? 'waiting_for_finance' : kind === 'finance.classify' ? 'no_financial_change' : kind === 'apply' ? 'applied' : 'withdrawn',
    ...(kind === 'apply' ? { source_enrollment_id: id(7), destination_enrollment_id: id(10), effective_on: selection.effective_on, schedule_revisions: [] } : {}) };
}
const confirmation = (kind: ElectiveAction) => ({ handler: 'learning.elective_change', source_id: changeId, command_id: key, action: kind, state: 'accepted', result: result(kind) });
const kinds: ElectiveAction[] = ['request', 'finance.assign', 'finance.classify', 'apply', 'withdraw'];
test('all five elective mutations use the actual shared validator in both worlds with bounded exact bodies', () => {
  for (const mode of ['live', 'simulation'] as const) for (const kind of kinds) {
    const context = { ...scope, mode, namespaceId: mode === 'simulation' ? `scenario:${id(11)}:run:${id(12)}` : null }, retained = action(kind, context);
    assert.equal(validateNativePendingAction(retained, context, 'learning'), true, kind);
    assert.equal(validateNativePendingAction({ ...retained, payload: { kind: 'json', body: JSON.stringify({ ...body(kind), access_token: 'forbidden' }) } }, context, 'learning'), false);
    for (const patch of [{ actorId: id(13) }, { schoolId: id(13) }, { origin: 'https://other.example' }, { mode: 'simulation' as const, namespaceId: `scenario:${id(11)}:run:${id(13)}` }])
      assert.equal(validateNativePendingAction(retained, { ...context, ...patch }, 'learning'), false);
  }
});
test('cross-campus Finance paths and mixed change/source/revision endpoints are refused by the actual validator', () => {
  for (const kind of kinds) { const value = action(kind);
    for (const patch of [{ endpoint: value.endpoint.replace(changeId, id(20)) }, { source: { ...value.source!, sourceId: id(20) } }, { source: { ...value.source!, revision: 99 } }, { refreshPath: value.refreshPath + '&extra=1' }]) {
      if ('endpoint' in patch && kind === 'request') continue;
      assert.equal(validateNativePendingAction({ ...value, ...patch }, scope, 'learning'), false);
    }
  }
  const finance = action('finance.classify'); assert.equal(validateNativePendingAction({ ...finance, endpoint: finance.endpoint.replace(scope.schoolId, id(20)) }, scope, 'learning'), false);
});
test('request review requires explicit missing-route state, exact source refs and a real catch-up disposition', () => {
  const input = body('request');
  for (const patch of [{ finance_reviewer: null, confirm_delivery: true }, { catch_up: { kind: 'not_needed', reason: '' } }, { catch_up: { kind: 'plan', summary: 'x', due_on: null } }, { selection: { ...selection, destination_offering: selection.source_offering } }])
    assert.throws(() => learningElectiveCommand(scope, changeId, 'request', { ...input, ...patch }));
  assert.doesNotThrow(() => learningElectiveCommand(scope, changeId, 'request', { ...input, catch_up: { kind: 'plan', summary: 'Read the existing published introduction and meet the destination teacher.', due_on: '2026-11-20' } }));
});
test('POST receipts bind action, exact command and next revision before switching to canonical receipt GET', () => {
  for (const kind of kinds) { const value = action(kind), path = electiveChangeConfirmationPath(scope, changeId, kind, key);
    assert.equal(learningElectiveRefreshPath(result(kind), value), path);
    for (const patch of [{ id: id(20) }, { command_id: id(20) }, { action: 'other' }, { revision: 99 }, { state: 'other' }]) assert.throws(() => learningElectiveRefreshPath({ ...result(kind), ...patch }, value));
    const accepted = { ...value, phase: 'accepted' as const, refreshPath: path };
    assert.equal(validateNativePendingAction(accepted, scope, 'learning'), true); assert.deepEqual(learningElectiveConfirmed(confirmation(kind), accepted), result(kind));
    for (const patch of [{ handler: 'other' }, { source_id: id(20) }, { command_id: id(20) }, { action: 'other' }, { state: 'not_found' }, { state: 'pending' }, { result: { ...result(kind), command_id: id(20) } }]) assert.throws(() => learningElectiveConfirmed({ ...confirmation(kind), ...patch }, accepted));
    assert.throws(() => learningElectiveConfirmed({ id: changeId, revision: 4, state: 'applied' }, accepted), 'A detail GET is not a command receipt.');
  }
});
function memory(initial: string | null = null) { let bytes = initial; return { storage: { read: async () => bytes, write: async (value: string) => { bytes = value; }, clear: async () => { bytes = null; } } satisfies NativePendingStorage, raw: () => bytes }; }
const context = (kind: ElectiveAction) => ({ ownerHref: owner, refreshPath: action(kind).refreshPath, assertActive() {}, resolveRefreshPath: learningElectiveRefreshPath,
  accepted(value: unknown, _assert: () => void, retained: NativePendingAction) { learningElectiveConfirmed(value, retained); } });
test('real shared journal retains lost elective reply across relaunch and retries only original command/body in both worlds', async () => {
  for (const mode of ['live', 'simulation'] as const) {
    const selected = { ...scope, mode, namespaceId: mode === 'simulation' ? `scenario:${id(11)}:run:${id(12)}` : null }, storage = memory(), sent: NativePendingAction[] = [];
    const make = (lose: boolean) => new NativePendingActionJournal({ scope: selected, domain: 'learning', storage: storage.storage, randomId: () => key,
      send: async value => { sent.push(value); if (lose) throw new Error('Response lost after possible commit'); return result('request'); }, read: async () => confirmation('request') });
    const first = make(true); await first.hydrate(); assert.equal(await first.run(learningElectiveCommand(selected, changeId, 'request', body('request')), context('request')), false); assert.ok(storage.raw());
    const next = make(false); await next.hydrate(); assert.equal(await next.run(learningElectiveCommand(selected, changeId, 'withdraw', body('withdraw')), context('request')), false);
    assert.equal(await next.recover(context('request')), true); assert.equal(sent.length, 2); assert.equal(sent[0]!.clientId, sent[1]!.clientId); assert.deepEqual(sent[0]!.payload, sent[1]!.payload); assert.equal(storage.raw(), null);
  }
});
test('accepted Finance classification relaunch reads only exact confirmation and forged GET evidence remains held', async () => {
  const storage = memory(); let sends = 0; const reads: string[] = [];
  const make = (read: () => Promise<unknown>) => new NativePendingActionJournal({ scope, domain: 'learning', storage: storage.storage, randomId: () => key,
    send: async () => { sends++; return result('finance.classify'); }, read: async retained => { reads.push(retained.refreshPath); return read(); } });
  const first = make(async () => { throw new Error('Receipt GET temporarily unavailable'); }); await first.hydrate();
  assert.equal(await first.run(learningElectiveCommand(scope, changeId, 'finance.classify', body('finance.classify')), context('finance.classify')), false);
  assert.equal(JSON.parse(storage.raw()!).phase, 'accepted');
  const forged = make(async () => ({ ...confirmation('finance.classify'), command_id: id(99) })); await forged.hydrate(); assert.equal(await forged.recover(context('finance.classify')), false); assert.ok(storage.raw()); assert.equal(sends, 1);
  const final = make(async () => confirmation('finance.classify')); await final.hydrate(); assert.equal(await final.recover(context('finance.classify')), true); assert.equal(sends, 1); assert.equal(storage.raw(), null);
  assert.deepEqual(new Set(reads), new Set([electiveChangeConfirmationPath(scope, changeId, 'finance.classify', key)]));
});
function proof(value = action('apply')) { return { handler: 'learning.elective_change', source_id: changeId, command_id: key, action: 'apply', expected_revision: 3, current_revision: 4,
  school_id: scope.schoolId, actor_user_id: scope.actorId, environment_namespace_id: `live:${scope.schoolId}`, confirmation: 'permanently_inapplicable', receipt_state: 'absent', reason: 'review_advanced', reviewed_request: JSON.parse((value.payload as { body: string }).body) }; }
const obsolete = (value: unknown) => ({ status: 409, details: { error: { code: 'elective_change_obsolete', fields: { elective_change_obsolete: value } } } });
test('only full-intent current-world absent-command proof marks an unknown elective action obsolete', () => {
  const value = action('apply'), evidence = proof(value); assert.equal(learningElectiveObsolete(obsolete(evidence), value), true);
  for (const patch of [{ handler: 'other' }, { source_id: id(20) }, { command_id: id(20) }, { action: 'withdraw' }, { expected_revision: 2 }, { current_revision: 3 }, { school_id: id(20) }, { actor_user_id: id(20) }, { environment_namespace_id: `scenario:${id(20)}:run:${id(21)}` }, { receipt_state: 'accepted' }, { reviewed_request: { ...body('apply'), expected_revision: 2 } }])
    assert.equal(learningElectiveObsolete(obsolete({ ...evidence, ...patch }), value), false);
  assert.equal(learningElectiveObsolete({ status: 409 }, value), false); assert.equal(learningElectiveObsolete({ status: 500 }, value), false);
  assert.equal(learningElectiveObsolete(obsolete(evidence), { ...value, phase: 'accepted', refreshPath: electiveChangeConfirmationPath(scope, changeId, 'apply', key) }), false, 'Accepted evidence always takes precedence over a later absent proof.');
});
test('actual shared journal releases exact obsolete unknown proof without relying on first screen callback; all mismatches stay retained', async () => {
  const retained = action('apply');
  for (const [failure, clears] of [[{ status: 409 }, false], [obsolete({ ...proof(), actor_user_id: id(20) }), false], [obsolete(proof()), true]] as const) {
    const storage = memory(JSON.stringify(retained));
    const journal = new NativePendingActionJournal({ scope, domain: 'learning', storage: storage.storage, randomId: () => key, send: async () => { throw failure; }, read: async () => ({}) });
    await journal.hydrate(); assert.equal(await journal.recover(context('apply')), false); assert.equal(storage.raw() === null, clears); assert.equal(journal.snapshot().obsolete, clears);
  }
});
test('durable terminal refusal releases only the exact full reviewed request after response-loss relaunch; accepted proof and mismatches stay held', async () => {
  for (const mode of ['live', 'simulation'] as const) {
    const selected = { ...scope, mode, namespaceId: mode === 'simulation' ? `scenario:${id(11)}:run:${id(12)}` : null }, retained = action('request', selected);
    const proof = { confirmation: 'terminal_refusal', receipt_state: 'completed', terminal_state: 'conflicted', handler: 'learning.elective_change',
      source_id: changeId, command_id: key, action: 'request', expected_revision: 0, school_id: selected.schoolId, actor_user_id: selected.actorId,
      environment_namespace_id: selected.namespaceId ?? `live:${selected.schoolId}`, reason_code: 'elective_review_refused', payload_hash: 'a'.repeat(64), refusal_id: id(30), reviewed_request: body('request') };
    const failure = (patch: object = {}) => ({ status: 409, details: { error: { code: 'elective_change_refused', fields: { elective_change_refusal: { ...proof, ...patch } } } } });
    assert.equal(learningElectiveObsolete(failure(), retained), true);
    for (const patch of [{ actor_user_id: id(30) }, { school_id: id(30) }, { environment_namespace_id: 'foreign' }, { command_id: id(30) }, { action: 'apply' }, { receipt_state: 'absent' }, { payload_hash: 'invalid' }, { reviewed_request: { ...body('request'), reason: 'Different intent' } }])
      assert.equal(learningElectiveObsolete(failure(patch), retained), false);
    const accepted = { ...retained, phase: 'accepted' as const, refreshPath: electiveChangeConfirmationPath(selected, changeId, 'request', key) };
    assert.equal(learningElectiveObsolete(failure(), accepted), false);
    const storage = memory(JSON.stringify(retained)), journal = new NativePendingActionJournal({ scope: selected, domain: 'learning', storage: storage.storage, randomId: () => key,
      send: async () => { throw failure(); }, read: async () => ({}) });
    await journal.hydrate(); assert.equal(await journal.recover(context('request')), false); assert.equal(storage.raw(), null); assert.equal(journal.snapshot().obsolete, true);
  }
});
