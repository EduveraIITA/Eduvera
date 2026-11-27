import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import ts from 'typescript';
import * as proposals from '../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import type { CampusMapReviewHint, CampusMapReviewHints } from '../src/features/campus/CampusMapAreaReview';
import * as a2ui from '../src/lib/campus-a2ui';

type ReviewProps = {
  assistance: { status: 'ai'; messages: unknown[] };
  document: CampusSceneDocument;
  disabled: boolean;
  initialHints?: CampusMapReviewHints;
  onFocus: (id: string) => void;
  onApply: (id: string, hint: CampusMapReviewHint) => void;
  onContinue: (hints: CampusMapReviewHints) => Promise<void>;
};

const element = (id: string, label: string): CampusSceneElement => ({
  id, label, kind: 'building', geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] },
  floor_id: null, space_id: null, review_state: 'needs_review',
});
const document: CampusSceneDocument = {
  schema_version: 1, name: 'Practice campus', bounds: { width: 100, height: 100, unit: 'metres' },
  source: { kind: 'open_map', label: 'OpenStreetMap' },
  elements: [element('main', 'Main hall'), element('library', 'Library'), element('annex', 'Annex')],
};
const assistance: ReviewProps['assistance'] = { status: 'ai', messages: [{
  version: '1.0',
  createSurface: {
    surfaceId: 'suggested-campuses', catalogId: a2ui.CAMPUS_A2UI_BASIC_CATALOG,
    dataModel: { hints: { library: { label: 'Library', kind: ['library'] } } },
    components: [
      { id: 'root', component: 'Column', children: ['library_question', 'library_focus'] },
      { id: 'library_question', component: 'Text', text: 'Is this the campus library?' },
      { id: 'library_focus', component: 'Button', child: 'focus_label', action: { event: { name: 'focus_feature', context: { feature_id: 'library' } } } },
      { id: 'focus_label', component: 'Text', text: 'Show on map' },
    ],
  },
}] };

function loadReview() {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const { createRoot } = require('react-dom/client');
  const Box = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const Button = ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => React.createElement('button', { onClick: onPress, disabled }, title);
  const Surface = ({ messages, disabled, onAction }: { messages: unknown[]; disabled?: boolean; onAction: (message: a2ui.CampusA2uiActionMessage) => void }) => {
    const [surface] = a2ui.readCampusA2uiSurfaces(messages)!;
    const answer = () => onAction(a2ui.campusA2uiAction(surface.id, surface.components.get('apply')!, surface.model)!);
    return React.createElement(React.Fragment, null,
      React.createElement('p', null, a2ui.a2uiText(surface.components.get('question')!.text, surface.model)),
      React.createElement(Button, { title: a2ui.a2uiText(surface.components.get('apply-label')!.text, surface.model), onPress: answer, disabled }));
  };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: Box, Text: Box, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
      Pressable: ({ accessibilityLabel, disabled, onPress }: { accessibilityLabel: string; disabled: boolean; onPress: () => void }) =>
        React.createElement(Button, { title: accessibilityLabel, disabled, onPress }),
    },
    '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals': proposals,
    '../../lib/campus-a2ui': a2ui,
    '../../ui/components': { Button, Notice: ({ message }: { message: string }) => React.createElement('p', null, message) },
    '../../ui/DomainControls': { ControlButton: Button },
    '../../ui/Icon': { Icon: () => null },
    '../../ui/theme': { useTheme: () => ({ colors: {} }) },
    './CampusA2uiSurface': { CampusA2uiSurface: Surface },
  };
  const exports = {} as {
    CampusMapAreaReview: React.ComponentType<ReviewProps>;
    canGuideCampusFacilities: typeof import('../src/features/campus/CampusMapAreaReview').canGuideCampusFacilities;
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/features/campus/CampusMapAreaReview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { exports, Error, require: (name: string) => dependencies[name] });
  return { Review: exports.CampusMapAreaReview, canGuide: exports.canGuideCampusFacilities, JSDOM, createRoot };
}

test('facility guidance is available for actionable places or an unsaved confirmation', () => {
  const { canGuide } = loadReview();
  assert.equal(canGuide(assistance, document), true);
  assert.equal(canGuide(assistance, {
    ...document, elements: [{ ...element('library', 'Lake'), kind: 'surface', asset_key: 'water' }],
  }), false);
  assert.equal(canGuide(assistance, { ...document, elements: [element('library', 'Library')] }, {
    library: { label: 'Library', kind: ['library'] },
  }), true);
});

test('guided A2UI focuses one place, resumes confirmed answers and retries the same cumulative save', async () => {
  const { Review, JSDOM, createRoot } = loadReview();
  const dom = new JSDOM('<div id="root"></div>');
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = { window: globals.window, document: globals.document, IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container: HTMLElement = dom.window.document.getElementById('root');
  const renderer = createRoot(container);
  const focused: string[] = [];
  const applied: string[] = [];
  const attempted: CampusMapReviewHints[] = [];
  const initialHints: CampusMapReviewHints = { main: { label: 'Main hall', kind: ['building'] } };
  const click = async (title: string) => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === title);
    assert.ok(button, `Could not find ${title}`);
    await act(async () => button.click());
  };
  try {
    await act(async () => renderer.render(React.createElement(Review, {
      assistance, document, disabled: false, initialHints,
      onFocus: id => focused.push(id),
      onApply: id => applied.push(id),
      onContinue: async hints => {
        attempted.push(hints);
        if (attempted.length === 1) throw new Error('Check your connection and retry.');
      },
    })));
    assert.deepEqual(focused, ['library']);
    assert.match(container.textContent!, /Place 1 of 2.*Is this the campus library\?/);
    await click('Apply and next');
    assert.deepEqual(applied, ['library']);
    assert.deepEqual(focused, ['library', 'annex']);
    assert.match(container.textContent!, /Place 2 of 2/);
    assert.equal(attempted.length, 0);
    await click('Save facilities');
    assert.match(container.textContent!, /Check your connection and retry/);
    assert.deepEqual(applied, ['library', 'annex']);
    await click('Save facilities');
    assert.deepEqual(applied, ['library', 'annex']);
    assert.deepEqual(JSON.parse(JSON.stringify(attempted)), [
      { main: initialHints.main, library: { label: 'Library', kind: ['library'] }, annex: { label: 'Annex', kind: ['building'] } },
      { main: initialHints.main, library: { label: 'Library', kind: ['library'] }, annex: { label: 'Annex', kind: ['building'] } },
    ]);
  } finally {
    await act(async () => renderer.unmount());
    Object.assign(globals, previous);
    dom.window.close();
  }
});
