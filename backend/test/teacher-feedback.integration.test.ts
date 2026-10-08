import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import { DatabaseService } from '../src/database/database.service.js';
import { TeacherFeedbackService } from '../src/teacher-feedback/teacher-feedback.service.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const isolated=process.env.TEST_DATABASE_ISOLATED==='true';
const pool=new Pool({connectionString:isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused',max:2});
const suite=isolated?describe:describe.skip;
suite('teacher feedback institution, eligibility and lifecycle boundaries',()=>{
  let db:DatabaseService,service:TeacherFeedbackService,admin:AuthUser,teacher:AuthUser,outsider:AuthUser,parent:AuthUser;
  let school:string,otherSchool:string,classId:string,otherClass:string,studentId:string,campaignId:string;
  const students:AuthUser[]=[];
  async function row(query:string,args:unknown[]=[]){return (await pool.query(query,args)).rows[0];}
  async function account(role:string):Promise<AuthUser>{const key=randomUUID();return {...await row("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Feedback',$3,$4) RETURNING *",[key,key+'@example.test',role,role]),active_school_id:school};}
  const input=()=>({teacher_user_id:teacher.id,class_section_id:classId,title:'Teacher check-in',audience:'students',parameters:['Punctuality','Clarity'],closes_at:new Date(Date.now()+86400000).toISOString()});
  beforeAll(async()=>{
    db=new DatabaseService();service=new TeacherFeedbackService(db);
    school=(await row("INSERT INTO schools(name,code) VALUES('Feedback School',$1) RETURNING id",[randomUUID().slice(0,20)])).id;
    otherSchool=(await row("INSERT INTO schools(name,code) VALUES('Other School',$1) RETURNING id",[randomUUID().slice(0,20)])).id;
    admin=await account('admin');teacher=await account('staff');outsider=await account('student');parent=await account('parent');
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'staff'),($3,$5,'student'),($4,$5,'guardian')",[admin.id,teacher.id,outsider.id,parent.id,school]);
    classId=(await row("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A') RETURNING id",[school])).id;
    otherClass=(await row("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','A') RETURNING id",[otherSchool])).id;
    const term=(await row("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'2026-27','Feedback term',current_date-30,current_date+30) RETURNING id",[school])).id;
    for(let i=0;i<6;i++){
      const user=await account('student');students.push(user);await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'student')",[user.id,school]);
      const person=(await row("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Student',$2) RETURNING id",[school,String(i)])).id;
      const id=(await row("INSERT INTO students(school_id,person_id,user_id,admission_number) VALUES($1,$2,$3,$4) RETURNING id",[school,person,user.id,'FB-'+i])).id;
      if(i===0)studentId=id;
      await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,$4,current_date-10)",[id,classId,term,i+1]);
    }
    const guardian=(await row('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[parent.id])).id;
    await pool.query("INSERT INTO guardian_relationships(guardian_id,student_id,relationship) VALUES($1,$2,'guardian')",[guardian,studentId]);
    campaignId=(await service.create(admin,school,input())).id;
  });
  afterAll(async()=>{await db?.destroy();await pool.end();});
  it('restricts creation and results to active administrators in the selected institution',async()=>{
    await expect(service.create(teacher,school,input())).rejects.toThrow(/Principal/);
    await expect(service.results(students[0]!,school,campaignId)).rejects.toThrow(/Principal/);
    await expect(service.workspace(admin,otherSchool)).rejects.toThrow(/institution/);
    await expect(service.create(admin,school,{...input(),class_section_id:otherClass})).rejects.toThrow(/belong/);
    await expect(service.create(admin,school,{...input(),closes_at:new Date(Date.now()-1000).toISOString()})).rejects.toThrow(/future/);
  });
  it('lists only current eligible recipients and rejects unrelated and malformed responses',async()=>{
    expect((await service.pending(students[0]!,school)).campaigns.map(c=>c.id)).toContain(campaignId);
    expect((await service.pending(outsider,school)).campaigns).toEqual([]);
    expect((await service.pending(parent,school)).campaigns).toEqual([]);
    await expect(service.submit(outsider,school,campaignId,{ratings:{Punctuality:'high',Clarity:'high'}})).rejects.toThrow(/not assigned/);
    await expect(service.submit(students[0]!,school,campaignId,{ratings:{Punctuality:'high'}})).rejects.toThrow(/every parameter/);
  });
  it('serializes concurrent submissions, hides open results and locks responses after closing',async()=>{
    const payload={ratings:{Punctuality:'low',Clarity:'na'}};
    const attempts=await Promise.allSettled([service.submit(students[0]!,school,campaignId,payload),service.submit(students[0]!,school,campaignId,payload)]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    for(const user of students.slice(1,5))await service.submit(user,school,campaignId,{ratings:{Punctuality:'high',Clarity:'high'}});
    expect(await service.results(admin,school,campaignId)).toMatchObject({available:false,response_count:5,parameters:[]});
    await service.close(admin,school,campaignId);
    const results=await service.results(admin,school,campaignId);
    expect(results.available).toBe(true);expect(results.history).toEqual([]);expect(results.activity.reduce((sum,day)=>sum+day.count,0)).toBe(5);expect(results.parameters[0]).toMatchObject({counts:{low:1,high:4,okay:0,na:0},signal:'strength'});
    expect(results.parameters[1]).toMatchObject({counts:null,signal:'insufficient'});
    expect(JSON.stringify(results)).not.toContain(students[0]!.id);
    await expect(service.submit(students[5]!,school,campaignId,payload)).rejects.toThrow(/closed/);
    expect((await service.pending(students[0]!,school)).campaigns).toEqual([]);
  });
  it('supports parent campaigns and rechecks current guardian relationships',async()=>{
    const id=(await service.create(admin,school,{...input(),audience:'parents'})).id;
    expect((await service.pending(parent,school)).campaigns.map(c=>c.id)).toContain(id);
    await service.submit(parent,school,id,{ratings:{Punctuality:'na',Clarity:'okay'}});
    await service.close(admin,school,id);expect(await service.results(admin,school,id)).toMatchObject({available:false,response_count:1});
    const second=(await service.create(admin,school,{...input(),audience:'parents'})).id;
    await pool.query('DELETE FROM guardian_relationships WHERE student_id=$1',[studentId]);
    await expect(service.submit(parent,school,second,{ratings:{Punctuality:'high',Clarity:'high'}})).rejects.toThrow(/not assigned/);
  });
  it('compares only complete closed rounds with the same teacher, class, audience and questions',async()=>{
    async function fixture(overrides:Record<string,unknown>={},rating='high',close=true){
      const data={...input(),...overrides};const id=(await service.create(admin,school,data)).id;
      for(const [index,user] of students.entries()){
        const ratings=Object.fromEntries(data.parameters.map(parameter=>[parameter,rating==='partial'&&parameter==='Clarity'&&index<2?'na':rating==='mixed'&&index<3?'low':'high']));
        if(rating==='na')for(const parameter of data.parameters)ratings[parameter]='na';
        await pool.query('INSERT INTO teacher_feedback_responses(school_id,campaign_id,respondent_user_id,ratings) VALUES($1,$2,$3,$4)',[school,id,user.id,JSON.stringify(ratings)]);
      }
      if(close)await service.close(admin,school,id);return id;
    }
    await fixture({},'partial');
    await fixture({},'na');
    await fixture({audience:'parents'});
    await fixture({parameters:['Different question']});
    const colleague=await account('staff');
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'staff')",[colleague.id,school]);
    await fixture({teacher_user_id:colleague.id});
    const otherLocalClass=(await row("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2026-27','7','B') RETURNING id",[school])).id;
    await fixture({class_section_id:otherLocalClass});
    const earlier=await fixture({parameters:['Clarity','Punctuality']});
    const open=await fixture({},'high',false);
    const current=await fixture({},'mixed');
    // Later closures must not change the historical view for an older round.
    const future=await fixture();
    const results=await service.results(admin,school,current);
    expect(results.history.map(r=>r.id)).toEqual([earlier,current]);
    expect(results.history[0]).toMatchObject({response_count:6,rated_count:12,high_percent:100});
    expect(results.history[1]).toMatchObject({response_count:6,rated_count:12,high_percent:50});
    expect(results.activity.reduce((sum,day)=>sum+day.count,0)).toBe(6);
    expect(JSON.stringify(results.history)).not.toContain(future);
    expect((await service.results(admin,school,open)).history).toEqual([]);
  });
  it('unlocks one open demo response while keeping ordinary administrators protected',async()=>{
    const demo=await row("SELECT u.*,s.id AS active_school_id FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.role='admin' JOIN schools s ON s.id=m.school_id WHERE u.username='meera.principal' AND s.code='cis'") as AuthUser;
    const demoSchool=demo.active_school_id!;
    const classroom=await row('SELECT id FROM class_sections WHERE school_id=$1 LIMIT 1',[demoSchool]);
    const id=(await service.create(demo,demoSchool,{...input(),teacher_user_id:demo.id,class_section_id:classroom.id})).id;
    expect(await service.results(demo,demoSchool,id)).toMatchObject({available:false,demo_preview:true,minimum_responses:1});
    await pool.query('INSERT INTO teacher_feedback_responses(school_id,campaign_id,respondent_user_id,ratings) VALUES($1,$2,$3,$4)',[demoSchool,id,students[0]!.id,JSON.stringify({Punctuality:'high',Clarity:'na'})]);
    const preview=await service.results(demo,demoSchool,id);
    expect(preview).toMatchObject({available:true,demo_preview:true,response_count:1,minimum_responses:1,history:[]});
    expect(preview.parameters[0]).toMatchObject({counts:{high:1},signal:'strength'});
    expect(preview.parameters[1]).toMatchObject({counts:null,signal:'insufficient'});
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')",[admin.id,demoSchool]);
    const regular={...admin,active_school_id:demoSchool};
    expect(await service.results(regular,demoSchool,id)).toMatchObject({available:false,demo_preview:false,minimum_responses:5,parameters:[]});
    await service.close(demo,demoSchool,id);
    expect(await service.results(regular,demoSchool,id)).toMatchObject({available:false,parameters:[]});
  });
  it('rejects expired requests and revoked memberships',async()=>{
    const id=(await service.create(admin,school,input())).id;
    await pool.query("UPDATE teacher_feedback_campaigns SET created_at=now()-interval '2 days',closes_at=now()-interval '1 day' WHERE id=$1",[id]);
    await expect(service.submit(students[0]!,school,id,{ratings:{Punctuality:'high',Clarity:'high'}})).rejects.toThrow(/closed/);
    await pool.query('UPDATE school_memberships SET is_active=false WHERE user_id=$1',[admin.id]);
    await expect(service.workspace(admin,school)).rejects.toThrow(/Principal/);
  });
});
