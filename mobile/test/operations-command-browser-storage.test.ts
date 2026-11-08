import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '../src/lib/api-client';
import { scopeIdentity } from '../src/lib/api-policy';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';
import { academicAttendancePath, type AcademicAttendanceDetail } from '../src/lib/academic-attendance';
import { createChunkedNativePendingStorage, nativePendingScopeKey } from '../src/lib/native-pending-action';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const crypto = webcrypto as unknown as Crypto, hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const world = `scenario:${id(3)}:run:${id(4)}`;
function context(actor = id(1), school = id(2), mode: 'live' | 'simulation' = 'live', namespace = mode === 'live' ? null : world, origin = 'https://campus.example') {
  const environment = { mode, namespace_id: namespace };
  return { user: { id: actor }, schoolId: school, environment, scopeKey: JSON.stringify([origin, scopeIdentity(actor, school, environment)]),
    scope: { actorId: actor, schoolId: school, mode, namespaceId: namespace, origin } };
}
type Context = ReturnType<typeof context>;
type Owner = 'fees-operations' | 'event-admin' | 'academic-register-action';
type Request = { path: string; method: string; body?: string; headers?: HeadersInit };
const owners: Owner[] = ['fees-operations', 'event-admin', 'academic-register-action'];
const source = { kind: 'daily_class' as const, classSectionId: id(8), date: '2026-11-08' };
const prefix = (owner: Owner, session: Context, selected = source) => `thatcampus.${owner}.${hash(owner === 'academic-register-action'
  ? JSON.stringify([nativePendingScopeKey(session.scope), academicAttendancePath(selected)]) : session.scopeKey)}`;
const scopeVariants = () => [context(id(5)), context(id(1), id(6)), context(id(1), id(2), 'live', null, 'https://other.example'),
  context(id(1), id(2), 'simulation'), context(id(1), id(2), 'simulation', `scenario:${id(3)}:run:${id(7)}`)];
