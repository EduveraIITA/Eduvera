import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
const suite=process.env.TEST_DATABASE_ISOLATED==='true' ? describe : describe.skip;
suite('custom school roles against disposable PostgreSQL',()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  const base='http://127.0.0.1:8059/api/v1';
  const actors:Record<string,Map<string,string>>={admin:new Map(),staff:new Map(),parent:new Map()};
  let server:ChildProcess,school:string,otherSchool:string,admin:string,staff:string,role:string;
  const suffix=randomUUID();const password='R0les!TestPebble2026';
  async function request(actor:string,path:string,body?:unknown,method=body===undefined?'GET':'POST',csrf=true){
    const jar=actors[actor]!;const headers:Record<string,string>={Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(body!==undefined)headers['Content-Type']='application/json';if(csrf&&jar.get('csrftoken'))headers['X-CSRFToken']=jar.get('csrftoken')!;
    const res=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    for(const cookie of res.headers.getSetCookie()){const pair=cookie.split(';')[0]!;const at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
    const data: any = await res.json(); return {status:res.status,data};
  }
  const path=(tail:string)=>`/schools/${school}/roles/${tail}`;
  beforeAll(async()=>{
    school=(await pool.query("INSERT INTO schools(name,code) VALUES('Role Test',$1) RETURNING id",['roles-'+suffix.slice(0,12)])).rows[0].id;
    otherSchool=(await pool.query("INSERT INTO schools(name,code) VALUES('Other Role Test',$1) RETURNING id",['other-'+suffix.slice(0,12)])).rows[0].id;
    for(const [actor,accountRole,memberRole] of [['admin','admin','admin'],['staff','staff','staff'],['parent','parent','guardian']]){
      const id=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,'Role Test',$5) RETURNING id",[actor+'.'+suffix,actor+'.'+suffix+'@example.test',await hashPassword(password),actor,accountRole])).rows[0].id;
      if(actor==='admin')admin=id;if(actor==='staff')staff=id;
      await pool.query('INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)',[school,id,memberRole]);
    }
    server=spawn(process.execPath,['dist/main.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'8059',COOKIE_SECRET:'roles-test-cookie-secret-at-least-32',NODE_ENV:'test',RATE_LIMIT_STORE:'memory',LOG_LEVEL:'silent'},stdio:['ignore','ignore','inherit']});
    let ready=false;for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:8059/healthz')).ok){ready=true;break;}}catch{/* startup */}await new Promise(r=>setTimeout(r,50));}expect(ready).toBe(true);
    for(const actor of Object.keys(actors)){await request(actor,'/auth/csrf/');expect((await request(actor,'/auth/login/',{identifier:actor+'.'+suffix,password})).status).toBe(200);}
  },30000);
  afterAll(async()=>{server?.kill('SIGTERM');await pool.end();});
  it('allows admin workspace but rejects staff, families and other schools',async()=>{
    expect((await request('admin',path('workspace/'))).status).toBe(200);
    expect((await request('staff',path('workspace/'))).status).toBe(403);
    expect((await request('parent',path('workspace/'))).status).toBe(403);
    expect((await request('admin',`/schools/${otherSchool}/roles/workspace/`)).status).toBe(403);
  });
  it('validates permissions and CSRF, creates a role and rejects duplicate names',async()=>{
    expect((await request('admin',path(''),{name:'Invalid',permissions:['roles.manage']})).status).toBe(400);
    expect((await request('admin',path(''),{name:'Observer',permissions:['attendance.view']},'POST',false)).status).toBe(403);
    const result=await request('admin',path(''),{name:'Observer',description:'Registers only',permissions:['attendance.view']});expect(result.status).toBe(201);role=result.data.id;
    expect((await request('admin',path(''),{name:'observer',permissions:[]})).status).toBe(409);
    expect((await request('staff',path(''),{name:'Escalation',permissions:['fees.manage']})).status).toBe(403);
  });
  it('protects admin accounts and rejects cross-school assignments and stale changes',async()=>{
    expect((await request('admin',path(`members/${admin}/assignment/`),{role_id:role,expected_role_id:null})).status).toBe(403);
    expect((await request('admin',path(`members/${staff}/assignment/`),{role_id:randomUUID(),expected_role_id:null})).status).toBe(404);
    expect((await request('admin',path(`members/${staff}/assignment/`),{role_id:role,expected_role_id:randomUUID()})).status).toBe(409);
    expect((await request('admin',path(`members/${staff}/assignment/`),{role_id:role,expected_role_id:null})).status).toBe(201);
    const effective=await request('staff',path('effective/'));expect(effective.data.permissions).toEqual(['attendance.view']);
    expect((await request('admin',path(`${role}/delete/`),{expected_revision:1})).status).toBe(409);
  });
  it('enforces removed permissions in an existing session and ignores old grants',async()=>{
    await pool.query("INSERT INTO school_permission_grants(school_id,user_id,permission) VALUES($1,$2,'fees.manage')",[school,staff]);
    for(const [url,body] of [[`/schools/${school}/fees/`,undefined],[`/schools/${school}/administration/`,undefined],['/teacher/attendance/bulk/',{}],['/chat/conversations/',undefined],[`/day-plans/teacher?school_id=${school}&date=2026-10-04`,undefined]]){
      expect((await request('staff',url as string,body)).status).toBe(403);
    }
    expect((await request('admin',path(`${role}/`),{name:'Accountant',description:'Finance only',permissions:['fees.manage'],expected_revision:1},'PATCH')).status).toBe(200);
    expect((await request('staff',`/schools/${school}/fees/`)).status).toBe(200);
    expect((await request('staff','/screens/teacher/attendance/')).status).toBe(403);
    expect((await request('admin',path(`${role}/`),{name:'Stale',permissions:[],expected_revision:1},'PATCH')).status).toBe(409);
    expect((await request('admin',path(`${role}/`),{name:'No tools',permissions:[],expected_revision:2},'PATCH')).status).toBe(200);
    expect((await request('staff',`/schools/${school}/fees/`)).status).toBe(403);
  });
  it('restores baseline when cleared, audits changes, deletes unused roles',async()=>{
    expect((await request('staff',path(`members/${staff}/assignment/`),{role_id:null,expected_role_id:role})).status).toBe(403);
    expect((await request('admin',path(`members/${staff}/assignment/`),{role_id:null,expected_role_id:role})).status).toBe(201);
    const effective=await request('staff',path('effective/'));expect(effective.data.permissions).toContain('attendance.record');expect(effective.data.permissions).toContain('fees.manage');
    expect((await request('admin',path(`${role}/delete/`),{expected_revision:3})).status).toBe(201);
    const audit=await pool.query("SELECT action FROM school_operations_audit WHERE school_id=$1 AND action LIKE 'role.%'",[school]);expect(audit.rows.map(r=>r.action)).toEqual(expect.arrayContaining(['role.created','role.updated','role.assigned','role.deleted']));
  });
  it('revokes access on membership deactivation',async()=>{
    await pool.query('UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2',[school,staff]);
    expect((await request('staff',path('effective/'))).status).toBe(403);
  });
});
