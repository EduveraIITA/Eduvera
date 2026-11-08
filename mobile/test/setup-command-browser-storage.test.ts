import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';
import { createChunkedNativePendingStorage } from '../src/lib/native-pending-action';
import { scopeIdentity } from '../src/lib/api-policy';
import { ApiError } from '../src/lib/api-client';
import * as policy from '../src/features/SetupCommandPolicy';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const crypto = webcrypto as unknown as Crypto, hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const world = `scenario:${id(3)}:run:${id(4)}`;
function context(actor = id(1), school = id(2), mode: 'live' | 'simulation' = 'live', namespace = mode === 'live' ? null : world, origin = 'https://campus.example') {
  const environment = { mode, namespace_id: namespace };
  return { user: { id: actor }, schoolId: school, environment, scopeKey: JSON.stringify([origin, scopeIdentity(actor, school, environment)]) };
}
type Context = ReturnType<typeof context>;
const prefix = (session: Context) => `thatcampus.institution-commands.${hash(session.scopeKey)}`;
const draft = (session: Context): Omit<policy.SetupIntent, 'version' | 'scope' | 'schoolId' | 'accepted'> => ({
  operation: 'authorityDraft', resource: session.schoolId, method: 'POST', body: { legal_operator_name: 'Aaranya Education Trust',
    lead_officeholder_name: 'Asha Rao', lead_is_current_user: true, authority_basis_title: 'Reviewed trust instrument', authority_reference: 'Exact reviewed reference कक्षा 🙂' },
});
async function raw(factory: IDBFactory, work: (store: IDBObjectStore) => IDBRequest) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('thatcampus-device-journals-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise<any>((resolve, reject) => { const tx = db.transaction('journal_entries', 'readwrite'), request = work(tx.objectStore('journal_entries')); let result: unknown; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
async function mount(factory: IDBFactory, session: Context, run: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const store = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  const requests: { path: string; method: string }[] = [], exports: any = {};
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'expo-router': { useIsFocused: () => true },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID,
      digestStringAsync: async (algorithm: string, value: string) => { assert.equal(algorithm, 'SHA-256'); return hash(value); } },
    '../lib/device-storage': { ...store, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => undefined }) },
    '../auth/SessionProvider': { useSession: () => session },
    '../lib/use-operation-context': { useOperationContext: () => () => () => undefined },
    '../lib/api': { ApiError, captureApiContext: () => ({ assertCurrent() {} }), apiFetch: async (path: string, options?: RequestInit) => {
      requests.push({ path, method: options?.method ?? 'GET' }); if (options?.method) throw new Error('Response lost after dispatch'); return {};
    } },
    '../lib/native-pending-action': { createChunkedNativePendingStorage }, './SetupCommandPolicy': policy,
    '../ui/BackNavigation': { useScreenExitGuard() {} },
    '../ui/components': { Button: ({ title }: any) => React.createElement('button', null, title), Notice: ({ message }: any) => React.createElement('p', null, message) },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/SetupCommand.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, Error, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  let writer: any;
  function Screen() { writer = exports.useSetupCommand(session.schoolId, '/more/setup/institution'); return React.createElement(exports.SetupCommandStatus, { writer }); }
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Screen)));
    for (let turn = 0; !writer.ready && turn < 200; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
    assert.equal(writer.ready, true, 'The actual setup journal must finish hydration.');
    await run({ writer: () => writer, requests, text: () => dom.window.document.body.textContent ?? '',
      async submit(input = draft(session)) { await act(async () => { await writer.run(input); }); },
      async recover() { await act(async () => { await writer.run(); }); } });
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('actual setup hook hydrates its encrypted browser journal in Live and Simulation without a false credential error', async () => {
  for (const mode of ['live', 'simulation'] as const) await mount(new IDBFactory(), context(id(1), id(2), mode), async h => {
    assert.equal(h.writer().blocked, false); assert.equal(h.writer().locked, false); assert.equal(h.writer().pending, null);
    assert.equal(h.writer().error, ''); assert.equal(h.requests.length, 0);
  });
});
test('actual setup journal retains an uncertain dispatch across relaunch and a legacy inspection never clears it', async () => {
  const factory = new IDBFactory(), session = context(); let retained: unknown;
  await mount(factory, session, async h => {
    await h.submit(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'POST');
    retained = JSON.parse(JSON.stringify(h.writer().pending)); assert.ok(retained); assert.equal((retained as policy.SetupIntent).accepted, undefined);
    await h.submit(); assert.equal(h.requests.length, 1, 'An unknown intent prevents replacement.');
  });
  const before = await raw(factory, store => store.getAll()), keys = await raw(factory, store => store.getAllKeys());
  assert.ok(keys.includes(`${prefix(session)}.manifest`)); assert.ok(keys.length >= 2);
  for (const row of before) { assert.equal(row.version, 1); assert.equal(row.iv.byteLength, 12); assert.ok(row.ciphertext instanceof ArrayBuffer); assert.equal(Buffer.from(row.ciphertext).includes(Buffer.from('Exact reviewed reference')), false); }
  await mount(factory, session, async h => {
    assert.equal(h.writer().blocked, false); assert.deepEqual(JSON.parse(JSON.stringify(h.writer().pending)), retained); assert.equal(h.writer().locked, true);
    await h.recover(); assert.deepEqual(h.requests.map((row: any) => row.method), ['GET']); assert.ok(h.writer().pending);
    assert.match(h.text(), /earlier save remains unconfirmed/);
  });
  assert.deepEqual(await raw(factory, store => store.getAll()), before, 'Inspection preserves exact ciphertext; no unknown proof is cleared.');
});
test('setup scope hashing separates actor, campus, origin and both Simulation namespaces without clearing the original intent', async () => {
  const factory = new IDBFactory(), original = context();
  await mount(factory, original, async h => { await h.submit(); assert.ok(h.writer().pending); });
  const before = await raw(factory, store => store.getAll());
  const others = [context(id(5)), context(id(1), id(6)), context(id(1), id(2), 'live', null, 'https://other.example'),
    context(id(1), id(2), 'simulation'), context(id(1), id(2), 'simulation', `scenario:${id(3)}:run:${id(7)}`)];
  assert.equal(new Set([original, ...others].map(prefix)).size, others.length + 1);
  for (const session of others) await mount(factory, session, async h => { assert.equal(h.writer().blocked, false); assert.equal(h.writer().pending, null); assert.equal(h.requests.length, 0); });
  assert.deepEqual(await raw(factory, store => store.getAll()), before);
  const envelope = await raw(factory, store => store.get(`${prefix(original)}.manifest`)), target = `${prefix(others[0]!)}.manifest`;
  await raw(factory, store => store.put(envelope, target));
  await mount(factory, others[0]!, async h => { assert.equal(h.writer().blocked, true); assert.equal(h.requests.length, 0); assert.match(h.text(), /could not be verified/); });
  assert.deepEqual(await raw(factory, store => store.get(target)), envelope, 'Unverifiable transplanted bytes remain for recovery.');
});
test('valid encrypted but foreign setup intent fails owning validation and remains retained', async () => {
  const factory = new IDBFactory(), original = context(), target = context(id(5));
  await mount(factory, original, async h => { await h.submit(); });
  const storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  const chunked = (session: Context) => createChunkedNativePendingStorage({ get: storage.getItemAsync, set: storage.setItemAsync, remove: storage.deleteItemAsync, randomId: randomUUID, digest: async value => hash(value) }, prefix(session));
  const retained = await chunked(original).read(); assert.ok(retained); await chunked(target).write(retained);
  const before = await raw(factory, store => store.getAll());
  await mount(factory, target, async h => { assert.equal(h.writer().blocked, true); assert.equal(h.requests.length, 0); assert.match(h.text(), /Retained institution evidence cannot be verified/); });
  assert.deepEqual(await raw(factory, store => store.getAll()), before);
});
test('institution namespace admission keeps exact scope/chunk grammar and credential/native-auth denials', async () => {
  const store = createBrowserDeviceStorage({ indexedDB: () => new IDBFactory(), crypto: () => crypto }), base = prefix(context());
  for (const key of ['thatcampus.native-session.v1', 'thatcampus.access-token', 'bearer', 'thatcampus.institution-commands',
    `thatcampus.institution-commands.${id(1)}`, `${base}.access-token`, `${base}.manifest.extra`, `${base}.${randomUUID()}.10000`]) {
    await assert.rejects(store.getItemAsync(key), /only scope-bound/); await assert.rejects(store.setItemAsync(key, 'credential'), /only scope-bound/); await assert.rejects(store.deleteItemAsync(key), /only scope-bound/);
  }
  for (const options of [{ requireAuthentication: true }, { keychainService: 'account' }, { accessGroup: 'account' }, { keychainAccessible: 1 }])
    await assert.rejects(store.setItemAsync(`${base}.manifest`, 'intent', options), /unavailable/);
});
