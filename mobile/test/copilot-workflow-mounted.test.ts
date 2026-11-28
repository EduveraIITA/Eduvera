import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { ApiConnectionError, ApiError } from '../src/lib/api-client';
import * as copilot from '../src/lib/copilot';

const require = createRequire(import.meta.url);
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): { render(children: React.ReactNode): void; unmount(): void } };
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };
type Runtime = ReturnType<typeof import('../src/ui/CopilotProvider').useCopilot>;
type ProviderModule = Pick<typeof import('../src/ui/CopilotProvider'), 'CopilotProvider' | 'useCopilot'>;
const threadId = '4fbffbf7-508a-4aab-b5fe-f252ea61e461', runId = '2b080e75-8198-4233-8d35-80cc14b8d38e';
const first = '2f73a043-69c6-4bfe-8109-27c554bd63dc', second = '3de78adc-9b88-4a67-a1d2-5aa4f8796677';
const campusRoute = '/more/account/campuses', mapRoute = '/more/virtual-campus';
const campusId = '52f73a50-b20f-4e65-9c00-2473ebaa36c6', buildingId = 'osm-way-33445';
const option = { campus_id: campusId, element_id: buildingId, label: 'Computing Center 3', campus_name: 'Main campus' };
const selection = { campus_id: campusId, element_id: buildingId };
const endpoint = `/api/v1/agent/threads/${threadId}/runs/${runId}`;
const receipt = (toolCallId: string, status: string) => ({
  type:'TOOL_CALL_RESULT',toolCallId,messageId:`${toolCallId}:result`,role:'tool',content:JSON.stringify({status}),
});
const packet = (pending?: { id: string; name: copilot.CopilotToolName; args?: Record<string, string>; staged?: boolean }, outcomes: ReturnType<typeof receipt>[] = []) => ({
  version:'1.0',events:[
    {type:'RUN_STARTED',threadId,runId,protocolVersion:'1.0'}, ...outcomes,
    ...(pending ? [
      ...(pending.staged === false ? [] : [{type:'CUSTOM',name:'thatcampus.workflow-step',value:{version:1,call_id:pending.id}}]),
      {type:'TOOL_CALL_START',toolCallId:pending.id,toolCallName:pending.name},
      {type:'TOOL_CALL_ARGS',toolCallId:pending.id,delta:JSON.stringify(pending.args ?? {})},
      {type:'TOOL_CALL_END',toolCallId:pending.id},
    ] : []),
    {type:'RUN_FINISHED',threadId,runId,result:{status:'completed'},
      ...(pending ? {outcome:{type:'success',pendingToolCallIds:[pending.id]}} : {})},
  ],
});
const initial = packet({id:first,name:'open_campus_create'});
const continuation = packet({id:second,name:'prepare_campus_create'},[receipt(first,'applied')]);
const complete = packet(undefined,[receipt(first,'applied'),receipt(second,'applied')]);

function selectionPacket(options: copilot.InteriorOption[], openMap = false) {
  const value = packet(openMap ? {id:second,name:'open_virtual_campus',staged:false} : undefined);
  return { ...value, events: [value.events[0], {type:'CUSTOM',name:'thatcampus.building-selection',
    value:{version:1,step_id:first,target:'CC3',options}}, ...value.events.slice(1)] };
}
const interior = packet({id:second,name:'open_campus_interiors',args:{campus_id:campusId,building_id:buildingId}},[receipt(first,'applied')]);

