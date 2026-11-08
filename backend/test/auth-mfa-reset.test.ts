import 'reflect-metadata';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import type { AuditService } from '../src/common/audit.service.js';
import type { AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';

vi.mock('../src/config.js',()=>({config:()=>({SESSION_TTL_SECONDS:28800})}));

const user = {id:'30000000-0000-4000-8000-000000000001',username:'mfa.account',email:'mfa@example.test',
  first_name:'Mfa',last_name:'Account',role:'admin',is_active:true,password_hash:'verified-password-hash',active_school_id:null} as const;
const request = {ip:'127.0.0.1',headers:{},requestId:'local-mfa-regression'} as unknown as FastifyRequest;
function fixture(options: {active?:boolean;currentHash?:string;factorActive?:boolean}={}) {
  const queries:CompiledQuery[]=[];
  class Driver extends DummyDriver {
    override acquireConnection():Promise<DatabaseConnection> {return Promise.resolve({executeQuery:<R>(query:CompiledQuery):Promise<QueryResult<R>>=>{
      queries.push(query);let rows:unknown[]=[];
      if(query.sql.startsWith('select ')&&query.sql.includes('from "users"')) rows=options.active===false?[]:[{...user,password_hash:options.currentHash??user.password_hash}];
      else if(query.sql.startsWith("SELECT status='active' AS active FROM auth_mfa_factors"))rows=[{active:options.factorActive??true}];
      else if(query.sql.startsWith('select ')&&query.sql.includes('from "school_memberships"'))rows=[];
      else if(!/^(?:DELETE FROM auth_mfa_login_challenges|INSERT INTO auth_mfa_login_challenges|insert into "auth_sessions")/u.test(query.sql))throw new Error(`Unexpected MFA regression query: ${query.sql}`);
      return Promise.resolve({rows:rows as R[]});
    },streamQuery:()=>{throw new Error('No streaming in the MFA fixture.');}});}
  }
  const db=new Kysely<Database>({dialect:{createAdapter:()=>new PostgresAdapter(),createDriver:()=>new Driver(),createIntrospector:value=>new PostgresIntrospector(value),createQueryCompiler:()=>new PostgresQueryCompiler()}});
  const audit={record:vi.fn().mockResolvedValue(undefined)};
  return {db,queries,audit,auth:new AuthService(db as DatabaseService,audit as unknown as AuditService,{} as never,{} as never)};
}
describe('MFA primary-proof serialization',()=>{
  it('refuses a reset password snapshot before issuing a new MFA challenge',async()=>{
    const f=fixture({currentHash:'new-password-after-reset'});
    try{await expect(f.auth.finishPrimaryLogin({...user},request)).rejects.toMatchObject({status:401});
      expect(f.queries.some(q=>q.sql.startsWith('INSERT INTO auth_mfa_login_challenges'))).toBe(false);expect(f.audit.record).not.toHaveBeenCalled();
    }finally{await f.db.destroy();}
  });
  it('refuses a deactivated account before issuing an MFA challenge',async()=>{
    const f=fixture({active:false});
    try{await expect(f.auth.finishPrimaryLogin({...user},request)).rejects.toMatchObject({status:401});expect(f.queries.some(q=>q.sql.startsWith('INSERT INTO auth_mfa_login_challenges'))).toBe(false);
    }finally{await f.db.destroy();}
  });
  it('takes the account lock before current factor lookup and replaces only this account’s challenge',async()=>{
    const f=fixture();
    try{expect(await f.auth.finishPrimaryLogin({...user},request)).toHaveProperty('mfaChallenge');
      expect(f.queries[0]!.sql).toMatch(/from "users".*for no key update/u);
      expect(f.queries[1]!.sql).toContain('FROM auth_mfa_factors');
      const cleanup=f.queries.find(q=>q.sql.startsWith('DELETE FROM auth_mfa_login_challenges'))!;
      expect(cleanup.parameters).toEqual([user.id]);expect(cleanup.sql).not.toContain('OR expires_at');
    }finally{await f.db.destroy();}
  });
  it('cannot issue a plain password session after MFA became active',async()=>{
    const f=fixture();
    try{await expect(f.auth.createSession({...user} satisfies AuthUser,request)).rejects.toMatchObject({status:401});
      expect(f.queries.some(q=>q.sql.startsWith('insert into "auth_sessions"'))).toBe(false);
    }finally{await f.db.destroy();}
  });
});
