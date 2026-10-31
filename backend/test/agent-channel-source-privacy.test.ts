import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely,PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { AgentService } from '../src/agent/agent.service.js';
import type { AgentScope } from '../src/agent/catalogue.js';
import type { AgentGateway } from '../src/agent/gateway.js';
import type { AgentMemoryService } from '../src/agent/long-term-memory.js';
import type { AuthenticatedRequest,AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import type { RolesService } from '../src/roles/roles.service.js';
import type { SchoolService } from '../src/school/school.service.js';

const databases:Kysely<Database>[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(databases.splice(0).map(db=>db.destroy()));});

function fixture(){
  // The executor is fully intercepted: these tests never acquire a connection.
  const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:'postgresql://invalid.invalid/unused_privacy_test'})})});
  databases.push(db);
  const schoolId=randomUUID(),threadId=randomUUID(),runId=randomUUID(),sourceId=randomUUID();
  const user={id:randomUUID(),username:'isolated',email:'isolated@example.test',first_name:'Isolated',last_name:'Reader',
    role:'staff',is_active:true,active_school_id:schoolId} as AuthUser;
  const scope:AgentScope={userId:user.id,schoolId,portal:'teacher',studentId:null,permissions:['ai.use','attendance.view'],timezone:'UTC'};
  const thread={id:threadId,title:'Private fixture',owner_id:user.id,school_id:schoolId,portal:'teacher',student_id:null};
  const run={id:runId,thread_id:threadId,status:'completed',answer:'Private learner answer',progress:'Complete',question:'Read my class',
    evidence:[],provider:'fictional',model:'fictional',created_at:new Date()};
  const step={id:randomUUID(),run_id:runId,capability:'class_registers',kind:'read',input:{},result:{classes:[{id:sourceId,name:'Private class'}]},
    snapshot_hash:'fixture',created_at:new Date()};
  const dispatch=vi.fn().mockResolvedValue(step.result);
  const service=new AgentService(db as DatabaseService,{} as RolesService,{} as SchoolService,{dispatch} as unknown as AgentGateway,{} as AgentMemoryService);
  vi.spyOn(service as unknown as {owned:()=>Promise<unknown>},'owned').mockResolvedValue({thread,scope});
  vi.spyOn(db.getExecutor(),'executeQuery').mockImplementation(query=>Promise.resolve({rows:(
    query.sql.includes('FROM agent_tool_steps')?[step]:query.sql.includes('FROM agent_runs')&&query.sql.startsWith('SELECT')?[run]:
      query.sql.includes('FROM agent_actions')&&query.sql.startsWith('SELECT')?[{id:randomUUID(),status:'pending'}]:[]
  )}));
  const request={authUser:user,requestId:randomUUID(),headers:{},cookies:{},internalAgentDelegation:true} as unknown as AuthenticatedRequest;
  return {service,dispatch,scope,step,run,user,request,threadId,runId};
}

describe('current-source privacy for external assistant replies',()=>{
  it('rechecks current domain reads before exposing a retained answer or action',async()=>{
    const f=fixture();
    expect(await f.service.channelRun(f.user,randomUUID(),f.threadId,f.runId)).toMatchObject({answer:f.run.answer,action:{status:'pending'}});
    expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({name:'class_registers',kind:'read'}),{},f.scope,
      expect.objectContaining({delegatedUser:f.user}));
    f.dispatch.mockRejectedValue(new Error('Current class permission was revoked'));
    expect(await f.service.channelRun(f.user,randomUUID(),f.threadId,f.runId)).toMatchObject({status:'completed',progress:'Access changed',action:null});
    expect((await f.service.detail(f.request,f.threadId)).runs[0]).toMatchObject({progress:'Access changed',action:null});
  });
  it('redacts an answer when an aggregate still succeeds but no longer contains a retained record',async()=>{
    const f=fixture();f.dispatch.mockResolvedValue({classes:[{id:randomUUID(),name:'New class'}]});
    const reply=await f.service.channelRun(f.user,randomUUID(),f.threadId,f.runId);
    expect(reply).toMatchObject({progress:'Access changed',action:null});expect(reply.answer).not.toContain(f.run.answer);
    expect((await f.service.detail(f.request,f.threadId)).runs[0]?.answer).not.toContain(f.run.answer);
  });
  it('fails closed without a domain read when its capability is no longer available',async()=>{
    const f=fixture();f.scope.permissions=['ai.use'];
    expect(await f.service.channelRun(f.user,randomUUID(),f.threadId,f.runId)).toMatchObject({progress:'Access changed',action:null});
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('bounds a stalled source recheck without falling back to retained private content',async()=>{
    vi.useFakeTimers();const f=fixture();f.dispatch.mockImplementation(()=>new Promise(()=>{}));
    const pending=f.service.channelRun(f.user,randomUUID(),f.threadId,f.runId);
    await vi.advanceTimersByTimeAsync(12_001);
    expect(await pending).toMatchObject({progress:'Access changed',action:null});
  });
});
