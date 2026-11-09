import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as authoring from '../src/lib/assessment-authoring';
import * as temporal from '../src/lib/browser-temporal';
import type { NativePendingInput } from '../src/lib/native-pending-action';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { createRoot } = require('react-dom/client');
const source = readFileSync(new URL('../src/features/AssessmentAuthoringScreen.tsx', import.meta.url), 'utf8');
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const [school, term, cycle, subject, offering, examiner, moderator, room] = Array.from({ length: 8 }, (_, index) => id(index + 1));
const classSection = id(9), classSubject = id(10);
const now = '2026-11-01T10:00:00.000Z', scheduled = '2026-11-12T10:00:00.000Z';
const dates = { starts_on: '2026-11-01', ends_on: '2026-11-30' };
const workspace = {
  mode: 'admin', assessments: [], cycles: [{ id: cycle, term_id: term, name: 'Semester examinations', academic_year: '2026', ...dates }],
  references: {
    classes: [{ id: classSection, name: 'Year 2 A', academic_year: '2026' }], subjects: [{ id: classSubject, name: 'Mathematics' }],
    terms: [{ id: term, ...dates }], spaces: [{ id: room, name: 'East Examination Hall', capacity: 40 }],
    staff: [{ id: examiner, first_name: 'Ananya', last_name: 'Sen' }, { id: moderator, first_name: 'Kabir', last_name: 'Bose' }],
    offerings: [{ id: offering, name: 'Distributed Systems', learner_count: 24, academic_context: { term_id: term, subject_id: subject, course_code: 'CS511', ...dates } }],
  },
};

