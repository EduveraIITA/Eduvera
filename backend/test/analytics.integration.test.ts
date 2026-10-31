import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalyticsService } from "../src/analytics/analytics.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import type { AuthUser,AuthenticatedRequest } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { academicParticipationTestServices,fixtureTransactionDatabase } from './academic-participation.test-support.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
suite("permission-scoped analytics against PostgreSQL", () => {
  let database: DatabaseService;
  beforeAll(() => { requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL); database = new DatabaseService(); });
  afterAll(async () => { await database?.destroy(); });

  async function fixture(tx: Transaction<Database>,options:{attendance?:boolean}={}) {
    const db=fixtureTransactionDatabase(tx),shared=academicParticipationTestServices(db);
    const service=new AnalyticsService(db,shared.school);
    const school = randomUUID(), otherSchool = randomUUID(), term = randomUUID(), classA = randomUUID(), classB = randomUUID();
    const pupilA = randomUUID(), pupilB = randomUUID(), parentId = randomUUID(), subject = randomUUID(), cycle = randomUUID();
    const today = (await sql<{ date: string }>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS date`.execute(tx)).rows[0]!.date;
    await sql`INSERT INTO institution_capability_packs(code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff)
      VALUES('india_school_core','Indian school core','Test capability pack',ARRAY['school'],'Class','Student',ARRAY['English'],true) ON CONFLICT DO NOTHING`.execute(tx);
    await sql`INSERT INTO schools(id,name,code) VALUES(${school}::uuid,'Analytics test',${school.slice(0,12)}),(${otherSchool}::uuid,'Other school',${otherSchool.slice(0,12)})`.execute(tx);
    const users: Record<string, AuthUser> = {};
    for (const [name, role, member] of [["admin", "admin", "admin"], ["teacher", "staff", "staff"], ["parent", "parent", "guardian"], ["student", "student", "student"]] as const) {
      const id = randomUUID();
      users[name] = (await sql<AuthUser>`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role)
        VALUES(${id}::uuid,${id},${`${id}@example.test`},'test',${name},'Analytics',${role}) RETURNING *`.execute(tx)).rows[0]!;
      users[name].active_school_id = school;
      await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES(${school}::uuid,${id}::uuid,${member})`.execute(tx);
    }
    const admin = users.admin!, teacher = users.teacher!, parent = users.parent!, student = users.student!;
    await sql`UPDATE schools SET created_by_user_id=${admin.id}::uuid WHERE id=${school}::uuid`.execute(tx);
    const founder=(await sql<{id:string}>`INSERT INTO school_people(school_id,first_name,last_name)
      VALUES(${school}::uuid,'admin','Analytics') RETURNING id`.execute(tx)).rows[0]!;
    await shared.core.linkAccountEndpoint(tx,{school_id:school,person_id:founder.id,user_id:admin.id,actor_user_id:admin.id,
      effective_from:new Date(Date.parse(today)-101*86400000).toISOString(),effective_until:null,source_domain:'institution_onboarding',
      source_record_id:school,source_revision:1,metadata:{fixture:'explicit_analytics_founder'}});
    await sql`INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on,attendance_threshold)
      VALUES(${term}::uuid,${school}::uuid,'test-year','Current term',${today}::date-100,${today}::date+100,85)`.execute(tx);
    await sql`INSERT INTO class_sections(id,school_id,academic_year,grade,section) VALUES
      (${classA}::uuid,${school}::uuid,'test-year','7','A'),(${classB}::uuid,${school}::uuid,'test-year','7','B')`.execute(tx);
    for (const [id, cls, account] of [[pupilA, classA, student.id], [pupilB, classB, null]]) {
      const person = randomUUID();
      await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES(${person}::uuid,${school}::uuid,'Learner',${id})`.execute(tx);
      await sql`INSERT INTO students(id,school_id,person_id,user_id,admission_number) VALUES(${id}::uuid,${school}::uuid,${person}::uuid,${account}::uuid,${id!.slice(0,20)})`.execute(tx);
      await sql`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on)
        VALUES(${id}::uuid,${cls}::uuid,${term}::uuid,1,${today}::date-100)`.execute(tx);
    }
    const guardianPerson = randomUUID();
    await sql`INSERT INTO parents(id,user_id) VALUES(${parentId}::uuid,${parent.id}::uuid)`.execute(tx);
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES(${guardianPerson}::uuid,${school}::uuid,'Parent','Analytics')`.execute(tx);
    await sql`INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES(${school}::uuid,${parentId}::uuid,${guardianPerson}::uuid)`.execute(tx);
    await sql`INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship,is_primary)
      VALUES(${school}::uuid,${parentId}::uuid,${pupilA}::uuid,'guardian',true)`.execute(tx);
    const staffProfile = randomUUID();
    await sql`WITH staff_fixture_input(id,school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) AS (VALUES (${staffProfile}::uuid,${school}::uuid,${teacher.id}::uuid,'T1','Teacher','Analytics',${teacher.email},'teaching','Teacher','full_time',${today}::date-100,'active',${admin.id}::uuid,${admin.id}::uuid,gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,input.last_name,input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(id,school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) SELECT input.id::uuid,input.school_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid`.execute(tx);
    const assignment = (await sql<{ id: string }>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      SELECT ${school}::uuid,id,${staffProfile}::uuid,${classA}::uuid,${today}::date-60,'active',${admin.id}::uuid
      FROM staff_responsibility_types WHERE school_id=${school}::uuid AND code='class_teacher' RETURNING id`.execute(tx)).rows[0]!.id;
    await linkFixtureStaffIdentity(db,{school_id:school,user_id:teacher.id,owner_user_id:admin.id,teaching:true,
      effective_from:new Date(Date.parse(today)-100*86400000).toISOString()});
    await sql`INSERT INTO subjects(id,school_id,code,name,short_name) VALUES(${subject}::uuid,${school}::uuid,'MTH','Mathematics','Maths')`.execute(tx);
    const request=()=>({authUser:admin,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;
    if(options.attendance!==false) {
      await sql`INSERT INTO timetable_slots(class_section_id,term_id,weekday,period_number,starts_at,ends_at,slot_type,title)
        SELECT cls,${term}::uuid,day,1,'09:00','10:00','activity','Analytics expected participation'
        FROM unnest(ARRAY[${classA}::uuid,${classB}::uuid]) cls CROSS JOIN generate_series(1,7) day`.execute(tx);
      for(const [pupil,cls,offset,status] of [
        [pupilA,classA,5,'present'],[pupilA,classA,4,'late'],[pupilA,classA,3,'half_day'],
        [pupilA,classA,2,'absent'],[pupilA,classA,1,'excused'],[pupilA,classA,80,'absent'],[pupilB,classB,1,'present'],
      ] as const) {
        const date=new Date(Date.parse(today)-offset*86400000).toISOString().slice(0,10);
        const screen=await shared.school.teacherAttendanceScreen(admin,cls,date);
        await shared.school.saveStudentAttendance(admin,{class_section_id:cls,date,student_id:pupil,status,
          expected_revision:screen.register.revision},request());
      }
      // A future expectation has no accepted decision, especially not absence.
      await shared.bridge.prepareDailyInTransaction(tx,admin,school,classA,
        new Date(Date.parse(today)+86400000).toISOString().slice(0,10),true);
    }
    await sql`INSERT INTO assessment_cycles(id,school_id,term_id,name,code,starts_on,ends_on,created_by,updated_by)
      VALUES(${cycle}::uuid,${school}::uuid,${term}::uuid,'Term cycle','T1',${today}::date-100,${today}::date+100,${admin.id}::uuid,${admin.id}::uuid)`.execute(tx);
    async function assessment(cls: string, pupil: string, releases: Array<{ outcome: string; marks: number | null }>, assigned = false) {
      const id = randomUUID(), result = randomUUID();
      await sql`INSERT INTO assessments(id,school_id,cycle_id,class_section_id,subject_id,title,assessment_kind,maximum_marks,scheduled_at,status,created_by,updated_by)
        VALUES(${id}::uuid,${school}::uuid,${cycle}::uuid,${cls}::uuid,${subject}::uuid,${id},'class_test',20,(${today}::date-4)::timestamp AT TIME ZONE 'Asia/Kolkata',${releases.length ? 'published' : 'marking'},${admin.id}::uuid,${admin.id}::uuid)`.execute(tx);
      await sql`INSERT INTO assessment_results(id,school_id,assessment_id,student_id,outcome,marks,recorded_by,recorded_at)
        VALUES(${result}::uuid,${school}::uuid,${id}::uuid,${pupil}::uuid,'scored',1,${admin.id}::uuid,now())`.execute(tx);
      if (assigned) await sql`INSERT INTO assessment_staff_assignments(school_id,assessment_id,user_id,role,assigned_by)
        VALUES(${school}::uuid,${id}::uuid,${teacher.id}::uuid,'examiner',${admin.id}::uuid)`.execute(tx);
      for (const [index, release] of releases.entries()) {
        const pub = randomUUID();
        await sql`INSERT INTO assessment_publications(id,school_id,assessment_id,sequence,source_revision,reason,published_by)
          VALUES(${pub}::uuid,${school}::uuid,${id}::uuid,${index+1},1,'Test release',${admin.id}::uuid)`.execute(tx);
        await sql`INSERT INTO assessment_publication_results(school_id,publication_id,assessment_id,student_id,source_result_id,source_result_revision,outcome,marks)
          VALUES(${school}::uuid,${pub}::uuid,${id}::uuid,${pupil}::uuid,${result}::uuid,1,${release.outcome},${release.marks})`.execute(tx);
      }
      return id;
    }
    async function lessons() {
      await sql`DELETE FROM timetable_slots WHERE class_section_id IN (${classA}::uuid,${classB}::uuid)
        AND title='Analytics expected participation'`.execute(tx);
      const science = randomUUID();
      await sql`INSERT INTO subjects(id,school_id,code,name,short_name) VALUES(${science}::uuid,${school}::uuid,'SCI','Science','Science')`.execute(tx);
      await sql`INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at)
        SELECT cls,${term}::uuid,CASE WHEN period=1 THEN ${subject}::uuid ELSE ${science}::uuid END,day,period,
          CASE WHEN period=1 THEN '09:00'::time ELSE '10:00'::time END,CASE WHEN period=1 THEN '09:45'::time ELSE '10:45'::time END
        FROM unnest(ARRAY[${classA}::uuid,${classB}::uuid]) cls CROSS JOIN generate_series(1,7) day CROSS JOIN generate_series(1,2) period`.execute(tx);
    }
    return { service, shared, school, otherSchool, term, classA, classB, pupilA, pupilB, today, admin, adminPersonId: founder.id, teacher, parent, student, assignment, assessment, lessons };
  }

  async function isolated(test: (f: Awaited<ReturnType<typeof fixture>>, tx: Transaction<Database>) => Promise<void>,options:{attendance?:boolean}={}) {
    const rollback = new Error("rollback analytics fixture");
    try { await database.transaction().execute(async tx => { await test(await fixture(tx,options), tx); throw rollback; }); }
    catch (error) { if (error !== rollback) throw error; }
  }
  const withoutRecordedFacts=(test:Parameters<typeof isolated>[0])=>isolated(test,{attendance:false});

  it("uses exact weighted totals, date bounds and distinct class denominators", async () => isolated(async f => {
    const report = await f.service.overview(f.admin, f.school, "principal", { period: "30" });
    expect(report.attendance).toMatchObject({ present: 2, late: 1, half_day: 1, absent: 1, excused: 1, recorded: 6, denominator: 5, percentage: 70 });
    expect(report.attendance?.classes).toHaveLength(2);
    expect((await f.service.overview(f.admin, f.school, "principal", { class_id: f.classA, period: "30" })).attendance?.percentage).toBe(62.5);
    expect(report.range.to).toBe(f.today);
    expect(report.attendance?.trend.some(point => point.percentage === null)).toBe(true);
  }));

  it("counts the institute's current enrolment and staff, without treating headcount as capacity", async () => isolated(async (f, tx) => {
    await sql`INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES
      (${f.school}::uuid,'test-year','8','A'),(${f.school}::uuid,'old-year','6','A')`.execute(tx);
    for (const [kind, status, future, school] of [
      ['teaching','active',false,f.school], ['non_teaching','active',false,f.school],
      ['teaching','onboarding',false,f.school], ['teaching','inactive',false,f.school],
      ['teaching','active',true,f.school], ['teaching','active',false,f.otherSchool],
    ] as const) {
      const id = randomUUID();
      await sql`WITH staff_fixture_input(school_id,staff_code,first_name,email,staff_kind,designation,employment_type,joined_on,status,person_id) AS (VALUES (${school}::uuid,${id},'Staff',${`${id}@example.test`},${kind},'Staff','part_time',${f.today}::date+${future ? 1 : -1}::int,${status},gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,'',input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(school_id,staff_code,staff_kind,designation,employment_type,joined_on,status,person_id) SELECT input.school_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid`.execute(tx);
    }
    const report = await f.service.overview(f.admin,f.school,'principal',{ period: '30' });
    expect(report.institution).toMatchObject({ students: 2, configured_classes: 3, populated_classes: 2,
      teaching_staff: 2, non_teaching_staff: 1, students_per_teacher: 1, average_class_size: 1, as_of: f.today });
    expect(report.institution?.classes.map(row => row.students)).toEqual([1,1,0]);
    expect((await f.service.overview(f.admin,f.school,'principal',{ period: '90' })).institution).toEqual(report.institution);
    expect((await f.service.overview(f.admin,f.school,'principal',{ class_id: f.classA })).institution).toBeNull();
    await sql`UPDATE enrollments SET enrolled_on=${f.today}::date+1 WHERE student_id=${f.pupilB}::uuid`.execute(tx);
    const future = await f.service.overview(f.admin,f.school,'principal',{});
    expect(future.institution).toMatchObject({ students: 1, populated_classes: 1, students_per_teacher: 0.5 });
    await sql`UPDATE enrollments SET
      is_active=false,inactive_from=${f.today}::date,exit_kind='withdrawn',
      exit_reason='Analytics lifecycle boundary',ended_by=${f.admin.id}::uuid,ended_at=now()
      WHERE student_id=${f.pupilA}::uuid`.execute(tx);
    await sql`UPDATE staff_profiles SET status='inactive' WHERE school_id=${f.school}::uuid`.execute(tx);
    expect((await f.service.overview(f.admin,f.school,'principal',{})).institution).toMatchObject({ students: 0, populated_classes: 0, average_class_size: null, students_per_teacher: null });
  }));

  it("keeps institution KPIs out of teacher and family responses, including dual-role accounts", async () => isolated(async (f, tx) => {
    await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES(${f.school}::uuid,${f.parent.id}::uuid,'admin')`.execute(tx);
    for (const [user, portal] of [[f.teacher,'teacher'],[f.parent,'parent'],[f.student,'student']] as const) {
      const result = await f.service.overview(user,f.school,portal,portal === 'teacher' ? {} : { student_id: f.pupilA });
      expect(result.institution).toBeNull(); expect(result.registers).toBeNull();
    }
  }));

  it("counts scheduled class-days once and distinguishes missing schedules from unsubmitted registers", async () => withoutRecordedFacts(async (f, tx) => {
    const empty = await f.service.overview(f.admin,f.school,'principal',{ period: '30' });
    expect(empty.registers).toMatchObject({ expected: 0, outstanding: 0, percentage: null, unscheduled_classes: 2 });
    await f.lessons();
    await sql`UPDATE academic_terms SET starts_on=${f.today}::date-4 WHERE id=${f.term}::uuid`.execute(tx);
    await sql`UPDATE enrollments SET enrolled_on=${f.today}::date-2 WHERE student_id=${f.pupilB}::uuid`.execute(tx);
    await sql`INSERT INTO school_calendar_days(school_id,date,label,is_instructional)
      VALUES(${f.school}::uuid,${f.today}::date-1,'Closure',false)`.execute(tx);
    // Five dates: A 5 + B 3; closure removes two -> six expected class-days.
    // Multiple lessons in one day must not produce multiple registers.
    const req=()=>({authUser:f.admin,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;
    for(const [classId,offset] of [[f.classA,4],[f.classB,2]] as const) {
      const date=new Date(Date.parse(f.today)-offset*86400000).toISOString().slice(0,10);
      const screen=await f.shared.school.teacherAttendanceScreen(f.admin,classId,date);
      await f.shared.school.saveTeacherAttendance(f.admin,{class_section_id:classId,date,expected_revision:screen.register.revision,
        records:screen.roster.map(person=>({student_id:person.id,status:'present'}))},req());
      if(classId===f.classB)await f.shared.school.setAttendanceRegisterLock(f.admin,classId,true,{date},req());
    }
    const nextDate=new Date(Date.parse(f.today)+86400000).toISOString().slice(0,10);
    const future=await f.shared.bridge.prepareDailyInTransaction(tx,f.admin,f.school,f.classB,nextDate,true);
    expect((await f.shared.kernel.detail(f.admin,f.school,future.register_id,tx)).counts.recorded).toBe(0);
    const report = await f.service.overview(f.admin,f.school,'principal',{ period: '30' });
    expect(report.registers).toMatchObject({ expected: 6, submitted: 1, locked: 1, outstanding: 4, percentage: 33.33, unscheduled_classes: 0 });
    expect(report.registers?.classes.map(row => row.expected)).toEqual([4,2]);
    expect(report.registers?.classes[0]?.latest_unsubmitted).toBe(f.today);
    expect((await f.service.overview(f.admin,f.school,'principal',{ class_id: f.classB })).registers)
      .toMatchObject({ expected: 2, locked: 1, outstanding: 1, percentage: 50 });
    // A published cancellation supersedes the baseline, but an activity still
    // requires a register even without a subject, matching attendanceDayPolicy.
    const plan = randomUUID();
    await sql`INSERT INTO day_plans(id,school_id,class_section_id,term_id,date,owner_id)
      VALUES(${plan}::uuid,${f.school}::uuid,${f.classA}::uuid,${f.term}::uuid,${f.today}::date,${f.admin.id}::uuid)`.execute(tx);
    await sql`INSERT INTO day_plan_versions(school_id,plan_id,version,state,created_by,published_revision)
      VALUES(${f.school}::uuid,${plan}::uuid,1,'published',${f.admin.id}::uuid,1)`.execute(tx);
    await sql`INSERT INTO day_plan_periods(school_id,plan_id,version,period_number,starts_at,ends_at,title,slot_type,cancelled)
      VALUES(${f.school}::uuid,${plan}::uuid,1,1,'09:00','10:00','Activity','activity',true)`.execute(tx);
    await sql`UPDATE day_plans SET published_version=1 WHERE id=${plan}::uuid`.execute(tx);
    expect((await f.service.overview(f.admin,f.school,'principal',{})).registers?.expected).toBe(5);
    await sql`UPDATE day_plan_periods SET cancelled=false WHERE plan_id=${plan}::uuid`.execute(tx);
    await f.shared.school.setAttendanceRegisterLock(f.admin,f.classB,false,
      {date:new Date(Date.parse(f.today)-2*86400000).toISOString().slice(0,10),reason:'Reopened the accepted fixture for review'},req());
    expect((await f.service.overview(f.admin,f.school,'principal',{})).registers)
      .toMatchObject({ expected: 6, submitted: 2, locked: 0, outstanding: 4, percentage: 33.33 });
  }));

  it("restricts teachers to currently authorized classes AND the assignment's historical dates", async () => isolated(async (f, tx) => {
    const report = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(report.attendance).toMatchObject({ recorded: 5, percentage: 62.5 });
    expect(report.classes.map(cls => cls.id)).toEqual([f.classA]);
    expect(report.assessments).toBeNull();
    await expect(f.service.overview(f.teacher, f.school, "teacher", { class_id: f.classB })).rejects.toThrow(/not available/);
    await sql`UPDATE staff_responsibility_assignments SET status='revoked',revoked_at=now(),revocation_reason='Access ended' WHERE id=${f.assignment}::uuid`.execute(tx);
    const revoked = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(revoked.attendance).toBeNull(); expect(revoked.classes).toEqual([]);
  }));

  it("keeps parent/student/teacher/admin contexts and tenants separate", async () => isolated(async (f, tx) => {
    for (const portal of ["principal", "teacher", "student"]) await expect(f.service.overview(f.parent, f.school, portal, {})).rejects.toThrow(/Active access/);
    await expect(f.service.overview(f.admin, f.otherSchool, "principal", {})).rejects.toThrow(/Select this institution/);
    await expect(f.service.overview({ ...f.admin, active_school_id: null }, f.otherSchool, "principal", {})).rejects.toThrow(/Active access/);
    await expect(f.service.overview(f.parent, f.school, "parent", { student_id: f.pupilB })).rejects.toThrow();
    await expect(f.service.overview(f.student, f.school, "student", { student_id: f.pupilB })).rejects.toThrow();
    // An admin+guardian still cannot use the guardian endpoint for unlinked pupils.
    await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES(${f.school}::uuid,${f.parent.id}::uuid,'admin')`.execute(tx);
    await expect(f.service.overview(f.parent, f.school, "parent", { student_id: f.pupilB })).rejects.toThrow(/family view/);
    const family = await f.service.overview(f.parent, f.school, "parent", { student_id: f.pupilA, period: "30" });
    expect(family.attendance?.recorded).toBe(5); expect(family.attendance?.classes).toEqual([]); expect(family.classes).toEqual([]);
    expect((await f.service.overview(f.student, f.school, "student", { period: "30" })).student?.id).toBe(f.pupilA);
  }));

  it("opens an administrator's assigned Insights using only the exact analytical appointment", async () => withoutRecordedFacts(async (f, tx) => {
    const assigned = await f.assessment(f.classA, f.pupilA, [{ outcome: "scored", marks: 15 }], true);
    await sql`UPDATE assessment_staff_assignments SET user_id=${f.admin.id}::uuid WHERE assessment_id=${assigned}::uuid`.execute(tx);
    await f.assessment(f.classB, f.pupilB, [{ outcome: "scored", marks: 20 }]);
    const report = await f.service.overview(f.admin, f.school, "teacher", {});
    expect(report).toMatchObject({ portal: "teacher", attendance: null, institution: null, registers: null });
    expect(report.classes.map(item => item.id)).toEqual([f.classA]);
    expect(report.assessments?.overall).toMatchObject({ scored: 1, average: 75 });
    expect(report.assessments?.classes.map(item => item.id)).toEqual([f.classA]);
    await expect(f.service.overview(f.admin, f.school, "teacher", { class_id: f.classB })).rejects.toThrow(/not available/);
    await expect(f.service.overview(f.admin, f.school, "teacher", { student_id: f.pupilB })).rejects.toThrow(/filter is not available/);
    await sql`DELETE FROM assessment_staff_assignments WHERE assessment_id=${assigned}::uuid`.execute(tx);
    expect(await f.service.overview(f.admin, f.school, "teacher", {})).toMatchObject({ classes: [], attendance: null, assessments: null, institution: null, registers: null });
  }));

  it("bounds an administrator's assigned attendance by class, historical dates and current expiry", async () => isolated(async (f, tx) => {
    const profile = randomUUID();
    await sql`INSERT INTO staff_profiles(id,school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id)
      VALUES(${profile}::uuid,${f.school}::uuid,${f.admin.id}::uuid,${profile},'teaching','Director','full_time',${f.today}::date-100,'active',${f.admin.id}::uuid,${f.admin.id}::uuid,${f.adminPersonId}::uuid)`.execute(tx);
    const appointment = (await sql<{ id: string }>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      SELECT ${f.school}::uuid,id,${profile}::uuid,${f.classA}::uuid,${f.today}::date-3,'active',${f.admin.id}::uuid
      FROM staff_responsibility_types WHERE school_id=${f.school}::uuid AND code='class_teacher' RETURNING id`.execute(tx)).rows[0]!.id;
    const report = await f.service.overview(f.admin, f.school, "teacher", { period: "30" });
    expect(report.classes.map(item => item.id)).toEqual([f.classA]);
    expect(report.attendance).toMatchObject({ recorded: 3, half_day: 1, absent: 1, excused: 1, percentage: 25 });
    expect(report.attendance?.classes.map(item => item.id)).toEqual([f.classA]);
    expect(report.institution).toBeNull(); expect(report.registers).toBeNull(); expect(report.assessments).toBeNull();
    await expect(f.service.overview(f.admin, f.school, "teacher", { class_id: f.classB })).rejects.toThrow(/not available/);
    await sql`UPDATE staff_responsibility_assignments SET ends_on=${f.today}::date-1 WHERE id=${appointment}::uuid`.execute(tx);
    expect(await f.service.overview(f.admin, f.school, "teacher", {})).toMatchObject({ classes: [], attendance: null, assessments: null, institution: null, registers: null });
    // The separate administrator audience still has its own institution grant;
    // expiring a class duty does not turn My work into that broader report.
    expect((await f.service.overview(f.admin, f.school, "principal", { period: "30" })).attendance?.recorded).toBe(6);
  }));

  it("reads latest publication only, omits private marks, and excludes non-scored outcomes", async () => isolated(async f => {
    await f.assessment(f.classA, f.pupilA, [{ outcome: "scored", marks: 10 }, { outcome: "scored", marks: 16 }], true);
    await f.assessment(f.classA, f.pupilA, [{ outcome: "absent", marks: null }], true);
    await f.assessment(f.classA, f.pupilA, [], true);
    await f.assessment(f.classB, f.pupilB, [{ outcome: "scored", marks: 20 }]);
    const teacher = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(teacher.assessments?.subjects).toEqual([expect.objectContaining({ average: 80, scored: 1, other: 1, assessments: 2 })]);
    expect(teacher.assessments?.pipeline).toEqual([{ status: "marking", count: 1 }, { status: "published", count: 2 }]);
    const family = await f.service.overview(f.parent, f.school, "parent", { student_id: f.pupilA });
    expect(family.assessments?.subjects[0]?.average).toBe(80); expect(family.assessments?.pipeline).toEqual([]);
    expect(family.assessments?.overall).toMatchObject({ average: 80, scored: 1 });
    expect(family.assessments?.classes).toEqual([]);
    const institution = await f.service.overview(f.admin, f.school, "principal", {});
    expect(institution.assessments?.overall).toMatchObject({ average: 90, scored: 2 });
    expect(institution.assessments?.classes.map(row => row.average)).toEqual([80,100]);
    await f.assessment(f.classA, f.pupilA, [{ outcome: "scored", marks: 0 }]);
    const weighted = await f.service.overview(f.admin, f.school, "principal", {});
    expect(weighted.assessments?.overall).toMatchObject({ average: 60, scored: 3 });
    expect(weighted.assessments?.overall.distribution).toEqual([1,0,0,0,2]);
    expect(weighted.assessments?.subjects[0]?.average).toBe(60);
    expect(weighted.assessments?.classes.map(row => row.average)).toEqual([40,100]);
    expect(JSON.stringify(teacher.assessments)).not.toMatch(/student_id|feedback|source_result/);
  }));

  it("rejects malformed filters and gives null rather than a fabricated zero", async () => withoutRecordedFacts(async (f) => {
    await expect(f.service.overview(f.admin, f.school, "principal", { period: "36500" })).rejects.toThrow();
    await expect(f.service.overview(f.admin, f.school, "principal", { class_id: "bad" })).rejects.toThrow();
    await expect(f.service.overview(f.teacher, f.school, "teacher", { student_id: f.pupilA })).rejects.toThrow(/filter/);
    const report = await f.service.overview(f.admin, f.school, "principal", {});
    expect(report.attendance?.percentage).toBeNull();
    expect(report.attendance?.classes.every(cls => cls.percentage === null)).toBe(true);
    expect(report.assessments?.subjects).toEqual([]);
    expect(report.assessments?.overall.average).toBeNull();
    expect(report.attendance?.subjects).toEqual([]);
  }));

  it('serves bounded principal learner analytics with published results and honest denominators',async()=>isolated(async f=>{
    await f.assessment(f.classA,f.pupilA,[{outcome:'scored',marks:10},{outcome:'scored',marks:16}]);
    const report=await f.service.principalReport(f.admin,f.school,{student:f.pupilA,period:'30',limit:1});
    expect(report.status).toBe('ready');
    if(report.status!=='ready')throw new Error('Missing report');
    expect(report.attendance).toMatchObject({percentage:62.5,attended:2.5,denominator:4,excused:1});
    expect(report.results?.overall).toMatchObject({average:80,scored:1});
    expect(report).not.toHaveProperty('institution');expect(report).not.toHaveProperty('registers');
    expect(JSON.stringify(report)).not.toMatch(/password|phone|email|date_of_birth|feedback/);
    const verify=await f.service.overview(f.admin,f.school,'principal',{student_id:f.pupilA,period:'30'});
    expect(verify.attendance?.percentage).toBe(report.attendance?.percentage);expect(verify.assessments?.overall.average).toBe(80);
    expect(verify.institution).toBeNull();expect(verify.registers).toBeNull();
  }));

  it('clarifies ambiguous names and classes, scopes every lookup, and validates pagination',async()=>isolated(async(f,tx)=>{
    expect(await f.service.principalReport(f.admin,f.school,{student:'Learner'})).toMatchObject({status:'choose_student',has_more:false});
    const scoped=await f.service.principalReport(f.admin,f.school,{student:'Learner',class_name:'7A',topic:'attendance'});
    expect(scoped.status).toBe('ready');expect(scoped).not.toHaveProperty('results');
    expect(await f.service.principalReport(f.admin,f.school,{class_name:'99Z'})).toMatchObject({status:'choose_class'});
    for(const who of [f.parent,f.student,f.teacher])await expect(f.service.principalReport(who,f.school,{})).rejects.toThrow(/principal/);
    await expect(f.service.principalReport(f.admin,f.otherSchool,{})).rejects.toThrow(/principal/);
    await expect(f.service.principalReport(f.admin,f.school,{school_id:f.otherSchool})).rejects.toThrow();
    await expect(f.service.principalReport(f.admin,f.school,{limit:1000})).rejects.toThrow();
    await expect(f.service.overview(f.admin,f.school,'principal',{student_id:randomUUID()})).rejects.toThrow(/not available/);
    const page=await f.service.principalReport(f.admin,f.school,{topic:'attendance',group_by:'class',limit:1,offset:1,period:'30'});
    if(page.status!=='ready')throw new Error('Missing report');
    expect(page.attendance?.comparison).toMatchObject({total:2,offset:1,limit:1,has_more:false});
    expect(page.attendance?.comparison.items).toHaveLength(1);
    await sql`UPDATE school_memberships SET is_active=false WHERE user_id=${f.admin.id}::uuid`.execute(tx);
    await expect(f.service.principalReport(f.admin,f.school,{})).rejects.toThrow(/principal/);
  }));

  it("removes assessment aggregates immediately when the resource assignment ends", async () => isolated(async (f, tx) => {
    const assessment = await f.assessment(f.classA, f.pupilA, [{ outcome: "withheld", marks: null }], true);
    const before = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(before.assessments?.subjects[0]).toMatchObject({ scored: 0, other: 1, average: null });
    await sql`DELETE FROM assessment_staff_assignments WHERE assessment_id=${assessment}::uuid`.execute(tx);
    const after = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(after.assessments).toBeNull();
    expect(after.attendance?.recorded).toBe(5);
  }));

  it("projects subject attendance from effective lessons, with distinct denominators and scoped date access", async () => isolated(async (f, tx) => {
    await f.lessons();
    const admin = await f.service.overview(f.admin, f.school, "principal", { period: "30" });
    expect(admin.attendance?.subjects).toEqual([
      expect.objectContaining({ name: "Mathematics", held: 6, attended: 4, excused: 1, counted: 5, percentage: 80 }),
      expect.objectContaining({ name: "Science", held: 6, attended: 3, excused: 1, counted: 5, percentage: 60 }),
    ]);
    const teacher = await f.service.overview(f.teacher, f.school, "teacher", {});
    expect(teacher.attendance?.subjects.map(row => row.percentage)).toEqual([75,50]);
    const family = await f.service.overview(f.parent, f.school, "parent", { period: "30" });
    expect(family.attendance?.subjects.map(row => row.percentage)).toEqual([75,50]);
    const filtered = await f.service.overview(f.admin, f.school, "principal", { period: "30", class_id: f.classB });
    expect(filtered.attendance?.subjects.map(row => row.percentage)).toEqual([100,100]);
    await sql`INSERT INTO school_calendar_days(school_id,date,label,is_instructional)
      VALUES(${f.school}::uuid,${f.today}::date-5,'Holiday',false)`.execute(tx);
    const holiday = await f.service.overview(f.parent, f.school, "parent", { period: "30" });
    expect(holiday.attendance?.subjects.map(row => row.held)).toEqual([4,4]);
    await sql`UPDATE staff_responsibility_assignments SET status='revoked',revoked_at=now(),revocation_reason='Access ended' WHERE id=${f.assignment}::uuid`.execute(tx);
    expect((await f.service.overview(f.teacher, f.school, "teacher", {})).attendance).toBeNull();
  }));

  it('preserves an original historical checkout through import without inventing its unknown signer or observation time',async()=>withoutRecordedFacts(async(f,tx)=>{
    await f.lessons();
    const date=new Date(Date.parse(f.today)-3*86400000).toISOString().slice(0,10);
    // Controlled PRE-cutover source fixture, never an application write path.
    // Restore its immutable guard before calling the actual import bridge.
    await sql`ALTER TABLE attendance_records_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
    const original=(await sql<{id:string}>`INSERT INTO attendance_records_legacy_source(student_id,class_section_id,date,status,check_out_at,marked_by)
      VALUES(${f.pupilA}::uuid,${f.classA}::uuid,${date}::date,'half_day',(${date}::date+'10:45'::time) AT TIME ZONE 'Asia/Kolkata',NULL)
      RETURNING id`.execute(tx)).rows[0]!;
    await sql`ALTER TABLE attendance_records_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
    const imported=await f.shared.bridge.prepareDailyInTransaction(tx,f.admin,f.school,f.classA,date,true);
    expect((await sql`SELECT id,status,observed_at,recorded_by FROM activity_attendance_entries
      WHERE register_id=${imported.register_id}::uuid`.execute(tx)).rows)
      .toEqual([{id:original.id,status:'half_day',observed_at:null,recorded_by:null}]);
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations
      WHERE school_id=${f.school}::uuid`.execute(tx)).rows[0]!.count).toBe(0);
    const checkout=await f.service.overview(f.parent,f.school,'parent',{period:'30'});
    expect(checkout.attendance?.subjects.map(row=>row.percentage)).toEqual([100,100]);
  }));
});
