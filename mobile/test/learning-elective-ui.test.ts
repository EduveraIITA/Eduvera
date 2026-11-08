import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import * as policy from '../src/lib/learning-elective-policy';

const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'), { createRoot } = require('react-dom/client');
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const change = id(1), school = id(2), person = id(3), source = id(4), destination = id(5), reviewer = id(6);
const selection = { person: { id: person, expected_revision: 2 }, source_offering: { id: source, expected_revision: 1 }, source_enrollment: { id: id(7), expected_revision: 1 }, destination_offering: { id: destination, expected_revision: 1 }, effective_on: '2026-11-16' };
function preview() { return { selection, fingerprint: 'a'.repeat(64), academic_context: { source_revision: 1, destination_revision: 1 }, schedule: { state: 'revision_required', impacts: [{ plan_id: id(8), revision: 2, offering_id: source, title: 'Data Systems seminar', starts_on: '2026-11-01', ends_on: '2026-12-30', replacement_starts_on: selection.effective_on }] }, catch_up: { prior_destination_sessions: 4, instructor_person_id: id(9) }, prior_evidence: { attendance_registers: 2, assessment_results: 1, assignment_attempts: 3 } }; }
function options() { return { today: '2026-11-08', timezone: 'Asia/Kolkata', date_bounds: { earliest: selection.effective_on, latest: '2026-12-30' }, person: { id: person, name: 'Aditi Vyas', revision: 2 }, source_offering: { id: source, name: 'Data Systems', revision: 1 }, source_enrollment: { id: id(7), revision: 1, starts_on: '2026-11-01', ends_on: null }, destinations: [{ id: destination, name: 'Statistical Learning', revision: 1, academic_context: { term_id: id(20), subject_id: id(21), course_code: 'DE502', credits: 4, programme_key: 'mtech-data-engineering', revision: 1 } }], finance_reviewers: [{ user_id: reviewer, person_id: id(10), label: 'Meera Kulkarni', eligibility_hash: 'b'.repeat(64) }] }; }
function finance() { return { id: change, revision: 1, selection, labels: { person: 'Aditi Vyas', source_offering: 'Data Systems', destination_offering: 'Statistical Learning' }, reason: 'Approved elective preference.', preview: preview(), state: 'waiting_for_finance', reviewer: options().finance_reviewers[0], ledger_basis_hash: 'c'.repeat(64), ledger_basis: { school_id: school, person_id: person, invoices: [{ invoice_id: id(11), student_id: null, person_id: person, reference: 'TUITION-104', due_on: '2026-12-01', amount_paise: 250000, revision: 1, ledger: { amount_paise: 250000, paid_paise: 50000, credited_paise: 0, refunded_paise: 0, balance_paise: 200000 } }] }, latest_decision: null, can_classify: true, finance_account_href: `/areas/fees/ledger?person_id=${person}` }; }
function detail() { return { id: change, revision: 2, selection, labels: finance().labels, reason: finance().reason, catch_up: { kind: 'not_needed', reason: 'Reviewed introductory materials are sufficient.' }, preview: preview(), current_preview: preview(), preview_changed: false, state: 'no_financial_change', finance: { state: 'no_financial_change', reviewer: finance().reviewer, decision_id: id(12), ledger_basis_changed: false, href: `/areas/fees/ledger?elective_review=${change}` }, can_apply: true, can_assign_finance: true, can_withdraw: true, blockers: [] }; }
type Query = { data?: any; isPending?: boolean; isError?: boolean; error?: any; refetch?: () => Promise<any> };
async function mount(kind: 'request' | 'detail' | 'finance', run: (h: any) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'), previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let scopeVersion=0,onFresh:((value:any)=>void)|undefined;const reviewed:unknown[]=[];
  const queries: Record<string, Query> = {}, requests: any[] = [], writes: any[] = [], navigated:string[] = [], fields = new Map<string, any>(), choices = new Map<string, any>();
  const optionPath = `${policy.electiveChangeRoot}/options?${new URLSearchParams({ source_offering_id: source, person_id: person })}`, financePath = policy.electiveFinanceRead({ schoolId: school }, change);
  queries[optionPath] = { data: options() }; queries[financePath] = { data: finance() }; queries[policy.electiveChangeRead(change)] = { data: detail() };
  const write: any = { locked: false, busy: false, action: null, error: '', obsolete: false, reviewed() { reviewed.push(true);write.obsolete=false;write.locked=false; }, recover: async () => false, run: async (input: unknown) => { writes.push(input); return false; } };
  const children = ({ children }: any) => React.createElement('div', null, children);
  const Button = ({ title, disabled, onPress }: any) => React.createElement('button', { disabled, onClick: onPress }, title);
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'expo-crypto': { randomUUID: () => change },
    '../auth/SessionProvider': { useSession: () => ({ user: { id: reviewer }, schoolId: school, scopeKey: `actor-campus-live-${scopeVersion}`, environment: { mode: 'live', namespace_id: null } }) },
    '../lib/api': { getApiOrigin: () => 'https://campus.example', captureApiContext: () => ({ assertCurrent() {} }), apiFetch: async (path: string, input: RequestInit) => { requests.push({ path, method: input.method, body: JSON.parse(String(input.body)) }); return preview(); } },
    '../lib/learning-elective-policy': policy, '../lib/use-learning-elective': { useLearningElective: (_href:string,_path:string,fresh:(value:any)=>void) => {onFresh=fresh;return write;} },
    '../lib/use-operation-context': { useOperationContext: () => () => { const captured=scopeVersion;return () => assert.equal(scopeVersion,captured,'The account, campus, world or source changed.'); } },
    '../lib/query': { useApi: (path: string | null) => ({ isPending: false, isError: false, refetch: async () => ({data:path?queries[path]?.data:undefined}), ...(path ? queries[path] : {}) }) },
    '../ui/BackNavigation': { ScreenBack: () => null, useCampusNavigation: () => ({ complete(value:string) {navigated.push(value);}, onNavigate(value:string) {navigated.push(value);} }), useScreenExitGuard() {} },
    '../ui/TemporalField': { TemporalField: ({ label, value, onChange, disabled }: any) => { fields.set(label, { onChangeText: onChange }); return React.createElement('input', { 'data-field': label, value, disabled, onChange() {} }); } },
    '../ui/components': { Page: ({ title, subtitle, children }: any) => React.createElement('main', null, React.createElement('h1', null, title), subtitle, children), Section: ({ title, children }: any) => React.createElement('section', null, React.createElement('h2', null, title), children), Button, Notice: ({ message }: any) => React.createElement('p', null, message), Empty: ({ title, message }: any) => React.createElement('p', null, title, message), Loading: () => React.createElement('p', null, 'Loading'), Row: ({ title, detail }: any) => React.createElement('p', null, title, detail), Field: ({ label, value, onChangeText, editable = true }: any) => { fields.set(label, { onChangeText }); return React.createElement('label', null, label, React.createElement('input', { 'data-field': label, value, disabled: !editable, onChange() {} })); } },
    '../ui/DomainControls': { ControlButton: Button, Disclosure: children, Facts: ({ items }: any) => React.createElement('dl', null, items.map((item: any, index: number) => React.createElement('div', { key: index }, item.label, ': ', item.value))), ChoiceMenu: ({ label, value, options, disabled, onChange }: any) => { choices.set(label, { onChange }); return React.createElement('select', { 'aria-label': label, disabled, value, onChange() {} }, options.map((item: any) => React.createElement('option', { key: item.value, value: item.value }, item.label))); } },
  };
  function load(name: string) {
    const exports: any = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/features/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { exports, Error, Date, Intl, URLSearchParams, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } }); return exports;
  }
  const academic = load('LearningElectiveChange'); dependencies['./LearningElectiveChange'] = academic; const fee = load('FeesElectiveReview');
  const root = createRoot(dom.window.document.getElementById('root')), href = kind === 'finance' ? `/areas/fees/ledger?elective_review=${change}` : kind === 'detail' ? `/areas/messages/assignments?scope=elective_change&change_id=${change}` : `/areas/messages/assignments?scope=elective_change&offering_id=${source}&person_id=${person}`;
  const render = () => kind !== 'finance' ? React.createElement(academic.LearningElectiveChange, { href, onNavigate(value:string) {navigated.push(value);} }) : React.createElement(fee.FeesElectiveReview, { href, onNavigate(value:string) {navigated.push(value);}, schoolId: school, id: change });
  const button = (title: string) => [...dom.window.document.querySelectorAll('button')].find((value: any) => value.textContent === title) as HTMLButtonElement | undefined;
  try {
    await act(async () => root.render(render()));
    await run({ requests, writes, navigated, queries, write, optionPath, financePath, button, reviewed, changeScope(){scopeVersion++;}, input:(label:string)=>([...dom.window.document.querySelectorAll('input')].find((value:any)=>value.getAttribute('data-field')===label) as HTMLInputElement|undefined), text: () => dom.window.document.body.textContent ?? '',
      async refresh() { await act(async () => root.render(render())); },
      async acceptFresh(value:any) { if(kind==='finance')queries[financePath]={data:value};else queries[policy.electiveChangeRead(change)]={data:value};await act(async()=>{assert.ok(onFresh);onFresh(value);root.render(render());}); },
      async press(title: string) { const value = button(title); assert.ok(value, title); assert.equal(value.disabled, false, title); await act(async () => { value.click(); await Promise.resolve(); }); },
      async fill(label: string, value: string) { const input = [...dom.window.document.querySelectorAll('input')].find((input: any) => input.getAttribute('data-field') === label) as HTMLInputElement; assert.ok(input, label); assert.equal(input.disabled, false); await act(async () => fields.get(label).onChangeText(value)); },
      async choose(label: string, value: string) { const select = dom.window.document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; assert.ok(select, label); assert.equal(select.disabled, false); await act(async () => choices.get(label).onChange(value)); } });
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); }
}

