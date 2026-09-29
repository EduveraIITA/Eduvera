import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {DatabaseService} from "../src/database/database.service.js";
import {SchoolEventService} from "../src/school/school-event.service.js";
import {PeopleImportService} from "../src/people/people-import.service.js";
import {SchoolService} from "../src/school/school.service.js";
import {IMPORT_COLUMNS,type ImportValues} from "../src/people/import-csv.js";
import type {ImportJob} from "../src/people/import-types.js";
import type {AuthUser,AuthenticatedRequest} from "../src/common/request.js";
import {requireIsolatedTestDatabaseUrl} from "./test-database.js";
const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:2});
let db:DatabaseService,imports:PeopleImportService,school:SchoolService,admin:AuthenticatedRequest,teacher:AuthenticatedRequest,parent:AuthenticatedRequest;
let schoolId:string,termId:string,sectionA:string,today:string,parentId:string;
let sequence=100;
const jobs:string[]=[];
function req(user:AuthUser){return {authUser:user,requestId:randomUUID(),protocol:'http',headers:{host:'localhost'},ip:'127.0.0.1'} as AuthenticatedRequest;}
const csv=(rows:ImportValues[])=>[IMPORT_COLUMNS.join(','),...rows.map(r=>IMPORT_COLUMNS.map(c=>`"${r[c].replace(/"/g,'""')}"`).join(','))].join('\r\n');
function row(overrides:Partial<ImportValues>={}):ImportValues{sequence++;return {admission_number:`BULK-${sequence}`,first_name:'Ishaan',last_name:`Deshmukh${sequence}`,date_of_birth:'2014-04-12',class:'7A',roll_number:String(sequence),enrolled_on:today,guardian_key:`family-${sequence}`,guardian_first_name:'Nandita',guardian_last_name:`Deshmukh${sequence}`,guardian_phone:`90000${String(sequence).padStart(5,'0')}`,guardian_email:'',relationship:'mother',...overrides};}
async function upload(rows:ImportValues[],key=randomUUID()){const result=await imports.stage(admin,{school_id:schoolId,term_id:termId,filename:'test-enrollment.csv',csv:csv(rows),idempotency_key:key});if(!jobs.includes(result.id))jobs.push(result.id);return result.id;}
async function detail(id:string){return imports.detail(admin.authUser,id,schoolId);}
async function commit(id:string){const current=await detail(id);return imports.commit(admin,id,{school_id:schoolId,expected_revision:current.revision,validation_token:current.review!.validation_token,verified:true});}
async function count(){return (await pool.query('SELECT count(*)::int AS n FROM students WHERE school_id=$1',[schoolId])).rows[0].n as number;}
beforeAll(async()=>{
  db=new DatabaseService();const events=new SchoolEventService(db);imports=new PeopleImportService(db,events);school=new SchoolService(db,events);
  const users=(await pool.query<AuthUser>("SELECT * FROM users WHERE username IN ('kavita.staff','pooja.parent') OR id=(SELECT user_id FROM school_memberships WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1)")).rows;
  admin=req(users.find(u=>u.role==='admin')!);teacher=req(users.find(u=>u.username==='kavita.staff')!);parent=req(users.find(u=>u.username==='pooja.parent')!);
  schoolId=(await pool.query("INSERT INTO schools(name,code,timezone) VALUES('Isolated import test school',$1,'Asia/Kolkata') RETURNING id",[`import-${randomUUID().slice(0,10)}`])).rows[0].id;
  today=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today")).rows[0].today;
  termId=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active) VALUES($1,'2026-27','Import term',($2::date-90),($2::date+90),85,true) RETURNING id",[schoolId,today])).rows[0].id;
  const classes=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A'),($1,'2026-27','7','B') RETURNING id,section",[schoolId])).rows;
  sectionA=classes.find(c=>c.section==='A').id;
  await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$4,'admin'),($2,$4,'staff'),($3,$4,'guardian')",[admin.authUser.id,teacher.authUser.id,parent.authUser.id,schoolId]);
  parentId=(await pool.query('SELECT id FROM parents WHERE user_id=$1',[parent.authUser.id])).rows[0].id;
  const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name,contact_phone) VALUES($1,'Pooja','Sharma','9000011111') RETURNING id",[schoolId])).rows[0].id;
  await pool.query('INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)',[schoolId,parentId,person]);
  const subject=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'MATH','Mathematics','Math') RETURNING id",[schoolId])).rows[0].id;
  await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,teacher_user_id) VALUES($1,$2,$3,1,1,'09:00','09:45',$4)",[sectionA,termId,subject,teacher.authUser.id]);
});
afterAll(async()=>{
  if(schoolId){
    const guardianIds=(await pool.query('SELECT p.id FROM parents p JOIN guardian_school_profiles gp ON gp.guardian_id=p.id WHERE gp.school_id=$1 AND p.user_id IS NULL',[schoolId])).rows.map(r=>r.id);
    await pool.query('DELETE FROM people_imports WHERE school_id=$1',[schoolId]);
    await pool.query('DELETE FROM event_outbox WHERE school_id=$1',[schoolId]);await pool.query('DELETE FROM audit_events WHERE school_id=$1',[schoolId]);
    await pool.query('DELETE FROM students WHERE school_id=$1',[schoolId]);
    await pool.query('DELETE FROM guardian_school_profiles WHERE school_id=$1',[schoolId]);
    await pool.query('DELETE FROM parents WHERE id=ANY($1::uuid[])',[guardianIds]);
    await pool.query('DELETE FROM attendance_registers WHERE school_id=$1',[schoolId]);await pool.query('DELETE FROM class_sections WHERE school_id=$1',[schoolId]);
    await pool.query('DELETE FROM academic_terms WHERE school_id=$1',[schoolId]);await pool.query('DELETE FROM school_people WHERE school_id=$1',[schoolId]);await pool.query('DELETE FROM schools WHERE id=$1',[schoolId]);
  }
  await db?.destroy();await pool.end();
});
describe('Reviewed bulk student enrollment',()=>{
  it('stages rows without creating operational identities and supports resumable history',async()=>{
    const before=await count(),id=await upload([row()]);const review=await detail(id);expect(await count()).toBe(before);expect(review.review!.summary).toMatchObject({included:1,errors:0});expect((await imports.list(admin.authUser,{school_id:schoolId})).results.map(r=>r.id)).toContain(id);
    const event=(await pool.query('SELECT payload,audience_user_ids FROM event_outbox WHERE aggregate_id=$1',[id])).rows[0];expect(event.audience_user_ids).toEqual([admin.authUser.id]);expect(event.payload).not.toHaveProperty('first_name');expect(event.payload.refresh).toEqual(['people']);
  });
  it('deduplicates upload retries and rejects a changed file under the same key',async()=>{
    const values=[row()],key=randomUUID();const [a,b]=await Promise.all([upload(values,key),upload(values,key)]);expect(a).toBe(b);await expect(upload([row()],key)).rejects.toThrow('different file');
  });
  it('saves a 200-student batch with complete shared-family graphs, no accounts and no marks',async()=>{
    const before=await count(),users=(await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const values=Array.from({length:200},(_,i)=>row({first_name:['Aarav','Ananya','Kavya','Rohan'][i%4]!,guardian_key:`cohort-family-${Math.floor(i/2)}`,guardian_first_name:`Guardian${Math.floor(i/2)}`,guardian_last_name:'Patil',guardian_phone:`91${String(9800000000+Math.floor(i/2))}`,class:i<100?'7A':'7B'}));
    const id=await upload(values);const result=await commit(id);expect(result).toMatchObject({students:200,guardians_created:100,guardians_reused:0,skipped:0});expect(await count()).toBe(before+200);
    const ids=result!.enrolled.map(r=>r.student_id);
    expect((await pool.query('SELECT s.id FROM students s LEFT JOIN guardian_relationships g ON g.student_id=s.id LEFT JOIN enrollments e ON e.student_id=s.id WHERE s.id=ANY($1::uuid[]) AND (g.id IS NULL OR e.id IS NULL)',[ids])).rows).toHaveLength(0);
    expect((await pool.query('SELECT id FROM attendance_records WHERE student_id=ANY($1::uuid[])',[ids])).rows).toHaveLength(0);
    expect((await pool.query('SELECT id FROM students WHERE id=ANY($1::uuid[]) AND user_id IS NOT NULL',[ids])).rows).toHaveLength(0);
    expect((await pool.query('SELECT id FROM guardian_relationships WHERE student_id=ANY($1::uuid[]) AND can_authorize_leave',[ids])).rows).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(users);
    expect((await pool.query("SELECT id FROM event_outbox WHERE school_id=$1 AND idempotency_key LIKE $2",[schoolId,`people-import:${id}:%`])).rows).toHaveLength(2);
    expect((await detail(id)).receipt!.enrolled).toHaveLength(200);
    expect((await pool.query("SELECT row_number FROM people_import_rows WHERE import_id=$1 AND raw_values<>'{}'::jsonb",[id])).rows).toHaveLength(0);
  });
  it('reports duplicates in the file and existing school without overwriting students',async()=>{
    const saved=row();await commit(await upload([saved]));const repeated=row();const id=await upload([saved,repeated,{...repeated,first_name:'Other'}]);const review=await detail(id);expect(review.review!.summary.errors).toBe(3);const before=await count();await expect(commit(id)).rejects.toThrow('invalid row');expect(await count()).toBe(before);
  });
  it('edits bad rows, skips duplicates and revalidates before the entire selected batch saves',async()=>{
    const values=[row({date_of_birth:'bad-date'}),row({class:'Unknown'}),row()];const id=await upload(values);let current=await detail(id);expect(current.review!.summary.errors).toBe(2);
    await imports.updateRow(admin,id,2,{school_id:schoolId,expected_revision:current.revision,values:{...values[0],date_of_birth:'2014-04-12'},decision:'include',guardian_choice:{mode:'new'}});
    current=await detail(id);await imports.updateRow(admin,id,3,{school_id:schoolId,expected_revision:current.revision,values:values[1],decision:'skip',guardian_choice:{mode:'new'}});
    expect(await commit(id)).toMatchObject({students:2,skipped:1});
  });
  it('links only an explicitly selected guardian and makes the child available to that parent',async()=>{
    const values=row({guardian_first_name:'',guardian_phone:''});const id=await upload([values]);const current=await detail(id);
    await imports.updateRow(admin,id,2,{school_id:schoolId,expected_revision:current.revision,values,decision:'include',guardian_choice:{mode:'existing',id:parentId}});
    const result=await commit(id);expect(result).toMatchObject({guardians_created:0,guardians_reused:1});const student=await school.studentForUser(parent.authUser,result!.enrolled[0]!.student_id);expect(student.user_id).toBeNull();
  });
  it('never merges a matching phone and flags inconsistent family references',async()=>{
    const id=await upload([row({guardian_phone:'9000011111'}),row({guardian_key:'same-family',guardian_first_name:'First'}),row({guardian_key:'same-family',guardian_first_name:'Different'})]);const current=await detail(id);
    expect(current.review!.rows[0]!.warnings.join(' ')).toContain('matches a school record');expect(current.review!.rows[1]!.errors.join(' ')).toContain('same guardian');expect(current.review!.rows[2]!.errors.join(' ')).toContain('same guardian');
  });
  it('rejects stale row edits, stale review tokens and unverified commits',async()=>{
    const values=row(),id=await upload([values]),old=await detail(id);
    await imports.updateRow(admin,id,2,{school_id:schoolId,expected_revision:old.revision,values:{...values,first_name:'Updated'},decision:'include',guardian_choice:{mode:'new'}});
    await expect(imports.updateRow(admin,id,2,{school_id:schoolId,expected_revision:old.revision,values,decision:'skip',guardian_choice:{mode:'new'}})).rejects.toThrow('changed');
    await expect(imports.commit(admin,id,{school_id:schoolId,expected_revision:old.revision,validation_token:old.review!.validation_token,verified:true})).rejects.toThrow('changed');
    await expect(imports.commit(admin,id,{school_id:schoolId,expected_revision:2,validation_token:old.review!.validation_token,verified:false})).rejects.toThrow();
  });
  it('rechecks changed school data and commits no partial batch after a competing enrollment',async()=>{
    const values=[row(),row()],id=await upload(values),old=await detail(id);await commit(await upload([values[1]!]));const before=await count();
    await expect(imports.commit(admin,id,{school_id:schoolId,expected_revision:old.revision,validation_token:old.review!.validation_token,verified:true})).rejects.toThrow();expect(await count()).toBe(before);
    expect((await pool.query('SELECT id FROM students WHERE school_id=$1 AND admission_number=$2',[schoolId,values[0]!.admission_number])).rows).toHaveLength(0);
  });
  it('replays concurrent final submissions once and coalesces delivery by class',async()=>{
    const id=await upload([row(),row()]),current=await detail(id),command={school_id:schoolId,expected_revision:current.revision,validation_token:current.review!.validation_token,verified:true};
    const [a,b]=await Promise.all([imports.commit(admin,id,command),imports.commit(admin,id,command)]);expect(a).toEqual(b);
    expect((await pool.query("SELECT id FROM audit_events WHERE target_id=$1 AND action='people.import.committed'",[id])).rows).toHaveLength(1);
  });
  it('enforces administrator and tenant boundaries on every stage',async()=>{
    const id=await upload([row()]);await expect(imports.detail(teacher.authUser,id,schoolId)).rejects.toThrow('administrator');await expect(imports.detail(admin.authUser,id,randomUUID())).rejects.toThrow('administrator');
    const current=await detail(id);await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);
    try{await expect(imports.commit(admin,id,{school_id:schoolId,expected_revision:1,validation_token:current.review!.validation_token,verified:true})).rejects.toThrow('administrator');}finally{await pool.query("UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);}
  });
  it('warns about submitted registers, reopens once, and preserves historical roster boundaries',async()=>{
    const register=(await pool.query("INSERT INTO attendance_registers(school_id,class_section_id,term_id,date,state,revision,submitted_by,submitted_at) VALUES($1,$2,$3,$4,'submitted',1,$5,now()) RETURNING id",[schoolId,sectionA,termId,today,teacher.authUser.id])).rows[0].id;
    const id=await upload([row(),row()]);expect((await detail(id)).review!.summary.registers_reopened).toBe(1);const result=await commit(id);expect(result!.registers_reopened).toBe(1);
    expect((await pool.query('SELECT state,revision FROM attendance_registers WHERE id=$1',[register])).rows[0]).toEqual({state:'draft',revision:2});
    const yesterday=(await pool.query('SELECT ($1::date-1)::text AS day',[today])).rows[0].day;
    const past=await school.teacherAttendanceScreen(teacher.authUser,sectionA,yesterday);expect(past.roster.some((s:{id:string})=>result!.enrolled.some(r=>r.student_id===s.id))).toBe(false);
  });
  it('rejects registers locked after review without creating people',async()=>{
    const id=await upload([row()]),old=await detail(id);await pool.query("UPDATE attendance_registers SET state='locked',locked_by=$3,locked_at=now() WHERE school_id=$1 AND class_section_id=$2",[schoolId,sectionA,admin.authUser.id]);const before=await count();
    try{await expect(imports.commit(admin,id,{school_id:schoolId,expected_revision:old.revision,validation_token:old.review!.validation_token,verified:true})).rejects.toThrow('invalid row');expect(await count()).toBe(before);}finally{await pool.query("UPDATE attendance_registers SET state='draft',locked_by=NULL,locked_at=NULL WHERE school_id=$1 AND class_section_id=$2",[schoolId,sectionA]);}
  });
  it('purges cancelled and expired draft details while retaining minimal history',async()=>{
    const id=await upload([row()]);await imports.cancel(admin,id,{school_id:schoolId,expected_revision:1});expect((await detail(id)).state).toBe('cancelled');expect((await pool.query('SELECT raw_values FROM people_import_rows WHERE import_id=$1',[id])).rows[0].raw_values).toEqual({});
    const expired=await upload([row()]);await pool.query("UPDATE people_imports SET expires_at=now()-interval '1 second' WHERE id=$1",[expired]);await imports.expireDrafts();expect((await detail(expired)).state).toBe('expired');await expect(commit(expired)).rejects.toThrow();
  });
  it('exports scoped, formula-safe correction reports and saved receipts',async()=>{
    const id=await upload([row({first_name:'=UNTRUSTED()'})]);expect(await imports.report(admin.authUser,id,schoolId)).toContain("'=UNTRUSTED()");const saved=await upload([row()]);await commit(saved);expect(await imports.report(admin.authUser,saved,schoolId)).toContain('student_id');await expect(imports.report(parent.authUser,saved,schoolId)).rejects.toThrow('administrator');
  });
  it('preserves the tenant boundary for import row student references in PostgreSQL',async()=>{
    const id=await upload([row()]);const foreign=(await pool.query('SELECT id FROM students WHERE school_id<>$1 LIMIT 1',[schoolId])).rows[0].id;
    await expect(pool.query('UPDATE people_import_rows SET student_id=$2 WHERE import_id=$1',[id,foreign])).rejects.toMatchObject({code:'23503'});
    const job=(await pool.query<ImportJob>('SELECT * FROM people_imports WHERE id=$1',[id])).rows[0];expect(job!.school_id).toBe(schoolId);
  });
  it('commits the 500-student limit using batched writes and class-coalesced events',async()=>{
    const id=await upload(Array.from({length:500},()=>row({class:'7B'})));const before=await count();const result=await commit(id);
    expect(result!.students).toBe(500);expect(await count()).toBe(before+500);
    expect((await pool.query("SELECT id FROM event_outbox WHERE school_id=$1 AND idempotency_key LIKE $2",[schoolId,`people-import:${id}:%`])).rows).toHaveLength(1);
  });
});
