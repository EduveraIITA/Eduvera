import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as visitTime from '../src/features/GateSharedVisitPolicy';
import * as diningTime from '../../packages/contracts/src/dining-time';
import * as sharingPolicy from '../src/lib/visit-sharing';
import * as editorPolicy from '../src/lib/visit-editor';
import * as placePresentation from '../src/lib/visit-place-presentation';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
const apiRoot = '/api/v1/gate/schools/campus-a/visit-arrangements';
const organiser = { id: '11111111-1111-4111-8111-111111111111', label: 'Current organiser', revision: 2, has_app_access: true };
const other = { id: '22222222-2222-4222-8222-222222222222', label: 'Other campus person', revision: 3, has_app_access: true };
const place = { id: '33333333-3333-4333-8333-333333333333', label: 'Main office', kind: 'office' };
const visit = { id: '44444444-4444-4444-8444-444444444444', revision: 4, person: organiser, guest_name: null, party_size: 2, title: 'Campus visit', starts_at: '2026-10-29T10:00:00Z', ends_at: '2026-10-29T12:00:00Z', place, contact: organiser, last_movement: null };
const options = { timezone: 'UTC', actor: { person_id: organiser.id, label: organiser.label, revision: organiser.revision }, people: [organiser, other], places: [place], pagination: { people_has_more: false, places_has_more: false } };
const sharing = { visit_revision: 4, share_revision: 0, can_share: true, can_open_shared: false, current: null };
type FixtureVisit = Omit<typeof visit, 'last_movement'> & { last_movement: null | { direction: 'in' | 'out' } };