function basis(session: Context): AcademicAttendanceDetail {
  return { date: source.date, schoolId: session.schoolId, classId: source.classSectionId, termId: id(9), className: 'M.Tech Data Engineering · Semester I',
    term: '2026–27', room: 'Cedar 155', session: null, register: { id: id(10), state: 'draft', revision: 2, submittedBy: '', submittedAt: '', lockedAt: '' },
    availability: { canMark: true, reason: '' }, roster: [{ id: id(11), name: 'Aditi Vyas', admissionNumber: 'AAR-2026-104', rollNumber: '104', status: null, remarks: '' }],
    pendingEvidence: 0, evidenceRows: [], continuitySnapshot: { fingerprint: 'a'.repeat(64), count: 1, capturedAt: '2026-11-08T04:00:00Z', expiresAt: '2026-11-09T04:00:00Z', token: 'A'.repeat(43) } };
}
function registerWire(session: Context) {
  return { date: source.date, class: { id: source.classSectionId, school_id: session.schoolId, term_id: id(9), name: 'M.Tech Data Engineering · Semester I' },
    register: { id: id(10), revision: 3, state: 'submitted' }, roster: [{ id: id(11), name: 'Aditi Vyas', status: 'present', remarks: 'Reviewed original mark कक्षा' }], pending_evidence: [] };
}
function draft(owner: Owner, session: Context) {
  if (owner === 'fees-operations') return { kind: 'decision', sourceId: id(12), invoiceId: id(13), body: { expected_revision: 3, decision: 'approve', reason: 'Reviewed instalment request कक्षा' } };
  if (owner === 'event-admin') return { kind: 'grant', targetId: id(12), studentId: id(11), body: { school_id: session.schoolId, idempotency_key: id(14), expected_revision: 0,
    valid_from: '2026-11-08', valid_until: '2027-06-30', provenance: 'Reviewed guardian mandate कक्षा', verified: true } };
  return { records: [{ student_id: id(11), status: 'present', remarks: 'Reviewed original mark कक्षा' }], observedAt: '2026-11-08T04:01:00Z' };
}
function accepted(owner: Owner, request: Request, session: Context) {
  const body = JSON.parse(request.body!);
  if (owner === 'fees-operations') return { id: id(15), request_id: id(12), invoice_id: id(13), revision: 4, replayed: false, decision: body.decision };
  if (owner === 'event-admin') return { id: id(15), relationship_id: id(12), student_id: id(11), revision: 1, status: 'active', valid_from: body.valid_from, valid_until: body.valid_until, provenance: body.provenance };
  return { status: 'accepted', batch: { id: id(15), idempotency_key: (request.headers as Record<string, string>)['Idempotency-Key'], recorded_by: session.user.id,
    school_id: session.schoolId, class_section_id: source.classSectionId, term_id: id(9), date: source.date, expected_register_revision: 2, roster_count: 1, source: 'live_app', status: 'accepted' }, register: registerWire(session), review: null };
}
async function raw(factory: IDBFactory, work: (store: IDBObjectStore) => IDBRequest) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('thatcampus-device-journals-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise<any>((resolve, reject) => { const tx = db.transaction('journal_entries', 'readwrite'), request = work(tx.objectStore('journal_entries')); let result: unknown;
    request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
function chunked(factory: IDBFactory, owner: Owner, session: Context, selected = source) {
  const storage = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  return createChunkedNativePendingStorage({ get: storage.getItemAsync, set: storage.setItemAsync, remove: storage.deleteItemAsync, randomId: randomUUID, digest: async value => hash(value) }, prefix(owner, session, selected));
}
type Ports = { api?: (request: Request) => Promise<unknown>; refresh?: () => Promise<void>; selected?: typeof source };
/** Only external ports are replaced. Every mount reloads the actual owning hook,
 * policies, cross-finance gate and journals; IndexedDB/key/ciphertext survive. */
async function mount(owner: Owner, factory: IDBFactory, session: Context, run: (h: any) => Promise<void>, ports: Ports = {}) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const store = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto });
  const requests: Request[] = [], received: unknown[] = []; let epoch = 0, focused = true, appState = 'active', writer: any;
  const guard = () => { const captured = epoch; return () => { if (epoch !== captured) throw new Error('The original account, campus, world or view changed.'); }; };
  const paths = fileURLToPath(new URL('../src/', import.meta.url));
  const api = async (path: string, options?: RequestInit) => {
    const request = { path, method: options?.method ?? 'GET', body: options?.body as string | undefined, headers: options?.headers }; requests.push(request);
    if (ports.api) return ports.api(request);
    if (request.method !== 'GET') throw new Error('Response lost after dispatch');
    return owner === 'academic-register-action' ? registerWire(session) : {};
  };
  const queryClient = { invalidateQueries: async () => { await ports.refresh?.(); }, setQueryData() {} };
  const overrides: Record<string, unknown> = {
    [resolve(paths, 'lib/device-storage')]: { ...store, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 },
    [resolve(paths, 'auth/SessionProvider')]: { useSession: () => session },
    [resolve(paths, 'lib/api')]: { ApiError, apiFetch: api, captureApiContext: () => ({ assertCurrent: guard() }) },
    [resolve(paths, 'lib/use-operation-context')]: { useOperationContext: () => guard },
    [resolve(paths, 'lib/native-pending-action')]: { createChunkedNativePendingStorage, nativePendingScopeKey },
    [resolve(paths, 'ui/BackNavigation')]: { useScreenExitGuard() {} },
    [resolve(paths, 'ui/components')]: { Button: ({ title }: any) => React.createElement('button', null, title), Notice: ({ message }: any) => React.createElement('p', null, message) },
  };
  const external: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { AppState: { get currentState() { return appState; } } },
    'expo-router': { useIsFocused: () => focused }, '@tanstack/react-query': { useQueryClient: () => queryClient },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID,
      digestStringAsync: async (algorithm: string, value: string) => { assert.equal(algorithm, 'SHA-256'); return hash(value); } },
  };
  const modules = new Map<string, any>();
  function load(path: string): any {
    if (path in overrides) return overrides[path];
    if (modules.has(path)) return modules.get(path);
    const file = [path, `${path}.ts`, `${path}.tsx`].find(existsSync); assert.ok(file, path);
    const exports = {}; modules.set(path, exports);
    runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { exports, Error, URLSearchParams, Date, setTimeout, clearTimeout, require(name: string) { if (name.startsWith('.')) return load(resolve(dirname(file), name)); assert.ok(name in external, name); return external[name]; } });
    return exports;
  }
  const module = load(resolve(paths, owner === 'fees-operations' ? 'features/FeesCommand' : owner === 'event-admin' ? 'features/EventAdminCommand' : 'lib/use-academic-register-action'));
  function Screen() {
    if (owner === 'fees-operations') writer = module.useFeesCommands(session.schoolId, '/areas/fees/workspace');
    else if (owner === 'event-admin') writer = module.useEventAdminCommand(session.schoolId, '/areas/events/consent-authorities');
    else writer = module.useAcademicRegisterAction(session.scope, ports.selected ?? source, { capabilities: ['attendance.record', 'attendance.review'], scopes: [{ kind: 'institution', id: session.schoolId }] }, (detail: unknown, receipt: unknown) => received.push({ detail, receipt }), '/areas/attendance/registers');
    return owner === 'fees-operations' ? React.createElement(module.FeesCommandStatus, { writer }) : owner === 'event-admin' ? React.createElement(module.EventAdminStatus, { writer }) : React.createElement('p', null, writer.error);
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Screen)));
    for (let turn = 0; (!writer.ready || owner === 'fees-operations' && (writer.checkoutBlocked || writer.reviewBlocked)) && turn < 200; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
    assert.equal(writer.ready, true, 'The actual journal must finish hydration.');
    await run({ writer: () => writer, requests, received, text: () => dom.window.document.body.textContent ?? '',
      rebind() { epoch++; }, async hide() { focused = false; await act(async () => root.render(React.createElement(Screen))); }, background() { appState = 'background'; },
      async submit(input = draft(owner, session)) { await act(async () => { if (owner === 'academic-register-action') await writer.run('daily_capture', basis(session), input); else if (owner === 'event-admin') await writer.run(input, () => undefined); else await writer.run(input); }); },
      async retry() { assert.equal(owner, 'fees-operations'); await act(async () => { await writer.run(); }); },
      async recover() { await act(async () => { if (owner === 'fees-operations') await writer.check(); else if (owner === 'event-admin') await writer.run(); else await writer.recover(); }); } });
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

for (const owner of owners) {
  test(`${owner}: actual hook hydrates encrypted browser storage in Live and Simulation`, async () => {
    for (const mode of ['live', 'simulation'] as const) await mount(owner, new IDBFactory(), context(id(1), id(2), mode), async h => {
      assert.equal(h.writer().blocked, false, h.writer().error); assert.equal(h.writer().locked, false); assert.equal(h.writer().pending, null); assert.equal(h.requests.length, 0);
    });
  });
  test(`${owner}: lost response survives relaunch; recovery conflict cannot clear or replace the original evidence`, async () => {
    for (const mode of ['live', 'simulation'] as const) {
      const factory = new IDBFactory(), session = context(id(1), id(2), mode); let retained: any, original: Request;
      await mount(owner, factory, session, async h => {
        await h.submit(); assert.equal(h.requests.length, 1); original = h.requests[0]; retained = JSON.parse(JSON.stringify(h.writer().pending)); assert.ok(retained);
        await h.submit(); assert.equal(h.requests.length, 1, 'An unknown action blocks replacement.');
      });
      const before = await raw(factory, store => store.getAll()), keys = await raw(factory, store => store.getAllKeys());
      assert.ok(keys.includes(`${prefix(owner, session)}.manifest`)); assert.ok(before.length >= 2);
      for (const envelope of before) {
        assert.equal(envelope.version, 1); assert.equal(envelope.iv.byteLength, 12); assert.ok(envelope.ciphertext instanceof ArrayBuffer);
        for (const secret of ['Reviewed', 'Aditi', 'snapshot_token']) assert.equal(Buffer.from(envelope.ciphertext).includes(Buffer.from(secret)), false);
      }
      await mount(owner, factory, session, async h => {
        assert.equal(h.writer().blocked, false); assert.deepEqual(JSON.parse(JSON.stringify(h.writer().pending)), retained); assert.equal(h.writer().locked, true);
        await h.recover(); assert.equal(h.requests.length, 1); assert.ok(h.writer().pending); assert.match(h.text(), /conflict/);
        if (owner !== 'fees-operations') assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), JSON.parse(JSON.stringify(original!)), 'Recovery sends the identical keyed request.');
        else assert.equal(h.requests[0].method, 'GET', 'Finance checks its exact confirmation before offering an unchanged retry.');
      }, { api: async () => { throw new ApiError('Current source conflict; outcome unconfirmed', 409); } });
      assert.deepEqual(JSON.parse((await chunked(factory, owner, session).read())!), retained, 'Conflicting recovery retains exact intent, original key/revision and no accepted proof.');
    }
  });
  test(`${owner}: exact accepted receipt with failed refresh survives relaunch and finishes without a second mutation`, async () => {
    for (const mode of ['live', 'simulation'] as const) {
      const factory = new IDBFactory(), session = context(id(1), id(2), mode); let retained: any;
      await mount(owner, factory, session, async h => {
        await h.submit(); assert.equal(h.requests.filter((r: Request) => r.method === 'POST').length, 1); retained = JSON.parse(JSON.stringify(h.writer().pending)); assert.ok(retained);
        assert.equal(owner === 'academic-register-action' ? retained.phase === 'received' : retained.accepted !== undefined, true);
      }, { api: async request => request.method === 'GET' ? Promise.reject(new Error('Refresh temporarily unavailable')) : accepted(owner, request, session), refresh: async () => { throw new Error('Refresh temporarily unavailable'); } });
      await mount(owner, factory, session, async h => {
        assert.equal(h.writer().blocked, false); assert.deepEqual(JSON.parse(JSON.stringify(h.writer().pending)), retained);
        await h.recover(); assert.equal(h.requests.filter((r: Request) => r.method !== 'GET').length, 0, 'A persisted acceptance never resends the mutation.');
        assert.equal(h.writer().pending, null); assert.equal(h.writer().locked, false);
        if (owner === 'academic-register-action') { assert.equal(h.requests.length, 1); assert.equal(h.received.length, 1); }
      });
      assert.equal(await chunked(factory, owner, session).read(), null);
    }
  });
  test(`${owner}: actor, campus, API origin and Simulation runs separate journals and reject ciphertext transplantation`, async () => {
    const factory = new IDBFactory(), original = context();
    await mount(owner, factory, original, async h => { await h.submit(); assert.ok(h.writer().pending); });
    const before = await raw(factory, store => store.getAll()), others = scopeVariants();
    assert.equal(new Set([original, ...others].map(session => prefix(owner, session))).size, others.length + 1);
    for (const session of others) await mount(owner, factory, session, async h => { assert.equal(h.writer().blocked, false); assert.equal(h.writer().pending, null); assert.equal(h.requests.length, 0); });
    assert.deepEqual(await raw(factory, store => store.getAll()), before);
    const envelope = await raw(factory, store => store.get(`${prefix(owner, original)}.manifest`)), target = `${prefix(owner, others[0]!)}.manifest`;
    await raw(factory, store => store.put(envelope, target));
    await mount(owner, factory, others[0]!, async h => { assert.equal(h.writer().blocked, true); assert.equal(h.requests.length, 0); assert.match(h.text(), /could not be verified/); });
    assert.deepEqual(await raw(factory, store => store.get(target)), envelope, 'Authenticated key mismatch fails closed without deleting evidence.');
  });
  test(`${owner}: validly encrypted foreign intent is refused by its actual owner and its bytes remain retained`, async () => {
    const factory = new IDBFactory(), original = context(), target = context(id(5));
    await mount(owner, factory, original, async h => { await h.submit(); assert.ok(h.writer().pending); });
    const retained = await chunked(factory, owner, original).read(); assert.ok(retained); await chunked(factory, owner, target).write(retained);
    const before = await raw(factory, store => store.getAll());
    await mount(owner, factory, target, async h => { assert.equal(h.writer().blocked, true); assert.equal(h.requests.length, 0); assert.match(h.text(), /retained.*(?:cannot|could not) be verified/i); });
    assert.deepEqual(await raw(factory, store => store.getAll()), before);
  });
  test(`${owner}: admission keeps strict SHA/chunk grammar and credential/native-auth denials`, async () => {
    const factory = new IDBFactory(), store = createBrowserDeviceStorage({ indexedDB: () => factory, crypto: () => crypto }), base = prefix(owner, context());
    for (const key of ['thatcampus.native-session.v1', 'thatcampus.access-token', 'bearer', `thatcampus.${owner}`, `thatcampus.${owner}.${id(1)}`,
      `${base}.refresh-token`, `${base}.manifest.extra`, `${base}.${randomUUID()}.10000`, `${base.toUpperCase()}.manifest`, `thatcampus.${owner}-unreviewed.${hash('scope')}`]) {
      await assert.rejects(store.getItemAsync(key), /only scope-bound/); await assert.rejects(store.setItemAsync(key, 'credential'), /only scope-bound/); await assert.rejects(store.deleteItemAsync(key), /only scope-bound/);
    }
    for (const options of [{ requireAuthentication: true }, { keychainService: 'account' }, { accessGroup: 'account' }, { keychainAccessible: 1 }])
      await assert.rejects(store.setItemAsync(`${base}.manifest`, 'intent', options), /unavailable/);
  });
}

