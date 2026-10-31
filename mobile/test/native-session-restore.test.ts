import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { normalizeApiOrigin, scopeIdentity } from '../src/lib/api-policy';
import { createSessionLifecycle } from '../src/auth/session-lifecycle';
import { canRetainSessionPresentation } from '../src/auth/session-presentation';
import { storedNativeSession } from '../src/auth/native-session-restore';
import type { SessionContext } from '../src/auth/session-types';

const require = createRequire(import.meta.url), mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const configured = 'https://app2.thatcampus.com', oldOrigin = 'https://old-preview.trycloudflare.com';
const now = Date.now(), expiresAt = new Date(now + 86_400_000).toISOString();
const stored = (origin = configured) => JSON.stringify({ token: 'old-device-credential', origin, expiresAt });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('production stored-session policy compares normalized origins and never adopts another server', () => {
  assert.deepEqual(storedNativeSession(stored('HTTPS://APP2.THATCAMPUS.COM:443/'), configured, false, now), { token: 'old-device-credential', origin: configured, expiresAt });
  for (const origin of [oldOrigin, 'https://other.example', 'https://app2.thatcampus.com:8443', 'https://app2.thatcampus.com/path', 'https://user:secret@app2.thatcampus.com', 'http://127.0.0.1:8000'])
    assert.equal(storedNativeSession(stored(origin), configured, false, now), null, origin);
  assert.equal(storedNativeSession(stored('http://192.168.1.5:8000/'), configured, true, now)?.origin, 'http://192.168.1.5:8000');
});
test('malformed, missing and expired stored credentials cannot restore an account', () => {
  for (const raw of ['not JSON', 'null', '[]', '{}', JSON.stringify({ token: 42, origin: configured, expiresAt }), JSON.stringify({ token: 'credential', origin: 42, expiresAt }), JSON.stringify({ token: 'credential', origin: configured, expiresAt: null }), JSON.stringify({ token: 'credential', origin: configured, expiresAt: 'invalid' }), JSON.stringify({ token: 'credential', origin: configured, expiresAt: new Date(now).toISOString() })])
    assert.equal(storedNativeSession(raw, configured, false, now), null);
});