test('mounted elective request requires exact impact preview and explicit reviewed catch-up/Finance choice before its first material command', async () => {
  await mount('request', async h => {
    assert.equal(h.writes.length, 0); assert.equal(h.button('Save change for review'), undefined);
    await h.choose('New course', destination); await h.fill('Reason for change', 'Approved elective preference.'); await h.fill('Why catch-up is not needed', 'The destination teacher confirmed introductory material is sufficient.');
    await h.press('Review impact'); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].path, policy.electiveChangeRoot + '/preview'); assert.equal(h.writes.length, 0);
    assert.match(h.text(), /Sessions scheduled before the change: 4/); assert.doesNotMatch(h.text(), /missed|already taught/i); assert.match(h.text(), /Data Systems seminar/);
    await h.press('Save change for review'); assert.equal(h.writes.length, 1); const body = h.writes[0].body;
    assert.equal(body.preview_fingerprint, 'a'.repeat(64)); assert.equal(body.finance_reviewer, null); assert.equal(body.confirm_delivery, false); assert.equal(body.catch_up.kind, 'not_needed');
    h.write.action = { phase: 'accepted', ownerHref: '/original' }; h.write.locked = true; await h.refresh(); assert.equal(h.button('Save change for review'), undefined); assert.equal(h.writes.length, 1);
  });
});
test('mounted Finance review holds stale ledger draft, preserves the reason, and requires explicit classification confirmation', async () => {
  await mount('finance', async h => {
    assert.match(h.text(), /Aditi Vyas/); assert.match(h.text(), /TUITION-104/); assert.equal(h.button('Confirm Finance decision'), undefined);
    await h.fill('Reason and evidence reviewed', 'Reviewed the exact original account and the course change.'); await h.press('Review decision'); assert.equal(h.writes.length, 0);
    const old = h.queries[h.financePath].data; h.queries[h.financePath] = { data: { ...old, ledger_basis_hash: 'd'.repeat(64) } }; await h.refresh();
    assert.equal(h.button('Confirm Finance decision').disabled, true); assert.match(h.text(), /ledger changed/); assert.match(h.text(), /Reviewed the exact original account/);
    await h.press('Review current account'); await h.press('Review decision'); await h.press('Confirm Finance decision');
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].body.outcome, 'requires_financial_review'); assert.equal(h.writes[0].body.expected_ledger_basis_hash, 'd'.repeat(64));
  });
});
test('explicit current Finance denial hides previously cached private ledger and request evidence', async () => {
  await mount('finance', async h => {
    assert.match(h.text(), /TUITION-104/); h.queries[h.financePath] = { data: finance(), isError: true, error: { status: 403, message: 'This Finance responsibility was revoked.' } }; await h.refresh();
    assert.doesNotMatch(h.text(), /TUITION-104|Aditi Vyas|Approved elective preference/); assert.equal(h.button('Review decision'), undefined);
  });
});
test('explicit current academic denial hides cached elective request and person details', async () => {
  await mount('detail', async h => {
    assert.match(h.text(), /Aditi Vyas/); const path = policy.electiveChangeRead(change); h.queries[path] = { data: detail(), isError: true, error: { status: 403, message: 'Current setup responsibility revoked.' } }; await h.refresh();
    assert.doesNotMatch(h.text(), /Aditi Vyas|Approved elective preference/); assert.equal(h.button('Review and apply change'), undefined);
  });
});
test('newly refreshed source choices require a fresh matching preview before the old review can be sent', async () => {
  await mount('request', async h => {
    await h.choose('New course', destination); await h.fill('Reason for change', 'Approved elective preference.'); await h.fill('Why catch-up is not needed', 'The introduction has already been reviewed.'); await h.press('Review impact');
    const before = h.queries[h.optionPath].data; h.queries[h.optionPath] = { data: { ...before, destinations: before.destinations.map((value: any) => ({ ...value, revision: 2 })) } }; await h.refresh();
    const submit = h.button('Save change for review'); assert.ok(!submit || submit.disabled, 'The original preview no longer matches the current destination revision.');
    assert.equal(h.writes.length, 0); assert.match(h.text(), /changed|review.*again|current.*impact/i);
  });
});

