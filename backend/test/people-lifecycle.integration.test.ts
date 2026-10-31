import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {DatabaseService} from "../src/database/database.service.js";
import {PeopleService} from "../src/people/people.service.js";
import type {AuthenticatedRequest,AuthUser} from "../src/common/request.js";
import type {CampusModelCoreService} from "../src/campus-model-core/campus-model-core.service.js";
import {ProgressiveWorkspaceProvisioner} from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import {academicParticipationTestServices} from './academic-participation.test-support.js';
import {requireIsolatedTestDatabaseUrl} from "./test-database.js";

const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
const suite=isolated?describe:describe.skip;
suite("connected student enrollment lifecycle",()=>{
  const pool=new Pool({connectionString:isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused_test",max:2});
  let database:DatabaseService,people:PeopleService,core:CampusModelCoreService,admin:AuthenticatedRequest,schoolId:string,studentId:string,termId:string,classA:string,classB:string,today:string;
  const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),protocol:"http",headers:{host:"localhost"},ip:"127.0.0.1"}) as AuthenticatedRequest;
  beforeAll(async()=>{
    database=new DatabaseService();const shared=academicParticipationTestServices(database);core=shared.core;
    people=new PeopleService(database,shared.events,core,core,core,shared.bridge);
    const suffix=randomUUID();
    const user=await database.insertInto("users").values({username:`connected-${suffix}`,email:`connected-${suffix}@example.test`,
      password_hash:"isolated-fixture-only",first_name:"Lifecycle",last_name:"Owner",role:"admin"})
      .returning(["id","username","email","first_name","last_name","role","is_active"]).executeTakeFirstOrThrow();
    schoolId=await database.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(core).createForAccount(tx,user,"Asia/Kolkata"));
    admin=request({...user,active_school_id:schoolId});
    today=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text today")).rows[0].today;
    termId=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active) VALUES($1,'2026-27','Term 1',$2::date-90,$2::date+90,85,true) RETURNING id",[schoolId,today])).rows[0].id;
    const classes=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A'),($1,'2026-27','7','B') RETURNING id,section",[schoolId])).rows;
    classA=classes.find(row=>row.section==='A').id;classB=classes.find(row=>row.section==='B').id;
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Mira','Sen') RETURNING id",[schoolId])).rows[0].id;
    studentId=(await pool.query("INSERT INTO students(person_id,school_id,admission_number,date_of_birth) VALUES($1,$2,'CONNECTED-1','2014-03-04') RETURNING id",[person,schoolId])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4)",[studentId,classA,termId,today]);
    const subject=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'ENG-CON','English','Eng') RETURNING id",[schoolId])).rows[0].id;
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,slot_type) SELECT class_id,$3,$4,day,1,'09:00','09:45','class' FROM unnest(ARRAY[$1::uuid,$2::uuid]) class_id CROSS JOIN generate_series(1,7) day",[classA,classB,termId,subject]);
    const otherPerson=(await pool.query("INSERT INTO school_people(school_id,first_name) VALUES($1,'Destination original') RETURNING id",[schoolId])).rows[0].id;
    const otherStudent=(await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'DESTINATION-1') RETURNING id",[schoolId,otherPerson])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4)",[otherStudent,classB,termId,today]);
    for(const [classId,personId] of [[classA,person],[classB,otherPerson]]){
      const prepared=await shared.bridge.prepareDaily(admin.authUser,schoolId,classId,today,true);
      await shared.kernel.submitRecords(admin.authUser,schoolId,prepared.register_id,{expected_revision:0,records:[{person_id:personId,status:'present'}]},
        {...admin,requestId:randomUUID(),headers:{...admin.headers,'idempotency-key':randomUUID()}});
    }
  });
  afterAll(async()=>{
    // Retain the random isolated fixture and immutable Core evidence together;
    // partial cleanup must not erase the source beneath its retained outcome.
    await database?.destroy();await pool.end();
  });
  it("does not promote a resource-only exception into campus People management",async()=>{
    const suffix=randomUUID();
    const account=await database.insertInto("users").values({username:`people-scope-${suffix}`,email:`people-scope-${suffix}@example.test`,
      password_hash:"isolated-fixture-only",first_name:"Scoped",last_name:"Operator",role:"staff"})
      .returning(["id","username","email","first_name","last_name","role","is_active"]).executeTakeFirstOrThrow();
    await database.insertInto("school_memberships").values({school_id:schoolId,user_id:account.id,role:"staff",is_active:true}).execute();
    const staff=request({...account,active_school_id:schoolId});
    const exception=(await pool.query(`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,
      scope_kind,valid_from,valid_until,review_due_on,created_by) VALUES($1,$2,'sis.manage','Isolated scope regression',
      'manual','assigned_resources',$3::date,$3::date+2,$3::date+1,$4) RETURNING id`,[schoolId,account.id,today,admin.authUser.id])).rows[0];
    const current=(await people.lifecycle(admin.authUser,studentId,schoolId)).current as {id:string;revision:number};
    const input={school_id:schoolId,action:"move_class",expected_enrollment_id:current.id,expected_revision:current.revision,
      effective_on:today,target_class_section_id:classB,target_term_id:termId,roll_number:4,reason:"Scope review only"};
    await expect(people.lifecycle(staff.authUser,studentId,schoolId)).rejects.toThrow("Institution-scoped school permission");
    await expect(people.previewLifecycle(staff,studentId,input)).rejects.toThrow("Institution-scoped school permission");
    await pool.query("UPDATE school_access_exceptions SET scope_kind='institution',revision=revision+1 WHERE id=$1",[exception.id]);
    expect((await people.lifecycle(staff.authUser,studentId,schoolId)).current).toMatchObject({id:current.id});
    expect(await people.previewLifecycle(staff,studentId,input)).toMatchObject({input:{expected_enrollment_id:current.id}});
  });
  it("reviews and commits a same-term move without deleting the prior placement",async()=>{
    const lifecycle=await people.lifecycle(admin.authUser,studentId,schoolId);const current=lifecycle.current as {id:string;revision:number};
    const preview=await people.previewLifecycle(admin,studentId,{school_id:schoolId,action:"move_class",expected_enrollment_id:current.id,expected_revision:current.revision,effective_on:today,target_class_section_id:classB,target_term_id:termId,roll_number:4,reason:"Balanced class placement"});
    expect(preview).toMatchObject({target:{class_name:"Class 7B"},impact:{submitted_registers:2}});
    const refusal=vi.spyOn(core,"recordAcceptedEvent").mockRejectedValueOnce(new Error("Isolated model journal refusal"));
    await expect(people.commitLifecycle(admin,preview.id)).rejects.toThrow("Isolated model journal refusal");refusal.mockRestore();
    expect((await people.lifecycle(admin.authUser,studentId,schoolId)).current).toMatchObject({id:current.id,revision:current.revision});
    expect((await pool.query("SELECT count(*)::int total FROM campus_model_commands WHERE school_id=$1 AND idempotency_key=$2",[schoolId,`enrollment-lifecycle:${preview.id}`])).rows[0].total).toBe(0);
    const first=await people.commitLifecycle(admin,preview.id);const retry=await people.commitLifecycle(admin,preview.id);expect(retry).toEqual(first);
    const rows=(await pool.query("SELECT class_section_id,is_active,exit_kind,exit_reason FROM enrollments WHERE student_id=$1 ORDER BY is_active",[studentId])).rows;
    expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({class_section_id:classA,is_active:false,exit_kind:"class_move",exit_reason:"Balanced class placement"});expect(rows[1]).toMatchObject({class_section_id:classB,is_active:true});
    expect((await pool.query("SELECT state,revision FROM attendance_registers WHERE school_id=$1 ORDER BY class_section_id",[schoolId])).rows).toEqual([{state:"draft",revision:2},{state:"draft",revision:2}]);
    expect((await pool.query("SELECT count(*)::int total FROM event_outbox WHERE school_id=$1 AND idempotency_key=$2",[schoolId,`enrollment-change:${preview.id}`])).rows[0].total).toBe(1);
    const trace=(await pool.query(`SELECT command.state,outcome.status,event.event_type,event.correlation_id,
        event.payload->>'closure' AS closure,outcome.metadata->>'authority_or_account_access_changed' AS access_changed
      FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      JOIN campus_model_events event ON event.id=(outcome.metadata->>'model_event_id')::uuid
      WHERE command.school_id=$1 AND command.idempotency_key=$2`,[schoolId,`enrollment-lifecycle:${preview.id}`])).rows;
    expect(trace).toEqual([{state:"accepted",status:"accepted",event_type:"people.enrollment.changed",correlation_id:preview.id,
      closure:"terminal_domain_decision",access_changed:"false"}]);
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
