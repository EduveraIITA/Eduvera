import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';
import { scopeIdentity } from '../src/lib/api-policy';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const crypto = webcrypto as unknown as Crypto, hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function context(actor = id(1), school = id(2), mode: 'live' | 'simulation' = 'live', namespace = mode === 'live' ? null : `scenario:${id(3)}:run:${id(4)}`, origin = 'https://campus.example') {
  const environment = { mode, namespace_id: namespace };
  return { user: { id: actor }, schoolId: school, environment, scopeKey: JSON.stringify([origin, scopeIdentity(actor, school, environment)]), origin };
}
type Context = ReturnType<typeof context>;
const learner = id(5), day = '2026-11-08', itemId = id(6);
const prefix = (session: Context, studentId = learner, date = day) => `thatcampus.learning-packing.${hash(JSON.stringify([session.origin, session.scopeKey, studentId, date]))}`;
async function raw(factory: IDBFactory, work: (store: IDBObjectStore) => IDBRequest) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('thatcampus-device-journals-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise<any>((resolve, reject) => { const tx = db.transaction('journal_entries', 'readwrite'), request = work(tx.objectStore('journal_entries')); let result: unknown;
    request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
/** Mount the real component, including its packing effect and Switch handler.
 * The independent server diary command port throws if a device check touches it. */
async function mount(factory: IDBFactory, session: Context, run: (h: any) => Promise<void>, selected: { studentId?: string; date?: string; loseWriteReply?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  const studentId = selected.studentId ?? learner, date = selected.date ?? day, requests: string[] = [], exports: any = {}; let domainEffects = 0;
  const item = { id: itemId, title: 'Pack laboratory notebook', body: 'Bring your laboratory notebook and material kit.', date, published_at: '2026-11-07T08:00:00Z', item_type: 'homework', item_type_label: 'Practice', completed: false, acknowledged: false, requires_acknowledgement: false, author_name: 'Neha Rao' };
  const children = ({ children }: any) => React.createElement('div', null, children);
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: children, Text: children, Switch: ({ value, disabled, accessibilityLabel, onValueChange }: any) => React.createElement('input', { type: 'checkbox', checked: value, disabled, 'aria-label': accessibilityLabel, onChange: () => onValueChange(!value) }) },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (algorithm: string, value: string) => { assert.equal(algorithm, 'SHA-256'); return hash(value); } },
    '../lib/device-storage': { ...storage, setItemAsync: async (...args: Parameters<typeof storage.setItemAsync>) => { await storage.setItemAsync(...args); if (selected.loseWriteReply) throw new Error('Local write reply lost after commit'); }, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }, '../auth/SessionProvider': { useSession: () => session },
    '../lib/api': { getApiOrigin: () => session.origin, captureApiContext: () => ({ assertCurrent() {} }) },
    '../lib/query': { useApi: (path: string | null) => { if (path) requests.push(path); return { data: path ? { student: { id: studentId }, date, items: [item], schedule: [] } : undefined, isError: false, isPending: false, isRefetching: false, refetch: async () => { domainEffects++; throw new Error('Packing must not refresh server learning evidence.'); } }; } },
    '../lib/native-pending-action': { useNativePendingAction: () => ({ locked: false, busy: false, error: '', action: null, run() { domainEffects++; throw new Error('A private packing check must not report completion.'); }, recover() { domainEffects++; throw new Error('No packing server command exists.'); } }) },
    '../lib/use-operation-context': { useOperationContext: () => () => () => undefined },
    '../lib/learning-diary-policy': {}, '../lib/learning-authoring-policy': {},
    '../ui/components': { Page: children, Section: ({ title, children }: any) => React.createElement('section', null, React.createElement('h2', null, title), children), Notice: ({ message }: any) => React.createElement('p', null, message), Row: ({ title }: any) => React.createElement('div', null, title), Empty: ({ title }: any) => React.createElement('p', null, title) },
    '../ui/DomainControls': { Disclosure: children, SegmentedControl: () => null },
    '../ui/BackNavigation': { useCampusNavigation: () => ({ onNavigate() {} }), useScreenExitGuard() {} }, '../ui/TemporalField': { TemporalField: () => null },
    '../ui/theme': { useTheme: () => ({ colors: { ink: '#111' } }) },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/LearningDiary.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Error, Date, URLSearchParams, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const root = createRoot(dom.window.document.getElementById('root')), checkbox = () => dom.window.document.querySelector('input[type="checkbox"]') as HTMLInputElement;
  try {
    await act(async () => root.render(React.createElement(exports.LearningPersonalDiary, { href: '/areas/learning/diary', studentId, self: false, date })));
    for (let turn = 0; checkbox()?.disabled && !dom.window.document.body.textContent?.includes('scope-bound') && !dom.window.document.body.textContent?.includes('could not be verified') && turn < 200; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
    assert.ok(checkbox(), 'The actual preparation checklist must render its Switch.');
    await run({ checkbox, requests, domainEffects: () => domainEffects, text: () => dom.window.document.body.textContent ?? '', async toggle() { await act(async () => checkbox().click());
      for (let turn = 0; checkbox().disabled && turn < 200; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); }); } });
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('actual diary preparation Switch loads and persists privately across encrypted browser relaunch in Live and Simulation', async () => {
  for (const mode of ['live', 'simulation'] as const) {
    const factory = new IDBFactory(), session = context(id(1), id(2), mode);
    await mount(factory, session, async h => { assert.equal(h.checkbox().disabled, false, h.text()); assert.equal(h.checkbox().checked, false);
      await h.toggle(); assert.equal(h.checkbox().checked, true); assert.equal(h.domainEffects(), 0, 'Device preparation never invokes an API refetch or domain action.'); assert.match(h.text(), /do not report homework completion/); });
    const rows = await raw(factory, store => store.getAll()); assert.equal(rows.length, 1); const envelope = rows[0];
    assert.equal(envelope.version, 1); assert.equal(envelope.iv.byteLength, 12); assert.ok(envelope.ciphertext instanceof ArrayBuffer);
    assert.equal(Buffer.from(envelope.ciphertext).includes(Buffer.from(itemId)), false);
    const storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
    assert.deepEqual(JSON.parse((await storage.getItemAsync(prefix(session)))!), { [itemId]: true });
    await mount(factory, session, async h => { assert.equal(h.checkbox().disabled, false); assert.equal(h.checkbox().checked, true); await h.toggle(); assert.equal(h.checkbox().checked, false); });
    assert.deepEqual(JSON.parse((await storage.getItemAsync(prefix(session)))!), { [itemId]: false });
  }
});
test('actual diary keeps preparation separate by actor, campus, origin, Simulation run, learner and date', async () => {
  const factory = new IDBFactory(), original = context();
  await mount(factory, original, async h => { assert.equal(h.checkbox().disabled, false, h.text()); await h.toggle(); });
  const before = await raw(factory, store => store.getAll()), others = [context(id(7)), context(id(1), id(8)), context(id(1), id(2), 'live', null, 'https://other.example'),
    context(id(1), id(2), 'simulation'), context(id(1), id(2), 'simulation', `scenario:${id(3)}:run:${id(9)}`)];
  assert.equal(new Set([original, ...others].map(session => prefix(session))).size, others.length + 1);
  for (const session of others) await mount(factory, session, async h => { assert.equal(h.checkbox().disabled, false); assert.equal(h.checkbox().checked, false); });
  for (const selected of [{ studentId: id(10) }, { date: '2026-11-09' }]) await mount(factory, original, async h => { assert.equal(h.checkbox().disabled, false); assert.equal(h.checkbox().checked, false); }, selected);
  assert.deepEqual(await raw(factory, store => store.getAll()), before, 'Reading unrelated scopes never erases another person’s checks.');
  const target = prefix(others[0]!), envelope = await raw(factory, store => store.get(prefix(original)));
  await raw(factory, store => store.put(envelope, target));
  await mount(factory, others[0]!, async h => { assert.equal(h.checkbox().disabled, true); assert.equal(h.checkbox().checked, false); assert.match(h.text(), /could not be verified/); });
  assert.deepEqual(await raw(factory, store => store.get(target)), envelope, 'Foreign authenticated ciphertext remains retained on refusal.');
});
test('packing storage still rejects credentials, broad namespaces, malformed scope keys and native-only options', async () => {
  const factory = new IDBFactory(), storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto }), base = prefix(context());
  for (const key of ['thatcampus.access-token', 'thatcampus.native-session.v1', 'thatcampus.learning-packing', `thatcampus.learning-packing.${learner}`, `${base}.token`, `${base}.manifest.extra`, `thatcampus.learning-packing-extra.${hash('scope')}`])
    await assert.rejects(storage.setItemAsync(key, 'credential'), /only scope-bound/);
  for (const options of [{ requireAuthentication: true }, { keychainService: 'account' }, { accessGroup: 'account' }, { keychainAccessible: 1 }])
    await assert.rejects(storage.setItemAsync(base, 'checks', options), /unavailable/);
});