for(const kind of ['detail','finance']as const)test(`mounted ${kind} obsolete review unlocks only after a fresh exact read and retains draft on failed, foreign or changed-scope reads`,async()=>{
  await mount(kind,async h=>{
    const path=kind==='finance'?h.financePath:policy.electiveChangeRead(change),label=kind==='finance'?'Reason and evidence reviewed':'Reason',reviewButton=kind==='finance'?'Review current account':'Review current request';
    if(kind==='detail')await h.press('Withdraw request');
    await h.fill(label,'My retained unsent review notes.');h.write.obsolete=true;h.write.locked=true;await h.refresh();
    const original=h.queries[path].data;
    for(const mode of ['failed','foreign','scope']as const){
      h.queries[path].refetch=async()=>{if(mode==='failed')throw new Error('Current source unavailable');if(mode==='scope')h.changeScope();return {data:{...original,id:mode==='foreign'?id(99):original.id,revision:original.revision+1}};};
      await h.refresh();await h.press(reviewButton);assert.equal(h.reviewed.length,0,mode);assert.equal(h.input(label)?.value,'My retained unsent review notes.',mode);assert.equal(h.writes.length,0,mode);assert.equal(h.write.locked,true,mode);
    }
    h.queries[path].refetch=async()=>({data:original});await h.refresh();await h.press(reviewButton);assert.equal(h.reviewed.length,1);assert.equal(h.writes.length,0);
  });
});

