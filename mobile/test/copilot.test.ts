import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campusTransitionKind } from '../src/lib/back-policy';
import { copilotIsPublishedMap, copilotPublishedMapHref, copilotRouteContext, parseCopilotContext, readCopilotBatch, readCopilotBuildingSelectionReply, readCopilotPlan, readCopilotWorkflowReply } from '../src/lib/copilot';

const threadId = 'thread', runId = 'run', toolCallId = 'call_1';
const event = (type: string, body: Record<string, unknown> = {}) => ({ type, ...body });
const head = [event('RUN_STARTED', { threadId, runId, protocolVersion: '1.0' }), event('STATE_SNAPSHOT', { snapshot: { status: 'completed' } })];
const tail = event('RUN_FINISHED', { threadId, runId, outcome: { type: 'success', pendingToolCallIds: [toolCallId] } });
const start = event('TOOL_CALL_START', { toolCallId, toolCallName: 'campus_search_places' });
const arg = (delta: string) => event('TOOL_CALL_ARGS', { toolCallId, delta });
const end = event('TOOL_CALL_END', { toolCallId });
const batch = (...body: Record<string, unknown>[]) => ({ version: '1.0', events: [...head, ...body, tail] });

test('only a complete tool call on the exact run can operate a registered control', () => {
  const result = batch(start, arg('{"query":'), arg('"Library"}'), end);
  assert.deepEqual(readCopilotPlan(result,threadId,runId), [{ id:toolCallId, name:'campus_search_places', args:{ query:'Library' } }]);
  assert.equal(readCopilotPlan(result,'other thread',runId),null);
  assert.equal(readCopilotPlan(result,threadId,'old run'),null);
  assert.equal(readCopilotPlan(batch(start,arg('{"query":"Library"}')),threadId,runId),null);
  assert.equal(readCopilotPlan(batch(start,arg('{}'),end),threadId,runId),null);
  assert.equal(readCopilotPlan(batch(start,arg('{"query":"Library","href":"/more/account"}'),end),threadId,runId),null);
  assert.equal(readCopilotPlan(batch(start,arg('{"query":"Library"}'),end,start),threadId,runId),null);
  assert.equal(readCopilotPlan(batch(event('TOOL_CALL_START',{toolCallId,toolCallName:'submit_form'}),arg('{}'),end),threadId,runId),null);
  assert.equal(readCopilotPlan({version:'1.0',events:[...head,start,arg('{"query":"Library"}'),end,event('RUN_ERROR',{message:'failed'})]},threadId,runId),null);
});

test('client context has a bounded route and takes no record values or URL', () => {
  assert.deepEqual(parseCopilotContext({screen:'virtual_campus',tools:['campus_open_picker'],last_result:{tool:'campus_focus_place',status:'blocked'}}),
    {screen:'virtual_campus',tools:['campus_open_picker'],last_result:{tool:'campus_focus_place',status:'blocked'}});
  assert.equal(parseCopilotContext({screen:'virtual_campus',tools:['open_virtual_campus']}),null);
  assert.equal(parseCopilotContext({screen:'workspace',tools:['open_virtual_campus','open_virtual_campus']}),null);
  assert.equal(parseCopilotContext({screen:'workspace',tools:[],href:'/more/account'}),null);
  assert.equal(parseCopilotContext({screen:'workspace',tools:[],last_result:{tool:'campus_focus_place',status:'applied',name:'Library'}}),null);
});


test('registered screen identity tracks its owning source, without carrying transient controls', () => {
  assert.deepEqual(copilotRouteContext('/more/virtual-campus','/more/virtual-campus?campus_id=one&map_panel=search'),
    {screen:'virtual_campus',identity:['one']});
  assert.deepEqual(copilotRouteContext('/more/virtual-campus','/more/virtual-campus?campus_id=two&map_panel=layers'),
    {screen:'virtual_campus',identity:['two']});
  assert.deepEqual(copilotRouteContext('/more/account','/more/account?campus_id=two'),{screen:'workspace',identity:[]});
});

