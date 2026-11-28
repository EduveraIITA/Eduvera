import { describe, expect, it } from 'vitest';
import {
  advertisedClientTools, clientUiContextSchema, clientUiPrompt, parseClientUiCall,
  projectAssistantAgUi, restoreClientUiCall,
} from '../src/agent/agent-ui.js';
import { campusWorkflowDirection, campusWorkflowRequest, isCampusFloorPlanWebFollowup, resumeCampusWorkflow } from '../src/agent/agent-campus-workflow.js';

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


describe('Assistant campus workflow', () => {
  const one='1a8ed921-e1e1-4953-83f5-3634f7c967cf',two='314ffbe2-3626-456b-aa65-eacac1b9f314';
  const capacity={count:2,limit:10};
  const directory={can_edit:true,campuses:[{id:one,name:'River House',code:'RIVER'},{id:two,name:'West Campus',code:'WEST'}]};

  it('recognizes explicit setup before model prose and retains these words only as form data', () => {
    expect(campusWorkflowRequest("Let's setup a new campus")).toEqual({kind:'create'});
    expect(campusWorkflowRequest('I want to setup new campus')).toEqual({kind:'create'});
    expect(campusWorkflowRequest('Create a new campus called River House')).toEqual({kind:'create',name:'River House'});
    expect(campusWorkflowRequest('Create a new campus called River House and then map its interiors')).toEqual({kind:'create',name:'River House'});
    expect(campusWorkflowRequest('Add a new branch campus')).toEqual({kind:'branch'});
    expect(campusWorkflowRequest('Set up my campus location')).toEqual({kind:'branch'});
    expect(campusWorkflowRequest('Open branch reports')).toBeUndefined();
    expect(campusWorkflowRequest('Lets setup its intirior')).toEqual({kind:'interiors'});
    expect(campusWorkflowRequest('Map the interiors of West Campus')).toEqual({kind:'interiors',campus:'West Campus'});
    expect(campusWorkflowRequest('How do I create a new campus?')).toBeUndefined();
    expect(campusWorkflowRequest("Don't create a new campus")).toBeUndefined();
    expect(campusWorkflowRequest("Dont create a new campus")).toBeUndefined();
    expect(campusWorkflowRequest("Can you check whether I may edit the Virtual Campus?")).toBeUndefined();
    expect(campusWorkflowRequest('Draft a message to create a new campus')).toBeUndefined();
    expect(campusWorkflowRequest('Create a new campus event')).toBeUndefined();
    expect(campusWorkflowRequest('River House')).toBeUndefined();
    expect(campusWorkflowRequest('River House',true)).toEqual({kind:'create',name:'River House'});
    expect(campusWorkflowRequest('Then start building')).toBeUndefined();
    expect(campusWorkflowRequest('Then start building',true)).toEqual({kind:'create',prepared:true});
    expect(campusWorkflowRequest('Yes',true)).toBeUndefined();
    expect(campusWorkflowRequest('Wait a second',true)).toBeUndefined();
  });

  it('orders a grounded two-step handoff and does not give the model creation tools', () => {
    const outside=clientUiContextSchema.parse({screen:'workspace',tools:['open_campus_create']});
    const account=clientUiContextSchema.parse({screen:'campus_account',tools:['prepare_campus_create']});
    const create={kind:'create',name:'River House'} as const;
    expect(advertisedClientTools(outside)).toEqual([]);
    expect(campusWorkflowDirection(create,outside,capacity)).toEqual({
      calls:[{tool:'open_campus_create',arguments:{}},{tool:'prepare_campus_create',arguments:{name:'River House'}}],
      answer:'Review the campus form, then tap Create campus.',href:'/more/account/campuses',
    });
    expect(campusWorkflowDirection(create,account,capacity).calls).toEqual([{tool:'prepare_campus_create',arguments:{name:'River House'}}]);
    expect(campusWorkflowDirection(create,outside,{count:10,limit:10}).calls).toEqual([]);
    expect(campusWorkflowDirection({kind:'branch'},outside,directory)).toMatchObject({calls:[],href:'/more/setup/institution/campus'});
    const calls=campusWorkflowDirection(create,outside,capacity).calls
      .map((call,index)=>restoreClientUiCall(String(index+1),call)!);
    const events=projectAssistantAgUi({threadId:'thread',runId:'run',status:'completed',progress:'Ready',answer:'Open it',evidence:[],clientCalls:calls}).events;
    expect(events.filter(event=>event.type==='TOOL_CALL_START').map(event=>event.toolCallName)).toEqual(['open_campus_create','prepare_campus_create']);
    expect(events.at(-1)).toMatchObject({type:'RUN_FINISHED',outcome:{type:'success',pendingToolCallIds:['1','2']}});
  });

  it('opens first-time Virtual Campus, resumes exact campus setup, and never guesses between locations', () => {
    const workspace=clientUiContextSchema.parse({screen:'workspace',tools:['open_virtual_campus','open_campus_layout']});
    const first=clientUiContextSchema.parse({screen:'virtual_campus',tools:[]});
    const current=clientUiContextSchema.parse({screen:'virtual_campus',tools:['open_campus_layout','campus_open_picker'],campus_id:one});
    const empty={can_edit:true,campuses:[]};
    expect(campusWorkflowRequest('Take me to Virtual Campus')).toEqual({kind:'layout',mode:'open'});
    expect(campusWorkflowRequest('Show me my virtual campus')).toEqual({kind:'layout',mode:'open'});
    expect(campusWorkflowRequest('Show the layout of West Campus')).toEqual({kind:'layout',mode:'open',campus:'West Campus'});
    expect(campusWorkflowDirection({kind:'layout',mode:'open'},workspace,{...empty,can_edit:false})).toMatchObject({
      calls:[{tool:'open_virtual_campus',arguments:{}}],href:'/more/virtual-campus',
    });
    expect(campusWorkflowRequest('Initialize the virtual campus environment')).toEqual({kind:'layout',mode:'setup'});
    expect(campusWorkflowDirection({kind:'layout',mode:'setup'},workspace,empty)).toMatchObject({
      calls:[{tool:'open_virtual_campus',arguments:{}}],href:'/more/setup/institution/campus',
    });
    expect(campusWorkflowDirection({kind:'layout',mode:'setup'},first,empty)).toMatchObject({
      calls:[],answer:'Add your first campus location to start the map.',href:'/more/setup/institution/campus',
    });
    expect(campusWorkflowRequest('Draw the boundary around West Campus')).toEqual({kind:'layout',mode:'setup',campus:'West Campus'});
    expect(campusWorkflowRequest('Generate the campus layout')).toEqual({kind:'layout',mode:'setup'});
    const setup={kind:'layout',mode:'setup'} as const;
    expect(campusWorkflowDirection(setup,{...current,campus_id:undefined},directory).calls)
      .toEqual([{tool:'campus_open_picker',arguments:{}}]);
    expect(campusWorkflowDirection(setup,current,directory).calls)
      .toEqual([{tool:'open_campus_layout',arguments:{campus_id:one}}]);
    expect(campusWorkflowDirection({...setup,campus:'WEST'},current,directory)).toMatchObject({
      calls:[{tool:'open_campus_layout',arguments:{campus_id:two}}],href:`/more/virtual-campus?campus_id=${two}&edit=1`,
    });
    expect(campusWorkflowDirection({...setup,campus:'WEST'},undefined,directory)).toMatchObject({
      calls:[],href:`/more/virtual-campus?campus_id=${two}&edit=1`,
    });
    expect(campusWorkflowDirection(setup,current,{...directory,can_edit:false}).calls).toEqual([]);
    expect(campusWorkflowDirection({kind:'layout',mode:'open',campus:'WEST'},workspace,directory)).toMatchObject({
      calls:[],href:`/more/virtual-campus?campus_id=${two}`,
    });
  });

  it('scopes continuation to the prior authorized goal and honors takeover and new directions', () => {
    const account=clientUiContextSchema.parse({screen:'campus_account',tools:['prepare_campus_create']});
    const current=clientUiContextSchema.parse({screen:'virtual_campus',tools:['open_campus_interiors'],campus_id:two});
    const previous={kind:'interiors',floorPlan:true} as const;
    expect(resumeCampusWorkflow(undefined,'Then start building')).toBeUndefined();
    expect(resumeCampusWorkflow(previous,'Stop, don’t continue')).toBeUndefined();
    expect(resumeCampusWorkflow(previous,'Continue by creating a new campus')).toBeUndefined();
    const resumed=resumeCampusWorkflow(previous,'Continue mapping');
    expect(resumed).toEqual(previous);
    expect(campusWorkflowDirection(resumed!,current,directory).calls)
      .toEqual([{tool:'open_campus_interiors',arguments:{campus_id:two}}]);
    const prepared=resumeCampusWorkflow({kind:'create',name:'River House'},'Go ahead',{name:'River House'});
    expect(campusWorkflowDirection(prepared!,account,capacity)).toMatchObject({
      calls:[],answer:'Review the campus form, then tap Create campus.',
    });
  });

  it('uses exact current campus authority for interiors and requires a choice when ambiguous', () => {
    const context=clientUiContextSchema.parse({screen:'virtual_campus',tools:['open_campus_interiors','campus_open_picker'],campus_id:one});
    expect(campusWorkflowDirection({kind:'interiors'},context,directory).calls).toEqual([{tool:'open_campus_interiors',arguments:{campus_id:one}}]);
    expect(campusWorkflowDirection({kind:'interiors',campus:'WEST'},context,directory).calls).toEqual([{tool:'open_campus_interiors',arguments:{campus_id:two}}]);
    expect(campusWorkflowDirection({kind:'interiors',campus:'another campus'},context,directory).calls).toEqual([{tool:'campus_open_picker',arguments:{}}]);
    expect(campusWorkflowDirection({kind:'interiors'},{...context,campus_id:undefined},directory).calls).toEqual([{tool:'campus_open_picker',arguments:{}}]);
    expect(campusWorkflowDirection({kind:'interiors'},context,{...directory,can_edit:false}).calls).toEqual([]);
    expect(clientUiContextSchema.safeParse({screen:'workspace',tools:['open_campus_interiors'],campus_id:one}).success).toBe(false);
  });

  it('grounds floor-plan web requests and keeps generic web questions out of campus setup', () => {
    const context=clientUiContextSchema.parse({screen:'workspace',tools:['open_campus_interiors']});
    const plan=campusWorkflowRequest('Can you search the internet for West Campus floor plans?');
    expect(plan).toEqual({kind:'interiors',floorPlan:true,campus:'West Campus'});
    expect(campusWorkflowRequest('Find the floor plan of West Campus online.')).toEqual(plan);
    expect(campusWorkflowRequest('search the lulu mall lucknow floor plan and update interior')).toEqual({kind:'interiors',floorPlan:true,campus:'lulu mall lucknow'});
    expect(campusWorkflowRequest('Search the public floor plan for LuLu Mall Lucknow and update its interior')).toEqual({kind:'interiors',floorPlan:true,campus:'LuLu Mall Lucknow'});
    expect(campusWorkflowRequest('Find a public floor plan')).toEqual({kind:'interiors',floorPlan:true});
    expect(campusWorkflowRequest('Search the internet for floor plan examples')).toBeUndefined();
    expect(campusWorkflowRequest('How can I find a public floor plan?')).toBeUndefined();
    expect(campusWorkflowRequest('Can project members download floor plans?')).toBeUndefined();
    expect(campusWorkflowRequest("Can't you search the internet?")).toBeUndefined();
    expect(isCampusFloorPlanWebFollowup("Can’t you search the internet?")).toBe(true);
    expect(isCampusFloorPlanWebFollowup('Cant you search internet')).toBe(true);
    expect(isCampusFloorPlanWebFollowup('Can you search the internet for admissions?')).toBe(false);
    if(!plan)throw new Error('Missing floor-plan direction');
    expect(campusWorkflowDirection(plan,context,directory)).toMatchObject({calls:[{tool:'open_campus_interiors',arguments:{campus_id:two}}],
      answer:'Choose the building and floor to check for a public plan.'});
    const lulu=campusWorkflowRequest('search the LuLu Mall Lucknow floor plan and update interior');
    if(!lulu)throw new Error('Missing publisher direction');
    expect(campusWorkflowDirection(lulu,{...context,screen:'virtual_campus',campus_id:one},directory)).toMatchObject({
      calls:[{tool:'open_campus_interiors',arguments:{campus_id:one,building_name:'LuLu Mall Lucknow'}}],
      href:expect.stringContaining('indoor_building=LuLu+Mall+Lucknow'),
    });
    expect(campusWorkflowDirection(lulu,context,directory).calls).toEqual([]);
    const duplicated={...directory,campuses:[directory.campuses[0]!,{...directory.campuses[1]!,name:'River House'}]};
    const picker=clientUiContextSchema.parse({screen:'virtual_campus',campus_id:one,tools:['open_campus_interiors','campus_open_picker']});
    expect(campusWorkflowDirection({kind:'interiors',floorPlan:true,campus:'River House'},picker,duplicated).calls)
      .toEqual([{tool:'campus_open_picker',arguments:{}}]);
  });
});
