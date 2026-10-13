import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { assertActiveSchoolStaffMember, hasScopedSchoolPermission, schoolPermission } from "../roles/authorization.js";
import { SchoolEventService } from "../school/school-event.service.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface AssessmentUpload { filename: string; mimetype: string; data: Buffer }
const uuid = z.string().uuid();
const date = z.iso.date();
const cycleInput = z.object({ term_id: uuid, name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(32).transform((v) => v.toUpperCase()), starts_on: date, ends_on: date, result_label: z.string().trim().min(2).max(80).default("Result") });
const assessmentInput = z.object({ cycle_id: uuid, class_section_id: uuid, subject_id: uuid, title: z.string().trim().min(2).max(160), assessment_kind: z.enum(["exam","class_test","quiz","assignment","practical","viva","project","other"]), maximum_marks: z.coerce.number().positive().max(100000), weight_percent: z.coerce.number().positive().max(100).nullable().default(null), scheduled_at: z.iso.datetime().nullable().default(null), duration_minutes: z.coerce.number().int().positive().max(1440).nullable().default(null), venue: z.string().trim().max(160).default(""), instructions: z.string().trim().max(2000).default(""), evidence_requirement: z.enum(["none","optional","required"]).default("optional"), examiner_user_id: uuid, moderator_user_id: uuid });
const resultInput = z.object({ result_id: uuid, outcome: z.enum(["scored","absent","exempt","withheld","not_evaluated"]), marks: z.coerce.number().min(0).nullable().default(null), grade: z.string().trim().max(24).default(""), feedback: z.string().trim().max(1000).default(""), expected_revision: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) });
const resultsInput = z.object({ expected_assessment_revision: z.coerce.number().int().positive(), results: z.array(resultInput).min(1).max(500) });
const actionInput = z.object({ expected_revision: z.coerce.number().int().positive(), note: z.string().trim().max(1000).default("") });
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
  if (["schedule", "cancel"].includes(input.action)) refresh.push("calendar");
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
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    const member = await db.selectFrom("school_memberships").select("role").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","=","admin").executeTakeFirst();
    if (!member) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async assigned(user: AuthUser, schoolId: string, assessmentId: string, role?: "examiner"|"moderator", db: Db = this.db) {
    uuid.parse(assessmentId);
    const admin = await db.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","=","admin").executeTakeFirst();
    if (admin) return { role: "admin" as const };
    let query = db.selectFrom("assessment_staff_assignments").select("role").where("school_id","=",schoolId).where("assessment_id","=",assessmentId).where("user_id","=",user.id);
    if (role) query = query.where("role", "=", role);
    const assignment = await query.executeTakeFirst();
    if (!assignment) throw new ForbiddenException(role ? `Only the assigned ${role} can do this.` : "This assessment is not assigned to you.");
    const action=role==="examiner" ? "assessments.mark" : role==="moderator" ? "assessments.moderate" : "assessments.view";
    if (!await hasScopedSchoolPermission(db,user.id,schoolId,action,"assessment",assessmentId)) throw new ForbiddenException("Your role does not allow this action on this assessment.");
    return assignment;
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
  }

  async workspace(user: AuthUser, schoolId: string) {
    const permission = await schoolPermission(this.db,user,schoolId,"assessments.view");
    const admin = permission.role === "admin";
    const cycles = await sql`SELECT cycle.*,term.name AS term_name,term.academic_year,
      count(assessment.id)::int AS assessment_count,
      count(assessment.id) FILTER(WHERE assessment.status='published')::int AS published_count
      FROM assessment_cycles cycle JOIN academic_terms term ON term.id=cycle.term_id
      LEFT JOIN assessments assessment ON assessment.cycle_id=cycle.id
      WHERE cycle.school_id=${schoolId}::uuid GROUP BY cycle.id,term.name,term.academic_year ORDER BY cycle.starts_on DESC`.execute(this.db);
    const assessments = await sql`SELECT assessment.*,cycle.name AS cycle_name,subject.name AS subject_name,subject.color,subject.icon,
      'Class '||section.grade||section.section AS class_name,
      examiner.user_id AS examiner_user_id,examiner_user.first_name||' '||examiner_user.last_name AS examiner_name,
      moderator.user_id AS moderator_user_id,moderator_user.first_name||' '||moderator_user.last_name AS moderator_name,
      count(result.id)::int AS roster_count,count(result.id) FILTER(WHERE result.outcome='unrecorded')::int AS unrecorded_count,
      COALESCE((SELECT max(sequence) FROM assessment_publications publication WHERE publication.assessment_id=assessment.id),0)::int AS publication_sequence
      FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
      JOIN class_sections section ON section.id=assessment.class_section_id JOIN subjects subject ON subject.id=assessment.subject_id
      LEFT JOIN assessment_staff_assignments examiner ON examiner.assessment_id=assessment.id AND examiner.role='examiner'
      LEFT JOIN users examiner_user ON examiner_user.id=examiner.user_id
      LEFT JOIN assessment_staff_assignments moderator ON moderator.assessment_id=assessment.id AND moderator.role='moderator'
      LEFT JOIN users moderator_user ON moderator_user.id=moderator.user_id
      LEFT JOIN assessment_results result ON result.assessment_id=assessment.id
      WHERE assessment.school_id=${schoolId}::uuid AND (${admin} OR EXISTS(SELECT 1 FROM assessment_staff_assignments mine WHERE mine.assessment_id=assessment.id AND mine.user_id=${user.id}::uuid))
      GROUP BY assessment.id,cycle.name,subject.name,subject.color,subject.icon,section.grade,section.section,examiner.user_id,examiner_user.first_name,examiner_user.last_name,moderator.user_id,moderator_user.first_name,moderator_user.last_name
      ORDER BY assessment.scheduled_at NULLS LAST,assessment.created_at DESC`.execute(this.db);
    if (!admin) {
      const classes = (await sql<{ id:string; name:string; academic_year:string }>`
        SELECT DISTINCT section.id,'Class '||section.grade||section.section AS name,section.academic_year
        FROM class_sections section
        JOIN staff_role_bindings binding ON binding.school_id=section.school_id
          AND binding.context_kind='class' AND binding.scope_id=section.id
        WHERE section.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid
          AND binding.status='active' AND binding.role_active
          AND 'assessments.mark'=ANY(binding.permissions)
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
          AND 'assessments.mark'=ANY(binding.permissions)
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
        SELECT DISTINCT account.id,account.first_name,account.last_name,profile.designation
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        LEFT JOIN staff_profiles profile ON profile.school_id=membership.school_id AND profile.user_id=membership.user_id
        WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
        ORDER BY account.first_name,account.last_name,account.id
      `.execute(this.db)).rows;
      return {
        mode: "staff", can_plan_class_test: Boolean(subjects.length && reviewers.length), planner_user_id: user.id,
        cycles: cycles.rows, assessments: assessments.rows,
        references: { classes, subjects, staff: reviewers },
      };
    }
    const terms = await sql`SELECT id,name,academic_year,starts_on,ends_on FROM academic_terms WHERE school_id=${schoolId}::uuid AND is_active ORDER BY starts_on DESC`.execute(this.db);
    const classes = await sql`SELECT id,'Class '||grade||section AS name,academic_year FROM class_sections WHERE school_id=${schoolId}::uuid ORDER BY academic_year DESC,grade,section`.execute(this.db);
    const subjects = await sql`SELECT id,name,color,icon FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(this.db);
    const staff = await sql`SELECT DISTINCT u.id,u.first_name,u.last_name,profile.designation FROM users u JOIN school_memberships membership ON membership.user_id=u.id LEFT JOIN staff_profiles profile ON profile.school_id=membership.school_id AND profile.user_id=u.id WHERE membership.school_id=${schoolId}::uuid AND membership.role IN ('staff','admin') AND membership.is_active AND u.is_active ORDER BY u.first_name,u.last_name`.execute(this.db);
    return { mode: "admin", cycles: cycles.rows, assessments: assessments.rows, references: { terms: terms.rows, classes: classes.rows, subjects: subjects.rows, staff: staff.rows } };
  }

  async calendar(user:AuthUser,schoolId:string,from:string,to:string,studentId?:string) {
    uuid.parse(schoolId);date.parse(from);date.parse(to);
    if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)throw new BadRequestException('Choose a calendar range of up to 93 days.');
    let admin=false;
    if(studentId) { uuid.parse(studentId);await this.familyResults(user,schoolId,studentId); }
    else { const access=await schoolPermission(this.db,user,schoolId,'assessments.view');admin=access.role==='admin'; }
    // Calendar projection intentionally excludes results, marks, private notes,
    // drafts and cancelled assessments. It does not cancel normal teaching.
    const items=await sql<{id:string;title:string;scheduled_at:string;date:string;venue:string;subject_name:string;class_name:string}>`
      SELECT a.id,a.title,a.scheduled_at,(a.scheduled_at AT TIME ZONE school.timezone)::date::text AS date,a.venue,s.name AS subject_name,'Class '||c.grade||c.section AS class_name
      FROM assessments a JOIN schools school ON school.id=a.school_id JOIN subjects s ON s.id=a.subject_id JOIN class_sections c ON c.id=a.class_section_id JOIN assessment_cycles cycle ON cycle.id=a.cycle_id
      WHERE a.school_id=${schoolId}::uuid AND a.status NOT IN ('draft','cancelled') AND (a.scheduled_at AT TIME ZONE school.timezone)::date BETWEEN ${from}::date AND ${to}::date
      AND (${admin} OR (${studentId??null}::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM enrollments e WHERE e.student_id=${studentId??null}::uuid AND e.class_section_id=a.class_section_id AND e.term_id=cycle.term_id AND e.is_active AND e.enrolled_on<=(a.scheduled_at AT TIME ZONE school.timezone)::date)) OR (${studentId??null}::uuid IS NULL AND staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,'assessments.view','assessment',a.id)))
      ORDER BY a.scheduled_at,a.title`.execute(this.db);
    return {items:items.rows};
  }

  async detail(user: AuthUser, schoolId: string, assessmentId: string) {
    await schoolPermission(this.db,user,schoolId,"assessments.view");
    const access = await this.assigned(user,schoolId,assessmentId);
    const assessment = (await sql`SELECT assessment.*,cycle.name AS cycle_name,cycle.term_id,subject.name AS subject_name,subject.color,subject.icon,'Class '||section.grade||section.section AS class_name,
      examiner.user_id AS examiner_user_id,examiner_user.first_name||' '||examiner_user.last_name AS examiner_name,
      moderator.user_id AS moderator_user_id,moderator_user.first_name||' '||moderator_user.last_name AS moderator_name
      FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id JOIN subjects subject ON subject.id=assessment.subject_id JOIN class_sections section ON section.id=assessment.class_section_id
      LEFT JOIN assessment_staff_assignments examiner ON examiner.assessment_id=assessment.id AND examiner.role='examiner' LEFT JOIN users examiner_user ON examiner_user.id=examiner.user_id
      LEFT JOIN assessment_staff_assignments moderator ON moderator.assessment_id=assessment.id AND moderator.role='moderator' LEFT JOIN users moderator_user ON moderator_user.id=moderator.user_id
      WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=${assessmentId}::uuid`.execute(this.db)).rows[0];
    if (!assessment) throw new NotFoundException("Assessment not found.");
    const results = await sql`SELECT result.*,person.first_name,person.last_name,student.admission_number,enrollment.roll_number,
      count(evidence.id)::int AS evidence_count,json_agg(json_build_object('id',evidence.id,'original_name',evidence.original_name,'content_type',evidence.content_type,'size_bytes',evidence.size_bytes,'uploaded_at',evidence.uploaded_at)) FILTER(WHERE evidence.id IS NOT NULL) AS evidence
      FROM assessment_results result JOIN students student ON student.id=result.student_id JOIN school_people person ON person.id=student.person_id
      LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.class_section_id=${(assessment as {class_section_id:string}).class_section_id}::uuid AND enrollment.term_id=${(assessment as {term_id:string}).term_id}::uuid
      LEFT JOIN assessment_evidence evidence ON evidence.result_id=result.id
      WHERE result.assessment_id=${assessmentId}::uuid GROUP BY result.id,person.first_name,person.last_name,student.admission_number,enrollment.roll_number ORDER BY enrollment.roll_number NULLS LAST,person.first_name,person.last_name`.execute(this.db);
    const publications = await sql`SELECT * FROM assessment_publications WHERE assessment_id=${assessmentId}::uuid ORDER BY sequence DESC`.execute(this.db);
    const canMark=await hasScopedSchoolPermission(this.db,user.id,schoolId,"assessments.mark","assessment",assessmentId);
    const canModerate=await hasScopedSchoolPermission(this.db,user.id,schoolId,"assessments.moderate","assessment",assessmentId);
    return { assessment, results: results.rows, publications: publications.rows, viewer_role: access.role === "admin" ? "admin" : access.role === "examiner" && canMark ? "examiner" : access.role === "moderator" && canModerate ? "moderator" : "viewer" };
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
    return this.db.transaction().execute(async(db)=>{
      const membership=await db.selectFrom("school_memberships").select("role").where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["admin","staff"]).executeTakeFirst();
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
            AND binding.status='active' AND binding.role_active AND 'assessments.mark'=ANY(binding.permissions)
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
      const cycle=await db.selectFrom("assessment_cycles").selectAll().where("id","=",data.cycle_id).where("school_id","=",schoolId).executeTakeFirst();
      if(!cycle) throw new BadRequestException("Choose an assessment cycle in this institution.");
      if(staffPlan&&data.scheduled_at){
        const scheduledDate=(await sql<{date:string}>`SELECT (${data.scheduled_at}::timestamptz AT TIME ZONE school.timezone)::date::text AS date FROM schools school WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0]?.date;
        if(!scheduledDate||scheduledDate<cycle.starts_on||scheduledDate>cycle.ends_on) throw new BadRequestException("Choose a date inside the selected assessment cycle.");
      }
      const classRow=await db.selectFrom("class_sections").select("id").where("id","=",data.class_section_id).where("school_id","=",schoolId).executeTakeFirst();
      const subject=await db.selectFrom("subjects").select("id").where("id","=",data.subject_id).where("school_id","=",schoolId).executeTakeFirst();
      if(!classRow||!subject) throw new BadRequestException("Choose a class and subject in this institution.");
      const memberCount=(await sql<{count:number}>`SELECT count(*)::int AS count FROM school_memberships WHERE school_id=${schoolId}::uuid AND user_id IN (${data.examiner_user_id}::uuid,${data.moderator_user_id}::uuid) AND role IN ('staff','admin') AND is_active`.execute(db)).rows[0]!.count;
      if(memberCount!==2) throw new BadRequestException("Examiner and moderator need active staff access.");
      await assertActiveSchoolStaffMember(db,data.examiner_user_id,schoolId,"internal_examiner");
      await assertActiveSchoolStaffMember(db,data.moderator_user_id,schoolId,"exam_in_charge");
      const assessment=await db.insertInto("assessments").values({school_id:schoolId,cycle_id:data.cycle_id,class_section_id:data.class_section_id,subject_id:data.subject_id,title:data.title,assessment_kind:data.assessment_kind,maximum_marks:String(data.maximum_marks),weight_percent:data.weight_percent===null?null:String(data.weight_percent),scheduled_at:data.scheduled_at?new Date(data.scheduled_at):null,duration_minutes:data.duration_minutes,venue:data.venue,instructions:data.instructions,evidence_requirement:data.evidence_requirement,created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("assessment_staff_assignments").values([{school_id:schoolId,assessment_id:assessment.id,user_id:data.examiner_user_id,role:"examiner",assigned_by:user.id},{school_id:schoolId,assessment_id:assessment.id,user_id:data.moderator_user_id,role:"moderator",assigned_by:user.id}]).execute();
      await this.audit(db,user,schoolId,assessment.id,"assessment.created",null,"draft",{examiner_user_id:data.examiner_user_id,moderator_user_id:data.moderator_user_id});
      return assessment;
    });
  }

  async action(user: AuthUser, schoolId: string, assessmentId: string, action: string, body: unknown) {
    uuid.parse(assessmentId); const data=actionInput.parse(body);
    if(!["schedule","open-marking","submit","approve","return","publish","cancel"].includes(action)) throw new NotFoundException();
    return this.db.transaction().execute(async(db)=>{
      const current=await db.selectFrom("assessments").selectAll().where("id","=",assessmentId).where("school_id","=",schoolId).forUpdate().executeTakeFirst();
      if(!current) throw new NotFoundException("Assessment not found.");
      if(current.revision!==data.expected_revision) throw new ConflictException("This assessment changed. Refresh before continuing.");
      const adminActions=["schedule","open-marking","publish","cancel"];
      if(adminActions.includes(action)) await this.principal(user,schoolId,db);
      if(action==="submit") { await schoolPermission(db,user,schoolId,"assessments.mark",true); await this.assigned(user,schoolId,assessmentId,"examiner",db); }
      if(action==="approve"||action==="return") { await schoolPermission(db,user,schoolId,"assessments.moderate",true); await this.assigned(user,schoolId,assessmentId,"moderator",db); }
      const allowed:Record<string,string[]>={schedule:["draft"],"open-marking":["scheduled"],submit:["marking"],approve:["submitted"],return:["submitted"],publish:["moderated"],cancel:["draft","scheduled","marking"]};
      if(!allowed[action]!.includes(current.status)) throw new ConflictException(`This action is not available while the assessment is ${current.status}.`);
      let next=current.status as string;
      if(action==="schedule"){ if(!current.scheduled_at) throw new BadRequestException("Add the assessment date before scheduling."); if(current.assessment_kind==="class_test")await this.validateClassTestSchedule(db,current,current.id); next="scheduled"; }
      if(action==="open-marking"){
        const cycle=await db.selectFrom("assessment_cycles").select("term_id").where("id","=",current.cycle_id).executeTakeFirstOrThrow();
        await sql`INSERT INTO assessment_results(school_id,assessment_id,student_id)
          SELECT ${schoolId}::uuid,${assessmentId}::uuid,enrollment.student_id FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
          WHERE enrollment.class_section_id=${current.class_section_id}::uuid AND enrollment.term_id=${cycle.term_id}::uuid AND enrollment.is_active AND student.school_id=${schoolId}::uuid
          ON CONFLICT(assessment_id,student_id) DO NOTHING`.execute(db);
        const count=(await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_results WHERE assessment_id=${assessmentId}::uuid`.execute(db)).rows[0]!.count;
        if(!count) throw new BadRequestException("The class has no active learners in this term."); next="marking";
      }
      if(action==="submit"){
        const incomplete=(await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_results WHERE assessment_id=${assessmentId}::uuid AND outcome='unrecorded'`.execute(db)).rows[0]!.count;
        if(incomplete) throw new BadRequestException(`${incomplete} learner results are still unrecorded.`);
        if(current.evidence_requirement==="required") { const missing=(await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_results result WHERE result.assessment_id=${assessmentId}::uuid AND NOT EXISTS(SELECT 1 FROM assessment_evidence evidence WHERE evidence.result_id=result.id)`.execute(db)).rows[0]!.count; if(missing) throw new BadRequestException(`${missing} learner results still need evidence.`); }
        next="submitted";
      }
      if(action==="approve"){ if(data.note.length<3) throw new BadRequestException("Add a moderation note."); next="moderated"; }
      if(action==="return"){ if(data.note.length<3) throw new BadRequestException("Explain what the examiner must correct."); next="marking"; }
      if(action==="cancel"){ if(data.note.length<3) throw new BadRequestException("Add a cancellation reason."); next="cancelled"; }
      if(action==="publish"){
        if(data.note.length<3) throw new BadRequestException("Add a publication note.");
        const publication=(await sql<{id:string;sequence:number}>`INSERT INTO assessment_publications(school_id,assessment_id,sequence,source_revision,reason,published_by)
          SELECT ${schoolId}::uuid,${assessmentId}::uuid,COALESCE(max(sequence),0)+1,${current.revision},${data.note},${user.id}::uuid FROM assessment_publications WHERE assessment_id=${assessmentId}::uuid RETURNING id,sequence`.execute(db)).rows[0]!;
        await sql`INSERT INTO assessment_publication_results(school_id,publication_id,assessment_id,student_id,source_result_id,source_result_revision,outcome,marks,grade,feedback)
          SELECT school_id,${publication.id}::uuid,assessment_id,student_id,id,revision,outcome,marks,grade,feedback FROM assessment_results WHERE assessment_id=${assessmentId}::uuid`.execute(db);
        const recipients=await sql<{user_id:string;student_id:string;link:string;portal:"parent"|"student"}>`
          SELECT DISTINCT audience.user_id,audience.student_id,audience.link,audience.portal FROM (
            SELECT student.user_id,student.id AS student_id,'/student/results'::text AS link,'student'::text AS portal
            FROM assessment_results result JOIN students student ON student.id=result.student_id
            WHERE result.assessment_id=${assessmentId}::uuid AND student.user_id IS NOT NULL
            UNION ALL
            SELECT parent.user_id,result.student_id,'/parent/results'::text AS link,'parent'::text AS portal
            FROM assessment_results result
            JOIN guardian_relationships relationship ON relationship.student_id=result.student_id AND relationship.school_id=${schoolId}::uuid
            JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE result.assessment_id=${assessmentId}::uuid AND parent.user_id IS NOT NULL
          ) audience
          JOIN users account ON account.id=audience.user_id AND account.is_active
          JOIN school_memberships membership ON membership.user_id=audience.user_id
            AND membership.school_id=${schoolId}::uuid AND membership.is_active
            AND membership.role=CASE audience.portal WHEN 'parent' THEN 'guardian' ELSE 'student' END
        `.execute(db);
        for(const recipient of recipients.rows) await db.insertInto("notifications").values({
          recipient_id:recipient.user_id,
          kind:"general",
          title:"A result has been published",
          body:current.title,
          link:recipient.portal === "parent"
            ? `/parent/results?student_id=${recipient.student_id}&assessment_id=${assessmentId}&publication_id=${publication.id}`
            : recipient.link,
          metadata:{assessment_id:assessmentId,publication_id:publication.id,student_id:recipient.student_id},
          dedupe_key:`assessment:${assessmentId}:publication:${publication.sequence}:${recipient.user_id}:${recipient.student_id}`,
          ...(recipient.portal === "parent" ? {
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
      const update:any={status:next,revision:current.revision+1,updated_by:user.id,updated_at:new Date()};
      if(action==="submit"){update.submitted_by=user.id;update.submitted_at=new Date();}
      if(action==="approve"){update.moderated_by=user.id;update.moderated_at=new Date();update.moderation_note=data.note;}
      if(action==="return"){update.submitted_by=null;update.submitted_at=null;update.moderated_by=null;update.moderated_at=null;update.moderation_note=data.note;}
      if(action==="cancel"){update.cancelled_by=user.id;update.cancelled_at=new Date();update.cancellation_reason=data.note;}
      const updated=await db.updateTable("assessments").set(update).where("id","=",assessmentId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,`assessment.${action}`,current.status,next,{note:data.note});
      await this.emitUpdated(db,updated,action,action==="publish");
      return updated;
    });
  }

  async recordResults(user: AuthUser, schoolId: string, assessmentId: string, body: unknown) {
    const data=resultsInput.parse(body); await schoolPermission(this.db,user,schoolId,"assessments.mark"); await this.assigned(user,schoolId,assessmentId,"examiner");
    return this.db.transaction().execute(async(db)=>{
      const assessment=await db.selectFrom("assessments").selectAll().where("id","=",assessmentId).where("school_id","=",schoolId).forUpdate().executeTakeFirst();
      if(!assessment) throw new NotFoundException(); if(!["marking","published"].includes(assessment.status)) throw new ConflictException("Results can only be edited while marking or as a published correction.");
      if(assessment.revision!==data.expected_assessment_revision) throw new ConflictException("This assessment changed. Refresh before saving marks.");
      for(const input of data.results){
        const result=await db.selectFrom("assessment_results").selectAll().where("id","=",input.result_id).where("assessment_id","=",assessmentId).forUpdate().executeTakeFirst();
        if(!result) throw new BadRequestException("A result row does not belong to this assessment."); if(result.revision!==input.expected_revision) throw new ConflictException("A learner result changed. Refresh before saving.");
        if(input.outcome==="scored" && (input.marks===null || input.marks>Number(assessment.maximum_marks))) throw new BadRequestException(`Marks must be between 0 and ${assessment.maximum_marks}.`);
        if(input.outcome!=="scored" && input.marks!==null) throw new BadRequestException("Only a scored result can have marks.");
        const nextRevision=result.revision+1;
        await db.insertInto("assessment_result_revisions").values({school_id:schoolId,assessment_id:assessmentId,result_id:result.id,student_id:result.student_id,revision:nextRevision,previous_outcome:result.outcome,outcome:input.outcome,previous_marks:result.marks,marks:input.outcome==="scored"?String(input.marks):null,previous_grade:result.grade,grade:input.grade,previous_feedback:result.feedback,feedback:input.feedback,reason:input.reason,changed_by:user.id}).execute();
        await db.updateTable("assessment_results").set({outcome:input.outcome,marks:input.outcome==="scored"?String(input.marks):null,grade:input.grade,feedback:input.feedback,revision:nextRevision,recorded_by:user.id,recorded_at:new Date(),updated_at:new Date()}).where("id","=",result.id).execute();
      }
      const wasPublished=assessment.status==="published";
      const updated=await db.updateTable("assessments").set({status:"marking",revision:assessment.revision+1,updated_by:user.id,updated_at:new Date(),submitted_by:null,submitted_at:null,moderated_by:null,moderated_at:null,moderation_note:wasPublished?"Correction requires moderation and republication.":assessment.moderation_note}).where("id","=",assessmentId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db,user,schoolId,assessmentId,wasPublished?"assessment.correction.started":"assessment.results.recorded",assessment.status,"marking",{rows:data.results.length});
      await this.emitUpdated(db,updated,wasPublished?"correction-started":"results-recorded");
      return updated;
    });
  }

  async addEvidence(user: AuthUser, schoolId: string, assessmentId: string, resultId: string, body: Record<string,unknown>, upload: AssessmentUpload) {
    await schoolPermission(this.db,user,schoolId,"assessments.mark"); await this.assigned(user,schoolId,assessmentId,"examiner"); uuid.parse(resultId);
    if(!["application/pdf","image/jpeg","image/png"].includes(upload.mimetype)||!upload.data.length||upload.data.length>10*1024*1024) throw new BadRequestException("Evidence must be a PDF, JPEG or PNG up to 10 MB.");
    const reason=z.string().trim().min(3).max(500).parse(body.reason);
    const result=await this.db.selectFrom("assessment_results").selectAll().where("id","=",resultId).where("assessment_id","=",assessmentId).where("school_id","=",schoolId).executeTakeFirst(); if(!result) throw new NotFoundException();
    const directory=join(config().uploadDir,"assessments",schoolId,assessmentId); await mkdir(directory,{recursive:true,mode:0o750});
    const extension=[".pdf",".jpg",".jpeg",".png"].includes(extname(upload.filename).toLowerCase())?extname(upload.filename).toLowerCase():""; const key=`${randomUUID()}${extension}`; const pending=join(directory,`.${key}.pending`); const final=join(directory,key); await writeFile(pending,upload.data,{flag:"wx",mode:0o640});
    try { const record=await this.db.transaction().execute(async(db)=>{ const row=await db.insertInto("assessment_evidence").values({school_id:schoolId,assessment_id:assessmentId,result_id:resultId,student_id:result.student_id,storage_key:key,original_name:basename(upload.filename).slice(0,255),content_type:upload.mimetype,size_bytes:upload.data.length,uploaded_by:user.id}).returningAll().executeTakeFirstOrThrow(); await this.audit(db,user,schoolId,assessmentId,"assessment.evidence.added",null,null,{result_id:resultId,evidence_id:row.id,reason}); return row; }); await rename(pending,final); return record; } catch(error){ await unlink(pending).catch(()=>undefined); throw error; }
  }

  async evidence(user: AuthUser, schoolId: string, assessmentId: string, evidenceId: string) {
    await schoolPermission(this.db,user,schoolId,"assessments.view"); await this.assigned(user,schoolId,assessmentId); uuid.parse(evidenceId);
    const record=await this.db.selectFrom("assessment_evidence").selectAll().where("id","=",evidenceId).where("assessment_id","=",assessmentId).where("school_id","=",schoolId).executeTakeFirst(); if(!record) throw new NotFoundException();
    return {record,stream:createReadStream(join(config().uploadDir,"assessments",schoolId,assessmentId,record.storage_key))};
  }

  async familyResults(user: AuthUser, schoolId: string, studentId: string) {
    uuid.parse(schoolId); uuid.parse(studentId);
    const allowed=(await sql<{ok:boolean}>`SELECT EXISTS(SELECT 1 FROM students student JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id AND membership.is_active AND membership.role='student' WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND student.user_id=${user.id}::uuid)
      OR EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=relationship.school_id AND membership.is_active AND membership.role='guardian' WHERE relationship.student_id=${studentId}::uuid AND relationship.school_id=${schoolId}::uuid AND parent.user_id=${user.id}::uuid) AS ok`.execute(this.db)).rows[0]?.ok;
    if(!allowed) throw new ForbiddenException("You cannot view this learner's results.");
    const student=(await sql`SELECT student.id,student.admission_number,person.first_name,person.last_name,'Class '||section.grade||section.section AS class_name FROM students student JOIN school_people person ON person.id=student.person_id LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active LEFT JOIN class_sections section ON section.id=enrollment.class_section_id WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid ORDER BY enrollment.enrolled_on DESC LIMIT 1`.execute(this.db)).rows[0];
    if(!student) throw new NotFoundException();
    const results=await sql`SELECT * FROM (SELECT DISTINCT ON(assessment.id) assessment.id,assessment.title,assessment.assessment_kind,assessment.maximum_marks,assessment.scheduled_at,subject.name AS subject_name,subject.color,subject.icon,cycle.name AS cycle_name,term.name AS term_name,term.academic_year,publication.id AS publication_id,publication.sequence,publication.published_at,published.outcome,published.marks,published.grade,published.feedback
      FROM assessment_publication_results published JOIN assessment_publications publication ON publication.id=published.publication_id JOIN assessments assessment ON assessment.id=published.assessment_id JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id JOIN academic_terms term ON term.id=cycle.term_id JOIN subjects subject ON subject.id=assessment.subject_id
      WHERE published.school_id=${schoolId}::uuid AND published.student_id=${studentId}::uuid ORDER BY assessment.id,publication.sequence DESC) latest ORDER BY latest.published_at DESC`.execute(this.db);
    return {student,results:results.rows};
  }
}