test('finance and event rule inspections preserve unknown legacy saves without inferring acceptance from current values', async () => {
  for (const mode of ['live', 'simulation'] as const) for (const owner of ['fees-operations', 'event-admin'] as const) {
    const factory = new IDBFactory(), session = context(id(1), id(2), mode);
    const input = owner === 'fees-operations' ? { kind: 'settings', sourceId: session.schoolId, body: { expected_revision: 3, payee_name: 'Aaranya Institute', upi_id: 'aaranya@bank', instructions: 'Use the reviewed invoice reference.' } }
      : { kind: 'rules', targetId: session.schoolId, body: { expected_workflow_revision: 3, expected_domain_revision: 4, event_entry_hours_before: 2, event_staff_hours_after: 24, observation_hours_before: 2, observation_hours_after: 2 } };
    await mount(owner, factory, session, async h => { await h.submit(input); assert.ok(h.writer().pending); });
    const before = await raw(factory, store => store.getAll());
    await mount(owner, factory, session, async h => { await h.recover(); assert.deepEqual(h.requests.map((r: Request) => r.method), ['GET']); assert.ok(h.writer().pending); assert.match(h.text(), /remains unconfirmed/); },
      { api: async () => owner === 'fees-operations' ? { saved: true } : { category: 'events', workflow: { revision: 4, event_entry_hours_before: 2, event_staff_hours_after: 24 }, domain: { revision: 5, observation_hours_before: 2, observation_hours_after: 2 } } });
    assert.deepEqual(await raw(factory, store => store.getAll()), before, 'Inspection never rewrites or removes unknown proof.');
  }
});

