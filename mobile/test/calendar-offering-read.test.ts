import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import * as Query from '@tanstack/react-query';
import ts from 'typescript';
import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { nativeCalendarContributedDestination, nativeCalendarSourceScope, resolveNativeScheduleAccess } from '../src/lib/schedule-access';
import { loadNativeCalendarSource, nativeCalendarAssessmentEntries } from '../src/lib/native-calendar';
import { ApiError } from '../src/lib/api-client';

const require = createRequire(import.meta.url), from = '2026-11-01', until = '2026-11-30', person = 'person-one';
const course = { id: 'assessment-one', title: 'Distributed systems portfolio', scheduled_at: '2026-11-12T09:00:00Z', date: '2026-11-12',
  duration_minutes: 60, venue: 'Course studio', subject_name: 'Distributed systems', class_name: 'M.Tech distributed systems',
  context_kind: 'learning_offering' as const, offering_id: 'offering-one', subject_id: 'subject-one' };
function manifest(id = person, surface?: Partial<WorkspaceAreaSurface>): WorkspaceManifest {
  return { context: { institution_id: 'campus-one', actor_user_id: `actor-${id}`, time_zone: 'UTC' }, areas: [
    { key: 'calendar', href: '/areas/calendar', scopes: [], surfaces: [{ key: 'assigned', href: '/areas/calendar?surface=assigned', scopes: [{kind:'person',id}] }] },
    { key: 'assessments', href: '/areas/assessments', surfaces: [{ key: `results:mine:${id}`, href: `/areas/assessments/results?scope=mine&person_id=${id}`,
      scopes: [{ kind: 'person', id }], ...surface }] },
  ] } as unknown as WorkspaceManifest;
}
function scope(id = person) { const value = manifest(id); return nativeCalendarSourceScope(value, resolveNativeScheduleAccess(value, '/areas/calendar')!); }

test('canonical course dates use the independently contributed own-person read without fake student identity or staff detail', async () => {
  const selected = scope(); assert.equal(selected.personId, person); assert.equal(selected.studentId, undefined);
  const mixed = manifest(); (mixed.areas[1]!.surfaces as WorkspaceAreaSurface[]).push({key:'manage',href:'/areas/assessments/manage',scopes:[],label:'Manage',capabilities:[]});
  assert.equal(nativeCalendarSourceScope(mixed, resolveNativeScheduleAccess(mixed, '/areas/calendar')!).personId, person);
  const paths: string[] = [];
  const result = await loadNativeCalendarSource('assessments', selected, from, until, async <T,>(path: string) => {
    paths.push(path); const url = new URL(path, 'https://local.test');
    assert.equal(url.searchParams.get('academic_context'), 'offering_v1'); assert.equal(url.searchParams.get('person_id'), person);
    assert.equal(url.searchParams.has('student_id'), false);
    return { items: [{ ...course, instructions: 'PRIVATE-DRAFT-NOTE', marks: 88 }] } as T;
  });
  assert.equal(paths.length, 1); assert.equal(result.entries[0]?.summary, 'Distributed systems · M.Tech distributed systems');
  assert.equal(result.entries[0]?.href, undefined); assert.ok(!JSON.stringify(result).includes('PRIVATE-DRAFT-NOTE')); assert.ok(!JSON.stringify(result).includes('marks'));
  assert.throws(() => nativeCalendarAssessmentEntries([{ ...course, offering_id: null }], selected));
});

