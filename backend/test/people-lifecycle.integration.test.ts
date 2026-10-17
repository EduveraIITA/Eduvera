import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {DatabaseService} from "../src/database/database.service.js";
import {PeopleService} from "../src/people/people.service.js";
import {SchoolEventService} from "../src/school/school-event.service.js";
import type {AuthenticatedRequest,AuthUser} from "../src/common/request.js";

const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
const suite=isolated?describe:describe.skip;
suite("connected student enrollment lifecycle",()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
  let database:DatabaseService,people:PeopleService,admin:AuthenticatedRequest,schoolId:string,studentId:string,termId:string,classA:string,classB:string,today:string;
  const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),protocol:"http",headers:{host:"localhost"},ip:"127.0.0.1"}) as AuthenticatedRequest;
  beforeAll(async()=>{
    database=new DatabaseService();people=new PeopleService(database,new SchoolEventService(database));
    const user=(await pool.query<AuthUser>("SELECT users.* FROM users JOIN school_memberships membership ON membership.user_id=users.id WHERE membership.role='admin' AND membership.is_active LIMIT 1")).rows[0]!;
    admin=request(user);
    schoolId=(await pool.query("INSERT INTO schools(name,code,timezone) VALUES('Connected student test',$1,'Asia/Kolkata') RETURNING id",[`connected-${randomUUID().slice(0,8)}`])).rows[0].id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')",[user.id,schoolId]);
    today=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text today")).rows[0].today;
    termId=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active) VALUES($1,'2026-27','Term 1',$2::date-90,$2::date+90,85,true) RETURNING id",[schoolId,today])).rows[0].id;
    const classes=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A'),($1,'2026-27','7','B') RETURNING id,section",[schoolId])).rows;
    classA=classes.find(row=>row.section==='A').id;classB=classes.find(row=>row.section==='B').id;
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Mira','Sen') RETURNING id",[schoolId])).rows[0].id;
    studentId=(await pool.query("INSERT INTO students(person_id,school_id,admission_number,date_of_birth) VALUES($1,$2,'CONNECTED-1','2014-03-04') RETURNING id",[person,schoolId])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4)",[studentId,classA,termId,today]);
    const subject=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'ENG-CON','English','Eng') RETURNING id",[schoolId])).rows[0].id;
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,slot_type) VALUES($1,$3,$4,1,1,'09:00','09:45','class'),($2,$3,$4,1,1,'09:00','09:45','class')",[classA,classB,termId,subject]);
    await pool.query("INSERT INTO attendance_registers(school_id,class_section_id,term_id,date,state,revision,submitted_by,submitted_at) VALUES($1,$2,$4,$5,'submitted',1,$6,now()),($1,$3,$4,$5,'submitted',1,$6,now())",[schoolId,classA,classB,termId,today,user.id]);
  });
  afterAll(async()=>{
    if(schoolId){
      await pool.query("DELETE FROM event_outbox WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM audit_events WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM student_enrollment_change_reviews WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM subject_attendance WHERE student_id=$1",[studentId]);
      await pool.query("DELETE FROM attendance_registers WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM timetable_slots WHERE class_section_id IN($1,$2)",[classA,classB]);
      await pool.query("DELETE FROM subjects WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM enrollments WHERE student_id=$1",[studentId]);
      const person=(await pool.query("DELETE FROM students WHERE id=$1 RETURNING person_id",[studentId])).rows[0]?.person_id;
      await pool.query("DELETE FROM school_memberships WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM class_sections WHERE school_id=$1",[schoolId]);await pool.query("DELETE FROM academic_terms WHERE school_id=$1",[schoolId]);
      if(person) await pool.query("DELETE FROM school_people WHERE id=$1",[person]);await pool.query("DELETE FROM schools WHERE id=$1",[schoolId]);
    }
    await database?.destroy();await pool.end();
  });
  it("reviews and commits a same-term move without deleting the prior placement",async()=>{
    const lifecycle=await people.lifecycle(admin.authUser,studentId,schoolId);const current=lifecycle.current as {id:string;revision:number};
    const preview=await people.previewLifecycle(admin,studentId,{school_id:schoolId,action:"move_class",expected_enrollment_id:current.id,expected_revision:current.revision,effective_on:today,target_class_section_id:classB,target_term_id:termId,roll_number:4,reason:"Balanced class placement"});
    expect(preview).toMatchObject({target:{class_name:"Class 7B"},impact:{submitted_registers:2}});
    const first=await people.commitLifecycle(admin,preview.id);const retry=await people.commitLifecycle(admin,preview.id);expect(retry).toEqual(first);
    const rows=(await pool.query("SELECT class_section_id,is_active,exit_kind,exit_reason FROM enrollments WHERE student_id=$1 ORDER BY is_active",[studentId])).rows;
    expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({class_section_id:classA,is_active:false,exit_kind:"class_move",exit_reason:"Balanced class placement"});expect(rows[1]).toMatchObject({class_section_id:classB,is_active:true});
    expect((await pool.query("SELECT state,revision FROM attendance_registers WHERE school_id=$1 ORDER BY class_section_id",[schoolId])).rows).toEqual([{state:"draft",revision:2},{state:"draft",revision:2}]);
    expect((await pool.query("SELECT count(*)::int total FROM event_outbox WHERE school_id=$1 AND idempotency_key=$2",[schoolId,`enrollment-change:${preview.id}`])).rows[0].total).toBe(1);
  });
  it("ends an enrollment but preserves the connected student and placement history",async()=>{
    const current=(await people.lifecycle(admin.authUser,studentId,schoolId)).current as {id:string;revision:number};
    const preview=await people.previewLifecycle(admin,studentId,{school_id:schoolId,action:"transfer_out",expected_enrollment_id:current.id,expected_revision:current.revision,effective_on:today,reason:"Family relocated to another city"});
    await people.commitLifecycle(admin,preview.id);
    const lifecycle=await people.lifecycle(admin.authUser,studentId,schoolId);expect(lifecycle.current).toBeNull();expect(lifecycle.history).toHaveLength(2);
    expect((await pool.query("SELECT admission_number FROM students WHERE id=$1",[studentId])).rows[0].admission_number).toBe("CONNECTED-1");
  });
  it("rejects stale reviews instead of applying a second lifecycle decision",async()=>{
    const history=(await people.lifecycle(admin.authUser,studentId,schoolId)).history as Array<{id:string;revision:number}>;const old=history[0]!;
    await expect(people.previewLifecycle(admin,studentId,{school_id:schoolId,action:"withdraw",expected_enrollment_id:old.id,expected_revision:old.revision,effective_on:today,reason:"Duplicate stale action"})).rejects.toThrow("current enrollment changed");
  });
});
