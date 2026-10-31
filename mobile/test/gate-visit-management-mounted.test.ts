import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const source = readFileSync(new URL('../src/features/GateVisitManagement.tsx', import.meta.url), 'utf8');
const fixture = { visit: { id: 'visit-a', revision: 4, party_size: 10, last_movement: { direction: 'in', observed_count: 10, occurred_at: '2026-10-26T16:25:00Z' } }, can_edit: true, can_cancel: true, can_record_arrival: true, can_record_exit: true, history: [{ revision: 4, action: 'movement_recorded', actor: { label: 'Gate operator' }, recorded_at: '2026-10-26T16:25:00Z', title:'Historical purpose',guest_name:'Original group',guest_label:'Original group',party_size:8,starts_at:'2026-10-26T14:00:00Z',ends_at:'2026-10-26T17:00:00Z',place_label:'Original office',contact_label:'Original contact',state:'confirmed',last_movement: { direction: 'in', observed_count: 10,occurred_at:'2026-10-26T16:25:00Z' } }], history_has_more: true };

async function harness(run: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const prompts: any[] = [], records: any[] = [], cancels: boolean[] = [], fields = new Map<string, (value: string) => void>();
  let detail = structuredClone(fixture), locked = false, epoch = 0, setCount: (value: string) => void, unmounted = false;
  const View = ({ children }: any) => React.createElement('div', null, children), Text = ({ children }: any) => React.createElement('span', null, children);
  const Button = ({ title, children, accessibilityLabel, disabled, onPress }: any) => React.createElement('button', { 'aria-label': accessibilityLabel, disabled, onClick: onPress }, title ?? children);
  const dependencies: any = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View, Text, ScrollView:View, Pressable: Button, StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } },
    '../lib/use-operation-context': { useOperationContext: () => () => { const captured = epoch; return () => { if (captured !== epoch) throw new Error('The account/world/focus lease changed'); }; } },
    '../ui/Alert': { Alert: { alert: (title: string, message: string, actions: any[]) => prompts.push({ title, message, actions }) } },
    'expo-router':{useIsFocused:()=>true},
    '../auth/SessionProvider':{useSession:()=>({scopeKey:String(epoch)})},
    'react-native-safe-area-context':{SafeAreaProvider:View,SafeAreaView:View},
    '../ui/Motion':{MotionModal:({visible,children}:any)=>visible?React.createElement('section',{'data-history-sheet':true},children):null},
    './GateVisitDetails':{VisitDetailCard:({visit,timezone}:any)=>React.createElement('article',null,visit.starts_at,visit.ends_at,visit.place.label,visit.contact.label,timezone)},
    '../ui/DomainControls': { ControlButton:Button,Facts:({items}:any)=>React.createElement('dl',null,items.map((item:any)=>React.createElement('div',{key:item.label},item.label,': ',item.value))),SegmentedControl: ({ options, onChange, disabled }: any) => React.createElement('div', null, options.map((option: any) => React.createElement(Button, { key: option.value, title: option.label, disabled, onPress: () => onChange(option.value) }))) },
    '../ui/components': {
      Button, ListGroup: View,
      Section: ({ title, children }: any) => React.createElement('section', null, React.createElement('h2', null, title), children),
      Row: ({ title, detail,onPress }: any) => React.createElement(onPress?'button':'article', {onClick:onPress}, title, detail),
      Notice:({message}:any)=>React.createElement('p',null,message),
      Field: ({ label, value, onChangeText }: any) => { fields.set(label, onChangeText); return React.createElement('input', { 'aria-label': label, value, readOnly: true }); },
    },
    '../ui/theme': { useTheme: () => ({ colors: {}, dark: true }) },
    '../ui/theme-tokens': { productIconAppearance: () => ({ ink: 'teal' }), themeRadii: { radiusCard: 24 } },
  };
  for (const name of ['PencilSimple', 'SignIn', 'SignOut', 'XCircle', 'CaretRight']) dependencies[`phosphor-react-native/src/icons/${name}`] = { [`${name}Icon`]: () => null };
  const historyExports:any={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/GateVisitHistory.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:historyExports,JSON,require(name:string){assert.ok(name in dependencies,name);return dependencies[name];}});
  dependencies['./GateVisitHistory']=historyExports;
  const exports: any = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  function Host() {
    const [count, update] = React.useState('1'); setCount = update;
    return React.createElement(exports.GateVisitManagement, { href: '/areas/in-out/visits?visit=visit-a', detail, locked, count, onCount: update, when: (value: string) => `Campus time ${value}`,timezone:'Asia/Kolkata', onEdit() {}, onRecord: (...value: any[]) => records.push(value), onCancel: () => cancels.push(true) });
  }
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const render = () => act(async () => { renderer.render(React.createElement(Host)); });
  const h = {
    prompts, records, cancels, text: () => dom.window.document.body.textContent ?? '',
    async click(label: string) { const button = [...dom.window.document.querySelectorAll('button')].find((value: any) => value.getAttribute('aria-label') === label || value.textContent === label || value.textContent?.startsWith(label+'Gate operator')) as HTMLButtonElement; assert.ok(button, label); await act(async () => button.click()); },
    async count(value: string) { await act(async () => setCount(value)); },
    async confirm() { await act(async () => prompts.at(-1).actions.at(-1).onPress()); },
    async cancel() { await act(async () => prompts.at(-1).actions[0].onPress()); },
    async revision() { detail = { ...detail, visit: { ...detail.visit, revision: detail.visit.revision + 1 } }; await render(); },
    async exitOnly() { detail = { ...detail, can_record_arrival: false, can_cancel: false, can_edit: false }; await render(); },
    async lock() { locked = true; await render(); },
    invalidate() { epoch++; },
    async changeWorld(){epoch++;await render();},
    async forgetHistory(){detail={...detail,history:[]};await render();},
    sheet:()=>dom.window.document.querySelector('[data-history-sheet]')?.textContent,
    disabled(label: string) { return ([...dom.window.document.querySelectorAll('button')].find((value: any) => value.textContent === label || value.textContent?.startsWith(label+'Gate operator')) as HTMLButtonElement).disabled; },
    async unmount() { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } },
  };
  try { await render(); await run(h); } finally { await h.unmount(); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('management, observation and history are visible without expanding a disclosure', async () => harness(async h => {
  assert.match(h.text(), /Manage visit.*Edit visit.*Cancel arrangement.*Arrivals & exits.*Arrival · 10 people/s);
  assert.match(h.text(), /Record movement.*Visit history.*Arrival recorded · 10 people/s);
  assert.match(h.text(), /Earlier history is retained/);
  assert.match(h.text(), /do not confirm attendance/);
}));
test('one selected movement records the reviewed direction/count only once after confirmation', async () => harness(async h => {
  await h.click('Exit'); await h.count('12'); await h.click('Record exit');
  assert.equal(h.records.length, 0); assert.match(h.prompts[0].message, /12 people leave the campus boundary/);
  await h.confirm(); await h.confirm(); assert.deepEqual(h.records, [['out', 12]]);
}));
test('cancelled plan can expose permitted exit without inventing an arrival or another cancellation', async () => harness(async h => {
  await h.exitOnly(); assert.doesNotMatch(h.text(), /Cancel arrangement|Edit visit/);
  await h.click('Record exit'); await h.confirm(); assert.deepEqual(h.records, [['out', 1]]);
}));
test('zero, malformed and excessive counts cannot open a confirmation', async () => harness(async h => {
  for (const value of ['0', '-1', '1.5', '100000', '5001', '9999', 'people', '']) { await h.count(value); assert.equal(h.disabled('Record arrival'), true); await h.click('Record arrival'); }
  assert.equal(h.prompts.length, 0);
  await h.count('5001'); assert.match(h.text(), /Enter a whole count from 1 to 5,000/);
}));
test('cancellation explains retained evidence and does not dispatch when dismissed', async () => harness(async h => {
  await h.click('Cancel arrangement'); assert.match(h.prompts[0].message, /Cancelling does not record an exit/);
  await h.cancel(); await h.confirm(); assert.equal(h.cancels.length, 0);
  await h.click('Cancel arrangement'); await h.confirm(); assert.equal(h.cancels.length, 1); assert.equal(h.records.length, 0);
}));
for (const change of ['revision', 'count', 'lock', 'invalidate', 'unmount']) test(`a stale movement confirmation cannot dispatch after ${change}`, async () => harness(async h => {
  await h.click('Record arrival'); if (change === 'count') await h.count('2'); else await h[change]();
  await h.confirm(); assert.equal(h.records.length, 0);
}));

 test('changing a count away and back still retires the old confirmation', async () => harness(async h => {
  await h.click('Record arrival'); await h.count('2'); await h.count('1'); await h.confirm(); assert.equal(h.records.length, 0);
 }));


test('the largest supported observed count still requires explicit confirmation',async()=>harness(async h=>{
 await h.count('5000');await h.click('Record arrival');assert.match(h.prompts[0].message,/5000 people/);assert.equal(h.records.length,0);await h.confirm();assert.deepEqual(h.records,[['in',5000]]);
}));


test('history opens the retained plan and observation instead of reconstructing current visit labels',async()=>harness(async h=>{
 await h.click('Arrival recorded · 10 people');
 assert.match(h.sheet(),/Historical purpose/);assert.match(h.sheet(),/Original group/);assert.match(h.sheet(),/Original office/);assert.match(h.sheet(),/Original contact/);assert.match(h.sheet(),/People expected: 8/);assert.match(h.sheet(),/People observed: 10/);assert.match(h.sheet(),/Recorded observation/);assert.match(h.sheet(),/Asia\/Kolkata/);
 assert.deepEqual(h.records,[]);await h.click('Done');assert.equal(h.sheet(),undefined);assert.deepEqual(h.cancels,[]);
}));

test('a history sheet closes on an account/world change or when its source leaves the retained page',async()=>{
 for(const ending of ['changeWorld','forgetHistory'])await harness(async h=>{
  await h.click('Arrival recorded · 10 people');assert.ok(h.sheet());await h[ending]();assert.equal(h.sheet(),undefined);assert.deepEqual(h.records,[]);
 });
});