test('canonical contribution needs exact path, key and person scope; legacy family selectors remain separate', async () => {
  for (const patch of [{ scopes: [] }, { key: 'results:mine:foreign' }, { href: '/areas/assessments/results?scope=mine&person_id=foreign' },
    { href: '/areas/assessments/results?scope=mine&person_id=person-one&person_id=foreign' }, { href: 'https://foreign.test/areas/assessments/results?scope=mine&person_id=person-one' }]) {
    const value = manifest(person, patch); assert.equal(nativeCalendarContributedDestination(value, resolveNativeScheduleAccess(value, '/areas/calendar')!, 'assessments'), undefined);
  }
  const own = scope(); let reads = 0;
  await assert.rejects(loadNativeCalendarSource('assessments', { ...own, studentId: 'student-one' }, from, until, async <T,>() => { reads++; return {} as T; }));
  assert.equal(reads, 0);
  const family = { ...own, personId: undefined, studentId: 'student-one', assessmentHref: '/areas/assessments/results?scope=dependent&student_id=student-one' };
  await loadNativeCalendarSource('assessments', family, from, until, async <T,>(path: string) => {
    const query = new URL(path, 'https://local.test').searchParams; assert.equal(query.get('student_id'), 'student-one'); assert.equal(query.has('person_id'), false);
    return { items: [course] } as T;
  });
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function mounted(work: (h: { text(): string; deny(): Promise<void>; rebind(id: string, mode?: string): Promise<void>; pauseIdentity(): Promise<void>;
  paths: string[]; client: Query.QueryClient; flush(): Promise<void> }) => Promise<void>, pending?: ReturnType<typeof deferred<unknown>>) {
  const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="root"></div>');
  const prior = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let current = person, mode = 'live', epoch = 0, denial = false, status = 'authenticated'; const paths: string[] = [];
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const dependencies = { '@tanstack/react-query': Query, 'expo-router': { useIsFocused: () => true },
    '../../auth/SessionProvider': { useSession: () => ({ scopeKey: `${mode}:${current}`, user: { id: `actor-${current}` }, status, environment: { mode } }) },
    '../../lib/api': { ApiError, captureApiContext: () => { const at = epoch; return { assertCurrent() { if (at !== epoch) throw new Error('The initiating account or world changed.'); } }; },
      apiFetch: async <T,>(path: string) => { paths.push(path); const query = new URL(path, 'https://local.test').searchParams;
        if (path.includes('/assessments/calendar/')) { if (denial) throw new ApiError('Current course access ended', 403);
          if (pending && query.get('person_id') === person) return await pending.promise as T;
          return { items: [{ ...course, id: `assessment-${current}`, title: `Portfolio for ${current}` }] } as T; }
        if (path.includes('/calendar/days/')) return { results: [] } as T;
        return { items: [], page: 1, page_size: 20, total: 0, total_pages: 1, from, until } as T;
      } }, '../../lib/native-calendar': { loadNativeCalendarSource, nativeCalendarSourceLabels: { milestones: 'Dates', dates: 'Campus dates', assessments: 'Assessments' } } };
  const code = ts.transpileModule(readFileSync(new URL('../src/features/calendar/useNativeCampusCalendarSources.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {}; runInNewContext(code, { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key as keyof typeof dependencies]; } });
  const useSources = exports.useNativeCampusCalendarSources as (value: ReturnType<typeof scope>, start: string, end: string) => { entries: Array<{title:string}>; denied: boolean };
  function Probe() { const value = useSources(scope(current), from, until); return React.createElement('div', null, value.denied ? 'Current access unavailable' : value.entries.map(item => item.title).join(' | ')); }
  const { createRoot } = require('react-dom/client'), root = createRoot(dom.window.document.getElementById('root'));
  const render = async () => { await act(async () => root.render(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Probe)))); };
  const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };
  try { await render(); await flush(); await work({ text: () => dom.window.document.body.textContent ?? '', paths, client, flush,
    deny: async () => { denial = true; await act(async () => { await client.invalidateQueries(); }); await flush(); },
    rebind: async (id, nextMode = 'live') => { epoch++; current = id; mode = nextMode; await render(); await flush(); },
    pauseIdentity: async () => { status = 'loading'; await render(); },
  }); } finally { await act(async () => root.unmount()); client.clear(); dom.window.close(); Object.assign(globalThis, prior); }
}

test('actual Calendar query composition removes a cached assessment on current-authority denial and unresolved identity', async () => {
  await mounted(async h => { assert.match(h.text(), /Portfolio for person-one/); await h.deny(); assert.ok(!h.text().includes('Portfolio for person-one'));
    await h.pauseIdentity(); assert.match(h.text(), /Current access unavailable/); });
});

test('actual Calendar query keys and callback guards separate canonical person and selected world during a late response', async () => {
  const pending = deferred<unknown>();
  await mounted(async h => { await h.rebind('person-two', 'simulation'); assert.match(h.text(), /Portfolio for person-two/);
    pending.resolve({ items: [{ ...course, title: 'PRIVATE-OLD-ACCOUNT' }] }); await h.flush();
    assert.ok(!h.text().includes('PRIVATE-OLD-ACCOUNT'));
    assert.ok(h.paths.some(path => path.includes('person_id=person-one'))); assert.ok(h.paths.some(path => path.includes('person_id=person-two')));
    assert.ok(h.client.getQueryCache().getAll().filter(query => query.queryKey.includes('person-two')).some(query => query.queryKey.includes('simulation:person-two')));
  }, pending);
});
