import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as temporal from '../src/lib/browser-temporal';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const zone = 'America/New_York', original = '2026-03-07T17:00:00.000Z', minimumDate = new Date('2026-03-07T16:00:00.000Z');
async function mounted(platform: 'web' | 'ios' | 'android', run: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let input: any, picker: any;
  const exports: Record<string, React.ComponentType<any>> = {}, changed: string[] = [];
  const Box = ({ children }: any) => React.createElement('div', null, children);
  const ControlButton = ({ title, onPress }: any) => React.createElement('button', { onClick: onPress }, title);
  const dependencies: Record<string, unknown> = {
    react: { ...React, createElement: (type: string, props: any, ...children: React.ReactNode[]) => {
      if (type === 'input') input = props;
      return React.createElement(type, props, ...children);
    } },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: Box, Text: Box, Platform: { OS: platform } },
    '@react-native-community/datetimepicker': (props: any) => { picker = props; return null; },
    '../lib/browser-temporal': temporal,
    './DomainControls': { ControlButton }, './TemporalValueControl': { TemporalValueControl: () => null },
    './theme': { useTheme: () => ({ colors: {}, dark: false }) },
  };
  const file = platform === 'web' ? 'TemporalField.web.tsx' : 'TemporalField.tsx';
  const source = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Date, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  function Form() {
    const [value, setValue] = React.useState(original);
    return React.createElement(exports.TemporalField!, { label: 'Exam time', mode: 'datetime', timeZone: zone, value, minimumDate, onChange(next: string) { changed.push(next); setValue(next); } });
  }
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const h = {
    changed, input: () => input, picker: () => picker, text: () => dom.window.document.body.textContent,
    select: (instant: string) => act(async () => picker.onValueChange({}, new Date(instant))),
    enter: (value: string) => act(async () => input.onChange({ target: { value } })),
    click: (title: string) => act(async () => {
      const button = [...dom.window.document.querySelectorAll('button')].find(value => value.textContent?.startsWith(title));
      assert.ok(button, title);
      button.click();
    }),
  };
  try { await act(async () => renderer.render(React.createElement(Form))); await run(h); }
  finally { await act(async () => renderer.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('web campus datetime clears stale values on DST rejection and preserves the input for correction', async () => mounted('web', async h => {
  assert.equal(h.input().value, '2026-03-07T12:00:00');
  assert.equal(h.input().min, '2026-03-07T11:00:00');
  await h.enter('2026-03-08T02:30');
  assert.deepEqual(h.changed, ['']);
  assert.equal(h.input().value, '2026-03-08T02:30');
  assert.match(h.text(), /occurs once in the campus time zone/);
  await h.enter('2026-11-01T01:30');
  assert.deepEqual(h.changed, ['', '']);
  await h.enter('2026-03-08T03:30');
  assert.equal(h.changed.at(-1), '2026-03-08T07:30:00.000Z');
}));

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} campus datetime preserves chosen wall digits across native picker events`, async () => mounted(platform, async h => {
    await h.click('Exam time');
    assert.equal(h.picker().timeZoneName, zone);
    assert.equal(h.picker().minimumDate, platform === 'ios' ? minimumDate : undefined);
    await h.select('2026-03-08T16:00:00.000Z');
    if (platform === 'ios') await h.click('Choose time');
    assert.equal(h.picker().timeZoneName, 'UTC');
    await h.select('2000-01-01T02:30:00.000Z');
    if (platform === 'ios') await h.click('Done');
    assert.deepEqual(h.changed, ['']);
    assert.match(h.text(), /occurs once in the campus time zone/);
    if (platform === 'android') {
      await h.click('Exam time');
      await h.select('2026-03-08T16:00:00.000Z');
    }
    await h.select('2000-01-01T03:30:00.000Z');
    if (platform === 'ios') await h.click('Done');
    assert.equal(h.changed.at(-1), '2026-03-08T07:30:00.000Z');
  }));
}