test('academic exact register source separates dates; lost response recovery confirms original key, snapshot and every mark', async () => {
  for (const mode of ['live', 'simulation'] as const) {
    const owner = 'academic-register-action', factory = new IDBFactory(), session = context(id(1), id(2), mode); let original: Request;
    await mount(owner, factory, session, async h => { await h.submit(); original = h.requests[0]; });
    const before = await raw(factory, store => store.getAll()), selected = { ...source, date: '2026-11-09' };
    assert.notEqual(prefix(owner, session), prefix(owner, session, selected));
    await mount(owner, factory, session, async h => { assert.equal(h.writer().blocked, false); assert.equal(h.writer().pending, null); assert.equal(h.requests.length, 0); }, { selected });
    assert.deepEqual(await raw(factory, store => store.getAll()), before);
    await mount(owner, factory, session, async h => {
      await h.recover(); assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), JSON.parse(JSON.stringify(original!))); assert.equal(JSON.parse(h.requests[0].body).snapshot_token, 'A'.repeat(43));
      assert.equal(h.writer().pending, null); assert.equal(h.received.length, 1);
    }, { api: async request => request.method === 'GET' ? registerWire(session) : accepted(owner, request, session) });
  }
});

test('finance and event unknown recovery finishes only with the original intent and exact owning receipt', async () => {
  for (const mode of ['live', 'simulation'] as const) for (const owner of ['fees-operations', 'event-admin'] as const) {
    const factory = new IDBFactory(), session = context(id(1), id(2), mode); let original: Request;
    await mount(owner, factory, session, async h => { await h.submit(); original = h.requests[0]; assert.ok(h.writer().pending); });
    await mount(owner, factory, session, async h => {
      await h.recover();
      if (owner === 'fees-operations') { assert.equal(h.writer().retry, true); assert.ok(h.writer().pending); assert.equal(h.requests[0].method, 'GET'); await h.retry(); }
      const sent = h.requests.filter((request: Request) => request.method === 'POST'); assert.equal(sent.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), JSON.parse(JSON.stringify(original!)));
      assert.equal(h.writer().pending, null); assert.equal(h.writer().locked, false);
    }, { api: async request => request.method === 'GET' ? { school_id: session.schoolId, invoices: [{ id: id(13) }], confirmation: { state: 'not_found' } } : accepted(owner, request, session) });
    assert.equal(await chunked(factory, owner, session).read(), null);
  }
});

