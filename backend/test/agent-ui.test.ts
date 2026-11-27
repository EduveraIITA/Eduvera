import { describe, expect, it } from 'vitest';
import {
  advertisedClientTools, clientUiContextSchema, clientUiPrompt, parseClientUiCall,
  projectAssistantAgUi, restoreClientUiCall,
} from '../src/agent/agent-ui.js';

describe('Assistant AG-UI client controls', () => {
  it('advertises only known controls for the advertised screen and strictly bounds their inputs', () => {
    const context=clientUiContextSchema.parse({screen:'virtual_campus',tools:['campus_focus_place','campus_open_picker'],
      last_result:{tool:'open_virtual_campus',status:'applied'}});
    expect(advertisedClientTools(context).map(tool=>tool.name)).toEqual(['campus_focus_place','campus_open_picker']);
    expect(advertisedClientTools(undefined)).toEqual([]);
    expect(clientUiContextSchema.safeParse({screen:'workspace',tools:['campus_focus_place']}).success).toBe(false);
    expect(clientUiContextSchema.safeParse({screen:'virtual_campus',tools:['campus_focus_place','campus_focus_place']}).success).toBe(false);
    expect(clientUiContextSchema.safeParse({screen:'virtual_campus',tools:['navigate']}).success).toBe(false);
    expect(clientUiContextSchema.safeParse({screen:'workspace',tools:['open_virtual_campus'],source:'foreign'}).success).toBe(false);
    expect(clientUiPrompt(context)).toContain('open_virtual_campus as applied');
    expect(parseClientUiCall(context,'campus_open_picker',{})).toEqual({tool:'campus_open_picker',arguments:{}});
    expect(parseClientUiCall(context,'campus_focus_place',{query:'  Library  '})).toEqual({tool:'campus_focus_place',arguments:{query:'Library'}});
    expect(parseClientUiCall(context,'campus_focus_place',{query:'Lab',route:'/private'})).toBeUndefined();
    expect(parseClientUiCall(context,'campus_focus_place',{query:'\u0000Lab'})).toBeUndefined();
    expect(parseClientUiCall(context,'campus_focus_place',{query:'x'.repeat(121)})).toBeUndefined();
    expect(parseClientUiCall(context,'campus_search_places',{query:'Library'})).toBeUndefined();
    expect(parseClientUiCall(undefined,'campus_open_picker',{})).toBeUndefined();
    expect(restoreClientUiCall('id',{tool:'generic_action',arguments:{}})).toBeUndefined();
    expect(restoreClientUiCall('id',{tool:'open_virtual_campus',arguments:{route:'/private'}})).toBeUndefined();
  });

  const run={threadId:'thread-1',runId:'run-1',progress:'Working',answer:'Find the building.',
    evidence:[{id:'licensed-report',chart:{points:[]},title:'Private title',href:'/hidden',tool_arguments:{student_id:'private'}},{id:'owner-source'}],
    clientCall:restoreClientUiCall('owned-call',{tool:'campus_focus_place',arguments:{query:'Library'}})!,actionId:'pending-action'};

  it('projects a running snapshot and a bounded complete AG-UI call sequence without route or private tool metadata', () => {
    const working=projectAssistantAgUi({...run,status:'running'});
    expect(working).toEqual({version:'1.0',events:[
      {type:'RUN_STARTED',threadId:'thread-1',runId:'run-1',protocolVersion:'1.0'},
      {type:'STATE_SNAPSHOT',snapshot:{status:'running',progress:'Working'}},
    ]});
    const completed=projectAssistantAgUi({...run,status:'completed'});
    expect(completed.events.map(event=>event.type)).toEqual([
      'RUN_STARTED','STATE_SNAPSHOT','TEXT_MESSAGE_START','TEXT_MESSAGE_CONTENT','TEXT_MESSAGE_END',
      'CUSTOM','CUSTOM','TOOL_CALL_START','TOOL_CALL_ARGS','TOOL_CALL_END','RUN_FINISHED',
    ]);
    expect(completed.events.slice(5)).toEqual([
      {type:'CUSTOM',name:'thatcampus.ui-intent',value:{version:1,kind:'view_report',subjectId:'licensed-report'}},
      {type:'CUSTOM',name:'thatcampus.ui-intent',value:{version:1,kind:'view_source',subjectId:'owner-source'}},
      {type:'TOOL_CALL_START',toolCallId:'owned-call',toolCallName:'campus_focus_place'},
      {type:'TOOL_CALL_ARGS',toolCallId:'owned-call',delta:'{"query":"Library"}'},
      {type:'TOOL_CALL_END',toolCallId:'owned-call'},
      {type:'RUN_FINISHED',threadId:'thread-1',runId:'run-1',result:{status:'completed'},outcome:{type:'success',pendingToolCallIds:['owned-call']}},
    ]);
    expect(JSON.stringify(completed)).not.toMatch(/\/hidden|student_id|Private title/u);
  });

  it('keeps pending approval distinct and ends failed runs without executable client controls', () => {
    const confirmation=projectAssistantAgUi({...run,status:'confirmation'});
    expect(confirmation.events).toContainEqual({type:'CUSTOM',name:'thatcampus.ui-intent',
      value:{version:1,kind:'review_action',subjectId:'pending-action'}});
    expect(confirmation.events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    expect(confirmation.events.at(-1)).toMatchObject({type:'RUN_FINISHED',result:{status:'confirmation'}});
    for(const status of ['failed','cancelled'] as const){
      const ended=projectAssistantAgUi({...run,status});
      expect(ended.events.at(-1)).toMatchObject(status==='failed'?{type:'RUN_ERROR'}:{type:'RUN_FINISHED',outcome:{type:'cancelled'}});
      expect(ended.events.some(event=>event.type==='CUSTOM'||event.type==='TOOL_CALL_START')).toBe(false);
    }
  });
});
