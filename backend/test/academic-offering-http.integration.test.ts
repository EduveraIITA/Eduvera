import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createAcademicOfferingFixture } from './academic-offering-cycle.test-support.js';
import { IsolatedAppHttp, type IsolatedHttpSession } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const compiledRoot=process.env.ACADEMIC_OFFERING_HTTP_COMPILED_ROOT??process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT;
const source=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/academic_offering_http_unused_test';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:source,max:4,application_name:'academic-offering-http-test'})})});
const app=new IsolatedAppHttp();
type State={id:string;revision:number;status:string};
// Assertion-only wire subsets; no frontend runtime or alternate domain writer.
type AssessmentWorkspace={can_plan_class_test?:boolean;assessments:Array<{class_section_id:string|null;context_kind?:string;offering_id?:string|null}>;references?:{offerings?:unknown}};
type AssessmentDetail={results:Array<{id:string;student_id:string|null;learner_id?:string;person_id?:string;revision:number}>};
type AdminReports={mode:'admin';schemes:Array<{class_section_id:string|null;context_kind?:string}>;batches:Array<{id:string}>;references:{offerings?:Array<{id:string;academic_context:{programme_key:string|null}|null}>;assessments:Array<{class_section_id:string|null}>}};
type AcademicReportWorkspace=AdminReports|{mode:'staff';schemes:AdminReports['schemes'];batches:AdminReports['batches']};
type GradingSchemeDetail={subjects:Array<{offering_id?:string|null}>};
type ReportBatchDetail={batch:{revision:number};students:Array<{student_id:string|null;learner_id:string;person_id:string;admission_number:string|null;comment_revision:number}>};
type OwnAssessmentResults={learner:{learner_id:string;person_id:string;student_id:string|null};results:Array<{id:string}>};
type OwnReportCards={learner:{student_id:string|null};reports:Array<{subjects:Array<{course_code?:string|null}>;gpa?:string|null;credit_total?:string|null;class_teacher_comment:string}>};
type LearningOfferingDetail={current_instructor:{id:string;revision:number}|null};
type CalendarDates={items:Array<{id:string;context_kind?:string;offering_id?:string;subject_id?:string;title:string;date:string;scheduled_at:string;venue:string;subject_name:string;class_name:string;duration_minutes:number|null}>};
type WorkspaceManifest={context:{actor_user_id?:string;institution_id:string};areas:Array<{key:string;surfaces:Array<{key:string;href:string;scopes:Array<{kind:string;id:string}>}>}>};
type CourseInput={context_kind:'learning_offering';offering_id:string;class_section_id:null;subject_id:string;cycle_id:string;title:string;assessment_kind:'assignment';maximum_marks:number;scheduled_at:string;evidence_requirement:'none';examiner_user_id:string;moderator_user_id:string;grading_policy_id:string;idempotency_key:string};

/** Pre-extension clients require a non-null class in workspace rows/references.
 * Keep the actual legacy DTO shape; there is no substitute class/person bridge. */
function legacyAssessmentShape(value:AssessmentWorkspace):boolean {
  return value.assessments.every(row=>typeof row.class_section_id==='string'&&row.context_kind!=='learning_offering')
    &&!Object.hasOwn(value.references??{},'offerings');
}
function legacyReportShape(value:AcademicReportWorkspace):boolean {
  return value.schemes.every(row=>typeof row.class_section_id==='string'&&row.context_kind!=='learning_offering')
    &&(value.mode!=='admin'||!Object.hasOwn(value.references,'offerings')&&value.references.assessments.every(row=>typeof row.class_section_id==='string'));
}

