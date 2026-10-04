import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PeopleService} from "../src/people/people.service.js";
import {GuardianAuthorityService} from "../src/people/guardian-authority.service.js";
import {SchoolService} from "../src/school/school.service.js";
import {SchoolEventService} from "../src/school/school-event.service.js";
import {CoordinationService} from "../src/coordination/coordination.service.js";
import {DatabaseService} from "../src/database/database.service.js";
import type {AuthUser,AuthenticatedRequest} from "../src/common/request.js";
import {requireIsolatedTestDatabaseUrl} from "./test-database.js";
const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:2});
let db:DatabaseService,people:PeopleService,school:SchoolService,events:SchoolEventService;
let admin:AuthenticatedRequest,teacher:AuthenticatedRequest,parent:AuthenticatedRequest;
let schoolId:string,section:string,term:string,today:string,existingGuardian:string;
const drafts:string[]=[];const students:string[]=[];const followups:string[]=[];
const temporaryClasses:string[]=[];const temporaryRegisters:string[]=[];
let roll=1000;
let authority:GuardianAuthorityService;
const leaveIds:string[]=[];
async function account(username:string){return {authUser:(await pool.query<AuthUser>("SELECT * FROM users WHERE username=$1",[username])).rows[0]!,requestId:randomUUID(),ip:"127.0.0.1",protocol:"http",headers:{host:"localhost:8000"}} as AuthenticatedRequest;}
function input(){return {school_id:schoolId,first_name:"Ishaan",last_name:"Deshmukh",admission_number:`TEST-${randomUUID().slice(0,8)}`,date_of_birth:"2014-04-12",class_section_id:section,term_id:term,roll_number:roll++,enrolled_on:today,guardian:{mode:"new" as const,first_name:"Nandita",last_name:"Deshmukh",phone:"+91 90000 11001",email:""},relationship:"mother" as const,can_authorize_leave:false};}
async function preview(value:unknown=input()){const result=await people.preview(admin,value);drafts.push(result.id);return result;}
async function commit(id:string){const result=await people.commit(admin,id);if(!students.includes(result.student_id))students.push(result.student_id);return result.student_id;}
async function registerFixture(state:"submitted"|"draft"){
  const id=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) SELECT school_id,academic_year,$2,'Z' FROM academic_terms WHERE id=$1 RETURNING id",[term,`T${randomUUID().slice(0,8)}`])).rows[0].id;temporaryClasses.push(id);
  const register=(await pool.query("INSERT INTO attendance_registers(school_id,class_section_id,term_id,date,state,revision,submitted_by,submitted_at) VALUES($1,$2,$3,$4,$5,1,$6,now()) RETURNING id",[schoolId,id,term,today,state,admin.authUser.id])).rows[0].id;temporaryRegisters.push(register);
  return {section:id,register};
}
beforeAll(async()=>{
  db=new DatabaseService();events=new SchoolEventService(db);people=new PeopleService(db,events);school=new SchoolService(db,events);
  authority=new GuardianAuthorityService(db,events);
  const row=(await pool.query("SELECT u.username,m.school_id FROM users u JOIN school_memberships m ON m.user_id=u.id WHERE m.role='admin' AND m.is_active ORDER BY u.created_at LIMIT 1")).rows[0];
  admin=await account(row.username);schoolId=row.school_id;teacher=await account("kavita.staff");parent=await account("pooja.parent");
  const target=(await pool.query("SELECT e.class_section_id,e.term_id,(now() AT TIME ZONE sc.timezone)::date::text AS today FROM students s JOIN enrollments e ON e.student_id=s.id JOIN users u ON u.id=s.user_id JOIN schools sc ON sc.id=s.school_id WHERE u.username='aarav.student' AND e.is_active LIMIT 1")).rows[0];
  section=target.class_section_id;term=target.term_id;today=target.today;
  existingGuardian=(await pool.query("SELECT id FROM parents WHERE user_id=$1",[parent.authUser.id])).rows[0].id;
});
afterAll(async()=>{
  for(const id of leaveIds){await pool.query("DELETE FROM notifications WHERE metadata->>'leave_request_id'=$1",[id]);await pool.query("DELETE FROM event_outbox WHERE aggregate_id=$1",[id]);await pool.query("DELETE FROM leave_requests WHERE id=$1",[id]);}
  for(const id of followups){await pool.query("DELETE FROM coordination_commands WHERE followup_id=$1",[id]);await pool.query("DELETE FROM attendance_followup_entries WHERE followup_id=$1",[id]);await pool.query("DELETE FROM attendance_followups WHERE id=$1",[id]);await pool.query("DELETE FROM event_outbox WHERE aggregate_id=$1",[id]);await pool.query("DELETE FROM audit_events WHERE target_id=$1",[id]);}
  for(const id of drafts)await pool.query("DELETE FROM people_intakes WHERE id=$1",[id]);
  for(const id of students){
    const remainingLeaves=(await pool.query("SELECT id FROM leave_requests WHERE student_id=$1",[id])).rows;
    for(const leave of remainingLeaves){await pool.query("DELETE FROM notifications WHERE metadata->>'leave_request_id'=$1",[leave.id]);await pool.query("DELETE FROM event_outbox WHERE aggregate_id=$1",[leave.id]);await pool.query("DELETE FROM leave_requests WHERE id=$1",[leave.id]);}
    const guardians=(await pool.query("SELECT p.id,gp.person_id FROM parents p JOIN guardian_relationships g ON g.guardian_id=p.id JOIN guardian_school_profiles gp ON gp.guardian_id=p.id WHERE g.student_id=$1 AND p.user_id IS NULL",[id])).rows;
    const person=(await pool.query("SELECT person_id FROM students WHERE id=$1",[id])).rows[0];
    await pool.query("DELETE FROM audit_events WHERE target_id IN (SELECT id FROM guardian_relationships WHERE student_id=$1)",[id]);
    await pool.query("DELETE FROM guardian_relationships WHERE student_id=$1",[id]);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_id=$1",[id]);await pool.query("DELETE FROM audit_events WHERE target_id=$1",[id]);await pool.query("DELETE FROM students WHERE id=$1",[id]);
    for(const g of guardians){await pool.query("DELETE FROM parents WHERE id=$1",[g.id]);await pool.query("DELETE FROM school_people WHERE id=$1",[g.person_id]);}
    if(person)await pool.query("DELETE FROM school_people WHERE id=$1",[person.person_id]);
  }
  for(const id of temporaryRegisters){await pool.query("DELETE FROM audit_events WHERE target_id=$1",[id]);await pool.query("DELETE FROM attendance_registers WHERE id=$1",[id]);}
  for(const id of temporaryClasses)await pool.query("DELETE FROM class_sections WHERE id=$1",[id]);
  await db.destroy();await pool.end();
});
describe("Account-optional school enrollment",()=>{
  it("backfills school identities without orphaning any existing student or guardian link",async()=>{
    expect((await pool.query("SELECT s.id FROM students s LEFT JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id WHERE p.id IS NULL")).rows).toHaveLength(0);
    expect((await pool.query("SELECT g.id FROM guardian_relationships g JOIN students s ON s.id=g.student_id LEFT JOIN guardian_school_profiles p ON p.guardian_id=g.guardian_id AND p.school_id=s.school_id WHERE p.person_id IS NULL")).rows).toHaveLength(0);
    expect((await pool.query("SELECT relname FROM pg_class WHERE oid=ANY(ARRAY['school_people'::regclass,'guardian_school_profiles'::regclass,'people_intakes'::regclass]) AND relowner<>(SELECT relowner FROM pg_class WHERE oid='students'::regclass)")).rows).toHaveLength(0);
  });
  it("previews without creating a student, guardian or account",async()=>{
    const before=(await pool.query("SELECT (SELECT count(*) FROM students) AS students,(SELECT count(*) FROM parents) AS parents,(SELECT count(*) FROM users) AS accounts")).rows[0];
    const review=await preview();expect(review.class_name).toBe("Class 7A");expect(review.guardian.name).toBe("Nandita Deshmukh");
    expect((await pool.query("SELECT (SELECT count(*) FROM students) AS students,(SELECT count(*) FROM parents) AS parents,(SELECT count(*) FROM users) AS accounts")).rows[0]).toEqual(before);
  });
  it("paginates the name-ordered directory without repeating students",async()=>{
    const first=await people.list(admin.authUser,{school_id:schoolId});expect(first.results).toHaveLength(25);expect(first.next_cursor).toBeTruthy();
    const second=await people.list(admin.authUser,{school_id:schoolId,cursor:first.next_cursor!});
    expect(new Set([...first.results,...second.results].map(r=>r.id)).size).toBe(first.results.length+second.results.length);
  });
  it("atomically saves a named student, guardian, relationship and enrollment without accounts or attendance",async()=>{
    const count=(await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
    const value=input();const id=await commit((await preview(value)).id);
    const row=(await pool.query("SELECT s.user_id,p.first_name,g.relationship,g.can_authorize_leave,pa.user_id AS guardian_account,e.enrolled_on::text FROM students s JOIN school_people p ON p.id=s.person_id JOIN guardian_relationships g ON g.student_id=s.id JOIN parents pa ON pa.id=g.guardian_id JOIN enrollments e ON e.student_id=s.id WHERE s.id=$1",[id])).rows[0];
    expect(row).toEqual({user_id:null,first_name:"Ishaan",relationship:"mother",can_authorize_leave:false,guardian_account:null,enrolled_on:today});
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(count);
    expect((await pool.query("SELECT id FROM attendance_records WHERE student_id=$1",[id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT classes_held FROM subject_attendance WHERE student_id=$1",[id])).rows.length).toBeGreaterThan(0);
    const listing=await people.list(admin.authUser,{school_id:schoolId,search:value.admission_number});expect(listing.results[0]).toMatchObject({id,name:"Ishaan Deshmukh",has_account:false,avatar_url:""});
    const initial=await people.list(admin.authUser,{school_id:schoolId,initial:"i"});
    expect(initial.results.find((student:{id:string})=>student.id===id)).toBeTruthy();
    expect(initial.results.every((student:{name:string})=>student.name.startsWith("I"))).toBe(true);
  });
  it("keeps new students in current rosters and out of registers before their enrollment",async()=>{
    const id=await commit((await preview()).id);
    const current=await school.teacherAttendanceScreen(teacher.authUser,section,today);
    expect(current.roster.find((r:{id:string})=>r.id===id)).toMatchObject({name:"Ishaan Deshmukh",status:null});
    const past=(await pool.query("SELECT ($1::date-1)::text AS date",[today])).rows[0].date;
    expect((await school.teacherAttendanceScreen(teacher.authUser,section,past)).roster.some((r:{id:string})=>r.id===id)).toBe(false);
  });
  it("returns affected submitted registers to draft and audits the roster change",async()=>{
    const fixture=await registerFixture("submitted");const review=await preview({...input(),class_section_id:fixture.section});expect(review.warnings.join(" ")).toContain("return to draft");
    await commit(review.id);
    expect((await pool.query("SELECT state,revision,submitted_at FROM attendance_registers WHERE id=$1",[fixture.register])).rows[0]).toEqual({state:"draft",revision:2,submitted_at:null});
    expect((await pool.query("SELECT id FROM audit_events WHERE target_id=$1 AND action='attendance.register.roster_changed'",[fixture.register])).rows).toHaveLength(1);
  });
  it("rejects an enrollment when an affected register is locked after review",async()=>{
    const fixture=await registerFixture("draft");const review=await preview({...input(),class_section_id:fixture.section});
    await pool.query("UPDATE attendance_registers SET state='locked',locked_by=$2,locked_at=now() WHERE id=$1",[fixture.register,admin.authUser.id]);
    await expect(commit(review.id)).rejects.toThrow("register is locked");
    expect((await pool.query("SELECT id FROM students WHERE school_id=$1 AND admission_number=$2",[schoolId,review.input.admission_number])).rows).toHaveLength(0);
  });
  it("reuses only an explicitly selected same-school guardian and allows the parent to see a child without a login",async()=>{
    const value={...input(),guardian:{mode:"existing",id:existingGuardian},can_authorize_leave:true};
    const id=await commit((await preview(value)).id);
    const student=await school.studentForUser(parent.authUser,id);
    expect(student.user_id).toBeNull();expect(student.first_name).toBe("Ishaan");
    expect((await school.studentDto(student)).user).toMatchObject({id:null,display_name:"Ishaan Deshmukh"});
    expect((await school.parentHome(parent.authUser,id)).student.user).toMatchObject({id:null,display_name:"Ishaan Deshmukh"});
    expect((await pool.query("SELECT guardian_id FROM guardian_relationships WHERE student_id=$1",[id])).rows[0].guardian_id).toBe(existingGuardian);
  });
  it("deduplicates concurrent commit retries and publishes one scoped enrollment event",async()=>{
    const draft=await preview();const [a,b]=await Promise.all([commit(draft.id),commit(draft.id)]);expect(a).toBe(b);
    const rows=(await pool.query("SELECT audience_user_ids,payload FROM event_outbox WHERE aggregate_id=$1 AND event_type='people.updated'",[a])).rows;
    expect(rows).toHaveLength(1);expect(rows[0].audience_user_ids).not.toContain(null);expect(rows[0].payload).not.toHaveProperty("first_name");
    expect((await pool.query("SELECT input FROM people_intakes WHERE id=$1",[draft.id])).rows[0].input).toEqual({});
  });
  it("rejects duplicate admission numbers, duplicate rolls and stale review conflicts without partial people",async()=>{
    const value=input();const draft=await preview(value);const competitor=await preview({...value,admission_number:`TEST-${randomUUID().slice(0,8)}`});
    await commit(competitor.id);
    const count=(await pool.query("SELECT count(*)::int AS n FROM school_people")).rows[0].n;
    await expect(commit(draft.id)).rejects.toThrow("roll number");expect((await pool.query("SELECT count(*)::int AS n FROM school_people")).rows[0].n).toBe(count);
    await expect(preview({...input(),admission_number:competitor.input.admission_number.toLowerCase()})).rejects.toThrow("admission number");
  });
  it("requires current school permission at preview and commit, including after revocation",async()=>{
    await expect(people.preview(teacher,input())).rejects.toThrow("sis.manage");await expect(people.list(parent.authUser,{school_id:schoolId})).rejects.toThrow("sis.manage");
    const draft=await preview();await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);
    try{await expect(commit(draft.id)).rejects.toThrow("sis.manage");}finally{await pool.query("UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);}
  });
  it("rejects expired reviews, missing guardians, foreign classes and invalid dates",async()=>{
    const draft=await preview();await pool.query("UPDATE people_intakes SET expires_at=now()-interval '1 second' WHERE id=$1",[draft.id]);await expect(commit(draft.id)).rejects.toThrow("expired");
    await expect(preview({...input(),guardian:{mode:"existing",id:randomUUID()}})).rejects.toThrow("guardian from this school");
    await expect(preview({...input(),class_section_id:randomUUID()})).rejects.toThrow("belonging to this school");
    await expect(preview({...input(),date_of_birth:"2099-01-01"})).rejects.toThrow("Date of birth");
    await expect(preview({...input(),enrolled_on:"2000-01-01"})).rejects.toThrow("within the selected term");
  });
  it("warns about a shared phone without merging people",async()=>{
    const first=await commit((await preview()).id);const secondReview=await preview();expect(secondReview.warnings).toHaveLength(1);const second=await commit(secondReview.id);
    const rows=(await pool.query("SELECT guardian_id FROM guardian_relationships WHERE student_id=ANY($1::uuid[])",[[first,second]])).rows;expect(new Set(rows.map(r=>r.guardian_id)).size).toBe(2);
  });
  it("supports attendance events and assisted follow-up for a student and guardian without accounts",async()=>{
    const id=await commit((await preview()).id);
    await pool.query("INSERT INTO attendance_records(student_id,class_section_id,date,status,marked_by) VALUES($1,$2,$3,'absent',$4)",[id,section,today,teacher.authUser.id]);
    await db.transaction().execute(tx=>events.enqueueAttendanceUpdates(tx,{schoolId,classSectionId:section,termId:term,date:today,requestId:randomUUID(),records:[{student_id:id,status:"absent"}]}));
    const coordination=new CoordinationService(db,events);const followup=await coordination.create(teacher,{student_id:id,attendance_date:today,question:"Please clarify the absence.",due_at:new Date(Date.now()+86400000).toISOString(),idempotency_key:randomUUID()});followups.push(followup.id);
    const detail=await coordination.detail(teacher.authUser,followup.id,"staff");const guardian=detail.guardians[0] as {id:string;name:string};expect(guardian.name).toBe("Nandita Deshmukh");
    await coordination.respond(teacher,followup.id,{context:"staff",kind:"assisted_reply",body:"Guardian phoned the office to explain the absence.",guardian_id:guardian.id,channel:"phone",observed_at:new Date().toISOString(),expected_revision:1,idempotency_key:randomUUID()});
    expect((await coordination.detail(teacher.authUser,followup.id,"staff")).state).toBe("in_review");
  });
  it("rejects cross-tenant person links at the database boundary",async()=>{
    const client=await pool.connect();await client.query("BEGIN");
    try{const other=(await client.query("INSERT INTO schools(name,code) VALUES('Isolated identity test',$1) RETURNING id",[randomUUID().slice(0,20)])).rows[0];
      const person=(await client.query("INSERT INTO school_people(school_id,first_name) VALUES($1,'Other') RETURNING id",[other.id])).rows[0];
      await expect(client.query("INSERT INTO students(school_id,person_id,user_id,admission_number) VALUES($1,$2,NULL,$3)",[schoolId,person.id,randomUUID()])).rejects.toMatchObject({code:"23503"});
    }finally{await client.query("ROLLBACK");client.release();}
  });
});

async function authorityFixture(existing=false){
  const value=existing?{...input(),guardian:{mode:"existing",id:existingGuardian}}:input();
  const studentId=await commit((await preview(value)).id);
  const relationship=(await pool.query("SELECT id FROM guardian_relationships WHERE student_id=$1",[studentId])).rows[0].id as string;
  return {studentId,relationship};
}
function grant(revision=1){return {school_id:schoolId,expected_revision:revision,enabled:true,valid_from:today,valid_until:null,reason:"School verified the guardian's leave-signing authority.",verified:true as const,idempotency_key:randomUUID()};}
describe("Guardian leave-signing authority",()=>{
  it("grants account-free guardians dated authority, with scoped history and no attendance changes",async()=>{
    const {studentId,relationship}=await authorityFixture();
    expect((await authority.detail(admin.authUser,relationship,schoolId)).effective).toBe(false);
    await authority.change(admin,relationship,grant());
    const detail=await authority.detail(admin.authUser,relationship,schoolId);
    expect(detail).toMatchObject({revision:2,effective:true,source:"reviewed",valid_from:today});expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({previous:{enabled:false,revision:1},result:{enabled:true,revision:2}});
    expect((await pool.query("SELECT id FROM attendance_records WHERE student_id=$1",[studentId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM guardian_relationships WHERE id=$1",[relationship])).rows).toHaveLength(1);
  });
  it("replays concurrent retries once and rejects changed-payload keys and stale forms",async()=>{
    const {relationship}=await authorityFixture();const command=grant();
    const [a,b]=await Promise.all([authority.change(admin,relationship,command),authority.change(admin,relationship,command)]);expect(a).toEqual(b);
    expect((await authority.detail(admin.authUser,relationship,schoolId)).history).toHaveLength(1);
    await expect(authority.change(admin,relationship,{...command,reason:"Changed reason for the same command key."})).rejects.toThrow("different details");
    await expect(authority.change(admin,relationship,grant())).rejects.toThrow("Authority changed");
  });
  it("denies non-admins, wrong-school scope and authority revoked after opening",async()=>{
    const {relationship}=await authorityFixture();
    await expect(authority.change(teacher,relationship,grant())).rejects.toThrow("administrator");
    await expect(authority.detail(parent.authUser,relationship,schoolId)).rejects.toThrow("administrator");
    await expect(authority.detail(admin.authUser,relationship,randomUUID())).rejects.toThrow("administrator");
    await expect(authority.change(admin,randomUUID(),grant())).rejects.toThrow("not found");
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);
    try{await expect(authority.change(admin,relationship,grant())).rejects.toThrow("administrator");}finally{await pool.query("UPDATE school_memberships SET is_active=true WHERE school_id=$1 AND user_id=$2 AND role='admin'",[schoolId,admin.authUser.id]);}
  });
  it("checks scheduled, expired and inclusive end dates using the school's date",async()=>{
    const {relationship}=await authorityFixture();
    const dates=(await pool.query("SELECT ($1::date+1)::text AS tomorrow,($1::date-1)::text AS yesterday",[today])).rows[0];
    await authority.change(admin,relationship,{...grant(),valid_from:dates.tomorrow});
    expect((await authority.detail(admin.authUser,relationship,schoolId)).effective).toBe(false);
    await authority.change(admin,relationship,{...grant(2),valid_until:today});
    expect((await authority.detail(admin.authUser,relationship,schoolId)).effective).toBe(true);
    // Advance the evaluation date, not the system clock or stored grant.
    expect((await pool.query("SELECT guardian_may_sign_leave(g,$2::date) AS permitted FROM guardian_relationships g WHERE id=$1",[relationship,dates.tomorrow])).rows[0].permitted).toBe(false);
    await expect(authority.change(admin,relationship,{...grant(3),valid_from:dates.yesterday})).rejects.toThrow("backdated");
    await expect(authority.change(admin,relationship,{...grant(3),valid_until:dates.yesterday})).rejects.toThrow();
    await expect(authority.change(admin,relationship,{...grant(3),verified:false})).rejects.toThrow();
  });
  it("enforces revocation on real leave submissions and signing, preserving previous signatures",async()=>{
    const {studentId,relationship}=await authorityFixture(true);
    const body={student_id:studentId,category:"personal",starts_on:today,ends_on:today,reason:"Attending a family appointment with advance school notice."};
    await authority.change(admin,relationship,grant());
    const signed=await school.createLeave(parent.authUser,body,undefined,parent);leaveIds.push(signed.id);
    expect(signed.status).toBe("authorized");
    await authority.change(admin,relationship,{...grant(2),enabled:false,valid_from:null});
    const pending=await school.createLeave(parent.authUser,body,undefined,parent);leaveIds.push(pending.id);expect(pending.status).toBe("pending_guardian");
    await expect(school.performLeaveAction(parent.authUser,pending.id,"authorize","",parent)).rejects.toThrow("not authorized");
    expect((await pool.query("SELECT status FROM leave_requests WHERE id=$1",[signed.id])).rows[0].status).toBe("authorized");
    expect((await school.studentForUser(parent.authUser,studentId)).id).toBe(studentId);
    expect((await authority.detail(admin.authUser,relationship,schoolId)).history).toHaveLength(2);
  });
  it("rechecks a revoked grant while a signing command is waiting on the relationship lock",async()=>{
    const {studentId,relationship}=await authorityFixture(true);
    const pending=await school.createLeave(parent.authUser,{student_id:studentId,category:"personal",starts_on:today,ends_on:today,reason:"A parent requests leave for an appointment."},undefined,parent);leaveIds.push(pending.id);
    await authority.change(admin,relationship,grant());
    const client=await pool.connect();await client.query("BEGIN");
    try{
      await client.query("UPDATE guardian_relationships SET can_authorize_leave=false WHERE id=$1",[relationship]);
      const signing=school.performLeaveAction(parent.authUser,pending.id,"authorize","",parent);
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt++){
        waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%guardian_may_sign_leave%') AS waiting")).rows[0].waiting;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      await client.query("COMMIT");
      await expect(signing).rejects.toThrow("not authorized");
      expect(waiting).toBe(true);
    }finally{await client.query("ROLLBACK");client.release();}
    expect((await pool.query("SELECT status FROM leave_requests WHERE id=$1",[pending.id])).rows[0].status).toBe("pending_guardian");
  });
});
