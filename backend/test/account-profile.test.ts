import { describe, expect, it, vi } from 'vitest';
import { defer, lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { accountProfileChangeSchema } from '../src/auth/account-profile.contracts.js';
import { AuthService } from '../src/auth/auth.service.js';
import { ExecutionEnvironmentInterceptor } from '../src/auth/execution-environment.interceptor.js';
import { simulationSessionExecutionEnvironment } from '../src/auth/session-execution-environment.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ExecutionDataPlaneRegistry, ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import type { AuthenticatedRequest } from '../src/common/request.js';
import { randomUUID } from 'node:crypto';

const input = { first_name: '  Aditi  Menon  ', last_name: '', expected_first_name: ' Legacy ', expected_last_name: ' Name ' };
const selected = simulationSessionExecutionEnvironment({institution_id:'10000000-0000-4000-8000-000000000001',scenario_id:'20000000-0000-4000-8000-000000000001',run_id:'30000000-0000-4000-8000-000000000001',namespace_id:'scenario:20000000-0000-4000-8000-000000000001:run:30000000-0000-4000-8000-000000000001',virtual_now:'2026-10-25T00:00:00Z',time_zone:'UTC',source_snapshot_at:'2026-10-24T00:00:00Z',source_snapshot_ref:'sha256:profile',expires_at:'2099-01-01T00:00:00Z'},{manifest_ref:'profile-test',checked_at:'2026-10-25T00:00:00Z'});

describe('self account name boundary', () => {
  it('trims only desired edges while preserving spelling, internal spacing and exact legacy expectations', () => {
    expect(accountProfileChangeSchema.parse(input)).toEqual({...input,first_name:'Aditi  Menon'});
    expect(accountProfileChangeSchema.parse({...input,first_name:'श्रुति नायर',expected_first_name:'𐐀'.repeat(150)}).expected_first_name).toHaveLength(300);
  });
  it.each([
    {...input,first_name:' ',last_name:' '}, {...input,first_name:'Aditi\nMenon'}, {...input,first_name:'A'.repeat(151)},
    {...input,email:'changed@example.test'}, {...input,user_id:'someone-else'}, {...input,expected_first_name:undefined},
  ])('refuses invalid names and unrelated identity mutations %#', body => {
    expect(accountProfileChangeSchema.safeParse(body).success).toBe(false);
  });
  it.each(['internalAgentDelegation','hostedCampusSimulator','publicDemo'])('refuses %s before opening a database transaction', async flag => {
    const transaction=vi.fn();const service=new AuthService({transaction} as never,{} as never,{} as never,{} as never);
    await expect(service.updateAccountProfile({[flag]:true,body:input} as unknown as AuthenticatedRequest)).rejects.toThrow(/own signed-in account/);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('refuses an accidental domain-scoped invocation instead of changing captured account rows', async () => {
    const transaction=vi.fn();const service=new AuthService({transaction} as never,{} as never,{} as never,{} as never);
    await executionEnvironmentStorage.run(selected.environment!,async()=>{
      await expect(service.updateAccountProfile({body:input} as AuthenticatedRequest)).rejects.toThrow(/account control plane/);
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('keeps the authenticated profile route on the account control plane when a Simulation is selected', async () => {
    const scope=new ExecutionDataPlaneScope();const run=vi.spyOn(scope,'run');const registry=new ExecutionDataPlaneRegistry();
    const request={url:'/api/v1/auth/profile/',method:'PATCH',executionEnvironment:selected.environment,executionEnvironmentView:selected.view};
    const context={switchToHttp:()=>({getRequest:()=>request})} as unknown as ExecutionContext;
    const interceptor=new ExecutionEnvironmentInterceptor(scope,registry);
    const result=await lastValueFrom(interceptor.intercept(context,{handle:()=>defer(()=>of(executionEnvironmentStorage.getStore()??'account-control-plane'))}));
    expect(result).toBe('account-control-plane');expect(run).not.toHaveBeenCalled();
  });
  it('changes an active own account without an active institution or a campus authority lookup', async () => {
    const user={id:randomUUID(),username:'own-account',email:'own@example.test',first_name:'',last_name:'',avatar_url:'',role:'member' as const,is_active:true,email_verified_at:null,active_school_id:null};
    const writes:string[]=[];
    function builder(value:unknown) {
      const query:Record<string, (...args:unknown[])=>unknown>={};
      for(const method of ['select','where','forUpdate','set','values'])query[method]=()=>query;
      query.executeTakeFirst=()=>Promise.resolve(value);query.execute=()=>Promise.resolve([]);return query;
    }
    const tx={selectFrom:(table:string)=>{if(!['auth_sessions','users'].includes(table))throw new Error('Unexpected campus lookup');return builder(table==='auth_sessions'?{is_public_demo:false}:user);},
      updateTable:(table:string)=>{writes.push(table);return builder(undefined);},insertInto:(table:string)=>{writes.push(table);return builder(undefined);}};
    const service=new AuthService({transaction:()=>({execute:(work:(value:typeof tx)=>unknown)=>work(tx)})} as never,{} as never,{} as never,{} as never);
    const result=await service.updateAccountProfile({authUser:user,sessionHash:'ordinary-session',ip:'127.0.0.1',requestId:randomUUID(),body:{first_name:'Aditi',last_name:'Menon',expected_first_name:'',expected_last_name:''}} as AuthenticatedRequest);
    expect(result).toMatchObject({changed:true,scope:'account',user:{id:user.id,email:user.email,role:'member',first_name:'Aditi',last_name:'Menon',active_school_id:null}});
    expect(writes).toEqual(['users','audit_events']);
  });
});