test('mounted assessment editor independently reviews and creates physical course and class assessments in one workspace', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const sent: NativePendingInput[] = [], inputs = new Map<string, (value: string) => void>();
  const Box = ({ children }: any) => React.createElement('div', null, children);
  const TitledBox = ({ children, title }: any) => React.createElement('section', null, title, children);
  const Button = ({ title, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, title);
  const Input = ({ label, value, onChange, onChangeText, options }: any) => {
    inputs.set(label, onChangeText ?? onChange);
    return React.createElement('label', null, label, value, options?.map((option: any) => React.createElement('span', { key: option.value }, option.label)));
  };
  const dependencies: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Text: Box, View: Box, Switch: ({ accessibilityLabel, value, onValueChange }: any) => React.createElement('button', { onClick: () => onValueChange(!value) }, accessibilityLabel) },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    '../../../packages/contracts/src/workspace-normalizer': { normalizeWorkspaceManifest: () => ({ context: { time_zone: 'Asia/Kolkata' } }), assertWorkspaceManifestContext() {} },
    '../auth/SessionProvider': { useSession: () => ({ user: { id: examiner }, schoolId: school, scopeKey: 'live', environment: { mode: 'live', virtual_clock: { now } } }) },
    '../lib/api': { getApiOrigin: () => 'https://campus.example' },
    '../lib/query': { useApi: (path: string | null) => ({ data: path?.includes('/assessments/') ? workspace : path ? {} : undefined, isPending: false }) },
    '../lib/native-pending-action': { useNativePendingAction: () => ({ ready: true, run: async (input: NativePendingInput) => { sent.push(input); } }) },
    '../lib/use-operation-context': { useOperationContext: () => () => () => {} },
    '../lib/assessment-authoring': authoring,
    '../lib/browser-temporal': temporal,
    '../ui/BackNavigation': { ScreenBack: () => null, useCampusNavigation: () => ({}), useScreenExitGuard() {} },
    '../ui/components': { Button, Page: TitledBox, Section: TitledBox, Field: Input, Notice: ({ message }: any) => React.createElement('p', null, message), Row: TitledBox },
    '../ui/DomainControls': { ControlButton: Button, Disclosure: TitledBox, ChoiceMenu: Input, Facts: ({ items }: any) => React.createElement('dl', null, items.map((item: any) => React.createElement('div', { key: item.label }, item.label, ' ', item.value))) },
    '../ui/TemporalField': { TemporalField: Input },
    '../ui/theme': { useTheme: () => ({ colors: { ink: '#111' } }) },
  };
  const exports: Record<string, React.ComponentType<any>> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Error, URLSearchParams, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const text = () => dom.window.document.body.textContent ?? '';
  const href = '/areas/assessments/manage?create=assessment';
  const openPlan = (key: string, target = href) => act(async () => renderer.render(React.createElement(exports.AssessmentAuthoringScreen!, { key, href: target, schoolId: school, mode: 'assessment' })));
  const enter = (label: string, value: string) => act(async () => { assert.ok(inputs.has(label), label); inputs.get(label)!(value); });
  const click = (title: string) => act(async () => {
    const button = [...dom.window.document.querySelectorAll('button')].find(value => value.textContent === title);
    assert.ok(button, title);
    button.click();
  });
  try {
    await openPlan('direct-course', `${href}&offering_id=${offering}`);
    assert.match(text(), /Distributed Systems.*register uses enrollment/s);
    await enter('Assessment type', 'exam');
    assert.match(text(), /candidate list uses enrollment on the exam date and is frozen when you schedule/);
    await enter('Title', 'Distributed systems final');
    await enter('Date and time · Asia/Kolkata', scheduled);
    await click('Review assessment');
    assert.match(text(), /future examination time.*current bookable space/);
    await enter('Room or hall', room!);
    await click('Review assessment');
    assert.match(text(), /Choose between 1 and 20 distinct current invigilators/);
    await click('Invigilator: Ananya Sen');
    await click('Review assessment');
    assert.match(text(), /Review before saving.*Course Distributed Systems.*East Examination Hall.*Invigilators.*Ananya Sen.*confirm their duties/s);
    assert.equal(sent.length, 0);
    await click('Create assessment');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.serverKey, 'idempotency_key');
    assert.equal(sent[0]?.replayPolicy, 'same_request');
    assert.equal(sent[0]?.body?.offering_id, offering);
    assert.equal(sent[0]?.body?.class_section_id, null);
    assert.equal(sent[0]?.body?.space_id, room);
    assert.equal(sent[0]?.body?.scheduled_at, scheduled);
    assert.deepEqual(sent[0]?.body?.invigilator_user_ids, [examiner]);

    for (const kind of ['exam', 'practical', 'viva']) {
      for (const participants of ['class', 'course']) {
        await openPlan(`${participants}-${kind}`);
        // Switch in both directions so an earlier participant selector cannot leak into this plan.
        await enter('Participants', participants === 'class' ? 'course' : 'class');
        await enter('Participants', participants);
        await enter('Assessment type', kind);
        await enter('Title', `${participants} ${kind}`);
        await enter('Date and time · Asia/Kolkata', scheduled);
        await enter('Room or hall', room!);
        await click('Invigilator: Ananya Sen');
        const beforeReview: number = sent.length;
        await click('Review assessment');
        assert.match(text(), /Review before saving/);
        assert.equal(sent.length, beforeReview);
        await click('Create assessment');
        assert.equal(sent.length, beforeReview + 1);
        const submission = sent.at(-1)!;
        assert.equal(submission.body?.assessment_kind, kind);
        assert.equal(submission.body?.space_id, room);
        assert.deepEqual(submission.body?.invigilator_user_ids, [examiner]);
        if (participants === 'course') {
          assert.equal(submission.body?.context_kind, 'learning_offering');
          assert.equal(submission.body?.offering_id, offering);
          assert.equal(submission.body?.class_section_id, null);
          assert.equal(submission.body?.subject_id, subject);
          assert.equal(submission.replayPolicy, 'same_request');
        } else {
          assert.equal(submission.body?.context_kind, undefined);
          assert.equal(submission.body?.offering_id, undefined);
          assert.equal(submission.body?.class_section_id, classSection);
          assert.equal(submission.body?.subject_id, classSubject);
          assert.equal(submission.replayPolicy, 'inspect_only');
        }
      }
    }
  } finally {
    await act(async () => renderer.unmount());
    Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false });
    dom.window.close();
  }
});