describe.runIf(enabled)('canonical offering academic cycle through the isolated compiled authenticated app',()=>{
  beforeAll(async()=>{
    if(!compiledRoot)throw new Error('Set explicit ACADEMIC_OFFERING_HTTP_COMPILED_ROOT or VISIT_ONBOARDING_HTTP_COMPILED_ROOT; ordinary dist/API is forbidden.');
    await app.start(source,{compiledRoot,publicUrl:'https://academic-http.example.test'});
  },30000);
  afterAll(async()=>{await app.stop();await db.destroy();},10000);
  it('publishes nonempty course rosters and a multi-course GPA report with current authority, legacy opt-in compatibility and own-person privacy',async()=>{
    const password=`Academic-HTTP-${randomUUID()}!`,f=await createAcademicOfferingFixture(db as DatabaseService,{passwordHash:await hashPassword(password)});
    const owner=app.session(),instructor=app.session(),learner=app.session(),second=app.session(),sessions=[owner,instructor,learner,second];
    for(const [session,actor] of [[owner,f.owner],[instructor,f.instructor.actor],[learner,f.learner.actor],[second,f.secondLearner.actor]] as const)await session.login(actor.email,password,f.schoolId);
    const assessmentRoot=`/api/v1/schools/${f.schoolId}/assessments`,reportRoot=`/api/v1/schools/${f.schoolId}/academic-reports`;
    const calendarPath=`${assessmentRoot}/calendar/?${new URLSearchParams({from:f.today,to:f.date(3)}).toString()}`,courseCalendar=`${calendarPath}&academic_context=offering_v1`;
    const compatibility=async()=>{
      const a=await owner.json<AssessmentWorkspace>(`${assessmentRoot}/workspace/`),r=await owner.json<AcademicReportWorkspace>(`${reportRoot}/workspace/`);
      expect(legacyAssessmentShape(a)).toBe(true);expect(legacyReportShape(r)).toBe(true);
      return {a,r};
    };
    expect((await app.session().request(`${assessmentRoot}/workspace/`)).status).toBe(401);
    expect((await app.session().request(`${reportRoot}/workspace/?academic_context=offering_v1`)).status).toBe(401);
    await compatibility();
    const adminLauncher=await owner.json<WorkspaceManifest>('/api/v1/workspace');
    expect(adminLauncher.areas.find(row=>row.key==='assessments')?.surfaces).toContainEqual(expect.objectContaining({key:'manage',href:'/areas/assessments/manage'}));
    expect(adminLauncher.areas.find(row=>row.key==='reports')?.surfaces).toContainEqual(expect.objectContaining({key:'remarks',href:'/areas/reports/remarks'}));
    const unassignedLauncher=await instructor.json<WorkspaceManifest>('/api/v1/workspace');
    expect(unassignedLauncher.areas.find(row=>row.key==='assessments')?.surfaces).toContainEqual(expect.objectContaining({key:'assigned',href:'/areas/assessments/assigned'}));
    expect(unassignedLauncher.areas.find(row=>row.key==='assessments')?.surfaces.some(row=>row.key==='manage')).not.toBe(true);
    expect(unassignedLauncher.areas.find(row=>row.key==='reports')?.surfaces.some(row=>row.key==='remarks')).not.toBe(true);
    const refs=await owner.json<Extract<AcademicReportWorkspace,{mode:'admin'}>>(`${reportRoot}/workspace/?academic_context=offering_v1`);
    const selected=[f.source.id,f.destination.id],programme=refs.references.offerings?.find(row=>row.id===f.source.id)?.academic_context?.programme_key;
    expect(refs.references.offerings?.map(row=>row.id)).toEqual(expect.arrayContaining(selected));if(!programme)throw new Error('Fixture requires its actual canonical programme binding');
    const configuration={schema_version:1,result_format:'gpa',grade_point_scale:10,decimal_places:2,aggregation:'credit_weighted',absence_treatment:'incomplete',exemption_treatment:'exclude',gpa_failure_treatment:'include',bands:[{code:'F',label:'Below pass',minimum_percentage:0,maximum_percentage:39.99,grade_points:0,passed:false},{code:'P',label:'Pass',minimum_percentage:40,maximum_percentage:100,grade_points:10,passed:true}]};
    const policy=await owner.json<State>(`${reportRoot}/policies/`,'POST',{name:'Course GPA',code:'HTTP-GPA',configuration,idempotency_key:randomUUID()});
    await owner.json(`${reportRoot}/policies/${policy.id}/activate/`,'POST',{expected_revision:policy.revision,note:'Reviewed grade bands and weighted credit calculation.',idempotency_key:randomUUID()});
    const created:Array<{id:string;input:CourseInput}> = [];
    const publish=async(offeringId:string)=>{
      const course=f.courses.find(row=>row.id===offeringId);if(!course)throw new Error('Exact configured course fixture missing');
      const input:CourseInput={context_kind:'learning_offering',offering_id:offeringId,class_section_id:null,subject_id:course.subject_id,cycle_id:f.cycle.id,title:`Reviewed portfolio ${created.length+1}`,assessment_kind:'assignment',maximum_marks:100,scheduled_at:`${f.date(2)}T10:00:00.000Z`,evidence_requirement:'none',examiner_user_id:f.instructor.actor.id,moderator_user_id:f.owner.id,grading_policy_id:policy.id,idempotency_key:randomUUID()};
      if(!created.length){
        expect((await instructor.request(`${assessmentRoot}/`,'POST',input,false)).status).toBe(403);
        expect((await learner.request(`${assessmentRoot}/`,'POST',{...input,idempotency_key:randomUUID()})).status).toBe(403);
        expect((await db.selectFrom('assessments').select('id').where('school_id','=',f.schoolId).execute())).toHaveLength(0);
      }
      const initial=await instructor.json<State&{context_kind:string;class_section_id:null;offering_id:string}>(`${assessmentRoot}/`,'POST',input);
      expect(initial).toMatchObject({context_kind:'learning_offering',class_section_id:null,offering_id:offeringId,status:'draft',revision:1});
      if(!created.length){
        const assignedLauncher=await instructor.json<WorkspaceManifest>('/api/v1/workspace');
        expect(assignedLauncher.areas.find(row=>row.key==='assessments')?.surfaces).toContainEqual(expect.objectContaining({key:'assigned',href:'/areas/assessments/assigned',scopes:[{kind:'self',label:'My assessment assignments'}]}));
        expect(assignedLauncher.areas.find(row=>row.key==='assessments')?.surfaces.some(row=>row.key==='manage')).not.toBe(true);
        expect(assignedLauncher.areas.find(row=>row.key==='reports')?.surfaces.some(row=>row.key==='remarks')).not.toBe(true);
      }
      const action=async(actor:IsolatedHttpSession,state:State,name:string,note='Reviewed this exact course stage.')=>actor.json<State>(`${assessmentRoot}/${initial.id}/actions/${name}/`,'POST',{expected_revision:state.revision,note,idempotency_key:randomUUID()});
      expect((await learner.json<CalendarDates>(courseCalendar)).items.some(row=>row.id===initial.id),'Draft course assessments never appear as dates.').toBe(false);
      let state=await action(owner,initial,'schedule');
      // A learner can discover scheduled course dates before private marking or
      // publication, with the dated enrollment rather than a fake class/student.
      const ownDates=await learner.json<CalendarDates>(courseCalendar),otherDates=await second.json<CalendarDates>(courseCalendar);
      expect(ownDates.items.some(row=>row.id===initial.id)).toBe(offeringId===f.source.id);
      const scheduled=otherDates.items.find(row=>row.id===initial.id);expect(scheduled).toMatchObject({context_kind:'learning_offering',offering_id:offeringId,subject_id:course.subject_id,title:input.title});
      expect(scheduled!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(Object.keys(scheduled!).sort()).toEqual(['id','title','scheduled_at','date','venue','subject_name','class_name','duration_minutes','context_kind','offering_id','subject_id'].sort());
      expect((await learner.json<CalendarDates>(`${courseCalendar}&person_id=${f.learner.id}`)).items).toEqual(ownDates.items);
      expect((await learner.request(`${courseCalendar}&person_id=${f.secondLearner.id}`)).status).toBe(403);
      expect((await learner.request(calendarPath)).status,'The installed legacy generic-member calendar contract is unchanged.').toBe(403);
      state=await action(owner,state,'open-marking');
      const detail=await instructor.json<AssessmentDetail>(`${assessmentRoot}/${initial.id}/`);
      expect(detail.results.length).toBeGreaterThan(0);expect(detail.results.every(row=>row.student_id===null&&row.learner_id===row.person_id)).toBe(true);
      expect(detail.results.map(row=>row.person_id)).toEqual(expect.arrayContaining([f.secondLearner.id]));
      if(offeringId===f.source.id)expect(detail.results).toHaveLength(2);else expect(detail.results.map(row=>row.person_id)).toEqual([f.secondLearner.id]);
      expect((await owner.request(`${assessmentRoot}/${initial.id}/results/`,'POST',{expected_assessment_revision:state.revision,results:detail.results.map(row=>({result_id:row.id,outcome:'scored',marks:80,expected_revision:row.revision,reason:'Reviewed submitted course portfolio.'}))})).status).toBe(403);
      state=await instructor.json<State>(`${assessmentRoot}/${initial.id}/results/`,'POST',{expected_assessment_revision:state.revision,results:detail.results.map(row=>({result_id:row.id,outcome:'scored',marks:80,expected_revision:row.revision,reason:'Reviewed submitted course portfolio.'}))});
      state=await action(instructor,state,'submit');expect((await instructor.request(`${assessmentRoot}/${initial.id}/actions/approve/`,'POST',{expected_revision:state.revision,note:'Examiner cannot approve own marks.',idempotency_key:randomUUID()})).status).toBe(403);
      state=await action(owner,state,'approve');await action(owner,state,'publish');
      expect(await instructor.json(`${assessmentRoot}/`,'POST',input)).toEqual({...initial,replayed:true});
      created.push({id:initial.id,input});return initial.id;
    };
    const assessmentIds:string[]=[];
    for(const offeringId of selected)assessmentIds.push(await publish(offeringId));
    const newWorkspace=await instructor.json<AssessmentWorkspace>(`${assessmentRoot}/workspace/?academic_context=offering_v1`);
    expect(newWorkspace.assessments.filter(row=>selected.includes(row.offering_id??''))).toHaveLength(2);
    const own=await learner.json<OwnAssessmentResults>(`${assessmentRoot}/mine/?person_id=${f.learner.id}`);
    expect(own.learner).toMatchObject({learner_id:f.learner.id,person_id:f.learner.id,student_id:null});expect(own.results.map(row=>row.id)).toEqual([assessmentIds[0]]);
    expect((await learner.request(`${assessmentRoot}/mine/?person_id=${f.secondLearner.id}`)).status).toBe(403);
    const schemeInput={context_kind:'learning_offering',class_section_id:null,offering_ids:selected,term_id:f.termId,name:'Reviewed semester GPA',code:'HTTP-SEM1',grading_policy_id:policy.id,review_mode:'owner_review',absence_treatment:'incomplete',programme_key:programme,term_index:1,idempotency_key:randomUUID()};
    expect((await instructor.request(`${reportRoot}/schemes/`,'POST',schemeInput)).status).toBe(403);
    let scheme=await owner.json<State>(`${reportRoot}/schemes/`,'POST',schemeInput);
    for(const [index,offeringId]of selected.entries()){
      const course=f.courses.find(row=>row.id===offeringId)!;
      scheme=await owner.json<State>(`${reportRoot}/schemes/${scheme.id}/subjects/`,'PUT',{offering_id:offeringId,subject_id:course.subject_id,course_code:course.course_code,credits:Number(course.credits),expected_revision:scheme.revision,pass_percentage:null,components:[{code:'FINAL',name:'Portfolio result',weight_percentage:100,assessment_ids:[assessmentIds[index]]}],idempotency_key:randomUUID()});
      if(index===0)expect((await owner.request(`${reportRoot}/schemes/${scheme.id}/activate/`,'POST',{expected_revision:scheme.revision,note:'A selected course is not mapped yet.',idempotency_key:randomUUID()})).status).toBe(400);
    }
    const mapping=await owner.json<GradingSchemeDetail>(`${reportRoot}/schemes/${scheme.id}/`);expect(mapping.subjects.map(row=>row.offering_id).sort()).toEqual([...selected].sort());
    scheme=await owner.json<State>(`${reportRoot}/schemes/${scheme.id}/activate/`,'POST',{expected_revision:scheme.revision,note:'Every selected course and published assessment mapped.',idempotency_key:randomUUID()});
    const generated=await owner.json<State&{sequence:number}>(`${reportRoot}/schemes/${scheme.id}/generate/`,'POST',{expected_revision:scheme.revision,correction_reason:'',idempotency_key:randomUUID()});
    const batchPath=`${reportRoot}/batches/${generated.id}`,batch=await owner.json<ReportBatchDetail>(`${batchPath}/`);expect(batch.students).toHaveLength(2);expect(batch.students.every(row=>row.student_id===null&&row.learner_id===row.person_id&&row.admission_number===null)).toBe(true);
    const row=batch.students.find(item=>item.person_id===f.learner.id)!;
    expect((await learner.request(`${batchPath}/`)).status).toBe(403);
    expect((await instructor.request(`${batchPath}/learners/${row.learner_id}/comments/`,'PUT',{expected_revision:1,expected_batch_revision:batch.batch.revision,class_teacher_comment:'Not a report coordinator.',principal_comment:'',idempotency_key:randomUUID()})).status).toBe(403);
    const remark=await owner.json<{comment_revision:number;batch_revision:number;learner_id:string;student_id:null}>(`${batchPath}/learners/${row.learner_id}/comments/`,'PUT',{expected_revision:row.comment_revision,expected_batch_revision:batch.batch.revision,class_teacher_comment:'Course work reviewed.',principal_comment:'Proceed with research.',idempotency_key:randomUUID()});
    expect(remark).toMatchObject({learner_id:f.learner.id,student_id:null});
    const reviewed=await owner.json<State>(`${batchPath}/actions/review/`,'POST',{expected_revision:remark.batch_revision,note:'Reviewed the entire release using its configured owner-review policy.',idempotency_key:randomUUID()});
    await owner.json(`${batchPath}/actions/publish/`,'POST',{expected_revision:reviewed.revision,note:'Publish the reviewed semester release.',idempotency_key:randomUUID()});
    const ownReport=await learner.json<OwnReportCards>(`${reportRoot}/mine/?person_id=${f.learner.id}`),secondReport=await second.json<OwnReportCards>(`${reportRoot}/mine/?person_id=${f.secondLearner.id}`);
    expect(ownReport.learner.student_id).toBeNull();expect(ownReport.reports).toHaveLength(1);expect(ownReport.reports[0]!.subjects).toHaveLength(1);expect(secondReport.reports[0]!.subjects).toHaveLength(2);
    expect(Number(ownReport.reports[0]!.gpa)).toBe(10);expect(Number(ownReport.reports[0]!.credit_total)).toBe(4);expect(ownReport.reports[0]!.class_teacher_comment).toBe('Course work reviewed.');
    expect((await learner.request(`${reportRoot}/mine/?person_id=${f.secondLearner.id}`)).status).toBe(403);
    // Endpoint authority alone is not discoverability. The ordinary launcher
    // must expose each actual course person's own canonical, person-scoped read.
    for(const [session,person]of [[learner,f.learner],[second,f.secondLearner]]as const){
      const manifest=await session.json<WorkspaceManifest>('/api/v1/workspace');
      expect(manifest.context).toMatchObject({actor_user_id:person.actor.id,institution_id:f.schoolId});
      for(const [area,prefix,path]of [['assessments','results','/areas/assessments/results'],['reports','progress','/areas/reports/progress']]as const){
        const surfaces=manifest.areas.find(item=>item.key===area)?.surfaces??[],own=surfaces.filter(item=>item.key.startsWith(`${prefix}:mine:`));
        expect(own).toHaveLength(1);expect(own[0]).toMatchObject({key:`${prefix}:mine:${person.id}`,href:`${path}?${new URLSearchParams({scope:'mine',person_id:person.id}).toString()}`});
        expect(own[0]!.scopes).toHaveLength(1);expect(own[0]!.scopes[0]).toMatchObject({kind:'person',id:person.id});
        expect(surfaces.some(item=>item.key===`${prefix}:mine:${person.id===f.learner.id?f.secondLearner.id:f.learner.id}`)).toBe(false);
      }
    }
    const legacy=await compatibility();expect(legacy.a.assessments).toHaveLength(0);expect(legacy.r.schemes).toHaveLength(0);expect(legacy.r.batches).toHaveLength(0);
    const offering=await owner.json<LearningOfferingDetail>(`/api/v1/learning/offerings/${f.source.id}/`);if(!offering.current_instructor)throw new Error('Current fixture instructor missing');
    await owner.json(`/api/v1/learning/offerings/${f.source.id}/instructors/${offering.current_instructor.id}/end/`,'POST',{command_id:randomUUID(),expected_revision:offering.current_instructor.revision,reason:'Current course teaching appointment ended after publication.'});
    expect((await instructor.request(`${assessmentRoot}/`,'POST',created[0]!.input)).status).toBe(403);
    for(const offeringId of [f.destination.id,f.parallel.id]){
      const remaining=await owner.json<LearningOfferingDetail>(`/api/v1/learning/offerings/${offeringId}/`);
      if(!remaining.current_instructor)throw new Error('Expected current course appointment before ending its planning discovery.');
      await owner.json(`/api/v1/learning/offerings/${offeringId}/instructors/${remaining.current_instructor.id}/end/`,'POST',{command_id:randomUUID(),expected_revision:remaining.current_instructor.revision,reason:'End remaining teaching appointments to verify current first-assessment discovery.'});
    }

    const counts=(await sql<{classes:number;students:number;staff:number}>`SELECT
      (SELECT count(*)::int FROM class_sections WHERE school_id=${f.schoolId}::uuid) AS classes,
      (SELECT count(*)::int FROM students WHERE school_id=${f.schoolId}::uuid) AS students,
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${f.schoolId}::uuid) AS staff`.execute(db)).rows[0]!;expect(counts).toEqual({classes:0,students:0,staff:0});
    expect((await instructor.json<AssessmentWorkspace>(`${assessmentRoot}/workspace/?academic_context=offering_v1`)).can_plan_class_test).toBe(false);
    // Retaining a named examiner reference never preserves revoked authority.
    await db.updateTable('staff_responsibility_types').set({is_active:false}).where('school_id','=',f.schoolId).where('code','=','internal_examiner').execute();
    const revokedLauncher=await instructor.json<WorkspaceManifest>('/api/v1/workspace');
    expect(revokedLauncher.areas.find(row=>row.key==='assessments')?.surfaces.some(row=>row.key==='assigned')).not.toBe(true);
    expect((await instructor.request(`${assessmentRoot}/${assessmentIds[0]}/`)).status).toBe(403);
    for(const session of sessions)await session.request('/api/v1/auth/logout/','POST',{});
    expect((await instructor.request(`${assessmentRoot}/workspace/?academic_context=offering_v1`)).status).toBe(401);
    expect((await learner.request(`${courseCalendar}&person_id=${f.learner.id}`)).status).toBe(401);
  },180000);
});
