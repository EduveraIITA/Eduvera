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
});
