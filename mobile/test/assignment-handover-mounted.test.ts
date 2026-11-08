import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const source = readFileSync(new URL('../src/features/LearningAssignmentHandovers.tsx', import.meta.url), 'utf8');
const fixture = { id: 'assignment', title: 'Numerical methods', revision: 2, preview_hash: 'a'.repeat(64), reviewer: { id: 'original', name: 'Meera Rao', current: false }, pending_reviews: 3, requested_revisions: 1, reviewers: [{ id: 'replacement', name: 'Ananya Sen' }], history: [], privacy: 'Setup authority changes responsibility without showing private drafts, submitted answers or feedback.' };
async function harness(run: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const fields = new Map<string, (v: string) => void>(), prompts: any[] = [], sent: any[] = [], recovered: boolean[] = [];
  let data = structuredClone(fixture), epoch = 0, locked = false, retained: any = null, unmounted = false;
  const View = ({ children }: any) => React.createElement('div', null, children);
  const Button = ({ title, disabled, onPress }: any) => React.createElement('button', { disabled, onClick: onPress }, title);
  const writer = { get locked() { return locked; }, busy: false, get action() { return retained; }, error: '', resumeHref: null, obsolete: false,
    async run(value: any) { sent.push(value); }, async recover() { recovered.push(true); }, reviewed() {} };
  const dependencies: any = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View },
    '../auth/SessionProvider': { useSession: () => ({ user: { id: 'actor' }, schoolId: 'campus', environment: { mode: 'live', namespace_id: null } }) },
    '../lib/api': { getApiOrigin: () => 'https://campus.example' },
    '../lib/query': { useApi: () => ({ data, isPending: false, isError: false, refetch: async () => ({ data }), isRefetching: false }) },
    '../lib/native-pending-action': { useNativePendingAction: () => writer },
    '../lib/use-operation-context': { useOperationContext: () => () => { const captured = epoch; return () => { if (captured !== epoch) throw new Error('Account or world changed'); }; } },
    '../lib/assignment-handover-policy': { assignmentHandoverObsolete() {}, assignmentHandoverRefreshPath() {} },
    '../ui/BackNavigation': { ScreenBack: () => null, useScreenExitGuard() {} },
    '../ui/Alert': { Alert: { alert: (title: string, message: string, actions: any[]) => prompts.push({ title, message, actions }) } },
    '../ui/components': { Button, Page: ({ title, children }: any) => React.createElement('main', null, title, children), ListGroup: View, Section: ({ title, children }: any) => React.createElement('section', null, title, children), Row: ({ title, detail }: any) => React.createElement('p', null, title, detail), Notice: ({ message }: any) => React.createElement('p', null, message), Empty: ({ title, message }: any) => React.createElement('p', null, title, message), Loading: () => null,
      Field: ({ label, value, onChangeText, editable }: any) => { fields.set(label, onChangeText); return React.createElement('input', { 'aria-label': label, value, readOnly: true, disabled: editable === false }); } },
    '../ui/DomainControls': { ControlButton: Button, Disclosure: View, Facts: ({ items }: any) => React.createElement('dl', null, items.map((item: any) => React.createElement('div', { key: item.label }, item.label, ': ', item.value))), ChoiceMenu: ({ label, value, onChange, disabled }: any) => { fields.set(label, onChange); return React.createElement('input', { 'aria-label': label, value, readOnly: true, disabled }); } },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, URLSearchParams, JSON, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const render = () => act(async () => { renderer.render(React.createElement(exports.LearningAssignmentHandovers, { href: '/areas/messages/assignments?scope=review_handover&assignment=assignment', onNavigate() {} })); });
  const h = { sent, prompts, recovered, text: () => dom.window.document.body.textContent ?? '',
    async input(label: string, value: string) { await act(async () => fields.get(label)!(value)); },
    async click(title: string) { const button = [...dom.window.document.querySelectorAll('button')].find((b: any) => b.textContent === title) as HTMLButtonElement; assert.ok(button, title); await act(async () => button.click()); },
    async confirm() { await act(async () => prompts.at(-1).actions.at(-1).onPress()); },
    async sourceChanged() { data = { ...data, preview_hash: 'b'.repeat(64) }; await render(); },
    async lockUnknown() { locked = true; retained = { ownerHref: '/areas/messages/assignments?scope=review_handover&assignment=assignment', endpoint: '/api/v1/learning/assignments/review-handovers/assignment/', phase: 'unknown', payload: { kind: 'json', body: JSON.stringify({ reviewer_id: 'replacement', reason: 'Original reason retained.' }) } }; await render(); },
    invalidate() { epoch++; },
    async unmount() { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } },
  };
  try { await render(); await run(h); } finally { await h.unmount(); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}
test('responsibility detail shows metadata and a named replacement without exposing an assignment answer editor', async () => harness(async h => {
  assert.match(h.text(), /Meera Rao.*unavailable.*Awaiting review.*3/s); assert.match(h.text(), /without showing private drafts/);
  assert.equal(document.querySelector('[aria-label="Your response"]'), null);
  await h.input('Eligible reviewer', 'replacement'); await h.input('Reason for handover', 'Review responsibility changed.'); await h.click('Review and confirm handover');
  assert.equal(h.sent.length, 0); assert.match(h.prompts[0].message, /Meera Rao → Ananya Sen.*3 submitted reviews/s);
  await h.confirm(); await h.confirm(); assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].body.reviewer_id, 'replacement'); assert.equal(h.sent[0].body.preview_hash, 'a'.repeat(64)); assert.equal(h.sent[0].body.expected_revision, 2);
}));
for (const change of ['reason', 'sourceChanged', 'invalidate', 'unmount']) test(`a stale handover confirmation cannot dispatch after ${change}`, async () => harness(async h => {
  await h.input('Eligible reviewer', 'replacement'); await h.input('Reason for handover', 'Review responsibility changed.'); await h.click('Review and confirm handover');
  if (change === 'reason') await h.input('Reason for handover', 'A different reason.'); else await h[change]();
  await h.confirm(); assert.equal(h.sent.length, 0);
}));
test('retained unknown handover offers identical recovery instead of dispatching another replacement', async () => harness(async h => {
  await h.lockUnknown(); await h.click('Retry identical handover'); assert.equal(h.recovered.length, 1); assert.equal(h.sent.length, 0);
  assert.equal((document.querySelector('[aria-label="Eligible reviewer"]') as HTMLInputElement).disabled, true);
}));
