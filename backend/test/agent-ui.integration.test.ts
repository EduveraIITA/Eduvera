import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController } from '../src/agent/agent.controller.js';
import { AgentService } from '../src/agent/agent.service.js';
import { AgentMemoryService } from '../src/agent/long-term-memory.js';
import type * as AgentProviders from '../src/agent/providers.js';
import type { AgentGateway } from '../src/agent/gateway.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { DatabaseService } from '../src/database/database.service.js';
import { RolesService } from '../src/roles/roles.service.js';
import { campusSceneServices } from './campus-scenes.test-support.js';
import { createClassPracticeFixture } from './class-practice.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const {complete,modelIdentity}=vi.hoisted(()=>({
  complete:vi.fn(),
  modelIdentity:{provider:'ollama',model:'isolated-ui-test'},
}));
vi.mock('../src/agent/providers.js', async importOriginal => ({
  ...await importOriginal<typeof AgentProviders>(),
  createAgentModel:()=>({...modelIdentity,complete}),
}));

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
if(enabled)requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const request=(authUser:AuthUser,body:unknown={})=>({authUser,requestId:randomUUID(),body,ip:'127.0.0.1',headers:{},cookies:{}} as AuthenticatedRequest);

describe.skipIf(!enabled)('authorized Assistant AG-UI event read and client tool receipt', () => {
  let db:DatabaseService;
  beforeAll(()=>{
    db=new DatabaseService();
    vi.stubEnv('AGENT_ENABLED','true');
    vi.stubEnv('AGENT_PROVIDER','ollama');
    vi.stubEnv('AGENT_MODEL','isolated-ui-test');
  });
  afterAll(async()=>{vi.unstubAllEnvs();await db?.destroy();});

  it('offers the declared control, binds retries, checks current ownership and never writes a campus action', async () => {
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const {scenes,topology}=campusSceneServices(db);
    const campus=await topology.createCampus(fixture.owner,fixture.schoolId,{
      name:'AG-UI fixture campus',code:'AGUI',campus_type:'main',is_primary:true,timezone:'UTC',
    },request(fixture.owner));
    const gateway={dispatch:async(capability:{name:string})=>{
      if(capability.name!=='virtual_campus_layout')throw new Error('Unexpected fixture tool');
      return scenes.directory(fixture.owner,fixture.schoolId);
    }} as unknown as AgentGateway;
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,gateway,memory);
    const http=new AgentController(agent,memory);
    const {id:threadId}=await agent.create(request(fixture.owner,{portal:'principal'}));
    const body={question:'Focus on the library in Virtual Campus.',client_id:randomUUID(),
      ui_context:{screen:'virtual_campus',tools:['campus_focus_place']}};
    complete.mockResolvedValueOnce({text:'',calls:[{id:'untrusted-provider-id', name:'campus_focus_place', arguments:{query:'Library'}}]});
    const accepted=await http.send(request(fixture.owner,body),threadId);
    const events=async()=>http.runEvents(request(fixture.owner),threadId,accepted.run_id);
    await vi.waitFor(async()=>expect((await events()).events.at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
    const packet=await events();
    expect(complete.mock.calls[0]?.[1].map((tool:{name:string})=>tool.name)).toContain('campus_focus_place');
    expect(complete.mock.calls[0]?.[1].map((tool:{name:string})=>tool.name)).not.toContain('campus_search_places');
    const call=packet.events.find(event=>event.type==='TOOL_CALL_START');
    expect(call).toMatchObject({toolCallName:'campus_focus_place'});
    expect(packet.events).toContainEqual({type:'TOOL_CALL_ARGS',toolCallId:call?.toolCallId,delta:'{"query":"Library"}'});
    expect(packet.events.at(-1)).toMatchObject({type:'RUN_FINISHED',outcome:{type:'success',pendingToolCallIds:[call!.toolCallId]}});
    expect(JSON.stringify(packet)).not.toContain('untrusted-provider-id');
    expect(await http.send(request(fixture.owner,body),threadId)).toEqual(accepted);
    await expect(http.send(request(fixture.owner,{...body,ui_context:{screen:'workspace',tools:['open_virtual_campus']}}),threadId)).rejects.toThrow('message key');
    await expect(http.runEvents(request(fixture.learner.actor),threadId,accepted.run_id)).rejects.toThrow('Conversation not found');
    await expect(http.runEvents(request(fixture.owner),threadId,randomUUID())).rejects.toThrow('Request not found');
    const simulation={...request(fixture.owner),executionEnvironmentView:{mode:'simulation'}} as AuthenticatedRequest;
    await expect(http.runEvents(simulation,threadId,accepted.run_id)).rejects.toThrow('Simulation');
    const actions=(await sql<{count:number}>`SELECT count(*)::int AS count FROM agent_actions WHERE run_id=${accepted.run_id}::uuid`.execute(db)).rows[0];
    expect(actions?.count).toBe(0);

    const continueWithResult=async(call_id:string)=>{
      complete.mockResolvedValueOnce({text:'I can help with the next step.',calls:[]});
      const next=await http.send(request(fixture.owner,{question:'What can I do next?',client_id:randomUUID(),ui_context:{
        screen:'virtual_campus',tools:[],last_result:{tool:'campus_focus_place',status:'applied',call_id},
      }}),threadId);
      await vi.waitFor(async()=>expect((await http.runEvents(request(fixture.owner),threadId,next.run_id)).events.at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:3000});
      return JSON.stringify(complete.mock.calls.at(-1)?.[0]);
    };
    const matching=await continueWithResult(call!.toolCallId);
    expect(matching).toContain('campus_focus_place as applied');
    expect(matching).not.toContain(call!.toolCallId);
    expect((await events()).events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    expect(await continueWithResult(randomUUID())).not.toContain('campus_focus_place as applied');

    await db.updateTable('institution_campuses').set({status:'inactive'}).where('id','=',campus.id).execute();
    const revoked=await events();
    expect(revoked.events).toContainEqual({type:'STATE_SNAPSHOT',snapshot:{status:'completed',progress:'Access changed'}});
    expect(revoked.events.some(event=>event.type==='TOOL_CALL_START'||event.type==='CUSTOM')).toBe(false);
  },15000);

  it('opens an empty staff timetable and handles a day-only correction without calling the model', async()=>{
    complete.mockClear();
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    let visible=true;
    const dispatch=vi.fn((capability:{name:string})=>{
      if(!visible||capability.name!=='scheduled_activities')return Promise.reject(new ForbiddenException());
      return Promise.resolve({items:[],total_pages:1});
    });
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,{dispatch} as unknown as AgentGateway,memory);
    const http=new AgentController(agent,memory);
    const thread=(await agent.create(request(fixture.owner,{portal:'principal'}))).id;
    const open=async(question:string,date:string)=>{
      const {run_id}=await http.send(request(fixture.owner,{question,client_id:randomUUID(),ui_context:{screen:'workspace',tools:['open_timetable']}}),thread);
      const packet=()=>http.runEvents(request(fixture.owner),thread,run_id);
      await vi.waitFor(async()=>expect((await packet()).events).toContainEqual(expect.objectContaining({type:'TOOL_CALL_START',toolCallName:'open_timetable'})),{timeout:5000});
      expect((await packet()).events).toContainEqual(expect.objectContaining({type:'TOOL_CALL_ARGS',delta:JSON.stringify({date})}));
      return packet;
    };
    try {
      await open('Show me the schedule for 2027-02-12','2027-02-12');
      const packet=await open('18th','2027-02-18');
      expect(complete).not.toHaveBeenCalled();
      visible=false;
      expect((await packet()).events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    } finally { await agent.onModuleDestroy(); }
  },20000);

  it('answers a dated attendee request with recorded marks in one model decision', async()=>{
    complete.mockClear();
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const occurrence=randomUUID(),register=randomUUID(),date='2027-02-12';
    const roster=[{person_id:randomUUID(),name:'Jo',status:'late'},{person_id:randomUUID(),name:'Remi',status:null}];
    const dispatch=(cap:{name:string},args:Record<string,unknown>)=>{
      if(cap.name==='scheduled_activities' && args.date===date)return Promise.resolve({items:[{id:occurrence,title:'Design studio',starts_at:date+'T08:00:00Z',ends_at:date+'T09:00:00Z',purpose:'training',can_open_register:true}],total_pages:1});
      if(cap.name==='activity_attendees' && args.occurrence_id===occurrence)return Promise.resolve({register:{id:register,title:'Design studio',state:'draft'},counts:{participants:2,recorded:1,unrecorded:1},roster});
      throw new Error('Unexpected attendee source');
    };
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,{dispatch} as unknown as AgentGateway,memory);
    const http=new AgentController(agent,memory);
    try {
      const thread=(await agent.create(request(fixture.owner,{portal:'principal'}))).id;
      complete.mockResolvedValueOnce({text:'',calls:[{id:'model-call',name:'show_activity_attendees',arguments:{date}}]});
      const {run_id}=await http.send(request(fixture.owner,{question:'Who attended the class on February 12, 2027?',client_id:randomUUID()}),thread);
      await vi.waitFor(async()=>expect((await http.runEvents(request(fixture.owner),thread,run_id)).events.at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
      const run=(await agent.detail(request(fixture.owner),thread)).runs.find(row=>row.id===run_id);
      expect(run?.answer).toContain('Jo (late)');
      expect(run?.answer).toContain('unmarked for 1');
      expect(run?.answer).not.toContain('Remi');
      expect(complete).toHaveBeenCalledTimes(1);
      const context={screen:'workspace',tools:['open_timetable']};
      const opened=await http.send(request(fixture.owner,{question:'Show my schedule for '+date,client_id:randomUUID(),ui_context:context}),thread);
      const events=()=>http.runEvents(request(fixture.owner),thread,opened.run_id);
      await vi.waitFor(async()=>expect((await events()).events.some(event=>event.type==='TOOL_CALL_START')).toBe(true));
      const call=(await events()).events.find(event=>event.type==='TOOL_CALL_START')!;
      const follow=await http.send(request(fixture.owner,{question:'Who attended that class?',client_id:randomUUID(),ui_context:{
        ...context,last_result:{tool:'open_timetable',status:'applied',call_id:call.toolCallId}
      }}),thread);
      await vi.waitFor(async()=>expect((await http.detail(request(fixture.owner),thread)).runs.find(row=>row.id===follow.run_id)?.answer).toContain('Jo (late)'));
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {await agent.onModuleDestroy();}
  },20000);

  it('runs explicit campus controls in order, retains the exact follow-up and checks current authority again', async () => {
    complete.mockClear();
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const {scenes,topology}=campusSceneServices(db);
    const campus=await topology.createCampus(fixture.owner,fixture.schoolId,{
      name:'West Campus',code:'WEST',campus_type:'main',is_primary:true,timezone:'UTC',
    },request(fixture.owner));
    let count=2;
    const gateway={dispatch:async(capability:{name:string})=>{
      if(capability.name==='campus_workspace_capacity')return {count,limit:10};
      if(capability.name==='virtual_campus_layout')return scenes.directory(fixture.owner,fixture.schoolId);
      throw new Error('Unexpected fixture tool');
    }} as unknown as AgentGateway;
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,gateway,memory);
    const http=new AgentController(agent,memory);
    const {id:thread}=await agent.create(request(fixture.owner,{portal:'principal'}));
    async function turn(question:string,ui_context:unknown) {
      const {run_id}=await http.send(request(fixture.owner,{question,client_id:randomUUID(),ui_context}),thread);
      const events=async()=>(await http.runEvents(request(fixture.owner),thread,run_id)).events;
      await vi.waitFor(async()=>expect((await events()).at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
      return {run_id,events,initial:await events()};
    }
    const start=await turn('I want to setup new campus',{screen:'workspace',tools:['open_campus_create']});
    const steps=start.initial.filter(event=>event.type==='TOOL_CALL_START');
    expect(steps.map(step=>step.toolCallName)).toEqual(['open_campus_create','prepare_campus_create']);
    expect(start.initial.at(-1)).toMatchObject({type:'RUN_FINISHED',outcome:{pendingToolCallIds:steps.map(step=>step.toolCallId)}});
    count=10;
    expect(await start.events()).toContainEqual({type:'STATE_SNAPSHOT',snapshot:{status:'completed',progress:'Setup changed'}});
    expect((await start.events()).some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    count=2;
    const continuation=await turn('Then start building',{screen:'campus_account',tools:['prepare_campus_create'],
      last_result:{tool:'prepare_campus_create',status:'applied',call_id:steps.at(-1)!.toolCallId}});
    expect(continuation.initial.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    expect(JSON.stringify(continuation.initial)).toContain('Review the name in the campus form, then tap Create campus.');
    const form=await turn('River House',{screen:'campus_account',tools:['prepare_campus_create'],
      last_result:{tool:'prepare_campus_create',status:'applied',call_id:steps.at(-1)!.toolCallId}});
    expect(form.initial.filter(event=>event.type==='TOOL_CALL_START').map(step=>step.toolCallName)).toEqual(['prepare_campus_create']);
    expect(form.initial).toContainEqual(expect.objectContaining({type:'TOOL_CALL_ARGS',delta:'{"name":"River House"}'}));
    expect((await start.events()).some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    const map={screen:'virtual_campus',tools:['open_campus_interiors'],campus_id:campus.id};
    const floorPlan=await turn('Find the floor plan of West Campus',map);
    expect(floorPlan.initial).toContainEqual(expect.objectContaining({type:'TOOL_CALL_START',toolCallName:'open_campus_interiors'}));
    const followup=await turn('Can’t you search the internet?',{...map,
      last_result:{tool:'prepare_campus_create',status:'applied',call_id:randomUUID()}});
    expect(followup.initial).toContainEqual(expect.objectContaining({type:'TOOL_CALL_ARGS',delta:JSON.stringify({campus_id:campus.id})}));
    expect(complete).not.toHaveBeenCalled();
    const actions=(await sql<{count:number}>`SELECT count(*)::int AS count FROM agent_actions action JOIN agent_runs run ON run.id=action.run_id
      WHERE run.thread_id=${thread}::uuid`.execute(db)).rows[0];
    expect(actions?.count).toBe(0);
  },20000);

  describe('checkpointed campus form handoff',()=>{
    const services=new Set<AgentService>();
    afterEach(async()=>{
      await Promise.all([...services].map(service=>service.onModuleDestroy()));
      services.clear();
    });

    async function harness(negotiatesByHeader=false) {
      complete.mockClear();
      const fixture=await createClassPracticeFixture(db);
      await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
      let count=2;
      const gateway={dispatch:(capability:{name:string})=>{
        if(capability.name!=='campus_workspace_capacity')throw new Error('Unexpected fixture tool');
        return Promise.resolve({count,limit:10});
      }} as unknown as AgentGateway;
      const memory=new AgentMemoryService(db);
      function serviceInstance() {
        const service=new AgentService(db,new RolesService(db),fixture.school,gateway,memory);
        services.add(service);
        return {http:new AgentController(service,memory),close:async()=>{
          services.delete(service);
          await service.onModuleDestroy();
        }};
      }
      const original=serviceInstance();
      const {id:threadId}=await original.http.create(request(fixture.owner,{portal:'principal'}));
      async function effects() {
        return (await sql<{runs:number;actions:number;memberships:number;campuses:number}>`SELECT
          (SELECT count(*)::int FROM agent_runs WHERE thread_id=${threadId}::uuid) AS runs,
          (SELECT count(*)::int FROM agent_actions action JOIN agent_runs run ON run.id=action.run_id
            WHERE run.thread_id=${threadId}::uuid) AS actions,
          (SELECT count(*)::int FROM school_memberships WHERE user_id=${fixture.owner.id}::uuid) AS memberships,
          (SELECT count(*)::int FROM institution_campuses WHERE school_id=${fixture.schoolId}::uuid) AS campuses`.execute(db)).rows[0];
      }
      const before=await effects();
      const body={
        question:'I want to setup new campus',client_id:randomUUID(),
        ui_context:{screen:'workspace',tools:['open_campus_create'],...(negotiatesByHeader?{}:{workflow_steps:true})},
      };
      const submission=request(fixture.owner,body);
      if(negotiatesByHeader)submission.headers['x-thatcampus-workflow-steps']='1';
      const {run_id:runId}=await original.http.send(submission,threadId);
      const events=()=>original.http.runEvents(request(fixture.owner),threadId,runId);
      await vi.waitFor(async()=>expect((await events()).events.at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
      const first=await events();
      const firstCalls=first.events.filter(event=>event.type==='TOOL_CALL_START');
      expect(firstCalls.map(call=>call.toolCallName)).toEqual(['open_campus_create']);
      const firstId=firstCalls[0]!.toolCallId;
      expect(first.events).toContainEqual({type:'CUSTOM',name:'thatcampus.workflow-step',value:{version:1,call_id:firstId}});
      expect(first.events.at(-1)).toMatchObject({type:'RUN_FINISHED',outcome:{pendingToolCallIds:[firstId]}});
      return {fixture,threadId,runId,firstId,body,original,serviceInstance,fillCapacity:()=>{count=10;},
        expectNoWrites:async()=>{
          expect(await effects()).toEqual({...before,runs:1,actions:0});
          expect(complete).not.toHaveBeenCalled();
        }};
    }

    function result(callId:string,status:'applied'|'blocked'|'stopped') {
      return {type:'TOOL_CALL_RESULT',messageId:`${callId}:result`,toolCallId:callId,content:JSON.stringify({status}),role:'tool'};
    }

    it('resumes navigation in a fresh service and releases the form exactly once for the owning client',async()=>{
      const {fixture,threadId,runId,firstId,body,original,serviceInstance,expectNoWrites}=await harness(true);
      const secondStep=(await sql<{id:string}>`SELECT id FROM agent_tool_steps WHERE run_id=${runId}::uuid
        AND kind='handoff' AND result->>'workflow'='true' AND result->>'position'='1'`.execute(db)).rows[0]!;
      await original.close();

      const {http}=serviceInstance();
      expect(await http.send(request(fixture.owner,body),threadId)).toEqual({run_id:runId});
      const acknowledge=(call_id:string,status:'applied'|'blocked'|'stopped'='applied')=>
        http.acknowledgeUiStep(request(fixture.owner,{call_id,status}),threadId,runId);
      await expect(http.acknowledgeUiStep(request(fixture.learner.actor,{call_id:firstId,status:'applied'}),threadId,runId))
        .rejects.toThrow('Conversation not found');
      await expect(acknowledge(randomUUID())).rejects.toThrow('step not found');
      await expect(acknowledge(secondStep.id)).rejects.toThrow('no longer pending');

      const next=await acknowledge(firstId);
      const call=next.events.find(event=>event.type==='TOOL_CALL_START');
      expect(next.events.filter(event=>event.type==='TOOL_CALL_START')).toEqual([
        {type:'TOOL_CALL_START',toolCallId:secondStep.id,toolCallName:'prepare_campus_create'},
      ]);
      expect(next.events.indexOf(call!)).toBeGreaterThan(
        next.events.findIndex(event=>event.type==='TOOL_CALL_RESULT'&&event.toolCallId===firstId));
      expect(next.events).toContainEqual(result(firstId,'applied'));
      expect(next.events).toContainEqual({type:'CUSTOM',name:'thatcampus.workflow-step',value:{version:1,call_id:secondStep.id}});
      expect(next.events.at(-1)).toMatchObject({type:'RUN_FINISHED',outcome:{pendingToolCallIds:[secondStep.id]}});
      expect(await acknowledge(firstId)).toEqual(next);
      await expect(acknowledge(firstId,'stopped')).rejects.toThrow('different result');

      const terminal=await acknowledge(secondStep.id);
      expect(terminal.events.filter(event=>event.type==='TOOL_CALL_RESULT')).toEqual([
        result(firstId,'applied'),result(secondStep.id,'applied'),
      ]);
      expect(terminal.events.some(event=>event.type==='TOOL_CALL_START'||(event.type==='CUSTOM'&&event.name==='thatcampus.workflow-step'))).toBe(false);
      expect(terminal.events.at(-1)).toEqual({type:'RUN_FINISHED',threadId,runId,result:{status:'completed'}});
      expect(await acknowledge(secondStep.id)).toEqual(terminal);
      await expectNoWrites();
    },15000);

    it.each(['revoked','stopped'] as const)('ends the remaining plan when the prior step is %s',async reason=>{
      const {fixture,threadId,runId,firstId,original,serviceInstance,fillCapacity,expectNoWrites}=await harness();
      await original.close();
      const {http}=serviceInstance();
      if(reason==='revoked')fillCapacity();
      const status=reason==='revoked'?'applied':'stopped';
      const body={call_id:firstId,status};
      const response=await http.acknowledgeUiStep(request(fixture.owner,body),threadId,runId);
      expect(response.events.filter(event=>event.type==='TOOL_CALL_RESULT')).toEqual([
        result(firstId,reason==='revoked'?'blocked':'stopped'),
      ]);
      expect(response.events.some(event=>event.type==='TOOL_CALL_START'||(event.type==='CUSTOM'&&event.name==='thatcampus.workflow-step'))).toBe(false);
      expect(response.events.at(-1)).toEqual({type:'RUN_FINISHED',threadId,runId,result:{status:'completed'}});
      expect(await http.acknowledgeUiStep(request(fixture.owner,body),threadId,runId)).toEqual(response);
      if(reason==='revoked')await expect(http.acknowledgeUiStep(request(fixture.owner,{...body,status:'blocked'}),threadId,runId))
        .rejects.toThrow('different result');
      await expectNoWrites();
    },15000);
  });

  it('opens an exact building from a fresh chat or clarification and resumes a manual handoff after service restart', async () => {
    complete.mockClear();
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const {scenes,topology}=campusSceneServices(db);
    const main=await topology.createCampus(fixture.owner,fixture.schoolId,{
      name:'Main Campus',code:'MAIN',campus_type:'main',is_primary:true,timezone:'UTC',
    },request(fixture.owner));
    const west=await topology.createCampus(fixture.owner,fixture.schoolId,{
      name:'West Campus',code:'WEST',campus_type:'main',is_primary:false,timezone:'UTC',
    },request(fixture.owner));
    const computing={element_id:'osm-building_301',space_id:randomUUID(),label:'Computing Center 3',name:'Computing Centre 3',code:'COMP-003'};
    const other={element_id:'library-east',space_id:randomUUID(),label:'East Library',name:'East Library',code:'EAST-LIB'};
    const gateway={dispatch:async(capability:{name:string},input:{campus_id?:string})=>{
      if(capability.name==='virtual_campus_layout')return scenes.directory(fixture.owner,fixture.schoolId);
      if(capability.name==='campus_interior_buildings')return input.campus_id===west.id?[computing]:input.campus_id===main.id?[other]:[];
      throw new Error('Unexpected fixture tool');
    }} as unknown as AgentGateway;
    const memory=new AgentMemoryService(db);
    const makeService=()=>new AgentService(db,new RolesService(db),fixture.school,gateway,memory);
    const home={screen:'workspace',tools:['open_virtual_campus','open_campus_interiors'],building_selection:true};
    let agent=makeService(),http=new AgentController(agent,memory);
    const create=async()=>(await http.create(request(fixture.owner,{portal:'principal'}))).id;
    async function turn(question:string,threadId:string,ui_context:unknown=home) {
      const {run_id}=await http.send(request(fixture.owner,{question,client_id:randomUUID(),ui_context}),threadId);
      const events=async()=>(await http.runEvents(request(fixture.owner),threadId,run_id)).events;
      await vi.waitFor(async()=>expect((await events()).at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
      return {run_id,events:await events()};
    }
    const waitEvent=(events:Awaited<ReturnType<typeof turn>>['events'])=>events.flatMap(event=>
      event.type==='CUSTOM'&&event.name==='thatcampus.building-selection'?[event.value]:[],
    )[0]!;
    const editorArguments={campus_id:west.id,building_id:computing.element_id};
    const exact={type:'TOOL_CALL_ARGS',delta:JSON.stringify(editorArguments)};
    try {
      const original=await turn('Lets detail of cc3 building',await create());
      expect(original.events).toContainEqual(expect.objectContaining(exact));
      expect(waitEvent(original.events)).toBeUndefined();
      const legacy=await turn('Lets detail of cc3 building',await create(),{...home,building_selection:undefined});
      expect(legacy.events).toContainEqual(expect.objectContaining({type:'TOOL_CALL_ARGS',delta:JSON.stringify({
        campus_id:west.id,building_name:'Computing Center 3',
      })}));

      const correctionThread=await create();
      const unresolved=await turn('Lets detail of computing annex 21 building',correctionThread);
      expect(waitEvent(unresolved.events)).toMatchObject({target:'computing annex 21 building',options:[]});
      const correction=await turn('I mean computing center 3',correctionThread);
      expect(correction.events).toContainEqual(expect.objectContaining(exact));

      const manualThread=await create();
      const manual=await turn('Lets detail of the computing annex building',manualThread);
      const wait=waitEvent(manual.events);
      expect(wait).toMatchObject({target:'computing annex building',options:[]});
      await agent.onModuleDestroy();
      agent=makeService();
      http=new AgentController(agent,memory);
      const select=(selection:{campus_id:string;element_id?:string})=>
        http.selectInteriorBuilding(request(fixture.owner,{step_id:wait.step_id,selection}),manualThread,manual.run_id);
      const selection={campus_id:west.id,element_id:computing.element_id};
      await expect(select({campus_id:main.id,element_id:computing.element_id})).rejects.toThrow('no longer available');
      await expect(http.selectInteriorBuilding(request(fixture.learner.actor,{step_id:wait.step_id,selection}),
        manualThread,manual.run_id)).rejects.toThrow('Conversation not found');
      const options=waitEvent((await select({campus_id:west.id})).events);
      expect(options).toMatchObject({step_id:wait.step_id,options:[{campus_id:west.id,element_id:computing.element_id,label:computing.label}]});
      const opened=await select(selection);
      expect(opened.events).toContainEqual(expect.objectContaining(exact));
      expect(waitEvent(opened.events)).toBeUndefined();
      const call=opened.events.filter(event=>event.type==='TOOL_CALL_START').find(event=>event.toolCallName==='open_campus_interiors');
      expect(call?.toolCallId).toBeDefined();
      expect(await select(selection)).toEqual(opened);
      const acknowledged=await http.acknowledgeUiStep(request(fixture.owner,{call_id:call!.toolCallId,status:'applied'}),manualThread,manual.run_id);
      expect(acknowledged.events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
      expect((await select(selection)).events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
      await expect(select({campus_id:main.id,element_id:other.element_id})).rejects.toThrow('different building selection');

      const stopThread=await create();
      const pending=await turn('Lets detail of another building',stopThread);
      const stopped=await http.selectInteriorBuilding(request(fixture.owner,{step_id:waitEvent(pending.events).step_id,cancel:true}),stopThread,pending.run_id);
      expect(waitEvent(stopped.events)).toBeUndefined();
      expect(stopped.events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
      expect(stopped.events).toContainEqual(expect.objectContaining({type:'STATE_SNAPSHOT',snapshot:{status:'completed',progress:'Setup stopped'}}));
      expect(complete).not.toHaveBeenCalled();
    } finally {
      await agent.onModuleDestroy();
    }
  }, 25_000);

  it('recovers a mixed model batch, opens an empty map, and binds a paraphrased editor request to a permitted campus',async()=>{
    complete.mockReset();
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const campusId=randomUUID();
    let campuses:{id:string;name:string;code:string}[]=[];
    let can_edit=true;
    const dispatch=vi.fn(()=>Promise.resolve({can_edit,campuses}));
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,{dispatch} as unknown as AgentGateway,memory);
    const http=new AgentController(agent,memory);
    const {id:thread}=await agent.create(request(fixture.owner,{portal:'principal'}));
    async function send(question:string,tools:string[]) {
      const {run_id}=await http.send(request(fixture.owner,{question,client_id:randomUUID(),ui_context:{screen:'workspace',tools}}),thread);
      const read=async()=>(await http.runEvents(request(fixture.owner),thread,run_id)).events;
      await vi.waitFor(async()=>expect((await read()).at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
      return read;
    }
    complete.mockResolvedValueOnce({text:'',calls:[{id:'navigate',name:'open_virtual_campus',arguments:{}}]});
    const empty=await send('Bring up the school grounds.',['open_virtual_campus']);
    expect(await empty()).toContainEqual(expect.objectContaining({type:'TOOL_CALL_START',toolCallName:'open_virtual_campus'}));

    campuses=[{id:campusId,name:'East Hall',code:'EAST'}];
    complete.mockClear();
    const setup={id:'setup',name:'prepare_campus_setup',arguments:{goal:'set_up_layout',name:'East Hall'}};
    complete.mockResolvedValueOnce({text:'',calls:[{id:'parallel',name:'find_tools',arguments:{query:'campus'}},setup]});
    complete.mockResolvedValueOnce({text:'',calls:[setup]});
    const edit=await send('Could you get East Hall ready for us to trace where the grounds end?',['open_virtual_campus','open_campus_layout']);
    const events=await edit();
    expect(complete.mock.calls[0]?.[1]).toContainEqual(expect.objectContaining({name:'prepare_campus_setup'}));
    expect(complete.mock.calls[1]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({role:'tool',callId:'parallel',content:expect.stringContaining('separate_ui_step')}),
      expect.objectContaining({role:'tool',callId:'setup',content:expect.stringContaining('separate_ui_step')}),
    ]));
    expect(events).toContainEqual(expect.objectContaining({type:'TOOL_CALL_START',toolCallName:'open_campus_layout'}));
    expect(events).toContainEqual(expect.objectContaining({type:'TOOL_CALL_ARGS',delta:JSON.stringify({campus_id:campusId})}));
    expect(JSON.stringify(events)).not.toMatch(/confirmed.*access|administrator access/i);

    can_edit=false;
    expect((await edit()).some(event=>event.type==='TOOL_CALL_START')).toBe(false);
    const actions=(await sql<{count:number}>`SELECT count(*)::int AS count FROM agent_actions action JOIN agent_runs run ON run.id=action.run_id
      WHERE run.thread_id=${thread}::uuid`.execute(db)).rows[0];
    expect(actions?.count).toBe(0);
  },15000);

  describe('bounded adaptive reasoning',()=>{
    const reasoning={id:'plan',name:'request_deeper_reasoning',arguments:{reason:'ambiguous_target'}};
    const workspace={screen:'workspace',tools:['open_virtual_campus']};
    beforeEach(()=>{
      complete.mockReset();
      Object.assign(modelIdentity,{provider:'vertex',model:'gemini-3.8-flash'});
    });
    afterEach(()=>{Object.assign(modelIdentity,{provider:'ollama',model:'isolated-ui-test'});});

    async function harness(dispatch=vi.fn()) {
      const fixture=await createClassPracticeFixture(db);
      await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
      const memory=new AgentMemoryService(db);
      const agent=new AgentService(db,new RolesService(db),fixture.school,{dispatch} as unknown as AgentGateway,memory);
      const http=new AgentController(agent,memory);
      const {id:thread}=await agent.create(request(fixture.owner,{portal:'principal'}));
      async function run(question:string,ui_context:unknown) {
        const {run_id}=await http.send(request(fixture.owner,{question,client_id:randomUUID(),ui_context}),thread);
        const read=async()=>(await http.runEvents(request(fixture.owner),thread,run_id)).events;
        await vi.waitFor(async()=>expect((await read()).at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
        const escalations=(await sql<{metadata:{reason:string;turn:number}}>`SELECT metadata FROM audit_events
          WHERE target_id=${run_id}::uuid AND action='agent.reasoning.escalated'`.execute(db)).rows.map(row=>row.metadata);
        return {run_id,events:await read(),escalations};
      }
      return {run,dispatch};
    }

    const efforts=()=>complete.mock.calls.map(call=>call[4]);
    const offersReasoning=(index:number)=>complete.mock.calls[index]?.[1]
      .some((tool:{name:string})=>tool.name===reasoning.name);

    it('starts on Medium even with sequence language and accepts a necessary user clarification',async()=>{
      const {run,dispatch}=await harness();
      complete.mockResolvedValueOnce({text:'Which learner should I check?',calls:[]});
      const result=await run('Find the attendance entry and then compare it with yesterday.',workspace);
      expect(efforts()).toEqual(['medium']);
      expect(offersReasoning(0)).toBe(true);
      expect(result.escalations).toEqual([]);
      expect(JSON.stringify(result.events)).toContain('Which learner should I check?');
      expect(dispatch).not.toHaveBeenCalled();
    },12000);

    it('keeps the sourced records across one High decision, then returns to Medium for a scoped app action',async()=>{
      const campusId=randomUUID();
      const directory={can_edit:true,campuses:[{id:campusId,name:'Oak Hall',code:'OAK'}]};
      const dispatch=vi.fn().mockResolvedValue(directory);
      const {run}=await harness(dispatch);
      const messages:AgentProviders.ModelMessage[][]=[];
      const replies=[
        {text:'',calls:[{id:'layout-read',name:'virtual_campus_layout',arguments:{}}]},
        {text:'',calls:[reasoning]},
        {text:'',calls:[{id:'discover',name:'find_tools',arguments:{query:'campus map'}}]},
        {text:'',calls:[{id:'navigate',name:'campus_focus_place',arguments:{query:'Library'}}]},
      ];
      for(const reply of replies)complete.mockImplementationOnce((context:AgentProviders.ModelMessage[])=>{
        messages.push(structuredClone(context));
        return Promise.resolve(reply);
      });
      const result=await run('Which library fits tomorrow’s club on the map?',{screen:'virtual_campus',tools:['campus_focus_place'],campus_id:campusId});
      expect(efforts()).toEqual(['medium','medium','high','medium']);
      expect([0,1,2,3].map(offersReasoning)).toEqual([true,true,false,false]);
      const groundedRead=messages[1]?.find(message=>message.callId==='layout-read');
      expect(groundedRead).toMatchObject({role:'tool',name:'virtual_campus_layout',content:expect.stringContaining('Oak Hall')});
      expect(messages[2]).toContainEqual(groundedRead);
      const approval=messages[2]?.find(message=>message.callId==='plan');
      expect(approval).toMatchObject({role:'tool',name:'request_deeper_reasoning'});
      expect(JSON.parse(approval!.content)).toMatchObject({granted:true});
      expect(result.escalations).toEqual([expect.objectContaining({reason:'ambiguous_target',turn:2})]);
      expect(result.events.filter(event=>event.type==='TOOL_CALL_START')).toEqual([
        expect.objectContaining({toolCallName:'campus_focus_place'}),
      ]);
      const actions=(await sql<{count:number}>`SELECT count(*)::int AS count FROM agent_actions WHERE run_id=${result.run_id}::uuid`.execute(db)).rows[0];
      expect(actions?.count).toBe(0);
    },12000);

    it('discards every call in a mixed escalation batch and continues on Medium',async()=>{
      const {run,dispatch}=await harness();
      const navigate={id:'navigate',name:'open_virtual_campus',arguments:{}};
      complete.mockResolvedValueOnce({text:'',calls:[reasoning,navigate]});
      complete.mockResolvedValueOnce({text:'Which campus should I open?',calls:[]});
      const result=await run('Bring up the school grounds.',workspace);
      expect(efforts()).toEqual(['medium','medium']);
      const replies=(complete.mock.calls[1]?.[0] as AgentProviders.ModelMessage[]).filter(message=>message.role==='tool');
      expect(replies.map(message=>({id:message.callId,name:message.name}))).toEqual([
        {id:'plan',name:'request_deeper_reasoning'},
        {id:'navigate',name:'open_virtual_campus'},
      ]);
      expect(replies.every(message=>JSON.parse(message.content).code==='separate_reasoning_step')).toBe(true);
      expect(result.escalations).toEqual([]);
      expect(result.events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    },12000);

    it.each([
      {reason:'invalid_tool_arguments',call:{name:'find_tools',arguments:{query:42}}},
      {reason:null,call:{name:'open_virtual_campus',arguments:{}}},
    ])('uses High only for recoverable invalid arguments, with expected reason $reason',async({reason,call})=>{
      const dispatch=vi.fn().mockRejectedValue(new ForbiddenException('The campus map is outside your current access.'));
      const {run}=await harness(dispatch);
      complete.mockResolvedValueOnce({text:'',calls:[{id:'first-choice',...call}]});
      complete.mockResolvedValueOnce({text:'Choose a campus to continue.',calls:[]});
      const result=await run('Bring up the school grounds.',workspace);
      expect(efforts()).toEqual(['medium',reason?'high':'medium']);
      expect(offersReasoning(1)).toBe(false);
      expect(result.escalations).toEqual(reason?[expect.objectContaining({reason})]:[]);
      expect(result.events.some(event=>event.type==='TOOL_CALL_START')).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(reason?0:1);
    },12000);
  });

  it('reads explicit public web requests without a model or sending the app context, and retains only safe source cards', async () => {
    complete.mockClear();
    vi.stubEnv('CAMPUS_FLOOR_PLAN_FREE_SEARCH_ENABLED','true');
    vi.stubEnv('AGENT_PROVIDER','vertex');
    vi.stubEnv('AGENT_ENABLED_UNTIL','2000-01-01T00:00:00Z');
    const fixture=await createClassPracticeFixture(db);
    await db.updateTable('users').set({pro_features_enabled:true}).where('id','=',fixture.owner.id).execute();
    const dispatch=vi.fn();
    const gateway={dispatch} as unknown as AgentGateway;
    const memory=new AgentMemoryService(db);
    const agent=new AgentService(db,new RolesService(db),fixture.school,gateway,memory);
    const http=new AgentController(agent,memory);
    const {id:threadId}=await agent.create(request(fixture.owner,{portal:'principal'}));
    const sourceUrl='https://science.nasa.gov/moon/';
    const outbound:unknown[]=[], inFlight:string[]=[];
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation((endpoint,options)=>{
      if(typeof endpoint!=='string'||typeof options?.body!=='string')throw new Error('Expected a fixed MCP endpoint and JSON body.');
      expect(endpoint).toMatch(/^https:\/\/mcp\.exa\.ai\/mcp\?tools=web_(search|fetch)_exa$/u);
      const body=JSON.parse(options.body) as {method:string;id:number;params:{name?:string;arguments?:unknown}};
      const selected=endpoint.endsWith('web_search_exa')?'web_search_exa':'web_fetch_exa';
      if(body.method==='notifications/initialized')return Promise.resolve(new Response(null,{status:202}));
      const reply=(result:unknown)=>Promise.resolve(Response.json({jsonrpc:'2.0',id:body.id,result}));
      if(body.method==='initialize')return reply({protocolVersion:'2025-03-26'});
      if(body.method==='tools/list')return reply({tools:[{name:selected}]});
      outbound.push(body.params.arguments);
      const text=selected==='web_search_exa'
        ? `Title: NASA Moon\nURL: ${sourceUrl}\nHighlights: Moon observation.\n---\nTitle: Unsafe\nURL: https://127.0.0.1/`
        : `# NASA Moon\nURL: ${sourceUrl}\n\nPublic information about the Moon.`;
      return sql<{progress:string}>`SELECT progress FROM agent_runs WHERE thread_id=${threadId}::uuid AND status='running'`.execute(db)
        .then(({rows})=>{ inFlight.push(...rows.map(row=>row.progress)); return reply({content:[{type:'text',text}]}); });
    });
    try {
      async function browse(question:string) {
        const body={question,client_id:randomUUID(),ui_context:{screen:'virtual_campus',tools:['open_campus_interiors'],campus_id:randomUUID()}};
        const {run_id}=await http.send(request(fixture.owner,body),threadId);
        await vi.waitFor(async()=>expect((await http.runEvents(request(fixture.owner),threadId,run_id)).events.at(-1)).toMatchObject({type:'RUN_FINISHED'}),{timeout:5000});
        expect(await http.send(request(fixture.owner,body),threadId)).toEqual({run_id});
        return (await http.runEvents(request(fixture.owner),threadId,run_id)).events;
      }
      const search=await browse('Search the web for lunar observations');
      expect(search).toContainEqual(expect.objectContaining({type:'CUSTOM',name:'thatcampus.public-web-source',value:{version:1,
        source:{id:expect.any(String),title:'NASA Moon',url:sourceUrl,description:'Moon observation.'}}}));
      const read=await browse(`Read this public page ${sourceUrl}`);
      expect(read).toContainEqual(expect.objectContaining({type:'CUSTOM',name:'thatcampus.public-web-source',value:{version:1,
        source:{id:expect.any(String),title:'NASA Moon',url:sourceUrl,description:'Public information about the Moon.'}}}));
      const invalid=await browse('Read this public page https://science.nasa.gov/moon/?token=secret');
      expect(invalid.some(event=>event.type==='CUSTOM'||event.type==='TOOL_CALL_START')).toBe(false);
      const simulation={...request(fixture.owner,{question:'Search the web for lunar observations',client_id:randomUUID()}),
        executionEnvironmentView:{mode:'simulation'}} as AuthenticatedRequest;
      await expect(http.send(simulation,threadId)).rejects.toThrow('Simulation');
      expect(outbound).toEqual([{query:'lunar observations',numResults:5},{urls:[sourceUrl],maxCharacters:700}]);
      expect(inFlight).toEqual(['Searching the web','Reading the page']);
      expect(complete).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      const detail=await http.detail(request(fixture.owner),threadId);
      expect(detail.runs[0]).toMatchObject({public_web_sources:[{url:sourceUrl}]});
      const stored=(await sql<{result:unknown}>`SELECT step.result FROM agent_tool_steps step JOIN agent_runs run ON run.id=step.run_id
        WHERE run.thread_id=${threadId}::uuid AND step.capability='assistant_public_web_lookup'`.execute(db)).rows;
      expect(stored).toHaveLength(2);
      expect(JSON.stringify(stored)).not.toContain('description');
      await expect(http.detail(request(fixture.learner.actor),threadId)).rejects.toThrow('Conversation not found');
    } finally { fetch.mockRestore(); }
  },20000);
});
