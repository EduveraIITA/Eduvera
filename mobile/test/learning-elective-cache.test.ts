import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import { QueryClient, QueryClientProvider, QueryObserver, useQuery, useQueryClient } from '@tanstack/react-query';
import ts from 'typescript';
import * as policy from '../src/lib/learning-elective-policy';
import { NativePendingActionJournal, nativePendingScopeKey, type NativePendingScope } from '../src/lib/native-pending-action';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const change = id(3), command = id(4), owner = `/areas/fees/ledger?elective_review=${change}`;
const result = () => ({ id: change, command_id: command, revision: 4, action: 'finance.classify', state: 'no_financial_change' });
const proof = () => ({ handler: 'learning.elective_change', source_id: change, command_id: command, action: 'finance.classify', state: 'accepted', result: result() });
const current = () => ({ id: change, revision: 4, state: 'no_financial_change', can_classify: false });
type WorkspaceProjection = { work: { items: Array<{ id: string; title: string }>; counts: { needs_me: number } }; workBadge: number };
const before:WorkspaceProjection = { work: { items: [{ id: id(8), title: 'Review elective Finance impact' }], counts: { needs_me: 1 } }, workBadge: 1 };
const after:WorkspaceProjection = { work: { items: [], counts: { needs_me: 0 } }, workBadge: 0 };
function selected(mode: 'live' | 'simulation'): NativePendingScope { return { actorId: id(1), schoolId: id(2), mode, namespaceId: mode === 'live' ? null : `scenario:${id(5)}:run:${id(6)}`, origin: 'https://campus.example' }; }
async function mount(mode: 'live' | 'simulation', work: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const scope = selected(mode), scopeKey = nativePendingScopeKey(scope), readPath = policy.electiveFinanceRead(scope, change), workspaceKey = ['campus', scopeKey, '/api/v1/workspace'];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const reads: string[] = [], refreshed: unknown[] = [], foreign: unknown[][] = [], observed: Array<() => void> = [];
  let options: any, epoch = 0, detailFails = false, workspaceFails = false, sendingFails = false, forged = false, driftDuringDetail = false, sendCount = 0, raw: string | null = null;
  const assertCurrent = () => { if (epoch !== 0) throw new Error('The account, campus, world or focused source changed.'); };
  client.setQueryData(workspaceKey, before);
  const dependencies: Record<string, unknown> = {
    '@tanstack/react-query': { useQueryClient },
    '../auth/SessionProvider': { useSession: () => ({ scopeKey, schoolId: scope.schoolId, user: { id: scope.actorId }, environment: { mode, namespace_id: scope.namespaceId } }) },
    './api': { apiFetch: async (path: string) => { reads.push('detail:' + path); assert.equal(path, readPath); if (detailFails) throw new Error('Current owning read unavailable'); if(driftDuringDetail)epoch++; return current(); } },
    './learning-elective-policy': policy,
    // The actual owning hook supplies its callbacks to the REAL shared journal
    // below. Its React storage/focus adapter is the only replaced writer port.
    './learning-write': { useLearningCommand: (value: unknown) => { options = value; return {}; } },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/use-learning-elective.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Error, URL, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  function Screen() {
    exports.useLearningElective(owner, readPath, (value: unknown) => refreshed.push(value));
    const query = useQuery({ queryKey: workspaceKey, queryFn: async () => { reads.push('workspace'); if (workspaceFails) throw new Error('Workspace refresh unavailable'); return after; } });
    return React.createElement('main', null, React.createElement('span', { 'data-work-badge': true }, String(query.data!.workBadge)), query.data!.work.items.map(item => React.createElement('p', { key: item.id }, item.title)));
  }
  function observe(key: unknown[], label: string, enabled = true) {
    client.setQueryData(key, { old: label });
    const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => { reads.push(label); return { fresh: label }; }, enabled, retry: false, staleTime: Infinity });
    observed.push(observer.subscribe(() => {})); return key;
  }
  const related = [
    ['offerings', `/api/v1/learning/offerings/?page=1`],
    ['enrollment', `/api/v1/learning/offerings/${id(10)}/`],
    ['elective_options', `/api/v1/learning/elective-changes/options?source_offering_id=${id(10)}&person_id=${id(11)}`],
    ['academic_review', policy.electiveChangeRead(change)],
    ['finance', `/api/v1/schools/${scope.schoolId}/fees/workspace/?person_id=${id(11)}`],
    ['activity', `/api/v1/schools/${scope.schoolId}/activities/occurrences?from=2026-11-08&until=2026-11-08`],
    ['course_calendar', `/api/v1/schools/${scope.schoolId}/assessments/calendar/?from=2026-11-08&to=2026-11-22&academic_context=offering_v1`],
  ].map(([label, path]) => ({ label: label!, key: observe(['campus', scopeKey, path], label!) }));
  related.push({ label: 'important_calendar', key: observe(['campus', scopeKey, 'important-calendar', scope.actorId, scope.schoolId, 'assigned', '', id(11), 'Asia/Kolkata', '2026-11-08', '2026-11-22', 'assessments', '/areas/assessments/results?scope=mine'], 'important_calendar') });
  const unrelated = observe(['campus', scopeKey, `/api/v1/schools/${scope.schoolId}/dining/services`], 'unrelated');
  const disabled = observe(['campus', scopeKey, `/api/v1/learning/offerings/?page=2`], 'disabled_offerings', false);
  const mismatchedCalendar = observe(['campus', scopeKey, 'important-calendar', id(20), scope.schoolId], 'wrong_actor_calendar');
  for (const variant of [{ ...scope, actorId: id(20) }, { ...scope, schoolId: id(20) }, { ...scope, mode: 'simulation' as const, namespaceId: `scenario:${id(5)}:run:${id(20)}` }, { ...scope, origin: 'https://other.example' }]) foreign.push(observe(['campus', nativePendingScopeKey(variant), '/api/v1/workspace'], 'foreign_' + foreign.length));
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const journal = () => new NativePendingActionJournal({ scope, domain: 'learning', storage, randomId: () => command,
    send: async () => { sendCount++; reads.push('command'); if (sendingFails) throw new Error('Command outcome unknown'); return result(); },
    read: async retained => { reads.push('confirmation'); assert.equal(retained.refreshPath, policy.electiveChangeConfirmationPath(scope, change, 'finance.classify', command)); return forged ? { ...proof(), command_id: id(99) } : proof(); } });
  const root = createRoot(dom.window.document.getElementById('root'));
  const context = () => ({ ownerHref: owner, refreshPath: readPath, resolveRefreshPath: options.resolveRefreshPath, accepted: options.onAccepted, assertActive: assertCurrent });
  try {
    await act(async () => root.render(React.createElement(QueryClientProvider, { client, children: React.createElement(Screen) })));
    assert.equal(reads.length, 0, 'Fresh cached active queries must not refetch before a confirmed action.');
    await work({ client, scopeKey, scope, reads, refreshed, foreign, related, unrelated, disabled, mismatchedCalendar, workspaceKey, readPath,
      text: () => dom.window.document.body.textContent ?? '', badge: () => dom.window.document.querySelector('[data-work-badge]')?.textContent,
      raw: () => raw, sends: () => sendCount, journal, context,
      failDetail(value: boolean) { detailFails = value; }, failWorkspace(value: boolean) { workspaceFails = value; }, loseSend(value: boolean) { sendingFails = value; }, forge(value: boolean) { forged = value; }, driftOnDetail(value: boolean) { driftDuringDetail = value; },
      async run(writer: NativePendingActionJournal) { await act(async () => { await writer.hydrate(); await writer.run(policy.learningElectiveCommand(scope, change, 'finance.classify', { expected_revision: 3, expected_ledger_basis_hash: 'a'.repeat(64), outcome: 'no_financial_change', reason: 'Reviewed the exact existing account and current elective.' }), context()); }); await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));}); },
      async recover(writer: NativePendingActionJournal) { await act(async () => { await writer.hydrate(); await writer.recover(context()); }); await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));}); },
    });
  } finally { await act(async () => root.unmount()); for (const stop of observed) stop(); client.clear(); dom.window.close(); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); }
}

