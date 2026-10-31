import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { Activity, act, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
type Props = Record<string, any>;
function load(source: string, dependencies: Props = {}, globals: Props = {}) {
  const exports: Props = {}, compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, ...globals, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
function surfaceKey(platform: string) {
  return load(readFileSync(new URL('../src/features/campus/skia/useCampusSkiaSurfaceKey.ts', import.meta.url), 'utf8'), {
    react: React, 'react-native': { Platform: { OS: platform } },
  }).useCampusSkiaSurfaceKey as (projection: string) => string;
}
function viewApi() {
  const global: Props = {};
  const entry = require.resolve('react-native-skia/package.json');
  load(readFileSync(new URL('./src/specs/NativeSkiaModule.web.ts', `file://${entry}`), 'utf8'), {}, { global });
  return global.SkiaViewApi;
}
async function mounted(run: (container: HTMLElement, render: (value: React.ReactNode) => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as Props).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById('root')!, root = createRoot(container);
  try { await run(container, value => act(async () => root.render(value))); }
  finally { await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close(); }
}

test('installed Skia view API discards pictures submitted between Activity unregister and passive re-registration', () => {
  const api = viewApi(), id = api.allocateNativeId(), frames: string[] = [], view = { setPicture: (picture: string) => frames.push(picture) };
  api.registerView(String(id), view);
  api.unregisterView(String(id));
  api.setJsiProperty(id, 'picture', 'replacement');
  api.registerView(String(id), view);
  assert.deepEqual(frames, []);
  const fresh = api.allocateNativeId();
  api.setJsiProperty(fresh, 'picture', 'replacement');
  api.registerView(String(fresh), view);
  assert.deepEqual(frames, ['replacement'], 'a fresh surface accepts the first layout frame before its view registers');
});

test('web Activity reconnect paints a fresh surface while preserving camera and retained drawing owners', async () => {
  const useSurfaceKey = surfaceKey('web'), api = viewApi();
  let drawings = 0, surfaces = 0;
  function Painter({ picture, camera }: Props) {
    const [id] = useState(() => { surfaces++; return api.allocateNativeId(); }), node = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { api.setJsiProperty(id, 'picture', `${picture.id}:${camera}`); });
    useEffect(() => {
      api.registerView(String(id), { setPicture(value: string) { if (node.current) node.current.textContent = value; } });
      return () => { api.unregisterView(String(id)); if (node.current) node.current.textContent = ''; };
    }, [id]);
    return React.createElement('div', { ref: node, 'data-surface': id });
  }
  function Map({ projection, camera }: Props) {
    const key = useSurfaceKey(projection), picture = useMemo(() => ({ id: ++drawings }), []);
    return React.createElement(Painter, { key, picture, camera });
  }
  await mounted(async (container, render) => {
    const show = (visible: boolean, projection = 'campus:ground:2d', camera = 'pan-14-zoom-3') => render(React.createElement(Activity, { mode: visible ? 'visible' : 'hidden', children: React.createElement(Map, { projection, camera }) }));
    await show(true);
    const first = container.querySelector('[data-surface]')!.getAttribute('data-surface');
    assert.equal(container.textContent, '1:pan-14-zoom-3');
    await show(false); await show(true);
    assert.notEqual(container.querySelector('[data-surface]')!.getAttribute('data-surface'), first);
    assert.equal(container.textContent, '1:pan-14-zoom-3', 'the return frame cannot disappear into the previous unregistered view ID');
    assert.equal(drawings, 1, 'React Activity and surface recovery retain compiled campus geometry');
    const restored = container.querySelector('[data-surface]')!.getAttribute('data-surface'), before = surfaces;
    await show(true, 'campus:ground:2d', 'pan-28-zoom-4');
    assert.equal(surfaces, before); assert.equal(container.querySelector('[data-surface]')!.getAttribute('data-surface'), restored);
    assert.equal(container.textContent, '1:pan-28-zoom-4');
    await show(true, 'campus:first:2d', 'pan-28-zoom-4');
    assert.equal(surfaces, before + 1); assert.equal(drawings, 1);
  });
});

test('native canvas identity remains stable across projection changes and retained-screen reconnects', async () => {
  const useSurfaceKey = surfaceKey('ios');
  function Map({ projection }: Props) { return React.createElement('div', { 'data-key': useSurfaceKey(projection) }); }
  await mounted(async (container, render) => {
    const show = (visible: boolean, projection: string) => render(React.createElement(Activity, { mode: visible ? 'visible' : 'hidden', children: React.createElement(Map, { projection }) }));
    await show(true, 'outdoor:2.5d'); const key = container.querySelector('[data-key]')!.getAttribute('data-key');
    await show(true, 'ground:2d'); await show(false, 'ground:2d'); await show(true, 'ground:2d');
    assert.equal(container.querySelector('[data-key]')!.getAttribute('data-key'), key);
  });
});
