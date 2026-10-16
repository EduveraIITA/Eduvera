import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { GateService } from '../src/gate/gate.service.js';
import type { SchoolEventService } from '../src/school/school-event.service.js';
import { verifyPassword } from '../src/auth/password.js';
import { effectiveSchoolAccess } from '../src/roles/authorization.js';
import type { AuthUser } from '../src/common/request.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const isolated=process.env.TEST_DATABASE_ISOLATED==='true';
const suite=isolated?describe:describe.skip;
suite('gate lifecycle, account provisioning and current authority',()=>{
 let db:DatabaseService,pool:Pool,service:GateService,admin:AuthUser,guard:AuthUser,outsider:AuthUser;
 let school:string,otherSchool:string,student:string,person:string,authority:string,plan:string;
 const events={enqueueUserEvent:vi.fn(()=>Promise.resolve())};
 async function query(text:string,values:unknown[]=[]){return (await pool.query(text,values)).rows[0];}
 beforeAll(async()=>{
  pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:1});
  db=new DatabaseService();service=new GateService(db,events as unknown as SchoolEventService,new CampusModelCoreService(db));
  const tag=randomUUID();school=(await query("INSERT INTO schools(name,code) VALUES('Gate test',$1) RETURNING id",[tag.slice(0,20)])).id;
  otherSchool=(await query("INSERT INTO schools(name,code) VALUES('Other gate',$1) RETURNING id",['o'+tag.slice(0,20)])).id;
  admin=await query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Gate','Admin','admin') RETURNING *",[tag,tag+'@example.test']);
  outsider=await query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Other','Staff','staff') RETURNING *",['o'+tag,'o'+tag+'@example.test']);
  await query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin'),($3,$4,'staff')",[admin.id,school,outsider.id,otherSchool]);
  person=(await query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Aarav','Test') RETURNING id",[school])).id;
  student=(await query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,$3) RETURNING id",[school,person,tag])).id;
  const collector=(await query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Verified','Collector') RETURNING id",[school])).id;
  const serviceDay=(await query("SELECT (now() AT TIME ZONE timezone)::date::text AS service_day FROM schools WHERE id=$1",[school])).service_day;
  authority=(await query("INSERT INTO departure_collection_authorities(school_id,student_id,collector_person_id,valid_from,verification_method,verification_note,granted_by) VALUES($1,$2,$3,$4,'in_person','Verified in person',$5) RETURNING id",[school,student,collector,serviceDay,admin.id])).id;
  plan=(await query("INSERT INTO departure_plans(school_id,student_id,service_date,mode,authority_id,state,source,created_by,revision) VALUES($1,$2,$3,'authorized_collector',$4,'ready','administrator',$5,1) RETURNING id",[school,student,serviceDay,authority,admin.id])).id;
 });
 afterAll(async()=>{await db?.destroy();await pool?.end();});
 it('creates a non-teaching gatekeeper with only the gate permission and a private password',async()=>{
  const account=await service.gatekeeper(admin,school,{name:'Ramesh Gatekeeper',username:'gate.'+randomUUID().slice(0,8)});
  guard=await query('SELECT * FROM users WHERE id=$1',[account.id]);
  expect(await verifyPassword(account.password,(guard as AuthUser & {password_hash:string}).password_hash)).toBe(true);
  expect((await effectiveSchoolAccess(db,guard.id,school)).sources.map(s=>s.permission)).toEqual(['gate.manage']);
  expect(await service.workspace(guard,school)).toHaveProperty('visitors');
 });
 it('denies outsiders and prevents guards from issuing pickup authority or adding accounts',async()=>{
  await expect(service.workspace(outsider,school)).rejects.toThrow(/permission/);
  await expect(service.gatekeeper(guard,school,{name:'Wrong access',username:'wrong.guard'})).rejects.toThrow(/administrator/);
  await expect(service.issuePass(guard,school,{student_id:student,kind:'student'})).rejects.toThrow(/Guardian/);
 });
 it('records entry once for the same command and never changes classroom attendance',async()=>{
  const command={student_id:student,direction:'in',command_id:randomUUID(),identity_verified:true};
  const first=await service.movement(guard,school,command);expect(await service.movement(guard,school,command)).toEqual(first);
  await expect(service.movement(guard,school,{...command,command_id:randomUUID()})).rejects.toThrow(/Movement changed/);
  expect((await query('SELECT count(*)::int count FROM gate_events WHERE student_id=$1',[student])).count).toBe(1);
  expect((await query('SELECT count(*)::int count FROM attendance_records WHERE student_id=$1',[student])).count).toBe(0);
  expect(await service.student(guard,school,student)).toMatchObject({id:student,direction:'in',plan_state:'ready'});
  await expect(service.student(outsider,school,student)).rejects.toThrow(/permission/);
  await expect(service.student(admin,otherSchool,student)).rejects.toThrow(/permission/);
 });
 it('searches a bounded school roster without loading movement or collector details',async()=>{
  const match=await service.students(guard,school,'  AARAV  ');
  expect(match).toHaveLength(1);expect(match[0]).toMatchObject({id:student,name:'Aarav Test',plan_state:'ready'});
  expect(match[0]).toHaveProperty('direction','in');expect(match[0]).not.toHaveProperty('collector_name');
  const admission=(await query('SELECT admission_number FROM students WHERE id=$1',[student])).admission_number;
  expect((await service.students(guard,school,admission))[0]?.id).toBe(student);
  expect(await service.students(guard,school,'A')).toEqual([]);
  expect(await service.students(guard,school,'%_')).toEqual([]);
  await expect(service.students(outsider,school,'Aarav')).rejects.toThrow(/permission/);
  const foreignPerson=(await query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Aarav','Foreign') RETURNING id",[otherSchool])).id;
  const foreignStudent=(await query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'FOREIGN') RETURNING id",[otherSchool,foreignPerson])).id;
  expect((await service.students(guard,school,'Aarav')).map(row=>row.id)).toEqual([student]);
  await expect(service.student(guard,school,foreignStudent)).rejects.toThrow(/not found/);
  await pool.query(`WITH people AS (INSERT INTO school_people(school_id,first_name,last_name)
   SELECT $1,'SearchBound',lpad(i::text,3,'0') FROM generate_series(1,40) i RETURNING id,last_name)
   INSERT INTO students(school_id,person_id,admission_number) SELECT $1,id,'SEARCH-'||last_name FROM people`,[school]);
  const bounded=await service.students(guard,school,'SearchBound');
  expect(bounded).toHaveLength(30);expect(bounded[0]?.name).toBe('SearchBound 001');expect(bounded[29]?.name).toBe('SearchBound 030');
 });
 it('blocks exit without a pickup pass and rejects QR from another institution',async()=>{
  await expect(service.movement(guard,school,{student_id:student,direction:'out',command_id:randomUUID(),identity_verified:true})).rejects.toThrow(/pickup QR/);
  const pass=await service.issuePass(admin,school,{student_id:student,kind:'pickup'});
  await expect(service.scan(outsider,otherSchool,{qr:pass.qr})).rejects.toThrow(/permission/);
  await expect(service.scan(admin,school,{qr:'123456'})).rejects.toThrow(/Invalid QR/);
 });
 it('checks revoked authority at confirmation even after a successful scan',async()=>{
  const pass=await service.issuePass(admin,school,{student_id:student,kind:'pickup'});
  expect(await service.scan(guard,school,{qr:pass.qr})).toHaveProperty('kind','pickup');
  await query("UPDATE departure_collection_authorities SET status='revoked',revoked_at=now(),revoked_by=granted_by,revocation_reason='Gate test revocation' WHERE id=$1",[authority]);
  await expect(service.movement(guard,school,{student_id:student,direction:'out',qr:pass.qr,command_id:randomUUID(),identity_verified:true})).rejects.toThrow(/revoked/);
  expect((await query('SELECT count(*)::int count FROM departure_handovers WHERE plan_id=$1',[plan])).count).toBe(0);
  await query("UPDATE departure_collection_authorities SET status='active',revoked_at=NULL,revoked_by=NULL,revocation_reason='' WHERE id=$1",[authority]);
 });
 it('consumes a pickup QR, records handover and movement atomically, and rejects replay',async()=>{
  const pass=await service.issuePass(admin,school,{student_id:student,kind:'pickup'});
  await service.movement(guard,school,{student_id:student,direction:'out',qr:pass.qr,command_id:randomUUID(),identity_verified:true});
  expect((await query('SELECT state FROM departure_plans WHERE id=$1',[plan])).state).toBe('completed');
  expect((await query('SELECT count(*)::int count FROM departure_handovers WHERE plan_id=$1',[plan])).count).toBe(1);
  await expect(service.scan(guard,school,{qr:pass.qr})).rejects.toThrow(/already been used/);
  expect(events.enqueueUserEvent).toHaveBeenCalled();
 });
 it('requires visitor approval and allows QR check-in and checkout only in order',async()=>{
  const visitor=await service.visitor(guard,school,{name:'Visitor Test',phone:'9876543210',purpose:'Meeting principal',host_user_id:admin.id});
  await expect(service.visitorAction(guard,school,visitor.id,'in')).rejects.toThrow(/not ready/);
  await expect(service.visitorAction(guard,school,visitor.id,'approve')).rejects.toThrow(/requested host/);
  await service.visitorAction(admin,school,visitor.id,'approve');
  const pass=await service.visitorPass(admin,school,visitor.id);
  expect(await service.scan(guard,school,{qr:pass.qr})).toHaveProperty('kind','visitor');
  await service.visitorAction(guard,school,visitor.id,'in');
  await expect(service.visitorAction(guard,school,visitor.id,'in')).rejects.toThrow(/not ready/);
  await service.visitorAction(guard,school,visitor.id,'out');
  await expect(service.scan(guard,school,{qr:pass.qr})).rejects.toThrow(/already used/);
 });
});
