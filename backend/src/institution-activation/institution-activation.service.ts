import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const quickStartSchema = z.object({
  academic_year: z.string().trim().regex(/^\d{4}-\d{2}$/),
  term_name: z.string().trim().min(2).max(100),
  starts_on: z.string().date(),
  ends_on: z.string().date(),
  grade_or_program: z.string().trim().min(1).max(16),
  section: z.string().trim().min(1).max(16),
  subjects: z.array(z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/),
    name: z.string().trim().min(2).max(100),
    short_name: z.string().trim().min(1).max(40),
  }).strict()).min(1).max(12),
  attendance_threshold: z.coerce.number().min(1).max(100),
  medical_document_after_days: z.coerce.number().int().min(0).max(30),
  contact_name: z.string().trim().min(2).max(120),
  contact_phone: z.string().trim().max(32).default(""),
  contact_email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""),
  teaching_days: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  starts_at: time,
  ends_at: time,
}).strict().refine((value) => value.starts_on <= value.ends_on, { message: "Term end must not precede its start." })
  .refine((value) => value.starts_at < value.ends_at, { message: "The period end time must follow its start time." })
  .refine((value) => Boolean(value.contact_phone || value.contact_email), { message: "Add a fallback phone or email." });

const activateSchema = z.object({ expected_revision: z.coerce.number().int().positive() }).strict();

type Db = DatabaseService | Transaction<Database>;

interface ReadinessCheck {
  key: string;
  label: string;
  description: string;
  target_path: string;
  required: boolean;
  complete: boolean;
  detail: string;
}

