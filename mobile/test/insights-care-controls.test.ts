import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as temporal from '../src/lib/browser-temporal';
import * as care from '../src/lib/care-native';
import * as institution from '../src/lib/native-institution-insights';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): { render(children: React.ReactNode): void; unmount(): void } };
const { JSDOM } = require('jsdom');
type Props = Record<string, any>;

/** Compile the current owning components. Only platform/network boundaries are
 * inert; their state, rendered controls and navigation callbacks execute. */
function load(file: string, dependencies: Record<string, unknown>, extra = ''): Props {
  const filename = path.join(root, file), exports = {};
  const source = ts.transpileModule(readFileSync(filename, 'utf8') + extra, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, URL, URLSearchParams, Date, require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected component dependency: ${name}`); return dependencies[name]; } }, { filename, timeout: 1000 });
  return exports;
}
const Box = ({ children }: Props) => React.createElement('div', null, children);
const Text = ({ children }: Props) => React.createElement('span', null, children);
const Button = ({ title, onPress, disabled }: Props) => React.createElement('button', { disabled, onClick: onPress }, title);
const theme = { useTheme: () => ({ dark: false, colors: {} }) };
const controls = {
  ControlButton: Button,
  ChoiceMenu: ({ label, value, options, onChange }: Props) => React.createElement('select', { 'aria-label': label, value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value) }, options.map((option: Props) => React.createElement('option', { key: option.value, value: option.value }, option.label))),
  SegmentedControl: ({ label, options, onChange, disabled }: Props) => React.createElement('div', { 'aria-label': label }, options.map((option: Props) => React.createElement(Button, { key: option.value, title: option.label, disabled, onPress: () => onChange(option.value) }))),
  Facts: () => null,
};
async function mounted(run: (container: HTMLElement, renderer: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as Props).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById('root')!, renderer = createRoot(container);
  try { await run(container, renderer); }
  finally { await act(async () => renderer.unmount()); Object.assign(globalThis, previous); dom.window.close(); }
}
function button(container: HTMLElement, title: string) {
  const result = [...container.querySelectorAll('button')].find(item => item.textContent === title);
  assert.ok(result, `Missing button: ${title}`); return result;
}
function review() {
  let changeInput!: (event: { target: { value: string } }) => void;
  const webField = load('src/ui/TemporalField.web.tsx', {
    react: { ...React, createElement(type: unknown, props: Props, ...children: React.ReactNode[]) { if (type === 'input') changeInput = props.onChange; return React.createElement(type as React.ElementType, props, ...children); } },
    'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: Box, Text }, '../lib/browser-temporal': temporal, './theme': theme,
  });
  const module = load('src/features/insights/InstitutionInsights.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: Box, Text, Pressable: Button },
    '../../ui/BackNavigation': {}, '../../lib/api': {}, '../../lib/query': {}, '../../lib/native-insights': {}, '../../lib/native-institution-insights': institution,
    '../../ui/components': {}, '../../ui/DomainControls': controls, '../../ui/theme': theme, '../../ui/Icon': {}, '../../ui/TemporalField': webField,
    '../ResourcesScreen': { DomainText: Text }, './InsightVisuals': {},
  }, '\nexport { ReviewFilters };');
  return { Component: module.ReviewFilters as React.ComponentType<Props>, change: (value: string) => act(async () => changeInput({ target: { value } })) };
}
const reviewData = { period: { end: '2024-02-29', days: 28 }, operational_date: '2026-10-29', class_section_id: null, classes: [{ id: 'class-a', name: 'Class A' }], threshold: 50 };
const pages = ['insight_page', 'recording_page', 'followups_page', 'learning_page', 'learning_participation_page', 'coverage_page', 'deadlines_page', 'fee_bands_page'];

test('current review mounts a real browser date control, preserves a civil leap day and resets pages without losing scope', async () => {
  const previous = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try { await mounted(async (container, renderer) => {
    const { Component, change } = review(), destinations: string[] = [];
    const href = `/areas/insights/learning-review?scope=institution&date=2024-02-29&class=class-a&insight_days=56&via=results&${pages.map(key => `${key}=3`).join('&')}#review`;
    await act(async () => renderer.render(React.createElement(Component, { data: reviewData, href, learning: true, reviewWindow: true, onNavigate: (value: string) => destinations.push(value) })));
    await act(async () => button(container, 'Review period').click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Review ending date"]'); assert.ok(input);
    assert.equal(input.type, 'date'); assert.equal(input.value, '2024-02-29'); assert.equal(input.max, '2026-10-29');
    await change('2024-03-01');
    const destination = new URL(destinations[0]!, 'https://thatcampus.invalid');
    assert.equal(destination.pathname, '/areas/insights/learning-review'); assert.equal(destination.searchParams.get('date'), '2024-03-01');
    assert.equal(destination.searchParams.get('scope'), 'institution'); assert.equal(destination.searchParams.get('class'), 'class-a'); assert.equal(destination.searchParams.get('insight_days'), '56'); assert.equal(destination.searchParams.get('via'), 'results'); assert.equal(destination.hash, '#review');
    for (const key of pages) assert.equal(destination.searchParams.has(key), false, key);
  }); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('review date bounds follow the latest verified campus date rather than the device clock and reject invalid or future entries', async () => mounted(async (container, renderer) => {
  const { Component, change } = review(), destinations: string[] = [], props = { href: '/areas/insights/review?scope=institution', learning: false, reviewWindow: true, onNavigate: (value: string) => destinations.push(value) };
  await act(async () => renderer.render(React.createElement(Component, { ...props, data: { ...reviewData, operational_date: '2028-02-29' } })));
  await act(async () => button(container, 'Review period').click());
  assert.equal(container.querySelector('input')?.max, '2028-02-29');
  for (const value of ['', '2026-02-29', '2028-03-01']) await change(value);
  assert.deepEqual(destinations, []);
  await change('2028-02-29'); assert.equal(new URL(destinations[0]!, 'https://thatcampus.invalid').searchParams.get('date'), '2028-02-29');
  await act(async () => renderer.render(React.createElement(Component, { ...props, data: { ...reviewData, operational_date: '2028-03-01' } })));
  assert.equal(container.querySelector('input')?.max, '2028-03-01');
  await change('2028-03-01'); assert.equal(destinations.length, 2);
}));

test('Use current campus date removes the override and stale pages while retaining the review context', async () => mounted(async (container, renderer) => {
  const { Component } = review(), destinations: string[] = [];
  await act(async () => renderer.render(React.createElement(Component, { data: reviewData, href: '/areas/insights/recording?scope=institution&date=2024-02-29&class_id=class-a&recording_page=3', learning: false, reviewWindow: true, onNavigate: (value: string) => destinations.push(value) })));
  await act(async () => button(container, 'Review period').click()); await act(async () => button(container, 'Use current campus date').click());
  const query = new URL(destinations[0]!, 'https://thatcampus.invalid').searchParams;
  assert.equal(query.has('date'), false); assert.equal(query.has('recording_page'), false); assert.equal(query.get('scope'), 'institution'); assert.equal(query.get('class_id'), 'class-a');
}));

function careScreen(capabilities: string[], canManageTeam = false) {
  const schoolId = '11111111-1111-4111-8111-111111111111';
  const controller = { busy: false, ready: true, blocked: false, references: [], error: null };
  const query = { isPending: false, isError: false, error: null, data: { context: { institution_label: 'Campus', time_zone: 'Asia/Kolkata', environment: {} }, areas: [{ key: 'care', surfaces: [{ key: 'concerns', href: '/areas/care/concerns', capabilities }] }] }, refetch() {} };
  const value = { can_manage_team: canManageTeam, cases: [], routes: { primary: 1, alternate: 1 }, legal_notice: 'Protected', team: [], candidates: [], eligible_students: [] };
  const workspace = { value, data: value, isError: false, isPending: false, refresh: async () => value };
  const module = load('src/features/CareScreen.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: Box },
    '@tanstack/react-query': { useQueryClient: () => ({}) }, '../../../packages/contracts/src/workspace-normalizer': { normalizeWorkspaceManifest: (value: unknown) => value, assertWorkspaceManifestContext() {} },
    '../auth/SessionProvider': { useSession: () => ({ schoolId, scopeKey: 'actor:campus:live', user: { id: 'actor' }, environment: { mode: 'live' } }) },
    '../lib/care-native': care, '../lib/use-care-native': { useCareJournal: () => controller, useCareRead: () => workspace }, '../lib/native-calendar': { nativeCalendarDay: () => '2026-10-29' }, '../lib/query': { useApi: () => query },
    '../ui/BackNavigation': { ScreenBack: () => null, useCampusNavigation: () => ({}), useScreenExitGuard() {} }, '../ui/DomainControls': controls,
    '../ui/components': { Empty: Text, ListGroup: Box, Loading: Text, Notice: Text, Page: Box, Row: Text, Section: Box },
    './CareUI': { CareRecovery: () => null, CareSafety: () => null, CareText: Text, CareUnavailable: () => null },
    './CareForms': { CareIntakePane: () => React.createElement('div', null, 'Intake owner'), CareCasePane: () => React.createElement('div', null, 'Case owner') },
    './CareTeam': { CareTeamPane: ({ onDirty }: Props) => React.createElement(Button, { title: 'Edit team draft', onPress: () => onDirty(true) }) },
  });
  return { Component: module.CareScreen as React.ComponentType<Props>, controller, query, workspace };
}
test('Care exposes Message reports for either exact capability and reaches only the existing queue with context preserved', async () => {
  for (const capability of ['safeguarding.review', 'safeguarding.manage']) await mounted(async (container, renderer) => {
    const { Component } = careScreen([capability]), destinations: string[] = [];
    const href = '/areas/care/concerns?section=cases&scope=assigned&campus_id=north&care_page=3&report=old&report_revision=2&focus=old&attention_notification_id=11111111-1111-4111-8111-111111111111';
    await act(async () => renderer.render(React.createElement(Component, { href, onNavigate: (value: string) => destinations.push(value) })));
    assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Care team'), false);
    await act(async () => button(container, 'Message reports').click());
    const destination = new URL(destinations[0]!, 'https://thatcampus.invalid');
    assert.equal(destination.pathname, '/areas/care/concerns'); assert.equal(destination.searchParams.get('section'), 'message_reports'); assert.equal(destination.searchParams.get('scope'), 'assigned'); assert.equal(destination.searchParams.get('campus_id'), 'north');
    for (const key of ['case', 'case_revision', 'create', 'report', 'report_revision', 'attention_notification_id', 'focus', 'care_page']) assert.equal(destination.searchParams.has(key), false, key);
  });
});
test('Care team authority or unrelated safeguards never imply Message reports access', async () => {
  for (const capabilities of [[], ['safeguarding.read'], ['institution.manage'], ['safeguarding.review.other']]) await mounted(async (container, renderer) => {
    const { Component } = careScreen(capabilities, true);
    await act(async () => renderer.render(React.createElement(Component, { href: '/areas/care/concerns', onNavigate() {} })));
    assert.ok(button(container, 'Care team')); assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Message reports'), false);
  });
});
test('Care pauses section discovery on failed reads and disables leaving a busy command or dirty team form', async () => mounted(async (container, renderer) => {
  const { Component, controller, query, workspace } = careScreen(['safeguarding.review'], true), destinations: string[] = [];
  const props = { href: '/areas/care/concerns?section=team', onNavigate: (value: string) => destinations.push(value) };
  const render = () => act(async () => renderer.render(React.createElement(Component, props)));
  await render(); controller.busy = true; await render(); assert.equal(button(container, 'Message reports').disabled, true);
  await act(async () => button(container, 'Message reports').click()); assert.deepEqual(destinations, []);
  controller.busy = false; await render(); await act(async () => button(container, 'Edit team draft').click()); assert.equal(button(container, 'Message reports').disabled, true);
  query.isError = true; await render(); assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Message reports'), false);
  query.isError = false; workspace.isError = true; await render(); assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Message reports'), false);
}));
test('case and intake owners keep their existing surfaces without section discovery', async () => {
  for (const query of ['create=concern', 'case=11111111-1111-4111-8111-111111111111&case_revision=2']) await mounted(async (container, renderer) => {
    const { Component } = careScreen(['safeguarding.review'], true);
    await act(async () => renderer.render(React.createElement(Component, { href: `/areas/care/concerns?${query}`, onNavigate() {} })));
    assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Message reports'), false);
    assert.match(container.textContent ?? '', /Intake owner|Case owner/);
  });
});
