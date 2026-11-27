import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import ts from 'typescript';
import * as places from '../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import * as a2ui from '../src/lib/campus-a2ui';

type Counselor = typeof import('../src/features/campus/CampusIndoorCounselor').CampusIndoorCounselor;
type CounselorProps = React.ComponentProps<Counselor>;
type ButtonProps = { title: string; disabled?: boolean; onPress: () => void };

function loadCounselor() {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const { createRoot } = require('react-dom/client');
  const Box = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const Button = ({ title, disabled, onPress }: ButtonProps) => React.createElement('button', { disabled, onClick: onPress }, title);
  const Surface = ({ messages, disabled, onValueChange, onAction }: {
    messages: unknown[]; disabled?: boolean; onValueChange: (path: string, value: string) => void;
    onAction: (message: a2ui.CampusA2uiActionMessage) => void;
  }) => {
    const [surface] = a2ui.readCampusA2uiSurfaces(messages)!;
    const input = surface.components.get('answer')!;
    assert.equal(input.variant, 'longText');
    const answer = a2ui.a2uiText(input.value, surface.model);
    return React.createElement(React.Fragment, null,
      React.createElement('textarea', { value: answer, disabled, onInput: (event: React.SyntheticEvent<HTMLTextAreaElement>) => onValueChange('/answer', event.currentTarget.value) }),
      ...['continue', 'skip'].flatMap(id => {
        const control = surface.components.get(id);
        if (!control) return [];
        return React.createElement(Button, { key: id, disabled,
          title: a2ui.a2uiText(surface.components.get(id + '-label')?.text, surface.model),
          onPress: () => onAction(a2ui.campusA2uiAction(surface.id, control, surface.model)!),
        });
      }));
  };
  const deps: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: Box, Text: Box, StyleSheet: { create: (styles: unknown) => styles } },
    '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals': places,
    '../../lib/campus-a2ui': a2ui,
    '../../ui/components': { Button, Field: () => null, Notice: Box },
    '../../ui/DomainControls': { ControlButton: Button, ChoiceMenu: () => null, Disclosure: Box },
    '../../ui/theme': { useTheme: () => ({ colors: {} }) },
    './CampusA2uiSurface': { CampusA2uiSurface: Surface },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/features/campus/CampusIndoorCounselor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as { CampusIndoorCounselor: Counselor };
  runInNewContext(source, { exports, Error, require: (name: string) => deps[name] });
  return { Counselor: exports.CampusIndoorCounselor, JSDOM, createRoot };
}

test('indoor guidance resumes a draft answer, forwards optional actions and waits for a map placement', async () => {
  const { Counselor, JSDOM, createRoot } = loadCounselor();
  const dom = new JSDOM('<div id="root"></div>');
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = { window: globals.window, document: globals.document, IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container: HTMLElement = dom.window.document.getElementById('root');
  const renderer = createRoot(container);
  const answers: string[] = [];
  const changes: string[] = [];
  const pins: (NonNullable<CounselorProps['activePin']> | null)[] = [];
  let skipped = 0;
  let paused = 0;
  const props: CounselorProps = {
    floorName: 'First floor', answer: 'Two classrooms',
    onAnswerChange: answer => { changes.push(answer); },
    onAnswer: answer => { answers.push(answer); },
    onSkipPrompt: () => { skipped++; },
    prompt: { id: 'rooms', question: 'What is on this floor?', optional: true },
    rooms: [], onEditRoom() {}, onPin: pin => { pins.push(pin); }, canSave: false, onSave() {}, onPause: () => { paused++; },
  };
  const render = () => act(async () => renderer.render(React.createElement(Counselor, props)));
  const button = (title: string) => {
    const control = [...container.querySelectorAll('button')].find(node => node.textContent === title);
    assert.ok(control, `Could not find ${title}`);
    return control;
  };
  try {
    await render();
    const field = container.querySelector('textarea')!;
    assert.equal(field.value, props.answer);
    const edited = 'Two classrooms and one lab';
    await act(async () => {
      field.value = edited;
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(changes, [edited]);
    props.answer = edited;
    await render();
    await act(async () => button('Review description').click());
    assert.deepEqual(answers, [edited]);
    await act(async () => button('Skip this question').click());
    assert.equal(skipped, 1);
    await act(async () => button('Pause indoor setup').click());
    assert.equal(paused, 1);

    props.prompt = undefined;
    props.rooms = [{ id: 'lab', name: 'Lab', kind: 'laboratory', items: [] }];
    await render();
    assert.equal(button('Save floor draft').disabled, true);
    await act(async () => button('Place room on floor').click());
    assert.equal(pins[0]?.roomId, 'lab');
    props.activePin = pins[0];
    await render();
    assert.match(container.textContent!, /Place Lab.*Tap its location on the floor map/);
    assert.equal(container.querySelector('textarea'), null);
    await act(async () => button('Cancel placement').click());
    assert.equal(pins.at(-1), null);

    props.activePin = null;
    props.rooms = [{ id: 'lab', name: 'Lab', kind: 'laboratory', pinned: true,
      items: [{ id: 'books', name: 'Books', quantity: 30 }] }];
    await render();
    await act(async () => button('Place as one group').click());
    assert.equal(pins.at(-1)?.individually, undefined);
    await act(async () => button('Place each item individually').click());
    assert.equal(pins.at(-1)?.individually, true);
  } finally {
    await act(async () => renderer.unmount());
    Object.assign(globals, previous);
    dom.window.close();
  }
});