test('campus creation uses the declared route then opens its form in order', () => {
  const first = 'navigate', second = 'prepare';
  const tool = (id: string, name: string, delta: string) => [
    event('TOOL_CALL_START', { toolCallId: id, toolCallName: name }),
    event('TOOL_CALL_ARGS', { toolCallId: id, delta }),
    event('TOOL_CALL_END', { toolCallId: id }),
  ];
  const navigate = tool(first, 'open_campus_create', '{}');
  const prepare = tool(second, 'prepare_campus_create', '{"name":"North Campus"}');
  const finish = (pendingToolCallIds: string[]) => event('RUN_FINISHED', { threadId, runId, outcome: { type: 'success', pendingToolCallIds } });
  const read = (...events: Record<string, unknown>[]) => readCopilotPlan({ version: '1.0', events: [...head, ...events] }, threadId, runId);
  assert.deepEqual(read(...navigate, ...prepare, finish([first, second])), [
    { id: first, name: 'open_campus_create', args: {} },
    { id: second, name: 'prepare_campus_create', args: { name: 'North Campus' } },
  ]);
  assert.equal(read(...navigate, ...prepare, finish([second, first])), null);
  assert.equal(read(...prepare, ...navigate, finish([second, first])), null);
  assert.equal(read(...navigate, ...tool(second, 'campus_open_picker', '{}'), finish([first, second])), null);
  const campus_id = '861291df-e176-47e8-8595-e48161a8e61f';
  assert.deepEqual(parseCopilotContext({ screen: 'virtual_campus', tools: ['open_campus_interiors'], campus_id }),
    { screen: 'virtual_campus', tools: ['open_campus_interiors'], campus_id });
  assert.equal(parseCopilotContext({ screen: 'workspace', tools: [], campus_id }), null);
});


test('staged workspace creation binds each graph marker and receipt to the exact action', () => {
  const first = '169fadb6-a106-41b2-9ba3-792ea74cdbe6', second = '839a86d0-4f4c-4d8c-aafe-c0943305357e';
  const navigate = { id: first, name: 'open_campus_create' as const, args: {} };
  const prepare = { id: second, name: 'prepare_campus_create' as const, args: {name:'North Campus'} };
  const workflow = (id: string) => event('CUSTOM', { name:'thatcampus.workflow-step',value:{version:1,call_id:id} });
  const receipt = (id: string, status: string) => event('TOOL_CALL_RESULT', {
    role:'tool',messageId:`${id}:result`,toolCallId:id,content:JSON.stringify({status}),
  });
  const packet = (events: Record<string,unknown>[], pending?: string) => ({ version: '1.0', events: [
    ...head,...events,event('RUN_FINISHED',{ threadId,runId,result:{status:'completed'},
      ...(pending ? {outcome:{type:'success',pendingToolCallIds:[pending]}} : {}) }),
  ] });
  const tool = ({id,name,args}: typeof navigate | typeof prepare) => [
    event('TOOL_CALL_START',{toolCallName:name,toolCallId:id}),
    event('TOOL_CALL_ARGS',{toolCallId:id,delta:JSON.stringify(args)}),
    event('TOOL_CALL_END',{toolCallId:id}),
  ];
  assert.deepEqual(parseCopilotContext({screen:'workspace',tools:['open_campus_create'],workflow_steps:true}),
    {screen:'workspace',tools:['open_campus_create'],workflow_steps:true});
  assert.equal(parseCopilotContext({screen:'workspace',tools:['open_campus_create'],workflow_steps:false}),null);
  assert.equal(readCopilotBatch(packet([workflow(first),...tool(navigate)],first),threadId,runId)?.workflowCallId,first);
  for (const bad of [
    packet([workflow(second),...tool(navigate)],first),
    packet([workflow(first),workflow(first),...tool(navigate)],first),
    packet([workflow(first),...tool(navigate)]),
    packet([workflow(first)]),
    packet([workflow(first),...tool(navigate),...tool(prepare)],first),
  ]) assert.equal(readCopilotBatch(bad,threadId,runId),null);
  const continued = packet([receipt(first,'applied'),workflow(second),...tool(prepare)],second);
  assert.deepEqual(readCopilotWorkflowReply(continued,threadId,runId,navigate),{kind:'step',intent:prepare});
  assert.equal(readCopilotWorkflowReply(continued,threadId,'wrong',navigate),null);
  assert.equal(readCopilotWorkflowReply(continued,threadId,runId,prepare),null);
  for (const bad of [
    packet([workflow(second),...tool(prepare)],second),
    packet([receipt(first,'blocked'),workflow(second),...tool(prepare)],second),
    packet([receipt(first,'applied'),...tool(prepare)],second),
    packet([receipt(second,'applied'),workflow(second),...tool(prepare)],second),
    packet([receipt(first,'applied'),receipt(first,'applied'),workflow(second),...tool(prepare)],second),
  ]) assert.equal(readCopilotWorkflowReply(bad,threadId,runId,navigate),null);
  assert.deepEqual(readCopilotWorkflowReply(packet([receipt(first,'applied'),receipt(second,'applied')]),threadId,runId,prepare),
    {kind:'finished',status:'applied'});
});

