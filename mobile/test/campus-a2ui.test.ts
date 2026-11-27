import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import ts from 'typescript';
import * as a2ui from '../src/lib/campus-a2ui';
import {
  a2uiBindingPath, a2uiText, campusA2uiAction, readCampusA2uiSurfaces, writeA2uiValue,
} from '../src/lib/campus-a2ui';

const campusId = 'campus-place-review';
const catalogId = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const version = '1.0';
const start = { version, createSurface: { surfaceId: campusId, catalogId } };
const components = [
  { id: 'root', component: 'Column', children: ['title', 'name', 'type', 'continue'] },
  { id: 'title', component: 'Text', text: '## Which place is this?' },
  { id: 'name', component: 'TextField', label: 'Suggested name', value: { '@path': '/hints/building~11/label' } },
  { id: 'type', component: 'ChoicePicker', label: 'Place type', value: { '@path': '/hints/building~11/kind' }, options: [{ label: 'Building', value: 'building' }, { label: 'Hostel', value: 'hostel' }] },
  { id: 'continue', component: 'Button', child: 'continue-label', variant: 'primary',
    action: { event: { name: 'review_places', context: { hints: { '@path': '/hints' } } } } },
  { id: 'continue-label', component: 'Text', text: 'Review campus places' },
];
const dataModel = { hints: { 'building/1': { label: 'North building', kind: ['building'] } }, temporary: true };
const initial = { version, createSurface: { ...start.createSurface, components, dataModel } };
const fixedTime = '2026-11-27T12:00:00.000Z';

test('A2UI map review sends a v1.0 user action with the edited label and current choice', () => {
  const [surface] = readCampusA2uiSurfaces([initial])!;
  const name = surface.components.get('name')!;
  const choice = surface.components.get('type')!;
  const button = surface.components.get('continue')!;
  assert.equal(a2uiText(name.value, surface.model), 'North building');

  const edited = writeA2uiValue(surface.model, a2uiBindingPath(name.value), 'North Residence');
  const chosen = writeA2uiValue(edited, a2uiBindingPath(choice.value), ['hostel']);
  assert.deepEqual(campusA2uiAction(surface.id, button, chosen, fixedTime), {
    version,
    action: {
      name: 'review_places', surfaceId: campusId, sourceComponentId: 'continue', timestamp: fixedTime,
      context: { hints: { 'building/1': { label: 'North Residence', kind: ['hostel'] } } },
    },
  });
  assert.equal(a2uiText(name.value, surface.model), 'North building');
});

test('A2UI map review applies ordered component and data-model updates within a surface', () => {
  const updates = [
    start,
    { version, updateComponents: { surfaceId: campusId, components } },
    { version, updateDataModel: { surfaceId: campusId, value: dataModel } },
    { version, updateComponents: { surfaceId: campusId, components: [{ id: 'title', component: 'Text', text: { '@path': '/hints/building~11/label' } }] } },
    { version, updateDataModel: { surfaceId: campusId, path: '/hints/building~11/label', value: 'Library' } },
    { version, updateDataModel: { surfaceId: campusId, path: '/temporary', value: null } },
  ];
  const [surface] = readCampusA2uiSurfaces(updates)!;
  assert.equal(a2uiText(surface.components.get('title')?.text, surface.model), 'Library');
  assert.equal(Object.hasOwn(surface.model, 'temporary'), false);
  assert.deepEqual(readCampusA2uiSurfaces([...updates, { version, deleteSurface: { surfaceId: campusId } }]), []);
});

test('A2UI map review rejects inactive catalogs, recursive trees, functions and unauthorized actions', () => {
  assert.equal(readCampusA2uiSurfaces([{ ...initial, createSurface: { ...initial.createSurface, catalogId: 'custom:catalog' } }]), undefined);
  assert.equal(readCampusA2uiSurfaces([
    initial, { version, updateComponents: { surfaceId: campusId, components: [{ id: 'root', component: 'Column', children: ['root'] }] } },
  ]), undefined);
  assert.equal(readCampusA2uiSurfaces([initial, { version, callRendererFunction: { callFunction: { '@call': 'openUrl' } } }]), undefined);
  assert.equal(readCampusA2uiSurfaces([
    initial, { version, updateDataModel: { surfaceId: campusId, path: '/__proto__/unknown', value: true } },
  ]), undefined);

  const [surface] = readCampusA2uiSurfaces([initial])!;
  const button = surface.components.get('continue')!;
  assert.equal(campusA2uiAction(surface.id, { ...button, action: { event: { name: 'publish' } } }, surface.model), undefined);
  assert.equal(campusA2uiAction(surface.id, {
    ...button, action: { event: { name: 'review_places', context: { hint: { '@call': 'openUrl' } } } },
  }, surface.model), undefined);
});

test('the mounted review renders a heading and forwards the edited controls on Continue', async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const { createRoot } = require('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = { window: globals.window, document: globals.document, IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container: HTMLElement = dom.window.document.getElementById('root');
  const renderer = createRoot(container);
  const source = ts.transpileModule(readFileSync(new URL('../src/features/campus/CampusA2uiSurface.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Button = ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled: boolean }) =>
    React.createElement('button', { onClick: onPress, disabled }, title);
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), '../../lib/campus-a2ui': a2ui,
    'react-native': {
      View: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
      Text: ({ children, accessibilityRole, 'aria-level': headingLevel }: React.PropsWithChildren<{ accessibilityRole?: string; 'aria-level'?: number }>) =>
        React.createElement(accessibilityRole === 'header' ? 'h' + headingLevel : 'span', null, children),
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    },
    '../../ui/theme': { useTheme: () => ({ colors: {} }) },
    '../../ui/components': {
      Button,
      Field: ({ label, value, onChangeText, editable }: { label: string; value: string; onChangeText: (next: string) => void; editable: boolean }) =>
        React.createElement('input', { 'aria-label': label, value, onInput: (event: React.SyntheticEvent<HTMLInputElement>) => onChangeText(event.currentTarget.value), disabled: !editable }),
    },
    '../../ui/DomainControls': {
      ControlButton: Button,
      ChoiceMenu: ({ label, value, onChange, options }: { label: string; value: string; onChange: (next: string) => void; options: { value: string; label: string }[] }) =>
        React.createElement('select', { 'aria-label': label, value, onInput: (event: React.SyntheticEvent<HTMLSelectElement>) => onChange(event.currentTarget.value) },
          options.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
    },
  };
  type SurfaceProps = { messages: readonly unknown[]; onAction: (action: a2ui.CampusA2uiActionMessage) => void };
  const exports = {} as { CampusA2uiSurface: React.ComponentType<SurfaceProps> };
  const actions: a2ui.CampusA2uiActionMessage[] = [];
  try {
    runInNewContext(source, { exports, require: (name: string) => dependencies[name] });
    await act(async () => renderer.render(React.createElement(exports.CampusA2uiSurface, { messages: [initial], onAction: action => actions.push(action) })));
    assert.equal(container.querySelector('h2')?.textContent, 'Which place is this?');
    const input = container.querySelector('input[aria-label="Suggested name"]') as HTMLInputElement;
    const select = container.querySelector('select[aria-label="Place type"]') as HTMLSelectElement;
    await act(async () => {
      input.value = 'Residence'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      select.value = 'hostel'; select.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('button')?.click());
    assert.deepEqual(JSON.parse(JSON.stringify(actions.map(action => action.action.context))), [{ hints: { 'building/1': { label: 'Residence', kind: ['hostel'] } } }]);
  } finally {
    await act(async () => renderer.unmount());
    Object.assign(globals, previous);
    dom.window.close();
  }
});
