import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { TestApiSession, startManagedTestApi, type ManagedTestApi } from './http-api.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { DatabaseService } from '../src/database/database.service.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';
const isolated=process.env.TEST_DATABASE_ISOLATED==='true';
const suite=isolated?describe:describe.skip;
suite('company provisioning and delegated onboarding against PostgreSQL',()=>{
  const databaseUrl=isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused_test';
  const pool=new Pool({connectionString:databaseUrl,max:2});
  const base='http://127.0.0.1:8061/api/v1/';const suffix=randomUUID();const password='Str0ng!RiverPebbles2026';
  const sessions:Record<string,TestApiSession>=Object.fromEntries(['company','admin','staff','public','firstAdmin','invitedStaff'].map(actor=>[actor,new TestApiSession(base)]));
  let server:ManagedTestApi|undefined,companyId:string,adminId:string,staffId:string,staffProfileId:string,school:string,createdSchool:string,firstCode:string,delegatedRole:string,student:string,guardian:string,revocableCode:string,recordsDuty:string;
  const firstEmail=`first.${suffix}@example.test`;
  async function request(actor:string,path:string,body?:unknown,method=body===undefined?'GET':'POST',csrf=true){
    return sessions[actor]!.request(path,body,method,csrf);
  }
  const path=(tail:string)=>`schools/${school}/${tail}/`;
  const join=(token:string,email:string)=>({token,email,password,first_name:'Onboard',last_name:'Tester'});
  // Synthetic passive employment only. The real invitation acceptance must
  // establish its account and Core endpoint; fixtures never invent acceptance.
  async function passiveStaffTarget(label:string) {
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,$2,'Tester') RETURNING id",[school,label])).rows[0].id;
    await pool.query(`INSERT INTO staff_profiles(school_id,person_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by)
      VALUES($1,$2,$3,'non_teaching','Office support','full_time',current_date,'onboarding',$4,$4)`,[school,person,`P-${randomUUID().slice(0,12)}`,adminId]);
    return person as string;
  }
  beforeAll(async()=>{
    school=(await pool.query("INSERT INTO schools(name,code) VALUES('Onboarding Test',$1) RETURNING id",['onboard-'+suffix.slice(0,12)])).rows[0].id;
    for(const actor of ['company','admin','staff']){
      const user=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,'Tester',$5) RETURNING id",[actor+'.'+suffix,actor+'.'+suffix+'@example.test',await hashPassword(password),actor,actor==='staff'?'staff':'admin'])).rows[0].id;
      if(actor==='company'){companyId=user;await pool.query('INSERT INTO company_operators(user_id) VALUES($1)',[user]);}
      else{if(actor==='admin')adminId=user;else staffId=user;await pool.query('INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)',[school,user,actor]);}
    }
    staffProfileId=(await pool.query(`WITH person AS (INSERT INTO school_people(school_id,first_name,last_name,contact_email)
      SELECT $1,first_name,last_name,email FROM users WHERE id=$2 RETURNING id)
      INSERT INTO staff_profiles(school_id,user_id,person_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by)
      SELECT $1,$2,person.id,'OPS-001','non_teaching','Admissions coordinator','full_time',current_date,'active',$3,$3
      FROM person RETURNING id`,[school,staffId,adminId])).rows[0].id;
    // The delegated inviter needs its explicit current campus identity, not
    // merely the coarse staff membership/profile used by older fixtures.
    const identityDb=new DatabaseService();
    try { await linkFixtureStaffIdentity(identityDb,{school_id:school,user_id:staffId,owner_user_id:adminId}); }
    finally { await identityDb.destroy(); }
    server=await startManagedTestApi({port:8061,databaseUrl,cookieSecret:'onboarding-test-cookie-secret-at-least-32',rateLimitStore:'postgres'});
    for(const actor of Object.keys(sessions)){await request(actor,'auth/csrf/');if(['company','admin','staff'].includes(actor))expect((await request(actor,'auth/login/',{identifier:actor+'.'+suffix,password})).status).toBe(200);}
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Native','Student') RETURNING id",[school])).rows[0].id;
    student=(await pool.query("INSERT INTO students(school_id,person_id,admission_number,date_of_birth) VALUES($1,$2,$3,'2014-01-01') RETURNING id",[school,person,'NEW-'+suffix.slice(0,8)])).rows[0].id;
    const guardianPerson=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Native','Guardian') RETURNING id",[school])).rows[0].id;
    guardian=(await pool.query("INSERT INTO parents DEFAULT VALUES RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)',[school,guardian,guardianPerson]);
    await pool.query("INSERT INTO guardian_relationships(student_id,guardian_id,relationship,is_primary) VALUES($1,$2,'guardian',true)",[student,guardian]);
  },30000);
  // Keep rate limiting enabled; each isolated scenario gets a fresh test-only acceptance bucket.
  beforeEach(async()=>{await pool.query('DELETE FROM api_rate_limit_buckets WHERE bucket_key=$1',[createHash('sha256').update('127.0.0.1:POST:/api/v1/invitations/accept/').digest('hex')]);});
  afterAll(async()=>{try{await server?.stop();}finally{await pool.end();}});
  it('separates company operators from school admins and school data',async()=>{
    expect((await request('company','company/workspace/')).status).toBe(200);
    expect((await request('admin','company/workspace/')).status).toBe(403);
    expect((await request('staff','company/workspace/')).status).toBe(403);
    expect((await request('admin','schools/',{name:'Forbidden',code:'forbidden-'+suffix.slice(0,6)})).status).toBe(403);
    expect((await request('company',path('administration'))).status).toBe(403);
    expect((await request('company','auth/me/')).data.company_operator).toBe(true);
    expect((await request('admin','auth/me/')).data.company_operator).toBe(false);
  });

  it('protects marketing enquiries with company authority and CSRF and audits review',async()=>{
    const enquiry=(await pool.query(`INSERT INTO marketing_enquiries(full_name,institution_name,institution_type,email,phone,location,student_count,consent_version,fingerprint)
      VALUES('Marketing QA','Enquiry Test','school',$1,'9000000000','Bengaluru',250,'2026-10-14',$2) RETURNING id`,
      ['marketing.'+suffix+'@example.test','marketing-'+suffix])).rows[0].id;
    try{
      expect((await request('public','company/enquiries')).status).toBe(401);
      expect((await request('admin','company/enquiries')).status).toBe(403);
      expect((await request('staff','company/enquiries')).status).toBe(403);
      const list=await request('company','company/enquiries');
      expect(list.status).toBe(200);
      expect(list.data.enquiries.some((item:{id:string})=>item.id===enquiry)).toBe(true);
      expect((await request('company',`company/enquiries/${enquiry}/status`,{status:'contacted'},'POST',false)).status).toBe(403);
      expect((await request('admin',`company/enquiries/${enquiry}/status`,{status:'contacted'})).status).toBe(403);
      expect((await request('company',`company/enquiries/${enquiry}/status`,{status:'invalid'})).status).toBe(400);
      expect((await request('company',`company/enquiries/${enquiry}/status`,{status:'contacted'})).status).toBe(201);
      expect((await pool.query('SELECT status,reviewed_by FROM marketing_enquiries WHERE id=$1',[enquiry])).rows[0]).toEqual({status:'contacted',reviewed_by:companyId});
      expect((await pool.query("SELECT 1 FROM company_audit WHERE actor_id=$1 AND action='marketing.enquiry_reviewed' AND metadata->>'enquiry_id'=$2",[companyId,enquiry])).rowCount).toBe(1);
    }finally{await pool.query('DELETE FROM marketing_enquiries WHERE id=$1',[enquiry]);}
  });

  it('creates a college and first admin invitation atomically without membership for company',async()=>{
    const payload={name:`Lotus Test College ${suffix.slice(0,8)}`,code:'college-'+suffix.slice(0,10),institution_kind:'college',admin_email:firstEmail};
    expect((await request('company','company/institutions/',payload,'POST',false)).status).toBe(403);
    let result=await request('company','company/institutions/',payload);
    if(result.status===409 && result.data.error.code==='probable_duplicate') {
      const duplicates=result.data.error.fields.duplicates as {eduera_institution_id:string}[];
      expect(duplicates.length).toBeGreaterThan(0);
      result=await request('company','company/institutions/',{...payload,acknowledged_duplicate_ids:duplicates.map(item=>item.eduera_institution_id)});
    }
    expect(result.status).toBe(201);createdSchool=result.data.school.id;firstCode=result.data.invitation.token;
    expect(result.data.school.institution_kind).toBe('college');expect(firstCode).toMatch(/^\d{6}$/);
    expect((await pool.query('SELECT institution_kind,capability_packs FROM institution_regulatory_profiles WHERE school_id=$1',[createdSchool])).rows[0]).toEqual({institution_kind:'college',capability_packs:['india_college_core']});
    expect((await pool.query('SELECT 1 FROM school_memberships WHERE school_id=$1',[createdSchool])).rowCount).toBe(0);
    expect((await pool.query('SELECT token_hash FROM school_invitations WHERE school_id=$1',[createdSchool])).rows[0].token_hash).not.toBe(firstCode);
    expect((await request('company','company/institutions/',payload)).status).toBe(409);
    expect((await request('admin','company/institutions/',{...payload,code:'other-'+suffix.slice(0,8)})).status).toBe(403);
  });
  it('activates first admin once with a matching email without reinstating the retired universal setup gate',async()=>{
    expect((await request('public','invitations/accept/',join(firstCode,'wrong@example.test'))).status).toBe(400);
    expect((await request('public','invitations/accept/',{...join(firstCode,firstEmail),first_name:'   ',confirm_admin_person:true})).status).toBe(400);
    const unconfirmed=await request('public','invitations/accept/',join(firstCode,firstEmail));
    expect(unconfirmed.status).toBe(409);expect(unconfirmed.data.error.code).toBe('admin_person_confirmation_required');
    expect((await pool.query('SELECT 1 FROM users WHERE email=$1',[firstEmail])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM school_memberships WHERE school_id=$1',[createdSchool])).rowCount).toBe(0);
    const unrelated=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Onboard','Tester') RETURNING id",[createdSchool])).rows[0].id;
    expect((await request('public','invitations/accept/',{...join(firstCode,firstEmail),first_name:'Onboard Tester',last_name:'',confirm_admin_person:true})).status).toBe(200);
    expect((await request('public','invitations/accept/',join(firstCode,firstEmail))).status).toBe(400);
    expect((await request('firstAdmin','auth/login/',{identifier:firstEmail,password})).status).toBe(200);
    const profile=(await request('firstAdmin','auth/me/')).data;expect(profile.company_operator).toBe(false);expect(profile.institution_setup_required).toBe(false);expect(profile.onboarding.status).toBe('ready');expect(profile.memberships[0].school_id).toBe(createdSchool);expect(profile.memberships[0].role).toBe('admin');
    expect((await request('firstAdmin',`schools/${createdSchool}/administration/`)).status).toBe(200);
    expect((await request('firstAdmin',path('administration'))).status).toBe(403);
    const owner=(await pool.query(`SELECT person.id,account.id AS user_id,person.first_name,person.last_name,person.contact_email,endpoint.source_domain,endpoint.source_record_id
      FROM school_people person JOIN users account ON account.id=person.account_user_id
      JOIN campus_model_agents agent ON agent.school_id=person.school_id AND agent.person_id=person.id
      JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id AND endpoint.user_id=account.id
      WHERE person.school_id=$1 AND account.email=$2`,[createdSchool,firstEmail])).rows[0];
    expect(owner).toMatchObject({first_name:'Onboard Tester',last_name:'',contact_email:'',source_domain:'auth'});expect(owner.id).not.toBe(unrelated);
    expect((await pool.query('SELECT accepted_by_user_id FROM school_invitations WHERE id=$1',[owner.source_record_id])).rows[0].accepted_by_user_id).toBe(owner.user_id);
    expect((await pool.query('SELECT 1 FROM staff_profiles WHERE school_id=$1',[createdSchool])).rowCount).toBe(0);
    const firstOperation=await request('firstAdmin',`schools/${createdSchool}/people/participants`,{first_name:'First operational person',last_name:'',idempotency_key:randomUUID()});
    expect(firstOperation.status,JSON.stringify(firstOperation.data)).toBe(201);
    expect(firstOperation.data).toMatchObject({label:'First operational person',has_account:false});
    expect((await pool.query(`SELECT outcome.status FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id
      WHERE command.school_id=$1 AND actor.person_id=$2 AND command.command_type='people.person.save'`,[createdSchool,owner.id])).rows).toEqual([{status:'accepted'}]);
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
    const accepted=await request('public','invitations/accept/',join(result.data.token,email));
    expect(accepted.status,JSON.stringify(accepted.data)).toBe(200);
    const linked=(await pool.query('SELECT u.email,m.role FROM students s JOIN users u ON u.id=s.user_id JOIN school_memberships m ON m.user_id=u.id AND m.school_id=s.school_id WHERE s.id=$1',[student])).rows[0];expect(linked.email).toBe(email);expect(linked.role).toBe('student');
  });
  it('activates a guardian without creating a duplicate guardian record',async()=>{
    const email='guardian.'+suffix+'@example.test';const result=await request('staff',path('invitations'),{email,role:'guardian',guardian_id:guardian});expect(result.status).toBe(201);
    expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(200);
    expect((await pool.query('SELECT u.email FROM parents p JOIN users u ON u.id=p.user_id WHERE p.id=$1',[guardian])).rows[0].email).toBe(email);
  });
  it('resends school invitations with rotation, cooldown and tenant protection',async()=>{
    const email='resend.'+suffix+'@example.test';
    const personId=await passiveStaffTarget('Resend worker');
    const original=await request('admin',path('invitations'),{email,role:'staff',person_id:personId});
    expect(original.status).toBe(201);
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
    expect(stored.token_hash).toBe(createHmac('sha256','onboarding-test-cookie-secret-at-least-32').update(`invitation-v2:${email}:${replacement.data.token}`).digest('hex'));
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
    const email='staffinvite.'+suffix+'@example.test',personId=await passiveStaffTarget('Exact invited worker');
    const workspace=await request('admin',path('invitations/workspace'));
    expect(workspace.data.staff).toEqual(expect.arrayContaining([expect.objectContaining({id:personId})]));
    const result=await request('admin',path('invitations'),{email,role:'staff',person_id:personId});expect(result.status).toBe(201);
    expect((await pool.query('SELECT person_id FROM school_invitations WHERE id=$1',[result.data.id])).rows[0].person_id).toBe(personId);
    expect((await request('public','invitations/accept/',join(result.data.token,email))).status).toBe(200);
    expect((await request('invitedStaff','auth/login/',{identifier:email,password})).status).toBe(200);
    expect((await pool.query('SELECT person_id FROM staff_profiles WHERE school_id=$1 AND user_id=(SELECT id FROM users WHERE email=$2)',[school,email])).rows)
      .toEqual([{person_id:personId}]);
    const effective=await request('invitedStaff',path('roles/effective'));expect(effective.data.custom_role).toBeNull();expect(effective.data.permissions).toEqual([]);
  });
  it('refuses an unbound new staff invitation before creating an unusable code or account',async()=>{
    const email='missing-staff-target.'+suffix+'@example.test';
    const result=await request('admin',path('invitations'),{email,role:'staff'});
    expect(result.status).toBe(409);expect(result.data.token).toBeUndefined();
    expect((await pool.query('SELECT id FROM school_invitations WHERE school_id=$1 AND email=$2',[school,email])).rows).toEqual([]);
    expect((await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows).toEqual([]);
  });
  it('requires an existing account password rather than resetting it',async()=>{
    const existingEmail='admin.'+suffix+'@example.test';const result=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email:existingEmail});
    expect((await request('public','invitations/accept/',{...join(result.data.token,existingEmail),password:'Different!RiverPebbles2026'})).status).toBe(403);
    expect((await request('public','invitations/accept/',{...join(result.data.token,existingEmail),confirm_admin_person:true})).status).toBe(200);
    expect((await pool.query("SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=$2 AND role='admin'",[adminId,createdSchool])).rowCount).toBe(1);
  });
  it('reuses the exact active administrator person without copying submitted names or creating another person',async()=>{
    const before=(await pool.query('SELECT id,first_name,last_name FROM school_people WHERE school_id=$1 AND account_user_id=(SELECT id FROM users WHERE email=$2)',[createdSchool,firstEmail])).rows[0];
    const invitation=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email:firstEmail});
    expect(invitation.status).toBe(201);
    expect((await request('public','invitations/accept/',{...join(invitation.data.token,firstEmail),first_name:'Not a correction',last_name:'Do not copy'})).status).toBe(200);
    expect((await pool.query('SELECT id,first_name,last_name FROM school_people WHERE school_id=$1 AND account_user_id=(SELECT id FROM users WHERE email=$2)',[createdSchool,firstEmail])).rows).toEqual([before]);
  });
  it('rejects conflicting exact account bindings atomically instead of selecting a person or inventing a third',async()=>{
    const email='conflict.'+suffix+'@example.test';
    const account=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'Explicit','Account','member') RETURNING id",['conflict.'+suffix,email,await hashPassword(password)])).rows[0].id;
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Canonical','Person') RETURNING id",[createdSchool])).rows[0].id;
    await pool.query(`INSERT INTO school_invitations(school_id,email,role,person_id,token_hash,created_by,expires_at,accepted_at,accepted_by_user_id)
      VALUES($1,$2,'member',$3,$4,(SELECT id FROM users WHERE email=$5),now()+interval '30 minutes',now(),$6)`,
      [createdSchool,email,person,'accepted-conflict-'+suffix,firstEmail,account]);
    await pool.query('UPDATE school_people SET account_user_id=$1 WHERE id=$2',[account,person]);
    const second=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Different','Profile') RETURNING id",[createdSchool])).rows[0].id;
    await pool.query("INSERT INTO students(school_id,person_id,user_id,admission_number) VALUES($1,$2,$3,$4)",[createdSchool,second,account,'CONFLICT-'+suffix]);
    const invitation=await request('company',`company/institutions/${createdSchool}/admin-invitations/`,{email});
    const result=await request('public','invitations/accept/',{...join(invitation.data.token,email),confirm_admin_person:true});
    expect(result.status).toBe(409);expect(result.data.error.detail).toMatch(/conflicting campus person bindings/);
    expect((await pool.query('SELECT 1 FROM school_memberships WHERE school_id=$1 AND user_id=$2',[createdSchool,account])).rowCount).toBe(0);
    expect((await pool.query('SELECT accepted_at FROM school_invitations WHERE id=$1',[invitation.data.id])).rows[0].accepted_at).toBeNull();
    expect((await pool.query('SELECT id FROM school_people WHERE school_id=$1 AND account_user_id=$2',[createdSchool,account])).rows).toEqual([{id:person}]);
  });
  it('keeps forged company claims, wrong-source targets and missing consent behind the database binding guard',async()=>{
    for(const scenario of ['no_consent','wrong_source','null_person','no_admin','unverified'] as const){
      const tx=await pool.connect();
      try{
        await tx.query('BEGIN');
        const email=`guard.${scenario}.${suffix}@example.test`;
        const account=(await tx.query(`INSERT INTO users(username,email,password_hash,first_name,last_name,role,email_verified_at)
          VALUES($1,$2,'not-a-real-password','Guard','Fixture','member',$3) RETURNING id`,
          [`guard.${scenario}.${suffix}`,email,scenario==='unverified'?null:new Date()])).rows[0].id;
        const person=(await tx.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Guard','Person') RETURNING id",[createdSchool])).rows[0].id;
        if(scenario!=='no_admin')await tx.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'admin')",[createdSchool,account]);
        const claim=()=>tx.query(`INSERT INTO school_invitations(school_id,email,role,source,person_id,token_hash,created_by,
          expires_at,accepted_at,accepted_by_user_id,admin_person_confirmed_at)
          VALUES($1,$2,'admin',$3,$4,$5,$6,now()+interval '30 minutes',now(),$7,CASE WHEN $8 THEN now() ELSE NULL END)`,
          [createdSchool,email,scenario==='wrong_source'?'school':'company',scenario==='null_person'?null:person,
            `claim-${scenario}-${suffix}`,companyId,account,scenario!=='no_consent']);
        if(['no_consent','wrong_source','null_person'].includes(scenario))await expect(claim()).rejects.toMatchObject({code:'23514'});
        else{
          await claim();
          await expect(tx.query('UPDATE school_people SET account_user_id=$1 WHERE id=$2',[account,person])).rejects.toThrow('accepted exact-person invitation');
        }
      }finally{await tx.query('ROLLBACK');tx.release();}
    }
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
    const personId=await passiveStaffTarget('Delegated invited worker');
    const result=await request('staff',path('invitations'),{email:'revocable.'+suffix+'@example.test',role:'staff',person_id:personId});
    expect(result.status).toBe(201);revocableCode=result.data.token;
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
