import * as iconSemantics from '../src/ui/icon-semantics';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as policy from '../src/lib/gate-operator-policy';
import * as copy from '../src/features/gate/operator-copy';
import * as scopedRead from '../src/lib/scoped-read-policy';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
function load(file: string, dependencies: Record<string, unknown>) {
  const absolute = path.join(root, file), exports: Record<string, any> = {};
  const compiled = ts.transpileModule(readFileSync(absolute, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { exports, AbortController, URLSearchParams, URL, JSON, btoa, require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected Gate dependency ${name}`); return dependencies[name]; } }, { filename: absolute, timeout: 1000 });
  return exports;
}
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
async function harness(initialHref: string, run: (h: any) => Promise<void>, options: { latePreference?: Promise<'en' | 'hi'>; retained?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let href = initialHref, focused = true, epoch = 1, languageReads = 0, scan: ((value: { data: string }) => void) | undefined, latestCommandOptions: any;
  const session: any = { scopeKey: 'actor-a:campus-a:simulation-a', status: 'authenticated', user: { id: 'actor-a' }, schoolId: 'campus-a', environment: { mode: 'simulation', namespace_id: 'world-a' } };
  const savedLanguages: Array<{ scope: unknown; language: string }> = [], writes: any[] = [], imageReads: string[] = [], phoneCalls: string[] = [], navigations: string[] = [], dialogs: any[][] = [], listeners = new Set<(value: string) => void>(), fields = new Map<string, (value: string) => void>();
  const student = { id: 'student-a', name: 'Anaya स्रोत', admission_number: 'A-1', class_label: 'Class A', direction: 'in', plan_state: 'ready', avatar_url: '/api/v1/people/student-a/photo/', collector_name: 'Approved collector नाम', collector_photo: '/api/v1/people/collector-a/photo/' };
  const staff = { id: 'staff-a', name: 'Staff source नाम', staff_code: 'S-1', designation: 'Lab coordinator', department: 'Computer science', direction: null, revision: 2, avatar_url: 'https://foreign.example/avatar.png' };
  const visitor = { id: 'visitor-a', school_id: 'campus-a', name: 'Visitor source नाम', purpose: 'Meeting source', state: 'pending', revision: 4 };
  const workspace = { office: { name: 'Campus office', phone: '+91 (532) 292-2000' }, visitors: [visitor], activity: [{ id: 'movement-a', name: 'Saved movement source', detail: 'Main gate', direction: 'in', occurred_at: '2026-10-29T08:00:00Z' }], visitor_counts: { active: 1, pending: 1 }, visitor_pagination: { page: 1, total_pages: 1 } };
  const AppState = { currentState: 'active', addEventListener(_name: string, listener: (value: string) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  const result = (data: unknown) => ({ data, isPending: false, isError: false, isRefetching: false, error: undefined, refetch: async () => ({ data }) });
  const Button = ({ title, onPress, disabled, busy }: any) => React.createElement('button', { disabled: disabled || busy, onClick: onPress }, title);
  const View = ({ children, accessibilityLabel }: any) => React.createElement('div', { 'aria-label': accessibilityLabel }, children);
  const Section = ({ title, children }: any) => React.createElement('section', null, React.createElement('h2', null, title), children);
  const Row = ({ title, detail, status, onPress, children }: any) => React.createElement('article', { onClick: onPress, role: onPress ? 'button' : undefined }, React.createElement('h3', null, title), React.createElement('p', null, detail), status, children);
  const SearchField = ({ label, value, onChangeText, onSubmit, onClear, submitLabel, disabled, submitDisabled }: any) => { fields.set(label, onChangeText); return React.createElement('div', null, React.createElement('input', { 'aria-label': label, value, readOnly: true }), React.createElement(Button, { title: submitLabel, disabled: disabled || submitDisabled, onPress: onSubmit }), value ? React.createElement(Button, { title: 'Clear search', onPress: () => { onChangeText(''); onClear?.(); } }) : null); };
  const components = { SearchField, Button, Row, Section, Page: ({ title, children }: any) => React.createElement('main', null, React.createElement('h1', null, title), children), Notice: ({ message }: any) => React.createElement('p', null, message), Empty: ({ title, message, onRetry }: any) => React.createElement('div', null, title, message, onRetry ? React.createElement(Button, { title: 'Retry', onPress: onRetry }) : null), Loading: () => React.createElement('p', null, 'Loading'), Field: ({ label, value, onChangeText }: any) => { fields.set(label, onChangeText); return React.createElement('label', null, label, React.createElement('input', { value, readOnly: true })); } };
  const api = { getApiOrigin: () => 'https://campus.example', captureApiContext: () => { const captured = epoch; return { assertCurrent() { if (captured !== epoch) throw new Error('Changed transport'); } }; }, apiFetch: async (url: string) => url.includes('/scan/') ? { kind: 'pickup', student } : url.includes('/students/') ? student : staff, readGateIdentityImage: async (url: string) => { imageReads.push(url); const captured = epoch; return { bytes: png, mimeType: 'image/png', assertCurrent() { if (captured !== epoch) throw new Error('Changed image transport'); } }; } };
  const react = { react: React, 'react/jsx-runtime': require('react/jsx-runtime') }, useSession = () => session, native = { AppState, View, Linking: { openURL: async (url: string) => { phoneCalls.push(url); }, openSettings: async () => {} }, Text: ({ children }: any) => React.createElement('span', null, children), Switch: ({ value, onValueChange, accessibilityLabel, disabled }: any) => React.createElement('button', { 'aria-label': accessibilityLabel, 'aria-pressed': value, disabled, onClick: () => onValueChange(!value) }), Image: ({ source, accessibilityLabel }: any) => React.createElement('img', { src: source.uri, alt: accessibilityLabel }) };
  const operation = load('src/lib/use-operation-context.ts', { ...react, 'react-native': native, 'expo-router': { useIsFocused: () => focused }, '../auth/SessionProvider': { useSession }, './api': api });
  const language = load('src/features/gate/useGateLanguage.ts', { ...react, '../../auth/SessionProvider': { useSession }, '../../lib/api': api, '../../lib/gate-operator-policy': policy, '../../lib/gate-language-storage': { readGateLanguage: async () => { languageReads++; return languageReads === 1 && options.latePreference ? options.latePreference : 'en'; }, saveGateLanguage: async (scope: unknown, value: string) => { savedLanguages.push({ scope, language: value }); } } });
  const photo = load('src/features/gate/GateIdentityPhoto.tsx', { ...react, 'react-native': native, 'expo-router': { useIsFocused: () => focused }, '../../auth/SessionProvider': { useSession }, '../../lib/api': api, '../../lib/gate-operator-policy': policy, '../../lib/use-operation-context': operation, '../../ui/theme': { useTheme: () => ({ colors: {} }) }, './operator-copy': copy });
  const screen = load('src/features/GateScreen.tsx', {
    ...react, 'react-native': native, 'expo-router': { useIsFocused: () => focused }, '../ui/Alert': { Alert: { alert: (...args: any[]) => dialogs.push(args) } },
    'expo-camera': { useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })], CameraView: ({ onBarcodeScanned }: any) => { scan = onBarcodeScanned; return React.createElement('div', null, 'Camera'); } }, 'expo-crypto': { randomUUID: () => 'new-command' },
    '../../../packages/contracts/src/workspace-normalizer': { normalizeWorkspaceManifest: (value: unknown) => value, assertWorkspaceManifestContext() {} }, '../auth/SessionProvider': { useSession }, '../lib/api': api,
    '../lib/gate-command': { nativeGateAcceptedResult() {}, useGateCommand: (commandOptions: unknown) => { latestCommandOptions = commandOptions; return { locked: !!options.retained, busy: false, pending: options.retained ? { phase: 'unknown', label: 'Retained synthetic gate action' } : null, error: '', run: async (input: unknown) => { writes.push(input); } }; } },
    '../ui/icon-semantics': iconSemantics, '../lib/scoped-read-policy': scopedRead, '../lib/query': { useApi: (url: string | null) => result(url === '/api/v1/workspace' ? { areas: [{ surfaces: [{ href: '/areas/in-out/operate' }, { href: '/work/in-out/approvals' }] }] } : url?.includes('visitor-approvals') ? [visitor] : url?.includes('/students/?') ? [student] : url?.includes('/staff/?') ? [staff] : workspace) },
    '../lib/use-operation-context': operation, '../lib/gate-operator-policy': policy, '../ui/components': components,
    '../ui/BackNavigation': { ScreenBack: () => null, useScreenExitGuard() {}, useCampusNavigation: () => ({ complete() {} }) },
    '../ui/DomainControls': { ChoiceMenu: ({ label, value, options, onChange, disabled }: any) => React.createElement('select', { 'aria-label': label, value, disabled, onChange: (event: any) => onChange(event.target.value) }, options.map((item: any) => React.createElement('option', { key: item.value, value: item.value }, item.label))), ControlButton: Button, SegmentedControl: ({ options, value, onChange, disabled }: any) => React.createElement('div', null, options.map((item: any) => React.createElement('button', { key: item.value, disabled, 'aria-pressed': value === item.value, onClick: () => onChange(item.value) }, item.label))) },
    '../ui/theme': { useTheme: () => ({ colors: {} }) }, './gate/useGateLanguage': language, './gate/operator-copy': copy, './gate/GateIdentityPhoto': photo,
    './GateVisitorEntry': { GateVisitorEntry: () => null }, './GateVisitEditor': {}, './GateVisitSharing': {}, './GateSharedVisitChanges': {}, './GateManagement': { GateManagement: () => null }, './GateSharedVisitPolicy': {}, '@tanstack/react-query': { useQueryClient: () => ({}) }, '../lib/visit-sharing': {},
    './GateVisitDetails': {}, './GateVisitManagement': {}, './gate/CampusPlacePortal': {}, './GateVisitParticipant': {}, './GateVisitOnboarding': {}, '../lib/gate-visit-onboarding': {},
  });
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const render = async () => { await act(async () => renderer.render(React.createElement(screen.GateScreen, { href, onNavigate: (value: string) => { navigations.push(value); href = value; } }))); };
  const button = (title: string) => [...dom.window.document.querySelectorAll('button')].find((value: any) => value.textContent === title) as HTMLButtonElement | undefined;
  const h = { doc: dom.window.document, writes, imageReads, phoneCalls, navigations, dialogs, savedLanguages, student,
    button, render, text: () => dom.window.document.body.textContent, commandContext: () => latestCommandOptions.captureContext(),
    click: async (title: string) => { const target = button(title); assert.ok(target, `Missing ${title}`); await act(async () => target.click()); await render(); },
    field: async (label: string, value: string) => { assert.ok(fields.has(label)); await act(async () => fields.get(label)!(value)); },
    selectRow: async (name: string) => { const target = [...dom.window.document.querySelectorAll('article')].find((value: any) => value.querySelector('h3')?.textContent === name) as HTMLElement | undefined; assert.ok(target); await act(async () => target.click()); },
    scan: async () => { await h.click('Scan QR pass'); assert.ok(scan); await act(async () => scan!({ data: 'private-current-pickup-pass' })); },
    navigate: async (value: string) => { href = value; await render(); }, focus: async (value: boolean) => { focused = value; await render(); },
    foreground: async (value: string) => { AppState.currentState = value; await act(async () => listeners.forEach(listener => listener(value))); await render(); },
    scope: async () => { epoch++; session.scopeKey = 'actor-b:campus-a:simulation-b'; session.user = { id: 'actor-b' }; await render(); },
    visitorRevision: async (revision: number) => { visitor.revision = revision; await render(); },
    binding: async () => { epoch++; await render(); },
  };
  try { await render(); await run(h); } finally { await act(async () => renderer.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('mounted Gate restores URL-selected inbox/records/visitors and preserves current context in native controls', async () => harness('/areas/in-out/operate?section=approvals&attention_notification_id=exact', async h => {
  assert.ok(h.text().includes('Awaiting your decision')); assert.equal(h.button('Scan QR pass'), undefined);
  await h.click('Approve visit'); assert.equal(h.writes.length, 1); assert.match(h.writes[0].path, /visitors\/visitor-a\/approve\/$/); assert.deepEqual(JSON.parse(h.writes[0].body), { expected_revision: 4 });
  await h.click('Records'); assert.ok(h.text().includes('Saved movement source')); assert.equal(h.button('Scan QR pass'), undefined); assert.ok(h.navigations.at(-1).includes('attention_notification_id=exact'));
  await h.navigate('/areas/in-out/operate?section=visitors&visitor=unavailable'); assert.ok(h.text().includes('Visitor unavailable')); assert.ok(!h.text().includes('Visitor source नाम'));
  await h.click('Open visitor queue'); assert.ok(h.text().includes('Visitor source नाम'));
}));

test('mounted Gate language choice survives its late read, leaves source names intact and resets across actor scope', async () => {
  let resolve!: (value: 'en') => void; const late = new Promise<'en'>(yes => { resolve = yes; });
  await harness('/areas/in-out/operate?section=approvals', async h => {
    await h.click('हिन्दी'); assert.ok(h.text().includes('आपके निर्णय की प्रतीक्षा')); assert.ok(h.text().includes('Visitor source नाम')); assert.equal(h.savedLanguages[0].language, 'hi');
    await act(async () => resolve('en')); await h.render(); assert.ok(h.text().includes('आपके निर्णय की प्रतीक्षा'), 'A late preference read cannot overwrite the new choice');
    await h.scope(); assert.ok(h.text().includes('Awaiting your decision')); assert.equal(h.savedLanguages.length, 1);
  }, { latePreference: late });
});

test('a preference read failure keeps ordinary operating controls usable with explicit retryable storage feedback', async () => {
  let reject!: (error: Error) => void; const late = new Promise<'en'>( (_yes, no) => { reject = no; });
  await harness('/areas/in-out/operate', async h => {
    await act(async () => reject(new Error('Preference storage unavailable'))); await h.render();
    assert.ok(h.text().includes('saved preference could not be confirmed')); assert.equal(h.button('Scan QR pass').disabled, false);
    await h.click('हिन्दी'); assert.equal(h.savedLanguages[0].language, 'hi'); assert.equal(h.button('QR पास स्कैन करें').disabled, false);
  }, { latePreference: late });
});

test('a refreshed approval revision expires the old review while preserving the owning operation lease for accepted refresh cleanup', async () => harness('/areas/in-out/operate?section=approvals', async h => {
  const owner = h.commandContext(); await h.click('Decline'); const oldConfirm = h.dialogs.at(-1)[2][1].onPress;
  await h.visitorRevision(5); assert.doesNotThrow(owner.assertCurrent); await act(async () => oldConfirm()); assert.equal(h.writes.length, 0);
  await h.click('Decline'); await act(async () => h.dialogs.at(-1)[2][1].onPress()); assert.deepEqual(JSON.parse(h.writes[0].body), { expected_revision: 5 });
}));

test('mounted pickup keeps explicit verification/physical-handover review and invalidates an old confirmation after navigation', async () => harness('/areas/in-out/operate', async h => {
  await h.scan(); assert.equal(h.button('Record exit').disabled, true); assert.ok(h.text().includes('Approved collector नाम')); assert.equal(h.doc.querySelectorAll('img').length, 2); assert.ok([...h.doc.querySelectorAll('img')].every((image: any) => image.src.startsWith('data:image/png;base64,')));
  const verification = () => h.doc.querySelector('button[aria-label="I verified this person\'s identity and approved collector"]') as HTMLButtonElement;
  await act(async () => verification().click()); await h.click('Record exit'); assert.equal(h.writes.length, 0); assert.ok(h.dialogs.at(-1)[1].includes('physical handover has occurred'));
  const oldConfirm = h.dialogs.at(-1)[2][1].onPress; await h.navigate('/areas/in-out/operate?section=records'); await act(async () => oldConfirm()); assert.equal(h.writes.length, 0);
  await h.navigate('/areas/in-out/operate'); await h.scan(); await act(async () => verification().click()); await h.click('Record exit'); await act(async () => h.dialogs.at(-1)[2][1].onPress());
  assert.equal(h.writes.length, 1); const body = JSON.parse(h.writes[0].body); assert.equal(body.student_id, 'student-a'); assert.equal(body.identity_verified, true); assert.equal(body.qr, 'private-current-pickup-pass');
  await h.foreground('background'); assert.equal(h.doc.querySelectorAll('img').length, 0, 'Private image bytes stop rendering when backgrounded');
  await h.foreground('active'); assert.equal(h.doc.querySelectorAll('img').length, 2); await h.binding(); assert.equal(h.doc.querySelectorAll('img').length, 0, 'A rebound transport cannot display the old photo even when the account/campus scope label stays the same');
}));

test('mounted office call is explicit; existing staff department remains visible and foreign avatars never load', async () => harness('/areas/in-out/operate', async h => {
  assert.deepEqual(h.phoneCalls, []); await h.click('Contact campus office'); assert.deepEqual(h.phoneCalls, ['tel:+915322922000']);
  await h.click('Find staff'); await h.field('Name or campus identifier', 'Staff'); await h.click('Find person'); await h.selectRow('Staff source नाम');
  assert.ok(h.text().includes('Computer science')); assert.ok(h.text().includes('No authorized campus photo is available.')); assert.deepEqual(h.imageReads, []); assert.equal(h.doc.querySelectorAll('img').length, 0);
  await h.focus(false); assert.equal(h.button('Contact campus office').disabled, true);
}));

test('visitor status choice preserves its source context and clears only obsolete visitor pagination', async () => harness('/areas/in-out/operate?section=records&visitor_page=3&visitor=visitor-a&attention_notification_id=exact', async h => {
  const select = h.doc.querySelector('select[aria-label="Visitor status"]') as HTMLSelectElement;
  assert.ok(select); assert.equal(select.value, 'active');
  await act(async () => { select.value = 'pending'; select.dispatchEvent(new h.doc.defaultView.Event('change', { bubbles: true })); });
  await h.render();
  const result = new URL(h.navigations.at(-1), 'https://campus.example');
  assert.equal(result.pathname, '/areas/in-out/operate');
  assert.equal(result.searchParams.get('section'), 'records');
  assert.equal(result.searchParams.get('visitor_filter'), 'pending');
  assert.equal(result.searchParams.get('attention_notification_id'), 'exact');
  assert.equal(result.searchParams.has('visitor'), false); assert.equal(result.searchParams.has('visitor_page'), false);
  assert.equal(h.writes.length, 0);
}));


test('records and retained recovery have no raw text directly under their native View surfaces', async () => harness('/areas/in-out/operate?section=records', async h => {
  assert.ok(h.text().includes('Saved movement source')); assert.ok(h.text().includes('Retained synthetic gate action'));
  // Page/Section adapters stand for native View containers; their headings and
  // notices own their own text elements. JSX spacer text here fails RN Web.
  const raw = [...h.doc.querySelectorAll('main, section')].flatMap((surface: any) => [...surface.childNodes].filter((node: any) => node.nodeType === 3).map((node: any) => node.textContent));
  assert.deepEqual(raw, []); assert.deepEqual(h.writes, []);
}, { retained: true }));
