import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

const complete=vi.hoisted(()=>vi.fn());
vi.mock('../src/agent/providers.js', async importOriginal => ({
  ...await importOriginal<typeof AgentProviders>(),
  createAgentModel:()=>({provider:'ollama',model:'isolated-ui-test',complete}),
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
    const outbound:unknown[]=[];
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
      return reply({content:[{type:'text',text}]});
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
