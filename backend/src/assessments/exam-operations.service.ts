import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { OwnedParticipationBridge, type OwnedParticipationContext, type OwnedParticipationPerson } from "../attendance/owned-participation-bridge.service.js";
import { ParticipationContextAuthorityRegistry } from "../attendance/participation-context-authority.js";
import type { ParticipationCaptureSources, ParticipationStatus } from "../attendance/activity-attendance.contracts.js";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { AssessmentSittingInvigilatorTable, AssessmentSittingTable, Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { AssessmentInvigilationOfferBridgeService } from "./assessment-invigilation-offer-bridge.service.js";
import { AssessmentModelBridgeService, type ExamSittingModelSnapshot } from "./assessment-model-bridge.service.js";
import { assessmentWorkHref } from '../workspace/canonical-application-links.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from '../campus-model-core/domain-command-gateway.port.js';
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import { OwnedPlanFootprintBridge, type OwnedPlanPerson } from '../schedule-planning/owned-plan-footprint.bridge.js';
import { ActivityPlanningService } from '../schedule-planning/activity-planning.service.js';
import { datedAcademicRoster, datedOfferingRoster } from '../academic-reports/academic-record-context.js';
import { lockSchedule } from '../day-plans/schedule.js';

type Db = Kysely<Database> | Transaction<Database>;
type PhysicalKind = "exam" | "practical" | "viva";
type AssessmentKind = PhysicalKind|"class_test"|"quiz"|"assignment"|"project"|"other";
type AssessmentStatus = "draft"|"scheduled"|"marking"|"submitted"|"moderated"|"published"|"cancelled";
type AssessmentRecord = {
  id:string; school_id:string; cycle_id:string; class_section_id:string|null; offering_id:string|null; subject_id:string;
  assessment_kind:AssessmentKind; scheduled_at:Date|string|null;
  duration_minutes:number|null; status:AssessmentStatus; revision:number;
};
type ExamReadinessBlocker = {
  code:"exam_window"|"roster"|"space"|"capacity"|"invigilators"|"other_exam"|"class_timetable"|"room_timetable"|"invigilator_timetable";
  message:string;
  source:"assessment"|"exam_sitting"|"effective_timetable";
  source_id:string|null;
};
export type ExamReadiness = {
  checked_at:string;
  can_schedule:boolean;
  blockers:ExamReadinessBlocker[];
  candidate_count:number;
  room_capacity:number|null;
  accepted_invigilator_count:number;
  required_invigilator_count:number;
  timetable_contract:"effective_school_schedule_v4";
};

const uuid=z.string().uuid();
export const examPolicyInput=z.object({
  readiness_minutes_before:z.coerce.number().int().min(0).max(10080),
  attendance_close_after_minutes:z.coerce.number().int().min(0).max(10080),
  minimum_invigilators:z.coerce.number().int().min(1).max(20),
  require_all_candidate_attendance:z.boolean(),
  post_completion_marking_mode:z.enum(["manual","automatic"]),
  expected_revision:z.coerce.number().int().positive(),
});
export const sittingInput=z.object({space_id:uuid,invigilator_user_ids:z.array(uuid).min(1).max(20)});
export const sittingArrangementInput=z.object({
  expected_assessment_revision:z.coerce.number().int().positive(),
  expected_sitting_revision:z.coerce.number().int().positive(),
  scheduled_at:z.iso.datetime(),
  duration_minutes:z.coerce.number().int().positive().max(1440),
  space_id:uuid,
  invigilator_user_ids:z.array(uuid).min(1).max(20),
}).superRefine((value,context)=>{
  if(new Set(value.invigilator_user_ids).size!==value.invigilator_user_ids.length){
    context.addIssue({code:"custom",path:["invigilator_user_ids"],message:"Each invigilator can be assigned only once."});
  }
});
export const scheduleAmendmentInput=z.object({
  command_id:uuid,expected_assessment_revision:z.number().int().positive(),expected_sitting_revision:z.number().int().positive(),
  scheduled_at:z.iso.datetime(),duration_minutes:z.number().int().positive().max(1440),space_id:uuid,
  invigilator_user_ids:z.array(uuid).min(1).max(20),reason:z.string().trim().min(3).max(1000),preview_hash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const scheduleAmendmentPreviewInput=scheduleAmendmentInput.omit({command_id:true,preview_hash:true});
export const invigilatorResponseInput=z.object({command_id:uuid,expected_revision:z.coerce.number().int().positive(),decision:z.enum(["accepted","declined"]),note:z.string().trim().max(500).default("")});
export const sittingActionInput=z.object({expected_revision:z.coerce.number().int().positive()});
export const attendanceInput=z.object({
  expected_revision:z.coerce.number().int().positive(),
  reason:z.string().trim().min(3).max(500).optional(),
  records:z.array(z.object({
    student_id:uuid.optional(),
    candidate_id:uuid.optional(),
    status:z.enum(["present","late","absent","left_early"]),
    observed_at:z.iso.datetime().optional(),
    note:z.string().trim().max(500).default(""),
    expected_revision:z.coerce.number().int().positive(),
  }).refine(record=>Boolean(record.student_id)!==Boolean(record.candidate_id), "Choose exactly one examination candidate.")).min(1).max(500),
}).superRefine((value,context)=>{
  const ids=new Set<string>();
  for(const [index,record] of value.records.entries()){
    const id=record.candidate_id??record.student_id;
    if(!id)continue;
    if(ids.has(id)) context.addIssue({code:"custom",path:["records",index,"student_id"],message:"A candidate can appear only once."});
    ids.add(id);
  }
});
export const incidentInput=z.object({
  expected_revision:z.coerce.number().int().positive(),
  student_id:uuid.nullable().optional().default(null),
  candidate_id:uuid.nullable().optional(),
  category:z.enum(["conduct","health","materials","timing","other"]),
  severity:z.enum(["info","minor","major"]),
  summary:z.string().trim().min(3).max(1000),
  observed_at:z.iso.datetime().optional(),
}).refine(record=>!(record.student_id&&record.candidate_id), "Choose one examination candidate.");
export const incidentResolveInput=z.object({expected_revision:z.coerce.number().int().positive(),resolution:z.string().trim().min(3).max(1000)});

export function isPhysicalAssessment(kind:string):kind is PhysicalKind { return ["exam","practical","viva"].includes(kind); }

export function assertFutureExamStart(value:Date|string,now=executionNow()){
  const startsAt=new Date(value);
  if(!Number.isFinite(startsAt.getTime())||startsAt.getTime()<=now.getTime()){
    throw new BadRequestException("Choose a future examination time before assigning the campus room and invigilators.");
  }
  return startsAt;
}

@Injectable()
export class ExamOperationsService {
  constructor(
    private readonly db:DatabaseService,
    private readonly events:SchoolEventService,
    private readonly modelBridge:AssessmentModelBridgeService,
    private readonly invigilationOffers:AssessmentInvigilationOfferBridgeService,
    private readonly participation:OwnedParticipationBridge,
    authorities:ParticipationContextAuthorityRegistry,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands:DomainCommandGatewayPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities:HumanAgentIdentityPort,
    private readonly footprints:OwnedPlanFootprintBridge,
    private readonly planning:ActivityPlanningService,
  ){
    authorities.register('examination',async(tx,user,context)=>{
      const role=await this.access(user,context.school_id,context.source_ref,tx,true);
      const sitting=await tx.selectFrom('assessment_sittings').selectAll().where('school_id','=',context.school_id)
        .where('id','=',context.source_ref).executeTakeFirstOrThrow();
      const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService['policyProjection']>;
      const active=sitting.state==='in_progress'&&executionNow().getTime()<=new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60000;
      return {can_view:true,can_record:active,can_review:sitting.state==='in_progress'||sitting.state==='completed',
        source_refs:[{kind:'current_examination_responsibility',sitting_id:sitting.id,assessment_id:sitting.assessment_id,
          sitting_revision:sitting.revision,policy_revision:sitting.policy_revision,accepted_invigilator_or_administrator:true}],
        allowed_statuses:['present','late','absent','left_early'],
        record_not_before:new Date(new Date(sitting.starts_at).getTime()-policy.readiness_minutes_before*60000),
        capture_window:{from:new Date(new Date(sitting.starts_at).getTime()-policy.readiness_minutes_before*60000),
          until:new Date(new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60000+1)},
        source:{domain:'assessments',href:assessmentWorkHref(role==='admin'?'manage':'assigned',sitting.assessment_id,[['focus','exam-day']]),label:'Open examination attendance'}};
    });
  }

  private async participationContext(tx:Transaction<Database>,schoolId:string,sittingId:string){
    const sitting=await tx.selectFrom('assessment_sittings').innerJoin('assessments','assessments.id','assessment_sittings.assessment_id')
      .select(['assessment_sittings.id','assessment_sittings.assessment_id','assessment_sittings.starts_at','assessment_sittings.ends_at',
        'assessment_sittings.revision','assessment_sittings.state','assessment_sittings.space_id','assessment_sittings.completed_by',
        'assessment_sittings.completed_at','assessment_sittings.policy_snapshot','assessments.title'])
      .where('assessment_sittings.school_id','=',schoolId).where('assessment_sittings.id','=',sittingId).executeTakeFirstOrThrow();
    const local=(await sql<{date:string;timezone:string}>`SELECT (${sitting.starts_at}::timestamptz AT TIME ZONE timezone)::date::text AS date,
      timezone FROM schools WHERE id=${schoolId}::uuid`.execute(tx)).rows[0]!;
    const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService['policyProjection']>;
    const people=(await sql<OwnedParticipationPerson>`SELECT candidate.student_id,person.id AS person_id,
        concat_ws(' ',person.first_name,person.last_name) AS label,person.revision AS person_revision,
        candidate.id::text AS source_ref,COALESCE(candidate.offering_enrollment_revision,enrollment.revision,1) AS source_revision,
        ${policy.require_all_candidate_attendance}::boolean AS required
      FROM assessment_sitting_candidates candidate LEFT JOIN students student ON student.id=candidate.student_id AND student.school_id=candidate.school_id
      JOIN school_people person ON person.id=COALESCE(candidate.person_id,student.person_id) AND person.school_id=candidate.school_id
      LEFT JOIN enrollments enrollment ON enrollment.id=candidate.enrollment_id
      WHERE candidate.school_id=${schoolId}::uuid AND candidate.sitting_id=${sittingId}::uuid ORDER BY candidate.id`.execute(tx)).rows;
    const context:OwnedParticipationContext={school_id:schoolId,source:'examination',source_id:sitting.id,context_ref:sitting.assessment_id,
      title:sitting.title,...local,starts_at:sitting.starts_at,ends_at:sitting.ends_at,space_id:sitting.space_id,
      revision:sitting.revision,locked:sitting.state==='completed',locked_by:sitting.completed_by,locked_at:sitting.completed_at};
    return {context,people};
  }

  private async administrator(user:AuthUser,schoolId:string,db:Db=this.db){
    uuid.parse(schoolId);
    if(user.active_school_id&&user.active_school_id!==schoolId)throw new ForbiddenException('Choose this institution before changing its examination.');
    const active=await db.selectFrom('users').select('id').where('id','=',user.id).where('is_active','=',true).executeTakeFirst();
    if(!active)throw new ForbiddenException('An active account is required.');
    const membership=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("role","=","admin").where("is_active","=",true).executeTakeFirst();
    if(!membership) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async access(user:AuthUser,schoolId:string,sittingId:string,db:Db=this.db,acceptedOnly=true){
    if(user.active_school_id&&user.active_school_id!==schoolId)throw new ForbiddenException('Choose this institution before opening its examination.');
    const active=await db.selectFrom('users').select('id').where('id','=',user.id).where('is_active','=',true).executeTakeFirst();
    if(!active)throw new ForbiddenException('An active account is required.');
    const admin=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("role","=","admin").where("is_active","=",true).executeTakeFirst();
    if(admin) return "admin" as const;
    let query=db.selectFrom("assessment_sitting_invigilators").innerJoin("school_memberships",join=>join.onRef("school_memberships.school_id","=","assessment_sitting_invigilators.school_id").onRef("school_memberships.user_id","=","assessment_sitting_invigilators.user_id")).select("assessment_sitting_invigilators.status").where("assessment_sitting_invigilators.school_id","=",schoolId).where("assessment_sitting_invigilators.sitting_id","=",sittingId).where("assessment_sitting_invigilators.user_id","=",user.id).where("school_memberships.is_active","=",true).where("school_memberships.role","in",["staff","admin"]);
    if(acceptedOnly) query=query.where("assessment_sitting_invigilators.status","=","accepted");
    else query=query.where("assessment_sitting_invigilators.status","in",["offered","accepted"]);
    const assignment=await query.executeTakeFirst();
    if(!assignment) throw new ForbiddenException(acceptedOnly?"Only an accepted invigilator or administrator can do this.":"This examination sitting is not assigned to you.");
    return "invigilator" as const;
  }

  private policyProjection(row:{readiness_minutes_before:number;attendance_close_after_minutes:number;minimum_invigilators:number;require_all_candidate_attendance:boolean;post_completion_marking_mode:"manual"|"automatic";revision:number}){
    return {readiness_minutes_before:row.readiness_minutes_before,attendance_close_after_minutes:row.attendance_close_after_minutes,minimum_invigilators:row.minimum_invigilators,require_all_candidate_attendance:row.require_all_candidate_attendance,post_completion_marking_mode:row.post_completion_marking_mode,revision:row.revision};
  }

  private async policyRow(db:Db,schoolId:string,lock=false){
    let query=db.selectFrom("assessment_operation_policies").selectAll().where("school_id","=",schoolId);
    if(lock) query=query.forUpdate();
    const policy=await query.executeTakeFirst();
    if(!policy) throw new NotFoundException("Examination operating policy is not configured for this institution.");
    return policy;
  }

  async policy(user:AuthUser,schoolId:string){ await this.administrator(user,schoolId); return this.policyProjection(await this.policyRow(this.db,schoolId)); }

  async savePolicy(user:AuthUser,schoolId:string,body:unknown){
    const data=examPolicyInput.parse(body);
    return this.db.transaction().execute(async db=>{
      await this.administrator(user,schoolId,db);
      const current=await this.policyRow(db,schoolId,true);
      if(current.revision!==data.expected_revision) throw new ConflictException("Examination rules changed. Refresh before saving.");
      const updated=await db.updateTable("assessment_operation_policies").set({readiness_minutes_before:data.readiness_minutes_before,attendance_close_after_minutes:data.attendance_close_after_minutes,minimum_invigilators:data.minimum_invigilators,require_all_candidate_attendance:data.require_all_candidate_attendance,post_completion_marking_mode:data.post_completion_marking_mode,revision:current.revision+1,updated_by:user.id,updated_at:executionNow()}).where("school_id","=",schoolId).where("revision","=",current.revision).returningAll().executeTakeFirst();
      if(!updated) throw new ConflictException("Examination rules changed. Refresh before saving.");
      await this.audit(db,user,schoolId,null,null,"assessment.exam_policy.updated",String(current.revision),String(updated.revision),{policy:this.policyProjection(updated)});
      return this.policyProjection(updated);
    });
  }

  private async audit(db:Db,user:AuthUser,schoolId:string,assessmentId:string|null,sittingId:string|null,action:string,fromState:string|null,toState:string|null,metadata:Record<string,unknown>={}){
    await db.insertInto("assessment_operation_audits").values({school_id:schoolId,assessment_id:assessmentId,sitting_id:sittingId,actor_id:user.id,action,from_state:fromState,to_state:toState,metadata}).execute();
  }

  private async audience(db:Db,schoolId:string,sittingId:string){
    return (await sql<{user_id:string}>`
      SELECT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
      UNION SELECT assignment.user_id FROM assessment_sitting_invigilators assignment
      JOIN school_memberships membership ON membership.school_id=assignment.school_id AND membership.user_id=assignment.user_id AND membership.is_active
      JOIN users account ON account.id=assignment.user_id AND account.is_active
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.sitting_id=${sittingId}::uuid AND assignment.status IN ('offered','accepted')
    `.execute(db)).rows.map(row=>row.user_id);
  }

  private async emit(db:Db,schoolId:string,sittingId:string,assessmentId:string,action:string,revision:number,eventIdentity=action,additionalAudienceUserIds:string[]=[]){
    const candidates=action==='schedule'?(await sql<{user_id:string}>`SELECT student.user_id FROM assessment_sitting_candidates candidate
      JOIN students student ON student.id=candidate.student_id AND student.school_id=candidate.school_id
      WHERE candidate.school_id=${schoolId}::uuid AND candidate.sitting_id=${sittingId}::uuid AND student.user_id IS NOT NULL
      UNION SELECT parent.user_id FROM assessment_sitting_candidates candidate JOIN guardian_relationships relationship
        ON relationship.school_id=candidate.school_id AND relationship.student_id=candidate.student_id
      JOIN parents parent ON parent.id=relationship.guardian_id WHERE candidate.school_id=${schoolId}::uuid
        AND candidate.sitting_id=${sittingId}::uuid AND parent.user_id IS NOT NULL
      UNION SELECT endpoint.user_id FROM assessment_sitting_candidates candidate
      JOIN campus_model_current_account_endpoints(${schoolId}::uuid,NULL,${executionNow()}::timestamptz) endpoint
        ON endpoint.school_id=candidate.school_id AND endpoint.person_id=candidate.person_id
      WHERE candidate.school_id=${schoolId}::uuid AND candidate.sitting_id=${sittingId}::uuid`.execute(db)).rows.map(row=>row.user_id):[];
    const audienceUserIds=[...new Set([...await this.audience(db,schoolId,sittingId),...additionalAudienceUserIds,...candidates])];
    await this.events.enqueueUserEvent(db,{schoolId,eventType:"assessment.updated",aggregateType:"assessment_sitting",aggregateId:sittingId,audienceUserIds,payload:{assessment_id:assessmentId,sitting_id:sittingId,action,state_action:action,revision,refresh:["assessments","teacher.home","principal.home","requests","notifications","attention","calendar","campus-view","activities","attendance","workspace","today"]},idempotencyKey:`assessment-sitting:${sittingId}:${eventIdentity}:${revision}`});
    return (await sql<{id:string}>`SELECT id FROM event_outbox WHERE school_id=${schoolId}::uuid AND idempotency_key=${`assessment-sitting:${sittingId}:${eventIdentity}:${revision}`}`.execute(db)).rows[0]!.id;
  }

  private async modelSnapshot(
    db:Db,
    actorUserId:string,
    assessmentId:string,
    sitting:Selectable<AssessmentSittingTable>,
  ):Promise<ExamSittingModelSnapshot>{
    const context=(await sql<{
      school_id:string; title:string; class_label:string; subject_label:string;
      space_id:string; space_name:string; space_kind:string; space_revision:number; expected_count:number;
    }>`SELECT assessment.school_id,assessment.title,
        COALESCE(offering.name,'Class '||section.grade||section.section) AS class_label,
        subject.name AS subject_label,space.id AS space_id,space.name AS space_name,
        space.kind AS space_kind,
        space.revision AS space_revision,
        (SELECT count(*)::int FROM assessment_sitting_candidates candidate
          WHERE candidate.sitting_id=${sitting.id}::uuid) AS expected_count
      FROM assessments assessment
      LEFT JOIN class_sections section ON section.id=assessment.class_section_id
      LEFT JOIN learning_offerings offering ON offering.school_id=assessment.school_id AND offering.id=assessment.offering_id
      JOIN subjects subject ON subject.id=assessment.subject_id
      JOIN campus_spaces space ON space.id=${sitting.space_id}::uuid
        AND space.school_id=assessment.school_id
      WHERE assessment.id=${assessmentId}::uuid`.execute(db)).rows[0];
    if(!context) throw new NotFoundException("The examination sitting context could not be projected.");
    return {
      schoolId:context.school_id,
      actorUserId,
      assessmentId,
      sittingId:sitting.id,
      title:context.title,
      classLabel:context.class_label,
      subjectLabel:context.subject_label,
      state:sitting.state,
      scheduledStart:new Date(sitting.starts_at).toISOString(),
      scheduledEnd:new Date(sitting.ends_at).toISOString(),
      expectedCount:context.expected_count,
      sittingRevision:sitting.revision,
      policyRevision:sitting.policy_revision,
      space:{id:context.space_id,name:context.space_name,kind:context.space_kind,revision:context.space_revision},
    };
  }

  async createForAssessment(db:Db,user:AuthUser,assessment:AssessmentRecord,input:{space_id:string;invigilator_user_ids:string[]}){
    if(!isPhysicalAssessment(assessment.assessment_kind)) throw new BadRequestException("A physical sitting is available only for an exam, practical or viva.");
    if(!assessment.scheduled_at||!assessment.duration_minutes) throw new BadRequestException("Choose the examination date, start time and duration before placing it in a campus space.");
    const invigilators=[...new Set(input.invigilator_user_ids)];
    if(!invigilators.length) throw new BadRequestException("Assign at least one invigilator.");
    if(invigilators.length!==input.invigilator_user_ids.length) throw new BadRequestException("Each invigilator can be assigned only once.");
    const space=await db.selectFrom("campus_spaces").select(["id","campus_id","name","capacity","is_bookable","status"]).where("school_id","=",assessment.school_id).where("id","=",input.space_id).executeTakeFirst();
    if(!space||space.status!=="active"||!space.is_bookable) throw new BadRequestException("Choose an active bookable campus space.");
    const eligible=(await sql<{count:number}>`SELECT count(DISTINCT membership.user_id)::int AS count FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active WHERE membership.school_id=${assessment.school_id}::uuid AND membership.user_id=ANY(${invigilators}::uuid[]) AND membership.role IN ('staff','admin') AND membership.is_active`.execute(db)).rows[0]?.count??0;
    if(eligible!==invigilators.length) throw new BadRequestException("Every invigilator must have active staff access to this institution.");
    const policy=await this.policyRow(db,assessment.school_id,true);
    const startsAt=assertFutureExamStart(assessment.scheduled_at);
    const endsAt=new Date(startsAt.getTime()+assessment.duration_minutes*60_000);
    let sitting;
    try{
      sitting=await db.insertInto("assessment_sittings").values({school_id:assessment.school_id,assessment_id:assessment.id,campus_id:space.campus_id,space_id:space.id,starts_at:startsAt,ends_at:endsAt,policy_revision:policy.revision,policy_snapshot:this.policyProjection(policy),created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
    }catch(error){ if((error as {code?:string}).code==="23505") throw new ConflictException("This assessment already has a physical sitting."); throw error; }
    const assignments=await db.insertInto("assessment_sitting_invigilators").values(invigilators.map(userId=>({school_id:assessment.school_id,sitting_id:sitting.id,assessment_id:assessment.id,user_id:userId,assigned_by:user.id}))).returningAll().execute();
    for(const assignment of assignments) await this.invigilationOffers.publishOffer(db as Transaction<Database>,{
      school_id:assessment.school_id,
      actor_user_id:user.id,
      assignment_id:assignment.id,
      source_assignment_revision:assignment.revision,
    });
    await this.audit(db,user,assessment.school_id,assessment.id,sitting.id,"assessment.sitting.created",null,"planning",{space_id:space.id,invigilator_user_ids:invigilators,policy_revision:policy.revision});
    await this.emit(db,assessment.school_id,sitting.id,assessment.id,"sitting.created",sitting.revision);
    return sitting;
  }

  async createSitting(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=sittingInput.parse(body);
    return this.db.transaction().execute(async db=>{
      await this.administrator(user,schoolId,db);
      const assessment=await db.selectFrom("assessments").selectAll().where("school_id","=",schoolId).where("id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!assessment) throw new NotFoundException("Assessment not found.");
      if(assessment.status!=="draft") throw new ConflictException("A physical sitting can be added only while the assessment is a draft.");
      return this.createForAssessment(db,user,assessment,data);
    });
  }

  async updateArrangements(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=sittingArrangementInput.parse(body);
    return this.db.transaction().execute(db=>this.updateArrangementsIn(db,user,schoolId,assessmentId,data));
  }

  private async updateArrangementsIn(db:Transaction<Database>,user:AuthUser,schoolId:string,assessmentId:string,
    data:z.infer<typeof sittingArrangementInput>,amendment?:{reason:string;commandId:string;commandKey:string;correlationId:string}){
      await this.administrator(user,schoolId,db);
      const assessment=await db.selectFrom("assessments").selectAll().where("school_id","=",schoolId).where("id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!assessment) throw new NotFoundException("Assessment not found.");
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("This assessment does not have a physical sitting.");
      if(!amendment&&(assessment.status!=="draft"||sitting.state!=="planning")) throw new ConflictException("Exam arrangements can be changed only before the assessment is scheduled.");
      if(assessment.revision!==data.expected_assessment_revision||sitting.revision!==data.expected_sitting_revision) throw new ConflictException("These exam arrangements changed. Refresh before saving.");

      if(amendment)await this.assertAmendable(db,assessment,sitting);
      const space=await db.selectFrom("campus_spaces").select(["id","campus_id","name","status","is_bookable"]).where("school_id","=",schoolId).where("id","=",data.space_id).executeTakeFirst();
      if(!space||space.status!=="active"||!space.is_bookable) throw new BadRequestException("Choose an active bookable campus space.");
      const eligible=(await sql<{count:number}>`SELECT count(DISTINCT membership.user_id)::int AS count
        FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=ANY(${data.invigilator_user_ids}::uuid[])
          AND membership.role IN ('staff','admin') AND membership.is_active`.execute(db)).rows[0]?.count??0;
      if(eligible!==data.invigilator_user_ids.length) throw new BadRequestException("Every invigilator must have active staff access to this institution.");

      const startsAt=assertFutureExamStart(data.scheduled_at);
      const endsAt=new Date(startsAt.getTime()+data.duration_minutes*60_000);
      const timingOrSpaceChanged=new Date(sitting.starts_at).getTime()!==startsAt.getTime()
        || new Date(sitting.ends_at).getTime()!==endsAt.getTime()
        || sitting.space_id!==space.id;
      const existing=await db.selectFrom("assessment_sitting_invigilators").selectAll().where("sitting_id","=",sitting.id).forUpdate().execute();
      const selected=new Set(data.invigilator_user_ids);
      const now=executionNow();
      const offersToPublish:Selectable<AssessmentSittingInvigilatorTable>[]=[];
      for(const assignment of existing){
        if(!selected.has(assignment.user_id)){
          if(assignment.status!=="revoked"){
            if(assignment.status==="offered") await this.invigilationOffers.cancelOpenOffer(db,{
              school_id:schoolId,
              assignment_id:assignment.id,
              source_assignment_revision:assignment.revision,
              occurred_at:now.toISOString(),
              reason:"The administrator removed this invigilation duty before it was answered.",
            });
            await db.updateTable("assessment_sitting_invigilators").set({status:"revoked",response_note:"Removed when the examination arrangements changed.",responded_at:now,revision:assignment.revision+1,updated_at:now}).where("id","=",assignment.id).execute();
          }
          continue;
        }
        const invitationChanged=assignment.status==='offered'&&(await this.invigilationOffers.invitationStatus(db,{
          school_id:schoolId,assignment_id:assignment.id,assignment_revision:assignment.revision,user_id:assignment.user_id})).state!=='current';
        if(timingOrSpaceChanged||assignment.status==="declined"||assignment.status==="revoked"||invitationChanged){
          if(assignment.status==="offered") await this.invigilationOffers.cancelOpenOffer(db,{
            school_id:schoolId,
            assignment_id:assignment.id,
            source_assignment_revision:assignment.revision,
            occurred_at:now.toISOString(),
            reason:invitationChanged?'The invitation policy or response window changed, so the administrator explicitly reissued this duty.':"The examination time or room changed, so the previous invigilation Offer was replaced.",
          });
          const reset=await db.updateTable("assessment_sitting_invigilators").set({status:"offered",response_note:"",responded_at:null,assigned_by:user.id,assigned_at:now,revision:assignment.revision+1,updated_at:now}).where("id","=",assignment.id).returningAll().executeTakeFirstOrThrow();
          offersToPublish.push(reset);
        }
      }
      const existingIds=new Set(existing.map(item=>item.user_id));
      const added=data.invigilator_user_ids.filter(id=>!existingIds.has(id));
      if(added.length) offersToPublish.push(...await db.insertInto("assessment_sitting_invigilators").values(added.map(userId=>({school_id:schoolId,sitting_id:sitting.id,assessment_id:assessmentId,user_id:userId,assigned_by:user.id}))).returningAll().execute());

      const updatedAssessment=await db.updateTable("assessments").set({scheduled_at:startsAt,duration_minutes:data.duration_minutes,venue:space.name,revision:assessment.revision+1,updated_by:user.id,updated_at:now}).where("id","=",assessment.id).where("revision","=",assessment.revision).returningAll().executeTakeFirst();
      const updatedSitting=await db.updateTable("assessment_sittings").set({...(amendment?{state:"planning" as const}:{}),campus_id:space.campus_id,space_id:space.id,starts_at:startsAt,ends_at:endsAt,revision:sitting.revision+1,updated_by:user.id,updated_at:now}).where("id","=",sitting.id).where("revision","=",sitting.revision).returningAll().executeTakeFirst();
      if(!updatedAssessment||!updatedSitting) throw new ConflictException("These exam arrangements changed. Refresh before saving.");
      for(const assignment of offersToPublish) await this.invigilationOffers.publishOffer(db,{
        school_id:schoolId,
        actor_user_id:user.id,
        assignment_id:assignment.id,
        source_assignment_revision:assignment.revision,
      });
      await this.audit(db,user,schoolId,assessmentId,sitting.id,amendment?"assessment.sitting.schedule_amended":"assessment.sitting.arrangements_updated",sitting.state,updatedSitting.state,{
        previous:{scheduled_at:new Date(sitting.starts_at).toISOString(),ends_at:new Date(sitting.ends_at).toISOString(),space_id:sitting.space_id,invigilator_user_ids:existing.filter(item=>item.status!=="revoked").map(item=>item.user_id)},
        current:{scheduled_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),space_id:space.id,invigilator_user_ids:data.invigilator_user_ids},
        confirmations_reset:timingOrSpaceChanged,...(amendment?{reason:amendment.reason,command_id:amendment.commandId}:{}),
      });
      if(amendment){
        await this.projectPlan(db,user,updatedSitting,amendment.correlationId,'cancelled',{commandId:amendment.commandId,expectedRevision:sitting.revision});
        const previous=await this.scheduleSnapshot(db,assessment,sitting,existing.filter(row=>row.status!=='revoked').map(row=>row.user_id));
        const current=await this.scheduleSnapshot(db,updatedAssessment,updatedSitting,data.invigilator_user_ids);
        await sql`INSERT INTO assessment_schedule_revisions(school_id,assessment_id,sitting_id,revision,actor_user_id,command_id,command_key,action,reason,previous_snapshot,snapshot,recorded_at)
          VALUES(${schoolId}::uuid,${assessmentId}::uuid,${sitting.id}::uuid,${updatedSitting.revision},${user.id}::uuid,${amendment.commandId}::uuid,
            ${amendment.commandKey}::uuid,'amended',${amendment.reason},${JSON.stringify(previous)}::jsonb,${JSON.stringify(current)}::jsonb,${now})`.execute(db);
      }
      const eventId=await this.emit(db,schoolId,sitting.id,assessmentId,amendment?'schedule':"sitting.arrangements_updated",updatedSitting.revision,
        amendment?'schedule.amended':"sitting.arrangements_updated",existing.filter(item=>item.status!=="revoked").map(item=>item.user_id));
      return {assessment:updatedAssessment,sitting:updatedSitting,...(amendment?{command_id:amendment.commandKey,event_id:eventId,schedule_state:"awaiting_confirmation"}:{} )};
  }

  private async assertAmendable(db:Db,current:AssessmentRecord,sitting:Selectable<AssessmentSittingTable>){
    if(current.status!=='scheduled'||!['ready','planning'].includes(sitting.state)||!sitting.roster_frozen_at||sitting.started_at||sitting.completed_at
      ||new Date(sitting.starts_at).getTime()<=executionNow().getTime())throw new ConflictException('Only a future, never-started scheduled examination can have its arrangements revised.');
    const evidence=(await sql<{recorded:boolean}>`SELECT
      EXISTS(SELECT 1 FROM assessment_candidate_attendance WHERE school_id=${current.school_id}::uuid AND sitting_id=${sitting.id}::uuid AND status<>'unrecorded')
      OR EXISTS(SELECT 1 FROM assessment_sitting_incidents WHERE school_id=${current.school_id}::uuid AND sitting_id=${sitting.id}::uuid)
      OR EXISTS(SELECT 1 FROM activity_attendance_registers register JOIN activity_attendance_commands command ON command.register_id=register.id
        WHERE register.school_id=${current.school_id}::uuid AND register.context_source_kind='examination' AND register.context_source_id=${sitting.id})
      OR EXISTS(SELECT 1 FROM activity_attendance_registers register JOIN activity_attendance_entries entry ON entry.register_id=register.id
        WHERE register.school_id=${current.school_id}::uuid AND register.context_source_kind='examination' AND register.context_source_id=${sitting.id}) AS recorded`.execute(db)).rows[0];
    if(evidence?.recorded)throw new ConflictException('An examination with recorded participation or incidents cannot be rescheduled.');
  }

  private async scheduleSnapshot(db:Db,current:AssessmentRecord,sitting:Selectable<AssessmentSittingTable>,invigilatorIds?:string[]){
    const staff=invigilatorIds??(await db.selectFrom('assessment_sitting_invigilators').select('user_id').where('school_id','=',current.school_id)
      .where('sitting_id','=',sitting.id).where('status','!=','revoked').execute()).map(row=>row.user_id);
    return {assessment_id:current.id,sitting_id:sitting.id,assessment_revision:current.revision,revision:sitting.revision,
      scheduled_at:new Date(sitting.starts_at).toISOString(),ends_at:new Date(sitting.ends_at).toISOString(),space_id:sitting.space_id,
      duration_minutes:current.duration_minutes,invigilator_user_ids:[...staff].sort(),state:sitting.state,
      candidate_ids:(await db.selectFrom('assessment_sitting_candidates').select('id').where('school_id','=',current.school_id)
        .where('sitting_id','=',sitting.id).orderBy('id').execute()).map(row=>row.id)};
  }

  private async amendmentPreviewIn(db:Db,current:AssessmentRecord,sitting:Selectable<AssessmentSittingTable>,data:z.infer<typeof scheduleAmendmentPreviewInput>){
    await this.assertAmendable(db,current,sitting);
    if(current.revision!==data.expected_assessment_revision||sitting.revision!==data.expected_sitting_revision)
      throw new ConflictException('These examination arrangements changed. Review the current schedule before publishing a revision.');
    const starts=assertFutureExamStart(data.scheduled_at),ends=new Date(starts.getTime()+data.duration_minutes*60000);
    const selected=[...data.invigilator_user_ids].sort();
    const eligible=(await sql<{count:number}>`SELECT count(DISTINCT member.user_id)::int AS count FROM school_memberships member
      JOIN users account ON account.id=member.user_id AND account.is_active WHERE member.school_id=${current.school_id}::uuid
      AND member.user_id=ANY(${selected}::uuid[]) AND member.is_active AND member.role IN('staff','admin')`.execute(db)).rows[0]!.count;
    if(eligible!==selected.length)throw new BadRequestException('Choose current active staff as invigilators.');
    const room=await db.selectFrom('campus_spaces').select(['id','name','campus_id','capacity','revision']).where('school_id','=',current.school_id)
      .where('id','=',data.space_id).where('status','=','active').where('is_bookable','=',true).executeTakeFirst();
    if(!room)throw new BadRequestException('Choose a current bookable examination room.');
    const previous=await this.scheduleSnapshot(db,current,sitting);
    const material=new Date(sitting.starts_at).getTime()!==starts.getTime()||new Date(sitting.ends_at).getTime()!==ends.getTime()||sitting.space_id!==room.id;
    const assignments=await db.selectFrom('assessment_sitting_invigilators').select(['id','user_id','status','revision']).where('school_id','=',current.school_id)
      .where('sitting_id','=',sitting.id).orderBy('id').execute();
    if(!material&&JSON.stringify(previous.invigilator_user_ids)===JSON.stringify(selected)
      &&assignments.every(row=>row.status==='accepted'||row.status==='revoked'))throw new BadRequestException('Change the time, room or invigilation duty before publishing a revision.');
    const proposed={...sitting,space_id:room.id,campus_id:room.campus_id,starts_at:starts,ends_at:ends};
    const readiness=await this.readinessSnapshot(db,{...current,scheduled_at:starts,duration_minutes:data.duration_minutes},proposed,
      {invigilatorIds:selected,resetAcceptances:material});
    const changedInvigilators=selected.filter(id=>material||!assignments.some(row=>row.user_id===id&&row.status==='accepted'));
    const result={previous,proposed:{scheduled_at:starts.toISOString(),ends_at:ends.toISOString(),duration_minutes:data.duration_minutes,
      space_id:room.id,space_name:room.name,invigilator_user_ids:selected},candidate_count:previous.candidate_ids.length,
      reissued_invigilator_user_ids:changedInvigilators,removed_invigilator_user_ids:previous.invigilator_user_ids.filter(id=>!selected.includes(id)),
      blockers:readiness.blockers.filter(row=>row.code!=='invigilators'),confirmation_message:'The revised schedule replaces the current one. Invigilators must confirm changed duties before the sitting can become ready.',
      reason:data.reason};
    return {...result,can_publish:result.blockers.length===0,preview_hash:createHash('sha256').update(JSON.stringify({result,assignments,room_revision:room.revision})).digest('hex')};
  }

  async previewScheduleAmendment(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=scheduleAmendmentPreviewInput.parse(body);
    return this.db.transaction().execute(async db=>{
      await this.administrator(user,schoolId,db);
      const current=await db.selectFrom('assessments').selectAll().where('school_id','=',schoolId).where('id','=',assessmentId).executeTakeFirst();
      const sitting=await db.selectFrom('assessment_sittings').selectAll().where('school_id','=',schoolId).where('assessment_id','=',assessmentId).executeTakeFirst();
      if(!current||!sitting)throw new NotFoundException('Examination sitting not found.');
      return this.amendmentPreviewIn(db,current,sitting,data);
    });
  }

  async amendSchedule(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=scheduleAmendmentInput.parse(body);
    return this.scheduleCommand(user,schoolId,assessmentId,'amend',data);
  }

  async confirmScheduleAmendment(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=z.object({command_id:uuid,expected_assessment_revision:z.number().int().positive(),expected_sitting_revision:z.number().int().positive(),
      reason:z.string().trim().min(3).max(1000)}).strict().parse(body);
    return this.scheduleCommand(user,schoolId,assessmentId,'confirm',data);
  }

  private async scheduleCommand(user:AuthUser,schoolId:string,assessmentId:string,action:'amend'|'confirm',data:{command_id:string;expected_assessment_revision:number;
    expected_sitting_revision:number;reason:string}&Partial<z.infer<typeof scheduleAmendmentInput>>){
    const hash=createHash('sha256').update(JSON.stringify({action,assessment_id:assessmentId,...data,
      ...(data.invigilator_user_ids?{invigilator_user_ids:[...data.invigilator_user_ids].sort()}: {})})).digest('hex');
    let refusal:HttpException|undefined;
    const result=await this.db.transaction().execute(async db=>{
      await this.administrator(user,schoolId,db);
      await lockSchedule(db,schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`exam-schedule-command:${schoolId}:${user.id}:${data.command_id}`},0))`.execute(db);
      const prior=(await sql<{request_hash:string;result:Record<string,unknown>}>`SELECT request_hash,result FROM day_plan_commands
        WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND command_key=${data.command_id}::uuid`.execute(db)).rows[0];
      if(prior){
        if(prior.request_hash!==hash)throw new ConflictException('This command identity belongs to different examination arrangements.');
        if(prior.result.exam_schedule_refusal){refusal=new HttpException(prior.result.exam_schedule_refusal as Record<string,unknown>,409);return null;}
        return prior.result;
      }
      const current=await db.selectFrom('assessments').selectAll().where('school_id','=',schoolId).where('id','=',assessmentId).forUpdate().executeTakeFirst();
      const sitting=await db.selectFrom('assessment_sittings').selectAll().where('school_id','=',schoolId).where('assessment_id','=',assessmentId).forUpdate().executeTakeFirst();
      if(!current||!sitting)throw new NotFoundException('Examination sitting not found.');
      const correlationId=randomUUID();
      const command=await this.commands.prepareDomainCommand(db,{school_id:schoolId,actor_user_id:user.id,command_type:`examination.sitting.${action}`,
        handler_key:'assessments.schedule_amendments',handler_version:1,source_domain:'assessments',
        target:{kind:'exam_sitting',domain:'assessments',domain_id:sitting.id,label:'Physical examination sitting',lifecycle_state:'planned',source_revision:sitting.revision,metadata:{}},
        current_revision:sitting.revision,expected_revision:sitting.revision,capability:'assessments.manage',purpose:`${action}_future_examination_schedule`,
        requested_at:executionNow().toISOString(),correlation_id:correlationId,causation_id:null,idempotency_key:`exam-schedule:${user.id}:${data.command_id}`,
        operating_rule_version_ref:`assessment_operation_policy:${sitting.policy_revision}`,configuration_refs:[{kind:'assessment_operation_policy',ref:schoolId,version:String(sitting.policy_revision)}],
        authority_attestation:{evaluator_domain:'assessments',decision:'allowed',reason_codes:['current_institution_administrator'],
          authority_source_refs:[{school_id:schoolId,user_id:user.id,assessment_id:assessmentId,assessment_revision:current.revision}],
          operating_rule_refs:[{policy_revision:sitting.policy_revision}],valid_until:null},
        safe_context:{assessment_id:assessmentId,sitting_id:sitting.id,expected_assessment_revision:data.expected_assessment_revision,
          expected_sitting_revision:data.expected_sitting_revision,request_hash:hash,operation:action}});
      if(command.status!=='ready')throw new ConflictException('This examination command needs its retained domain receipt.');
      await sql`SAVEPOINT exam_schedule_native_effects`.execute(db);
      try{
        await this.assertAmendable(db,current,sitting);
        if(current.revision!==data.expected_assessment_revision||sitting.revision!==data.expected_sitting_revision)
          throw new ConflictException('These examination arrangements changed. Review the saved schedule before continuing.');
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assessment-exam-schedule:${schoolId}`},0))`.execute(db);
        let accepted:Record<string,unknown>;
        if(action==='amend'){
          const input=scheduleAmendmentInput.parse(data),preview=await this.amendmentPreviewIn(db,current,sitting,input);
          if(input.preview_hash!==preview.preview_hash)throw new ConflictException('The schedule impact changed. Review the current impact before publishing.');
          if(!preview.can_publish)throw new ConflictException(preview.blockers[0]!.message);
          accepted=await this.updateArrangementsIn(db,user,schoolId,assessmentId,input,{reason:data.reason,commandId:command.command_id,
            commandKey:data.command_id,correlationId});
        }else{
          if(sitting.state!=='planning'||!(await sql`SELECT 1 FROM assessment_schedule_revisions WHERE school_id=${schoolId}::uuid
            AND sitting_id=${sitting.id}::uuid AND action='amended'`.execute(db)).rows.length)
            throw new ConflictException('Only a revised schedule awaiting confirmation can be confirmed.');
          const readiness=await this.readinessSnapshot(db,current,sitting);
          if(!readiness.can_schedule)throw new ConflictException(readiness.blockers[0]!.message);
          const previous=await this.scheduleSnapshot(db,current,sitting);
          const now=executionNow();
          const updatedSitting=await db.updateTable('assessment_sittings').set({state:'ready',revision:sitting.revision+1,updated_by:user.id,updated_at:now})
            .where('id','=',sitting.id).returningAll().executeTakeFirstOrThrow();
          const updatedAssessment=await db.updateTable('assessments').set({revision:current.revision+1,updated_by:user.id,updated_at:now})
            .where('id','=',current.id).returningAll().executeTakeFirstOrThrow();
          await this.projectPlan(db,user,updatedSitting,correlationId,'expected',{commandId:command.command_id,expectedRevision:sitting.revision});
          const snapshot=await this.scheduleSnapshot(db,updatedAssessment,updatedSitting);
          await sql`INSERT INTO assessment_schedule_revisions(school_id,assessment_id,sitting_id,revision,actor_user_id,command_id,command_key,action,reason,previous_snapshot,snapshot,recorded_at)
            VALUES(${schoolId}::uuid,${assessmentId}::uuid,${sitting.id}::uuid,${updatedSitting.revision},${user.id}::uuid,${command.command_id}::uuid,
              ${data.command_id}::uuid,'confirmed',${data.reason},${JSON.stringify(previous)}::jsonb,${JSON.stringify(snapshot)}::jsonb,${now})`.execute(db);
          await this.audit(db,user,schoolId,assessmentId,sitting.id,'assessment.sitting.schedule_confirmed','planning','ready',{reason:data.reason,command_id:command.command_id});
          const event=await this.emit(db,schoolId,sitting.id,assessmentId,'schedule',updatedSitting.revision,'schedule.confirmed');
          accepted={assessment:updatedAssessment,sitting:updatedSitting,command_id:data.command_id,event_id:event,schedule_state:'ready'};
        }
        accepted=JSON.parse(JSON.stringify(accepted)) as Record<string,unknown>;
        await this.commands.completeDomainCommand(db,{school_id:schoolId,command_id:command.command_id,terminal_state:'accepted',
          code:action==='amend'?'exam_schedule_amended':'exam_schedule_confirmed',explanation:action==='amend'?'The revised schedule is published and awaits current invigilation confirmation.':'The revised schedule is ready after current staffing and conflict checks.',
          resulting_revision:sitting.revision+1,domain_event_id:String(accepted.event_id),metadata:{assessment_id:assessmentId,sitting_id:sitting.id,
            domain_command_key:data.command_id},completed_at:executionNow().toISOString()});
        await sql`RELEASE SAVEPOINT exam_schedule_native_effects`.execute(db);
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
          ${data.command_id}::uuid,${hash},${JSON.stringify(accepted)}::jsonb)`.execute(db);
        return accepted;
      }catch(error){
        if(!(error instanceof HttpException)||![400,403,409,422].includes(error.getStatus()))throw error;
        await sql`ROLLBACK TO SAVEPOINT exam_schedule_native_effects`.execute(db);await sql`RELEASE SAVEPOINT exam_schedule_native_effects`.execute(db);
        const refused={message:error.message,code:'exam_schedule_command_refused',fields:{command_id:data.command_id,school_id:schoolId,actor_user_id:user.id,assessment_id:assessmentId,
          sitting_id:sitting.id,action,expected_assessment_revision:data.expected_assessment_revision,expected_sitting_revision:data.expected_sitting_revision}};
        await this.commands.completeDomainCommand(db,{school_id:schoolId,command_id:command.command_id,terminal_state:error.getStatus()===409?'conflicted':'rejected',
          code:'exam_schedule_invariant_refused',explanation:'The owning examination rules refused this exact schedule command; no arrangements, candidates or commitments changed.',
          resulting_revision:sitting.revision,domain_event_id:null,metadata:{assessment_id:assessmentId,sitting_id:sitting.id},completed_at:executionNow().toISOString()});
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
          ${data.command_id}::uuid,${hash},${JSON.stringify({exam_schedule_refusal:refused})}::jsonb)`.execute(db);
        refusal=new HttpException(refused,409);return null;
      }
    });
    if(refusal)throw refusal;
    return result;
  }

  private async datedCandidates(db:Db,current:AssessmentRecord,termId:string,asOf:string){
    if(current.offering_id){
      const roster=await datedOfferingRoster(db,current.school_id,current.offering_id,termId,asOf);
      return roster.map(row=>({student_id:null,enrollment_id:null,roll_number_snapshot:null,person_id:row.person_id,
        offering_id:current.offering_id,offering_enrollment_id:row.academic_roster_source.enrollment_id,
        offering_enrollment_revision:row.academic_roster_source.enrollment_revision,roster_on:asOf}));
    }
    if(!current.class_section_id)return [];
    const roster=await datedAcademicRoster(db,current.school_id,current.class_section_id,termId,asOf);
    return roster.map(row=>({student_id:row.student_id,enrollment_id:row.enrollment_id,roll_number_snapshot:row.roll_number,
      person_id:null,offering_id:null,offering_enrollment_id:null,offering_enrollment_revision:null,roster_on:null}));
  }

  private async readinessSnapshot(db:Db,current:AssessmentRecord,sitting:Selectable<AssessmentSittingTable>,options?:{invigilatorIds:string[];resetAcceptances:boolean}):Promise<ExamReadiness>{
    const startsAt=new Date(current.scheduled_at??sitting.starts_at);
    const endsAt=new Date(startsAt.getTime()+(current.duration_minutes??0)*60_000);
    const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService["policyProjection"]>;
    const context=(await sql<{exam_date:string;cycle_start:string;cycle_end:string;term_id:string}>`
      SELECT (${startsAt}::timestamptz AT TIME ZONE school.timezone)::date::text AS exam_date,
        cycle.starts_on::text AS cycle_start,cycle.ends_on::text AS cycle_end,cycle.term_id
      FROM schools school
      JOIN assessment_cycles cycle ON cycle.school_id=school.id AND cycle.id=${current.cycle_id}::uuid
      WHERE school.id=${current.school_id}::uuid
    `.execute(db)).rows[0];
    const candidateCount=sitting.roster_frozen_at
      ?Number((await db.selectFrom('assessment_sitting_candidates').select(({fn})=>fn.countAll<number>().as('count')).where('school_id','=',current.school_id).where('sitting_id','=',sitting.id).executeTakeFirstOrThrow()).count)
      :context?(await this.datedCandidates(db,current,context.term_id,context.exam_date)).length:0;
    const space=await db.selectFrom("campus_spaces").select(["name","capacity","status","is_bookable"]).where("school_id","=",current.school_id).where("id","=",sitting.space_id).executeTakeFirst();
    const acceptedInvigilators=(await sql<{user_id:string;name:string;status:string}>`
      SELECT assignment.user_id,assignment.status,concat_ws(' ',account.first_name,account.last_name) AS name
      FROM assessment_sitting_invigilators assignment
      JOIN users account ON account.id=assignment.user_id AND account.is_active
      JOIN school_memberships membership ON membership.school_id=assignment.school_id
        AND membership.user_id=assignment.user_id AND membership.is_active
        AND membership.role IN ('staff','admin')
      WHERE assignment.school_id=${current.school_id}::uuid
        AND assignment.sitting_id=${sitting.id}::uuid AND ((${options?.invigilatorIds??null}::uuid[] IS NULL AND assignment.status='accepted') OR assignment.user_id=ANY(${options?.invigilatorIds??[]}::uuid[]))
      ORDER BY lower(concat_ws(' ',account.first_name,account.last_name)),assignment.user_id
    `.execute(db)).rows;
    const otherExams=(await sql<{id:string;title:string;room_conflict:boolean;class_conflict:boolean}>`
      SELECT other.id,other_assessment.title,
        other.space_id=${sitting.space_id}::uuid AS room_conflict,
        other_assessment.class_section_id=${current.class_section_id}::uuid AS class_conflict
      FROM assessment_sittings other
      JOIN assessments other_assessment ON other_assessment.id=other.assessment_id
        AND other_assessment.school_id=other.school_id
      WHERE other.school_id=${current.school_id}::uuid AND other.id<>${sitting.id}::uuid
        AND other.state IN ('ready','in_progress')
        AND (other.space_id=${sitting.space_id}::uuid
          OR other_assessment.class_section_id=${current.class_section_id}::uuid)
        AND other.starts_at<${endsAt}::timestamptz AND other.ends_at>${startsAt}::timestamptz
      ORDER BY other.starts_at,other.id
    `.execute(db)).rows;
    const checkedStaff=options?.invigilatorIds??acceptedInvigilators.map(row=>row.user_id);
    const otherInvigilation=(await sql<{id:string;title:string;user_id:string;name:string}>`
      SELECT other.id,other_assessment.title,assigned.user_id,concat_ws(' ',account.first_name,account.last_name) AS name
      FROM assessment_sitting_invigilators assigned JOIN assessment_sittings other ON other.id=assigned.sitting_id
      JOIN assessments other_assessment ON other_assessment.id=other.assessment_id AND other_assessment.school_id=other.school_id
      JOIN users account ON account.id=assigned.user_id
      WHERE assigned.school_id=${current.school_id}::uuid AND assigned.user_id=ANY(${checkedStaff}::uuid[]) AND assigned.status='accepted'
        AND other.state IN('ready','in_progress') AND other.id<>${sitting.id}::uuid
        AND other.starts_at<${endsAt}::timestamptz AND other.ends_at>${startsAt}::timestamptz
      ORDER BY assigned.user_id,other.starts_at,other.id`.execute(db)).rows;
    const acceptedIds=options?.invigilatorIds??acceptedInvigilators.map(row=>row.user_id);
    const acceptedCount=options?.resetAcceptances?0:acceptedInvigilators.filter(row=>row.status==='accepted').length;
    const timetableConflicts=(await sql<{
      id:string;occurrence_key:string;title:string;class_section_id:string;class_name:string;
      space_id:string|null;teacher_user_id:string|null;teacher_name:string|null;
      starts_at:string;ends_at:string;source_kind:string;
    }>`
      SELECT schedule.id,schedule.occurrence_key,schedule.title,schedule.class_section_id,
        'Class '||section.grade||section.section AS class_name,schedule.space_id,
        schedule.teacher_user_id,concat_ws(' ',teacher.first_name,teacher.last_name) AS teacher_name,
        schedule.starts_at::text,schedule.ends_at::text,schedule.source_kind
      FROM schools school
      CROSS JOIN LATERAL generate_series(
        (${startsAt}::timestamptz AT TIME ZONE school.timezone)::date,
        (${endsAt}::timestamptz AT TIME ZONE school.timezone)::date,
        interval '1 day'
      ) school_day
      CROSS JOIN LATERAL effective_school_schedule_v4(school.id,school_day::date) schedule
      JOIN class_sections section ON section.id=schedule.class_section_id
      LEFT JOIN users teacher ON teacher.id=schedule.teacher_user_id
      WHERE school.id=${current.school_id}::uuid AND NOT schedule.cancelled
        AND ((school_day::date+schedule.starts_at) AT TIME ZONE school.timezone)<${endsAt}::timestamptz
        AND ((school_day::date+schedule.ends_at) AT TIME ZONE school.timezone)>${startsAt}::timestamptz
        AND (schedule.class_section_id=${current.class_section_id}::uuid
          OR schedule.space_id=${sitting.space_id}::uuid
          OR schedule.teacher_user_id=ANY(${acceptedIds}::uuid[]))
      ORDER BY school_day,schedule.starts_at,schedule.class_section_id,schedule.id
    `.execute(db)).rows;

    const blockers:ExamReadinessBlocker[]=[];
    const seen=new Set<string>();
    const add=(blocker:ExamReadinessBlocker)=>{const key=`${blocker.code}:${blocker.source_id??blocker.message}`;if(!seen.has(key)){seen.add(key);blockers.push(blocker);}};
    if(!context||context.exam_date<context.cycle_start||context.exam_date>context.cycle_end) add({code:"exam_window",message:"Choose a date inside this examination cycle.",source:"assessment",source_id:current.id});
    if(endsAt<=startsAt||!Number.isFinite(endsAt.getTime())) add({code:"exam_window",message:"Add a valid examination start time and duration.",source:"assessment",source_id:current.id});
    if(startsAt.getTime()<=executionNow().getTime()) add({code:"exam_window",message:"Choose a future examination time before scheduling.",source:"assessment",source_id:current.id});
    if(!candidateCount) add({code:"roster",message:"No learners are enrolled in the selected group on the examination date.",source:"assessment",source_id:current.offering_id??current.class_section_id});
    if(!space||space.status!=="active"||!space.is_bookable) add({code:"space",message:"The selected examination space is not currently bookable.",source:"exam_sitting",source_id:sitting.space_id});
    else if(space.capacity===null) add({code:"capacity",message:`Add a capacity for ${space.name} before scheduling.`,source:"exam_sitting",source_id:sitting.space_id});
    else if(space.capacity<candidateCount) add({code:"capacity",message:`${space.name} holds ${space.capacity} people, but ${candidateCount} candidates are enrolled.`,source:"exam_sitting",source_id:sitting.space_id});
    if(acceptedCount<policy.minimum_invigilators) add({code:"invigilators",message:`${policy.minimum_invigilators-acceptedCount} more invigilator acceptance${policy.minimum_invigilators-acceptedCount===1?" is":"s are"} needed.`,source:"exam_sitting",source_id:sitting.id});
    for(const conflict of otherExams){
      const scope=conflict.room_conflict&&conflict.class_conflict?"room and class":conflict.room_conflict?"room":"class";
      add({code:"other_exam",message:`${conflict.title} already uses this ${scope} during the examination.`,source:"exam_sitting",source_id:conflict.id});
    }
    for(const conflict of otherInvigilation) add({code:"other_exam",message:`${conflict.name} is already accepted for ${conflict.title} at this time.`,source:"exam_sitting",source_id:`${conflict.id}:${conflict.user_id}`});
    for(const conflict of timetableConflicts){
      const period=`${conflict.starts_at.slice(0,5)}–${conflict.ends_at.slice(0,5)}`;
      if(conflict.class_section_id===current.class_section_id) add({code:"class_timetable",message:`${conflict.class_name} already has ${conflict.title} (${period}).`,source:"effective_timetable",source_id:`class:${conflict.occurrence_key}`});
      if(conflict.space_id===sitting.space_id) add({code:"room_timetable",message:`${space?.name??"The room"} is already used by ${conflict.class_name} for ${conflict.title} (${period}).`,source:"effective_timetable",source_id:`room:${conflict.occurrence_key}`});
      if(conflict.teacher_user_id&&acceptedIds.includes(conflict.teacher_user_id)) add({code:"invigilator_timetable",message:`${conflict.teacher_name||"An accepted invigilator"} is teaching ${conflict.class_name} (${period}).`,source:"effective_timetable",source_id:`teacher:${conflict.teacher_user_id}:${conflict.occurrence_key}`});
    }
    return {checked_at:executionNow().toISOString(),can_schedule:blockers.length===0,blockers,candidate_count:candidateCount,room_capacity:space?.capacity??null,accepted_invigilator_count:acceptedCount,required_invigilator_count:policy.minimum_invigilators,timetable_contract:"effective_school_schedule_v4"};
  }

  async readiness(user:AuthUser,schoolId:string,assessmentId:string){
    const assessment=await this.db.selectFrom("assessments").selectAll().where("school_id","=",schoolId).where("id","=",assessmentId).executeTakeFirst();
    if(!assessment) throw new NotFoundException("Assessment not found.");
    const sitting=await this.db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).executeTakeFirst();
    if(!sitting) throw new NotFoundException("This assessment does not have a physical sitting.");
    await this.access(user,schoolId,sitting.id,this.db,false);
    return this.readinessSnapshot(this.db,assessment,sitting);
  }

  async respondInvigilator(user:AuthUser,schoolId:string,assessmentId:string,assignmentId:string,body:unknown){
    const data=invigilatorResponseInput.parse(body);
    const requestHash=createHash("sha256").update(JSON.stringify({school_id:schoolId,assessment_id:assessmentId,assignment_id:assignmentId,...data})).digest("hex");
    return this.db.transaction().execute(async db=>{
      if(user.active_school_id&&user.active_school_id!==schoolId) throw new ForbiddenException('Switch to this institution before responding.');
      const currentActor=await this.identities.resolveAccountEndpoint(db,{school_id:schoolId,user_id:user.id,at:executionNow().toISOString()});
      if(!currentActor.acting) throw new ForbiddenException('A current person and active account are required to respond.');
      const assignment=await db.selectFrom("assessment_sitting_invigilators").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).where("id","=",assignmentId).forUpdate().executeTakeFirst();
      if(!assignment) throw new NotFoundException("Invigilation offer not found.");
      if(assignment.user_id!==user.id) throw new ForbiddenException("Only the invited invigilator can respond.");
      const membership=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["staff","admin"]).executeTakeFirst();
      if(!membership) throw new ForbiddenException("Active school staff access is required.");
      const replay=await this.invigilationOffers.retainedResponseCommand(db,{
        school_id:schoolId,
        actor_user_id:user.id,
        command_id:data.command_id,
        assignment_id:assignmentId,
        decision:data.decision,
        request_hash:requestHash,
      });
      if(replay) return replay;
      if(assignment.revision!==data.expected_revision) throw new ConflictException("This invigilation offer changed. Refresh before responding.");
      if(assignment.status!=="offered") throw new ConflictException("This invigilation offer has already been answered.");
      if(data.decision==="declined"&&data.note.length<3) throw new BadRequestException("Add a reason for declining the invigilation duty.");
      const invitation=await this.invigilationOffers.invitationStatus(db,{school_id:schoolId,assignment_id:assignment.id,
        assignment_revision:assignment.revision,user_id:assignment.user_id});
      if(!invitation.can_respond)throw new ConflictException(invitation.message);
      const binding=await this.invigilationOffers.currentResponseBinding(db,{
        school_id:schoolId,
        assignment_id:assignment.id,
        assignment_revision:assignment.revision,
        selected_user_id:user.id,
      });
      if(!binding) throw new ConflictException("This invigilation Offer is not connected to current coordination evidence. Ask an administrator to reissue it.");
      const occurredAt=executionNow();
      const updated=await db.updateTable("assessment_sitting_invigilators").set({status:data.decision,response_note:data.note,responded_at:occurredAt,revision:assignment.revision+1,updated_at:occurredAt}).where("id","=",assignment.id).where("revision","=",assignment.revision).where("status","=","offered").returningAll().executeTakeFirst();
      if(!updated) throw new ConflictException("This invigilation offer changed. Refresh before responding.");
      await this.invigilationOffers.recordResponse(db,{
        school_id:schoolId,
        actor_user_id:user.id,
        assignment:updated,
        source_assignment_revision:assignment.revision,
        decision:data.decision,
        command_id:data.command_id,
        request_hash:requestHash,
        occurred_at:occurredAt.toISOString(),
        binding,
      });
      await this.audit(db,user,schoolId,assessmentId,assignment.sitting_id,"assessment.invigilation.responded",assignment.status,updated.status,{assignment_id:assignment.id,note:data.note});
      await this.emit(db,schoolId,assignment.sitting_id,assessmentId,"invigilator.responded",updated.revision,`invigilator.responded:${assignment.id}`);
      return updated;
    });
  }

  private async projectPlan(db:Transaction<Database>,user:AuthUser,sitting:Selectable<AssessmentSittingTable>,correlationId:string,state:'expected'|'cancelled',reschedule?:{commandId:string;expectedRevision:number}){
    const {context,people}=await this.participationContext(db,sitting.school_id,sitting.id);
    const planned:OwnedPlanPerson[]=people.map(person=>({...person,role:'participant',attendance_expected:true}));
    if(state==='expected'){
      const accepted=await db.selectFrom('assessment_sitting_invigilators').select(['id','user_id','revision'])
        .where('school_id','=',sitting.school_id).where('sitting_id','=',sitting.id).where('status','=','accepted').execute();
      for(const assignment of accepted){
        const identity=await this.identities.resolveAccountEndpoint(db,{school_id:sitting.school_id,user_id:assignment.user_id,at:new Date(sitting.starts_at).toISOString()});
        if(!identity.acting)throw new ConflictException('Every accepted invigilator needs an active, linked campus person account covering the examination.');
        if(people.some(person=>person.person_id===identity.person_id))throw new ConflictException('An examination candidate cannot invigilate the same sitting. Choose an independent invigilator.');
        const person=await db.selectFrom('school_people').select(['revision','first_name','last_name']).where('id','=',identity.person_id)
          .where('school_id','=',sitting.school_id).where(sql<boolean>`retired_at IS NULL`).executeTakeFirst();
        if(!person)throw new ConflictException('An accepted invigilator no longer has an active campus person profile.');
        planned.push({person_id:identity.person_id,label:`${person.first_name} ${person.last_name}`.trim(),person_revision:person.revision,
          role:'lead',required:true,attendance_expected:false,source_ref:`assessment_invigilator:${assignment.id}`,source_revision:assignment.revision});
      }
    }
    const footprint={school_id:sitting.school_id,actor_user_id:user.id,source:'examination' as const,plan_id:sitting.id,
      context_id:sitting.assessment_id,context_entity_id:sitting.id,title:context.title,revision:sitting.revision,state,
      occurred_at:executionNow().toISOString(),correlation_id:correlationId,occurrences:[{source_id:sitting.id,source_revision:sitting.revision,
        title:context.title,local_date:context.date,starts_at:new Date(sitting.starts_at).toISOString(),ends_at:new Date(sitting.ends_at).toISOString(),
        timezone:context.timezone,attendance_mode:'roll_call' as const,space_id:sitting.space_id,people:planned}]};
    const projection=reschedule?await this.footprints.rescheduleExamination(db,footprint,reschedule.commandId,reschedule.expectedRevision)
      :await this.footprints.record(db,footprint);
    if(reschedule)await this.participation.rescheduleExamination(db,user,context,people,{command_id:reschedule.commandId,correlation_id:correlationId,expected_revision:reschedule.expectedRevision});
    if(state==='expected'){
      const end=(await sql<{date:string}>`SELECT (${sitting.ends_at}::timestamptz AT TIME ZONE ${context.timezone})::date::text AS date`.execute(db)).rows[0]!.date;
      await this.planning.validateOwnedPublication(db,sitting.school_id,'examination',sitting.assessment_id,context.date,end);
      await this.participation.prepare(db,user,context,people);
    }
    return projection;
  }

  async prepareForSchedule(db:Transaction<Database>,user:AuthUser,current:AssessmentRecord,identity:{key:string;correlation_id:string}){
    await this.administrator(user,current.school_id,db);
    const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",current.school_id).where("assessment_id","=",current.id).forUpdate().executeTakeFirst();
    if(!sitting) throw new BadRequestException("Configure the campus space and invigilation before scheduling this physical examination.");
    const command=await this.commands.prepareDomainCommand(db,{school_id:current.school_id,actor_user_id:user.id,
      command_type:'examination.sitting.plan',handler_key:'assessments.examination_plan',handler_version:2,source_domain:'assessments',
      target:{kind:'exam_sitting',domain:'assessments',domain_id:sitting.id,label:'Physical examination sitting',lifecycle_state:'planned',source_revision:sitting.revision,metadata:{}},
      current_revision:sitting.revision,expected_revision:sitting.revision,capability:'assessments.manage',purpose:'schedule_physical_examination',
      requested_at:executionNow().toISOString(),correlation_id:identity.correlation_id,causation_id:null,
      idempotency_key:`exam-sitting:${user.id}:${identity.key}`,operating_rule_version_ref:`assessment_operation_policy:${sitting.policy_revision}`,
      configuration_refs:[{kind:'assessment_operation_policy',ref:current.school_id,version:String(sitting.policy_revision)}],
      authority_attestation:{evaluator_domain:'assessments',decision:'allowed',reason_codes:['current_institution_administrator'],
        authority_source_refs:[{school_id:current.school_id,user_id:user.id,assessment_id:current.id,assessment_revision:current.revision}],
        operating_rule_refs:[{policy_revision:sitting.policy_revision}],valid_until:null},
      safe_context:{assessment_id:current.id,sitting_id:sitting.id,assessment_revision:current.revision,starts_at:current.scheduled_at,duration_minutes:current.duration_minutes}});
    if(command.status!=='ready')throw new ConflictException('This examination scheduling command has already completed. Refresh the assessment.');
    await sql`SAVEPOINT examination_schedule_effects`.execute(db);
    try{
    if(sitting.state!=="planning") throw new ConflictException(`The examination sitting cannot be scheduled while it is ${sitting.state}.`);
    if(!current.scheduled_at||!current.duration_minutes) throw new BadRequestException("Add the examination date, start time and duration before scheduling.");
    const startsAt=new Date(current.scheduled_at); const endsAt=new Date(startsAt.getTime()+current.duration_minutes*60_000);
    const context=(await sql<{exam_date:string;cycle_start:string;cycle_end:string;term_id:string}>`SELECT (${startsAt}::timestamptz AT TIME ZONE school.timezone)::date::text AS exam_date,cycle.starts_on::text AS cycle_start,cycle.ends_on::text AS cycle_end,cycle.term_id FROM schools school JOIN assessment_cycles cycle ON cycle.school_id=school.id AND cycle.id=${current.cycle_id}::uuid WHERE school.id=${current.school_id}::uuid`.execute(db)).rows[0];
    if(!context) throw new BadRequestException("The examination cycle is no longer available.");
    // Serialize the readiness evaluation and the state transition. The same
    // projection is shown to the operator, but scheduling re-evaluates it
    // under this lock so a concurrent exam cannot reserve the same resources.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assessment-exam-schedule:${current.school_id}`},0))`.execute(db);
    const readiness=await this.readinessSnapshot(db,current,sitting);
    if(!readiness.can_schedule){
      const [first]=readiness.blockers;
      throw new ConflictException(readiness.blockers.length===1
        ? first!.message
        : `Resolve ${readiness.blockers.length} readiness issues before scheduling. ${first!.message}`);
    }
    const roster=await this.datedCandidates(db,current,context.term_id,context.exam_date);
    const frozenAt=executionNow();
    await db.insertInto("assessment_sitting_candidates").values(roster.map(row=>({school_id:current.school_id,sitting_id:sitting.id,assessment_id:current.id,...row,frozen_at:frozenAt}))).execute();
    const updated=await db.updateTable("assessment_sittings").set({state:"ready",starts_at:startsAt,ends_at:endsAt,roster_frozen_at:frozenAt,revision:sitting.revision+1,updated_by:user.id,updated_at:frozenAt}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
    const temporal=await this.projectPlan(db,user,updated,identity.correlation_id,'expected');
    await this.audit(db,user,current.school_id,current.id,sitting.id,"assessment.sitting.ready","planning","ready",{candidate_count:roster.length,accepted_invigilator_count:readiness.accepted_invigilator_count,space_id:sitting.space_id,timetable_contract:readiness.timetable_contract,readiness_checked_at:readiness.checked_at});
    const domainEventId=await this.emit(db,current.school_id,sitting.id,current.id,"sitting.ready",updated.revision);
    await this.commands.completeDomainCommand(db,{school_id:current.school_id,command_id:command.command_id,terminal_state:'accepted',code:'exam_sitting_ready',
      explanation:'The examination is ready with frozen candidates, accepted invigilators and conflict-checked campus commitments.',
      resulting_revision:updated.revision,domain_event_id:domainEventId,metadata:{assessment_id:current.id,sitting_id:sitting.id,
        temporal_event_id:temporal.event_id,candidate_count:roster.length},completed_at:executionNow().toISOString()});
    await sql`RELEASE SAVEPOINT examination_schedule_effects`.execute(db);
    return {sitting:updated,refused:null};
    }catch(error){
      if(!(error instanceof HttpException)||![400,403,409,422].includes(error.getStatus()))throw error;
      await sql`ROLLBACK TO SAVEPOINT examination_schedule_effects`.execute(db);
      await sql`RELEASE SAVEPOINT examination_schedule_effects`.execute(db);
      await this.commands.completeDomainCommand(db,{school_id:current.school_id,command_id:command.command_id,
        terminal_state:error.getStatus()===409?'conflicted':'rejected',code:'exam_scheduling_invariant_refused',
        explanation:'The owning examination readiness or shared scheduling rules refused this plan. No candidates or commitments were changed.',
        resulting_revision:sitting.revision,domain_event_id:null,metadata:{assessment_id:current.id,sitting_id:sitting.id,status_code:error.getStatus()},
        completed_at:executionNow().toISOString()});
      return {sitting:null,refused:error};
    }
  }

  async assertCompletedBeforeMarking(db:Db,assessmentId:string){
    const sitting=await db.selectFrom("assessment_sittings").select(["state"]).where("assessment_id","=",assessmentId).executeTakeFirst();
    if(!sitting) throw new ConflictException("Configure and complete the physical examination sitting before opening marking.");
    if(sitting.state!=="completed") throw new ConflictException("Complete the physical examination sitting before opening marking.");
  }

  async detail(user:AuthUser,schoolId:string,assessmentId:string){
    const sitting=await this.db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).executeTakeFirst();
    if(!sitting) throw new NotFoundException("This assessment does not have a physical sitting.");
    const viewerRole=await this.access(user,schoolId,sitting.id,this.db,false);
    return {...await this.projection(schoolId,assessmentId,sitting,user.id),viewer_role:viewerRole};
  }

  async projection(schoolId:string,assessmentId:string,knownSitting?:Selectable<AssessmentSittingTable>,viewerUserId?:string){
    const sitting=knownSitting??await this.db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).executeTakeFirst();
    if(!sitting) return null;
    const assessment=(await sql<AssessmentRecord&{subject_name:string;class_name:string;time_zone:string}>`SELECT assessment.*,school.timezone AS time_zone,subject.name AS subject_name,COALESCE(offering.name,'Class '||section.grade||section.section) AS class_name FROM assessments assessment JOIN schools school ON school.id=assessment.school_id JOIN subjects subject ON subject.id=assessment.subject_id LEFT JOIN class_sections section ON section.id=assessment.class_section_id LEFT JOIN learning_offerings offering ON offering.school_id=assessment.school_id AND offering.id=assessment.offering_id WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid`.execute(this.db)).rows[0];
    if(!assessment) throw new NotFoundException("Assessment not found.");
    const space=await this.db.selectFrom("campus_spaces").innerJoin("institution_campuses","institution_campuses.id","campus_spaces.campus_id").select(["campus_spaces.id","campus_spaces.name","campus_spaces.code","campus_spaces.kind","campus_spaces.capacity","institution_campuses.name as campus_name"]).where("campus_spaces.school_id","=",schoolId).where("campus_spaces.id","=",sitting.space_id).executeTakeFirstOrThrow();
    const invitationRows=(await sql<Selectable<AssessmentSittingInvigilatorTable>&{username:string;name:string;avatar_url:string|null}>`SELECT assignment.*,account.username,
        concat_ws(' ',account.first_name,account.last_name) AS name,account.avatar_url
      FROM assessment_sitting_invigilators assignment
      JOIN users account ON account.id=assignment.user_id
      WHERE assignment.sitting_id=${sitting.id}::uuid
      ORDER BY name,assignment.id`.execute(this.db)).rows;
    const invigilators=await this.db.transaction().execute(async tx=>Promise.all(invitationRows.map(async assignment=>({
      ...assignment,...(assignment.status==='offered'?{invitation_status:await this.invigilationOffers.invitationStatus(tx,{
        school_id:schoolId,assignment_id:assignment.id,assignment_revision:assignment.revision,user_id:assignment.user_id})}:{})}))));
    const viewerAssignment=viewerUserId?invigilators.find(row=>(row as {user_id:string}).user_id===viewerUserId)??null:null;
    const candidates=(await sql`SELECT candidate.*,candidate.id AS candidate_id,concat_ws(' ',person.first_name,person.last_name) AS name,student.admission_number,person.avatar_url,attendance.id AS attendance_id,attendance.status AS attendance_status,attendance.observed_at,attendance.note AS attendance_note,attendance.revision AS attendance_revision FROM assessment_sitting_candidates candidate LEFT JOIN students student ON student.id=candidate.student_id AND student.school_id=candidate.school_id JOIN school_people person ON person.id=COALESCE(candidate.person_id,student.person_id) AND person.school_id=candidate.school_id JOIN assessment_candidate_attendance attendance ON attendance.candidate_id=candidate.id WHERE candidate.sitting_id=${sitting.id}::uuid ORDER BY candidate.roll_number_snapshot NULLS LAST,person.first_name,person.last_name,candidate.id`.execute(this.db)).rows;
    const incidents=await this.db.selectFrom("assessment_sitting_incidents").selectAll().where("sitting_id","=",sitting.id).orderBy("observed_at","desc").orderBy("id").execute();
    const counts=(await sql<{total:number;unrecorded:number;present:number;late:number;absent:number;left_early:number}>`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='unrecorded')::int AS unrecorded,count(*) FILTER(WHERE status='present')::int AS present,count(*) FILTER(WHERE status='late')::int AS late,count(*) FILTER(WHERE status='absent')::int AS absent,count(*) FILTER(WHERE status='left_early')::int AS left_early FROM assessment_candidate_attendance WHERE sitting_id=${sitting.id}::uuid`.execute(this.db)).rows[0]!;
    const readiness=sitting.state==="planning"
      ? await this.readinessSnapshot(this.db,assessment,sitting)
      : null;
    const history=(await sql<{revision:number;action:string;reason:string;previous_snapshot:Record<string,unknown>;snapshot:Record<string,unknown>;recorded_at:Date}>`
      SELECT revision,action,reason,command_key,previous_snapshot,snapshot,recorded_at FROM assessment_schedule_revisions
      WHERE school_id=${schoolId}::uuid AND assessment_id=${assessmentId}::uuid ORDER BY revision DESC LIMIT 50`.execute(this.db)).rows;
    return {assessment,sitting,space,time_zone:assessment.time_zone,invigilators,viewer_assignment:viewerAssignment,candidates,incidents,attendance_counts:counts,policy:sitting.policy_snapshot,readiness,
      schedule_state:assessment.status==='scheduled'&&sitting.state==='planning'&&history.length?'awaiting_confirmation':sitting.state,
      schedule_history:history};
  }

  async start(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=sittingActionInput.parse(body);
    return this.mutateSitting(user,schoolId,assessmentId,data.expected_revision,"start");
  }

  async complete(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=sittingActionInput.parse(body);
    return this.mutateSitting(user,schoolId,assessmentId,data.expected_revision,"complete");
  }

  private async mutateSitting(user:AuthUser,schoolId:string,assessmentId:string,expectedRevision:number,action:"start"|"complete"){
    return this.db.transaction().execute(async db=>{
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("Examination sitting not found.");
      await this.access(user,schoolId,sitting.id,db,true);
      if(sitting.revision!==expectedRevision) throw new ConflictException("This examination sitting changed. Refresh before continuing.");
      const expected=action==="start"?"ready":"in_progress";
      if(sitting.state!==expected) throw new ConflictException(`This examination sitting cannot ${action} while it is ${sitting.state}.`);
      const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService["policyProjection"]>;
      const now=executionNow();
      if(action==="start"){
        const earliest=new Date(new Date(sitting.starts_at).getTime()-policy.readiness_minutes_before*60_000);
        const latest=new Date(new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60_000);
        if(now<earliest) throw new BadRequestException(`This sitting can start ${policy.readiness_minutes_before} minutes before its scheduled time.`);
        if(now>latest) throw new BadRequestException("The attendance recording window has closed.");
      }
      if(action==="complete"&&policy.require_all_candidate_attendance){
        const unrecorded=Number((await db.selectFrom("assessment_candidate_attendance").select(({fn})=>fn.countAll<number>().as("count")).where("sitting_id","=",sitting.id).where("status","=","unrecorded").executeTakeFirst())?.count??0);
        if(unrecorded) throw new BadRequestException(`Record attendance for all candidates before completing (${unrecorded} remaining).`);
      }
      if(action==='complete'){
        const participation=await this.participationContext(db,schoolId,sitting.id);
        const request={authUser:user,requestId:randomUUID(),headers:{'idempotency-key':`exam-complete:${sitting.id}:${sitting.revision}`}} as unknown as AuthenticatedRequest;
        await this.participation.lifecycle(db,user,participation.context,participation.people,'finalize',request,'Completed the authoritative examination sitting.');
      }
      const next=action==="start"?"in_progress":"completed";
      const updated=await db.updateTable("assessment_sittings").set({state:next,revision:sitting.revision+1,updated_by:user.id,updated_at:now,...(action==="start"?{started_by:user.id,started_at:now}:{completed_by:user.id,completed_at:now})}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      let assessmentStatus:AssessmentStatus|undefined;
      if(action==="complete"&&policy.post_completion_marking_mode==="automatic"){
        const assessment=await db.selectFrom("assessments").select(["status","revision"]).where("school_id","=",schoolId).where("id","=",assessmentId).forUpdate().executeTakeFirstOrThrow();
        if(assessment.status==="scheduled"){
          await this.openFrozenResults(db,schoolId,assessmentId);
          await db.updateTable("assessments").set({status:"marking",revision:assessment.revision+1,updated_by:user.id,updated_at:now}).where("id","=",assessmentId).execute();
          assessmentStatus="marking";
        }
      }
      await this.audit(db,user,schoolId,assessmentId,sitting.id,`assessment.sitting.${action}`,sitting.state,next,{policy_revision:sitting.policy_revision,post_completion_marking_mode:action==="complete"?policy.post_completion_marking_mode:undefined,assessment_status:assessmentStatus});
      await this.emit(db,schoolId,sitting.id,assessmentId,`sitting.${action}`,updated.revision);
      await this.modelBridge.recordAction(db,await this.modelSnapshot(db,user.id,assessmentId,updated),{
          idempotencyKey:`exam-sitting:${sitting.id}:${action}:${updated.revision}`,
          correlationId:randomUUID(),
          expectedRevision:sitting.revision,
          action,
          explanation:action==="start"
            ? "An authorized invigilator started the scheduled examination sitting."
            : "An authorized invigilator completed the examination sitting and its attendance record.",
      });
      return {sitting:updated,assessment_status:assessmentStatus??null};
    });
  }

  async openFrozenResults(db:Db,schoolId:string,assessmentId:string){
    await sql`INSERT INTO assessment_results(school_id,assessment_id,student_id,learner_id,person_id,academic_roster_source)
      SELECT candidate.school_id,candidate.assessment_id,NULL,candidate.person_id,candidate.person_id,offering_exam_roster_source(candidate)
      FROM assessment_sitting_candidates candidate
      JOIN assessment_sittings sitting ON sitting.school_id=candidate.school_id AND sitting.id=candidate.sitting_id
      WHERE candidate.school_id=${schoolId}::uuid AND candidate.assessment_id=${assessmentId}::uuid
        AND sitting.state='completed' AND candidate.offering_id IS NOT NULL
      ON CONFLICT(assessment_id,learner_id) DO NOTHING`.execute(db);
    await sql`INSERT INTO assessment_results(school_id,assessment_id,student_id,academic_roster_source)
      SELECT candidate.school_id,candidate.assessment_id,candidate.student_id,jsonb_build_object('schema_version',1,'kind','physical_candidate',
        'enrollment_id',candidate.enrollment_id,'enrollment_revision',enrollment.revision,'roll_number',candidate.roll_number_snapshot,
        'as_of',(sitting.starts_at AT TIME ZONE school.timezone)::date::text,'candidate_id',candidate.id,'sitting_id',candidate.sitting_id)
      FROM assessment_sitting_candidates candidate JOIN enrollments enrollment ON enrollment.id=candidate.enrollment_id AND enrollment.student_id=candidate.student_id
      JOIN schools school ON school.id=candidate.school_id
      JOIN assessment_sittings sitting ON sitting.school_id=candidate.school_id AND sitting.id=candidate.sitting_id
      WHERE candidate.school_id=${schoolId}::uuid AND candidate.assessment_id=${assessmentId}::uuid AND sitting.state='completed'
      ON CONFLICT(assessment_id,student_id) DO NOTHING`.execute(db);
  }

  async recordAttendance(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=attendanceInput.parse(body);
    return this.db.transaction().execute(async db=>{
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("Examination sitting not found.");
      await this.access(user,schoolId,sitting.id,db,true);
      if(sitting.revision!==data.expected_revision) throw new ConflictException("This examination sitting changed. Refresh before saving attendance.");
      if(sitting.state!=="in_progress") throw new ConflictException("Candidate attendance can be recorded only while the sitting is in progress.");
      const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService["policyProjection"]>;
      if(executionNow().getTime()>new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60_000) throw new BadRequestException("The configured attendance recording window has closed.");
      const participation=await this.participationContext(db,schoolId,sitting.id);
      await this.participation.prepare(db,user,participation.context,participation.people);
      const canonical:Array<({student_id:string}|{person_id:string})&{status:ParticipationStatus;remarks:string}>=[];
      const seenCandidates=new Set<string>();
      const captures:Record<string,ParticipationCaptureSources[string]>={};
      const personByCandidate=new Map(participation.people.map(person=>[person.source_ref,person.person_id]));
      for(const record of data.records){
        const current=await db.selectFrom("assessment_candidate_attendance").selectAll().where("school_id","=",schoolId).where("sitting_id","=",sitting.id).where(record.candidate_id?"candidate_id":"student_id","=",record.candidate_id??record.student_id!).executeTakeFirst();
        if(!current) throw new BadRequestException("A selected learner is not in the frozen examination roster.");
        if(seenCandidates.has(current.candidate_id))throw new BadRequestException("A candidate can appear only once.");
        seenCandidates.add(current.candidate_id);
        const personId=personByCandidate.get(current.candidate_id);
        if(!personId)throw new ConflictException("The candidate is outside this participation roster.");
        if(current.revision!==record.expected_revision) throw new ConflictException("A candidate attendance record changed. Refresh before saving.");
        if(current.status!=='unrecorded'&&!data.reason&&record.note.trim().length<3)
          throw new BadRequestException('Add a reason or explanatory note when correcting examination attendance.');
        const observedAt=record.observed_at?new Date(record.observed_at):executionNow();
        if(observedAt>executionNow()||observedAt.getTime()<new Date(sitting.starts_at).getTime()-policy.readiness_minutes_before*60000
          ||observedAt.getTime()>new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60000)
          throw new BadRequestException('Choose an actual observation time within this examination recording window.');
        canonical.push({...(current.student_id?{student_id:current.student_id}:{person_id:personId}),status:record.status,remarks:record.note});
        captures[personId]={capture_channel:'human_roll_call',observed_at:observedAt,
          evidence_refs:[`examination_sitting:${sitting.id}`,`examination_policy:${sitting.policy_revision}`]};
        await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.candidate_attendance.recorded",current.status,record.status,{student_id:current.student_id,candidate_id:current.candidate_id,attendance_id:current.id,note:record.note});
      }
      const key=`exam-attendance:${sitting.id}:${sitting.revision}:${createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,24)}`;
      const request={authUser:user,requestId:randomUUID(),headers:{'idempotency-key':key}} as unknown as AuthenticatedRequest;
      await this.participation.save(db,user,participation.context,participation.people,canonical,request,
        data.reason??(data.records.some(record=>record.note)?data.records.map(record=>record.note).filter(Boolean).join('; ').slice(0,500):'Recorded an examination attendance observation.'),captures);
      const revised=await db.updateTable("assessment_sittings").set({revision:sitting.revision+1,updated_by:user.id,updated_at:executionNow()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      await this.emit(db,schoolId,sitting.id,assessmentId,"attendance.recorded",revised.revision);
      const updated=await db.selectFrom('assessment_candidate_attendance').selectAll().where('school_id','=',schoolId)
        .where('sitting_id','=',sitting.id).where('candidate_id','in',[...seenCandidates]).execute();
      return {sitting_revision:revised.revision,records:updated};
    });
  }

  async createIncident(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=incidentInput.parse(body);
    return this.db.transaction().execute(async db=>{
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("Examination sitting not found.");
      await this.access(user,schoolId,sitting.id,db,true);
      if(sitting.revision!==data.expected_revision) throw new ConflictException("This examination sitting changed. Refresh before recording the incident.");
      if(sitting.state!=="in_progress") throw new ConflictException("Incidents can be recorded only while the sitting is in progress.");
      let candidate:{id:string;student_id:string|null}|undefined;
      if(data.candidate_id||data.student_id){
        candidate=await db.selectFrom("assessment_sitting_candidates").select(["id","student_id"]).where("school_id","=",schoolId)
          .where("sitting_id","=",sitting.id).where(data.candidate_id?"id":"student_id","=",data.candidate_id??data.student_id!).executeTakeFirst();
        if(!candidate)throw new BadRequestException("The selected learner is not in the frozen examination roster.");
      }
      const incident=await db.insertInto("assessment_sitting_incidents").values({school_id:schoolId,sitting_id:sitting.id,candidate_id:candidate?.id??null,student_id:candidate?.student_id??null,category:data.category,severity:data.severity,summary:data.summary,observed_at:data.observed_at?new Date(data.observed_at):executionNow(),recorded_by:user.id}).returningAll().executeTakeFirstOrThrow();
      const revised=await db.updateTable("assessment_sittings").set({revision:sitting.revision+1,updated_by:user.id,updated_at:executionNow()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.incident.recorded",null,"open",{incident_id:incident.id,candidate_id:incident.candidate_id,student_id:incident.student_id,category:incident.category,severity:incident.severity});
      await this.emit(db,schoolId,sitting.id,assessmentId,"incident.recorded",revised.revision,`incident.recorded:${incident.id}`);
      await this.modelBridge.recordIncident(db,await this.modelSnapshot(db,user.id,assessmentId,revised),{
          idempotencyKey:`exam-incident:${incident.id}:report:${incident.revision}`,
          correlationId:randomUUID(),
          expectedRevision:null,
          incidentId:incident.id,
          incidentRevision:incident.revision,
          action:"report",
          severity:incident.severity,
          occurredAt:new Date(incident.observed_at).toISOString(),
      });
      return {incident,sitting_revision:revised.revision};
    });
  }

  async resolveIncident(user:AuthUser,schoolId:string,assessmentId:string,incidentId:string,body:unknown){
    const data=incidentResolveInput.parse(body);
    return this.db.transaction().execute(async db=>{
      const incident=await db.selectFrom("assessment_sitting_incidents").selectAll().where("school_id","=",schoolId).where("id","=",incidentId).forUpdate().executeTakeFirst();
      if(!incident) throw new NotFoundException("Examination incident not found.");
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("id","=",incident.sitting_id).where("assessment_id","=",assessmentId).executeTakeFirst();
      if(!sitting) throw new NotFoundException("Examination incident not found.");
      await this.access(user,schoolId,sitting.id,db,true);
      if(incident.revision!==data.expected_revision) throw new ConflictException("This incident changed. Refresh before resolving it.");
      if(incident.state!=="open") throw new ConflictException("This incident is already resolved.");
      const updated=await db.updateTable("assessment_sitting_incidents").set({state:"resolved",resolution:data.resolution,resolved_by:user.id,resolved_at:executionNow(),revision:incident.revision+1,updated_at:executionNow()}).where("id","=",incident.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.incident.resolved","open","resolved",{incident_id:incident.id,resolution:data.resolution});
      await this.emit(db,schoolId,sitting.id,assessmentId,"incident.resolved",updated.revision,`incident.resolved:${incident.id}`);
      await this.modelBridge.recordIncident(db,await this.modelSnapshot(db,user.id,assessmentId,sitting),{
          idempotencyKey:`exam-incident:${incident.id}:resolve:${updated.revision}`,
          correlationId:randomUUID(),
          expectedRevision:incident.revision,
          incidentId:incident.id,
          incidentRevision:updated.revision,
          action:"resolve",
          severity:incident.severity,
          occurredAt:new Date(updated.resolved_at!).toISOString(),
      });
      return updated;
    });
  }

  async cancelForAssessment(db:Transaction<Database>,user:AuthUser,schoolId:string,assessmentId:string,reason:string,identity:{key:string;correlation_id:string}){
    await this.administrator(user,schoolId,db);
    const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
    if(!sitting||sitting.state==="cancelled"||sitting.state==="completed") return sitting??null;
    const command=await this.commands.prepareDomainCommand(db,{school_id:schoolId,actor_user_id:user.id,
      command_type:'examination.sitting.cancel',handler_key:'assessments.examination_cancel',handler_version:2,source_domain:'assessments',
      target:{kind:'exam_sitting',domain:'assessments',domain_id:sitting.id,label:'Physical examination sitting',lifecycle_state:sitting.state==='planning'?'planned':'active',source_revision:sitting.revision,metadata:{}},
      current_revision:sitting.revision,expected_revision:sitting.revision,capability:'assessments.manage',purpose:'cancel_physical_examination',
      requested_at:executionNow().toISOString(),correlation_id:identity.correlation_id,causation_id:null,idempotency_key:`exam-sitting:${user.id}:${identity.key}`,
      operating_rule_version_ref:`assessment_operation_policy:${sitting.policy_revision}`,configuration_refs:[],
      authority_attestation:{evaluator_domain:'assessments',decision:'allowed',reason_codes:['current_institution_administrator'],
        authority_source_refs:[{school_id:schoolId,user_id:user.id,assessment_id:assessmentId}],operating_rule_refs:[{policy_revision:sitting.policy_revision}],valid_until:null},
      safe_context:{assessment_id:assessmentId,sitting_id:sitting.id,reason_hash:createHash('sha256').update(reason).digest('hex')}});
    if(command.status!=='ready')throw new ConflictException('This examination cancellation command has already completed. Refresh the assessment.');
    const updated=await db.updateTable("assessment_sittings").set({state:"cancelled",cancelled_by:user.id,cancelled_at:executionNow(),cancellation_reason:reason,revision:sitting.revision+1,updated_by:user.id,updated_at:executionNow()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
    const retained=(await sql<{id:string}>`SELECT id FROM schedule_activity_occurrences WHERE school_id=${schoolId}::uuid
      AND source='examination' AND source_ref=${sitting.id}`.execute(db)).rows[0];
    const temporal=retained?await this.projectPlan(db,user,updated,identity.correlation_id,'cancelled'):null;
    await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.sitting.cancelled",sitting.state,"cancelled",{reason});
    const domainEventId=await this.emit(db,schoolId,sitting.id,assessmentId,"sitting.cancelled",updated.revision);
    await this.commands.completeDomainCommand(db,{school_id:schoolId,command_id:command.command_id,terminal_state:'accepted',code:'exam_sitting_cancelled',
      explanation:'The authorized examination cancellation released its future planned commitments while retaining candidate and decision history.',
      resulting_revision:updated.revision,domain_event_id:domainEventId,metadata:{assessment_id:assessmentId,sitting_id:sitting.id,temporal_event_id:temporal?.event_id??null},
      completed_at:executionNow().toISOString()});
    return updated;
  }
}