@Injectable()
export class InstitutionActivationService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  private async requireAdmin(user: AuthUser, schoolId: string, db: Db = this.db) {
    const membership = await db.selectFrom("school_memberships").select(["id", "role"])
      .where("school_id", "=", schoolId).where("user_id", "=", user.id)
      .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!membership) throw new ForbiddenException("An active institution administrator membership is required.");
    return membership;
  }

  private async context(schoolId: string, db: Db = this.db) {
    const row = (await sql<any>`SELECT school.id,school.name,school.code,school.timezone,school.institution_kind,
      school.onboarding_model,school.verification_status,profile.management_kind,profile.delivery_mode,
      profile.education_levels,profile.capability_packs,profile.minors_enrolled,
      state.capability_pack,state.status,state.revision,state.readiness_snapshot,state.reviewed_at,state.activated_at,
      pack.label AS capability_label,pack.description AS capability_description,pack.cohort_label,pack.learner_label,
      pack.default_subject_names,pack.requires_staff
      FROM schools school
      JOIN institution_regulatory_profiles profile ON profile.school_id=school.id
      JOIN institution_activation_states state ON state.school_id=school.id
      JOIN institution_capability_packs pack ON pack.code=state.capability_pack
      WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Institution activation workspace not found.");
    return row;
  }

  private async readiness(user: AuthUser, schoolId: string, db: Db = this.db) {
    const context = await this.context(schoolId, db);
    const requirementRows = (await sql<any>`SELECT requirement_key,label,description,target_path,required,sort_order
      FROM institution_activation_requirements WHERE capability_pack=${context.capability_pack}
      ORDER BY sort_order`.execute(db)).rows;
    const counts = (await sql<any>`SELECT
      (SELECT count(*)::int FROM school_contacts WHERE school_id=${schoolId}::uuid AND (phone<>'' OR email<>'')) AS fallback_contacts,
      (SELECT count(*)::int FROM academic_terms WHERE school_id=${schoolId}::uuid AND is_active) AS terms,
      (SELECT count(*)::int FROM class_sections WHERE school_id=${schoolId}::uuid) AS cohorts,
      (SELECT count(*)::int FROM subjects WHERE school_id=${schoolId}::uuid) AS subjects,
      (SELECT count(*)::int FROM attendance_policies policy JOIN academic_terms term ON term.id=policy.term_id WHERE term.school_id=${schoolId}::uuid AND term.is_active) AS policies,
      (SELECT count(*)::int FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='staff' AND is_active) AS staff,
      (SELECT count(*)::int FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id JOIN academic_terms term ON term.id=enrollment.term_id WHERE student.school_id=${schoolId}::uuid AND enrollment.is_active AND term.is_active) AS learners,
      (SELECT count(*)::int FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id JOIN academic_terms term ON term.id=slot.term_id WHERE section.school_id=${schoolId}::uuid AND term.is_active) AS schedule,
      (SELECT email_verified_at IS NOT NULL FROM users WHERE id=${user.id}::uuid) AS email_verified,
      (SELECT EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=${user.id}::uuid AND status='active')) AS mfa_active`.execute(db)).rows[0];
    const profileComplete = Array.isArray(context.capability_packs)
      && context.capability_packs.includes(context.capability_pack)
      && ["school", "college", "coaching", "hybrid"].includes(context.institution_kind);
    const values: Record<string, { complete: boolean; detail: string }> = {
      owner_email: { complete: Boolean(counts.email_verified), detail: counts.email_verified ? "Administrator email verified" : "Email verification required" },
      owner_mfa: { complete: Boolean(counts.mfa_active), detail: counts.mfa_active ? "Two-step verification active" : "Two-step verification required" },
      institution_profile: { complete: profileComplete, detail: profileComplete ? `${context.capability_label} selected` : "Review the institution profile and capability pack" },
      fallback_contact: { complete: counts.fallback_contacts > 0, detail: `${counts.fallback_contacts} fallback contact${counts.fallback_contacts === 1 ? "" : "s"}` },
      academic_term: { complete: counts.terms > 0, detail: `${counts.terms} active term${counts.terms === 1 ? "" : "s"}` },
      cohort: { complete: counts.cohorts > 0, detail: `${counts.cohorts} ${context.cohort_label.toLowerCase()}${counts.cohorts === 1 ? "" : "s"}` },
      subject: { complete: counts.subjects > 0, detail: `${counts.subjects} subject${counts.subjects === 1 ? "" : "s"}` },
      attendance_policy: { complete: counts.policies > 0, detail: `${counts.policies} active-term attendance polic${counts.policies === 1 ? "y" : "ies"}` },
      staff_owner: { complete: counts.staff > 0, detail: context.requires_staff ? `${counts.staff} active staff member${counts.staff === 1 ? "" : "s"}` : "Optional for this coaching workspace" },
      learner: { complete: counts.learners > 0, detail: `${counts.learners} actively enrolled ${context.learner_label.toLowerCase()}${counts.learners === 1 ? "" : "s"}` },
      schedule: { complete: counts.schedule > 0, detail: `${counts.schedule} published timetable period${counts.schedule === 1 ? "" : "s"}` },
    };
    const checks: ReadinessCheck[] = requirementRows.map((row: any) => ({
      key: row.requirement_key,
      label: row.label,
      description: row.description,
      target_path: row.target_path,
      required: row.required,
      complete: values[row.requirement_key]?.complete ?? false,
      detail: values[row.requirement_key]?.detail ?? "Not configured",
    }));
    const required = checks.filter((check) => check.required);
    const completed = required.filter((check) => check.complete).length;
    return {
      institution: context,
      checks,
      summary: {
        completed,
        required: required.length,
        percent: required.length ? Math.round(completed * 100 / required.length) : 100,
        ready: completed === required.length,
      },
      counts: {
        terms: counts.terms,
        cohorts: counts.cohorts,
        subjects: counts.subjects,
        staff: counts.staff,
        learners: counts.learners,
        schedule: counts.schedule,
      },
    };
  }

  async workspace(user: AuthUser, schoolId: string) {
    await this.requireAdmin(user, schoolId);
    const result = await this.readiness(user, schoolId);
    const history = (await sql`SELECT id,action,from_status,to_status,note,created_at
      FROM institution_activation_audits WHERE school_id=${schoolId}::uuid ORDER BY created_at DESC LIMIT 20`.execute(this.db)).rows;
    return { ...result, history };
  }

  async quickStart(user: AuthUser, schoolId: string, body: unknown, request: FastifyRequest) {
    const data = quickStartSchema.parse(body);
    const result = await this.db.transaction().execute(async (db) => {
      await this.requireAdmin(user, schoolId, db);
      const state = (await sql<{ status: string }>`SELECT status FROM institution_activation_states WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!state) throw new NotFoundException("Institution activation workspace not found.");
      if (state.status === "active") throw new ConflictException("This institution is already active. Use the administration tools for later changes.");
      const existing = (await sql<{ terms: number; cohorts: number; subjects: number }>`SELECT
        (SELECT count(*)::int FROM academic_terms WHERE school_id=${schoolId}::uuid) AS terms,
        (SELECT count(*)::int FROM class_sections WHERE school_id=${schoolId}::uuid) AS cohorts,
        (SELECT count(*)::int FROM subjects WHERE school_id=${schoolId}::uuid) AS subjects`.execute(db)).rows[0]!;
      if (existing.terms || existing.cohorts || existing.subjects) {
        throw new ConflictException("Quick start is only available for an empty workspace. Continue with the existing records in School administration.");
      }
      const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active,updated_by)
        VALUES(${schoolId}::uuid,${data.academic_year},${data.term_name},${data.starts_on}::date,${data.ends_on}::date,${data.attendance_threshold},true,${user.id}::uuid)
        RETURNING id`.execute(db)).rows[0]!;
      const cohort = (await sql<{ id: string }>`INSERT INTO class_sections(school_id,academic_year,grade,section,updated_by)
        VALUES(${schoolId}::uuid,${data.academic_year},${data.grade_or_program},${data.section},${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      const subjects: Array<{ id: string; name: string }> = [];
      for (const subject of data.subjects) {
        const row = (await sql<{ id: string; name: string }>`INSERT INTO subjects(school_id,code,name,short_name,updated_by)
          VALUES(${schoolId}::uuid,${subject.code},${subject.name},${subject.short_name},${user.id}::uuid) RETURNING id,name`.execute(db)).rows[0]!;
        subjects.push(row);
      }
      await sql`INSERT INTO attendance_policies(term_id,name,minimum_percentage,medical_document_after_days,policy_text)
        VALUES(${term.id}::uuid,${`${data.term_name} attendance policy`},${data.attendance_threshold},${data.medical_document_after_days},'Attendance is recorded for each scheduled teaching day. Corrections remain auditable.')`.execute(db);
      await sql`INSERT INTO school_contacts(school_id,label,name,phone,email,availability,priority)
        VALUES(${schoolId}::uuid,'Operations fallback',${data.contact_name},${data.contact_phone},${data.contact_email},'During teaching hours',1)`.execute(db);
      for (const [index, weekday] of [...new Set(data.teaching_days)].sort().entries()) {
        const subject = subjects[index % subjects.length]!;
        await sql`INSERT INTO timetable_slots(class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,slot_type,title)
          VALUES(${cohort.id}::uuid,${term.id}::uuid,${subject.id}::uuid,${weekday},1,${data.starts_at}::time,${data.ends_at}::time,'class',${subject.name})`.execute(db);
      }
      const snapshot = { academic_year: data.academic_year, term_id: term.id, cohort_id: cohort.id, subject_count: subjects.length, teaching_days: data.teaching_days };
      await sql`INSERT INTO institution_activation_audits(school_id,actor_id,action,from_status,to_status,snapshot)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'quick_start_applied',${state.status},'draft',${JSON.stringify(snapshot)}::jsonb)`.execute(db);
      return snapshot;
    });
    await this.audit.record({ action: "institution.activation.quick_start_applied", request, actorId: user.id, schoolId, targetType: "school", targetId: schoolId, metadata: result });
    return this.workspace(user, schoolId);
  }

  async review(user: AuthUser, schoolId: string, request: FastifyRequest) {
    const result = await this.db.transaction().execute(async (db) => {
      await this.requireAdmin(user, schoolId, db);
      const state = (await sql<{ status: string }>`SELECT status FROM institution_activation_states WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!state) throw new NotFoundException("Institution activation workspace not found.");
      if (state.status === "active") return this.readiness(user, schoolId, db);
      const readiness = await this.readiness(user, schoolId, db);
      const next = readiness.summary.ready ? "ready" : "draft";
      await sql`UPDATE institution_activation_states SET status=${next},readiness_snapshot=${JSON.stringify(readiness)}::jsonb,
        reviewed_by=${user.id}::uuid,reviewed_at=now(),activated_by=NULL,activated_at=NULL WHERE school_id=${schoolId}::uuid`.execute(db);
      await sql`INSERT INTO institution_activation_audits(school_id,actor_id,action,from_status,to_status,snapshot,note)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'readiness_reviewed',${state.status},${next},${JSON.stringify(readiness)}::jsonb,
          ${readiness.summary.ready ? "All required readiness checks passed." : "Readiness review found incomplete requirements."})`.execute(db);
      return readiness;
    });
    await this.audit.record({ action: "institution.activation.readiness_reviewed", request, actorId: user.id, schoolId, targetType: "school", targetId: schoolId, metadata: { ready: result.summary.ready, completed: result.summary.completed, required: result.summary.required } });
    return this.workspace(user, schoolId);
  }

  async activate(user: AuthUser, schoolId: string, body: unknown, request: FastifyRequest) {
    const data = activateSchema.parse(body);
    await this.db.transaction().execute(async (db) => {
      await this.requireAdmin(user, schoolId, db);
      const state = (await sql<{ status: string; revision: number }>`SELECT status,revision FROM institution_activation_states WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!state) throw new NotFoundException("Institution activation workspace not found.");
      if (state.status === "active") return;
      if (state.status !== "ready") throw new ConflictException("Review readiness before activating the institution.");
      if (state.revision !== data.expected_revision) throw new ConflictException("Readiness changed. Review the latest setup before activating.");
      const readiness = await this.readiness(user, schoolId, db);
      if (!readiness.summary.ready) throw new ConflictException("Setup changed after review. Complete the remaining requirements and review readiness again.");
      const updated = await sql`UPDATE institution_activation_states SET status='active',readiness_snapshot=${JSON.stringify(readiness)}::jsonb,
        reviewed_by=${user.id}::uuid,reviewed_at=now(),activated_by=${user.id}::uuid,activated_at=now()
        WHERE school_id=${schoolId}::uuid AND revision=${data.expected_revision} RETURNING revision`.execute(db);
      if (!updated.rows.length) throw new ConflictException("Readiness changed. Review the latest setup before activating.");
      await sql`INSERT INTO institution_activation_audits(school_id,actor_id,action,from_status,to_status,snapshot,note)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'activated','ready','active',${JSON.stringify(readiness)}::jsonb,'First-day readiness published.')`.execute(db);
      await sql`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
        VALUES(${schoolId}::uuid,'InstitutionActivated','school',${schoolId}::uuid,ARRAY[${user.id}::uuid],
          ${JSON.stringify({ capability_pack: readiness.institution.capability_pack, readiness: readiness.summary })}::jsonb,
          ${`institution-activated:${schoolId}:${data.expected_revision}`})`.execute(db);
    });
    await this.audit.record({ action: "institution.activation.activated", request, actorId: user.id, schoolId, targetType: "school", targetId: schoolId });
    return this.workspace(user, schoolId);
  }
}
