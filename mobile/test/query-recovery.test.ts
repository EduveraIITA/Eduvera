import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';
import ts from 'typescript';
import { ApiConnectionError, ApiError } from '../src/lib/api-client';
import { isExecutionRequest } from '../src/lib/api-policy';

// QueryObserver's polling runs only in a client environment. No network or UI
// adapter is used: execute the current hook's options against the real cache.
const previousWindow = globalThis.window;
globalThis.window = { addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
const require = createRequire(import.meta.url), { QueryClient, QueryObserver, focusManager } = require('@tanstack/react-query') as typeof import('@tanstack/react-query');
after(() => { focusManager.setFocused(undefined); if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else globalThis.window = previousWindow; });
type Context = { scopeKey: string; status: string; environment: { unavailable?: boolean }; focused: boolean };
const context = (): Context => ({ scopeKey: 'person:campus:live', status: 'authenticated', environment: {}, focused: true });
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function hook(fetcher: () => Promise<unknown>, current = context()) {
  const exports: Record<string, any> = {}, client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/query.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, any> = { '@tanstack/react-query': { useQuery: (options: unknown) => options, useQueryClient: () => client }, 'expo-router': { useIsFocused: () => current.focused }, '../auth/SessionProvider': { useSession: () => current }, './api': { apiFetch: fetcher }, './api-client': { ApiConnectionError }, './api-policy': { isExecutionRequest } };
  runInNewContext(source, { exports, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { client, context: current, options: (path = '/api/v1/workspace', options: Record<string, unknown> = {}) => exports.useApi(path, options) };
}
function observed(client: InstanceType<typeof QueryClient>, options: any) {
  // Preserve the production delay contract below; scale only elapsed time in
  // these deterministic failure/polling probes.
  const observer = new QueryObserver(client, { ...options, retryDelay: 1 });
  const states: Array<{ status: string; fetching: boolean; data: unknown }> = [];
  const unsubscribe = observer.subscribe(result => states.push({ status: result.status, fetching: result.isFetching, data: result.data }));
  return { observer, states, stop: () => { unsubscribe(); observer.destroy(); } };
}
async function settled(observer: ReturnType<typeof observed>['observer']) {
  for (let count = 0; count < 200; count++) { const result = observer.getCurrentResult(); if (!result.isFetching && result.status !== 'pending') return result; await wait(2); }
  assert.fail('The bounded query did not settle');
}

test('a classified transport read gets one bounded retry and terminal failure stops polling', async () => {
  let calls = 0;
  const source = hook(async () => { calls++; throw new ApiConnectionError('Service unavailable', 502); });
  const options = source.options(undefined, { refetchInterval: 15 });
  assert.equal(options.retryDelay, 1_000);
  const client = source.client, read = observed(client, options);
  try {
    const result = await settled(read.observer); assert.equal(result.status, 'error'); assert.equal(calls, 2);
    const terminal = read.states.findIndex(state => state.status === 'error'); assert.ok(terminal >= 0);
    await wait(65); assert.equal(calls, 2, 'No timer starts a new initial loader after the terminal failure');
    assert.equal(read.states.slice(terminal).some(state => state.status === 'pending'), false);
  } finally { read.stop(); client.clear(); }
});

test('one transient initial read failure recovers automatically without a terminal error screen', async () => {
  let calls = 0;
  const source = hook(async () => { if (++calls === 1) throw new ApiConnectionError('Gateway unavailable', 503); return { current: true }; });
  const client = source.client, read = observed(client, source.options(undefined, { refetchInterval: false }));
  try { assert.equal((await settled(read.observer)).status, 'success'); assert.equal(calls, 2); assert.equal(read.states.some(state => state.status === 'error'), false); }
  finally { read.stop(); client.clear(); }
});

test('authority, source-removal, contract and context errors are not retried as connection failures', async () => {
  for (const failure of [...[401, 403, 404, 410, 422, 500].map(status => new ApiError('Verified response', status)), new Error('Campus context changed'), new TypeError('Invalid response contract')]) {
    let calls = 0; const source = hook(async () => { calls++; throw failure; });
    const client = source.client, read = observed(client, source.options(undefined, { refetchInterval: 15 }));
    try { assert.equal((await settled(read.observer)).error, failure); assert.equal(calls, 1); assert.equal(source.options().refetchInterval(client.getQueryCache().find({ queryKey: read.observer.options.queryKey })), false); }
    finally { read.stop(); client.clear(); }
  }
});

test('cached same-scope data stays marked as errored until explicit refresh succeeds, without borrowing another scope', async () => {
  let available = false, calls = 0;
  const saved = Object.freeze({ id: 'reviewed-visit', revision: 4 });
  const source = hook(async () => { calls++; if (!available) throw new ApiConnectionError('Connection interrupted'); return saved; });
  const options = source.options(undefined, { refetchInterval: 15, staleTime: 0 }), client = source.client;
  client.setQueryData(options.queryKey, saved); const read = observed(client, options);
  try {
    const failed = await settled(read.observer); assert.equal(failed.data, saved); assert.equal(failed.isError, true); assert.equal(failed.isPending, false); assert.equal(calls, 1, 'A cached authority refresh publishes its failure without a background retry');
    await wait(50); assert.equal(calls, 1);
    const sameScope = source.context.scopeKey; source.context.scopeKey = 'person:campus:simulation:other'; const other = source.options();
    assert.equal(client.getQueryData(other.queryKey), undefined, 'The failed Live read is never placeholder data for another world');
    source.context.scopeKey = sameScope;
    available = true; const refreshed = await read.observer.refetch();
    assert.equal(refreshed.status, 'success'); assert.equal(refreshed.error, null); assert.equal(refreshed.data, saved); assert.equal(calls, 2);
  } finally { read.stop(); client.clear(); }
});

test('a deliberate route re-entry can recover the settled initial failure rather than remaining stuck on an old error', async () => {
  let available = false, calls = 0;
  const source = hook(async () => { calls++; if (!available) throw new ApiConnectionError('Offline'); return { current: true }; });
  const options = source.options(undefined, { refetchInterval: false }), client = source.client; client.setDefaultOptions({ queries: { gcTime: Infinity } });
  const first = observed(client, options);
  try {
    await settled(first.observer); assert.equal(calls, 2); first.stop(); available = true;
    const returned = observed(client, options);
    try { assert.equal((await settled(returned.observer)).status, 'success'); assert.equal(calls, 3); }
    finally { returned.stop(); }
  } finally { first.stop(); client.clear(); }
});

test('native foreground starts a fresh bounded recovery and explicit polling/focus/session gates stay intact', async () => {
  let available = false, calls = 0;
  const source = hook(async () => { calls++; if (!available) throw new ApiConnectionError('Offline'); return { current: true }; });
  const options = source.options(undefined, { refetchInterval: false, staleTime: 25_000 });
  assert.equal(options.staleTime, 25_000); assert.equal(options.refetchInterval({ state: { status: 'success' } }), false);
  assert.equal(source.options().refetchInterval({ state: { status: 'success' } }), 60_000);
  const client = source.client; client.mount(); const read = observed(client, options);
  try {
    await settled(read.observer); assert.equal(calls, 2);
    focusManager.setFocused(false); available = true; focusManager.setFocused(true); await wait(0);
    assert.equal((await settled(read.observer)).status, 'success'); assert.equal(calls, 3);
    source.context.focused = false; assert.equal(source.options().enabled, false);
    source.context.focused = true; source.context.status = 'anonymous'; assert.equal(source.options().enabled, false);
    source.context.status = 'authenticated'; source.context.environment.unavailable = true;
    assert.equal(source.options('/api/v1/gate/schools/campus/visit-arrangements/').enabled, false);
  } finally { read.stop(); client.unmount(); client.clear(); focusManager.setFocused(undefined); }
});
