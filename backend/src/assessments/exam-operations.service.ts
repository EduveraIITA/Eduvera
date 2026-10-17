import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { AssessmentSittingInvigilatorTable, AssessmentSittingTable, Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { AssessmentInvigilationOfferBridgeService } from "./assessment-invigilation-offer-bridge.service.js";
import { AssessmentModelBridgeService, type ExamSittingModelSnapshot } from "./assessment-model-bridge.service.js";

type Db = Kysely<Database> | Transaction<Database>;
type PhysicalKind = "exam" | "practical" | "viva";
type AssessmentKind = PhysicalKind|"class_test"|"quiz"|"assignment"|"project"|"other";
type AssessmentStatus = "draft"|"scheduled"|"marking"|"submitted"|"moderated"|"published"|"cancelled";
type AssessmentRecord = {
  id:string; school_id:string; cycle_id:string; class_section_id:string; subject_id:string;
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
export const invigilatorResponseInput=z.object({command_id:uuid,expected_revision:z.coerce.number().int().positive(),decision:z.enum(["accepted","declined"]),note:z.string().trim().max(500).default("")});
export const sittingActionInput=z.object({expected_revision:z.coerce.number().int().positive()});
export const attendanceInput=z.object({
  expected_revision:z.coerce.number().int().positive(),
  records:z.array(z.object({
    student_id:uuid,
    status:z.enum(["present","late","absent","left_early"]),
    observed_at:z.iso.datetime().optional(),
    note:z.string().trim().max(500).default(""),
    expected_revision:z.coerce.number().int().positive(),
  })).min(1).max(500),
}).superRefine((value,context)=>{
  const ids=new Set<string>();
  for(const [index,record] of value.records.entries()){
    if(ids.has(record.student_id)) context.addIssue({code:"custom",path:["records",index,"student_id"],message:"A candidate can appear only once."});
    ids.add(record.student_id);
  }
});
export const incidentInput=z.object({
  expected_revision:z.coerce.number().int().positive(),
  student_id:uuid.nullable().optional().default(null),
  category:z.enum(["conduct","health","materials","timing","other"]),
  severity:z.enum(["info","minor","major"]),
  summary:z.string().trim().min(3).max(1000),
  observed_at:z.iso.datetime().optional(),
});
export const incidentResolveInput=z.object({expected_revision:z.coerce.number().int().positive(),resolution:z.string().trim().min(3).max(1000)});

export function isPhysicalAssessment(kind:string):kind is PhysicalKind { return ["exam","practical","viva"].includes(kind); }

export function assertFutureExamStart(value:Date|string,now=new Date()){
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
  ){}

  private async administrator(user:AuthUser,schoolId:string,db:Db=this.db){
    uuid.parse(schoolId);
    const membership=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("role","=","admin").where("is_active","=",true).executeTakeFirst();
    if(!membership) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async access(user:AuthUser,schoolId:string,sittingId:string,db:Db=this.db,acceptedOnly=true){
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
      const updated=await db.updateTable("assessment_operation_policies").set({readiness_minutes_before:data.readiness_minutes_before,attendance_close_after_minutes:data.attendance_close_after_minutes,minimum_invigilators:data.minimum_invigilators,require_all_candidate_attendance:data.require_all_candidate_attendance,post_completion_marking_mode:data.post_completion_marking_mode,revision:current.revision+1,updated_by:user.id,updated_at:new Date()}).where("school_id","=",schoolId).where("revision","=",current.revision).returningAll().executeTakeFirst();
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
    const audienceUserIds=[...new Set([...await this.audience(db,schoolId,sittingId),...additionalAudienceUserIds])];
    await this.events.enqueueUserEvent(db,{schoolId,eventType:"assessment.updated",aggregateType:"assessment_sitting",aggregateId:sittingId,audienceUserIds,payload:{assessment_id:assessmentId,sitting_id:sittingId,action,state_action:action,revision,refresh:["assessments","teacher.home","principal.home","requests","notifications","attention","calendar","campus-view"]},idempotencyKey:`assessment-sitting:${sittingId}:${eventIdentity}:${revision}`});
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
        'Class '||section.grade||section.section AS class_label,
        subject.name AS subject_label,space.id AS space_id,space.name AS space_name,
        space.kind AS space_kind,
        space.revision AS space_revision,
        (SELECT count(*)::int FROM assessment_sitting_candidates candidate
          WHERE candidate.sitting_id=${sitting.id}::uuid) AS expected_count
      FROM assessments assessment
      JOIN class_sections section ON section.id=assessment.class_section_id
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
    return this.db.transaction().execute(async db=>{
      await this.administrator(user,schoolId,db);
      const assessment=await db.selectFrom("assessments").selectAll().where("school_id","=",schoolId).where("id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!assessment) throw new NotFoundException("Assessment not found.");
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("This assessment does not have a physical sitting.");
      if(assessment.status!=="draft"||sitting.state!=="planning") throw new ConflictException("Exam arrangements can be changed only before the assessment is scheduled.");
      if(assessment.revision!==data.expected_assessment_revision||sitting.revision!==data.expected_sitting_revision) throw new ConflictException("These exam arrangements changed. Refresh before saving.");

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
      const now=new Date();
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
        if(timingOrSpaceChanged||assignment.status==="declined"||assignment.status==="revoked"){
          if(assignment.status==="offered") await this.invigilationOffers.cancelOpenOffer(db,{
            school_id:schoolId,
            assignment_id:assignment.id,
            source_assignment_revision:assignment.revision,
            occurred_at:now.toISOString(),
            reason:"The examination time or room changed, so the previous invigilation Offer was replaced.",
          });
          const reset=await db.updateTable("assessment_sitting_invigilators").set({status:"offered",response_note:"",responded_at:null,assigned_by:user.id,assigned_at:now,revision:assignment.revision+1,updated_at:now}).where("id","=",assignment.id).returningAll().executeTakeFirstOrThrow();
          offersToPublish.push(reset);
        }
      }
      const existingIds=new Set(existing.map(item=>item.user_id));
      const added=data.invigilator_user_ids.filter(id=>!existingIds.has(id));
      if(added.length) offersToPublish.push(...await db.insertInto("assessment_sitting_invigilators").values(added.map(userId=>({school_id:schoolId,sitting_id:sitting.id,assessment_id:assessmentId,user_id:userId,assigned_by:user.id}))).returningAll().execute());

      const updatedAssessment=await db.updateTable("assessments").set({scheduled_at:startsAt,duration_minutes:data.duration_minutes,venue:space.name,revision:assessment.revision+1,updated_by:user.id,updated_at:now}).where("id","=",assessment.id).where("revision","=",assessment.revision).returningAll().executeTakeFirst();
      const updatedSitting=await db.updateTable("assessment_sittings").set({campus_id:space.campus_id,space_id:space.id,starts_at:startsAt,ends_at:endsAt,revision:sitting.revision+1,updated_by:user.id,updated_at:now}).where("id","=",sitting.id).where("revision","=",sitting.revision).returningAll().executeTakeFirst();
      if(!updatedAssessment||!updatedSitting) throw new ConflictException("These exam arrangements changed. Refresh before saving.");
      for(const assignment of offersToPublish) await this.invigilationOffers.publishOffer(db,{
        school_id:schoolId,
        actor_user_id:user.id,
        assignment_id:assignment.id,
        source_assignment_revision:assignment.revision,
      });
      await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.sitting.arrangements_updated","planning","planning",{
        previous:{scheduled_at:new Date(sitting.starts_at).toISOString(),ends_at:new Date(sitting.ends_at).toISOString(),space_id:sitting.space_id,invigilator_user_ids:existing.filter(item=>item.status!=="revoked").map(item=>item.user_id)},
        current:{scheduled_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),space_id:space.id,invigilator_user_ids:data.invigilator_user_ids},
        confirmations_reset:timingOrSpaceChanged,
      });
      await this.emit(db,schoolId,sitting.id,assessmentId,"sitting.arrangements_updated",updatedSitting.revision,"sitting.arrangements_updated",existing.filter(item=>item.status!=="revoked").map(item=>item.user_id));
      return {assessment:updatedAssessment,sitting:updatedSitting};
    });
  }

  private async readinessSnapshot(db:Db,current:AssessmentRecord,sitting:Selectable<AssessmentSittingTable>):Promise<ExamReadiness>{
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
    const candidateCount=context?Number((await sql<{count:number}>`
      SELECT count(*)::int AS count
      FROM enrollments enrollment
      JOIN students student ON student.id=enrollment.student_id AND student.school_id=${current.school_id}::uuid
      WHERE enrollment.class_section_id=${current.class_section_id}::uuid
        AND enrollment.term_id=${context.term_id}::uuid AND enrollment.is_active
        AND enrollment.enrolled_on<=${context.exam_date}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${context.exam_date}::date)
    `.execute(db)).rows[0]?.count??0):0;
    const space=await db.selectFrom("campus_spaces").select(["name","capacity","status","is_bookable"]).where("school_id","=",current.school_id).where("id","=",sitting.space_id).executeTakeFirst();
    const acceptedInvigilators=(await sql<{user_id:string;name:string}>`
      SELECT assignment.user_id,concat_ws(' ',account.first_name,account.last_name) AS name
      FROM assessment_sitting_invigilators assignment
      JOIN users account ON account.id=assignment.user_id AND account.is_active
      JOIN school_memberships membership ON membership.school_id=assignment.school_id
        AND membership.user_id=assignment.user_id AND membership.is_active
        AND membership.role IN ('staff','admin')
      WHERE assignment.school_id=${current.school_id}::uuid
        AND assignment.sitting_id=${sitting.id}::uuid AND assignment.status='accepted'
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
    const otherInvigilation=(await sql<{id:string;title:string;user_id:string;name:string}>`
      SELECT other.id,other_assessment.title,mine.user_id,
        concat_ws(' ',account.first_name,account.last_name) AS name
      FROM assessment_sitting_invigilators mine
      JOIN assessment_sitting_invigilators assigned
        ON assigned.school_id=mine.school_id AND assigned.user_id=mine.user_id
        AND assigned.status='accepted'
      JOIN assessment_sittings other ON other.id=assigned.sitting_id
        AND other.state IN ('ready','in_progress')
      JOIN assessments other_assessment ON other_assessment.id=other.assessment_id
      JOIN users account ON account.id=mine.user_id
      WHERE mine.sitting_id=${sitting.id}::uuid AND mine.status='accepted'
        AND other.id<>${sitting.id}::uuid
        AND other.starts_at<${endsAt}::timestamptz AND other.ends_at>${startsAt}::timestamptz
      ORDER BY lower(concat_ws(' ',account.first_name,account.last_name)),other.starts_at,other.id
    `.execute(db)).rows;
    const acceptedIds=acceptedInvigilators.map(row=>row.user_id);
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
    if(startsAt.getTime()<=Date.now()) add({code:"exam_window",message:"Choose a future examination time before scheduling.",source:"assessment",source_id:current.id});
    if(!candidateCount) add({code:"roster",message:"No learners are enrolled in this class on the examination date.",source:"assessment",source_id:current.class_section_id});
    if(!space||space.status!=="active"||!space.is_bookable) add({code:"space",message:"The selected examination space is not currently bookable.",source:"exam_sitting",source_id:sitting.space_id});
    else if(space.capacity===null) add({code:"capacity",message:`Add a capacity for ${space.name} before scheduling.`,source:"exam_sitting",source_id:sitting.space_id});
    else if(space.capacity<candidateCount) add({code:"capacity",message:`${space.name} holds ${space.capacity} people, but ${candidateCount} candidates are enrolled.`,source:"exam_sitting",source_id:sitting.space_id});
    if(acceptedInvigilators.length<policy.minimum_invigilators) add({code:"invigilators",message:`${policy.minimum_invigilators-acceptedInvigilators.length} more invigilator acceptance${policy.minimum_invigilators-acceptedInvigilators.length===1?" is":"s are"} needed.`,source:"exam_sitting",source_id:sitting.id});
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
    return {checked_at:new Date().toISOString(),can_schedule:blockers.length===0,blockers,candidate_count:candidateCount,room_capacity:space?.capacity??null,accepted_invigilator_count:acceptedInvigilators.length,required_invigilator_count:policy.minimum_invigilators,timetable_contract:"effective_school_schedule_v4"};
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
      const replay=await this.invigilationOffers.retainedResponseCommand(db,{
        school_id:schoolId,
        actor_user_id:user.id,
        command_id:data.command_id,
        assignment_id:assignmentId,
        decision:data.decision,
        request_hash:requestHash,
      });
      if(replay) return replay;
      const assignment=await db.selectFrom("assessment_sitting_invigilators").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).where("id","=",assignmentId).forUpdate().executeTakeFirst();
      if(!assignment) throw new NotFoundException("Invigilation offer not found.");
      if(assignment.user_id!==user.id) throw new ForbiddenException("Only the invited invigilator can respond.");
      const membership=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["staff","admin"]).executeTakeFirst();
      if(!membership) throw new ForbiddenException("Active school staff access is required.");
      if(assignment.revision!==data.expected_revision) throw new ConflictException("This invigilation offer changed. Refresh before responding.");
      if(assignment.status!=="offered") throw new ConflictException("This invigilation offer has already been answered.");
      if(data.decision==="declined"&&data.note.length<3) throw new BadRequestException("Add a reason for declining the invigilation duty.");
      const binding=await this.invigilationOffers.currentResponseBinding(db,{
        school_id:schoolId,
        assignment_id:assignment.id,
        assignment_revision:assignment.revision,
        selected_user_id:user.id,
      });
      if(!binding) throw new ConflictException("This invigilation Offer is not connected to current coordination evidence. Ask an administrator to reissue it.");
      const occurredAt=new Date();
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

  async prepareForSchedule(db:Db,user:AuthUser,current:AssessmentRecord){
    const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",current.school_id).where("assessment_id","=",current.id).forUpdate().executeTakeFirst();
    if(!sitting) throw new BadRequestException("Configure the campus space and invigilation before scheduling this physical examination.");
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
    const roster=(await sql<{id:string;student_id:string;roll_number:number|null}>`SELECT enrollment.id,enrollment.student_id,enrollment.roll_number FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${current.school_id}::uuid WHERE enrollment.class_section_id=${current.class_section_id}::uuid AND enrollment.term_id=${context.term_id}::uuid AND enrollment.is_active AND enrollment.enrolled_on<=${context.exam_date}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${context.exam_date}::date) ORDER BY enrollment.roll_number NULLS LAST,enrollment.student_id`.execute(db)).rows;
    const frozenAt=new Date();
    await db.insertInto("assessment_sitting_candidates").values(roster.map(row=>({school_id:current.school_id,sitting_id:sitting.id,assessment_id:current.id,student_id:row.student_id,enrollment_id:row.id,roll_number_snapshot:row.roll_number,frozen_at:frozenAt}))).execute();
    await sql`INSERT INTO assessment_candidate_attendance(school_id,sitting_id,candidate_id,student_id) SELECT school_id,sitting_id,id,student_id FROM assessment_sitting_candidates WHERE sitting_id=${sitting.id}::uuid`.execute(db);
    const updated=await db.updateTable("assessment_sittings").set({state:"ready",starts_at:startsAt,ends_at:endsAt,roster_frozen_at:frozenAt,revision:sitting.revision+1,updated_by:user.id,updated_at:frozenAt}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
    await this.audit(db,user,current.school_id,current.id,sitting.id,"assessment.sitting.ready","planning","ready",{candidate_count:roster.length,accepted_invigilator_count:readiness.accepted_invigilator_count,space_id:sitting.space_id,timetable_contract:readiness.timetable_contract,readiness_checked_at:readiness.checked_at});
    await this.emit(db,current.school_id,sitting.id,current.id,"sitting.ready",updated.revision);
    await this.modelBridge.recordPlan(db as Transaction<Database>,await this.modelSnapshot(db,user.id,current.id,updated),{
        idempotencyKey:`exam-sitting:${sitting.id}:plan:${updated.revision}`,
        correlationId:randomUUID(),
        expectedRevision:sitting.revision,
    });
    return updated;
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
    const assessment=(await sql<AssessmentRecord&{subject_name:string;class_name:string}>`SELECT assessment.*,subject.name AS subject_name,'Class '||section.grade||section.section AS class_name FROM assessments assessment JOIN subjects subject ON subject.id=assessment.subject_id JOIN class_sections section ON section.id=assessment.class_section_id WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid`.execute(this.db)).rows[0];
    if(!assessment) throw new NotFoundException("Assessment not found.");
    const space=await this.db.selectFrom("campus_spaces").innerJoin("institution_campuses","institution_campuses.id","campus_spaces.campus_id").select(["campus_spaces.id","campus_spaces.name","campus_spaces.code","campus_spaces.kind","campus_spaces.capacity","institution_campuses.name as campus_name"]).where("campus_spaces.school_id","=",schoolId).where("campus_spaces.id","=",sitting.space_id).executeTakeFirstOrThrow();
    const invigilators=(await sql`SELECT assignment.*,account.username,
        concat_ws(' ',account.first_name,account.last_name) AS name,account.avatar_url
      FROM assessment_sitting_invigilators assignment
      JOIN users account ON account.id=assignment.user_id
      WHERE assignment.sitting_id=${sitting.id}::uuid
      ORDER BY name,assignment.id`.execute(this.db)).rows;
    const viewerAssignment=viewerUserId?invigilators.find(row=>(row as {user_id:string}).user_id===viewerUserId)??null:null;
    const candidates=(await sql`SELECT candidate.*,concat_ws(' ',person.first_name,person.last_name) AS name,student.admission_number,person.avatar_url,attendance.id AS attendance_id,attendance.status AS attendance_status,attendance.observed_at,attendance.note AS attendance_note,attendance.revision AS attendance_revision FROM assessment_sitting_candidates candidate JOIN students student ON student.id=candidate.student_id JOIN school_people person ON person.id=student.person_id JOIN assessment_candidate_attendance attendance ON attendance.candidate_id=candidate.id WHERE candidate.sitting_id=${sitting.id}::uuid ORDER BY candidate.roll_number_snapshot NULLS LAST,candidate.student_id`.execute(this.db)).rows;
    const incidents=await this.db.selectFrom("assessment_sitting_incidents").selectAll().where("sitting_id","=",sitting.id).orderBy("observed_at","desc").orderBy("id").execute();
    const counts=(await sql<{total:number;unrecorded:number;present:number;late:number;absent:number;left_early:number}>`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='unrecorded')::int AS unrecorded,count(*) FILTER(WHERE status='present')::int AS present,count(*) FILTER(WHERE status='late')::int AS late,count(*) FILTER(WHERE status='absent')::int AS absent,count(*) FILTER(WHERE status='left_early')::int AS left_early FROM assessment_candidate_attendance WHERE sitting_id=${sitting.id}::uuid`.execute(this.db)).rows[0]!;
    const readiness=sitting.state==="planning"
      ? await this.readinessSnapshot(this.db,assessment,sitting)
      : null;
    return {assessment,sitting,space,invigilators,viewer_assignment:viewerAssignment,candidates,incidents,attendance_counts:counts,policy:sitting.policy_snapshot,readiness};
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
      const now=new Date();
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
      const next=action==="start"?"in_progress":"completed";
      const updated=await db.updateTable("assessment_sittings").set({state:next,revision:sitting.revision+1,updated_by:user.id,updated_at:now,...(action==="start"?{started_by:user.id,started_at:now}:{completed_by:user.id,completed_at:now})}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      let assessmentStatus:AssessmentStatus|undefined;
      if(action==="complete"&&policy.post_completion_marking_mode==="automatic"){
        const assessment=await db.selectFrom("assessments").select(["status","revision"]).where("school_id","=",schoolId).where("id","=",assessmentId).forUpdate().executeTakeFirstOrThrow();
        if(assessment.status==="scheduled"){
          await sql`INSERT INTO assessment_results(school_id,assessment_id,student_id) SELECT school_id,assessment_id,student_id FROM assessment_sitting_candidates WHERE sitting_id=${sitting.id}::uuid ON CONFLICT(assessment_id,student_id) DO NOTHING`.execute(db);
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

  async recordAttendance(user:AuthUser,schoolId:string,assessmentId:string,body:unknown){
    const data=attendanceInput.parse(body);
    return this.db.transaction().execute(async db=>{
      const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
      if(!sitting) throw new NotFoundException("Examination sitting not found.");
      await this.access(user,schoolId,sitting.id,db,true);
      if(sitting.revision!==data.expected_revision) throw new ConflictException("This examination sitting changed. Refresh before saving attendance.");
      if(sitting.state!=="in_progress") throw new ConflictException("Candidate attendance can be recorded only while the sitting is in progress.");
      const policy=sitting.policy_snapshot as ReturnType<ExamOperationsService["policyProjection"]>;
      if(Date.now()>new Date(sitting.ends_at).getTime()+policy.attendance_close_after_minutes*60_000) throw new BadRequestException("The configured attendance recording window has closed.");
      const updated=[];
      for(const record of data.records){
        const current=await db.selectFrom("assessment_candidate_attendance").selectAll().where("school_id","=",schoolId).where("sitting_id","=",sitting.id).where("student_id","=",record.student_id).forUpdate().executeTakeFirst();
        if(!current) throw new BadRequestException("A selected learner is not in the frozen examination roster.");
        if(current.revision!==record.expected_revision) throw new ConflictException("A candidate attendance record changed. Refresh before saving.");
        updated.push(await db.updateTable("assessment_candidate_attendance").set({status:record.status,observed_at:record.observed_at?new Date(record.observed_at):new Date(),note:record.note,recorded_by:user.id,revision:current.revision+1,updated_at:new Date()}).where("id","=",current.id).returningAll().executeTakeFirstOrThrow());
        await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.candidate_attendance.recorded",current.status,record.status,{student_id:record.student_id,attendance_id:current.id,note:record.note});
      }
      const revised=await db.updateTable("assessment_sittings").set({revision:sitting.revision+1,updated_by:user.id,updated_at:new Date()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      await this.emit(db,schoolId,sitting.id,assessmentId,"attendance.recorded",revised.revision);
      const counts=(await sql<{total:number;outstanding:number}>`SELECT count(*)::int AS total,
            count(*) FILTER(WHERE status='unrecorded')::int AS outstanding
          FROM assessment_candidate_attendance WHERE sitting_id=${sitting.id}::uuid`.execute(db)).rows[0]!;
      await this.modelBridge.recordAttendance(db,await this.modelSnapshot(db,user.id,assessmentId,revised),{
          idempotencyKey:`exam-sitting:${sitting.id}:attendance:${revised.revision}`,
          correlationId:randomUUID(),
          expectedRevision:sitting.revision,
          recordedCount:counts.total-counts.outstanding,
          outstandingCount:counts.outstanding,
      });
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
      let candidate:{id:string;student_id:string}|undefined;
      if(data.student_id){ candidate=await db.selectFrom("assessment_sitting_candidates").select(["id","student_id"]).where("sitting_id","=",sitting.id).where("student_id","=",data.student_id).executeTakeFirst(); if(!candidate) throw new BadRequestException("The selected learner is not in the frozen examination roster."); }
      const incident=await db.insertInto("assessment_sitting_incidents").values({school_id:schoolId,sitting_id:sitting.id,candidate_id:candidate?.id??null,student_id:candidate?.student_id??null,category:data.category,severity:data.severity,summary:data.summary,observed_at:data.observed_at?new Date(data.observed_at):new Date(),recorded_by:user.id}).returningAll().executeTakeFirstOrThrow();
      const revised=await db.updateTable("assessment_sittings").set({revision:sitting.revision+1,updated_by:user.id,updated_at:new Date()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.incident.recorded",null,"open",{incident_id:incident.id,student_id:incident.student_id,category:incident.category,severity:incident.severity});
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
      const updated=await db.updateTable("assessment_sitting_incidents").set({state:"resolved",resolution:data.resolution,resolved_by:user.id,resolved_at:new Date(),revision:incident.revision+1,updated_at:new Date()}).where("id","=",incident.id).returningAll().executeTakeFirstOrThrow();
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

  async cancelForAssessment(db:Db,user:AuthUser,schoolId:string,assessmentId:string,reason:string){
    const sitting=await db.selectFrom("assessment_sittings").selectAll().where("school_id","=",schoolId).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
    if(!sitting||sitting.state==="cancelled"||sitting.state==="completed") return sitting??null;
    const updated=await db.updateTable("assessment_sittings").set({state:"cancelled",cancelled_by:user.id,cancelled_at:new Date(),cancellation_reason:reason,revision:sitting.revision+1,updated_by:user.id,updated_at:new Date()}).where("id","=",sitting.id).returningAll().executeTakeFirstOrThrow();
    await this.audit(db,user,schoolId,assessmentId,sitting.id,"assessment.sitting.cancelled",sitting.state,"cancelled",{reason});
    await this.emit(db,schoolId,sitting.id,assessmentId,"sitting.cancelled",updated.revision);
    await this.modelBridge.recordAction(db as Transaction<Database>,await this.modelSnapshot(db,user.id,assessmentId,updated),{
        idempotencyKey:`exam-sitting:${sitting.id}:cancel:${updated.revision}`,
        correlationId:randomUUID(),
        expectedRevision:sitting.revision,
        action:"cancel",
        explanation:"An authorized administrator cancelled the examination sitting with an audit reason.",
    });
    return updated;
  }
}
