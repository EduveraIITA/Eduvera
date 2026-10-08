import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { SchoolService } from '../src/school/school.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { SchedulePlanningService } from '../src/schedule-planning/schedule-planning.service.js';
import { AssessmentsService } from '../src/assessments/assessments.service.js';
import { effectiveSchedule } from '../src/day-plans/schedule.js';
import type { AuthenticatedRequest,AuthUser } from '../src/common/request.js';
import type { Period } from '../src/schedule-planning/contracts.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)});
let db:DatabaseService,service:SchedulePlanningService,req:AuthenticatedRequest,school:string,term:string,classId:string,otherClass:string,from:string,to:string,today:string;
const cmd=()=>({school_id:school,idempotency_key:randomUUID()});
const add=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const rows=(title='Changed'):Period[]=>[{id:randomUUID(),weekday:1,period_number:1,starts_at:'18:00',ends_at:'18:30',subject_id:null,teacher_user_id:null,title,slot_type:'activity',room:''}];
const begin=()=>service.start(req,{...cmd(),term_id:term,class_section_id:classId,starts_on:from,ends_on:to});
beforeAll(async()=>{
  db=new DatabaseService();const events=new SchoolEventService(db);service=new SchedulePlanningService(db,events,new SchoolService(db,events));
  const user=(await pool.query<AuthUser>("SELECT u.* FROM users u JOIN school_memberships m ON m.user_id=u.id WHERE m.role='admin' AND m.is_active LIMIT 1")).rows[0]!;
  school=(await pool.query("SELECT school_id FROM school_memberships WHERE user_id=$1 AND role='admin' AND is_active LIMIT 1",[user.id])).rows[0].school_id;
  req={authUser:{...user,active_school_id:school},requestId:randomUUID(),ip:'127.0.0.1'} as AuthenticatedRequest;
  today=(await pool.query("SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM schools WHERE id=$1",[school])).rows[0].d;
  const d=new Date(today+'T12:00:00Z');from=add(today,((8-d.getUTCDay())%7||7)+7);to=add(from,6);
  const academic='T'+randomUUID().slice(0,7);
  term=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,is_active) VALUES($1,$2,'Planning test',$3,$4,false) RETURNING id",[school,academic,add(today,-7),add(from,60)])).rows[0].id;
  for(const section of ['A','B']) {const id=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,$2,'SP',$3) RETURNING id",[school,academic,section])).rows[0].id;if(section==='A')classId=id;else otherClass=id;}
  await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,weekday,period_number,starts_at,ends_at,slot_type,title) VALUES($1,$2,1,1,'18:00','18:30','activity','Original')",[classId,term]);
});
afterAll(async()=>{await db?.destroy();await pool.end();});
describe('annual scheduling',()=>{
  it('keeps drafts invisible, rejects stale edits, and retries idempotently',async()=>{
    const input={...cmd(),term_id:term,class_section_id:classId,starts_on:from,ends_on:to};
    const v=await service.start(req,input);expect(await service.start(req,input)).toEqual(v);
    await expect(service.start(req,{...input,ends_on:add(to,1)})).rejects.toThrow('retry');
    await service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:from,ends_on:to,periods:rows()});
    await expect(service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:from,ends_on:to,periods:rows()})).rejects.toThrow('Reload');
    expect((await effectiveSchedule(db,school,from)).find(r=>r.class_section_id===classId)?.title).toBe('Original');
    await service.discard(req,v.id,{...cmd(),expected_revision:2});
  });
  it('publishes a bounded timetable and restores the previous pattern afterwards',async()=>{
    const v=await begin();await service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:from,ends_on:to,periods:rows()});
    const input={...cmd(),expected_revision:2};await service.publish(req,v.id,input);await service.publish(req,v.id,input);
    const title=async(date:string)=>(await effectiveSchedule(db,school,date)).find(r=>r.class_section_id===classId)?.title;
    expect(await title(add(from,-7))).toBe('Original');expect(await title(from)).toBe('Changed');expect(await title(add(from,7))).toBe('Original');
    await expect(service.save(req,v.id,{...cmd(),expected_revision:3,starts_on:from,ends_on:to,periods:rows()})).rejects.toThrow('read-only');
    expect(Number((await pool.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='schedule.published'",[v.id])).rows[0].count)).toBe(1);
  });
  it('honours closures over the new published timetable',async()=>{
    await pool.query("INSERT INTO school_calendar_days(school_id,date,is_instructional,label) VALUES($1,$2,false,'Test closure')",[school,from]);
    expect((await effectiveSchedule(db,school,from)).filter(r=>r.class_section_id===classId)).toHaveLength(0);
    await pool.query('DELETE FROM school_calendar_days WHERE school_id=$1 AND date=$2',[school,from]);
  });
  it('preserves an already published daily plan over a repeating version',async()=>{
    const plan=(await pool.query('INSERT INTO day_plans(school_id,class_section_id,term_id,date,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[school,classId,term,from,req.authUser.id])).rows[0].id;
    await pool.query("INSERT INTO day_plan_versions(school_id,plan_id,version,state,created_by) VALUES($1,$2,1,'published',$3)",[school,plan,req.authUser.id]);
    await pool.query("INSERT INTO day_plan_periods(school_id,plan_id,version,period_number,starts_at,ends_at,title,slot_type) VALUES($1,$2,1,1,'18:00','18:30','Dated change','activity')",[school,plan]);
    await pool.query('UPDATE day_plans SET published_version=1 WHERE id=$1',[plan]);
    expect((await effectiveSchedule(db,school,from)).find(r=>r.class_section_id===classId)?.title).toBe('Dated change');
  });
  it('rejects backdating, invalid scope and non-admin access',async()=>{
    await expect(service.start(req,{...cmd(),term_id:term,class_section_id:classId,starts_on:today,ends_on:to})).rejects.toThrow('after today');
    await expect(service.start(req,{...cmd(),term_id:term,class_section_id:randomUUID(),starts_on:from,ends_on:to})).rejects.toThrow('within this term');
    await expect(service.start({...req,authUser:{...req.authUser,id:randomUUID()}},{...cmd(),term_id:term,class_section_id:classId,starts_on:from,ends_on:to})).rejects.toThrow('administrator');
  });
  it('rolls back a conflicting publication and retains the draft',async()=>{
    const date=add(from,14);
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,weekday,period_number,starts_at,ends_at,slot_type,title,room) VALUES($1,$2,1,1,'18:00','18:30','activity','Other','Planning test room')",[otherClass,term]);
    const v=await service.start(req,{...cmd(),term_id:term,class_section_id:classId,starts_on:date,ends_on:add(date,6)});
    await service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:date,ends_on:add(date,6),periods:rows().map(r=>({...r,room:'Planning test room'}))});
    await expect(service.publish(req,v.id,{...cmd(),expected_revision:2})).rejects.toThrow('room clash');
    expect((await pool.query('SELECT state FROM schedule_versions WHERE id=$1',[v.id])).rows[0].state).toBe('draft');
    await service.discard(req,v.id,{...cmd(),expected_revision:2});
  });
  it('rejects overlapping periods even when no other class is involved',async()=>{
    const v=await begin();const first=rows()[0]!;
    await service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:from,ends_on:to,periods:[first,{...first,id:randomUUID(),period_number:2}]});
    await expect(service.publish(req,v.id,{...cmd(),expected_revision:2})).rejects.toThrow('overlap');
    await service.discard(req,v.id,{...cmd(),expected_revision:2});
  });
  it('ties teaching access to validity dates and protects published data',async()=>{
    const username=`schedule-${randomUUID()}`;
    const teacher=(await pool.query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Schedule','Teacher','staff') RETURNING id",[username,`${username}@example.test`])).rows[0].id;
    await pool.query("INSERT INTO school_memberships(school_id,user_id,role,is_active) VALUES($1,$2,'staff',true)",[school,teacher]);
    const date=add(from,28);
    const v=await service.start(req,{...cmd(),term_id:term,class_section_id:classId,starts_on:date,ends_on:add(date,6)});
    const periods=rows().map(p=>({...p,teacher_user_id:teacher}));
    await service.save(req,v.id,{...cmd(),expected_revision:1,starts_on:date,ends_on:add(date,6),periods});
    await service.publish(req,v.id,{...cmd(),expected_revision:2});
    const assigned=async(d:string)=>(await pool.query('SELECT schedule_teacher_assigned($1,$2,$3,$4) AS allowed',[school,teacher,classId,d])).rows[0].allowed;
    expect(await assigned(date)).toBe(true);expect(await assigned(add(date,7))).toBe(false);
    await expect(pool.query("UPDATE schedule_periods SET title='Overwrite' WHERE version_id=$1",[v.id])).rejects.toThrow('Only draft');
    await expect(pool.query('DELETE FROM schedule_versions WHERE id=$1',[v.id])).rejects.toThrow();
    expect((await pool.query("SELECT * FROM notifications WHERE dedupe_key=$1",[`schedule:${v.id}:${teacher}`])).rowCount).toBe(1);
  });
  it('prepares future terms/classes and reviewable drafts without copying enrollments',async()=>{
    const sourceYear=(await pool.query('SELECT academic_year FROM academic_terms WHERE id=$1',[term])).rows[0].academic_year;
    const latest=(await pool.query('SELECT max(ends_on)::text AS d FROM academic_terms WHERE school_id=$1',[school])).rows[0].d;
    const academic='N'+randomUUID().slice(0,7);
    const result=await service.prepareYear(req,{...cmd(),academic_year:academic,source_year:sourceYear,terms:[{name:'Term 1',starts_on:add(latest,30),ends_on:add(latest,120)}]});
    expect((await pool.query('SELECT is_active FROM academic_terms WHERE id=$1',[result.term_id])).rows[0].is_active).toBe(false);
    expect((await pool.query('SELECT * FROM enrollments WHERE term_id=$1',[result.term_id])).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM schedule_versions WHERE term_id=$1 AND state=\'draft\'',[result.term_id])).rowCount).toBe(2);
    expect((await pool.query('SELECT * FROM schedule_versions WHERE term_id=$1 AND state=\'published\'',[result.term_id])).rowCount).toBe(0);
  });
  it('projects assessment dates without marks and enforces family scope',async()=>{
    const assessments=new AssessmentsService(db);
    const cycle=(await pool.query("INSERT INTO assessment_cycles(school_id,term_id,name,code,starts_on,ends_on,created_by,updated_by) VALUES($1,$2,'Calendar test',$3,$4,$5,$6,$6) RETURNING id",[school,term,randomUUID().slice(0,12),from,to,req.authUser.id])).rows[0].id;
    const subject=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,$2,'Calendar test subject','Calendar') RETURNING id",[school,'CAL-'+randomUUID().slice(0,8)])).rows[0].id;
    await pool.query("INSERT INTO assessments(school_id,cycle_id,class_section_id,subject_id,title,assessment_kind,maximum_marks,scheduled_at,status,created_by,updated_by) VALUES($1,$2,$3,$4,'Calendar test','exam',100,$5,'scheduled',$6,$6)",[school,cycle,classId,subject,from+'T12:00:00Z',req.authUser.id]);
    const seed={d:from};
    const result=await assessments.calendar(req.authUser,school,seed.d,seed.d);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).not.toHaveProperty('marks');expect(result.items[0]).not.toHaveProperty('maximum_marks');
    await expect(assessments.calendar(req.authUser,school,seed.d,seed.d,randomUUID())).rejects.toThrow('cannot view');
    await expect(assessments.calendar(req.authUser,randomUUID(),seed.d,seed.d)).rejects.toThrow();
  });
});
