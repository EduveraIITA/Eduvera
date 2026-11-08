import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { InvigilationInvitationPolicyService } from '../src/assessments/invigilation-invitation-policy.service.js';
import { AssessmentInvigilationOfferBridgeService } from '../src/assessments/assessment-invigilation-offer-bridge.service.js';
import { AssessmentModelBridgeService } from '../src/assessments/assessment-model-bridge.service.js';
import { ExamOperationsService } from '../src/assessments/exam-operations.service.js';
import { AssessmentsService } from '../src/assessments/assessments.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ownedParticipationTestServices } from './owned-participation.test-support.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';
export function examAmendmentServices(db:Kysely<Database>,scope=new ExecutionDataPlaneScope()){
 const database=db as DatabaseService,participation=ownedParticipationTestServices(database,scope),core=participation.core,events=new SchoolEventService(database,core);
 const offers=new AssessmentInvigilationOfferBridgeService(core);
 const operations=new ExamOperationsService(database,events,new AssessmentModelBridgeService(core),offers,participation.bridge,participation.authorities,
   core,core,participation.footprints,participation.planning);
 return {scope,core,operations,assessments:new AssessmentsService(database,events,operations,core,core),participation,events,offers};
}
export async function examAmendmentFixture(db:Kysely<Database>){
 const suffix=randomUUID(),scope=new ExecutionDataPlaneScope(),database=db as DatabaseService,core=new CampusModelCoreService(database,scope);
 const account=async(first_name:string,role:'admin'|'staff'|'student'|'parent'='staff')=>db.insertInto('users').values({username:`exam-amend-${first_name}-${suffix}`,email:`exam-amend-${first_name}-${suffix}@example.test`,
  password_hash:'isolated-test-only',first_name,last_name:'Synthetic',role}).returningAll().executeTakeFirstOrThrow();
 const rawOwner=await account('Owner','admin'),schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(core).createForAccount(tx,rawOwner,'UTC'));
 const owner:AuthUser={...rawOwner,active_school_id:schoolId},rawModerator=await account('Moderator','admin'),rawInvigilator=await account('Invigilator'),rawAlternate=await account('Alternate');
 const moderator:AuthUser={...rawModerator,active_school_id:schoolId},invigilator:AuthUser={...rawInvigilator,active_school_id:schoolId},alternate:AuthUser={...rawAlternate,active_school_id:schoolId};
 for(const actor of [moderator,invigilator,alternate]){await db.insertInto('school_memberships').values({school_id:schoolId,user_id:actor.id,role:actor.role as 'admin'|'staff'}).execute();
  await linkFixtureStaffIdentity(database,{school_id:schoolId,user_id:actor.id,owner_user_id:owner.id,teaching:false});}
 const now=new Date().toISOString(),day=(offset:number)=>new Date(Date.parse(now)+offset*86400000).toISOString().slice(0,10),starts=`${day(2)}T09:00:00.000Z`;
 const runAt=<T>(at:string,work:()=>Promise<T>)=>scope.run(createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(at),nowIso:()=>at}}),()=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(at),nowIso:()=>at}}),work));
 const run=<T>(work:()=>Promise<T>)=>runAt(now,work);
 const term=await db.insertInto('academic_terms').values({school_id:schoolId,academic_year:'amendment',name:'Amendment term',starts_on:day(-1),ends_on:day(30),attendance_threshold:'75'}).returning('id').executeTakeFirstOrThrow();
 const section=await db.insertInto('class_sections').values({school_id:schoolId,academic_year:'amendment',grade:'MTech',section:'Computing'}).returning('id').executeTakeFirstOrThrow();
 const subject=await db.insertInto('subjects').values({school_id:schoolId,code:'AMEND',name:'Distributed systems',short_name:'DS'}).returning('id').executeTakeFirstOrThrow();
 const learner=await account('Learner','student'),guardian=await account('Guardian','parent');
 await db.insertInto('school_memberships').values([{school_id:schoolId,user_id:learner.id,role:'student'},{school_id:schoolId,user_id:guardian.id,role:'guardian'}]).execute();
 const studentPerson=await db.insertInto('school_people').values({school_id:schoolId,first_name:'Learner',last_name:'Synthetic'}).returning('id').executeTakeFirstOrThrow();
 const student=await db.insertInto('students').values({school_id:schoolId,person_id:studentPerson.id,user_id:learner.id,admission_number:'AMEND-1'}).returning('id').executeTakeFirstOrThrow();
 const guardianPerson=await db.insertInto('school_people').values({school_id:schoolId,first_name:'Guardian',last_name:'Synthetic'}).returning('id').executeTakeFirstOrThrow();
 const parent=await db.insertInto('parents').values({user_id:guardian.id}).returning('id').executeTakeFirstOrThrow();
 await db.insertInto('guardian_school_profiles').values({school_id:schoolId,guardian_id:parent.id,person_id:guardianPerson.id}).execute();
 await db.insertInto('guardian_relationships').values({school_id:schoolId,guardian_id:parent.id,student_id:student.id,relationship:'guardian'}).execute();
 const link=async(person:string,user:string,source:string)=>db.transaction().execute(tx=>core.linkAccountEndpoint(tx,{school_id:schoolId,person_id:person,user_id:user,actor_user_id:owner.id,
  effective_from:new Date(Date.parse(now)-86400000).toISOString(),effective_until:null,source_domain:'people',source_record_id:source,source_revision:1,metadata:{fixture:'explicit_exam_participant'}}));
 await link(studentPerson.id,learner.id,student.id);const guardianLink=await link(guardianPerson.id,guardian.id,parent.id);
 await db.insertInto('enrollments').values({student_id:student.id,class_section_id:section.id,term_id:term.id,roll_number:1,enrolled_on:day(-1)}).execute();
 const campus=await db.insertInto('institution_campuses').values({school_id:schoolId,name:'Test campus',code:'MAIN',campus_type:'main',is_primary:true,created_by:owner.id,updated_by:owner.id}).returning('id').executeTakeFirstOrThrow();
 const room=async(name:string)=>db.insertInto('campus_spaces').values({school_id:schoolId,campus_id:campus.id,name,code:name,kind:'classroom',capacity:20,is_bookable:true,created_by:owner.id,updated_by:owner.id}).returningAll().executeTakeFirstOrThrow();
 const [firstRoom,secondRoom]=await Promise.all([room('HALL-A'),room('HALL-B')]),services=examAmendmentServices(db,scope);
 const policy=new InvigilationInvitationPolicyService(database,services.core,new CoordinationConfigurationService(services.core),services.core,services.core);
 const assessment=await run(async()=>{
  const eligible=await policy.workspace(owner,schoolId);
  await policy.approve({authUser:owner,requestId:randomUUID(),headers:{}} as unknown as AuthenticatedRequest,schoolId,{expected_revision:0,enabled:true,
   recipient_person_ids:eligible.eligible_recipients.filter(person=>[invigilator.id,alternate.id].includes(person.user_id)).map(person=>person.person_id),
   response_due_minutes:10080,expires_after_minutes:43200,approval_note:'Explicitly approve these isolated test invitation recipients.',idempotency_key:randomUUID()});
  const cycle=await services.assessments.createCycle(owner,schoolId,{term_id:term.id,name:'Test exam cycle',code:'AMEND',starts_on:day(-1),ends_on:day(30)});
  const created=await services.assessments.createAssessment(owner,schoolId,{cycle_id:cycle.id,class_section_id:section.id,subject_id:subject.id,title:'Distributed systems final',assessment_kind:'exam',maximum_marks:100,
   scheduled_at:starts,duration_minutes:60,evidence_requirement:'none',examiner_user_id:owner.id,moderator_user_id:moderator.id,space_id:firstRoom.id,invigilator_user_ids:[invigilator.id]});
  const assignment=await db.selectFrom('assessment_sitting_invigilators').selectAll().where('assessment_id','=',created.id).executeTakeFirstOrThrow();
  await services.operations.respondInvigilator(invigilator,schoolId,created.id,assignment.id,{command_id:randomUUID(),expected_revision:assignment.revision,decision:'accepted',note:''});
  return services.assessments.action(owner,schoolId,created.id,'schedule',{command_id:randomUUID(),expected_revision:created.revision}) as Promise<typeof created>;
 });
 const source=()=>db.selectFrom('assessments').selectAll().where('id','=',assessment.id).executeTakeFirstOrThrow();
 const sitting=()=>db.selectFrom('assessment_sittings').selectAll().where('assessment_id','=',assessment.id).executeTakeFirstOrThrow();
 return {db,schoolId,owner,moderator,invigilator,alternate,student,studentPerson,learner,guardian,guardianPerson,guardianLink,parent,section,term,subject,now,day,starts,firstRoom,secondRoom,assessment,...services,run,runAt,source,sitting};
}