test('a building checkpoint and resume bind the exact run, campus, human receipt and editor', () => {
  const step = '169fadb6-a106-41b2-9ba3-792ea74cdbe6', editor = '839a86d0-4f4c-4d8c-aafe-c0943305357e';
  const campus = '861291df-e176-47e8-8595-e48161a8e61f';
  const selection = { campus_id: campus, element_id: 'osm-123' };
  const option = { ...selection, label: 'Computing Center 3', campus_name: 'Main campus' };
  const custom = (name: string,value: unknown) => event('CUSTOM',{name,value});
  const checkpoint = custom('thatcampus.building-selection',{version:1,step_id:step,target:'CC3',options:[option]});
  const packet = (events: Record<string,unknown>[], pending?: string) => ({ version:'1.0', events:[
    ...head,...events,event('RUN_FINISHED',{threadId,runId,result:{status:'completed'},
      ...(pending ? {outcome:{type:'success',pendingToolCallIds:[pending]}} : {})}),
  ] });
  const approved = event('TOOL_CALL_RESULT',{role:'tool',messageId:`${step}:result`,toolCallId:step,content:'{"status":"applied"}'});
  const editorSteps = (args:unknown) => [
    custom('thatcampus.workflow-step',{version:1,call_id:editor}),
    event('TOOL_CALL_START',{toolCallId:editor,toolCallName:'open_campus_interiors'}),
    event('TOOL_CALL_ARGS',{toolCallId:editor,delta:JSON.stringify(args)}),
    event('TOOL_CALL_END',{toolCallId:editor}),
  ];
  assert.equal(readCopilotBatch(packet([checkpoint]),threadId,runId)?.interiorCheckpoint?.target,'CC3');
  assert.equal(readCopilotBatch(packet([checkpoint,checkpoint]),threadId,runId),null);
  assert.equal(readCopilotBatch(packet([checkpoint,...editorSteps({campus_id:campus,building_id:'osm-123'})],editor),threadId,runId),null);
  const valid = packet([approved,...editorSteps({campus_id:campus,building_id:'osm-123'})],editor);
  const read = (value:unknown, target=selection) => readCopilotBuildingSelectionReply(value,threadId,runId,step,target);
  assert.equal(read(valid)?.kind,'step');
  assert.equal(read(packet([checkpoint]))?.kind,'wait');
  assert.equal(read(packet([approved]))?.kind,'finished');
  assert.equal(read(valid,{...selection,element_id:'other-building'}),null);
  assert.equal(read(packet([...editorSteps({campus_id:campus,building_id:'osm-123'})],editor)),null);
  assert.equal(read(packet([approved,...editorSteps({campus_id:campus,building_id:'../osm-123'})],editor)),null);
  assert.equal(readCopilotBuildingSelectionReply(valid,threadId,'old-run',step,selection),null);
});

test('showing the published map opens the exact campus instead of backing out of its editor', () => {
  const campus = '861291df-e176-47e8-8595-e48161a8e61f';
  const editor = `/more/virtual-campus?campus_id=${campus}&edit=1&indoor=1&indoor_building_id=osm-cc3`;
  const destination = copilotPublishedMapHref(campus);
  const params = Object.fromEntries(new URL(destination, 'https://thatcampus.invalid').searchParams);
  assert.equal(params.campus_id, campus);
  assert.equal(params.edit, '0');
  assert.equal(params.indoor, '0');
  assert.equal(campusTransitionKind(editor, destination), 'open');
  assert.equal(copilotIsPublishedMap('/more/virtual-campus', params), true);
  assert.equal(copilotIsPublishedMap('/more/virtual-campus', { edit: ['0', '1'] }), false);
  assert.equal(copilotIsPublishedMap('/more/virtual-campus', { indoor: '1' }), false);
  assert.equal(copilotIsPublishedMap('/today', params), false);
});
