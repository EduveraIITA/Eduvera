import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertVisitOnboardingReceipt, gateVisitOnboardingAcceptedPath, gateVisitOnboardingInput, gateVisitOnboardingRoot, readVisitOnboardingReveal, readVisitOnboardingState, sameVisitOnboardingSource, visitOnboardingShareUrl } from '../src/lib/gate-visit-onboarding';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';
import { shareVisitLinkWithBrowser, visitLinkEmailHref } from '../src/lib/visit-onboarding-share-core';
import * as policy from '../src/lib/gate-visit-onboarding';
import * as shareCore from '../src/lib/visit-onboarding-share-core';

const school = '10000000-0000-4000-8000-000000000001', visit = '20000000-0000-4000-8000-000000000001', key = '30000000-0000-4000-8000-000000000001', other = '40000000-0000-4000-8000-000000000001';
const scope: NativePendingScope = { actorId: 'actor-a', schoolId: school, origin: 'https://campus.example', mode: 'live', namespaceId: null };
const href = `/areas/in-out/visits?visit=${visit}`, root = gateVisitOnboardingRoot(school, visit), until = '2099-10-30T12:00:00Z';
const state = { visit_id: visit, visit_revision: 4, revision: 0, can_manage: true, can_issue: true, can_revoke: false, public_onboarding_supported: true, current: null };
const active = { ...state, revision: 1, can_revoke: true, current: { id: key, revision: 1, state: 'active' as const, ends_at: until, issued_at: '2026-10-30T10:00:00Z', registration_count: 3 } };
const secretUrl = `https://public.example/visit-join#token=${'a'.repeat(43)}`;
function record(action: 'issue' | 'revoke' = 'issue', source = action === 'issue' ? state : active): NativePendingAction {
  const input = gateVisitOnboardingInput(school, source, action, action === 'issue' ? until : undefined);
  return { version: 1, domain: 'gate', scope, clientId: key, ownerHref: href, endpoint: input.endpoint, source: input.source, refreshPath: root, method: 'POST', phase: 'prepared', replayPolicy: 'same_request', createdAt: '2026-10-30T10:00:00Z', payload: { kind: 'json', body: JSON.stringify({ ...input.body, command_id: key }) } };
}
const result = { ...active, receipt: { command_id: key, link_id: key, revision: 1, action: 'issue', replayed: false }, join_url: secretUrl };
const receipt = { state: 'accepted', command_id: key, visit_id: visit, source_id: key, revision: 1, action: 'issue' };

test('metadata is exact, source-bound and credential-free; planned counts are never read as registrations', () => {
  assert.deepEqual(readVisitOnboardingState(state, visit), state); assert.deepEqual(readVisitOnboardingState(active, visit), active);
  for (const bad of [null, [], { ...state, visit_id: other }, { ...state, visit_revision: 0 }, { ...state, revision: 1 }, { ...state, join_url: secretUrl }, { ...state, can_issue: 'yes' }, { ...state, can_manage: false }, { ...active, current: { ...active.current, revision: 2 } }, { ...active, current: { ...active.current, registration_count: -1 } }, { ...active, current: { ...active.current, ends_at: '2099-10-30T12:00' } }, { ...active, current: { ...active.current, join_url: secretUrl } }, { ...active, can_revoke: false }]) assert.equal(readVisitOnboardingState(bad, visit), null);
  assert.equal(sameVisitOnboardingSource(active, { ...active, current: { ...active.current, registration_count: 4 } }), true);
  assert.equal(sameVisitOnboardingSource(active, { ...active, visit_revision: 5 }), false);
});

