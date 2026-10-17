import { schoolPermission } from "../roles/authorization.js";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser, AuthenticatedRequest } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";

type Db = Kysely<Database> | Transaction<Database>;
const name = z.string().trim().min(1).max(150);
const guardianSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), id: z.string().uuid() }).strict(),
  z.object({ mode: z.literal("new"), first_name: name, last_name: z.string().trim().max(150),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/, "Enter a contact phone number."),
    email: z.union([z.email(), z.literal("")]).default("") }).strict(),
]);
const intakeSchema = z.object({ school_id: z.string().uuid(), first_name: name,
  last_name: z.string().trim().max(150), admission_number: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9/-]+$/).transform((v) => v.toUpperCase()),
  date_of_birth: z.iso.date(), class_section_id: z.string().uuid(), term_id: z.string().uuid(),
  roll_number: z.number().int().min(1).max(32767), enrolled_on: z.iso.date(), guardian: guardianSchema,
  relationship: z.enum(["mother", "father", "guardian"]), can_authorize_leave: z.boolean(),
}).strict();
type Intake = z.infer<typeof intakeSchema>;
type Draft = { id: string; school_id: string; created_by: string; input: Intake; expires_at: Date; committed_student_id: string | null };
const lifecycleCommon = z.object({
  school_id:z.string().uuid(), student_id:z.string().uuid(), expected_enrollment_id:z.string().uuid(),
  expected_revision:z.number().int().positive(), effective_on:z.iso.date(), reason:z.string().trim().min(3).max(500),
});
const lifecycleSchema = z.discriminatedUnion("action", [
  lifecycleCommon.extend({action:z.literal("move_class"),target_class_section_id:z.string().uuid(),target_term_id:z.string().uuid(),roll_number:z.number().int().min(1).max(32767)}).strict(),
  lifecycleCommon.extend({action:z.literal("withdraw")}).strict(),
  lifecycleCommon.extend({action:z.literal("transfer_out")}).strict(),
]);
type LifecycleInput = z.infer<typeof lifecycleSchema>;
type LifecycleDraft = {id:string;school_id:string;student_id:string;created_by:string;expected_enrollment_id:string;expected_revision:number;action:LifecycleInput["action"];input:LifecycleInput;impact:unknown;expires_at:Date;committed_at:Date|null;result_enrollment_id:string|null};