function load(file: string, dependencies: Record<string, unknown>) {
  const absolute = path.join(root, file), exports: Record<string, any> = {};
  const compiled = ts.transpileModule(readFileSync(absolute, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { exports, URLSearchParams, Date, JSON, require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected form dependency ${name}`); return dependencies[name]; } }, { filename: absolute, timeout: 1000 });
  return exports;
}

async function harness(kind: 'visit' | 'sharing', run: (h: any) => Promise<void>, initial?: FixtureVisit, privateThread = false) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const fields = new Map<string, (value: string) => void>(), choices = new Map<string, { disabled?: boolean; onChange(value: string): void }>();
  const guards = new Map<symbol, any>(), commands: unknown[] = [];
  const prompts: { title: string; message: string; actions: { text: string; onPress?: () => void }[] }[] = [];
  let mounted = true, lateStateWrites = 0;
  const featureReact = { ...React, useState(initial: any) { const [value, set] = React.useState(initial); return [value, (next: any) => { if (!mounted) lateStateWrites++; set(next); }]; } };
  let sharingData: any = privateThread ? { visit_revision: 4, share_revision: 3, can_share: true, can_open_shared: true, current: { id: '55555555-5555-4555-8555-555555555555', root_id: '66666666-6666-4666-8666-666666666666', revision: 3, organiser: { ...organiser, has_app_access: false }, starts_at: visit.starts_at, ends_at: visit.ends_at, directions: 'Saved directions', state: 'active', owner: { id: '77777777-7777-4777-8777-777777777777', label: 'Campus owner', available: true }, can_renew: true, can_revoke: false, can_takeover: false, invitation: null } } : sharing;
  const thread = { visit, share: { id: '55555555-5555-4555-8555-555555555555', root_id: '66666666-6666-4666-8666-666666666666', can_ask: true, can_reply: false }, question: null };
  let transportEpoch = 0, latestVisit: any = initial ?? visit, pendingRead: Promise<unknown> | undefined;
  const session = { scopeKey: 'actor-a:campus-a:simulation:world-a', environment: { mode: 'simulation', namespace_id: 'world-a' } };
  const native = { Text: ({ children }: any) => React.createElement('span',null,children), View: ({ children }: any) => React.createElement('div', null, children), AppState: { currentState: 'active' } };
  const operation = load('src/lib/use-operation-context.ts', {
    react: React, 'react-native': native, 'expo-router': { useIsFocused: () => true }, '../auth/SessionProvider': { useSession: () => session },
    './api': { captureApiContext: () => { const epoch = transportEpoch; return { assertCurrent() { if (epoch !== transportEpoch) throw new Error('Selected-world transport changed'); } }; } },
  });
  const useGuard = (value: any) => { const id = React.useRef(Symbol()); guards.set(id.current, value); React.useEffect(() => () => { guards.delete(id.current); }, []); };
  let scrolls = 0; const scrollToTop = () => { scrolls++; };
  const Button = ({ title, onPress, disabled, busy }: any) => React.createElement('button', { onClick: onPress, disabled: disabled || busy }, title);
  const Field = ({ label, value, onChangeText }: any) => { fields.set(label, onChangeText); return React.createElement('input', { 'aria-label': label, value, readOnly: true }); };
  const Section = ({ title, children }: any) => React.createElement('section', null, React.createElement('h2', null, title), children);
  const child = (label: string) => function InlineChild({ onClose }: any) {
    const [value, setValue] = React.useState(''); useGuard({ dirty: !!value });
    return React.createElement('section', null, React.createElement(Field, { label, value, onChangeText: setValue }), React.createElement(Button, { title: 'Child-owned return', onPress: onClose }));
  };
  const components = {
    Section, ListGroup: ({ children }: any) => React.createElement('div',null,children), Button, Field, SearchField: Field, usePageScroll: () => scrollToTop, Loading: () => React.createElement('p', null, 'Loading'),
    Notice: ({ message }: any) => React.createElement('p', null, message), Empty: ({ title }: any) => React.createElement('p', null, title),
    Row: ({ title, detail, onPress }: any) => React.createElement(onPress ? 'button' : 'div', { onClick: onPress, 'aria-label': title }, title, React.createElement('span', null, detail)),
  };
  const controls = {
    ControlButton: Button, Facts: ({items}: any) => React.createElement('dl',null,items.map((item: any) => React.createElement('div',{key:item.label},item.label,': ',item.value))), Disclosure: ({ title, children }: any) => React.createElement('section', null, title, children),
    ChoiceMenu: ({ label, value, options: items, onChange, disabled }: any) => { choices.set(label, { disabled, onChange }); return React.createElement('select', { 'aria-label': label, value, disabled, onChange() {} }, items.map((item: any) => React.createElement('option', { key: item.value, value: item.value }, item.label))); },
  };
  const useApi = (url: string | null) => ({ data: url?.endsWith('/sharing/') ? sharingData : url?.endsWith('/shared/') ? thread : url ? options : undefined, isPending: false, error: null, refetch: async () => ({ data: options }) });
  const write = { locked: false, busy: false, pending: null, run: async (value: unknown) => { commands.push(value); } };
  const dependencies: Record<string, unknown> = {
    react: featureReact, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native,
    'expo-crypto': { randomUUID: () => 'command-a' }, '../../../packages/contracts/src/dining-time': diningTime,
    '../lib/api': { apiFetch: async (path: string) => pendingRead ?? (path.endsWith(`/${visit.id}/`) ? {visit:latestVisit,can_edit:true} : options) }, '../lib/query': { useApi }, '../lib/visit-editor': editorPolicy,
    '../lib/use-operation-context': operation,
    '../lib/use-operation-clock': { useOperationClock: () => ({ now: '2026-10-29T09:00:00Z', read: async () => '2026-10-29T09:00:00Z', error: '' }) },
    '../ui/BackNavigation': {
      ScreenBack: ({ title, onPress, preservesDraft }: any) => React.createElement('button', { onClick: onPress, 'data-header-back': true, 'data-preserves-draft': !!preservesDraft }, title),
      useScreenExitGuard: useGuard,
    },
    '../ui/Alert': { Alert: { alert(title: string, message: string, actions: any[]) { prompts.push({ title, message, actions }); } } },
    '../ui/DomainControls': controls, '../ui/components': components,
    './GateSharedVisitPolicy': visitTime,
    './ResourcesScreen': { DomainPages: () => null, DomainText: ({ children }: any) => React.createElement('p', null, children) },
    './DiningTimeFields': { DiningCampusTimeField: ({ label, value, onChange }: any) => React.createElement(Field, { label, value, onChangeText: onChange }) },
    './PeopleScreen': { NativePeopleCreate: child('New person name'), NativePeopleBulkCreate: child('Imported names') },
  };
  const placePicker = load('src/features/gate/GatePlacePicker.tsx', {
    react: React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':native,
    '../../auth/SessionProvider':{useSession:()=>({...session,schoolId:'campus-a'})},'../../lib/api':{apiFetch:async()=>options},
    '../../lib/use-operation-context':operation,'../../lib/visit-place-presentation':placePresentation,
    '../../ui/BackNavigation':dependencies['../ui/BackNavigation'],'../../ui/DomainControls':controls,'../../ui/components':components,
    '../../ui/theme':{useTheme:()=>({colors:{}})},'../ResourcesScreen':dependencies['./ResourcesScreen'],
    './CampusPlacePortal':{CampusPlacePortal:()=>null},'./useVisitPlaces':{useVisitPlaces:()=>({data:options.places,isPending:false}),useVisitCampuses:()=>({data:undefined,isPending:false}),useVisitSchedule:()=>({data:undefined})},
  });
  dependencies['./gate/GatePlacePicker']=placePicker;
  const editor = load('src/features/GateVisitEditor.tsx', dependencies);
  const Component = kind === 'visit' ? editor.GateVisitEditor : load('src/features/GateVisitSharing.tsx', { ...dependencies, '../lib/visit-sharing': sharingPolicy, './GateVisitEditor': editor, './OperationsWorkInvitation': { OperationsWorkInvitation: ({ onClose }: any) => React.createElement('section', { 'data-app-invitation': true }, React.createElement(Button, { title: 'Close app invitation', onPress: onClose })) } }).GateVisitSharing;
  const renderer = createRoot(dom.window.document.getElementById('root'));
  const props: Record<string, unknown> = kind === 'visit' ? { root: apiRoot, initial, write, onClose() {} } : { href: '/areas/in-out/visits?visit=44444444-4444-4444-8444-444444444444', root: apiRoot, schoolId: 'campus-a', visit, write, acceptedKey: '', onEditing() {}, onNavigate() {} };
  const h = {
    doc: dom.window.document, commands, guards, prompts, scrolls: () => scrolls,
    latest(value: any) { latestVisit=value; },
    defer(value: Promise<unknown>) { pendingRead=value; },
    async incoming(value: any) { props.initial=value; await act(async()=>renderer.render(React.createElement(Component,props))); },
    async click(title: string) { const button = [...dom.window.document.querySelectorAll('button')].find((element: any) => element.textContent === title || element.getAttribute('aria-label') === title) as HTMLButtonElement | undefined; assert.ok(button, `Missing ${title}`); assert.equal(button.disabled, false); await act(async () => button.click()); },
    async field(label: string, value: string) { assert.ok(fields.has(label), label); await act(async () => fields.get(label)!(value)); },
    async choose(label: string, value: string) { const choice = choices.get(label); assert.ok(choice, label); assert.ok(!choice.disabled); await act(async () => choice.onChange(value)); },
    async respond(index: number, text: string) { const action = prompts[index]?.actions.find(value => value.text === text); assert.ok(action, `Missing prompt action ${text}`); await act(async () => action.onPress?.()); },
    async loseScope(kind: 'world' | 'mode') { transportEpoch++; session.scopeKey += ':' + kind; session.environment = kind === 'mode' ? { mode: 'live', namespace_id: '' } : { mode: 'simulation', namespace_id: 'world-b' }; await act(async () => renderer.render(React.createElement(Component, props))); },
    async changeSharingSource() { sharingData = { ...sharingData, share_revision: sharingData.share_revision + 1, current: { ...sharingData.current, revision: sharingData.current.revision + 1 } }; await act(async () => renderer.render(React.createElement(Component, props))); },
    async unmount() { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } },
    lateStateWrites: () => lateStateWrites,
    sharingSource: () => sharingData,
    text: () => dom.window.document.body.textContent ?? '',
    value: (label: string) => (dom.window.document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null)?.value,
  };
  try { await act(async () => renderer.render(React.createElement(Component, props))); await run(h); }
  finally { await h.unmount(); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('visit choices replace the form body, and cancel or selection retains its draft without sending a command', async () => harness('visit', async h => {
  await h.field('Guest name', 'Unsent visitor'); await h.field('Visit purpose', 'Detailed campus tour'); await h.field('People expected', '6');
  assert.equal(h.scrolls(), 1, 'Opening the editor starts at its heading');
  await h.click('Destination'); assert.equal(h.scrolls(), 2, 'The chooser starts at its search field rather than retaining the form scroll offset');
  assert.equal(h.value('Visit purpose'), undefined); assert.ok(!h.text().includes('Confirm visit')); assert.ok(h.text().includes('Choose meeting place'));
  assert.ok([...h.guards.values()].some((guard: any) => guard.dirty), 'Losing navigation must still see the parent draft while choosing');
  assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'), 'true', 'Only the local picker return preserves the retained parent draft');
  await h.click('Back to visit form');
  assert.equal(h.value('Group contact name'), 'Unsent visitor'); assert.equal(h.value('Visit purpose'), 'Detailed campus tour'); assert.equal(h.value('People expected'), '6');
  assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'), 'false', 'Closing the editor remains a losing exit');
  await h.click('Campus contact'); await h.click(other.label);
  assert.equal(h.value('Visit purpose'), 'Detailed campus tour'); assert.ok(h.text().includes(other.label));
  await h.choose('Visitor identity', 'person'); await h.click('Campus person'); await h.click(organiser.label);
  assert.ok(h.text().includes(organiser.label)); assert.equal(h.value('People expected'), '6'); assert.deepEqual(h.commands, []);
  assert.ok([...h.guards.values()].some((guard: any) => guard.dirty), 'The retained edited form still owns its exit guard');
}));

test('sharing organiser choices replace Save sharing, and return to the same private draft', async () => harness('sharing', async h => {
  await h.click('Share visit'); await h.field('Directions · optional', 'Use the west entrance');
  await h.click('Organiser'); assert.equal(h.scrolls(), 1);
  assert.equal(h.value('Directions · optional'), undefined); assert.ok(!h.text().includes('Save sharing'));
  assert.ok([...h.guards.values()].some((guard: any) => guard.dirty), 'Sharing remains protected during the organiser choice');
  assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'), 'true');
  await h.click('Back to visit form'); assert.equal(h.value('Directions · optional'), 'Use the west entrance');
  assert.equal(h.doc.querySelector('[data-header-back]').getAttribute('data-preserves-draft'), 'false', 'Closing the sharing editor still requires the ordinary draft guard');
  await h.click('Organiser'); await h.click(other.label);
  assert.equal(h.value('Directions · optional'), 'Use the west entrance'); assert.ok(h.text().includes(other.label)); assert.deepEqual(h.commands, []);
  assert.ok([...h.guards.values()].some((guard: any) => guard.dirty), 'The sharing draft still owns its exit guard');
}));

test('nested person and import Back confirms only the child and retains the sharing draft', async () => {
  for (const [action, label] of [['Add person', 'New person name'], ['Add or import people', 'Imported names']]) await harness('sharing', async h => {
    await h.click('Share visit'); await h.field('Directions · optional', 'Retained visit directions'); await h.click('Organiser');
    await h.click(action); await h.field(label, 'Unsent person entries'); await h.click('Back to choices');
    assert.equal(h.prompts[0].title, 'Close this person form?');
    assert.equal(h.prompts[0].message, 'Any unsaved person details will be discarded. Your visit entries stay here.');
    assert.equal([...h.guards.values()].filter((guard: any) => guard.dirty).length, 2, 'Both the visit parent and person child remain dirty');
    await h.respond(0, 'Keep editing'); assert.equal(h.value(label), 'Unsent person entries');
    await h.click('Back to choices'); await h.respond(1, 'Discard person entries');
    assert.equal(h.value(label), undefined); assert.ok(h.text().includes('Choose person'));
    assert.equal([...h.guards.values()].filter((guard: any) => guard.dirty).length, 1, 'Only the explicitly discarded child leaves');
    await h.click('Back to visit form'); assert.equal(h.value('Directions · optional'), 'Retained visit directions'); assert.deepEqual(h.commands, []);
  });
});

test('an old person discard confirmation cannot close a reopened child or another adding mode', async () => {
  for (const [next, label] of [['Add person', 'New person name'], ['Add or import people', 'Imported names']]) await harness('sharing', async h => {
    await h.click('Share visit'); await h.field('Directions · optional', 'Retained directions'); await h.click('Organiser');
    await h.click('Add person'); await h.field('New person name', 'Earlier child'); await h.click('Back to choices');
    await h.click('Child-owned return'); await h.click(next); await h.field(label, 'New child instance');
    await h.respond(0, 'Discard person entries'); assert.equal(h.value(label), 'New child instance'); assert.deepEqual(h.commands, []);
  });
});

test('selected world or mode loss invalidates a pending local person discard confirmation', async () => {
  for (const kind of ['world', 'mode'] as const) await harness('sharing', async h => {
    await h.click('Share visit'); await h.field('Directions · optional', 'Retained directions'); await h.click('Organiser');
    await h.click('Add person'); await h.field('New person name', 'Original child entries'); await h.click('Back to choices');
    await h.loseScope(kind); await h.respond(0, 'Discard person entries');
    assert.equal(h.value('New person name'), 'Original child entries'); assert.deepEqual(h.commands, []);
  });
});

test('unsent question notes require an explicit choice before sharing editor or invitation opens', async () => {
  for (const action of ['Update sharing', 'Invite organiser to the app']) await harness('sharing', async h => {
    const source = h.sharingSource(); await h.field('Question for campus', 'Unsent question'); await h.click(action);
    assert.equal(h.value('Question for campus'), 'Unsent question'); assert.equal(h.value('Directions · optional'), undefined); assert.equal(h.doc.querySelector('[data-app-invitation]'), null);
    await h.respond(0, 'Keep writing'); assert.equal(h.value('Question for campus'), 'Unsent question'); assert.equal(h.sharingSource(), source);
    await h.click(action); await h.respond(1, 'Discard note and continue');
    if (action === 'Update sharing') {
      assert.equal(h.value('Directions · optional'), 'Saved directions'); assert.equal(h.doc.querySelector('[data-app-invitation]'), null); await h.click('Back to visit sharing');
    } else {
      assert.ok(h.doc.querySelector('[data-app-invitation]')); assert.equal(h.value('Directions · optional'), undefined); await h.click('Close app invitation');
    }
    assert.equal(h.value('Question for campus'), ''); assert.equal(h.sharingSource(), source); assert.deepEqual(h.commands, []);
    await h.click(action); assert.equal(h.prompts.length, 2, 'An empty note opens the same child immediately');
  }, undefined, true);
});

test('a note handoff cannot clear changed text, including text changed and restored, or a refreshed sharing source', async () => {
  for (const change of ['new-note', 'restored-note', 'sharing-source']) await harness('sharing', async h => {
    await h.field('Question for campus', 'Original unsent note'); await h.click('Update sharing');
    if (change === 'sharing-source') await h.changeSharingSource();
    else { await h.field('Question for campus', 'Newer unsent note'); if (change === 'restored-note') await h.field('Question for campus', 'Original unsent note'); }
    const current = h.value('Question for campus'); await h.respond(0, 'Discard note and continue');
    assert.equal(h.value('Question for campus'), current); assert.equal(h.value('Directions · optional'), undefined); assert.deepEqual(h.commands, []);
  }, undefined, true);
});

test('only the current note-handoff attempt can open its selected child', async () => harness('sharing', async h => {
  await h.field('Question for campus', 'Original unsent note'); await h.click('Update sharing'); await h.click('Invite organiser to the app');
  await h.respond(0, 'Discard note and continue'); assert.equal(h.value('Question for campus'), 'Original unsent note'); assert.equal(h.doc.querySelector('[data-app-invitation]'), null);
  await h.respond(0, 'Keep writing'); await h.respond(1, 'Discard note and continue');
  assert.ok(h.doc.querySelector('[data-app-invitation]')); assert.equal(h.value('Directions · optional'), undefined); assert.deepEqual(h.commands, []);
}, undefined, true));

test('world or mode changes and unmount invalidate deferred note handoffs before any state write', async () => {
  for (const ending of ['world', 'mode', 'unmount'] as const) await harness('sharing', async h => {
    await h.field('Question for campus', 'Source-bound unsent note'); await h.click('Invite organiser to the app');
    if (ending === 'unmount') await h.unmount(); else await h.loseScope(ending);
    await h.respond(0, 'Discard note and continue');
    if (ending !== 'unmount') assert.equal(h.value('Question for campus'), 'Source-bound unsent note');
    assert.equal(h.doc.querySelector('[data-app-invitation]'), null); assert.equal(h.value('Directions · optional'), undefined); assert.equal(h.lateStateWrites(), 0); assert.deepEqual(h.commands, []);
  }, undefined, true);
});

test('observed visit identity remains read-only during the layout cleanup', async () => harness('visit', async h => {
  assert.equal(h.doc.querySelector('select[aria-label="Visitor identity"]').disabled, true);
  assert.equal(h.doc.querySelector('button[aria-label="Campus person"]'), null);
  assert.ok(h.text().includes('Guest identity stays with recorded movement.'));
  assert.deepEqual(h.commands, []);
}, { ...visit, last_movement: { direction: 'in' } }));


test('a stale visit keeps the draft and shows the newly saved plan before an explicit reviewed save', async () => harness('visit',async h=>{
 await h.field('Visit purpose','My retained purpose');
 const newer={...visit,revision:5,title:'Other coordinator purpose',party_size:18,place:{...place,label:'Updated meeting room'},contact:{...organiser,label:'Updated campus contact'}};
 h.latest(newer);
 await h.click('Save visit changes');assert.equal(h.commands.length,0);assert.match(h.text(),/Your entries are kept/);
 await h.click('Review current visit with these entries');
 assert.match(h.text(),/Current saved plan/);assert.match(h.text(),/Other coordinator purpose/);assert.match(h.text(),/18/);assert.match(h.text(),/Updated meeting room/);assert.match(h.text(),/Updated campus contact/);
 assert.equal(h.value('Visit purpose'),'My retained purpose');assert.equal(h.value('People expected'),'2');
 await h.incoming(newer);assert.equal(h.value('Visit purpose'),'My retained purpose');assert.match(h.text(),/Current saved plan/);
 assert.ok([...h.guards.values()].some((guard:any)=>guard.dirty),'A refresh cannot rebase the dirty baseline');
 await h.click('Save reviewed visit changes');assert.equal(h.commands.length,1);
 const body=JSON.parse(h.commands[0].body);assert.equal(body.expected_revision,5);assert.equal(body.title,'My retained purpose');assert.equal(body.party_size,2);
},visit));

test('a second concurrent change requires another current-plan review without overwriting it',async()=>harness('visit',async h=>{
 await h.field('Visit purpose','My retained purpose');h.latest({...visit,revision:5,title:'First remote plan'});
 await h.click('Save visit changes');await h.click('Review current visit with these entries');
 h.latest({...visit,revision:6,title:'Second remote plan'});await h.click('Save reviewed visit changes');
 assert.equal(h.commands.length,0);assert.equal(h.value('Visit purpose'),'My retained purpose');
 await h.click('Review current visit with these entries');assert.match(h.text(),/Second remote plan/);
},visit));

test('late editor preflight cannot write or show feedback after world loss or unmount',async()=>{
 for(const ending of ['world','unmount'])await harness('visit',async h=>{
  let resolve!:(value:unknown)=>void;h.defer(new Promise(done=>{resolve=done;}));
  await h.click('Save visit changes');if(ending==='world')await h.loseScope('world');else await h.unmount();
  await act(async()=>resolve({visit,can_edit:true}));
  assert.equal(h.commands.length,0);assert.equal(h.lateStateWrites(),0);assert.doesNotMatch(h.text(),/The visit could not be reviewed/);
 },visit);
});