test('saved no-change Finance classification shows the recorded decision and academic next step after exact fresh readback',async()=>{
  await mount('finance',async h=>{
    const reason='Reviewed the current ledger; this elective needs no financial adjustment.';
    await h.choose('Decision','no_financial_change');await h.fill('Reason and evidence reviewed',reason);await h.press('Review decision');await h.press('Confirm Finance decision');
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.outcome,'no_financial_change');
    const fresh={...finance(),revision:2,state:'no_financial_change',can_classify:false,latest_decision:{id:id(30),outcome:'no_financial_change',reason}};
    await h.acceptFresh(fresh);
    assert.match(h.text(),/Last recorded decision/);assert.match(h.text(),/Reviewed the current ledger/);assert.match(h.text(),/No financial change was recorded/);assert.match(h.text(),/academic owner.*review.*current request.*applying/i);
    assert.doesNotMatch(h.text(),/cannot currently be decided by your account|assign the current Finance responsibility/);assert.equal(h.button('Review decision'),undefined);assert.equal(h.button('Confirm Finance decision'),undefined);assert.equal(h.writes.length,1);
  });
});
test('closed elective Finance views explain applied or withdrawn status while an undecidable open review retains its responsibility warning',async()=>{
  await mount('finance',async h=>{
    for(const [state,copy]of [['applied',/elective change has been applied/i],['withdrawn',/elective request was withdrawn/i]]as const){
      await h.acceptFresh({...finance(),revision:3,state,can_classify:false});
      assert.match(h.text(),copy);assert.match(h.text(),/No further Finance decision is needed/);assert.doesNotMatch(h.text(),/cannot currently be decided by your account|assign the current Finance responsibility/);assert.equal(h.button('Review decision'),undefined);assert.equal(h.writes.length,0);
    }
    await h.acceptFresh({...finance(),revision:4,state:'requires_financial_review',can_classify:false});
    assert.match(h.text(),/cannot currently be decided by your account/);assert.match(h.text(),/academic owner can assign the current Finance responsibility/);assert.equal(h.writes.length,0);
  });
});