async function runWorkflow(mode: 'retry' | 'stop-before-receipt' | 'stop-after-receipt' | 'interior' | 'interior-cancel' | 'interior-scope-loss') {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let pathname = '/today', scopeKey = 'actor:campus:live', runtime!: Runtime, arrival!: (applied: boolean) => void, finishReceipt!: (value: unknown) => void, reveals = 0;
  const pendingNavigation = new Promise<boolean>(resolve=>{arrival=resolve;});
  const reply = new Promise<unknown>(resolve=>{finishReceipt=resolve;});
  const posts: { call_id: string; status: string }[] = [], controls: string[] = [];
  const interiorPosts: unknown[] = [], isInterior = mode.startsWith('interior');
  const dependencies: Record<string,unknown> = {
    react:React,'react/jsx-runtime':require('react/jsx-runtime'),
    'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
    'expo-router':{useIsFocused:()=>true,usePathname:()=>pathname,useRootNavigationState:()=>undefined},
    '../auth/SessionProvider':{useSession:()=>({status:'authenticated',scopeKey,environment:{mode:'live'}})},
    '../lib/api':{
      ApiError, captureApiContext:()=>({assertCurrent(){}}),
      async apiFetch(path: string, init?: RequestInit) {
        if (path===`${endpoint}/events`) return isInterior ? selectionPacket([], true) : initial;
        if (path===`${endpoint}/interior-selection`) {
          assert.ok(isInterior);
          assert.equal(init?.method,'POST');
          const body = JSON.parse(String(init?.body));
          interiorPosts.push(body);
          if (body.cancel) return packet(undefined,[receipt(first,'stopped')]);
          return body.selection?.element_id ? reply : selectionPacket([option]);
        }
        assert.equal(path,`${endpoint}/ui-receipt`); assert.equal(init?.method,'POST');
        const body = JSON.parse(String(init?.body));
        posts.push(body);
        if (body.status==='stopped') return packet(undefined,[receipt(first,'stopped')]);
        if (body.call_id===second) return complete;
        if (mode==='retry' && posts.length===1) throw new ApiConnectionError('Temporary connection loss');
        // Keep the response pending even if this transport ignores AbortSignal.
        // The application ownership fence must still catch the late packet.
        return reply;
      },
    },
    '../lib/api-client':{ApiConnectionError},
    '../lib/back-policy':{focusedCampusRoute:()=>undefined,campusHrefForRoute:()=>undefined},
    '../lib/copilot':copilot,
    '../lib/copilot-target':{copilotWait:()=>Promise.resolve(),measureCopilotTarget:()=>Promise.resolve(null)},
  };
  const text = readFileSync(new URL('../src/ui/CopilotProvider.tsx',import.meta.url),'utf8');
  const compiled = ts.transpileModule(text,{compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
  }}).outputText;
  const exports: Partial<ProviderModule> = {};
  runInNewContext(compiled,{exports,AbortController,setTimeout,clearTimeout,require(name:string){
    assert.ok(name in dependencies,name);return dependencies[name];
  }});
  const Provider=exports.CopilotProvider!;
  function Probe() {
    runtime=exports.useCopilot!();
    React.useLayoutEffect(()=>{
      const disposeOpen=runtime.register({name:'open_campus_create',label:'Open Your campuses',destinationPath:campusRoute,
        available:()=>pathname==='/today',run:()=>{controls.push('open');return pendingNavigation;}});
      const disposePrepare=runtime.register({name:'prepare_campus_create',label:'Prepare form',
        available:()=>pathname===campusRoute,run:()=>{controls.push('prepare');return true;}});
      const disposeMap = runtime.register({name:'open_virtual_campus',label:'Open Virtual Campus',destinationPath:mapRoute,
        available:()=>pathname==='/today',run:()=>{controls.push('map');return pendingNavigation;}});
      const disposeEditor = runtime.register({name:'open_campus_interiors',label:'Open interior setup',destinationPath:mapRoute,
        available:()=>pathname===mapRoute,run:args=>{controls.push(`editor:${args.building_id}`);return true;}});
      return ()=>{disposeOpen();disposePrepare();disposeMap();disposeEditor();};
    },[]);
    return null;
  }
  const renderer=createRoot(dom.window.document.getElementById('root')!);
  const render=async()=>{await act(async()=>renderer.render(React.createElement(Provider,null,React.createElement(Probe))));};
  try {
    await render();
    const context=runtime.context();assert.equal(context?.workflow_steps,true);
    const lease=runtime.capture(context!);assert.ok(lease);
    await act(async()=>runtime.follow({id:runId,threadId,lease}));
    await act(async()=>runtime.inspect(runId,()=>{reveals++;}));
    if (isInterior) {
      assert.deepEqual(controls,['map']);
      pathname=mapRoute;await render();
      await act(async()=>arrival(true));
      assert.equal(runtime.pending,null,'the assistant parks without locking the composer');
      assert.equal(runtime.interiorSelection?.step_id,first);
      await act(async()=>runtime.takeOver());
      assert.equal(runtime.interiorSelection?.step_id,first,'manual map movement preserves the checkpoint');
      assert.equal(runtime.selectInteriorTarget({campus_id:campusId,element_id:'../../unknown'}),false);
      await act(async()=>{assert.equal(runtime.selectInteriorTarget({campus_id:campusId}),true);});
      assert.deepEqual(interiorPosts,[{step_id:first,selection:{campus_id:campusId}}]);
      assert.equal(runtime.interiorSelection?.options[0]?.label,option.label);
      await act(async()=>{
        assert.equal(runtime.selectInteriorTarget(selection),true);
        assert.equal(runtime.selectInteriorTarget(selection),true);
      });
      assert.equal(runtime.interiorSelection?.submitting,true);
      assert.equal(interiorPosts.length,2,'duplicate taps share the waiting submission');
      if (mode==='interior-cancel')
        await act(async()=>runtime.cancelInteriorSelection(threadId,first));
      if (mode==='interior-scope-loss') {
        scopeKey = 'actor:other-campus:live';
        await render();
      }
      await act(async()=>finishReceipt(interior));
      assert.equal(runtime.interiorSelection,null);
      assert.equal(runtime.pending,null);
      if (mode!=='interior') {
        assert.deepEqual(controls,['map']);
        assert.deepEqual(posts,[]);
        if (mode==='interior-cancel') assert.deepEqual(interiorPosts.at(-1),{step_id:first,cancel:true});
        else assert.equal(interiorPosts.length,2,'the changed campus does not send a cancellation under the new identity');
      } else {
        assert.deepEqual(controls,['map',`editor:${buildingId}`]);
        assert.deepEqual(posts,[{call_id:second,status:'applied'}]);
      }
      return;
    }
    assert.deepEqual(controls,['open']);assert.equal(reveals,1);
    if (mode==='stop-before-receipt') {
      await act(async()=>runtime.takeOver());
      await act(async()=>arrival(true));
      assert.deepEqual(controls,['open']);
      assert.deepEqual(posts,[{call_id:first,status:'stopped'}]);
      assert.equal(runtime.detail,null);assert.equal(runtime.pending,null);
      return;
    }
    pathname=campusRoute;await render();
    await act(async()=>arrival(true));
    const navigation = {call_id:first,status:'applied'};
    assert.deepEqual(posts,mode==='retry'?[navigation,navigation]:[navigation]);
    assert.deepEqual(controls,['open'],'waits for the exact approved response before opening the form');
    if (mode==='stop-after-receipt') await act(async()=>runtime.takeOver());
    await act(async()=>finishReceipt(continuation));
    if (mode==='stop-after-receipt') {
      assert.deepEqual(controls,['open']);
      assert.deepEqual(posts,[navigation]);
      assert.equal(runtime.detail,null);assert.equal(runtime.pending,null);
      return;
    }
    assert.deepEqual(controls,['open','prepare']);
    assert.deepEqual(posts,[navigation,navigation,{call_id:second,status:'applied'}]);
    assert.equal(reveals,1,'the second stage leaves the existing Assistant overlay in place');
    assert.equal(runtime.pending,null);
    assert.equal(runtime.detail?.id,second,'A2UI name card remains bound to the approved form');
  } finally {
    await act(async()=>renderer.unmount());
    Object.assign(globalThis,{window:oldWindow,document:oldDocument,IS_REACT_ACT_ENVIRONMENT:false});dom.window.close();
  }
}

test('the mounted Copilot resumes the owned setup through a retried receipt without replaying its UI action',async()=>runWorkflow('retry'));
test('the mounted Copilot reports a stopped step before acknowledging navigation',async()=>runWorkflow('stop-before-receipt'));
test('taking over fences a late valid response to the previous stage',async()=>runWorkflow('stop-after-receipt'));

test('a map building selection resumes the original conversation through the exact editor receipt',async()=>runWorkflow('interior'));
test('stopping while a building selection is in flight fences a late editor action',async()=>runWorkflow('interior-cancel'));
test('switching campus workspaces fences a late editor action from the previous workspace',async()=>runWorkflow('interior-scope-loss'));