test('exact Gate mutation binds campus, visit, both revisions, source, body keys and receipt-only refresh', () => {
  const item = record(); assert.equal(validateNativePendingAction(item, scope, 'gate'), true);
  for (const delta of [
    { endpoint: root + 'reveal/' }, { endpoint: root.replace(school, other) }, { endpoint: root.replace(visit, other) }, { refreshPath: root + '?token=x' }, { phase: 'accepted' },
    { method: 'PATCH' }, { replayPolicy: 'inspect_only' }, { ownerHref: '/areas/in-out/manage' }, { ownerHref: href + '&shared=1' }, { ownerHref: href + '&visit=' + visit }, { source: { ...item.source!, revision: 1 } },
    { source: { ...item.source!, fingerprint: JSON.stringify(['gate_visit', visit, 5]) } }, { source: { ...item.source!, sourceId: other } }, { receipt: result }, { join_url: secretUrl }, { source: { ...item.source!, join_url: secretUrl } }, { scope: { ...scope, join_url: secretUrl } },
  ]) assert.equal(validateNativePendingAction({ ...item, ...delta }, scope, 'gate'), false, JSON.stringify(delta));
  for (const body of [{ ...JSON.parse(item.payload.kind === 'json' ? item.payload.body : '{}'), join_url: secretUrl }, { action: 'issue', expected_revision: 0, expected_visit_revision: 4, command_id: other, ends_at: until }, { action: 'revoke', expected_revision: 0, expected_visit_revision: 4, command_id: key, ends_at: until }, { action: 'issue', expected_revision: 0, expected_visit_revision: 4, command_id: key }]) assert.equal(validateNativePendingAction({ ...item, payload: { kind: 'json', body: JSON.stringify(body) } }, scope, 'gate'), false);
  const accepted = { ...item, phase: 'accepted' as const, refreshPath: `${root}commands/${key}/` };
  assert.equal(validateNativePendingAction(accepted, scope, 'gate'), true); assert.equal(validateNativePendingAction({ ...accepted, refreshPath: `${root}commands/${other}/` }, scope, 'gate'), false);
  assert.equal(validateNativePendingAction(record('revoke'), scope, 'gate'), true);
  const sim = { ...scope, mode: 'simulation' as const, namespaceId: 'isolated-world' };
  assert.equal(validateNativePendingAction({ ...item, scope: sim }, sim, 'gate'), true); assert.equal(validateNativePendingAction(item, sim, 'gate'), false);
});

test('POST adoption and opaque GET receipt prove the exact command rather than a matching current link', () => {
  const item = record(); assert.equal(gateVisitOnboardingAcceptedPath(result, item), `${root}commands/${key}/`);
  for (const changed of [{ ...result, receipt: { ...result.receipt, command_id: other } }, { ...result, receipt: { ...result.receipt, revision: 2 } }, { ...result, visit_id: other }, { ...result, arbitrary: secretUrl }]) assert.throws(() => gateVisitOnboardingAcceptedPath(changed, item));
  const accepted = { ...item, phase: 'accepted' as const, refreshPath: `${root}commands/${key}/` }; assert.doesNotThrow(() => assertVisitOnboardingReceipt(receipt, accepted));
  for (const changed of [active, { ...receipt, state: 'pending' }, { ...receipt, source_id: other }, { ...receipt, command_id: other }, { ...receipt, visit_id: other }, { ...receipt, revision: 2 }, { ...receipt, action: 'revoke' }, { ...receipt, join_url: secretUrl }]) assert.throws(() => assertVisitOnboardingReceipt(changed, accepted));
});

test('lost issue response replays exactly; accepted refresh recovery only reads and never journals a credential', async () => {
  let raw: string | null = null, sends = 0, reads = 0, loseReply = true, loseRead = true;
  const persisted: string[] = [], bodies: string[] = [], paths: string[] = [];
  const storage = { read: async () => raw, write: async (value: string) => { persisted.push(value); raw = value; }, clear: async () => { raw = null; } };
  const create = () => new NativePendingActionJournal({ scope, domain: 'gate', storage, randomId: () => key, send: async item => { sends++; bodies.push(item.payload.kind === 'json' ? item.payload.body : ''); if (loseReply) throw new Error('Lost response'); return result; }, read: async item => { reads++; paths.push(item.refreshPath); if (loseRead) throw new Error('Lost read'); return receipt; } });
  const context = { ownerHref: href, refreshPath: root, assertActive() {}, resolveRefreshPath: gateVisitOnboardingAcceptedPath, accepted: (value: unknown, _assert: () => void, item: NativePendingAction) => assertVisitOnboardingReceipt(value, item) };
  const first = create(); await first.hydrate(); assert.equal(await first.run(gateVisitOnboardingInput(school, state, 'issue', until), context), false); assert.equal(first.snapshot().action?.phase, 'unknown');
  loseReply = false; const second = create(); await second.hydrate(); assert.equal(await second.recover(context), false); assert.equal(second.snapshot().action?.phase, 'accepted'); assert.equal(sends, 2); assert.equal(bodies[0], bodies[1]);
  loseRead = false; const third = create(); await third.hydrate(); assert.equal(await third.recover(context), true); assert.equal(sends, 2); assert.equal(reads, 2); assert.deepEqual(paths, [`${root}commands/${key}/`, `${root}commands/${key}/`]); assert.equal(raw, null);
  assert.ok(persisted.every(value => !value.includes('join_url') && !value.includes('token=') && !value.includes('public.example')));
});

