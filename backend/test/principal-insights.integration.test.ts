import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {DatabaseService} from "../src/database/database.service.js";
import {PrincipalInsightsService} from "../src/principal-insights/principal-insights.service.js";
import {shiftDate} from "../src/principal-insights/insight-rules.js";
import type {AuthUser} from "../src/common/request.js";
import {requireIsolatedTestDatabaseUrl} from "./test-database.js";
const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
const pool=new Pool({connectionString:isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused",max:1});
const suite=isolated?describe:describe.skip;
suite("principal insights scoped database aggregation",()=>{
  let db:DatabaseService,service:PrincipalInsightsService,admin:AuthUser,staff:AuthUser;
  let school:string,otherSchool:string,classId:string,otherClass:string,term:string,subject:string;
  const students:string[]=[];
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const end=shiftDate(today,-1),start=shiftDate(end,-13),baseline=shiftDate(start,-14);
  async function insert(sql:string,params:unknown[]=[]){return(await pool.query(sql,params)).rows[0];}
  beforeAll(async()=>{
    db=new DatabaseService();service=new PrincipalInsightsService(db);const key=randomUUID();
    school=(await insert("INSERT INTO schools(name,code) VALUES('Insights school',$1) RETURNING id",[key.slice(0,20)])).id;
    otherSchool=(await insert("INSERT INTO schools(name,code) VALUES('Other insights school',$1) RETURNING id",['o'+key.slice(0,20)])).id;
    admin={...(await insert("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Insights','Admin','admin') RETURNING *",[key,key+'@example.test'])),active_school_id:school};
    staff={...(await insert("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Insights','Staff','staff') RETURNING *",['s'+key,'s'+key+'@example.test'])),active_school_id:school};
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$3,'admin'),($2,$3,'staff')",[admin.id,staff.id,school]);
    term=(await insert("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'2026-27','Insight term',$2,$3) RETURNING id",[school,baseline,shiftDate(today,30)])).id;
    classId=(await insert("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A') RETURNING id",[school])).id;
    otherClass=(await insert("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','B') RETURNING id",[otherSchool])).id;
    subject=(await insert("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'MAT','Mathematics','Maths') RETURNING id",[school])).id;
    await pool.query("INSERT INTO timetable_slots(class_section_id,term_id,subject_id,teacher_user_id,weekday,period_number,starts_at,ends_at,slot_type) SELECT $1,$2,$3,$4,n,1,'09:00','10:00','class' FROM generate_series(1,7) n",[classId,term,subject,admin.id]);
    for(let i=0;i<3;i++){
      const person=(await insert("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,$2,'Learner') RETURNING id",[school,['Declining','Steady','Unrecorded'][i]])).id;
      const id=(await insert("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,$3) RETURNING id",[school,person,'I'+i])).id;students.push(id);
      await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,$4,$5)",[id,classId,term,i+1,baseline]);
      await pool.query("INSERT INTO attendance_records(student_id,class_section_id,date,status,marked_by) SELECT $1,$2,d::date,$3,$4 FROM generate_series($5::date,$6::date,'1 day') d",[id,classId,i===1?'half_day':'present',admin.id,baseline,shiftDate(start,-1)]);
      if(i<2) for(let day=0;day<14;day++) await pool.query("INSERT INTO attendance_records(student_id,class_section_id,date,status,marked_by) VALUES($1,$2,$3,$4,$5)",[id,classId,shiftDate(start,day),i===0?(day<7?'present':'absent'):(day<7?'excused':'half_day'),admin.id]);
    }
    for(let i=0;i<2;i++) await pool.query("INSERT INTO diary_items(school_id,class_section_id,term_id,date,item_type,title,body,author_id,due_at,published_at) VALUES($1,$2,$3,$4,'homework','Practice','Exercises',$5,$6,$4::date)",[school,classId,term,start,admin.id,`${shiftDate(end,-i)}T12:00:00+05:30`]);
    const invoice=(await insert("INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by) VALUES($1,$2,'INSIGHT-FEE','Tuition',10000,$3,$4) RETURNING id",[school,students[0],end,admin.id])).id;
    await pool.query("INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by) VALUES($1,$2,4000,'cash','INSIGHT-PAY',$3,$4)",[school,invoice,randomUUID(),admin.id]);
    const cycle=(await insert("INSERT INTO assessment_cycles(school_id,term_id,name,code,starts_on,ends_on,created_by,updated_by) VALUES($1,$2,'Insight cycle','INS',$3,$4,$5,$5) RETURNING id",[school,term,start,end,admin.id])).id;
    const assessment=(await insert("INSERT INTO assessments(school_id,cycle_id,class_section_id,subject_id,title,assessment_kind,maximum_marks,created_by,updated_by) VALUES($1,$2,$3,$4,'Published maths','class_test',100,$5,$5) RETURNING id",[school,cycle,classId,subject,admin.id])).id;
    const result=(await insert("INSERT INTO assessment_results(school_id,assessment_id,student_id,outcome,marks,recorded_by,recorded_at) VALUES($1,$2,$3,'scored',90,$4,now()) RETURNING id",[school,assessment,students[0],admin.id])).id;
    for(let sequence=1;sequence<=2;sequence++){
      const publication=(await insert("INSERT INTO assessment_publications(school_id,assessment_id,sequence,source_revision,reason,published_by,published_at) VALUES($1,$2,$3,1,'Published result',$4,$5) RETURNING id",[school,assessment,sequence,admin.id,`${end}T12:00:00+05:30`])).id;
      await pool.query("INSERT INTO assessment_publication_results(school_id,publication_id,assessment_id,student_id,source_result_id,source_result_revision,outcome,marks) VALUES($1,$2,$3,$4,$5,1,'scored',$6)",[school,publication,assessment,students[0],result,sequence===1?20:60]);
    }
  });
  // Unique fixtures remain in this disposable database. Never bypass immutable-record protections to clean up.
  afterAll(async()=>{await db?.destroy();await pool.end();});
  it("weights attendance, excludes excused days and preserves missing records",async()=>{
    const data=await service.overview(admin,school,{date:end,days:14});
    expect(data.attendance).toMatchObject({expected:42,recorded:28,scored:21,points:10.5,percentage:50,completeness:66.7});
    expect(data.engagement).toMatchObject({total:1,combined:1,without_followup:1});
    expect(data.engagement.students[0]).toMatchObject({id:students[0],current:50,previous:100,missing_homework:2});
    expect(data.schedule.reduce((n,d)=>n+d.planned,0)).toBe(7);expect(data.fees.reduce((n,f)=>n+f.balance_paise,0)).toBe(6000);
  });
  it("uses the latest published snapshot rather than draft marks or duplicate publications",async()=>{
    const data=await service.overview(admin,school,{date:end,days:14,threshold:50});expect(data.learning).toHaveLength(1);expect(data.learning[0]).toMatchObject({assessed:1,below:0,roster:1});
    expect((await service.overview(admin,school,{date:end,days:14,threshold:70})).learning[0]?.below).toBe(1);
  });
  it("tracks current overdue owners and deadline clusters independently of historical attendance",async()=>{
    const record=(await insert("SELECT id FROM attendance_records WHERE student_id=$1 AND date=$2",[students[0],end])).id;
    await pool.query("INSERT INTO attendance_followups(school_id,student_id,attendance_record_id,attendance_date,source_revision,question,owner_user_id,due_at) VALUES($1,$2,$3,$4,1,'Please review absence',$5,now()-interval '1 day')",[school,students[0],record,end,admin.id]);
    for(let i=0;i<3;i++) await pool.query("INSERT INTO diary_items(school_id,class_section_id,term_id,date,item_type,title,body,author_id,due_at) VALUES($1,$2,$3,$4,'homework','Upcoming practice','Exercises',$5,$6)",[school,classId,term,today,admin.id,`${today}T23:00:00+05:30`]);
    const data=await service.overview(admin,school,{date:end,days:14});
    expect(data.followups).toMatchObject({awaiting:1,review:0,overdue:1});
    expect(data.followups.details[0]).toMatchObject({owner:'Insights Admin',class_id:classId});
    expect(data.engagement.without_followup).toBe(0);
    expect(data.deadlines).toEqual(expect.arrayContaining([expect.objectContaining({class_id:classId,total:3,homework:3})]));
  });
  it("refuses non-admins, other institutions, cross-tenant filters and invalid dates",async()=>{
    await expect(service.overview(staff,school,{})).rejects.toThrow(/administrator/);
    await expect(service.overview(admin,otherSchool,{})).rejects.toThrow(/administrator/);
    await expect(service.overview(admin,school,{class_section_id:otherClass})).rejects.toThrow(/class/);
    await expect(service.overview(admin,school,{date:'2026-02-30'})).rejects.toThrow(/ISO date/);
    await expect(service.overview(admin,school,{days:100000})).rejects.toThrow(/window/);
  });
  it('returns only the selected operational topic with its definitions and current authorization',async()=>{
    const fees=await service.review(admin,school,{topic:'fees',date:end,days:14});
    expect(fees).toMatchObject({topic:'fees',currency:'INR',unit:'paise'});
    expect(fees).not.toHaveProperty('engagement');expect(fees).not.toHaveProperty('learning');
    const attendance=await service.review(admin,school,{topic:'attendance',date:end,days:14});
    expect(attendance).toHaveProperty('engagement');expect(attendance).not.toHaveProperty('fees');
    expect(attendance.definitions).toMatch(/Missing records are not absence/);
    await expect(service.review(staff,school,{topic:'attendance'})).rejects.toThrow(/administrator/);
    await expect(service.review(admin,otherSchool,{topic:'fees'})).rejects.toThrow(/administrator/);
    await expect(service.review(admin,school,{topic:'coverage',class_section_id:otherClass})).rejects.toThrow(/class/);
    await expect(service.review(admin,school,{topic:'fees',sql:'SELECT *'})).rejects.toThrow();
  });
});