const openReview=(reviewId=id(40),name='Statistical Learning')=>({id:reviewId,revision:2,state:'no_financial_change',destination_name:name,effective_on:'2026-11-16'});
test('current open elective reviews default to continuing the exact selected review after a fresh options read',async()=>mount('request',async h=>{
  const first=openReview(),second=openReview(id(41),'Research Methods');h.queries[h.optionPath]={data:{...options(),open_reviews:[first,second]}};await h.refresh();
  assert.match(h.text(),/Existing elective reviews/);assert.equal(h.button('Review impact'),undefined);assert.equal(h.button('Save change for review'),undefined);assert.equal(h.navigated.length,0);assert.equal(h.writes.length,0);
  let reads=0;h.queries[h.optionPath].refetch=async()=>{reads++;return {data:{...options(),open_reviews:[{...first,revision:3},second]}};};await h.refresh();
  await h.press('Continue Research Methods');assert.equal(reads,1);assert.deepEqual(h.navigated,[`/areas/messages/assignments?scope=elective_change&change_id=${id(41)}`]);assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
}));
test('retained learning action or malformed open-review discovery never exposes another continuation or new request',async()=>{
  await mount('request',async h=>{h.queries[h.optionPath]={data:{...options(),open_reviews:[openReview()]}};h.write.action={phase:'unknown',ownerHref:'/original',payload:{kind:'json',body:'{}'}};h.write.locked=true;await h.refresh();assert.match(h.text(),/original reviewed change is retained/);assert.equal(h.button('Continue Statistical Learning'),undefined);assert.equal(h.button('Review impact'),undefined);assert.equal(h.navigated.length,0);assert.equal(h.writes.length,0);});
  await mount('request',async h=>{h.queries[h.optionPath]={data:{...options(),open_reviews:[{...openReview(),id:'not-a-review'}]}};await h.refresh();assert.match(h.text(),/Existing elective reviews could not be confirmed/);assert.equal(h.button('Review impact'),undefined);assert.equal(h.navigated.length,0);assert.equal(h.writes.length,0);});
});
test('continue refuses failed, foreign, changed-context or newly retained-action reads without navigating or issuing a command',async()=>{
  for(const mode of ['failed','foreign','scope','pending','closed']as const)await mount('request',async h=>{
    const current={...options(),open_reviews:[openReview()]};h.queries[h.optionPath]={data:current};await h.refresh();
    let resolve!:(value:any)=>void;h.queries[h.optionPath].refetch=()=>new Promise(done=>{resolve=done;});await h.refresh();await h.press('Continue Statistical Learning');
    if(mode==='scope')h.changeScope();if(mode==='pending'){h.write.action={phase:'unknown',ownerHref:'/original',payload:{kind:'json',body:'{}'}};h.write.locked=true;await h.refresh();}
    await act(async()=>resolve(mode==='failed'?Promise.reject(new Error('Source unavailable')):{data:mode==='foreign'?{...current,person:{...current.person,id:id(99)}}:mode==='closed'?{...current,open_reviews:[]}:current}));
    assert.equal(h.navigated.length,0,mode);assert.equal(h.writes.length,0,mode);assert.equal(h.requests.length,0,mode);
  });
});
test('a fresh open review discovered before send prevents a duplicate and preserves unsent choices for later explicit review',async()=>mount('request',async h=>{
  await h.choose('New course',destination);await h.fill('Reason for change','Keep these unsent elective choices.');await h.fill('Why catch-up is not needed','The introductory material is available.');await h.press('Review impact');
  const current={...options(),open_reviews:[openReview()]};h.queries[h.optionPath].refetch=async()=>{h.queries[h.optionPath].data=current;return {data:current};};await h.refresh();await h.press('Save change for review');await h.refresh();
  assert.equal(h.writes.length,0);assert.match(h.text(),/Existing elective reviews/);assert.equal(h.navigated.length,0);
  h.queries[h.optionPath]={data:{...options(),open_reviews:[]}};await h.refresh();assert.equal(h.input('Reason for change')?.value,'Keep these unsent elective choices.');assert.equal(h.button('Save change for review'),undefined);assert.ok(h.button('Review impact'));assert.equal(h.writes.length,0);
}));