test('reveal and sharing accept only the server public locator and exact active source', () => {
  assert.equal(visitOnboardingShareUrl(secretUrl), secretUrl); assert.equal(visitOnboardingShareUrl(secretUrl.replace('https://public.example', 'http://127.0.0.1:5173')), secretUrl.replace('https://public.example', 'http://127.0.0.1:5173'));
  for (const url of [secretUrl.replace('https:', 'http:'), secretUrl.replace('public.example', 'user@public.example'), secretUrl + '&other=x', secretUrl.replace('#token=', '?token='), secretUrl.replace('/visit-join', '/other'), secretUrl + ' ', secretUrl.replace('https:', 'javascript:'), secretUrl.replace('#token=', '#token=%61'), secretUrl.replace('/visit-join', '/visit-join/'), '//public.example/visit-join#token=' + 'a'.repeat(43)]) assert.throws(() => visitOnboardingShareUrl(url));
  const reveal = { visit_id: visit, visit_revision: 4, revision: 1, link_id: key, ends_at: until, join_url: secretUrl }; assert.deepEqual(readVisitOnboardingReveal(reveal, active), reveal);
  for (const source of [{ ...active, can_manage: false }, { ...active, public_onboarding_supported: false }, { ...active, visit_revision: 5 }, { ...active, current: { ...active.current, id: other } }, { ...active, current: { ...active.current, state: 'expired' as const } }]) assert.throws(() => readVisitOnboardingReveal(reveal, source));
  assert.throws(() => readVisitOnboardingReveal({ ...reveal, revision: 2 }, active));
});

test('browser share invokes its chooser within the activating call and provides honest unsupported/cancel outcomes', async () => {
  let calls = 0, settled = false; const pending = shareVisitLinkWithBrowser(secretUrl, () => {}, { share: async data => { calls++; assert.equal(data.url, secretUrl); await Promise.resolve(); settled = true; } });
  assert.equal(calls, 1); assert.equal(settled, false); assert.equal(await pending, 'opened');
  assert.equal(await shareVisitLinkWithBrowser(secretUrl, () => {}, {}), 'unavailable'); assert.equal(await shareVisitLinkWithBrowser(secretUrl, () => {}, { canShare: () => false, share: async () => { calls++; } }), 'unavailable');
  assert.equal(await shareVisitLinkWithBrowser(secretUrl, () => {}, { share: async () => { throw { name: 'AbortError' }; } }), 'dismissed');
  await assert.rejects(shareVisitLinkWithBrowser(secretUrl, () => { throw new Error('Source lost'); }, { share: async () => { calls++; } })); assert.equal(calls, 1);
  const email = new URL(visitLinkEmailHref(secretUrl)); assert.equal(email.protocol, 'mailto:'); assert.equal(email.pathname, ''); assert.equal(email.searchParams.get('subject'), 'Your campus visit'); assert.ok(email.searchParams.get('body')?.includes(secretUrl)); assert.equal(email.searchParams.size, 2);
});

function loadAdapter(web: boolean, deps: Record<string, unknown>) {
  const exports: Record<string, any> = {}, file = new URL(`../src/lib/visit-onboarding-share${web ? '.web' : ''}.ts`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require(name: string) { if (name === './gate-visit-onboarding') return policy; if (name === './visit-onboarding-share-core') return shareCore; if (name in deps) return deps[name]; throw new Error(name); } }); return exports;
}
test('native sharing is chooser-only; email opens a draft and clipboard is marked sensitive before release', async () => {
  const shares: unknown[] = [], drafts: string[] = [], clips: Array<[string, any]> = []; let activeContext = true;
  const adapter = loadAdapter(false, { 'react-native': { Share: { dismissedAction: 'dismissed', share: async (data: unknown) => { shares.push(data); return { action: 'opened' }; } }, Linking: { openURL: async (url: string) => { drafts.push(url); } } }, 'expo-clipboard': { StringFormat: { PLAIN_TEXT: 'plainText' }, setStringAsync: async (url: string, options: unknown) => { clips.push([url, options]); return true; } } });
  const guard = () => { if (!activeContext) throw new Error('Source lost'); };
  assert.equal(await adapter.shareVisitOnboardingLink(secretUrl, guard), 'opened'); assert.equal((shares[0] as any).message, secretUrl); assert.equal((shares[0] as any).url, undefined);
  await adapter.emailVisitOnboardingLink(secretUrl, guard); assert.equal(drafts.length, 1); assert.equal(new URL(drafts[0]!).protocol, 'mailto:');
  await adapter.copyVisitOnboardingLink(secretUrl, guard); assert.equal(clips[0]![0], secretUrl); assert.equal(clips[0]![1].android.isSensitive, true);
  activeContext = false; for (const name of ['shareVisitOnboardingLink','emailVisitOnboardingLink','copyVisitOnboardingLink']) await assert.rejects(adapter[name](secretUrl, guard)); assert.equal(shares.length, 1); assert.equal(drafts.length, 1); assert.equal(clips.length, 1);
});