test('actual diary recovers a committed preparation check after a lost local write reply without clearing it or sending a command', async () => {
  for (const mode of ['live', 'simulation'] as const) {
    const factory = new IDBFactory(), session = context(id(1), id(2), mode);
    await mount(factory, session, async h => { assert.equal(h.checkbox().disabled, false); await h.toggle(); assert.equal(h.checkbox().checked, false); assert.match(h.text(), /write reply lost after commit/); assert.equal(h.domainEffects(), 0); }, { loseWriteReply: true });
    const before = await raw(factory, store => store.getAll());
    await mount(factory, session, async h => { assert.equal(h.checkbox().checked, true); assert.equal(h.checkbox().disabled, false); assert.equal(h.domainEffects(), 0); });
    assert.deepEqual(await raw(factory, store => store.getAll()), before, 'Relaunch recovers committed private state without discarding uncertain bytes.');
  }
});

test('actual diary refuses corrupted retained JSON without deleting its encrypted bytes or enabling a replacement check', async () => {
  const factory = new IDBFactory(), session = context(), storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  await storage.setItemAsync(prefix(session), '{corrupted JSON'); const before = await raw(factory, store => store.getAll());
  await mount(factory, session, async h => { assert.equal(h.checkbox().disabled, true); assert.equal(h.checkbox().checked, false); assert.equal(h.domainEffects(), 0); await h.toggle(); });
  assert.deepEqual(await raw(factory, store => store.getAll()), before);
});
