import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const databaseUrl=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const pool=new Pool({connectionString:databaseUrl,max:2});
const base='http://127.0.0.1:8145';
const suffix=randomUUID();const password='Private!TestOnly9-lantern';
let api:ChildProcess;let school:string;
const users:Record<string,string>={};
class Session {
  cookies=new Map<string,string>();
  async request(path:string,body?:unknown,ip='127.0.0.1') {
    const response=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Forwarded-For':ip,Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRFToken':this.cookies.get('csrftoken')??''},...(body?{body:JSON.stringify(body)}:{})});
    for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0]!;const i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return {status:response.status,data:await response.json() as any};
  }
  async login(role:string) { await this.request('/auth/csrf/');return this.request('/auth/login/',{identifier:`private-${role}-${suffix}`,password},`192.0.2.${Object.keys(users).indexOf(role)+1}`); }
}
beforeAll(async()=>{
  school=(await pool.query("INSERT INTO schools(name,code) VALUES('Private login test',$1) RETURNING id",[`private-${suffix.slice(0,8)}`])).rows[0].id;
  for(const role of ['admin','staff','parent','student']) {
    users[role]=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Private','Test',$4) RETURNING id",[`private-${role}-${suffix}`,`private-${role}-${suffix}@example.test`,await hashPassword(password),role])).rows[0].id;
    await pool.query('INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)',[school,users[role],role==='parent'?'guardian':role]);
  }
  api=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:databaseUrl,EVENT_DATABASE_URL:databaseUrl,NODE_ENV:'test',DEPLOYMENT_ENVIRONMENT:'test',DEMO_MODE:'false',HOST:'127.0.0.1',PORT:'8145',TRUST_PROXY:'true',RATE_LIMIT_STORE:'postgres',COOKIE_SECRET:'private-login-test-cookie-secret-32-chars',AGENT_PROVIDER:'ollama',AGENT_MODEL:'not-running-test-model',AGENT_USER_HOURLY_LIMIT:'1',LOG_LEVEL:'silent'},stdio:['ignore','ignore','inherit']});
  for(let i=0;i<150;i++){try{if((await fetch(base+'/readyz')).ok)return;}catch{/* starting */}await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error('Private-login test API did not start');
});
afterAll(async()=>{api?.kill('SIGTERM');await pool.end();});
describe('private accounts and durable abuse controls',()=>{
  it('rejects public demo bypass and anonymous agent access',async()=>{
    const session=new Session();
    expect((await session.request('/auth/session/')).data.demo_mode).toBe(false);
    expect((await session.request('/auth/demo-session/',{role:'admin'})).status).toBe(404);
    expect((await session.request('/agent/status?portal=principal')).status).toBe(401);
  });
  it('authenticates all four roles with their unambiguous school membership',async()=>{
    for(const role of Object.keys(users)) {
      const session=new Session();const login=await session.login(role);
      expect(login.status).toBe(200);expect(login.data.user.active_school_id).toBe(school);
      const restored=await session.request('/auth/session/');
      expect(restored.data.user).toMatchObject({id:users[role],role,active_school_id:school});
    }
  });
  it('rejects the published demo password even if an old database hash remains',async()=>{
    const id=users.student!;
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword('OmniDemo@2026'),id]);
    try {const session=new Session();await session.request('/auth/csrf/');expect((await session.request('/auth/login/',{identifier:`private-student-${suffix}`,password:'OmniDemo@2026'},'192.0.2.20')).status).toBe(401);}
    finally {await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(password),id]);}
  });
  it('limits login attempts per account even when forwarded IP and trailing slash change',async()=>{
    const session=new Session();await session.request('/auth/csrf/');
    for(let i=0;i<11;i++) {
      const response=await session.request(i%2?'/auth/login':'/auth/login/',{identifier:`missing-${suffix}`,password:'WrongPrivate!Pass9'},`192.0.2.${30+i}`);
      expect(response.status).toBe(i===10?429:401);
    }
  });
  it('counts prior runs across newly created threads before calling any model',async()=>{
    const session=new Session();await session.login('admin');
    const first=await session.request('/agent/threads',{portal:'principal'});expect(first.status).toBe(201);
    await pool.query("INSERT INTO agent_runs(thread_id,client_id,question,status,provider,model) VALUES($1,$2,'Synthetic consumed allowance','failed','ollama','test')",[first.data.id,randomUUID()]);
    const second=await session.request('/agent/threads',{portal:'principal'});expect(second.status).toBe(201);
    const denied=await session.request(`/agent/threads/${second.data.id}/messages`,{question:'Read my overview',client_id:randomUUID()});
    expect(denied.status).toBe(429);
    expect((await pool.query('SELECT count(*)::int n FROM agent_runs WHERE thread_id=$1',[second.data.id])).rows[0].n).toBe(0);
  });
});
