import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";

const code = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);
const timezone = z.string().trim().max(64).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid timezone.");
const formalApplication = z.object({
  application_id: z.uuid().optional(),
  institution_name: z.string().trim().min(2).max(180),
  requested_code: code,
  institution_kind: z.enum(["school", "college", "hybrid"]),
  timezone: timezone.default("Asia/Kolkata"),
  state_code: z.string().trim().min(2).max(12).transform((value) => value.toUpperCase()),
  district: z.string().trim().min(2).max(120),
  website: z.union([z.literal(""), z.url().max(240)]).default(""),
  applicant_role_title: z.string().trim().min(2).max(120),
  regulator_type: z.enum(["udise", "aishe", "board_affiliation", "trust_registration", "other"]),
  regulator_reference: z.string().trim().min(3).max(180),
  declaration_accepted: z.literal(true),
}).strict();
const coachingWorkspace = z.object({
  name: z.string().trim().min(2).max(180),
  code,
  timezone: timezone.default("Asia/Kolkata"),
  delivery_mode: z.enum(["in_person", "online", "hybrid"]).default("in_person"),
  minors_enrolled: z.boolean().default(true),
}).strict();

@Injectable()
export class InstitutionOnboardingService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  async workspace(user: AuthUser) {
    const applications = await sql`SELECT a.id,a.institution_name,a.requested_code,a.institution_kind,a.timezone,
      a.state_code,a.district,a.website,a.applicant_role_title,a.regulator_type,a.regulator_reference,
      a.status,a.review_note,a.revision,a.submitted_at,a.updated_at,a.provisioned_school_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('action',x.action,'from_status',x.from_status,'to_status',x.to_status,'note',x.note,'created_at',x.created_at) ORDER BY x.created_at)
        FROM institution_onboarding_audits x WHERE x.application_id=a.id),'[]'::jsonb) AS timeline
      FROM institution_onboarding_applications a WHERE a.applicant_user_id=${user.id}::uuid
      ORDER BY a.created_at DESC`.execute(this.db);
    const coaching = await sql`SELECT id,name,code,timezone,institution_kind,onboarding_model,verification_status,created_at
      FROM schools WHERE created_by_user_id=${user.id}::uuid AND onboarding_model='self_service_coaching'
      ORDER BY created_at DESC`.execute(this.db);
    return { applications: applications.rows, coaching_workspaces: coaching.rows };
  }

  async submitFormal(user: AuthUser, body: unknown, request: FastifyRequest) {
    if (!user.email_verified_at) throw new ConflictException("Verify your account email before submitting an institution application.");
    const input = formalApplication.parse(body);
    try {
      const result = await this.db.transaction().execute(async (db) => {
        if (input.application_id) {
          const current = (await sql<{ status: string }>`SELECT status FROM institution_onboarding_applications
            WHERE id=${input.application_id}::uuid AND applicant_user_id=${user.id}::uuid FOR UPDATE`.execute(db)).rows[0];
          if (!current) throw new NotFoundException("Onboarding application not found.");
          if (current.status !== "needs_information") throw new ConflictException("Only an application awaiting information can be resubmitted.");
          const application = (await sql`UPDATE institution_onboarding_applications SET
            institution_name=${input.institution_name},requested_code=${input.requested_code},institution_kind=${input.institution_kind},timezone=${input.timezone},
            state_code=${input.state_code},district=${input.district},website=${input.website},applicant_role_title=${input.applicant_role_title},
            regulator_type=${input.regulator_type},regulator_reference=${input.regulator_reference},declaration_accepted=true,
            status='submitted',review_note='',reviewed_by=NULL,reviewed_at=NULL,revision=revision+1,submitted_at=now(),updated_at=now()
            WHERE id=${input.application_id}::uuid RETURNING *`.execute(db)).rows[0]!;
          await sql`INSERT INTO institution_onboarding_audits(application_id,actor_id,action,from_status,to_status)
            VALUES(${input.application_id}::uuid,${user.id}::uuid,'resubmitted','needs_information','submitted')`.execute(db);
          return application;
        }
        const application = (await sql`INSERT INTO institution_onboarding_applications(
          applicant_user_id,institution_name,requested_code,institution_kind,timezone,state_code,district,website,
          applicant_role_title,regulator_type,regulator_reference,declaration_accepted)
          VALUES(${user.id}::uuid,${input.institution_name},${input.requested_code},${input.institution_kind},${input.timezone},
          ${input.state_code},${input.district},${input.website},${input.applicant_role_title},${input.regulator_type},${input.regulator_reference},true)
          RETURNING *`.execute(db)).rows[0]!;
        await sql`INSERT INTO institution_onboarding_audits(application_id,actor_id,action,to_status)
          VALUES(${(application as { id: string }).id}::uuid,${user.id}::uuid,'submitted','submitted')`.execute(db);
        return application;
      });
      await this.audit.record({ action: input.application_id ? "institution.onboarding.resubmitted" : "institution.onboarding.submitted", request, actorId: user.id, targetType: "institution_onboarding_application", targetId: (result as { id: string }).id, metadata: { institution_kind: input.institution_kind } });
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("This institution code is already in use or under review.");
      throw error;
    }
  }

  async createCoaching(user: AuthUser, sessionHash: string, body: unknown, request: FastifyRequest) {
    if (!user.email_verified_at) throw new ConflictException("Verify your account email before creating a coaching workspace.");
    const input = coachingWorkspace.parse(body);
    try {
      const workspace = await this.db.transaction().execute(async (db) => {
        const existing = await sql`SELECT 1 FROM schools WHERE created_by_user_id=${user.id}::uuid
          AND onboarding_model='self_service_coaching' FOR UPDATE`.execute(db);
        if (existing.rows.length) throw new ConflictException("This account already owns a coaching workspace. You can manage it from your principal portal.");
        const school = (await sql<{ id: string; name: string; code: string }>`INSERT INTO schools(
          name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id)
          VALUES(${input.name},${input.code},${input.timezone},'coaching','self_service_coaching','not_required',${user.id}::uuid)
          RETURNING id,name,code`.execute(db)).rows[0]!;
        await sql`INSERT INTO school_memberships(user_id,school_id,role) VALUES(${user.id}::uuid,${school.id}::uuid,'admin')`.execute(db);
        await sql`UPDATE institution_regulatory_profiles SET institution_kind='coaching',management_kind='other',
          delivery_mode=${input.delivery_mode},education_levels=ARRAY['coaching']::text[],capability_packs=ARRAY['coaching_core']::text[],
          minors_enrolled=${input.minors_enrolled},staff_count_band='0_9',review_note='Self-service coaching workspace; company verification is not required.',updated_by=${user.id}::uuid
          WHERE school_id=${school.id}::uuid`.execute(db);
        await sql`UPDATE auth_sessions SET active_school_id=${school.id}::uuid WHERE token_hash=${sessionHash} AND user_id=${user.id}::uuid`.execute(db);
        return { ...school, institution_kind: "coaching", onboarding_model: "self_service_coaching", verification_status: "not_required" };
      });
      await this.audit.record({ action: "coaching.workspace.created", request, actorId: user.id, schoolId: workspace.id, targetType: "school", targetId: workspace.id, metadata: { delivery_mode: input.delivery_mode, verification: "not_required" } });
      return workspace;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("This workspace code is already in use.");
      throw error;
    }
  }
}
