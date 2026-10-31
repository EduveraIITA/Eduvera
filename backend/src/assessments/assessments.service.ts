import { assessmentGrading } from "./assessment-grading.js";
import { gradingPolicyConfigurationSchema, policySemanticFingerprint } from "../academic-reports/grading-policy.js";
import { captureAcademicContext, datedAcademicRoster, retainedAcademicContext } from "../academic-reports/academic-record-context.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { assertActiveSchoolStaffMember, hasScopedSchoolPermission, schoolPermission } from "../roles/authorization.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { assessmentResultsHref } from "../workspace/canonical-application-links.js";
import { ExamOperationsService, isPhysicalAssessment } from "./exam-operations.service.js";
import { activityOccurrenceId } from '../schedule-planning/activity-occurrence.engine.js';
import { lockSchedule } from '../day-plans/schedule.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { assessmentEvidenceMetadata, putAssessmentEvidenceArtifact, readAssessmentEvidenceArtifact, removeUnacceptedAssessmentEvidenceArtifact } from "./assessment-evidence-artifacts.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface AssessmentUpload { filename: string; mimetype: string; data: Buffer }
const uuid = z.string().uuid();
const date = z.iso.date();
const cycleInput = z.object({ term_id: uuid, name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(32).transform((v) => v.toUpperCase()), starts_on: date, ends_on: date, result_label: z.string().trim().min(2).max(80).default("Result") });
const assessmentInput = z.object({ cycle_id: uuid, class_section_id: uuid, subject_id: uuid, title: z.string().trim().min(2).max(160), assessment_kind: z.enum(["exam","class_test","quiz","assignment","practical","viva","project","other"]), maximum_marks: z.coerce.number().positive().max(100000).multipleOf(0.01), grading_policy_id: uuid.nullable().default(null), weight_percent: z.coerce.number().positive().max(100).nullable().default(null), scheduled_at: z.iso.datetime().nullable().default(null), duration_minutes: z.coerce.number().int().positive().max(1440).nullable().default(null), venue: z.string().trim().max(160).default(""), instructions: z.string().trim().max(2000).default(""), evidence_requirement: z.enum(["none","optional","required"]).default("optional"), examiner_user_id: uuid, moderator_user_id: uuid, space_id: uuid.nullable().default(null), invigilator_user_ids: z.array(uuid).max(20).default([]) });
const resultInput = z.object({ result_id: uuid, outcome: z.enum(["scored","absent","exempt","withheld","not_evaluated"]), marks: z.number().finite().min(0).multipleOf(0.01).nullable().default(null), grade: z.string().trim().max(24).default(""), feedback: z.string().trim().max(1000).default(""), expected_revision: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) });
const resultsInput = z.object({ expected_assessment_revision: z.coerce.number().int().positive(), results: z.array(resultInput).min(1).max(500) });
const actionInput = z.object({ expected_revision: z.coerce.number().int().positive(), note: z.string().trim().max(1000).default(""), idempotency_key:uuid.optional() });
export { cycleInput, assessmentInput, resultsInput, actionInput };

interface AssessmentEventContractInput {
  schoolId: string;
  assessmentId: string;
  classSectionId: string;
  action: string;
  status: string;
  revision: number;
  audienceUserIds: string[];
}

export function assessmentUpdatedEvent(input: AssessmentEventContractInput) {
  const refresh = ["assessments", "teacher.home", "principal.home"];
  if (["schedule", "cancel"].includes(input.action)) refresh.push("calendar","student.home","student.calendar","parent.home","parent.calendar");
  if (input.action === "publish") refresh.push("notifications", "attention");
  return {
    schoolId: input.schoolId,
    eventType: "assessment.updated" as const,
    aggregateType: "assessment",
    aggregateId: input.assessmentId,
    audienceUserIds: input.audienceUserIds,
    payload: {
      assessment_id: input.assessmentId,
      class_section_id: input.classSectionId,
      action: input.action,
      status: input.status,
      revision: input.revision,
      refresh,
    },
    idempotencyKey: `assessment:${input.assessmentId}:${input.action}:${input.revision}`,
  };
}

