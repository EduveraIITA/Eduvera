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
const campusRoute = '/more/account/campuses';
const endpoint = `/api/v1/agent/threads/${threadId}/runs/${runId}`;
const receipt = (toolCallId: string, status: string) => ({
  type:'TOOL_CALL_RESULT',toolCallId,messageId:`${toolCallId}:result`,role:'tool',content:JSON.stringify({status}),
});
const packet = (pending?: { id: string; name: copilot.CopilotToolName }, outcomes: ReturnType<typeof receipt>[] = []) => ({
  version:'1.0',events:[
    {type:'RUN_STARTED',threadId,runId,protocolVersion:'1.0'}, ...outcomes,
    ...(pending ? [
      {type:'CUSTOM',name:'thatcampus.workflow-step',value:{version:1,call_id:pending.id}},
      {type:'TOOL_CALL_START',toolCallId:pending.id,toolCallName:pending.name},
      {type:'TOOL_CALL_ARGS',toolCallId:pending.id,delta:'{}'},
      {type:'TOOL_CALL_END',toolCallId:pending.id},
    ] : []),
    {type:'RUN_FINISHED',threadId,runId,result:{status:'completed'},
      ...(pending ? {outcome:{type:'success',pendingToolCallIds:[pending.id]}} : {})},
  ],
});
const initial = packet({id:first,name:'open_campus_create'});
const continuation = packet({id:second,name:'prepare_campus_create'},[receipt(first,'applied')]);
const complete = packet(undefined,[receipt(first,'applied'),receipt(second,'applied')]);

async function runWorkflow(mode: 'retry' | 'stop-before-receipt' | 'stop-after-receipt') {
  const dom = new JSDOM('<div id="root"></div>'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let pathname = '/today', runtime!: Runtime, arrival!: (applied: boolean) => void, finishReceipt!: (value: unknown) => void, reveals = 0;
  const pendingNavigation = new Promise<boolean>(resolve=>{arrival=resolve;});
  const reply = new Promise<unknown>(resolve=>{finishReceipt=resolve;});
  const posts: { call_id: string; status: string }[] = [], controls: string[] = [];
  const dependencies: Record<string,unknown> = {
    react:React,'react/jsx-runtime':require('react/jsx-runtime'),
    'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
    'expo-router':{useIsFocused:()=>true,usePathname:()=>pathname,useRootNavigationState:()=>undefined},
    '../auth/SessionProvider':{useSession:()=>({status:'authenticated',scopeKey:'actor:campus:live',environment:{mode:'live'}})},
    '../lib/api':{
      ApiError, captureApiContext:()=>({assertCurrent(){}}),
      async apiFetch(path: string, init?: RequestInit) {
        if (path===`${endpoint}/events`) return initial;
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
      return ()=>{disposeOpen();disposePrepare();};
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