@Injectable()
export class PeopleService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  private async authorize(db: Db, user: AuthUser, schoolId: string, lock = false) {
    z.string().uuid().parse(schoolId);
    await schoolPermission(db,user,schoolId,"sis.manage",lock);
  }

  async options(user: AuthUser, schoolId: string) {
    await this.authorize(this.db, user, schoolId);
    const results = (await sql`SELECT c.id AS class_section_id,t.id AS term_id,concat('Class ',c.grade,c.section) AS class_name,
      t.name AS term_name,t.starts_on::text,t.ends_on::text,(now() AT TIME ZONE sc.timezone)::date::text AS today,
      COALESCE((SELECT max(e.roll_number)+1 FROM enrollments e WHERE e.class_section_id=c.id AND e.term_id=t.id),1)::int AS next_roll
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      JOIN schools sc ON sc.id=c.school_id WHERE c.school_id=${schoolId}::uuid AND t.is_active
      ORDER BY c.grade,c.section,t.starts_on`.execute(this.db)).rows;
    return { results };
  }

  async guardians(user: AuthUser, query: Record<string,string>) {
    const input = z.object({ school_id:z.string().uuid(), search:z.string().trim().min(2).max(80) }).parse(query);
    await this.authorize(this.db,user,input.school_id);
    const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
    return { results: (await sql`SELECT gp.guardian_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,p.contact_phone AS phone,
      (SELECT string_agg(s.admission_number,', ' ORDER BY s.admission_number) FROM guardian_relationships g JOIN students s ON s.id=g.student_id
        WHERE g.guardian_id=gp.guardian_id AND s.school_id=gp.school_id) AS linked_admissions
      FROM guardian_school_profiles gp JOIN school_people p ON p.id=gp.person_id
      WHERE gp.school_id=${input.school_id}::uuid AND (concat_ws(' ',p.first_name,p.last_name) ILIKE ${pattern}
        OR p.contact_phone ILIKE ${pattern} OR EXISTS(SELECT 1 FROM guardian_relationships g JOIN students s ON s.id=g.student_id
          WHERE g.guardian_id=gp.guardian_id AND s.school_id=gp.school_id AND s.admission_number ILIKE ${pattern}))
      ORDER BY p.first_name,p.last_name,gp.guardian_id LIMIT 25`.execute(this.db)).rows };
  }

  async list(user: AuthUser, query: Record<string,string>) {
    const input = z.object({school_id:z.string().uuid(),search:z.string().trim().max(80).default(""),initial:z.string().trim().toUpperCase().regex(/^[A-Z]$/).optional(),cursor:z.string().uuid().optional()}).parse(query);
    await this.authorize(this.db,user,input.school_id);
    const pattern=`%${input.search.replace(/[\\%_]/g,"\\$&")}%`;
    const rows = (await sql<{id:string;name:string}>`SELECT s.id,s.admission_number,s.avatar_url,concat_ws(' ',p.first_name,p.last_name) AS name,
      s.date_of_birth::text,(s.user_id IS NOT NULL) AS has_account,
      enrollment.id AS enrollment_id,enrollment.class_section_id,enrollment.term_id,enrollment.term_name,enrollment.class_name,
      enrollment.roll_number,enrollment.enrolled_on,enrollment.revision AS enrollment_revision,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',concat_ws(' ',person.first_name,person.last_name),'relationship',g.relationship,
        'phone',person.contact_phone,'avatar_url',person.avatar_url,'has_account',guardian.user_id IS NOT NULL) ORDER BY g.is_primary DESC)
        FROM guardian_relationships g JOIN parents guardian ON guardian.id=g.guardian_id
        JOIN guardian_school_profiles gp ON gp.guardian_id=g.guardian_id AND gp.school_id=s.school_id
        JOIN school_people person ON person.id=gp.person_id WHERE g.student_id=s.id),'[]'::jsonb) AS guardians
      FROM students s JOIN school_people p ON p.id=s.person_id
      LEFT JOIN LATERAL (SELECT e.id,e.class_section_id,e.term_id,t.name AS term_name,concat('Class ',c.grade,c.section) AS class_name,e.roll_number,e.enrolled_on::text,e.revision
        FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
        WHERE e.student_id=s.id AND e.is_active ORDER BY t.starts_on DESC LIMIT 1) enrollment ON true
      WHERE s.school_id=${input.school_id}::uuid AND (${input.initial??null}::text IS NULL OR upper(left(p.first_name,1))=${input.initial??null})
        AND (${input.cursor??null}::uuid IS NULL OR (lower(p.first_name),lower(coalesce(p.last_name,'')),s.id)>
        (SELECT lower(cursor_person.first_name),lower(coalesce(cursor_person.last_name,'')),cursor.id FROM students cursor
          JOIN school_people cursor_person ON cursor_person.id=cursor.person_id
          WHERE cursor.id=${input.cursor??null}::uuid AND cursor.school_id=${input.school_id}::uuid))
        AND (s.admission_number ILIKE ${pattern} OR concat_ws(' ',p.first_name,p.last_name) ILIKE ${pattern})
      ORDER BY lower(p.first_name),lower(coalesce(p.last_name,'')),s.id LIMIT 26`.execute(this.db)).rows;
    return {results:rows.slice(0,25),next_cursor:rows.length>25?rows[24]!.id:null};
  }

  async lifecycle(user:AuthUser, studentIdValue:string, schoolIdValue:string) {
    const studentId=z.string().uuid().parse(studentIdValue);const schoolId=z.string().uuid().parse(schoolIdValue);
    await this.authorize(this.db,user,schoolId);
    const student=(await sql<{id:string;today:string}>`SELECT s.id,(now() AT TIME ZONE school.timezone)::date::text AS today
      FROM students s JOIN schools school ON school.id=s.school_id
      WHERE s.id=${studentId}::uuid AND s.school_id=${schoolId}::uuid`.execute(this.db)).rows[0];
    if(!student) throw new NotFoundException("Student not found in this institution.");
    const history=(await sql`SELECT e.id,e.class_section_id,e.term_id,e.roll_number,e.enrolled_on::text,e.is_active,
      e.inactive_from::text,e.exit_kind,e.exit_reason,e.revision,concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name,
      concat_ws(' ',actor.first_name,actor.last_name) AS ended_by_name,e.ended_at
      FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
      LEFT JOIN users actor ON actor.id=e.ended_by WHERE e.student_id=${studentId}::uuid
      ORDER BY e.is_active DESC,e.enrolled_on DESC,e.id DESC`.execute(this.db)).rows;
    return {today:student.today,current:history.find((item:any)=>item.is_active)??null,history};
  }

  private async validateLifecycle(db:Db,input:LifecycleInput,lock=false) {
    const current=(await sql<{id:string;student_id:string;class_section_id:string;term_id:string;roll_number:number;revision:number;today:string;class_name:string;term_name:string;starts_on:string;ends_on:string}>`
      SELECT e.id,e.student_id,e.class_section_id,e.term_id,e.roll_number,e.revision,
        (now() AT TIME ZONE school.timezone)::date::text AS today,concat('Class ',c.grade,c.section) AS class_name,
        t.name AS term_name,t.starts_on::text,t.ends_on::text
      FROM enrollments e JOIN students s ON s.id=e.student_id JOIN schools school ON school.id=s.school_id
      JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
      WHERE e.id=${input.expected_enrollment_id}::uuid AND e.student_id=${input.student_id}::uuid
        AND s.school_id=${input.school_id}::uuid AND e.is_active ${lock?sql`FOR UPDATE OF e`:sql``}`.execute(db)).rows[0];
    if(!current) throw new ConflictException("This student's current enrollment changed. Reload the profile and review again.");
    if(current.revision!==input.expected_revision) throw new ConflictException("This student's enrollment changed. Reload the profile and review again.");
    if(input.effective_on!==current.today) throw new BadRequestException("This first connected-student release applies changes today. Use class promotion for a future term.");
    let target:null|{class_section_id:string;term_id:string;class_name:string;term_name:string}=null;
    if(input.action==='move_class') {
      if(input.target_term_id!==current.term_id) throw new BadRequestException("Use class promotion for a different term. Class movement here keeps the current term.");
      if(input.target_class_section_id===current.class_section_id) throw new BadRequestException("Choose a different class.");
      target=(await sql<{class_section_id:string;term_id:string;class_name:string;term_name:string}>`SELECT c.id AS class_section_id,t.id AS term_id,
        concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name FROM class_sections c
        JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
        WHERE c.id=${input.target_class_section_id}::uuid AND t.id=${input.target_term_id}::uuid
          AND c.school_id=${input.school_id}::uuid AND ${input.effective_on}::date BETWEEN t.starts_on AND t.ends_on
        ${lock?sql`FOR SHARE OF c,t`:sql``}`.execute(db)).rows[0]??null;
      if(!target) throw new BadRequestException("Choose another class in the student's current term.");
      const occupied=(await sql`SELECT id FROM enrollments WHERE class_section_id=${input.target_class_section_id}::uuid
        AND term_id=${input.target_term_id}::uuid AND roll_number=${input.roll_number} AND is_active
        ${lock?sql`FOR UPDATE`:sql``}`.execute(db)).rows[0];
      if(occupied) throw new ConflictException("That roll number is already assigned in the destination class.");
    }
    const classIds=input.action==='move_class'?[current.class_section_id,input.target_class_section_id]:[current.class_section_id];
    const registers=(await sql<{state:string}>`SELECT state FROM attendance_registers WHERE class_section_id=ANY(${classIds}::uuid[])
      AND term_id=${current.term_id}::uuid AND date>=${input.effective_on}::date ${lock?sql`FOR UPDATE`:sql``}`.execute(db)).rows;
    const locked=registers.filter(item=>item.state==='locked').length;
    if(locked) throw new ConflictException(`${locked} affected attendance register(s) are final. Reopen them before changing this enrollment.`);
    const impact=(await sql<{assessments:string;transport_assignments:string;departure_plans:string}>`SELECT
      (SELECT count(*)::text FROM assessments a JOIN assessment_cycles cycle ON cycle.id=a.cycle_id
        WHERE a.class_section_id=${current.class_section_id}::uuid AND cycle.term_id=${current.term_id}::uuid
          AND a.status NOT IN ('cancelled','published') AND (a.scheduled_at IS NULL OR a.scheduled_at::date>=${input.effective_on}::date)) AS assessments,
      (SELECT count(*)::text FROM transport_student_assignments WHERE school_id=${input.school_id}::uuid AND student_id=${input.student_id}::uuid AND status='active') AS transport_assignments,
      (SELECT count(*)::text FROM departure_plans WHERE school_id=${input.school_id}::uuid AND student_id=${input.student_id}::uuid
        AND service_date>=${input.effective_on}::date AND is_current AND state NOT IN ('completed','cancelled')) AS departure_plans`.execute(db)).rows[0]!;
    return {current,target,impact:{attendance_registers:registers.length,submitted_registers:registers.filter(item=>item.state==='submitted').length,
      assessments:Number(impact.assessments),transport_assignments:Number(impact.transport_assignments),departure_plans:Number(impact.departure_plans)}};
  }

  async previewLifecycle(req:AuthenticatedRequest,studentIdValue:string,body:unknown) {
    const input=lifecycleSchema.parse({...body as Record<string,unknown>,student_id:studentIdValue});
    await this.authorize(this.db,req.authUser,input.school_id);
    const review=await this.validateLifecycle(this.db,input);
    const draft=await this.db.insertInto("student_enrollment_change_reviews").values({school_id:input.school_id,student_id:input.student_id,created_by:req.authUser.id,
      expected_enrollment_id:input.expected_enrollment_id,expected_revision:input.expected_revision,action:input.action,input,impact:review.impact,result_enrollment_id:null}).returning(["id","expires_at"]).executeTakeFirstOrThrow();
    return {...draft,input,current:review.current,target:review.target,impact:review.impact};
  }

  async commitLifecycle(req:AuthenticatedRequest,idValue:string) {
    const id=z.string().uuid().parse(idValue);
    return this.db.transaction().execute(async db=>{
      const draft=(await sql<LifecycleDraft>`SELECT * FROM student_enrollment_change_reviews WHERE id=${id}::uuid AND created_by=${req.authUser.id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if(!draft) throw new NotFoundException("Enrollment change review not found.");
      await this.authorize(db,req.authUser,draft.school_id,true);
      if(draft.committed_at) return {student_id:draft.student_id,enrollment_id:draft.result_enrollment_id,action:draft.action};
      if(new Date(draft.expires_at).getTime()<Date.now()) throw new ConflictException("This review expired. Review the impact again before saving.");
      const input=lifecycleSchema.parse(draft.input);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`student-enrollment:${input.student_id}`},0))`.execute(db);
      const checked=await this.validateLifecycle(db,input,true);
      const exitKind=input.action==='move_class'?'class_move':input.action==='withdraw'?'withdrawn':'transferred_out';
      await sql`UPDATE enrollments SET is_active=false,inactive_from=${input.effective_on}::date,exit_kind=${exitKind},exit_reason=${input.reason},
        ended_by=${req.authUser.id}::uuid,ended_at=now(),revision=revision+1 WHERE id=${input.expected_enrollment_id}::uuid`.execute(db);
      let resultEnrollmentId:string|null=null;
      if(input.action==='move_class') {
        const created=await db.insertInto("enrollments").values({student_id:input.student_id,class_section_id:input.target_class_section_id,
          term_id:input.target_term_id,roll_number:input.roll_number,enrolled_on:input.effective_on}).returning("id").executeTakeFirstOrThrow();
        resultEnrollmentId=created.id;
        await sql`INSERT INTO subject_attendance(student_id,subject_id,term_id)
          SELECT DISTINCT ${input.student_id}::uuid,slot.subject_id,slot.term_id FROM timetable_slots slot
          WHERE slot.class_section_id=${input.target_class_section_id}::uuid AND slot.term_id=${input.target_term_id}::uuid
            AND slot.subject_id IS NOT NULL AND slot.slot_type='class' ON CONFLICT(student_id,subject_id,term_id) DO NOTHING`.execute(db);
      }
      const classIds=input.action==='move_class'?[checked.current.class_section_id,input.target_class_section_id]:[checked.current.class_section_id];
      const reopened=(await sql<{id:string;revision:number}>`UPDATE attendance_registers SET state='draft',revision=revision+1,submitted_by=NULL,submitted_at=NULL,
        updated_at=now() WHERE class_section_id=ANY(${classIds}::uuid[]) AND term_id=${checked.current.term_id}::uuid
        AND date>=${input.effective_on}::date AND state='submitted' RETURNING id,revision`.execute(db)).rows;
      for(const register of reopened) await db.insertInto("audit_events").values({school_id:input.school_id,actor_id:req.authUser.id,
        action:"attendance.register.roster_changed",target_type:"attendance_register",target_id:register.id,request_id:req.requestId,ip_hash:null,
        metadata:{review_id:id,student_id:input.student_id,action:input.action,revision:register.revision,state:"draft"}}).execute();
      await sql`UPDATE student_enrollment_change_reviews SET committed_at=now(),result_enrollment_id=${resultEnrollmentId}::uuid WHERE id=${id}::uuid`.execute(db);
      await db.insertInto("audit_events").values({school_id:input.school_id,actor_id:req.authUser.id,action:`people.student.${exitKind}`,
        target_type:"student",target_id:input.student_id,request_id:req.requestId,ip_hash:null,metadata:{review_id:id,previous_enrollment_id:input.expected_enrollment_id,
          result_enrollment_id:resultEnrollmentId,effective_on:input.effective_on,reason:input.reason,impact:checked.impact}}).execute();
      const audience=(await sql<{user_id:string}>`SELECT DISTINCT membership.user_id FROM school_memberships membership
        WHERE membership.school_id=${input.school_id}::uuid AND membership.is_active AND (membership.role='admin'
          OR (membership.role='guardian' AND EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE relationship.student_id=${input.student_id}::uuid AND parent.user_id=membership.user_id))
          OR (membership.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.teacher_user_id=membership.user_id
            AND slot.class_section_id=ANY(${classIds}::uuid[]) AND slot.term_id=${checked.current.term_id}::uuid)))`.execute(db)).rows.map(row=>row.user_id);
      await this.events.enqueueUserEvent(db,{schoolId:input.school_id,eventType:"people.updated",aggregateType:"student",aggregateId:input.student_id,
        audienceUserIds:audience,idempotencyKey:`enrollment-change:${id}`,payload:{student_id:input.student_id,action:input.action,
          class_section_id:input.action==='move_class'?input.target_class_section_id:null,previous_class_section_id:checked.current.class_section_id,
          term_id:checked.current.term_id,refresh:["people","teacher.home","teacher.attendance","principal.home","principal.attendance","parent.home","transport","departure"]}});
      return {student_id:input.student_id,enrollment_id:resultEnrollmentId,action:input.action};
    });
  }

  private async validate(db: Db, input: Intake, lock = false) {
    const section = (await sql<{class_name:string;term_name:string;today:string;starts_on:string;ends_on:string}>`
      SELECT concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name,t.starts_on::text,t.ends_on::text,
        (now() AT TIME ZONE s.timezone)::date::text AS today
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      JOIN schools s ON s.id=c.school_id WHERE c.id=${input.class_section_id}::uuid AND t.id=${input.term_id}::uuid
        AND c.school_id=${input.school_id}::uuid AND t.is_active ${lock?sql`FOR UPDATE OF c FOR SHARE OF t`:sql``}`.execute(db)).rows[0];
    if (!section) throw new BadRequestException("Choose a class and active term belonging to this school.");
    if(input.enrolled_on<section.starts_on || input.enrolled_on>section.ends_on) throw new BadRequestException("Enrollment date must fall within the selected term.");
    if(input.date_of_birth>=input.enrolled_on || input.date_of_birth>section.today || input.date_of_birth<"1900-01-01") throw new BadRequestException("Date of birth must precede enrollment and cannot be in the future.");
    if ((await sql`SELECT id FROM students WHERE school_id=${input.school_id}::uuid AND lower(admission_number)=lower(${input.admission_number})`.execute(db)).rows.length) throw new ConflictException("This admission number already exists in the school.");
    if ((await sql`SELECT id FROM enrollments WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND roll_number=${input.roll_number}`.execute(db)).rows.length) throw new ConflictException("This roll number is already assigned. Choose another number.");
    let guardian: {id:string;name:string;phone:string};
    if(input.guardian.mode==='existing') {
      const found=(await sql<{id:string;name:string;phone:string}>`SELECT gp.guardian_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,p.contact_phone AS phone
        FROM guardian_school_profiles gp JOIN school_people p ON p.id=gp.person_id JOIN parents parent ON parent.id=gp.guardian_id
        WHERE gp.school_id=${input.school_id}::uuid AND gp.guardian_id=${input.guardian.id}::uuid ${lock?sql`FOR SHARE OF gp,p FOR UPDATE OF parent`:sql``}`.execute(db)).rows[0];
      if(!found) throw new BadRequestException("Select an existing guardian from this school.");
      guardian=found;
    } else guardian={id:"",name:`${input.guardian.first_name} ${input.guardian.last_name}`.trim(),phone:input.guardian.phone};
    const warnings: string[]=[];
    const registers=(await sql<{id:string;state:string}>`SELECT id,state FROM attendance_registers
      WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND date>=${input.enrolled_on}::date
      ${lock?sql`FOR UPDATE`:sql``}`.execute(db)).rows;
    if(registers.some(r=>r.state==='locked')) throw new ConflictException("An affected attendance register is locked. Reopen it or choose a later enrollment date.");
    const submitted=registers.filter(r=>r.state==='submitted').length;
    if(submitted) warnings.push(`${submitted} submitted attendance register(s) will return to draft because this enrollment changes the roster. Existing attendance marks will be preserved.`);
    if(input.guardian.mode==='new') {
      const match=(await sql`SELECT id FROM school_people WHERE school_id=${input.school_id}::uuid
        AND (regexp_replace(contact_phone,'[^0-9]','','g')=regexp_replace(${input.guardian.phone},'[^0-9]','','g')
          OR lower(concat_ws(' ',first_name,last_name))=lower(${guardian.name})) LIMIT 1`.execute(db)).rows[0];
      if(match) warnings.push("A name or phone matches an existing person. This will create a separate guardian; go back and select an existing guardian if they are the same person.");
    }
    return {class_name:section.class_name,term_name:section.term_name,guardian,warnings};
  }

  async preview(req: AuthenticatedRequest, body:unknown) {
    const input=intakeSchema.parse(body);
    await this.authorize(this.db,req.authUser,input.school_id);
    const review=await this.validate(this.db,input);
    const draft=(await sql<{id:string;expires_at:Date}>`INSERT INTO people_intakes(school_id,created_by,input)
      VALUES(${input.school_id}::uuid,${req.authUser.id}::uuid,${JSON.stringify(input)}::jsonb) RETURNING id,expires_at`.execute(this.db)).rows[0]!;
    return {...draft,input,...review};
  }

  async commit(req: AuthenticatedRequest,idValue:string) {
    const id=z.string().uuid().parse(idValue);
    return this.db.transaction().execute(async(db)=>{
      const draft=(await sql<Draft>`SELECT * FROM people_intakes WHERE id=${id}::uuid AND created_by=${req.authUser.id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if(!draft) throw new NotFoundException("Enrollment review not found.");
      await this.authorize(db,req.authUser,draft.school_id,true);
      if(draft.committed_student_id) return {student_id:draft.committed_student_id};
      if(new Date(draft.expires_at).getTime()<Date.now()) throw new ConflictException("This review expired. Review the details again before saving.");
      const input=intakeSchema.parse(draft.input);
      // Serializes admission uniqueness across classes as well as concurrent commits.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admission:${input.school_id}:${input.admission_number}`},0))`.execute(db);
      await this.validate(db,input,true);
      const person=await db.insertInto("school_people").values({school_id:input.school_id,first_name:input.first_name,last_name:input.last_name}).returning("id").executeTakeFirstOrThrow();
      const student=await db.insertInto("students").values({person_id:person.id,user_id:null,school_id:input.school_id,admission_number:input.admission_number,date_of_birth:input.date_of_birth,blood_group:null,emergency_contact:null}).returning("id").executeTakeFirstOrThrow();
      let guardianId:string;
      if(input.guardian.mode==='existing') guardianId=input.guardian.id;
      else {
        const person=await db.insertInto("school_people").values({school_id:input.school_id,first_name:input.guardian.first_name,last_name:input.guardian.last_name,contact_phone:input.guardian.phone,contact_email:input.guardian.email}).returning("id").executeTakeFirstOrThrow();
        const guardian=await db.insertInto("parents").values({user_id:null,phone:input.guardian.phone}).returning("id").executeTakeFirstOrThrow();
        guardianId=guardian.id;
        await db.insertInto("guardian_school_profiles").values({school_id:input.school_id,guardian_id:guardianId,person_id:person.id}).execute();
      }
      await db.insertInto("guardian_relationships").values({student_id:student.id,guardian_id:guardianId,relationship:input.relationship,is_primary:true,can_authorize_leave:input.can_authorize_leave}).execute();
      await db.insertInto("enrollments").values({student_id:student.id,class_section_id:input.class_section_id,term_id:input.term_id,roll_number:input.roll_number,enrolled_on:input.enrolled_on}).execute();
      const reopened=(await sql<{id:string;revision:number}>`UPDATE attendance_registers SET state='draft',revision=revision+1,submitted_by=NULL,submitted_at=NULL,updated_at=now()
        WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND date>=${input.enrolled_on}::date AND state='submitted'
        RETURNING id,revision`.execute(db)).rows;
      for(const register of reopened) await db.insertInto("audit_events").values({school_id:input.school_id,actor_id:req.authUser.id,action:"attendance.register.roster_changed",target_type:"attendance_register",target_id:register.id,request_id:req.requestId,ip_hash:null,metadata:{intake_id:id,student_id:student.id,revision:register.revision,state:"draft"}}).execute();
      await sql`INSERT INTO subject_attendance(student_id,subject_id,term_id)
        SELECT DISTINCT ${student.id}::uuid,t.subject_id,t.term_id FROM timetable_slots t
        WHERE t.class_section_id=${input.class_section_id}::uuid AND t.term_id=${input.term_id}::uuid AND t.subject_id IS NOT NULL AND t.slot_type='class'`.execute(db);
      await sql`UPDATE people_intakes SET committed_student_id=${student.id}::uuid,committed_at=now(),input='{}'::jsonb WHERE id=${id}::uuid`.execute(db);
      await db.insertInto("audit_events").values({school_id:input.school_id,actor_id:req.authUser.id,action:"people.student.enrolled",target_type:"student",target_id:student.id,request_id:req.requestId,ip_hash:null,metadata:{intake_id:id,guardian_id:guardianId,class_section_id:input.class_section_id,enrolled_on:input.enrolled_on}}).execute();
      const audience=(await sql<{user_id:string}>`SELECT DISTINCT m.user_id FROM school_memberships m
        WHERE m.school_id=${input.school_id}::uuid AND m.is_active AND (m.role='admin' OR
          (m.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots t WHERE t.class_section_id=${input.class_section_id}::uuid AND t.term_id=${input.term_id}::uuid AND t.teacher_user_id=m.user_id)) OR
          (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p WHERE p.id=${guardianId}::uuid AND p.user_id=m.user_id)))`.execute(db)).rows.map(r=>r.user_id);
      await this.events.enqueueUserEvent(db,{schoolId:input.school_id,eventType:"people.updated",aggregateType:"student",aggregateId:student.id,
        audienceUserIds:audience,idempotencyKey:`enrollment:${id}`,payload:{student_id:student.id,class_section_id:input.class_section_id,term_id:input.term_id,
          refresh:["people","teacher.home","teacher.attendance","principal.home","principal.attendance","parent.home"]}});
      return {student_id:student.id};
    });
  }
}