test('mounted elective owner refreshes shared Today/Work badge and affected current queries only after exact accepted receipt in Live and Simulation', async () => {
  for (const mode of ['live', 'simulation'] as const) await mount(mode, async h => {
    const writer = h.journal(); await h.run(writer);
    assert.equal(h.raw(), null); assert.equal(h.sends(), 1); assert.equal(h.refreshed.length, 1);
    assert.equal(h.badge(), '0'); assert.doesNotMatch(h.text(), /Review elective Finance impact/);
    assert.ok(h.reads.indexOf('confirmation') < h.reads.findIndex((value: string) => value.startsWith('detail:')));
    for (const { label, key } of h.related) { assert.equal(h.reads.filter((value: string) => value === label).length, 1, label); assert.deepEqual(h.client.getQueryData(key), { fresh: label }); }
    for (const key of h.foreign) { assert.equal(h.client.getQueryState(key).isInvalidated, false); assert.deepEqual(h.client.getQueryData(key), { old: 'foreign_' + h.foreign.indexOf(key) }); }
    assert.equal(h.reads.includes('unrelated'), false); assert.equal(h.reads.includes('disabled_offerings'), false); assert.equal(h.reads.includes('wrong_actor_calendar'), false);
    assert.deepEqual(h.client.getQueryData(['campus', h.scopeKey, h.readPath]), current());
  });
});
test('unknown command, forged confirmation and failed owning read never refresh Work; exact accepted relaunch retries reads only', async () => {
  await mount('live', async h => {
    h.loseSend(true); const first = h.journal(); await h.run(first); assert.equal(JSON.parse(h.raw()).phase, 'unknown'); assert.equal(h.badge(), '1'); assert.equal(h.reads.includes('workspace'), false); assert.equal(h.refreshed.length, 0);
    h.loseSend(false); h.forge(true); const forged = h.journal(); await h.recover(forged); assert.equal(JSON.parse(h.raw()).phase, 'accepted'); assert.equal(h.badge(), '1'); assert.equal(h.reads.some((value: string) => value.startsWith('detail:')), false);
    h.forge(false); h.failDetail(true); const offline = h.journal(); await h.recover(offline); assert.equal(JSON.parse(h.raw()).phase, 'accepted'); assert.equal(h.badge(), '1'); assert.equal(h.reads.includes('workspace'), false);
    h.failDetail(false); const recovered = h.journal(); await h.recover(recovered); assert.equal(h.raw(), null); assert.equal(h.sends(), 2, 'Only the original unknown command is retried; accepted recovery performs no POST.'); assert.equal(h.badge(), '0'); assert.equal(h.refreshed.length, 1);
  });
});
test('failed active workspace refresh retains accepted command and recovers current read models without repeating Finance decision', async () => {
  await mount('live', async h => {
    h.failWorkspace(true); const first = h.journal(); await h.run(first);
    assert.equal(JSON.parse(h.raw()).phase, 'accepted'); assert.equal(h.badge(), '1'); assert.equal(h.refreshed.length, 0); assert.equal(h.sends(), 1);
    h.failWorkspace(false); const recovered = h.journal(); await h.recover(recovered);
    assert.equal(h.raw(), null); assert.equal(h.sends(), 1); assert.equal(h.badge(), '0'); assert.equal(h.refreshed.length, 1);
  });
});
test('context loss during the fresh owning read prevents shared cache updates and keeps accepted intent', async () => {
  await mount('simulation', async h => {
    h.driftOnDetail(true);const writer=h.journal();await h.run(writer);
    assert.equal(JSON.parse(h.raw()).phase,'accepted');assert.equal(h.sends(),1);assert.equal(h.badge(),'1');assert.equal(h.refreshed.length,0);
    assert.equal(h.reads.includes('confirmation'),true);assert.equal(h.reads.some((value:string)=>value.startsWith('detail:')),true);assert.equal(h.reads.includes('workspace'),false);
    assert.equal(h.client.getQueryData(['campus',h.scopeKey,h.readPath]),undefined);
    assert.equal(h.client.getQueryState(h.workspaceKey).isInvalidated,false);
    for(const key of h.foreign)assert.equal(h.client.getQueryState(key).isInvalidated,false);
  });
});