type Options = { development?: boolean; raw?: string | null; read?: Promise<string | null>; deleteFails?: boolean };
async function mounted(options: Options, run: (h: any) => Promise<void>) {
  const { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: configured });
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let origin = configured, token: string | null = null, raw = options.raw ?? null, context!: SessionContext, deletes = 0, revokes = 0;
  const origins: string[] = [], bindings: Array<string | null> = [], calls: Array<{ path: string; origin: string; token: string | null; method: string }> = [], writes: string[] = [];
  const user = { id: 'actor', username: 'person', email: 'person@example.test', first_name: 'Person', last_name: '', display_name: 'Person', active_school_id: 'school' };
  const session = { user, execution_environment: { mode: 'live' }, access_token: 'new-device-credential', expires_at: expiresAt };
  const client = { cancelQueries: async () => {}, clear() {} };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'private-device', getItemAsync: async () => options.read ? options.read : raw,
      deleteItemAsync: async () => { deletes++; if (options.deleteFails) throw new Error('Storage unavailable'); raw = null; },
      setItemAsync: async (_key: string, value: string) => { raw = value; writes.push(value); } },
    '@tanstack/react-query': { useQueryClient: () => client },
    '../lib/api': { getApiOrigin: () => origin, setApiOrigin(value: string) { origin = normalizeApiOrigin(value, options.development === true); origins.push(origin); },
      bindApiSession(value: string | null) { token = value; bindings.push(value); }, blockApiRequests() {}, setApiCallbacks() {},
      revokeCurrentNativeSession: async () => { revokes++; },
      apiFetch: async (path: string, init?: RequestInit) => { calls.push({ path, origin, token, method: init?.method ?? 'GET' }); return path.endsWith('/me/') ? { user, memberships: [], execution_environment: { mode: 'live' } } : session; } },
    '../lib/api-policy': { scopeIdentity }, './session-lifecycle': { createSessionLifecycle }, './session-presentation': { canRetainSessionPresentation },
    './native-session-restore': { storedNativeSession }, './demo-profile-policy': {}, './google-native-browser': {}, './google-native-flow': {}, './visit-onboarding-request': {},
  };
  const filename = join(mobile, 'src/auth/SessionProvider.tsx'), exports: any = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, __DEV__: options.development === true, Error, Date, JSON, require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected session dependency ${name}`); return dependencies[name]; } }, { filename });
  const tree = createRoot(dom.window.document.getElementById('root'));
  function Consumer() { context = exports.useSession(); return React.createElement('output', null, context.status); }
  const flush = async () => { await act(async () => { await Promise.resolve(); }); };
  let unmounted = false;
  const h = { calls, origins, bindings, writes, context: () => context, raw: () => raw, deletes: () => deletes, revokes: () => revokes,
    origin: () => origin, changeOrigin(value: string) { origin = value; }, flush,
    async unmount() { if (!unmounted) { await act(async () => tree.unmount()); unmounted = true; } } };
  try { await act(async () => tree.render(React.createElement(exports.SessionProvider, null, React.createElement(Consumer)))); await run(h); }
  finally { await h.unmount(); Object.assign(globalThis, previous); dom.window.close(); }
}

test('a rebuilt production app forgets the old tunnel credential locally with zero requests or revocations', async () => mounted({ raw: stored(oldOrigin) }, async h => {
  assert.equal(h.context().status, 'anonymous'); assert.equal(h.origin(), configured); assert.equal(h.raw(), null);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.origins, []); assert.ok(!h.bindings.includes('old-device-credential')); assert.equal(h.deletes(), 1); assert.equal(h.revokes(), 0);
}));
test('normalized same-origin production storage restores only against the configured binary origin', async () => mounted({ raw: stored('HTTPS://APP2.THATCAMPUS.COM:443/') }, async h => {
  assert.equal(h.context().status, 'authenticated'); assert.deepEqual(h.origins, []);
  assert.deepEqual(h.calls.map((call: any) => [call.path, call.origin, call.token]), [
    ['/api/v1/auth/native/session/', configured, 'old-device-credential'], ['/api/v1/auth/me/', configured, 'old-device-credential'],
  ]); assert.equal(h.deletes(), 0); assert.equal(h.revokes(), 0);
}));
test('development storage can restore its selected private server using a fresh lifecycle after the origin changes', async () => mounted({ raw: stored('http://192.168.1.5:8000/'), development: true }, async h => {
  assert.equal(h.context().status, 'authenticated'); assert.equal(h.origin(), 'http://192.168.1.5:8000');
  assert.deepEqual(h.origins, ['http://192.168.1.5:8000']); assert.equal(h.calls.length, 2); assert.ok(h.calls.every((call: any) => call.origin === h.origin()));
}));
test('a failed local deletion still cannot bind or send a rejected production credential', async () => mounted({ raw: stored(oldOrigin), deleteFails: true }, async h => {
  assert.equal(h.context().status, 'anonymous'); assert.equal(h.deletes(), 1); assert.deepEqual(h.calls, []); assert.equal(h.revokes(), 0); assert.ok(!h.bindings.includes('old-device-credential'));
}));
test('an origin change during delayed hydration cannot send the stored token or delete a later context', async () => {
  const read = deferred<string | null>();
  await mounted({ read: read.promise }, async h => {
    h.changeOrigin('https://another.example'); read.resolve(stored()); await h.flush();
    assert.deepEqual(h.calls, []); assert.equal(h.deletes(), 0); assert.deepEqual(h.bindings, []);
  });
});
test('a delayed hydration superseded by sign-in cannot restore or delete the newer credential', async () => {
  const read = deferred<string | null>();
  await mounted({ read: read.promise }, async h => {
    let login!: Promise<string | null>;
    await act(async () => { login = h.context().login('person@example.test', 'private-test-password'); await Promise.resolve(); });
    read.resolve(stored(oldOrigin)); await act(async () => { await login; });
    assert.equal(h.context().status, 'authenticated'); assert.equal(h.deletes(), 1); assert.equal(h.writes.length, 1);
    assert.equal(JSON.parse(h.raw()).token, 'new-device-credential'); assert.ok(h.calls.every((call: any) => call.origin === configured && call.token !== 'old-device-credential'));
    assert.equal(h.calls.filter((call: any) => call.method === 'POST').length, 1); assert.equal(h.revokes(), 0);
  });
});
test('unmounted hydration cannot bind, delete or request with its saved credential', async () => {
  const read = deferred<string | null>();
  await mounted({ read: read.promise }, async h => {
    await h.unmount(); read.resolve(stored(oldOrigin)); await h.flush();
    assert.deepEqual(h.calls, []); assert.deepEqual(h.origins, []); assert.deepEqual(h.bindings, []); assert.equal(h.deletes(), 0);
  });
});
test('an explicit refresh cannot transfer an already-restored credential after a server origin change', async () => mounted({ raw: stored() }, async h => {
  assert.equal(h.context().status, 'authenticated'); const reads = h.calls.length;
  h.changeOrigin('https://another.example'); await act(async () => { await h.context().refresh(); });
  assert.equal(h.context().status, 'anonymous'); assert.equal(h.calls.length, reads); assert.equal(h.deletes(), 1); assert.equal(h.revokes(), 0);
}));
