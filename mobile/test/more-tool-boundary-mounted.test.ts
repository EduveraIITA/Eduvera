import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as normalizer from '../../packages/contracts/src/workspace-normalizer';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const actor = '10000000-0000-4000-8000-000000000001', campus = '10000000-0000-4000-8000-000000000002';
const namespace = 'scenario:10000000-0000-4000-8000-000000000003:run:10000000-0000-4000-8000-000000000004';
const child = { key: 'institution', label: 'Campus setup', href: '/more/setup/institution' };
const launcher = { key: 'setup', label: 'Campus setup', href: '/more/setup' };
function manifest(mode: 'live' | 'simulation' = 'live') {
  return { revision: 'current', generated_at: '2026-11-08T10:00:00Z',
    context: { actor_user_id: actor, institution_id: campus, environment: mode === 'live' ? { kind: 'live' } : { kind: 'simulation', namespace_id: namespace, virtual_now: '2026-11-08T10:00:00Z' } },
    today: { now: [], next: [], attention: { total: 0, overdue: 0, due_soon: 0 } }, work: { total: 0, items: [] }, areas: [],
    more: { groups: [{ key: 'setup', label: 'Campus setup', items: [launcher] }], setup: [child], other: [] },
    freshness: { state: 'current', as_of: '2026-11-08T10:00:00Z', source_revision: 'current' } };
}
async function harness(run: (h: any) => Promise<void>, mode: 'live' | 'simulation' = 'live') {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let data: any = manifest(mode), itemKey = 'institution', error = false, pending = false, retries = 0;
  let session: any = { user: { id: actor, role: 'admin' }, schoolId: campus, environment: { mode, ...(mode === 'simulation' ? { namespace_id: namespace } : {}) }, scopeKey: 'original' };
  const exports: any = {}, dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../../../../packages/contracts/src/workspace-normalizer': normalizer,
    '../../auth/SessionProvider': { useSession: () => session },
    '../../lib/query': { useApi: () => ({ data, isPending: pending, isError: error, error: error ? new Error('Current access unavailable') : null, refetch() { retries++; } }) },
    '../../ui/components': { Page: ({ children }: any) => React.createElement('main', null, children),
      Loading: () => React.createElement('p', null, 'Loading access'),
      Empty: ({ title, message, onRetry }: any) => React.createElement('section', null, title, message,
        onRetry ? React.createElement('button', { onClick: onRetry }, 'Retry access') : null) },
  };
  // Load this dependency lazily so the pre-fix mounted regression can exercise
  // the original boundary before the resolver is introduced.
  const compiled = ts.transpileModule(readFileSync(new URL('../src/features/more/MoreToolBoundary.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(compiled, { exports, require(name: string) {
    if (name === '../../lib/more-tool-access') return require('../src/lib/more-tool-access');
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = () => act(async () => root.render(React.createElement(exports.MoreToolBoundary, { itemKey, title: 'Institution setup',
    children: ({ manifest: current, item }: any) => React.createElement('p', { 'data-tool': item.key }, `Opened ${item.key} in ${current.context.institution_id}`) })));
  const h = { text: () => dom.window.document.body.textContent ?? '', opened: () => !!dom.window.document.querySelector('[data-tool]'),
    async update(change: { data?: any; session?: any; itemKey?: string; error?: boolean; pending?: boolean }) {
      if ('data' in change) data = change.data;
      if (change.session) session = change.session;
      if (change.itemKey) itemKey = change.itemKey;
      if ('error' in change) error = change.error!;
      if ('pending' in change) pending = change.pending!;
      await render();
    }, source: () => structuredClone(data), session: () => structuredClone(session),
    async retry() { await act(async () => (dom.window.document.querySelector('button') as HTMLButtonElement).click()); return retries; } };
  try { await render(); await run(h); }
  finally { await act(async () => root.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('current grouped setup launcher opens its explicitly authorized child in Live and Simulation', async () => {
  for (const mode of ['live', 'simulation'] as const) await harness(async h => { assert.equal(h.opened(), true); assert.match(h.text(), /Opened institution/); }, mode);
});
test('a revoked or absent setup launcher or child never opens through role or a compatibility item alone', async () => harness(async h => {
  const original = h.source();
  for (const more of [{ ...original.more, groups: [] }, { ...original.more, groups: [{ key: 'account', label: 'Account', items: [] }] },
    { ...original.more, setup: [] }, { ...original.more, setup: [{ ...child, href: '/more/policies' }] },
    { ...original.more, setup: [child, { ...child, href: '/more/setup/other' }] }]) {
    await h.update({ data: { ...original, more } }); assert.equal(h.opened(), false);
  }
}));
test('current actor, campus, selected world, unavailable state and access errors remain fail closed', async () => {
  for (const mode of ['live', 'simulation'] as const) await harness(async h => {
    const original = h.source(), session = h.session();
    for (const context of [{ ...original.context, actor_user_id: campus }, { ...original.context, institution_id: actor },
      { ...original.context, environment: mode === 'live' ? { kind: 'simulation', namespace_id: namespace, virtual_now: '2026-11-08T10:00:00Z' } : { ...original.context.environment, namespace_id: namespace + '-other' } }]) {
      await h.update({ data: { ...original, context } }); assert.equal(h.opened(), false);
    }
    await h.update({ data: original, error: true }); assert.equal(h.opened(), false); assert.equal(await h.retry(), 1);
    await h.update({ error: false, pending: true }); assert.equal(h.opened(), false); assert.match(h.text(), /Loading access/);
    await h.update({ pending: false, session: { ...session, environment: { ...session.environment, unavailable: true } } });
    assert.equal(h.opened(), false); assert.match(h.text(), /Simulation is unavailable/);
  }, mode);
});
test('ordinary grouped tools and older explicit grouped setup children retain their exact contributions', async () => harness(async h => {
  const source = h.source(), policies = { key: 'policies', label: 'Policies', href: '/more/policies' };
  await h.update({ itemKey: 'policies', data: { ...source, more: { ...source.more, groups: [{ key: 'account', label: 'Account', items: [policies] }] } } });
  assert.equal(h.opened(), true); assert.match(h.text(), /Opened policies/);
  await h.update({ itemKey: 'institution', data: { ...source, more: { ...source.more, groups: undefined } } });
  assert.equal(h.opened(), true);
}));
