import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createAcademicOfferingFixture, publishAcademicOfferingAssessment, academicRequest } from "./academic-offering-cycle.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/academic_cycle_unused_test", max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const bands = [
  {code:"F",label:"Fail",minimum_percentage:0,maximum_percentage:49.99,passed:false},
  {code:"C",label:"Pass",minimum_percentage:50,maximum_percentage:69.99,passed:true},
  {code:"B",label:"Very good",minimum_percentage:70,maximum_percentage:79.99,passed:true},
  {code:"A",label:"Excellent",minimum_percentage:80,maximum_percentage:100,passed:true},
];

describe.runIf(enabled)("canonical-person college learning cycle through actual domain owners", () => {
  it("carries nonzero parallel/elective enrollments through teaching, attendance, moderated results and all configured report formats", async () => {
    const f = await createAcademicOfferingFixture(db);
    await f.run(async () => {
      const planInput = { idempotency_key:randomUUID(), title:"Distributed Data Systems studio", purpose:"teaching",
        timezone:"UTC", starts_on:f.date(2), ends_on:f.date(2), recurrence:"once", starts_at:"08:00", ends_at:"09:00", offering_id:f.source.id,
        lead_person_id:f.instructor.id, recorder_person_id:f.coordinator_person_id, reviewer_person_id:f.coordinator_person_id, attendance_mode:"roll_call", location_kind:"online", location_label:"Course video studio" };
      await expect(f.planning.create(academicRequest(f.owner),f.schoolId,{...planInput,idempotency_key:randomUUID(),timezone:"Asia/Kolkata"})).rejects.toThrow("campus timezone");
      const plan = await f.planning.create(academicRequest(f.owner), f.schoolId, planInput);
      await f.planning.publish(academicRequest(f.owner),f.schoolId,plan.id,{idempotency_key:randomUUID(),expected_revision:plan.revision});
      const expected = await f.planning.listOccurrences(f.learner.actor,f.schoolId,{from:f.date(2),until:f.date(2)});
      expect(expected.items).toHaveLength(1);
      const occurrence = expected.items[0]!;
      const teaching = await f.teaching.openExpected(f.instructor.actor,f.date(2),{occurrence_id:occurrence.id});
      expect(teaching.source_record_id).toBe(plan.id);
      const registerId = await f.attendance.ensureRegister(f.schoolId,occurrence.id);
      const roster = (await sql<{person_id:string;source_kind:string}>`SELECT person_id,source_kind FROM activity_attendance_roster WHERE school_id=${f.schoolId}::uuid AND register_id=${registerId}::uuid ORDER BY person_id`.execute(db)).rows;
      expect(roster.map(row=>row.person_id)).toEqual([f.learner.id,f.secondLearner.id].sort());
      expect(roster.every(row=>row.source_kind==="learning_offering")).toBe(true);
      await f.runAt(`${f.date(2)}T08:30:00.000Z`,async()=>{
        await f.attendance.marks(f.owner,f.schoolId,registerId,{expected_revision:0,records:roster.map(row=>({person_id:row.person_id,status:"present"}))},academicRequest(f.owner));
        const session=await f.teaching.resolve(db,f.instructor.actor,teaching.id,f.date(2),true);
        await f.teachingSessions.save(f.instructor.actor,teaching.id,f.date(2),{command_id:randomUUID(),expected_revision:0,source_fingerprint:session.source.source_fingerprint,
          state:"reported",topic:"Distributed transactions and partition tolerance",preparation:"Compare two-phase commit with quorum replication.",learner_notes:"Read the quorum consistency exercise before the next studio."});
        const shared=await f.teachingSessions.detail(f.learner.actor,teaching.id,f.date(2));expect(shared.lesson.topic).toBe("Distributed transactions and partition tolerance");expect(shared.lesson).not.toHaveProperty("preparation");
      });
      const published: Array<Awaited<ReturnType<typeof publishAcademicOfferingAssessment>>> = [];
      for(const [index,id] of [f.source.id,f.destination.id,f.parallel.id].entries()) published.push(await publishAcademicOfferingAssessment(db,f,id,{marks:[80,70,90][index]!}));
      const records = await db.selectFrom("assessment_results").select(["person_id","learner_id","student_id"]).where("school_id","=",f.schoolId).execute();
      expect(records).toHaveLength(5);expect(records.every(row=>row.student_id===null&&row.person_id===row.learner_id)).toBe(true);
      const reports: string[] = [];
      for(const format of ["percentage","grade","gpa"] as const){
        const policy = await f.reports.createPolicy(f.owner,f.schoolId,{name:`Semester ${format} policy`,code:`COURSE-${format}`,idempotency_key:randomUUID(),configuration:{
          schema_version:1,result_format:format,grade_point_scale:format==="gpa"?10:null,aggregation:format==="gpa"?"credit_weighted":"equal",decimal_places:2,
          absence_treatment:"incomplete",exemption_treatment:"exclude",gpa_failure_treatment:"include",bands:bands.map((band,index)=>({...band,grade_points:format==="gpa"?[0,6,8,10][index]:null}))}});
        await f.reports.activatePolicy(f.owner,f.schoolId,policy.id,{expected_revision:policy.revision,note:"Reviewed institution grading policy",idempotency_key:randomUUID()});
        let scheme = await f.reports.createScheme(f.owner,f.schoolId,{context_kind:"learning_offering",offering_ids:[f.source.id,f.destination.id,f.parallel.id],term_id:f.termId,
          name:`Semester I ${format}`,code:`SEM1-${format}`,grading_policy_id:policy.id,programme_key:format==="gpa"?"MTECH-DATA-ENGINEERING":null,
          term_index:format==="gpa"?1:null,review_mode:"owner_review",idempotency_key:randomUUID()});
        for(const [index,offeringId] of [f.source.id,f.destination.id,f.parallel.id].entries()){
          const course=f.courses.find(row=>row.id===offeringId)!;
          scheme=await f.reports.saveSubjectPlan(f.owner,f.schoolId,scheme.id,{offering_id:offeringId,subject_id:course.subject_id,course_code:course.course_code,credits:Number(course.credits),
            expected_revision:scheme.revision,idempotency_key:randomUUID(),components:[{code:"PORT",name:"Course portfolio",weight_percentage:100,assessment_ids:[published[index]!.id]}]});
          if(index===0)await expect(f.reports.activateScheme(f.owner,f.schoolId,scheme.id,{expected_revision:scheme.revision,idempotency_key:randomUUID()})).rejects.toThrow("every selected course");
        }
        const active=await f.reports.activateScheme(f.owner,f.schoolId,scheme.id,{expected_revision:scheme.revision,idempotency_key:randomUUID()});
        const batch=await f.reports.generateReport(f.owner,f.schoolId,scheme.id,{expected_revision:active.revision,idempotency_key:randomUUID()});
        const rows=await db.selectFrom("grading_report_students").selectAll().where("batch_id","=",batch.id).orderBy("person_id").execute();
        expect(rows).toHaveLength(2);const learner=rows.find(row=>row.person_id===f.learner.id)!;
        expect(learner.student_id).toBeNull();expect(learner.outcome).toBe("complete");
        expect(Number(format==="gpa"?learner.gpa:learner.overall_percentage)).toBe(format==="gpa"?10:85);
        const subjects=await db.selectFrom("grading_report_subjects").select("id").where("report_student_id","=",learner.id).execute();expect(subjects).toHaveLength(2);
        const reviewed=await f.reports.batchAction(f.owner,f.schoolId,batch.id,"review",{expected_revision:batch.revision,note:"All course components and elective exclusions checked.",idempotency_key:randomUUID()});
        await f.reports.batchAction(f.owner,f.schoolId,batch.id,"publish",{expected_revision:reviewed.revision,note:"Publish reviewed semester results.",idempotency_key:randomUUID()});reports.push(batch.id);
      }
      const own=await f.reports.ownReports(f.learner.actor,f.schoolId,f.learner.id);expect(own.reports).toHaveLength(3);
      await expect(f.reports.ownReports(f.learner.actor,f.schoolId,f.secondLearner.id)).rejects.toThrow();
      const result=await f.assessments.ownResults(f.learner.actor,f.schoolId,f.learner.id);expect(result.results).toHaveLength(2);
      expect((await sql<{students:number;classes:number;staff:number}>`SELECT (SELECT count(*)::int FROM students WHERE school_id=${f.schoolId}::uuid) AS students,
        (SELECT count(*)::int FROM class_sections WHERE school_id=${f.schoolId}::uuid) AS classes,(SELECT count(*)::int FROM staff_profiles WHERE school_id=${f.schoolId}::uuid) AS staff`.execute(db)).rows[0]).toEqual({students:0,classes:0,staff:0});
      expect(reports).toHaveLength(3);
      const course=f.courses.find(row=>row.id===f.source.id)!;
      const retained=await f.offerings.create(f.owner,{offering_id:randomUUID(),command_id:randomUUID(),name:"Retained cancelled course studio",instructor:f.reference(f.instructor.person),
        participants:[f.reference(f.learner.person)],starts_on:f.today,academic_context:{term_id:f.termId,subject_id:course.subject_id,course_code:"RETAINED-STUDIO",credits:1,programme_key:"MTECH-DATA-ENGINEERING"}});
      expect((await f.offerings.detail(f.owner,retained.id)).enrollment_change_mode).toBe("initial_setup");
      const draft=await f.planning.create(academicRequest(f.owner),f.schoolId,{idempotency_key:randomUUID(),title:"Retained course timetable",purpose:"teaching",timezone:"UTC",
        starts_on:f.date(4),ends_on:f.date(4),recurrence:"once",starts_at:"12:00",ends_at:"13:00",offering_id:retained.id,lead_person_id:f.instructor.id,attendance_mode:"none",location_kind:"online",location_label:"Course studio"});
      const scheduled=await f.planning.publish(academicRequest(f.owner),f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:draft.revision});
      await f.planning.cancel(academicRequest(f.owner),f.schoolId,scheduled.id,{idempotency_key:randomUUID(),expected_revision:scheduled.revision,reason:"Cancel this future teaching expectation while retaining its publication."});
      expect((await f.offerings.detail(f.owner,retained.id)).enrollment_change_mode).toBe("reviewed_change");
      await expect(f.offerings.configureAcademicContext(f.owner,retained.id,{command_id:randomUUID(),expected_revision:retained.revision,
        academic_context:{term_id:f.termId,subject_id:course.subject_id,course_code:"REBOUND",credits:2,programme_key:"MTECH-DATA-ENGINEERING"}})).rejects.toThrow("already used");
      await expect(db.updateTable("learning_offering_academic_contexts").set({credits:"2"}).where("school_id","=",f.schoolId).where("offering_id","=",retained.id).execute()).rejects.toThrow("used course context");
    });
  },120000);

  it("retains exact accepted assessment intent, dated frozen membership and current authority after a lost response",async()=>{
    const f=await createAcademicOfferingFixture(db);
    await f.run(async()=>{
      expect(await f.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:false,can_plan_course:true});
      const published=await publishAcademicOfferingAssessment(db,f,f.source.id,{marks:0});
      expect(await f.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:true,can_plan_course:true});
      expect(await f.assessments.discovery(f.learner.actor,f.schoolId)).toEqual({has_assigned:false,can_plan_course:false});
      await expect(f.assessments.discovery({...f.instructor.actor,active_school_id:randomUUID()},f.schoolId)).rejects.toThrow("Choose this institution");
      const replay=await f.assessments.createAssessment(f.instructor.actor,f.schoolId,published.input);expect(replay).toMatchObject({id:published.id,replayed:true,status:"draft"});
      const calendar=await f.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1",f.learner.id);
      expect(calendar.items).toHaveLength(1);expect(calendar.items[0]).toMatchObject({id:published.id,context_kind:"learning_offering",offering_id:f.source.id});
      expect(calendar.items[0]).not.toHaveProperty("instructions");expect(calendar.items[0]).not.toHaveProperty("marks");
      await expect(f.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1",f.secondLearner.id)).rejects.toThrow("does not belong");
      await expect(f.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2))).rejects.toThrow("staff access");

      await expect(f.assessments.createAssessment(f.instructor.actor,f.schoolId,{...published.input,title:"Different intent"})).rejects.toThrow("different assessment");
      const before=await db.selectFrom("assessment_publication_results").selectAll().where("assessment_id","=",published.id).execute();expect(before).toHaveLength(2);expect(before.every(row=>Number(row.marks)===0)).toBe(true);
      const detail=await f.offerings.detail(f.owner,f.source.id);
      await expect(f.offerings.endEnrollment(f.owner,f.source.id,detail.enrollments[0]!.id,{command_id:randomUUID(),expected_revision:detail.enrollments[0]!.revision,reason:"An operating course requires reviewed elective change."})).rejects.toThrow();
      expect(await db.selectFrom("assessment_publication_results").selectAll().where("assessment_id","=",published.id).execute()).toEqual(before);
      const assessment=await db.selectFrom("assessments").select("revision").where("id","=",published.id).executeTakeFirstOrThrow();
      const row=await db.selectFrom("assessment_results").selectAll().where("assessment_id","=",published.id).where("person_id","=",f.learner.id).executeTakeFirstOrThrow();
      const correction=await f.assessments.recordResults(f.instructor.actor,f.schoolId,published.id,{expected_assessment_revision:assessment.revision,
        results:[{result_id:row.id,outcome:"scored",marks:5,expected_revision:row.revision,reason:"Corrected transcription against the retained portfolio."}]});
      const submitted=await f.assessments.action(f.instructor.actor,f.schoolId,published.id,"submit",{expected_revision:correction.revision,note:"Reviewed correction",idempotency_key:randomUUID()});
      const moderated=await f.assessments.action(f.owner,f.schoolId,published.id,"approve",{expected_revision:submitted.revision,note:"Independent correction checked",idempotency_key:randomUUID()});
      await f.assessments.action(f.owner,f.schoolId,published.id,"publish",{expected_revision:moderated.revision,note:"Release corrected result",idempotency_key:randomUUID()});
      expect(await db.selectFrom("assessment_publication_results").selectAll().where("publication_id","=",before[0]!.publication_id).execute()).toEqual(before);
      const own=await f.assessments.ownResults(f.learner.actor,f.schoolId,f.learner.id);expect(own.results[0]).toMatchObject({sequence:2,marks:"5.00",academic_context:{schema_version:2,offering_id:f.source.id}});
      // A teaching appointment alone does not grant first-test creation.
      await sql`UPDATE school_access_exceptions SET status='revoked',revoked_at=${f.now}::timestamptz,revoked_by=${f.owner.id}::uuid,
        revocation_reason='End this bounded course assessment recording permission.',revision=revision+1 WHERE school_id=${f.schoolId}::uuid
        AND user_id=${f.instructor.actor.id}::uuid AND permission='assessments.mark'`.execute(db);
      // The accepted examiner role independently retains mark authority after
      // its original manual exception ends; do not hide valid alternate proof.
      expect(await f.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:true,can_plan_course:true});
      await db.updateTable("staff_responsibility_types").set({is_active:false}).where("school_id","=",f.schoolId).where("code","=","internal_examiner").execute();
      expect(await f.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:false,can_plan_course:false});
      const workspace=await f.assessments.workspace(f.instructor.actor,f.schoolId,"offering_v1");expect(workspace.assessments).toEqual([]);
      expect((await f.assessments.calendar(f.instructor.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1")).items).toEqual([]);
      await expect(f.assessments.detail(f.instructor.actor,f.schoolId,published.id)).rejects.toThrow("role does not allow this action on this assessment");
      expect((await sql<{allowed:boolean}>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'assessment.updated',${JSON.stringify({assessment_id:published.id,action:"results-recorded"})}::jsonb,${f.instructor.actor.id}::uuid) AS allowed`.execute(db)).rows[0]!.allowed).toBe(false);
      await db.updateTable("school_memberships").set({is_active:false}).where("school_id","=",f.schoolId).where("user_id","=",f.instructor.actor.id).execute();
      expect(await f.assessments.discovery(f.instructor.actor,f.schoolId)).toEqual({has_assigned:false,can_plan_course:false});
      await expect(f.assessments.createAssessment(f.instructor.actor,f.schoolId,published.input)).rejects.toThrow();
      await db.updateTable("school_memberships").set({is_active:false}).where("school_id","=",f.schoolId).where("user_id","=",f.learner.actor.id).execute();
      await expect(f.assessments.calendar(f.learner.actor,f.schoolId,f.date(2),f.date(2),undefined,"offering_v1",f.learner.id)).rejects.toThrow("currently linked");
    });
  },120000);

  it("freezes current term enrollment eligibility, makes a late elective's missing whole publication incomplete and excludes an early withdrawn course without marks",async()=>{
    const f=await createAcademicOfferingFixture(db),foreign=await createAcademicOfferingFixture(db);
    await expect(f.service.options(f.owner,foreign.source.id,foreign.learner.id)).rejects.toThrow("Open one current academic elective enrollment");
    await expect(f.service.options({...f.owner,active_school_id:foreign.schoolId},foreign.source.id,foreign.learner.id)).rejects.toThrow();
    const destinationName=f.options.destinations.find(row=>row.id===f.destination.id)!.name;
    const destination=await f.run(()=>publishAcademicOfferingAssessment(db,f,f.destination.id,{marks:80}));
    const parallel=await f.run(()=>publishAcademicOfferingAssessment(db,f,f.parallel.id,{marks:90}));
    await f.run(async()=>{
      const preview=await f.service.preview(f.owner,{selection:f.selection}),input={...f.input(),preview_fingerprint:preview.fingerprint};
      await f.service.request(f.owner,input);
      const waiting=await f.service.options(f.owner,f.source.id,f.learner.id);
      expect(waiting.open_reviews).toEqual([{id:input.change_id,revision:1,state:"waiting_for_finance",destination_name:destinationName,effective_on:f.selection.effective_on}]);
      expect((await f.service.options(f.owner,f.source.id,f.secondLearner.id)).open_reviews).toEqual([]);
      expect((await f.service.options(f.owner,f.parallel.id,f.learner.id)).open_reviews).toEqual([]);
      await expect(f.service.options(f.instructor.actor,f.source.id,f.learner.id)).rejects.toThrow("setup authority");
      await f.classify(input.change_id);
      const ready=await f.service.options(f.owner,f.source.id,f.learner.id);
      expect(ready.open_reviews).toEqual([{id:input.change_id,revision:2,state:"no_financial_change",destination_name:destinationName,effective_on:f.selection.effective_on}]);
      await f.service.apply(f.owner,input.change_id,{command_id:randomUUID(),expected_revision:ready.open_reviews[0]!.revision});
      expect((await f.service.options(f.owner,f.source.id,f.learner.id)).open_reviews).toEqual([]);
    });
    const source=await f.run(()=>publishAcademicOfferingAssessment(db,f,f.source.id,{marks:70,scheduledOn:f.date(8)}));
    expect(source.rows.map(row=>row.person_id)).toEqual([f.secondLearner.id]);
    const frozenDestination=await db.selectFrom("assessment_publication_results").selectAll().where("assessment_id","=",destination.id).execute();
    expect(frozenDestination.map(row=>row.person_id)).toEqual([f.secondLearner.id]);
    await f.runAt(`${f.date(8)}T12:00:00.000Z`,async()=>{
      let scheme=await f.reports.createScheme(f.owner,f.schoolId,{context_kind:"learning_offering",offering_ids:[f.source.id,f.destination.id,f.parallel.id],term_id:f.termId,
        name:"Reviewed elective term eligibility",code:"LATE-ELECTIVE",review_mode:"owner_review",idempotency_key:randomUUID(),bands:[{code:"F",label:"Needs support",minimum_percentage:0,maximum_percentage:49.99},{code:"P",label:"Pass",minimum_percentage:50,maximum_percentage:100}]});
      for(const [offeringId,assessment] of [[f.source.id,source],[f.destination.id,destination],[f.parallel.id,parallel]] as const){
        const course=f.courses.find(row=>row.id===offeringId)!;
        scheme=await f.reports.saveSubjectPlan(f.owner,f.schoolId,scheme.id,{offering_id:offeringId,subject_id:course.subject_id,course_code:course.course_code,credits:Number(course.credits),expected_revision:scheme.revision,idempotency_key:randomUUID(),
          components:[{code:"PORT",name:"Portfolio",weight_percentage:100,assessment_ids:[assessment.id]}]});
      }
      const active=await f.reports.activateScheme(f.owner,f.schoolId,scheme.id,{expected_revision:scheme.revision,idempotency_key:randomUUID()});
      const batch=await f.reports.generateReport(f.owner,f.schoolId,scheme.id,{expected_revision:active.revision,idempotency_key:randomUUID()});
      const learner=await db.selectFrom("grading_report_students").selectAll().where("batch_id","=",batch.id).where("person_id","=",f.learner.id).executeTakeFirstOrThrow();
      expect(learner).toMatchObject({outcome:"incomplete",overall_percentage:null});
      expect(learner.academic_roster_source).toMatchObject({eligibility_as_of:f.date(8),included_offering_ids:[f.destination.id,f.parallel.id].sort(),excluded_offering_ids:[f.source.id]});
      const missing=(await sql<{outcome:string;marks:string|null}>`SELECT source.outcome,source.marks FROM grading_report_assessment_sources source
        WHERE source.batch_id=${batch.id}::uuid AND source.person_id=${f.learner.id}::uuid AND source.assessment_id=${destination.id}::uuid`.execute(db)).rows;
      expect(missing).toEqual([{outcome:"not_evaluated",marks:null}]);
      await expect(f.reports.batchAction(f.owner,f.schoolId,batch.id,"review",{expected_revision:batch.revision,note:"Missing elective assessment must be resolved.",idempotency_key:randomUUID()})).rejects.toThrow("incomplete");
      expect(await db.selectFrom("assessment_publication_results").selectAll().where("assessment_id","=",destination.id).execute()).toEqual(frozenDestination);
    });
  },120000);

  it("keeps two selected offerings of one subject distinct and calculates GPA using their actual different credits",async()=>{
    const f=await createAcademicOfferingFixture(db);
    await f.run(async()=>{
      const context=f.courses.find(row=>row.id===f.source.id)!;
      const advanced=await f.offerings.create(f.owner,{offering_id:randomUUID(),command_id:randomUUID(),name:"Distributed Data Systems advanced studio",
        instructor:f.reference(f.instructor.person),participants:[f.reference(f.learner.person),f.reference(f.secondLearner.person)],starts_on:f.today,
        academic_context:{term_id:f.termId,subject_id:context.subject_id,course_code:"DDS-ADV",credits:2,programme_key:"MTECH-DATA-ENGINEERING"}});
      const first=await publishAcademicOfferingAssessment(db,f,f.source.id,{marks:80}),second=await publishAcademicOfferingAssessment(db,f,advanced.id,{marks:60});
      const policy=await f.reports.createPolicy(f.owner,f.schoolId,{name:"Credit weighted course attempts",code:"WEIGHTED-SAME-SUBJECT",idempotency_key:randomUUID(),configuration:{
        schema_version:1,result_format:"gpa",grade_point_scale:10,aggregation:"credit_weighted",decimal_places:2,absence_treatment:"incomplete",exemption_treatment:"exclude",gpa_failure_treatment:"include",
        bands:bands.map((band,index)=>({...band,grade_points:[0,6,8,10][index]}))}});
      await f.reports.activatePolicy(f.owner,f.schoolId,policy.id,{expected_revision:policy.revision,note:"Approved actual credit weights",idempotency_key:randomUUID()});
      let scheme=await f.reports.createScheme(f.owner,f.schoolId,{context_kind:"learning_offering",offering_ids:[f.source.id,advanced.id],term_id:f.termId,name:"Credit weighted parallel course report",code:"SAME-SUBJECT",
        grading_policy_id:policy.id,programme_key:"MTECH-DATA-ENGINEERING",term_index:1,review_mode:"owner_review",idempotency_key:randomUUID()});
      for(const [id,code,credits,assessment] of [[f.source.id,context.course_code,Number(context.credits),first],[advanced.id,"DDS-ADV",2,second]] as const)
        scheme=await f.reports.saveSubjectPlan(f.owner,f.schoolId,scheme.id,{offering_id:id,subject_id:context.subject_id,course_code:code,credits,expected_revision:scheme.revision,idempotency_key:randomUUID(),
          components:[{code:"PORT",name:"Portfolio",weight_percentage:100,assessment_ids:[assessment.id]}]});
      const plans=await db.selectFrom("grading_scheme_subjects").select(["offering_id","subject_id"]).where("scheme_id","=",scheme.id).execute();
      expect(plans).toHaveLength(2);expect(plans.every(row=>row.subject_id===context.subject_id)).toBe(true);
      await expect(sql`UPDATE grading_scheme_subjects SET credits=NULL WHERE scheme_id=${scheme.id}::uuid AND offering_id=${advanced.id}::uuid`.execute(db)).rejects.toThrow("exact selected course context");
      const active=await f.reports.activateScheme(f.owner,f.schoolId,scheme.id,{expected_revision:scheme.revision,idempotency_key:randomUUID()});
      const batch=await f.reports.generateReport(f.owner,f.schoolId,scheme.id,{expected_revision:active.revision,idempotency_key:randomUUID()});
      const rows=await db.selectFrom("grading_report_students").select(["gpa","cgpa","credit_total"]).where("batch_id","=",batch.id).execute();
      expect(rows).toHaveLength(2);expect(rows.every(row=>Number(row.gpa)===8.67&&Number(row.cgpa)===8.67&&Number(row.credit_total)===6)).toBe(true);
      const section=await f.offerings.create(f.owner,{offering_id:randomUUID(),command_id:randomUUID(),name:"Distributed Data Systems parallel section",instructor:f.reference(f.instructor.person),participants:[f.reference(f.secondLearner.person)],starts_on:f.today,
        academic_context:{term_id:f.termId,subject_id:context.subject_id,course_code:context.course_code,credits:Number(context.credits),programme_key:"MTECH-DATA-ENGINEERING"}});
      const sectionAssessment=await publishAcademicOfferingAssessment(db,f,section.id,{marks:80});
      let duplicate=await f.reports.createScheme(f.owner,f.schoolId,{context_kind:"learning_offering",offering_ids:[f.source.id,section.id],term_id:f.termId,name:"Parallel sections need separate release",code:"PARALLEL-CODE",grading_policy_id:policy.id,
        programme_key:"MTECH-DATA-ENGINEERING",term_index:1,review_mode:"owner_review",idempotency_key:randomUUID()});
      duplicate=await f.reports.saveSubjectPlan(f.owner,f.schoolId,duplicate.id,{offering_id:f.source.id,subject_id:context.subject_id,course_code:context.course_code,credits:Number(context.credits),expected_revision:duplicate.revision,idempotency_key:randomUUID(),components:[{code:"PORT",name:"Portfolio",weight_percentage:100,assessment_ids:[first.id]}]});
      await expect(f.reports.saveSubjectPlan(f.owner,f.schoolId,duplicate.id,{offering_id:section.id,subject_id:context.subject_id,course_code:context.course_code,credits:Number(context.credits),expected_revision:duplicate.revision,idempotency_key:randomUUID(),components:[{code:"PORT",name:"Portfolio",weight_percentage:100,assessment_ids:[sectionAssessment.id]}]})).rejects.toThrow("one offering of each course code");
    });
  },120000);
});
