import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { ApiError } from '../src/lib/api-client';
import { NativePendingActionJournal, type NativePendingAction } from '../src/lib/native-pending-action';

const require = createRequire(import.meta.url), id = '10000000-0000-4000-8000-000000000001', learner = '10000000-0000-4000-8000-000000000002';
type Button = { title: string; onPress(): void; disabled?: boolean };
async function mounted(mode: 'group_manage' | 'course_setup', retained: boolean, work: (h: { text(): string; change(value: string): Promise<void>;
  field(value: string): Promise<void>; press(title: string): Promise<void>; reason(): string | undefined; raw(): string | null; original: string | null; clears(): number }) => Promise<void>) {
  const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="root"></div>'), prior = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const href = `/areas/messages/assignments?scope=offering&offering_id=${id}&${mode}=1`;
  const scope = { actorId: 'actor', schoolId: 'campus', mode: 'live' as const, namespaceId: null, origin: 'https://campus.example' };
  const action: NativePendingAction = { version: 1, domain: 'learning', scope, ownerHref: href, endpoint: `/api/v1/learning/offerings/${id}/enrollments/`,
    refreshPath: `/api/v1/learning/offerings/${id}/`, method: 'POST', clientId: randomUUID(), phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-11-08T12:00:00Z',
    source: { kind: 'offering', sourceId: id, revision: 1 }, payload: { kind: 'json', body: '{}' } };
  action.payload = { kind: 'json', body: JSON.stringify({ command_id: action.clientId, expected_revision: 1, participants: [{ id: learner, expected_revision: 1 }], starts_on: '2026-11-08' }) };
  let raw = retained ? JSON.stringify(action) : null, clears = 0; const original = raw;
  const journal = new NativePendingActionJournal({ scope, domain: 'learning', randomId: randomUUID, storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { clears++; raw = null; } },
    send: async () => { throw new Error('No write expected'); }, read: async () => { throw new Error('No recovery expected'); } });
  await journal.hydrate(); if (retained) assert.equal(journal.snapshot().action?.phase, 'unknown');
  let phase = 'ready', reason: string | undefined; const buttons = new Map<string, Button>();
  const data = { id, name: 'PRIVATE-GROUP-NAME', revision: 1, can_manage: true, current_instructor: null, today: '2026-11-08', timezone: 'UTC',
    enrollment_change_mode: 'initial_setup', academic_context: null, enrollments: [{ id: 'record-one', person_id: learner, name: 'PRIVATE-ROSTER-PERSON', revision: 1, starts_on: '2026-11-01' }] };
  const Box = ({ children, title, message }: React.PropsWithChildren<{ title?: string; message?: string }>) => React.createElement('section', null, title, message, children);
  const Control = (button: Button) => { buttons.set(button.title, button); return React.createElement('button', { disabled: button.disabled, onClick: button.onPress }, button.title); };
  const writer = () => ({ action: journal.snapshot().action, locked: Boolean(journal.snapshot().action), busy: false, run() { throw new Error('Unexpected write'); }, recover() {}, reviewed() {} });
  const dependencies = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: Box }, 'expo-crypto': { randomUUID },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData() {} }) },
    '../auth/SessionProvider': { useSession: () => ({ schoolId: 'campus', scopeKey: 'live:actor:campus' }) }, '../lib/api': { apiFetch() { throw new Error('Unexpected API request'); }, captureApiContext: () => ({ assertCurrent() {} }) },
    '../lib/query': { useApi: (path: string | null) => path?.includes(`/offerings/${id}/`) ? { data: phase === 'no_manage' ? { ...data, can_manage: false, enrollments: [] } : data,
      isPending: false, isError: phase === 'denied' || phase === 'transient', error: phase === 'denied' ? new ApiError('Current access ended', 403) : phase === 'transient' ? new ApiError('Temporary server error', 503) : undefined,
      refetch: async () => ({ data }) } : { data: { academic_references: {} }, isPending: false, isError: false } },
    '../lib/learning-write': { useLearningCommand: writer }, '../lib/use-people-create': { usePeopleCreate: () => ({ writer: { action: null } }) },
    '../lib/learning-offering-policy': require('../src/lib/learning-offering-policy'), '../lib/learning-academic-context': require('../src/lib/learning-academic-context'),
    '../ui/BackNavigation': { ScreenBack: () => null, useCampusNavigation: () => ({}), useScreenExitGuard() {} }, '../ui/TemporalField': { TemporalField: Box },
    '../ui/components': { Page: Box, Section: Box, Row: Box, Empty: Box, Loading: Box, Notice: Box, ListGroup: Box, SearchField: Box, Button: Control,
      Field: ({ label, value, onChangeText }: {label:string;value:string;onChangeText(value:string):void}) => { if (label === 'Reason') reason = value;
        return React.createElement('input', { 'data-reason': label === 'Reason', value, onChange: event => onChangeText(event.currentTarget.value) }); } },
    '../ui/DomainControls': { ControlButton: Control, Disclosure: Box, Facts: Box, InfoDisclosure: Box }, './PeopleScreen': { NativePeopleCreate: Box, NativePeopleBulkCreate: Box },
    './LearningCourseContext': { CourseContextFields: Box, CourseContextFacts: Box, LearningCourseContext: ({ data: current }: {data?:typeof data}) => React.createElement('p', null, current?.name) },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/features/LearningOfferings.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: Record<string, unknown> = {}; runInNewContext(source, { exports, URL, URLSearchParams, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key as keyof typeof dependencies]; } });
  const Screen = exports.LearningOfferingPanel as React.ComponentType<{id:string;href:string;onNavigate():void}>;
  const { createRoot } = require('react-dom/client'), root = createRoot(dom.window.document.getElementById('root'));
  const render = async () => { buttons.clear(); await act(async () => root.render(React.createElement(Screen, { id, href, onNavigate() {} }))); };
  try { await render(); await work({ text: () => dom.window.document.body.textContent ?? '', change: async value => { phase = value; await render(); },
    press: async title => { assert.ok(buttons.has(title), title); await act(async () => buttons.get(title)!.onPress()); },
    field: async value => { const input = dom.window.document.querySelector('[data-reason="true"]') as HTMLInputElement; assert.ok(input);
      const key = Object.keys(input).find(key => key.startsWith('__reactProps')); assert.ok(key); const props = (input as unknown as Record<string,{onChange(event:unknown):void}>)[key]!;
      await act(async () => props.onChange({ currentTarget: { value } })); }, reason: () => reason, raw: () => raw, original, clears: () => clears });
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, prior); }
}

test('actual group/course parent removes retained private content on403 or lost management without deleting an unknown command', async () => {
  for (const mode of ['group_manage', 'course_setup'] as const) for (const loss of ['denied', 'no_manage']) await mounted(mode, true, async h => {
    assert.match(h.text(), /PRIVATE-GROUP-NAME/); await h.change(loss); assert.ok(!h.text().includes('PRIVATE-GROUP-NAME')); assert.ok(!h.text().includes('PRIVATE-ROSTER-PERSON'));
    assert.match(h.text(), /access/); assert.equal(h.raw(), h.original); assert.equal(h.clears(), 0);
  });
});

test('actual group management preserves an unsent reason during a transient failure', async () => {
  await mounted('group_manage', false, async h => { await h.press('End registration for PRIVATE-ROSTER-PERSON'); await h.field('Keep this unsent reviewed reason');
    await h.change('transient'); assert.equal(h.reason(), 'Keep this unsent reviewed reason'); assert.equal(h.clears(), 0); assert.equal(h.raw(), null); });
});
