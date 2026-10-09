import { invitationCodeHash } from '../src/common/invitation-code.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite('company provisioning and delegated onboarding against PostgreSQL',()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
  const base='http://127.0.0.1:8061/api/v1/';const suffix=randomUUID();const password='Str0ng!RiverPebbles2026';
  const cookies:Record<string,Map<string,string>>={company:new Map(),admin:new Map(),staff:new Map(),public:new Map(),firstAdmin:new Map(),invitedStaff:new Map()};
  let server:ChildProcess,companyId:string,adminId:string,staffId:string,staffProfileId:string,school:string,createdSchool:string,firstCode:string,delegatedRole:string,student:string,guardian:string,revocableCode:string,recordsDuty:string;
  const firstEmail=`first.${suffix}@example.test`;
  async function request(actor:string,path:string,body?:unknown,method=body===undefined?'GET':'POST',csrf=true){
    const jar=cookies[actor]!;const headers:Record<string,string>={Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(body!==undefined)headers['Content-Type']='application/json';if(csrf&&jar.get('csrftoken'))headers['X-CSRFToken']=jar.get('csrftoken')!;
    const response=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0]!;const at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
    const data:any=await response.json();return {status:response.status,data};
  }
  const path=(tail:string)=>`schools/${school}/${tail}/`;
  const join=(token:string,email:string)=>({token,email,password,first_name:'Onboard',last_name:'Tester'});
  beforeAll(async()=>{
    school=(await pool.query("INSERT INTO schools(name,code) VALUES('Onboarding Test',$1) RETURNING id",['onboard-'+suffix.slice(0,12)])).rows[0].id;
    for(const actor of ['company','admin','staff']){
      const user=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,'Tester',$5) RETURNING id",[actor+'.'+suffix,actor+'.'+suffix+'@example.test',await hashPassword(password),actor,actor==='staff'?'staff':'admin'])).rows[0].id;
      if(actor==='company'){companyId=user;await pool.query('INSERT INTO company_operators(user_id) VALUES($1)',[user]);}
      else{if(actor==='admin')adminId=user;else staffId=user;await pool.query('INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)',[school,user,actor]);}
    }
    staffProfileId=(await pool.query(`INSERT INTO staff_profiles(
      school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by
    ) SELECT $1,id,'OPS-001',first_name,last_name,email,'non_teaching','Admissions coordinator','full_time',current_date,'active',$3,$3
      FROM users WHERE id=$2 RETURNING id`,[school,staffId,adminId])).rows[0].id;
    server=spawn(process.execPath,['dist/main.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'8061',COOKIE_SECRET:'onboarding-test-cookie-secret-at-least-32',NODE_ENV:'test',RATE_LIMIT_STORE:'postgres',LOG_LEVEL:'silent'},stdio:['ignore','ignore','inherit']});
    let ready=false;for(let n=0;n<160;n++){try{if((await fetch('http://127.0.0.1:8061/healthz')).ok){ready=true;break;}}catch{/* startup */}await new Promise(r=>setTimeout(r,50));}expect(ready).toBe(true);
    for(const actor of Object.keys(cookies)){await request(actor,'auth/csrf/');if(['company','admin','staff'].includes(actor))expect((await request(actor,'auth/login/',{identifier:actor+'.'+suffix,password})).status).toBe(200);}
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Native','Student') RETURNING id",[school])).rows[0].id;
    student=(await pool.query("INSERT INTO students(school_id,person_id,admission_number,date_of_birth) VALUES($1,$2,$3,'2014-01-01') RETURNING id",[school,person,'NEW-'+suffix.slice(0,8)])).rows[0].id;
    const guardianPerson=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Native','Guardian') RETURNING id",[school])).rows[0].id;
    guardian=(await pool.query("INSERT INTO parents(phone) VALUES('9999999999') RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)',[school,guardian,guardianPerson]);
    await pool.query("INSERT INTO guardian_relationships(student_id,guardian_id,relationship,is_primary) VALUES($1,$2,'guardian',true)",[student,guardian]);
  },30000);
  // Keep rate limiting enabled; each isolated scenario gets a fresh test-only acceptance bucket.
  beforeEach(async()=>{await pool.query('DELETE FROM api_rate_limit_buckets WHERE bucket_key=$1',[createHash('sha256').update('127.0.0.1:POST:/api/v1/invitations/accept/').digest('hex')]);});
  afterAll(async()=>{server?.kill('SIGTERM');await pool.end();});
  it('separates company operators from school admins and school data',async()=>{
    expect((await request('company','company/workspace/')).status).toBe(200);
    expect((await request('admin','company/workspace/')).status).toBe(403);
    expect((await request('staff','company/workspace/')).status).toBe(403);
    expect((await request('admin','schools/',{name:'Forbidden',code:'forbidden-'+suffix.slice(0,6)})).status).toBe(403);
    expect((await request('company',path('administration'))).status).toBe(403);
    expect((await request('company','auth/me/')).data.company_operator).toBe(true);
    expect((await request('admin','auth/me/')).data.company_operator).toBe(false);
  });
  it('creates a college and first admin invitation atomically without membership for company',async()=>{
    const payload={name:'Lotus Test College',code:'college-'+suffix.slice(0,10),institution_kind:'college',admin_email:firstEmail};
    expect((await request('company','company/institutions/',payload,'POST',false)).status).toBe(403);
    const result=await request('company','company/institutions/',payload);expect(result.status).toBe(201);createdSchool=result.data.school.id;firstCode=result.data.invitation.token;
    expect(result.data.school.institution_kind).toBe('college');expect(firstCode).toMatch(/^\d{6}$/);
    expect((await pool.query('SELECT institution_kind,capability_packs FROM institution_regulatory_profiles WHERE school_id=$1',[createdSchool])).rows[0]).toEqual({institution_kind:'college',capability_packs:['india_college_core']});
    expect((await pool.query('SELECT 1 FROM school_memberships WHERE school_id=$1',[createdSchool])).rowCount).toBe(0);
    expect((await pool.query('SELECT token_hash FROM school_invitations WHERE school_id=$1',[createdSchool])).rows[0].token_hash).not.toBe(firstCode);
    expect((await request('company','company/institutions/',payload)).status).toBe(409);
    expect((await request('admin','company/institutions/',{...payload,code:'other-'+suffix.slice(0,8)})).status).toBe(403);
  });
  it('activates first admin once with a matching email and routes empty institution to setup',async()=>{
    expect((await request('public','invitations/accept/',join(firstCode,'wrong@example.test'))).status).toBe(400);
    expect((await request('public','invitations/accept/',join(firstCode,firstEmail))).status).toBe(200);
    expect((await request('public','invitations/accept/',join(firstCode,firstEmail))).status).toBe(400);
    expect((await request('firstAdmin','auth/login/',{identifier:firstEmail,password})).status).toBe(200);
    const profile=(await request('firstAdmin','auth/me/')).data;expect(profile.company_operator).toBe(false);expect(profile.institution_setup_required).toBe(true);expect(profile.memberships[0].school_id).toBe(createdSchool);expect(profile.memberships[0].role).toBe('admin');
    expect((await request('firstAdmin',`schools/${createdSchool}/administration/`)).status).toBe(200);
    expect((await request('firstAdmin',path('administration'))).status).toBe(403);
  });
  it('delegates invites and enrollment but prevents leadership or institution escalation',async()=>{
    const workspace=await request('admin',path('roles/workspace'));
    const membershipDuty=workspace.data.duties.find((item:{code:string})=>item.code==='membership_coordinator').id;
    recordsDuty=workspace.data.duties.find((item:{code:string})=>item.code==='student_records_officer').id;
    const result=await request('admin',path('roles'),{name:'Admissions Coordinator',description:'Ordinary member onboarding and student records',duty_ids:[membershipDuty,recordsDuty],template_key:'office'});expect(result.status).toBe(201);delegatedRole=result.data.id;
    expect((await request('admin',path(`roles/members/${staffId}/assignment`),{profile_ids:[delegatedRole],primary_profile_id:delegatedRole,expected_profile_ids:[]})).status).toBe(201);
    await pool.query(`INSERT INTO staff_responsibility_assignments(
      school_id,responsibility_type_id,staff_profile_id,starts_on,status,assigned_by,responded_at
    ) SELECT $1,id,$2,current_date,'active',$3,now() FROM staff_responsibility_types
      WHERE school_id=$1 AND code IN ('membership_coordinator','student_records_officer')`,[school,staffProfileId,adminId]);
    expect((await request('staff',path('invitations/workspace'))).data.can_invite_admin).toBe(false);
    expect((await request('staff',`people/students?school_id=${school}`)).status).toBe(200);
    expect((await request('staff',`people/imports/template?school_id=${createdSchool}`)).status).toBe(403);
    expect((await request('staff',path('invitations'),{email:'escalation@example.test',role:'admin'})).status).toBe(403);
    expect((await request('staff',path('invitations'),{email:'escalation@example.test',role:'staff',custom_role_id:delegatedRole})).status).toBe(400);
    expect((await request('staff',path('roles'),{name:'Escalation',description:'Forbidden profile change',duty_ids:[]})).status).toBe(403);
    expect((await request('staff',`schools/${createdSchool}/invitations/workspace/`)).status).toBe(403);
  });
  it('links student account activation to its existing school record',async()=>{
    const email='student.'+suffix+'@example.test';
    expect((await request('staff',path('invitations'),{email,role:'student',student_id:randomUUID()})).status).toBe(400);
    const result=await request('staff',path('invitations'),{email,role:'student',student_id:student});expect(result.status).toBe(201);
    expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(200);
    const linked=(await pool.query('SELECT u.email,m.role FROM students s JOIN users u ON u.id=s.user_id JOIN school_memberships m ON m.user_id=u.id AND m.school_id=s.school_id WHERE s.id=$1',[student])).rows[0];expect(linked.email).toBe(email);expect(linked.role).toBe('student');
  });
  it('activates a guardian without creating a duplicate guardian record',async()=>{
    const email='guardian.'+suffix+'@example.test';const result=await request('staff',path('invitations'),{email,role:'guardian',guardian_id:guardian});expect(result.status).toBe(201);
    expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(200);
    expect((await pool.query('SELECT u.email FROM parents p JOIN users u ON u.id=p.user_id WHERE p.id=$1',[guardian])).rows[0].email).toBe(email);
  });
  it('resends school invitations with rotation, cooldown and tenant protection',async()=>{
    const email='resend.'+suffix+'@example.test';
    const original=await request('admin',path('invitations'),{email,role:'staff'});
    const id=original.data.id;
    expect((await request('admin',path(`invitations/${id}/resend`),{})).status).toBe(409);
    await pool.query("UPDATE school_invitations SET created_at=now()-interval '2 minutes' WHERE id=$1",[id]);
    expect((await request('admin',path(`invitations/${id}/resend`),{},'POST',false)).status).toBe(403);
    expect((await request('staff',`schools/${createdSchool}/invitations/${id}/resend/`,{})).status).toBe(403);
    const replacement=await request('staff',path(`invitations/${id}/resend`),{});
    expect(replacement.status).toBe(201);
    expect(replacement.data.email).toBe(email);
    expect(replacement.data.token).not.toBe(original.data.token);
    const stored=(await pool.query('SELECT token_hash,role FROM school_invitations WHERE id=$1',[id])).rows[0];
    expect(stored.token_hash).toBe(invitationCodeHash(email,replacement.data.token));
    expect(stored.role).toBe('staff');
    expect((await request('public','invitations/accept/',join(original.data.token,email))).status).toBe(400);
    await request('admin',path(`invitations/${id}/revoke`),{});
    expect((await request('admin',path(`invitations/${id}/resend`),{})).status).toBe(404);
  });
  it('restricts company resend to company operators and invalidates the old code',async()=>{
    const email='companyresend.'+suffix+'@example.test';
    const root=`company/institutions/${createdSchool}/admin-invitations/`;
    const original=await request('company',root,{email});
    const id=original.data.id;
    expect((await request('company',`${root}${id}/resend/`,{})).status).toBe(409);
    await pool.query("UPDATE school_invitations SET created_at=now()-interval '2 minutes' WHERE id=$1",[id]);
    expect((await request('admin',`${root}${id}/resend/`,{})).status).toBe(403);
    const replacement=await request('company',`${root}${id}/resend/`,{});
    expect(replacement.status).toBe(201);
    expect(replacement.data.token).not.toBe(original.data.token);
    expect((await request('public','invitations/accept/',join(original.data.token,email))).status).toBe(400);
    await request('company',`${root}${id}/revoke/`,{});
    expect((await request('company',`${root}${id}/resend/`,{})).status).toBe(404);
  });
  it('limits invitation guesses per recipient across requests',async()=>{
    const email='guesslimit.'+suffix+'@example.test';
    const payload=join('012345',email);
    for(let attempt=0;attempt<5;attempt++) expect((await request('public','invitations/accept/',payload)).status).toBe(400);
    expect((await request('public','invitations/accept/',payload)).status).toBe(429);
    const bucket=createHash('sha256').update('invitation-email:'+email).digest('hex');
    expect((await pool.query('SELECT hits FROM api_rate_limit_buckets WHERE bucket_key=$1',[bucket])).rows[0].hits).toBe(6);
  });
  it('activates a staff account without granting work access through the invitation',async()=>{
    const email='staffinvite.'+suffix+'@example.test';const result=await request('admin',path('invitations'),{email,role:'staff'});expect(result.status).toBe(201);
    expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(200);
    expect((await request('invitedStaff','auth/login/',{identifier:email,password})).status).toBe(200);
    const effective=await request('invitedStaff',path('roles/effective'));expect(effective.data.custom_role).toBeNull();expect(effective.data.permissions).toEqual([]);
  });
  it('requires an existing account password rather than resetting it',async()=>{
    const existingEmail='admin.'+suffix+'@example.test';const result=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email:existingEmail});
    expect((await request('public','invitations/accept/',{...join(result.data.token,existingEmail),password:'Different!RiverPebbles2026'})).status).toBe(403);
    expect((await request('public','invitations/accept/',join(result.data.token,existingEmail))).status).toBe(200);
    expect((await pool.query("SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=$2 AND role='admin'",[adminId,createdSchool])).rowCount).toBe(1);
  });
  it('rejects expired and revoked codes and audits the complete company handoff',async()=>{
    const invite=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email:'expire.'+suffix+'@example.test'});
    await pool.query("UPDATE school_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",[invite.data.id]);expect((await request('public','invitations/accept/',join(invite.data.token,'expire.'+suffix+'@example.test'))).status).toBe(400);
    const revoked=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email:'revoke.'+suffix+'@example.test'});
    expect((await request('company',`company/institutions/${createdSchool}/admin-invitations/${revoked.data.id}/revoke/`,{})).status).toBe(201);
    expect((await request('public','invitations/accept/',join(revoked.data.token,'revoke.'+suffix+'@example.test'))).status).toBe(400);
    const audit=await pool.query('SELECT action,metadata FROM company_audit WHERE school_id=$1',[createdSchool]);expect(audit.rows.map(r=>r.action)).toEqual(expect.arrayContaining(['company.institution_created','company.admin_invited','company.admin_joined','company.admin_invitation_revoked']));expect(JSON.stringify(audit.rows)).not.toContain(firstCode);
  });
  it('invalidates delegated invitations when the creator loses the permission',async()=>{
    const result=await request('staff',path('invitations'),{email:'revocable.'+suffix+'@example.test',role:'staff'});revocableCode=result.data.token;
    await pool.query(`UPDATE staff_responsibility_assignments assignment SET status='revoked',revoked_at=now(),revocation_reason='Membership coordination transferred'
      FROM staff_responsibility_types type WHERE assignment.school_id=$1 AND assignment.staff_profile_id=$2
        AND type.id=assignment.responsibility_type_id AND type.code='membership_coordinator'`,[school,staffProfileId]);
    expect((await request('admin',path(`roles/${delegatedRole}`),{name:'Admissions Coordinator',description:'Student records only',duty_ids:[recordsDuty],template_key:'office',expected_revision:1},'PATCH')).status).toBe(200);
    expect((await request('staff',path('invitations/workspace'))).status).toBe(403);
    expect((await request('public','invitations/accept/',join(revocableCode,'revocable.'+suffix+'@example.test'))).status).toBe(403);
  });
  it('invalidates company access and pending admin codes immediately on operator revocation',async()=>{
    const email='operatorrevoked.'+suffix+'@example.test';const result=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email});
    await pool.query('UPDATE company_operators SET is_active=false WHERE user_id=$1',[companyId]);
    expect((await request('company','company/workspace/')).status).toBe(403);expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(403);
  });
});
