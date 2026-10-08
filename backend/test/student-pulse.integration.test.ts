import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {DatabaseService} from '../src/database/database.service.js';
import {StudentPulseService} from '../src/student-pulse/student-pulse.service.js';
import type {AuthUser} from '../src/common/request.js';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
const isolated=process.env.TEST_DATABASE_ISOLATED==='true';
const pool=new Pool({connectionString:isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused',max:1});
(isolated?describe:describe.skip)('Student Pulse scoped workflow',()=>{
 let db:DatabaseService,service:StudentPulseService,admin:AuthUser,staff:AuthUser,parent:AuthUser;
 let school:string,otherSchool:string,section:string,term:string,student:string,math:string;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const insert=async(query:string,args:unknown[]=[]) => (await pool.query(query,args)).rows[0];
 beforeAll(async()=>{
  db=new DatabaseService();service=new StudentPulseService(db);const key=randomUUID();
  school=(await insert("INSERT INTO schools(name,code) VALUES('Pulse test school',$1) RETURNING id",[key.slice(0,20)])).id;
  otherSchool=(await insert("INSERT INTO schools(name,code) VALUES('Other pulse school',$1) RETURNING id",['o'+key.slice(0,20)])).id;
  for(const role of ['admin','staff','parent']) {const user={...(await insert("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Pulse',$3,$3) RETURNING *",[role+key,role+key+'@example.test',role])),active_school_id:school};await pool.query('INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,$3)',[user.id,school,role==='parent'?'guardian':role]);if(role==='admin')admin=user;else if(role==='staff')staff=user;else parent=user;}
  term=(await insert("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'2026-27','Pulse term',current_date-30,current_date+30) RETURNING id",[school])).id;
  section=(await insert("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','10','A') RETURNING id",[school])).id;
  const person=(await insert("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Sample','Learner') RETURNING id",[school])).id;
  student=(await insert("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'PULSE-TEST') RETURNING id",[school,person])).id;
  await pool.query('INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,current_date-30)',[student,section,term]);
  for(const [code,name,held,attended] of [['MAT','Mathematics',9,3],['ENG','English',12,12]]){const id=(await insert('INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,$2,$3,$2) RETURNING id',[school,code,name])).id;if(code==='MAT')math=id;await pool.query('INSERT INTO subject_attendance(student_id,subject_id,term_id,classes_held,classes_attended) VALUES($1,$2,$3,$4,$5)',[student,id,term,held,attended]);}
 });
 afterAll(async()=>{await db?.destroy();await pool.end();});
 const command=()=>({owner_user_id:admin.id,expected_revision:0,state:'check_in',action:'private_check_in',due_on:today,outcome:null,records_reviewed:true});
 it('returns named evidence without invented period data',async()=>{const result=await service.list(admin,school);expect(result.signals).toHaveLength(1);expect(result.signals[0]).toMatchObject({student_id:student,subject_id:math,missed:6,eligible:9,flagged:true,followup:null});expect(result.source).toBe('recorded_term_totals');expect(result.unavailable).toContain('dated_period_evidence');});
 it('denies non-permitted staff, family and other tenant access',async()=>{await expect(service.list(staff,school)).rejects.toThrow();await expect(service.list(parent,school)).rejects.toThrow();await expect(service.list(admin,otherSchool)).rejects.toThrow();await expect(service.detail(admin,school,randomUUID(),term,math)).rejects.toThrow();});
 it('requires review confirmation and an eligible owner',async()=>{await expect(service.save(admin,school,student,term,math,{...command(),records_reviewed:false})).rejects.toThrow();await expect(service.save(admin,school,student,term,math,{...command(),owner_user_id:staff.id})).rejects.toThrow();});
 it('creates persistent baseline and append-only audit metadata without family notifications',async()=>{const before=(await insert('SELECT count(*)::int AS count FROM notifications')).count;const result=await service.save(admin,school,student,term,math,command());expect(result.followup).toMatchObject({revision:1,state:'check_in',baseline_attended:3,baseline_held:9});expect(result.history).toHaveLength(1);expect((await insert('SELECT count(*)::int AS count FROM notifications')).count).toBe(before);});
 it('rejects stale saves and preserves prior baseline when updating',async()=>{await expect(service.save(admin,school,student,term,math,command())).rejects.toThrow(/changed/);const result=await service.save(admin,school,student,term,math,{...command(),expected_revision:1,state:'monitoring'});expect(result.followup).toMatchObject({revision:2,state:'monitoring',baseline_held:9});expect(result.history).toHaveLength(2);});
 it('protects audit history and case identity at the database boundary',async()=>{const result=await service.detail(admin,school,student,term,math);await expect(pool.query('UPDATE student_pulse_history SET state=$1 WHERE followup_id=$2',['resolved',result.followup!.id])).rejects.toThrow(/append-only/);await expect(pool.query('UPDATE student_pulse_followups SET baseline_held=99 WHERE id=$1',[result.followup!.id])).rejects.toThrow(/immutable/);});
 it('requires a human outcome and retains a closed review',async()=>{await expect(service.save(admin,school,student,term,math,{...command(),expected_revision:2,state:'resolved'})).rejects.toThrow();const result=await service.save(admin,school,student,term,math,{...command(),expected_revision:2,state:'resolved',outcome:'support_agreed'});expect(result.followup).toMatchObject({revision:3,state:'resolved',outcome:'support_agreed'});expect((await service.list(admin,school)).signals[0]?.followup?.state).toBe('resolved');});
 it('keeps follow-ups visible after the recorded gap improves',async()=>{await pool.query('UPDATE subject_attendance SET classes_held=100,classes_attended=94 WHERE student_id=$1 AND subject_id=$2',[student,math]);const result=await service.list(admin,school);expect(result.signals).toHaveLength(1);expect(result.signals[0]).toMatchObject({flagged:false,followup:{state:'resolved',baseline_held:9}});});
});