@Injectable()
export class AssessmentsService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService, @Optional() private readonly examOperations?: ExamOperationsService,
    @Optional() @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands?: DomainCommandGatewayPort,
    @Optional() @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities?: HumanAgentIdentityPort) {}

  private async requireResultActor(db: Transaction<Database>, user: AuthUser, schoolId: string) {
    if (!this.identities) throw new ConflictException("Assessment result identity is unavailable. Try again after recovery.");
    const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your account is not currently linked to an active person in this institution.");
  }

  private async prepareResultsCommand(db: Transaction<Database>, user: AuthUser,
    current: { id:string;school_id:string;title:string;revision:number;result_policy?:unknown }, action: string, key: string, requestHash: string, capability: string) {
    if (!this.commands) throw new ConflictException("Assessment result coordination is unavailable. Try again after recovery.");
    const prepared = await this.commands.prepareDomainCommand(db, {
      school_id: current.school_id, actor_user_id: user.id, command_type: `assessment.results.${action}`,
      handler_key: `assessments.results_${action}`, handler_version: 1, source_domain: "assessments",
      target: { kind: "assessment", domain: "assessments", domain_id: current.id, label: current.title,
        lifecycle_state: "active", source_revision: current.revision, metadata: {} },
      current_revision: current.revision, expected_revision: current.revision, capability, purpose: `assessment_results_${action}`,
      requested_at: executionNow().toISOString(), correlation_id: key, causation_id: null,
      idempotency_key: `assessment-results:${user.id}:${key}`, operating_rule_version_ref: null, configuration_refs: current.result_policy ? (() => { const policy = assessmentGrading(current.result_policy, null, 1)!.policy; return [{ kind: "academic_grading_policy", ref: policy.policy_id, version: String(policy.version) }]; })() : [],
      authority_attestation: { evaluator_domain: "assessments", decision: "allowed", reason_codes: [action === "publish" ? "current_institution_administrator" : "current_assessment_responsibility"],
        authority_source_refs: [{ assessment_id: current.id, user_id: user.id, action: capability }], operating_rule_refs: [], valid_until: null },
      // Marks and correction prose stay in their authorized owning records.
      safe_context: { assessment_id: current.id, action, request_hash: requestHash },
    });
    if (prepared.status !== "ready") throw new ConflictException("The result command receipt needs recovery. Refresh before continuing.");
    return prepared;
  }

  private async completeResultsCommand(db: Transaction<Database>, schoolId: string, command: PreparedDomainCommand,
    action: string, revision: number | null, eventId: string | null, error?: HttpException) {
    await this.commands!.completeDomainCommand(db, { school_id: schoolId, command_id: command.command_id,
      terminal_state: error ? error.getStatus() === 409 ? "conflicted" : "rejected" : "accepted",
      code: error ? "assessment_results_refused" : `assessment_results_${action.replaceAll(".", "_")}`,
      explanation: error ? error.message.slice(0,500) : "The authorized assessment result action was accepted by its owning domain.",
      resulting_revision: revision, domain_event_id: eventId, metadata: error ? { http_status: error.getStatus() } : { action }, completed_at: executionNow().toISOString() });
  }

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    if(user.active_school_id&&user.active_school_id!==schoolId)throw new ForbiddenException('Choose this institution before managing its assessments.');
    const member = await db.selectFrom("school_memberships").innerJoin('users','users.id','school_memberships.user_id').select("school_memberships.role")
      .where("school_memberships.school_id","=",schoolId).where("school_memberships.user_id","=",user.id).where("school_memberships.is_active","=",true)
      .where('users.is_active','=',true).where("school_memberships.role","=","admin").forShare().executeTakeFirst();
    if (!member) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async assigned(user: AuthUser, schoolId: string, assessmentId: string, role?: "examiner"|"moderator", db: Db = this.db) {
    uuid.parse(assessmentId);
    const admin = await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","=","admin").executeTakeFirst();
    if (admin) return { role: "admin" as const };
    let query = db.selectFrom("assessment_staff_assignments").select("role").where("school_id","=",schoolId).where("assessment_id","=",assessmentId).where("user_id","=",user.id);
    if (role) query = query.where("role", "=", role);
    if (role) query = query.forShare();
    const assignment = await query.executeTakeFirst();
    if (!assignment&&!role) {
      const invigilator=await db.selectFrom("assessment_sitting_invigilators")
        .innerJoin("assessment_sittings","assessment_sittings.id","assessment_sitting_invigilators.sitting_id")
        .innerJoin("school_memberships",join=>join
          .onRef("school_memberships.school_id","=","assessment_sitting_invigilators.school_id")
          .onRef("school_memberships.user_id","=","assessment_sitting_invigilators.user_id"))
        .innerJoin("users","users.id","assessment_sitting_invigilators.user_id")
        .select("assessment_sitting_invigilators.id")
        .where("assessment_sitting_invigilators.school_id","=",schoolId)
        .where("assessment_sittings.assessment_id","=",assessmentId)
        .where("assessment_sitting_invigilators.user_id","=",user.id)
        .where("assessment_sitting_invigilators.status","in",["offered","accepted"])
        .where("school_memberships.is_active","=",true)
        .where("school_memberships.role","in",["staff","admin"])
        .where("users.is_active","=",true)
        .executeTakeFirst();
      if(invigilator) return {role:"invigilator" as const};
    }
    if (!assignment) throw new ForbiddenException(role ? `Only the assigned ${role} can do this.` : "This assessment is not assigned to you.");
    const action=role==="examiner" ? "assessments.mark" : role==="moderator" ? "assessments.moderate" : "assessments.view";
    if (!await hasScopedSchoolPermission(db,user.id,schoolId,action,"assessment",assessmentId)) throw new ForbiddenException("Your role does not allow this action on this assessment.");
    return assignment;
  }

  /** Exam-day responsibility alone never grants private result or evidence access. */
  private async canReadResults(user: AuthUser, schoolId: string, assessmentId: string, db: Db = this.db) {
    uuid.parse(schoolId); uuid.parse(assessmentId);
    if (user.active_school_id !== schoolId) throw new ForbiddenException("Choose this institution before viewing its results.");
    const member = await db.selectFrom("school_memberships").innerJoin("users", "users.id", "school_memberships.user_id")
      .select("school_memberships.role").where("school_memberships.school_id", "=", schoolId)
      .where("school_memberships.user_id", "=", user.id).where("school_memberships.is_active", "=", true)
      .where("users.is_active", "=", true).where("school_memberships.role", "in", ["admin", "staff"])
      .orderBy(sql`CASE WHEN school_memberships.role='admin' THEN 0 ELSE 1 END`).executeTakeFirst();
    if (!member) return false;
    if (member.role === "admin") return true;
    const assignment = await db.selectFrom("assessment_staff_assignments").select("role")
      .where("school_id", "=", schoolId).where("assessment_id", "=", assessmentId).where("user_id", "=", user.id)
      .where("role", "in", ["examiner", "moderator"]).executeTakeFirst();
    return Boolean(assignment) && await hasScopedSchoolPermission(db, user.id, schoolId, "assessments.view", "assessment", assessmentId);
  }

  private async requireAvailableEvidence(db: Transaction<Database>, user: AuthUser, schoolId: string, assessmentId: string) {
    const results = await db.selectFrom("assessment_results").select("id").where("school_id", "=", schoolId)
      .where("assessment_id", "=", assessmentId).execute();
    const evidence = await db.selectFrom("assessment_evidence").selectAll().where("school_id", "=", schoolId)
      .where("assessment_id", "=", assessmentId).orderBy("uploaded_at", "desc").execute();
    let missing = 0;
    for (const result of results) {
      let available = false;
      for (const record of evidence.filter(file => file.result_id === result.id)) {
        try {
          const file = await readAssessmentEvidenceArtifact(schoolId, assessmentId, record);
          file.stream.destroy();
          if (file.source_content_omitted || file.sha256 === null) continue;
          // Legacy evidence gains only a digest of bytes actually read now, not
          // a fabricated backfill or a claim that an omitted original exists.
          if (record.sha256 === null) {
            await db.updateTable("assessment_evidence").set({ sha256: file.sha256 })
              .where("school_id", "=", schoolId).where("id", "=", record.id).where("sha256", "is", null).execute();
            await this.audit(db,user,schoolId,assessmentId,"assessment.evidence.verified",null,null,
              { result_id:result.id, evidence_id:record.id, sha256:file.sha256, size_bytes:record.size_bytes });
          }
          available = true; break;
        } catch (cause) { if (!(cause instanceof ConflictException)) throw cause; }
      }
      if (!available) missing += 1;
    }
    if (missing) throw new BadRequestException(`${missing} learner results need an available evidence file. Add replacements for missing, damaged or omitted files before submitting.`);
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, assessmentId: string|null, action: string, fromStatus: string|null, toStatus: string|null, metadata: Record<string,unknown> = {}) {
    await db.insertInto("assessment_audits").values({ school_id: schoolId, assessment_id: assessmentId, actor_id: user.id, action, from_status: fromStatus, to_status: toStatus, metadata }).execute();
  }

  private async validateClassTestSchedule(db:Db,input:{school_id:string;class_section_id:string;subject_id:string;scheduled_at:Date|string|null;duration_minutes:number|null},excludeAssessmentId?:string){
    if(!input.scheduled_at||!input.duration_minutes) throw new BadRequestException("A class test needs a date, start time and duration.");
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assessment-class-test:${input.school_id}:${input.class_section_id}`},0))`.execute(db);
    const context=(await sql<{school_date:string;test_date:string;same_day:boolean;instructional:boolean;fits_subject_period:boolean}>`
      SELECT (now() AT TIME ZONE school.timezone)::date::text AS school_date,
        (${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date::text AS test_date,
        ((${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date =
          ((${input.scheduled_at}::timestamptz + make_interval(mins=>${input.duration_minutes})) AT TIME ZONE school.timezone)::date) AS same_day,
        COALESCE((SELECT day.is_instructional FROM school_calendar_days day
          WHERE day.school_id=school.id AND day.date=(${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date),
          EXISTS(SELECT 1 FROM effective_school_schedule(school.id,(${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date) schedule
            WHERE schedule.class_section_id=${input.class_section_id}::uuid AND NOT schedule.cancelled)) AS instructional,
        EXISTS(SELECT 1 FROM effective_school_schedule(school.id,(${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date) schedule
          WHERE schedule.class_section_id=${input.class_section_id}::uuid AND schedule.subject_id=${input.subject_id}::uuid
            AND schedule.slot_type='class' AND NOT schedule.cancelled
            AND (${input.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::time>=schedule.starts_at
            AND ((${input.scheduled_at}::timestamptz + make_interval(mins=>${input.duration_minutes})) AT TIME ZONE school.timezone)::time<=schedule.ends_at) AS fits_subject_period
      FROM schools school WHERE school.id=${input.school_id}::uuid
    `.execute(db)).rows[0];
    if(!context?.same_day) throw new BadRequestException("A class test must start and finish on one school day.");
    if(context.test_date<=context.school_date) throw new BadRequestException("A class test must be scheduled for a future school day.");
    if(!context.instructional) throw new BadRequestException("Choose an instructional school day for this class test.");
    if(!context.fits_subject_period) throw new BadRequestException("The class test must fit within an effective period for the selected subject.");
    const clash=(await sql<{id:string}>`
      SELECT candidate.id FROM assessments candidate
      WHERE candidate.school_id=${input.school_id}::uuid AND candidate.class_section_id=${input.class_section_id}::uuid
        AND candidate.status IN ('scheduled','marking','submitted','moderated','published')
        AND candidate.scheduled_at<(${input.scheduled_at}::timestamptz + make_interval(mins=>${input.duration_minutes}))
        AND (candidate.scheduled_at + make_interval(mins=>COALESCE(candidate.duration_minutes,1)))>${input.scheduled_at}::timestamptz
        AND (${excludeAssessmentId??null}::uuid IS NULL OR candidate.id<>${excludeAssessmentId??null}::uuid)
      UNION ALL
      SELECT event.id FROM campus_events event
      WHERE event.school_id=${input.school_id}::uuid AND event.status='published'
        AND (event.audience_mode='school' OR EXISTS(SELECT 1 FROM campus_event_class_sections audience
          WHERE audience.event_id=event.id AND audience.class_section_id=${input.class_section_id}::uuid))
        AND event.starts_at<(${input.scheduled_at}::timestamptz + make_interval(mins=>${input.duration_minutes}))
        AND event.ends_at>${input.scheduled_at}::timestamptz
      LIMIT 1
    `.execute(db)).rows[0];
    if(clash) throw new ConflictException("This class already has another scheduled assessment or published event in that time window.");
  }

  private async eventAudience(db: Db, schoolId: string, assessmentId: string, includeFamily: boolean) {
    const staff = (await sql<{ user_id: string }>`
      SELECT membership.user_id FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
      UNION
      SELECT assignment.user_id FROM assessment_staff_assignments assignment
      JOIN school_memberships membership ON membership.school_id=assignment.school_id
        AND membership.user_id=assignment.user_id AND membership.role='staff' AND membership.is_active
      JOIN users account ON account.id=assignment.user_id AND account.is_active
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.assessment_id=${assessmentId}::uuid
        AND staff_has_resource_permission(${schoolId}::uuid,assignment.user_id,'assessments.view','assessment',${assessmentId}::uuid)
      UNION
      SELECT invigilator.user_id FROM assessment_sitting_invigilators invigilator
      JOIN school_memberships membership ON membership.school_id=invigilator.school_id
        AND membership.user_id=invigilator.user_id AND membership.is_active
      JOIN users account ON account.id=invigilator.user_id AND account.is_active
      JOIN assessment_sittings sitting ON sitting.id=invigilator.sitting_id
      WHERE invigilator.school_id=${schoolId}::uuid AND sitting.assessment_id=${assessmentId}::uuid
        AND invigilator.status IN ('offered','accepted')
    `.execute(db)).rows.map((row) => row.user_id);
    if (!includeFamily) return staff;
    const family = (await sql<{ user_id: string }>`
      SELECT student.user_id FROM assessment_results result
      JOIN students student ON student.id=result.student_id AND student.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=result.school_id
        AND membership.user_id=student.user_id AND membership.role='student' AND membership.is_active
      JOIN users account ON account.id=student.user_id AND account.is_active
      WHERE result.school_id=${schoolId}::uuid AND result.assessment_id=${assessmentId}::uuid
      UNION
      SELECT student.user_id FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
      JOIN enrollments enrollment ON enrollment.class_section_id=assessment.class_section_id AND enrollment.term_id=cycle.term_id
      JOIN students student ON student.id=enrollment.student_id AND student.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=assessment.school_id AND membership.user_id=student.user_id AND membership.role='student' AND membership.is_active
      JOIN users account ON account.id=student.user_id AND account.is_active
      WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid
        AND enrollment.is_active
        AND enrollment.enrolled_on<=COALESCE((assessment.scheduled_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=assessment.school_id))::date,current_date)
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>COALESCE((assessment.scheduled_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=assessment.school_id))::date,current_date))
      UNION
      SELECT parent.user_id FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
      JOIN enrollments enrollment ON enrollment.class_section_id=assessment.class_section_id AND enrollment.term_id=cycle.term_id
      JOIN guardian_relationships relationship ON relationship.school_id=assessment.school_id AND relationship.student_id=enrollment.student_id
      JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=assessment.school_id AND membership.user_id=parent.user_id AND membership.role='guardian' AND membership.is_active
      JOIN users account ON account.id=parent.user_id AND account.is_active
      WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid
        AND enrollment.is_active
        AND enrollment.enrolled_on<=COALESCE((assessment.scheduled_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=assessment.school_id))::date,current_date)
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>COALESCE((assessment.scheduled_at AT TIME ZONE (SELECT timezone FROM schools WHERE id=assessment.school_id))::date,current_date))
      UNION
      SELECT parent.user_id FROM assessment_results result
      JOIN guardian_relationships relationship ON relationship.school_id=result.school_id AND relationship.student_id=result.student_id
      JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=result.school_id
        AND membership.user_id=parent.user_id AND membership.role='guardian' AND membership.is_active
      JOIN users account ON account.id=parent.user_id AND account.is_active
      WHERE result.school_id=${schoolId}::uuid AND result.assessment_id=${assessmentId}::uuid
    `.execute(db)).rows.map((row) => row.user_id);
    return [...new Set([...staff, ...family])];
  }

  private async emitUpdated(
    db: Db,
    assessment: { id: string; school_id: string; class_section_id: string; status: string; revision: number },
    action: string,
    includeFamily = false,
  ) {
    const audienceUserIds = await this.eventAudience(db, assessment.school_id, assessment.id, includeFamily);
    await this.events.enqueueUserEvent(db, assessmentUpdatedEvent({
      schoolId: assessment.school_id,
      assessmentId: assessment.id,
      classSectionId: assessment.class_section_id,
      action,
      status: assessment.status,
      revision: assessment.revision,
      audienceUserIds,
    }));
    return (await sql<{id:string}>`SELECT id FROM event_outbox WHERE school_id=${assessment.school_id}::uuid
      AND idempotency_key=${`assessment:${assessment.id}:${action}:${assessment.revision}`}`.execute(db)).rows[0]!.id;
  }

  async workspace(user: AuthUser, schoolId: string) {
    const membership = await this.db.selectFrom("school_memberships").select("role")
      .where("school_id","=",schoolId).where("user_id","=",user.id)
      .where("is_active","=",true).where("role","in",["admin","staff"])
      .orderBy(sql`role='admin'`,"desc").executeTakeFirst();
    if (!membership) throw new ForbiddenException("Active school staff access is required.");
    const admin = membership.role === "admin";
    const gradingPolicies = await this.db.selectFrom("academic_grading_policies").selectAll().where("school_id", "=", schoolId).where("status", "=", "active").orderBy("code").orderBy("version", "desc").execute();
    const cycles = await sql`SELECT cycle.*,term.name AS term_name,term.academic_year,
      count(assessment.id)::int AS assessment_count,
      count(assessment.id) FILTER(WHERE assessment.status='published')::int AS published_count
      FROM assessment_cycles cycle JOIN academic_terms term ON term.id=cycle.term_id
      LEFT JOIN assessments assessment ON assessment.cycle_id=cycle.id
      WHERE cycle.school_id=${schoolId}::uuid GROUP BY cycle.id,term.name,term.academic_year ORDER BY cycle.starts_on DESC`.execute(this.db);
    const assessments = await sql`SELECT assessment.*,COALESCE(space.name,assessment.venue) AS venue,cycle.name AS cycle_name,subject.name AS subject_name,subject.color,subject.icon,
      'Class '||section.grade||section.section AS class_name,
      examiner.user_id AS examiner_user_id,examiner_user.first_name||' '||examiner_user.last_name AS examiner_name,
      moderator.user_id AS moderator_user_id,moderator_user.first_name||' '||moderator_user.last_name AS moderator_name,
      count(result.id)::int AS roster_count,count(result.id) FILTER(WHERE result.outcome='unrecorded')::int AS unrecorded_count,
      COALESCE((SELECT max(sequence) FROM assessment_publications publication WHERE publication.assessment_id=assessment.id),0)::int AS publication_sequence,
      (SELECT jsonb_build_object('id',mine.id,'status',mine.status,'revision',mine.revision,'response_note',mine.response_note)
        FROM assessment_sitting_invigilators mine JOIN assessment_sittings mine_sitting ON mine_sitting.id=mine.sitting_id
        WHERE mine_sitting.assessment_id=assessment.id AND mine.user_id=${user.id}::uuid LIMIT 1) AS viewer_invigilation_assignment
      FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
      JOIN class_sections section ON section.id=assessment.class_section_id JOIN subjects subject ON subject.id=assessment.subject_id
      LEFT JOIN assessment_staff_assignments examiner ON examiner.assessment_id=assessment.id AND examiner.role='examiner'
      LEFT JOIN users examiner_user ON examiner_user.id=examiner.user_id
      LEFT JOIN assessment_staff_assignments moderator ON moderator.assessment_id=assessment.id AND moderator.role='moderator'
      LEFT JOIN users moderator_user ON moderator_user.id=moderator.user_id
      LEFT JOIN assessment_results result ON result.assessment_id=assessment.id
      LEFT JOIN assessment_sittings sitting ON sitting.assessment_id=assessment.id LEFT JOIN campus_spaces space ON space.id=sitting.space_id
      WHERE assessment.school_id=${schoolId}::uuid AND (${admin} OR EXISTS(SELECT 1 FROM assessment_staff_assignments mine WHERE mine.assessment_id=assessment.id AND mine.user_id=${user.id}::uuid) OR EXISTS(SELECT 1 FROM assessment_sitting_invigilators mine JOIN assessment_sittings mine_sitting ON mine_sitting.id=mine.sitting_id WHERE mine_sitting.assessment_id=assessment.id AND mine.user_id=${user.id}::uuid AND mine.status IN ('offered','accepted')))
      GROUP BY assessment.id,space.name,cycle.name,subject.name,subject.color,subject.icon,section.grade,section.section,examiner.user_id,examiner_user.first_name,examiner_user.last_name,moderator.user_id,moderator_user.first_name,moderator_user.last_name
      ORDER BY assessment.scheduled_at NULLS LAST,assessment.created_at DESC`.execute(this.db);
    if (!admin) {
      const classes = (await sql<{ id:string; name:string; academic_year:string }>`
        SELECT DISTINCT section.id,'Class '||section.grade||section.section AS name,section.academic_year
        FROM class_sections section
        JOIN staff_role_bindings binding ON binding.school_id=section.school_id
          AND binding.context_kind='class' AND binding.scope_id=section.id
        WHERE section.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid
          AND binding.status='active' AND binding.role_active
          AND binding.source_kind='class_assignment'
          AND binding.role_id IN (SELECT id FROM staff_responsibility_types
            WHERE school_id=${schoolId}::uuid AND code IN ('class_teacher','subject_teacher'))
          AND current_date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
        ORDER BY section.academic_year DESC,name,section.id
      `.execute(this.db)).rows;
      if (!classes.length) return { mode: "staff", can_plan_class_test: false, planner_user_id: user.id, cycles: cycles.rows, assessments: assessments.rows };
      const subjects = (await sql<{ id:string; name:string; color:string; icon:string; class_section_ids:string[] }>`
        SELECT subject.id,subject.name,subject.color,subject.icon,
          array_agg(DISTINCT binding.scope_id ORDER BY binding.scope_id) AS class_section_ids
        FROM subjects subject
        JOIN staff_role_bindings binding ON binding.school_id=subject.school_id
          AND binding.context_kind='class' AND binding.user_id=${user.id}::uuid
          AND binding.status='active' AND binding.role_active
          AND binding.source_kind='class_assignment'
          AND binding.role_id IN (SELECT id FROM staff_responsibility_types
            WHERE school_id=${schoolId}::uuid AND code IN ('class_teacher','subject_teacher'))
          AND (binding.subject_id IS NULL OR binding.subject_id=subject.id)
          AND current_date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
        WHERE subject.school_id=${schoolId}::uuid
          AND (binding.subject_id IS NOT NULL OR EXISTS(
            SELECT 1 FROM timetable_slots slot
            WHERE slot.class_section_id=binding.scope_id AND slot.subject_id=subject.id
          ))
        GROUP BY subject.id,subject.name,subject.color,subject.icon
        ORDER BY subject.name,subject.id
      `.execute(this.db)).rows;
      const reviewers = (await sql<{ id:string; first_name:string; last_name:string; designation:string|null }>`
        SELECT DISTINCT account.id,CASE WHEN profile.id IS NOT NULL THEN person.first_name ELSE account.first_name END AS first_name,
          CASE WHEN profile.id IS NOT NULL THEN person.last_name ELSE account.last_name END AS last_name,profile.designation
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        LEFT JOIN staff_profiles profile ON profile.school_id=membership.school_id AND profile.user_id=membership.user_id
        LEFT JOIN school_people person ON person.school_id=profile.school_id AND person.id=profile.person_id
        WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
        ORDER BY first_name,last_name,account.id
      `.execute(this.db)).rows;
      return {
        mode: "staff", can_plan_class_test: Boolean(subjects.length && reviewers.length), planner_user_id: user.id,
        cycles: cycles.rows, assessments: assessments.rows,
        references: { classes, subjects, staff: reviewers, grading_policies: gradingPolicies },
      };
    }
    const terms = await sql`SELECT id,name,academic_year,starts_on,ends_on FROM academic_terms WHERE school_id=${schoolId}::uuid AND is_active ORDER BY starts_on DESC`.execute(this.db);
    const classes = await sql`SELECT id,'Class '||grade||section AS name,academic_year FROM class_sections WHERE school_id=${schoolId}::uuid ORDER BY academic_year DESC,grade,section`.execute(this.db);
    const subjects = await sql`SELECT id,name,color,icon FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(this.db);
    const staff = await sql`SELECT DISTINCT u.id,CASE WHEN profile.id IS NOT NULL THEN person.first_name ELSE u.first_name END AS first_name,
      CASE WHEN profile.id IS NOT NULL THEN person.last_name ELSE u.last_name END AS last_name,profile.designation
      FROM users u JOIN school_memberships membership ON membership.user_id=u.id
      LEFT JOIN staff_profiles profile ON profile.school_id=membership.school_id AND profile.user_id=u.id
      LEFT JOIN school_people person ON person.school_id=profile.school_id AND person.id=profile.person_id
      WHERE membership.school_id=${schoolId}::uuid AND membership.role IN ('staff','admin') AND membership.is_active AND u.is_active
      ORDER BY first_name,last_name`.execute(this.db);
    const spaces=await sql`SELECT space.id,space.name,space.code,space.kind,space.capacity,campus.name AS campus_name FROM campus_spaces space JOIN institution_campuses campus ON campus.id=space.campus_id WHERE space.school_id=${schoolId}::uuid AND space.status='active' AND space.is_bookable ORDER BY campus.name,space.name,space.id`.execute(this.db);
    return { mode: "admin", cycles: cycles.rows, assessments: assessments.rows, references: { terms: terms.rows, classes: classes.rows, subjects: subjects.rows, staff: staff.rows, spaces:spaces.rows, grading_policies: gradingPolicies } };
  }

  async calendar(user:AuthUser,schoolId:string,from:string,to:string,studentId?:string) {
    uuid.parse(schoolId);date.parse(from);date.parse(to);
    if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)throw new BadRequestException('Choose a calendar range of up to 93 days.');
    let admin=false;
    if(studentId) { uuid.parse(studentId);await this.familyResults(user,schoolId,studentId); }
    else {
      const access=await this.db.selectFrom("school_memberships").select("role").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["admin","staff"]).orderBy(sql`role='admin'`,"desc").executeTakeFirst();
      if(!access) throw new ForbiddenException("Active school staff access is required.");
      admin=access.role==='admin';
    }
    // Calendar projection intentionally excludes results, marks, private notes,
    // drafts and cancelled assessments. It does not cancel normal teaching.
    const items=await sql<{id:string;title:string;scheduled_at:string;date:string;venue:string;subject_name:string;class_name:string;duration_minutes:number|null}>`
      SELECT a.id,a.title,a.scheduled_at,(a.scheduled_at AT TIME ZONE school.timezone)::date::text AS date,COALESCE(space.name,a.venue) AS venue,s.name AS subject_name,'Class '||c.grade||c.section AS class_name,a.duration_minutes
      FROM assessments a JOIN schools school ON school.id=a.school_id JOIN subjects s ON s.id=a.subject_id JOIN class_sections c ON c.id=a.class_section_id JOIN assessment_cycles cycle ON cycle.id=a.cycle_id LEFT JOIN assessment_sittings sitting ON sitting.assessment_id=a.id LEFT JOIN campus_spaces space ON space.id=sitting.space_id
      WHERE a.school_id=${schoolId}::uuid AND a.status NOT IN ('draft','cancelled') AND (a.scheduled_at AT TIME ZONE school.timezone)::date BETWEEN ${from}::date AND ${to}::date
      AND (${admin} OR (${studentId??null}::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM enrollments e WHERE e.student_id=${studentId??null}::uuid AND e.class_section_id=a.class_section_id AND e.term_id=cycle.term_id AND e.is_active AND e.enrolled_on<=(a.scheduled_at AT TIME ZONE school.timezone)::date)) OR (${studentId??null}::uuid IS NULL AND (staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,'assessments.view','assessment',a.id) OR EXISTS(SELECT 1 FROM assessment_sitting_invigilators invigilator JOIN assessment_sittings invigilator_sitting ON invigilator_sitting.id=invigilator.sitting_id WHERE invigilator_sitting.assessment_id=a.id AND invigilator.user_id=${user.id}::uuid AND invigilator.status IN ('offered','accepted')))))
      ORDER BY a.scheduled_at,a.title`.execute(this.db);
    return {items:items.rows};
  }

  async detail(user: AuthUser, schoolId: string, assessmentId: string) {
    const access = await this.assigned(user,schoolId,assessmentId);
    const canReadResults = await this.canReadResults(user, schoolId, assessmentId);
    if (!canReadResults && access.role !== "invigilator") throw new ForbiddenException("You cannot view this assessment's private results.");
    const assessment = (await sql`SELECT assessment.*,COALESCE(space.name,assessment.venue) AS venue,cycle.name AS cycle_name,cycle.term_id,subject.name AS subject_name,subject.color,subject.icon,'Class '||section.grade||section.section AS class_name,
      examiner.user_id AS examiner_user_id,examiner_user.first_name||' '||examiner_user.last_name AS examiner_name,
      moderator.user_id AS moderator_user_id,moderator_user.first_name||' '||moderator_user.last_name AS moderator_name
      FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id JOIN subjects subject ON subject.id=assessment.subject_id JOIN class_sections section ON section.id=assessment.class_section_id
      LEFT JOIN assessment_staff_assignments examiner ON examiner.assessment_id=assessment.id AND examiner.role='examiner' LEFT JOIN users examiner_user ON examiner_user.id=examiner.user_id
      LEFT JOIN assessment_staff_assignments moderator ON moderator.assessment_id=assessment.id AND moderator.role='moderator' LEFT JOIN users moderator_user ON moderator_user.id=moderator.user_id
      LEFT JOIN assessment_sittings sitting ON sitting.assessment_id=assessment.id LEFT JOIN campus_spaces space ON space.id=sitting.space_id
      WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid`.execute(this.db)).rows[0];
    if (!assessment) throw new NotFoundException("Assessment not found.");
    const results = canReadResults ? await sql`SELECT result.*,person.first_name,person.last_name,student.admission_number,
      (result.academic_roster_source->>'roll_number')::int AS roll_number,
      count(evidence.id) FILTER(WHERE evidence.sha256 IS NOT NULL)::int AS evidence_count,json_agg(json_build_object('id',evidence.id,'original_name',evidence.original_name,'content_type',evidence.content_type,'size_bytes',evidence.size_bytes,'uploaded_at',evidence.uploaded_at,'integrity',CASE WHEN evidence.sha256 IS NULL THEN 'legacy_unverified' ELSE 'verified' END)) FILTER(WHERE evidence.id IS NOT NULL) AS evidence
      FROM assessment_results result JOIN students student ON student.id=result.student_id JOIN school_people person ON person.id=student.person_id
      LEFT JOIN assessment_evidence evidence ON evidence.result_id=result.id
      WHERE result.assessment_id=${assessmentId}::uuid GROUP BY result.id,person.first_name,person.last_name,student.admission_number ORDER BY roll_number NULLS LAST,person.first_name,person.last_name`.execute(this.db) : { rows: [] };
    const publications = canReadResults ? await sql`SELECT * FROM assessment_publications WHERE school_id=${schoolId}::uuid AND assessment_id=${assessmentId}::uuid ORDER BY sequence DESC`.execute(this.db) : { rows: [] };
    const canMark=await hasScopedSchoolPermission(this.db,user.id,schoolId,"assessments.mark","assessment",assessmentId);
    const canModerate=await hasScopedSchoolPermission(this.db,user.id,schoolId,"assessments.moderate","assessment",assessmentId);
    const examOperation=this.examOperations?await this.examOperations.projection(schoolId,assessmentId,undefined,user.id):null;
    return { assessment, results: results.rows, publications: publications.rows, exam_operation:examOperation, viewer_role: access.role === "admin" ? "admin" : access.role === "examiner" && canMark ? "examiner" : access.role === "moderator" && canModerate ? "moderator" : access.role === "invigilator" ? "invigilator" : "viewer" };
  }

  async createCycle(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user,schoolId);
    const data=cycleInput.parse(body);
    if(data.ends_on<data.starts_on) throw new BadRequestException("End date cannot be before start date.");
    const term=await this.db.selectFrom("academic_terms").selectAll().where("id","=",data.term_id).where("school_id","=",schoolId).executeTakeFirst();
    if(!term) throw new BadRequestException("Choose a term in this institution.");
    if(data.starts_on<term.starts_on || data.ends_on>term.ends_on) throw new BadRequestException("Assessment cycle dates must be inside the selected term.");
    try { const cycle=await this.db.insertInto("assessment_cycles").values({school_id:schoolId,term_id:data.term_id,name:data.name,code:data.code,starts_on:data.starts_on,ends_on:data.ends_on,status:"active",result_label:data.result_label,created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow(); await this.audit(this.db,user,schoolId,null,"assessment.cycle.created",null,"active",{cycle_id:cycle.id}); return cycle; }
    catch(error){ if((error as {code?:string}).code==="23505") throw new ConflictException("This cycle code is already used in the term."); throw error; }
  }

  async createAssessment(user: AuthUser, schoolId: string, body: unknown) {
    const data=assessmentInput.parse(body);
    if(data.examiner_user_id===data.moderator_user_id) throw new BadRequestException("Examiner and moderator must be different people.");
    const physicalAssessment=isPhysicalAssessment(data.assessment_kind);
    const requestsPhysicalSitting=data.space_id!==null||data.invigilator_user_ids.length>0;
    return this.db.transaction().execute(async(db)=>{
      const membership=await db.selectFrom("school_memberships").select("role").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["admin","staff"])
        .orderBy(sql`CASE WHEN role='admin' THEN 0 ELSE 1 END`).executeTakeFirst();
      if(!membership) throw new ForbiddenException("Active school staff access is required.");
      const staffPlan=membership.role==="staff";
      if(staffPlan){
        if(data.assessment_kind!=="class_test") throw new ForbiddenException("Teachers may plan class tests only.");
        if(data.examiner_user_id!==user.id) throw new ForbiddenException("A teacher-planned class test must keep the teacher as examiner.");
        if(!data.scheduled_at) throw new BadRequestException("Choose the class test date and time.");
        const allowed=(await sql<{allowed:boolean}>`SELECT EXISTS(
          SELECT 1 FROM staff_role_bindings binding
          JOIN schools school ON school.id=binding.school_id
          WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid
            AND binding.context_kind='class' AND binding.scope_id=${data.class_section_id}::uuid
            AND binding.status='active' AND binding.role_active
            AND binding.source_kind='class_assignment'
            AND binding.role_id IN (SELECT id FROM staff_responsibility_types
              WHERE school_id=${schoolId}::uuid AND code IN ('class_teacher','subject_teacher'))
            AND (binding.subject_id IS NULL OR binding.subject_id=${data.subject_id}::uuid)
            AND (${data.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date
              BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
            AND (binding.subject_id IS NOT NULL OR EXISTS(
              SELECT 1 FROM timetable_slots slot
              WHERE slot.class_section_id=binding.scope_id AND slot.subject_id=${data.subject_id}::uuid
            ))
        ) AS allowed`.execute(db)).rows[0]?.allowed;
        if(!allowed) throw new ForbiddenException("This class test is outside your assigned class, subject or dates.");
        const reviewer=await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",data.moderator_user_id).where("role","=","admin").where("is_active","=",true).executeTakeFirst();
        if(!reviewer) throw new BadRequestException("Choose an active school administrator as the independent reviewer.");
      }
      if(requestsPhysicalSitting&&!physicalAssessment) throw new BadRequestException("A campus space and invigilators can be assigned only to an exam, practical or viva.");
      if(physicalAssessment&&(!data.space_id||!data.invigilator_user_ids.length)) throw new BadRequestException("A physical exam, practical or viva needs a campus space and at least one invigilator.");
      if(physicalAssessment&&data.scheduled_at&&new Date(data.scheduled_at).getTime()<=executionNow().getTime()) throw new BadRequestException("Choose a future examination time before creating the sitting.");
      const cycle=await db.selectFrom("assessment_cycles").selectAll().where("id","=",data.cycle_id).where("school_id","=",schoolId).executeTakeFirst();
      if(!cycle) throw new BadRequestException("Choose an assessment cycle in this institution.");
      if(staffPlan&&data.scheduled_at){
        const scheduledDate=(await sql<{date:string}>`SELECT (${data.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date::text AS date FROM schools school WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0]?.date;
        if(!scheduledDate||scheduledDate<cycle.starts_on||scheduledDate>cycle.ends_on) throw new BadRequestException("Choose a date inside the selected assessment cycle.");
      }
      const classRow=await db.selectFrom("class_sections").select(["id","academic_year"]).where("id","=",data.class_section_id).where("school_id","=",schoolId).executeTakeFirst();
      const subject=await db.selectFrom("subjects").select("id").where("id","=",data.subject_id).where("school_id","=",schoolId).executeTakeFirst();
      if(!classRow||!subject) throw new BadRequestException("Choose a class and subject in this institution.");
      const cycleTerm=await db.selectFrom("academic_terms").select("academic_year").where("id","=",cycle.term_id).where("school_id","=",schoolId).executeTakeFirst();
      if(!cycleTerm||classRow.academic_year!==cycleTerm.academic_year) throw new BadRequestException("Choose a class in the assessment cycle’s academic year.");
      const memberCount=(await sql<{count:number}>`SELECT count(DISTINCT user_id)::int AS count FROM school_memberships WHERE school_id=${schoolId}::uuid AND user_id IN (${data.examiner_user_id}::uuid,${data.moderator_user_id}::uuid) AND role IN ('staff','admin') AND is_active`.execute(db)).rows[0]!.count;
      if(memberCount!==2) throw new BadRequestException("Examiner and moderator need active staff access.");
      await assertActiveSchoolStaffMember(db,data.examiner_user_id,schoolId,"internal_examiner");
      await assertActiveSchoolStaffMember(db,data.moderator_user_id,schoolId,"exam_in_charge");
      let resultPolicy: unknown = null;
      if (data.grading_policy_id) {
        const policy = await db.selectFrom("academic_grading_policies").selectAll()
          .where("id", "=", data.grading_policy_id).where("school_id", "=", schoolId).where("status", "=", "active").forShare().executeTakeFirst();
        if (!policy) throw new BadRequestException("Choose an active grading policy in this institution.");
        const configuration = gradingPolicyConfigurationSchema.parse(policy.configuration);
        resultPolicy = { policy_id: policy.id, code: policy.code, name: policy.name, version: policy.version, configuration, semantic_fingerprint: policySemanticFingerprint(configuration) };
      }
      const assessment=await db.insertInto("assessments").values({school_id:schoolId,cycle_id:data.cycle_id,class_section_id:data.class_section_id,subject_id:data.subject_id,title:data.title,assessment_kind:data.assessment_kind,maximum_marks:String(data.maximum_marks),grading_policy_id:data.grading_policy_id,result_policy:resultPolicy,weight_percent:data.weight_percent===null?null:String(data.weight_percent),scheduled_at:data.scheduled_at?new Date(data.scheduled_at):null,duration_minutes:data.duration_minutes,venue:data.venue,instructions:data.instructions,evidence_requirement:data.evidence_requirement,created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("assessment_staff_assignments").values([{school_id:schoolId,assessment_id:assessment.id,user_id:data.examiner_user_id,role:"examiner",assigned_by:user.id},{school_id:schoolId,assessment_id:assessment.id,user_id:data.moderator_user_id,role:"moderator",assigned_by:user.id}]).execute();
      await this.audit(db,user,schoolId,assessment.id,"assessment.created",null,"draft",{examiner_user_id:data.examiner_user_id,moderator_user_id:data.moderator_user_id,grading_policy_id:data.grading_policy_id});
      if(requestsPhysicalSitting){
        if(!this.examOperations) throw new BadRequestException("Examination operations are temporarily unavailable.");
        const sitting=await this.examOperations.createForAssessment(db,user,assessment,{space_id:data.space_id!,invigilator_user_ids:data.invigilator_user_ids});
        return {...assessment,sitting};
      }
      return assessment;
    });
  }

  async action(user: AuthUser, schoolId: string, assessmentId: string, action: string, body: unknown) {
    uuid.parse(assessmentId); const data=actionInput.parse(body);
    if(!["schedule","open-marking","submit","approve","return","publish","cancel"].includes(action)) throw new NotFoundException();
    const key=data.idempotency_key??activityOccurrenceId(schoolId,'assessment_action',`${user.id}:${assessmentId}:${action}`,String(data.expected_revision));
    const requestHash=createHash('sha256').update(JSON.stringify({assessmentId,action,...data,idempotency_key:key})).digest('hex');
    const refused:{error:HttpException|null}={error:null};
    const result=await this.db.transaction().execute(async(db)=>{
      if(action==='schedule'||action==='cancel'||action==='open-marking')await lockSchedule(db,schoolId);
      const current=await db.selectFrom("assessments").selectAll().where("id","=",assessmentId).where("school_id","=",schoolId).forUpdate().executeTakeFirst();
      if(!current) throw new NotFoundException("Assessment not found.");
      const adminActions=["schedule","open-marking","publish","cancel"];
      if(adminActions.includes(action)) await this.principal(user,schoolId,db);
      if(action==="submit") { await schoolPermission(db,user,schoolId,"assessments.mark",true); await this.assigned(user,schoolId,assessmentId,"examiner",db); }
      if(action==="submit") {
        const moderator=await db.selectFrom("assessment_staff_assignments").select("user_id").where("school_id","=",schoolId)
          .where("assessment_id","=",assessmentId).where("role","=","moderator").forShare().executeTakeFirst();
        if(moderator?.user_id===user.id)throw new ForbiddenException("The assigned moderator cannot submit their own result register for moderation.");
      }
      if(action==="approve"||action==="return") { await schoolPermission(db,user,schoolId,"assessments.moderate",true); await this.assigned(user,schoolId,assessmentId,"moderator",db); }
      if(action==="approve"||action==="return") {
        const assignments=await db.selectFrom("assessment_staff_assignments").select(["user_id","role"]).where("school_id","=",schoolId)
          .where("assessment_id","=",assessmentId).forShare().execute();
        if(assignments.find(item=>item.role==="examiner")?.user_id===user.id||current.submitted_by===user.id) throw new ForbiddenException("The examiner cannot moderate their own result register, including as an administrator.");
        if(assignments.find(item=>item.role==="moderator")?.user_id!==user.id)throw new ForbiddenException("Only the assigned independent moderator can approve or return this result register.");
      }
      const resultsLifecycle=["submit","approve","return","publish"].includes(action);
      // A retained domain receipt proves an earlier outcome, not current acting
      // identity. Recheck the selected world and current endpoint before replay.
      if(resultsLifecycle)await this.requireResultActor(db,user,schoolId);
      const durable=resultsLifecycle||['schedule','cancel'].includes(action)&&isPhysicalAssessment(current.assessment_kind);
      if(durable){
        const prior=(await sql<{request_hash:string;result:Record<string,unknown>}>`SELECT request_hash,result FROM day_plan_commands
          WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND command_key=${key}::uuid`.execute(db)).rows[0];
        if(prior){
          if(prior.request_hash!==requestHash)throw new ConflictException('This request key was already used for a different assessment action.');
          if('assessment_command_refusal' in prior.result){
            const failure=prior.result.assessment_command_refusal as {response:string|Record<string,unknown>;status_code:number};
            refused.error=new HttpException(failure.response,failure.status_code);return undefined;
          }
          return prior.result;
        }
      }
      if(current.revision!==data.expected_revision) throw new ConflictException("This assessment changed. Refresh before continuing.");
      const resultCommand=resultsLifecycle?await this.prepareResultsCommand(db,user,current,action,key,requestHash,
        action==="submit"?"assessments.mark":action==="publish"?"assessments.view":"assessments.moderate"):null;
      if(resultCommand)await sql`SAVEPOINT assessment_result_effects`.execute(db);
      try {
      const allowed:Record<string,string[]>={schedule:["draft"],"open-marking":["scheduled"],submit:["marking"],approve:["submitted"],return:["submitted"],publish:["moderated"],cancel:["draft","scheduled","marking"]};
      if(!allowed[action]!.includes(current.status)) throw new ConflictException(`This action is not available while the assessment is ${current.status}.`);
      let next=current.status as string;
      if(action==="schedule"){
        if(!current.scheduled_at) throw new BadRequestException("Add the assessment date before scheduling.");
        if(current.assessment_kind==="class_test") await this.validateClassTestSchedule(db,current,current.id);
        if(isPhysicalAssessment(current.assessment_kind)){
          if(!this.examOperations) throw new ConflictException("Physical examination operations are unavailable.");
          const scheduled=await this.examOperations.prepareForSchedule(db,user,current,{key,correlation_id:randomUUID()});
          if(scheduled.refused){
            refused.error=scheduled.refused;
            await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
              ${key}::uuid,${requestHash},${JSON.stringify({assessment_command_refusal:{response:scheduled.refused.getResponse(),status_code:scheduled.refused.getStatus()}})}::jsonb)`.execute(db);
            return undefined;
          }
        }
        next="scheduled";
      }
      if(action==="open-marking"){
        if(isPhysicalAssessment(current.assessment_kind)){
          if(!this.examOperations) throw new ConflictException("Physical examination operations are unavailable.");
          await this.examOperations.assertCompletedBeforeMarking(db,current.id);
        }
        const cycle=await db.selectFrom("assessment_cycles").select("term_id").where("id","=",current.cycle_id).executeTakeFirstOrThrow();
        if(isPhysicalAssessment(current.assessment_kind)){
          await sql`INSERT INTO assessment_results(school_id,assessment_id,student_id,academic_roster_source)
            SELECT candidate.school_id,candidate.assessment_id,candidate.student_id,jsonb_build_object('schema_version',1,'kind','physical_candidate',
              'enrollment_id',candidate.enrollment_id,'enrollment_revision',enrollment.revision,'roll_number',candidate.roll_number_snapshot,
              'as_of',(sitting.starts_at AT TIME ZONE school.timezone)::date::text,'candidate_id',candidate.id,'sitting_id',sitting.id)
            FROM assessment_sitting_candidates candidate
            JOIN assessment_sittings sitting ON sitting.id=candidate.sitting_id
              AND sitting.school_id=candidate.school_id AND sitting.assessment_id=candidate.assessment_id
            JOIN enrollments enrollment ON enrollment.id=candidate.enrollment_id AND enrollment.student_id=candidate.student_id
            JOIN schools school ON school.id=candidate.school_id
            WHERE candidate.school_id=${schoolId}::uuid AND candidate.assessment_id=${assessmentId}::uuid
              AND sitting.state='completed'
            ON CONFLICT(assessment_id,student_id) DO NOTHING`.execute(db);
        }else{
          const context=(await sql<{ as_of:string }>`SELECT (${current.scheduled_at}::timestamptz AT TIME ZONE timezone)::date::text AS as_of
            FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0];
          if(!context?.as_of) throw new ConflictException("This assessment has no recorded date. Add its date before opening marking.");
          const roster=await datedAcademicRoster(db,schoolId,current.class_section_id,cycle.term_id,context.as_of);
          if(roster.length) await db.insertInto("assessment_results").values(roster.map(learner=>({school_id:schoolId,assessment_id:assessmentId,
            student_id:learner.student_id,academic_roster_source:sql`${JSON.stringify(learner.academic_roster_source)}::jsonb`})))
            .onConflict(conflict=>conflict.columns(["assessment_id","student_id"]).doNothing()).execute();
        }
        const count=(await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_results WHERE assessment_id=${assessmentId}::uuid`.execute(db)).rows[0]!.count;
        if(!count) throw new BadRequestException("No learners belong to this assessment's dated roster."); next="marking";
      }
      if(action==="submit"){
        const incomplete=(await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_results WHERE assessment_id=${assessmentId}::uuid AND outcome='unrecorded'`.execute(db)).rows[0]!.count;
        if(incomplete) throw new BadRequestException(`${incomplete} learner results are still unrecorded.`);
        if(current.evidence_requirement==="required") await this.requireAvailableEvidence(db,user,schoolId,assessmentId);
        next="submitted";
      }
      if(action==="approve"){ if(data.note.length<3) throw new BadRequestException("Add a moderation note."); next="moderated"; }
      if(action==="return"){ if(data.note.length<3) throw new BadRequestException("Explain what the examiner must correct."); next="marking"; }
      if(action==="cancel"){ if(data.note.length<3) throw new BadRequestException("Add a cancellation reason."); next="cancelled"; }
      if(action==="publish"){
        if(data.note.length<3) throw new BadRequestException("Add a publication note.");
        const previousPublication=await db.selectFrom("assessment_publications").select("academic_context").where("assessment_id","=",assessmentId).orderBy("sequence","desc").executeTakeFirst();
        const term=await db.selectFrom("assessment_cycles").select("term_id").where("school_id","=",schoolId).where("id","=",current.cycle_id).executeTakeFirstOrThrow();
        const assessmentOn=(await sql<{ as_of:string }>`SELECT (${current.scheduled_at}::timestamptz AT TIME ZONE timezone)::date::text AS as_of
          FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0]?.as_of;
        const academicContext=retainedAcademicContext(previousPublication?.academic_context)
          ?? { ...await captureAcademicContext(db,schoolId,current.class_section_id,term.term_id),...(assessmentOn?{assessment_on:assessmentOn}:{}) };
        const publication=(await sql<{id:string;sequence:number}>`INSERT INTO assessment_publications(school_id,assessment_id,sequence,source_revision,reason,published_by,result_policy,academic_context)
          SELECT ${schoolId}::uuid,${assessmentId}::uuid,COALESCE(max(sequence),0)+1,${current.revision},${data.note},${user.id}::uuid,
            ${JSON.stringify(current.result_policy ?? null)}::jsonb,${JSON.stringify(academicContext)}::jsonb
          FROM assessment_publications WHERE assessment_id=${assessmentId}::uuid RETURNING id,sequence`.execute(db)).rows[0]!;
        const resultRows = await db.selectFrom("assessment_results").selectAll().where("school_id", "=", schoolId).where("assessment_id", "=", assessmentId).execute();
        const publishedRows = resultRows.map(row => {
          if (row.outcome === "unrecorded") throw new ConflictException("Record every result before publication.");
          const evaluated = assessmentGrading(current.result_policy, row.outcome === "scored" && row.marks !== null ? Number(row.marks) : null, Number(current.maximum_marks));
          return { school_id: schoolId, publication_id: publication.id, assessment_id: assessmentId, student_id: row.student_id,
            source_result_id: row.id, source_result_revision: row.revision, outcome: row.outcome, marks: row.marks,academic_roster_source:row.academic_roster_source,
            grade: evaluated ? evaluated.result?.grade ?? "" : row.grade, feedback: row.feedback,
            percentage: evaluated?.result ? String(evaluated.result.percentage) : null,
            grade_points: evaluated?.result?.grade_points != null ? String(evaluated.result.grade_points) : null };
        });
        if (publishedRows.length) await db.insertInto("assessment_publication_results").values(publishedRows).execute();
        const recipients=await sql<{user_id:string;student_id:string;scope:"dependent"|"self"}>`
          SELECT DISTINCT audience.user_id,audience.student_id,audience.scope FROM (
            SELECT student.user_id,student.id AS student_id,'self'::text AS scope
            FROM assessment_results result JOIN students student ON student.id=result.student_id
            WHERE result.assessment_id=${assessmentId}::uuid AND student.user_id IS NOT NULL
            UNION ALL
            SELECT parent.user_id,result.student_id,'dependent'::text AS scope
            FROM assessment_results result
            JOIN guardian_relationships relationship ON relationship.student_id=result.student_id AND relationship.school_id=${schoolId}::uuid
            JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE result.assessment_id=${assessmentId}::uuid AND parent.user_id IS NOT NULL
          ) audience
          JOIN users account ON account.id=audience.user_id AND account.is_active
          JOIN school_memberships membership ON membership.user_id=audience.user_id
            AND membership.school_id=${schoolId}::uuid AND membership.is_active
            AND membership.role=CASE audience.scope WHEN 'dependent' THEN 'guardian' ELSE 'student' END
        `.execute(db);
        for(const recipient of recipients.rows) await db.insertInto("notifications").values({
          recipient_id:recipient.user_id,
          kind:"general",
          title:"A result has been published",
          body:current.title,
          link: assessmentResultsHref(
            recipient.scope,
            recipient.student_id,
            [["assessment_id", assessmentId], ["publication_id", publication.id]],
          ),
          metadata:{assessment_id:assessmentId,publication_id:publication.id,student_id:recipient.student_id},
          dedupe_key:`assessment:${assessmentId}:publication:${publication.sequence}:${recipient.user_id}:${recipient.student_id}`,
          ...(recipient.scope === "dependent" ? {
            attention_eligible:true,
            attention_school_id:schoolId,
            attention_student_id:recipient.student_id,
            attention_class_section_id:current.class_section_id,
            attention_portal:"parent" as const,
            attention_module:"results" as const,
            attention_source_kind:"assessment_publication" as const,
            attention_source_id:publication.id,
            attention_source_revision:publication.sequence,
            attention_topic_key:`assessment:${assessmentId}:student:${recipient.student_id}`,
          } : {}),
        }).onConflict((conflict)=>conflict.doNothing()).execute();
        next="published";
      }
      const update:any={status:next,revision:current.revision+1,updated_by:user.id,updated_at:executionNow()};
      if(action==="submit"){update.submitted_by=user.id;update.submitted_at=executionNow();}
      if(action==="approve"){update.moderated_by=user.id;update.moderated_at=executionNow();update.moderation_note=data.note;}
      if(action==="return"){update.submitted_by=null;update.submitted_at=null;update.moderated_by=null;update.moderated_at=null;update.moderation_note=data.note;}
      if(action==="cancel"){update.cancelled_by=user.id;update.cancelled_at=executionNow();update.cancellation_reason=data.note;}
      if(action==="cancel"&&isPhysicalAssessment(current.assessment_kind)){
        if(!this.examOperations) throw new ConflictException("Physical examination operations are unavailable.");
        await this.examOperations.cancelForAssessment(db,user,schoolId,assessmentId,data.note,{key,correlation_id:randomUUID()});
      }
      const updated=await db.updateTable("assessments").set(update).where("id","=",assessmentId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,`assessment.${action}`,current.status,next,{note:data.note});
      const eventId=await this.emitUpdated(db,updated,action,["schedule","cancel","publish"].includes(action));
      if(resultCommand){
        await this.completeResultsCommand(db,schoolId,resultCommand,action,updated.revision,eventId);
        await sql`RELEASE SAVEPOINT assessment_result_effects`.execute(db);
      }
      if(durable)await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
        ${key}::uuid,${requestHash},${JSON.stringify(updated)}::jsonb)`.execute(db);
      return updated;
      } catch(error) {
        if(!resultCommand||!(error instanceof HttpException)||![400,403,409,422].includes(error.getStatus()))throw error;
        await sql`ROLLBACK TO SAVEPOINT assessment_result_effects`.execute(db);
        await this.completeResultsCommand(db,schoolId,resultCommand,action,null,null,error);
        await sql`RELEASE SAVEPOINT assessment_result_effects`.execute(db);
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
          ${key}::uuid,${requestHash},${JSON.stringify({assessment_command_refusal:{response:error.getResponse(),status_code:error.getStatus()}})}::jsonb)`.execute(db);
        refused.error=error;return undefined;
      }
    });
    if(refused.error)throw refused.error;
    return result!;
  }

  async recordResults(user: AuthUser, schoolId: string, assessmentId: string, body: unknown) {
    uuid.parse(schoolId);uuid.parse(assessmentId);
    const data=resultsInput.parse(body);
    if(user.active_school_id&&user.active_school_id!==schoolId)throw new ForbiddenException("Choose this institution before recording its results.");
    const requestHash=createHash("sha256").update(JSON.stringify({assessmentId,...data})).digest("hex");
    const key=activityOccurrenceId(schoolId,"assessment_results",`${user.id}:${assessmentId}`,`${data.expected_assessment_revision}:${requestHash}`);
    const refused:{error:HttpException|null}={error:null};
    const result=await this.db.transaction().execute(async(db)=>{
      await schoolPermission(db,user,schoolId,"assessments.mark",true); await this.assigned(user,schoolId,assessmentId,"examiner",db);
      const moderator=await db.selectFrom("assessment_staff_assignments").select("user_id").where("school_id","=",schoolId)
        .where("assessment_id","=",assessmentId).where("role","=","moderator").forShare().executeTakeFirst();
      if(moderator?.user_id===user.id)throw new ForbiddenException("The assigned moderator cannot record or correct this result register, including as an administrator.");
      const assessment=await db.selectFrom("assessments").selectAll().where("id","=",assessmentId).where("school_id","=",schoolId).forUpdate().executeTakeFirst();
      if(!assessment) throw new NotFoundException();
      await this.requireResultActor(db,user,schoolId);
      const previous=(await sql<{request_hash:string;result:typeof assessment&{assessment_command_refusal?:{response:string|Record<string,unknown>;status_code:number}}}>`SELECT request_hash,result FROM day_plan_commands
        WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND command_key=${key}::uuid`.execute(db)).rows[0];
      if(previous){
        if(previous.request_hash!==requestHash)throw new ConflictException("This result request key was already used for different work.");
        if(previous.result.assessment_command_refusal){const failure=previous.result.assessment_command_refusal;refused.error=new HttpException(failure.response,failure.status_code);return undefined;}
        return previous.result;
      }
      if(assessment.revision!==data.expected_assessment_revision) throw new ConflictException("This assessment changed. Refresh before saving marks.");
      const command=await this.prepareResultsCommand(db,user,assessment,"record",key,requestHash,"assessments.mark");
      await sql`SAVEPOINT assessment_result_effects`.execute(db);
      try {
      if(!["marking","published"].includes(assessment.status)) throw new ConflictException("Results can only be edited while marking or as a published correction.");
      for(const input of data.results){
        const result=await db.selectFrom("assessment_results").selectAll().where("id","=",input.result_id).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
        if(!result) throw new BadRequestException("A result row does not belong to this assessment."); if(result.revision!==input.expected_revision) throw new ConflictException("A learner result changed. Refresh before saving.");
        if(input.outcome==="scored" && (input.marks===null || input.marks>Number(assessment.maximum_marks))) throw new BadRequestException(`Marks must be between 0 and ${assessment.maximum_marks}.`);
        if(input.outcome!=="scored" && input.marks!==null) throw new BadRequestException("Only a scored result can have marks.");
        const evaluated = assessmentGrading(assessment.result_policy, input.outcome === "scored" ? input.marks : null, Number(assessment.maximum_marks));
        const grade = evaluated ? evaluated.result?.grade ?? "" : input.grade;
        const nextRevision=result.revision+1;
        await db.insertInto("assessment_result_revisions").values({school_id:schoolId,assessment_id:assessmentId,result_id:result.id,student_id:result.student_id,revision:nextRevision,previous_outcome:result.outcome,outcome:input.outcome,previous_marks:result.marks,marks:input.outcome==="scored"?String(input.marks):null,previous_grade:result.grade,grade,previous_feedback:result.feedback,feedback:input.feedback,reason:input.reason,changed_by:user.id}).execute();
        await db.updateTable("assessment_results").set({outcome:input.outcome,marks:input.outcome==="scored"?String(input.marks):null,grade,feedback:input.feedback,revision:nextRevision,recorded_by:user.id,recorded_at:executionNow(),updated_at:executionNow()}).where("id","=",result.id).execute();
      }
      const wasPublished=assessment.status==="published";
      const updated=await db.updateTable("assessments").set({status:"marking",revision:assessment.revision+1,updated_by:user.id,updated_at:executionNow(),submitted_by:null,submitted_at:null,moderated_by:null,moderated_at:null,moderation_note:wasPublished?"Correction requires moderation and republication.":assessment.moderation_note}).where("id","=",assessmentId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,wasPublished?"assessment.correction.started":"assessment.results.recorded",assessment.status,"marking",{rows:data.results.length});
      const eventId=await this.emitUpdated(db,updated,wasPublished?"correction-started":"results-recorded");
      await this.completeResultsCommand(db,schoolId,command,"record",updated.revision,eventId);
      await sql`RELEASE SAVEPOINT assessment_result_effects`.execute(db);
      await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
        ${key}::uuid,${requestHash},${JSON.stringify(updated)}::jsonb)`.execute(db);
      return updated;
      } catch(error) {
        if(!(error instanceof HttpException)||![400,403,409,422].includes(error.getStatus()))throw error;
        await sql`ROLLBACK TO SAVEPOINT assessment_result_effects`.execute(db);
        await this.completeResultsCommand(db,schoolId,command,"record",null,null,error);
        await sql`RELEASE SAVEPOINT assessment_result_effects`.execute(db);
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${schoolId}::uuid,${user.id}::uuid,
          ${key}::uuid,${requestHash},${JSON.stringify({assessment_command_refusal:{response:error.getResponse(),status_code:error.getStatus()}})}::jsonb)`.execute(db);
        refused.error=error;return undefined;
      }
    });
    if(refused.error)throw refused.error;
    return result!;
  }

  async addEvidence(user: AuthUser, schoolId: string, assessmentId: string, resultId: string, body: Record<string,unknown>, upload: AssessmentUpload) {
    uuid.parse(schoolId); uuid.parse(assessmentId); uuid.parse(resultId);
    if (user.active_school_id !== schoolId) throw new ForbiddenException("Choose this institution before adding evidence.");
    const reason = z.string().trim().min(3).max(500).parse(body.reason), metadata = assessmentEvidenceMetadata(upload);
    const requestHash = createHash("sha256").update(JSON.stringify({ assessmentId, resultId, reason, ...metadata })).digest("hex");
    const namespace = executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`;
    const key = activityOccurrenceId(schoolId,"assessment_evidence",`${namespace}:${user.id}:${assessmentId}:${resultId}`,requestHash);
    let attemptedArtifact = false;
    try {
      return await this.db.transaction().execute(async db => {
        // The same assessment lock serializes marking, uploads and submission.
        const current = await db.selectFrom("assessments").selectAll().where("school_id", "=", schoolId)
          .where("id", "=", assessmentId).forUpdate().executeTakeFirst();
        if (!current) throw new NotFoundException("Assessment not found.");
        await schoolPermission(db,user,schoolId,"assessments.mark",true);
        await this.assigned(user,schoolId,assessmentId,"examiner",db);
        await this.requireResultActor(db,user,schoolId);
        const prior = (await sql<{ request_hash: string; result: Record<string, unknown> }>`SELECT request_hash,result FROM day_plan_commands
          WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND command_key=${key}::uuid`.execute(db)).rows[0];
        if (prior) {
          if (prior.request_hash !== requestHash) throw new ConflictException("This evidence identity was used for different content.");
          return prior.result;
        }
        if (current.status !== "marking") throw new ConflictException("Evidence can only be added while marking. Reopen correction marking before adding a replacement.");
        const result = await db.selectFrom("assessment_results").select("student_id").where("school_id", "=", schoolId)
          .where("assessment_id", "=", assessmentId).where("id", "=", resultId).executeTakeFirst();
        if (!result) throw new NotFoundException("Learner result not found.");
        const command = await this.prepareResultsCommand(db,user,current,"evidence.add",key,requestHash,"assessments.mark");
        const artifact = { ...metadata, storage_key: key };
        attemptedArtifact = true;
        await putAssessmentEvidenceArtifact(schoolId,assessmentId,artifact,upload.data);
        const row = await db.insertInto("assessment_evidence").values({ id:key, school_id:schoolId, assessment_id:assessmentId,
          result_id:resultId, student_id:result.student_id, ...artifact, uploaded_by:user.id, uploaded_at:executionNow() }).returningAll().executeTakeFirstOrThrow();
        const updated = await db.updateTable("assessments").set({ revision:current.revision+1, updated_by:user.id, updated_at:executionNow() })
          .where("school_id", "=", schoolId).where("id", "=", assessmentId).returningAll().executeTakeFirstOrThrow();
        await this.audit(db,user,schoolId,assessmentId,"assessment.evidence.added",current.status,current.status,
          { result_id:resultId, evidence_id:row.id, reason, sha256:metadata.sha256, size_bytes:metadata.size_bytes });
        const eventId = await this.emitUpdated(db,updated,"evidence-added");
        await this.completeResultsCommand(db,schoolId,command,"evidence.add",updated.revision,eventId);
        const receipt = { ...row, assessment_revision:updated.revision };
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result)
          VALUES(${schoolId}::uuid,${user.id}::uuid,${key}::uuid,${requestHash},${JSON.stringify(receipt)}::jsonb)`.execute(db);
        return receipt;
      });
    } catch (cause) {
      // A lost commit response is uncertain, not a failed acceptance. Reacquire
      // the upload lock and retain bytes unless absence of metadata is proven.
      if (attemptedArtifact) await this.db.transaction().execute(async db => {
        await db.selectFrom("assessments").select("id").where("school_id", "=", schoolId).where("id", "=", assessmentId).forUpdate().executeTakeFirst();
        const accepted = await db.selectFrom("assessment_evidence").select("id").where("school_id", "=", schoolId)
          .where("assessment_id", "=", assessmentId).where("storage_key", "=", key).executeTakeFirst();
        if (!accepted) await removeUnacceptedAssessmentEvidenceArtifact(schoolId,assessmentId,key);
      }).catch(() => undefined);
      throw cause;
    }
  }

  async evidence(user: AuthUser, schoolId: string, assessmentId: string, evidenceId: string) {
    uuid.parse(evidenceId);
    if (!await this.canReadResults(user,schoolId,assessmentId)) throw new ForbiddenException("You cannot view this assessment's private results or evidence.");
    const record=await this.db.selectFrom("assessment_evidence").selectAll().where("id","=",evidenceId).where("assessment_id","=",assessmentId).where("school_id","=",schoolId).executeTakeFirst(); if(!record) throw new NotFoundException();
    const file=await readAssessmentEvidenceArtifact(schoolId,assessmentId,record);
    return {...file,record:{...record,content_type:file.content_type,original_name:file.original_name,size_bytes:file.size_bytes??record.size_bytes}};
  }

  async familyResults(user: AuthUser, schoolId: string, studentId: string) {
    uuid.parse(schoolId); uuid.parse(studentId);
    const allowed=(await sql<{ok:boolean}>`SELECT EXISTS(SELECT 1 FROM students student JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id AND membership.is_active AND membership.role='student' WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND student.user_id=${user.id}::uuid)
      OR EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=relationship.school_id AND membership.is_active AND membership.role='guardian' WHERE relationship.student_id=${studentId}::uuid AND relationship.school_id=${schoolId}::uuid AND parent.user_id=${user.id}::uuid) AS ok`.execute(this.db)).rows[0]?.ok;
    if(!allowed) throw new ForbiddenException("You cannot view this learner's results.");
    const student=(await sql`SELECT student.id,student.admission_number,person.first_name,person.last_name,'Class '||section.grade||section.section AS class_name FROM students student JOIN school_people person ON person.id=student.person_id LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active LEFT JOIN class_sections section ON section.id=enrollment.class_section_id WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid ORDER BY enrollment.enrolled_on DESC LIMIT 1`.execute(this.db)).rows[0];
    if(!student) throw new NotFoundException();
    const results=await sql`SELECT * FROM (SELECT DISTINCT ON(assessment.id) assessment.id,assessment.title,assessment.assessment_kind,assessment.maximum_marks,assessment.scheduled_at,subject.name AS subject_name,subject.color,subject.icon,cycle.name AS cycle_name,
      COALESCE(publication.academic_context->>'term_name',term.name) AS term_name,COALESCE(publication.academic_context->>'academic_year',term.academic_year) AS academic_year,
      COALESCE(publication.academic_context->>'class_name','Class '||section.grade||section.section) AS class_name,
      assessment.class_section_id,cycle.term_id,publication.academic_context,
      CASE WHEN publication.academic_context->>'schema_version'='1' THEN 'publication_snapshot' ELSE 'legacy_assessment_context' END AS academic_context_source,
      publication.id AS publication_id,publication.sequence,publication.published_at,publication.result_policy,published.outcome,published.marks,published.grade,published.percentage,published.grade_points,published.feedback,published.academic_roster_source
      FROM assessment_publication_results published JOIN assessment_publications publication ON publication.id=published.publication_id JOIN assessments assessment ON assessment.id=published.assessment_id JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id JOIN academic_terms term ON term.id=cycle.term_id JOIN subjects subject ON subject.id=assessment.subject_id JOIN class_sections section ON section.id=assessment.class_section_id AND section.school_id=assessment.school_id
      WHERE published.school_id=${schoolId}::uuid AND published.student_id=${studentId}::uuid ORDER BY assessment.id,publication.sequence DESC) latest ORDER BY latest.published_at DESC`.execute(this.db);
    return {student,results:results.rows};
  }
}