test('a foreign result cannot turn any retained unknown command into an accepted receipt', async () => {
  for (const owner of owners) {
    const factory = new IDBFactory(), session = context(); let original: any;
    await mount(owner, factory, session, async h => { await h.submit(); original = JSON.parse(JSON.stringify(h.writer().pending)); });
    await mount(owner, factory, session, async h => {
      await h.recover(); assert.ok(h.writer().pending); assert.equal(owner === 'academic-register-action' ? h.writer().pending.phase : h.writer().pending.accepted, owner === 'academic-register-action' ? 'unknown' : undefined);
    }, { api: async request => {
      if (owner === 'fees-operations') return { school_id: session.schoolId, invoices: [{ id: id(13) }], confirmation: { state: 'accepted', result: { id: id(15), request_id: id(12), invoice_id: id(99), revision: 4, replayed: false, decision: 'approve' } } };
      const result = accepted(owner, request, session) as any;
      return owner === 'event-admin' ? { ...result, relationship_id: id(99) } : { ...result, batch: { ...result.batch, recorded_by: id(99) } };
    } });
    assert.deepEqual(JSON.parse((await chunked(factory, owner, session).read())!), original);
  }
});

test('late same-identity API rebind retains all three unknown actions and cannot record acceptance or clear them', async () => {
  for (const owner of owners) {
    const factory = new IDBFactory(), session = context(); let finish!: (value: unknown) => void;
    const response = new Promise(resolve => { finish = resolve; });
    await mount(owner, factory, session, async h => {
      const running = h.submit();
      for (let turn = 0; !h.requests.length && turn < 200; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
      assert.equal(h.requests.length, 1); h.rebind(); finish(accepted(owner, h.requests[0], session)); await running;
      assert.ok(h.writer().pending); assert.equal(owner === 'academic-register-action' ? h.writer().pending.phase : h.writer().pending.accepted, owner === 'academic-register-action' ? 'unknown' : undefined);
      assert.equal(h.received.length, 0); assert.ok(await chunked(factory, owner, session).read());
    }, { api: async () => response });
  }
});

test('active literal journal callers require exact browser admission; new omissions cannot silently ship', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url)), literals = new Map<string, Set<string>>(), staticKeys = new Map<string, Set<string>>();
  function scan(path: string) { for (const entry of readdirSync(path, { withFileTypes: true })) { const child = resolve(path, entry.name);
    if (entry.isDirectory()) scan(child); else if (/\.tsx?$/.test(entry.name)) {
      const source = readFileSync(child, 'utf8'), file = child.slice(root.length);
      for (const match of source.matchAll(/`thatcampus\.([^`$]*)\$\{/g)) {
        assert.ok(match[1]!.endsWith('.'), `Review unexpected storage key construction in ${file}`);
        const family = match[1]!.slice(0, -1), files = literals.get(family) ?? new Set(); files.add(file); literals.set(family, files);
      }
      for (const match of source.matchAll(/['"](thatcampus\.[^'"\s]*)['"]/g)) {
        const key = match[1]!, files = staticKeys.get(key) ?? new Set(); files.add(file); staticKeys.set(key, files);
      }
    } } }
  scan(root);
  // These exact families use an existing typed closed domain union. Discover its
  // current members instead of copying a stale list that misses a future owner.
  for (const [family, file, type] of [['pending.v1', 'lib/native-pending-action.ts', 'NativePendingDomain'], ['pending', 'lib/recorded-command.ts', 'RecordedDomain']]) {
    assert.deepEqual([...literals.get(family!)!], [file]); literals.delete(family!);
    const source = readFileSync(resolve(root, file!), 'utf8'), match = new RegExp(`export type ${type} = ([^;]+);`).exec(source); assert.ok(match);
    for (const value of match[1]!.matchAll(/'([^']+)'/g)) { assert.match(value[1]!, /^[a-z][a-z0-9-]*$/); literals.set(`${family}.${value[1]}`, new Set([file!])); }
  }
  // Separate platform adapters own these exact non-journal keys. None may enter
  // encrypted domain storage as an accidental credential/preference fallback.
  assert.deepEqual([...literals.get('gate.language.v1')!], ['lib/gate-operator-policy.ts']); literals.delete('gate.language.v1');
  assert.deepEqual([...staticKeys].map(([key, files]) => [key, [...files]]).sort(), [
    ['thatcampus.appearance', ['ui/theme-storage.ts']],
    ['thatcampus.attendance.database-key', ['lib/attendance-draft.ts']],
    ['thatcampus.journals.database-key', ['lib/large-action-store.ts']],
    ['thatcampus.native-session.v1', ['auth/SessionProvider.tsx']],
  ]);
  assert.match(readFileSync(resolve(root, 'ui/theme-storage.web.ts'), 'utf8'), /localStorage/);
  assert.match(readFileSync(resolve(root, 'lib/gate-language-storage.web.ts'), 'utf8'), /Non-secret browser preference only/);
  assert.match(readFileSync(resolve(root, 'lib/attendance-draft.web.ts'), 'utf8'), /createBrowserAttendanceDraftStorage/);
  assert.match(readFileSync(resolve(root, 'lib/large-action-store.web.ts'), 'utf8'), /createBrowserDeviceStorage|device-storage\.web/);
  assert.doesNotMatch(readFileSync(resolve(root, 'auth/SessionProvider.web.tsx'), 'utf8'), /device-storage/);
  const store = createBrowserDeviceStorage({ indexedDB: () => new IDBFactory(), crypto: () => crypto });
  for (const key of staticKeys.keys()) await assert.rejects(store.getItemAsync(key), /only scope-bound/);
  await assert.rejects(store.getItemAsync(`thatcampus.gate.language.v1.${hash('preference')}`), /only scope-bound/);
  for (const [family, files] of literals) {
    const key = `thatcampus.${family}.${hash('inventory-scope')}`;
    assert.equal(await store.getItemAsync(key), null, `${family} from ${[...files].join(', ')} needs an explicit payload/recovery review and exact admission.`);
  }
  for (const owner of [...owners, 'learning-packing']) assert.ok(literals.has(owner));
});
