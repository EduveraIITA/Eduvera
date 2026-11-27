import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copilotRouteContext, parseCopilotContext, readCopilotIntent } from '../src/lib/copilot';

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
  assert.deepEqual(readCopilotIntent(result,threadId,runId), { id:toolCallId, name:'campus_search_places', args:{ query:'Library' } });
  assert.equal(readCopilotIntent(result,'other thread',runId),null);
  assert.equal(readCopilotIntent(result,threadId,'old run'),null);
  assert.equal(readCopilotIntent(batch(start,arg('{"query":"Library"}')),threadId,runId),null);
  assert.equal(readCopilotIntent(batch(start,arg('{}'),end),threadId,runId),null);
  assert.equal(readCopilotIntent(batch(start,arg('{"query":"Library","href":"/more/account"}'),end),threadId,runId),null);
  assert.equal(readCopilotIntent(batch(start,arg('{"query":"Library"}'),end,start),threadId,runId),null);
  assert.equal(readCopilotIntent(batch(event('TOOL_CALL_START',{toolCallId,toolCallName:'submit_form'}),arg('{}'),end),threadId,runId),null);
  assert.equal(readCopilotIntent({version:'1.0',events:[...head,start,arg('{"query":"Library"}'),end,event('RUN_ERROR',{message:'failed'})]},threadId,runId),null);
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
