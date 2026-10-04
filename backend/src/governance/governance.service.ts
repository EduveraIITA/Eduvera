import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";

type Db = Kysely<Database> | Transaction<Database>;
type MemberRole = "admin" | "staff" | "guardian" | "student";
const uuid = z.string().uuid();
const date = z.iso.date();
const roles = z.array(z.enum(["admin", "staff", "guardian", "student"])).min(1).transform((items) => [...new Set(items)]);
const profileInput = z.object({
  institution_kind: z.enum(["school", "college", "coaching", "hybrid"]),
  country_code: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  state_code: z.string().trim().max(12), district: z.string().trim().max(120),
  management_kind: z.enum(["government", "government_aided", "private_unaided", "trust_society", "corporate", "other"]),
  delivery_mode: z.enum(["in_person", "online", "hybrid"]),
  education_levels: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/)).min(1).max(12).transform((items) => [...new Set(items)]),
  regulator_codes: z.array(z.string().trim().min(1).max(48)).max(12).transform((items) => [...new Set(items.map((item) => item.toUpperCase()))]),
  capability_packs: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{2,63}$/)).min(1).max(12).transform((items) => [...new Set(items)]),
  recognition_reference: z.string().trim().max(180), affiliation_reference: z.string().trim().max(180),
  residential: z.boolean(), transport_provided: z.boolean(), minors_enrolled: z.boolean(),
  staff_count_band: z.enum(["0_9", "10_49", "50_99", "100_249", "250_plus"]),
  reviewed_on: date.nullable(), review_note: z.string().trim().max(1000), expected_revision: z.number().int().positive(),
});
const draftInput = z.object({
  title: z.string().trim().min(3).max(180), summary: z.string().trim().max(600),
  body_markdown: z.string().trim().max(50_000), audience_roles: roles,
  requires_acknowledgement: z.boolean(), effective_on: date.nullable(), review_due_on: date.nullable(),
  source_note: z.string().trim().max(1000), expected_revision: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.effective_on && value.review_due_on && value.review_due_on < value.effective_on) {
    context.addIssue({ code: "custom", message: "Review date cannot be before the effective date.", path: ["review_due_on"] });
  }
});
const revisionInput = z.object({ expected_revision: z.number().int().positive() });
const reviewInput = z.object({
  decision: z.enum(["publish", "reject"]), expected_revision: z.number().int().positive(),
  note: z.string().trim().min(5).max(1000), override_reason: z.string().trim().max(1000).default(""),
});
const acknowledgementInput = z.object({ acknowledgement_text: z.string().trim().min(5).max(240) });

@Injectable()
export class GovernanceService {
  constructor(private readonly db: DatabaseService) {}

  private async memberships(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    const rows = await db.selectFrom("school_memberships").select("role")
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).execute();
    if (!rows.length) throw new ForbiddenException("Active institution membership is required.");
    return rows.map((item) => item.role);
  }

  private async admin(user: AuthUser, schoolId: string, db: Db = this.db) {
    const memberRoles = await this.memberships(user, schoolId, db);
    if (!memberRoles.includes("admin")) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, action: string, targetType: "regulatory_profile" | "policy_version" | "policy_acknowledgement", targetId: string | null, metadata: Record<string, unknown> = {}) {
    await db.insertInto("institution_governance_audits").values({ school_id: schoolId, actor_id: user.id, action, target_type: targetType, target_id: targetId, metadata }).execute();
  }

  private async enqueue(db: Transaction<Database>, schoolId: string, eventType: string, versionId: string, revision: number, audience: string[], notification: Record<string, unknown> | null = null, idempotencySuffix = "") {
    await db.insertInto("event_outbox").values({
      school_id: schoolId, event_type: eventType, aggregate_type: "institution_policy_version", aggregate_id: versionId,
      audience_user_ids: [...new Set(audience)], payload: { version_id: versionId, revision },
      idempotency_key: `${eventType}:${versionId}:${revision}${idempotencySuffix ? `:${idempotencySuffix}` : ""}`, notification_user_ids: [...new Set(audience)], notification_payload: notification as any,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
  }

  async workspace(user: AuthUser, schoolId: string) {
    await this.admin(user, schoolId);
    const profile = await this.db.selectFrom("institution_regulatory_profiles").selectAll().where("school_id", "=", schoolId).executeTakeFirst();
    if (!profile) throw new NotFoundException("Institution regulatory profile is not initialised.");
    const familiesResult = await sql<Record<string, unknown>>`SELECT family.*,
        current.id AS current_version_id,current.version AS current_version,current.status AS current_status,
        current.summary AS current_summary,current.effective_on AS current_effective_on,current.review_due_on AS current_review_due_on,
        current.requires_acknowledgement AS current_requires_acknowledgement,current.revision AS current_revision,
        work.id AS work_version_id,work.version AS work_version,work.status AS work_status,work.title AS work_title,
        work.summary AS work_summary,work.body_markdown AS work_body_markdown,work.audience_roles AS work_audience_roles,
        work.requires_acknowledgement AS work_requires_acknowledgement,work.effective_on AS work_effective_on,
        work.review_due_on AS work_review_due_on,work.source_note AS work_source_note,work.revision AS work_revision,
        work.created_by AS work_created_by,work.submitted_by AS work_submitted_by,
        (family.capability_pack=ANY(${profile.capability_packs}::text[]) AND ${profile.institution_kind}=ANY(family.applicable_institution_kinds)) AS applicable
      FROM institution_policy_families family
      LEFT JOIN LATERAL (SELECT version.* FROM institution_policy_versions version WHERE version.family_id=family.id AND version.status='published' LIMIT 1) current ON true
      LEFT JOIN LATERAL (SELECT version.* FROM institution_policy_versions version WHERE version.family_id=family.id AND version.status IN ('draft','in_review') ORDER BY version.version DESC LIMIT 1) work ON true
      WHERE family.school_id=${schoolId}::uuid AND family.is_active ORDER BY family.sort_order,family.title`.execute(this.db);
    const audits = await sql<Record<string, unknown>>`SELECT audit.*,actor.first_name,actor.last_name FROM institution_governance_audits audit
      JOIN users actor ON actor.id=audit.actor_id WHERE audit.school_id=${schoolId}::uuid ORDER BY audit.created_at DESC LIMIT 40`.execute(this.db);
    const families = familiesResult.rows;
    const applicable = families.filter((item) => item.applicable === true);
    return {
      profile, families, audits: audits.rows,
      metrics: {
        applicable: applicable.length,
        published: applicable.filter((item) => item.current_status === "published").length,
        in_review: applicable.filter((item) => item.work_status === "in_review").length,
        review_due: applicable.filter((item) => typeof item.current_review_due_on === "string" && item.current_review_due_on <= new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)).length,
      },
    };
  }

  async updateProfile(user: AuthUser, schoolId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = profileInput.parse(body);
      const updated = await trx.updateTable("institution_regulatory_profiles").set({
        institution_kind: input.institution_kind, country_code: input.country_code, state_code: input.state_code,
        district: input.district, management_kind: input.management_kind, delivery_mode: input.delivery_mode,
        education_levels: input.education_levels, regulator_codes: input.regulator_codes, capability_packs: input.capability_packs,
        recognition_reference: input.recognition_reference, affiliation_reference: input.affiliation_reference,
        residential: input.residential, transport_provided: input.transport_provided, minors_enrolled: input.minors_enrolled,
        staff_count_band: input.staff_count_band, reviewed_on: input.reviewed_on, review_note: input.review_note, updated_by: user.id,
      }).where("school_id", "=", schoolId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("The institution profile changed. Reload and review it again.");
      await this.audit(trx, user, schoolId, "governance.profile.updated", "regulatory_profile", null, { revision: updated.revision, institution_kind: updated.institution_kind, capability_packs: updated.capability_packs });
      return updated;
    });
  }

  async saveDraft(user: AuthUser, schoolId: string, code: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = draftInput.parse(body);
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(code)) throw new BadRequestException("Invalid policy code.");
      const family = await trx.selectFrom("institution_policy_families").selectAll().where("school_id", "=", schoolId).where("code", "=", code).forUpdate().executeTakeFirst();
      if (!family) throw new NotFoundException("Policy family was not found.");
      const active = await trx.selectFrom("institution_policy_versions").selectAll().where("family_id", "=", family.id).where("status", "in", ["draft", "in_review"]).orderBy("version", "desc").executeTakeFirst();
      if (active?.status === "in_review") throw new ConflictException("This policy is already in review. It must be published or rejected before editing.");
      let version;
      if (active) {
        if (!input.expected_revision || input.expected_revision !== active.revision) throw new ConflictException("The policy draft changed. Reload and review it again.");
        version = await trx.updateTable("institution_policy_versions").set({ title: input.title, summary: input.summary, body_markdown: input.body_markdown, audience_roles: input.audience_roles, requires_acknowledgement: input.requires_acknowledgement, effective_on: input.effective_on, review_due_on: input.review_due_on, source_note: input.source_note })
          .where("id", "=", active.id).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
      } else {
        const maximum = await trx.selectFrom("institution_policy_versions").select(({ fn }) => fn.max<number>("version").as("version")).where("family_id", "=", family.id).executeTakeFirst();
        version = await trx.insertInto("institution_policy_versions").values({ school_id: schoolId, family_id: family.id, version: Number(maximum?.version ?? 0) + 1, title: input.title, summary: input.summary, body_markdown: input.body_markdown, audience_roles: input.audience_roles, requires_acknowledgement: input.requires_acknowledgement, effective_on: input.effective_on, review_due_on: input.review_due_on, source_note: input.source_note, created_by: user.id, submitted_by: null, reviewed_by: null, review_separation_met: null }).returningAll().executeTakeFirstOrThrow();
      }
      if (!version) throw new ConflictException("The policy draft changed. Reload and try again.");
      await this.audit(trx, user, schoolId, "governance.policy.draft_saved", "policy_version", version.id, { family_code: code, version: version.version, revision: version.revision });
      return version;
    });
  }

  async submitForReview(user: AuthUser, schoolId: string, versionId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = revisionInput.parse(body); uuid.parse(versionId);
      const current = await trx.selectFrom("institution_policy_versions").selectAll().where("school_id", "=", schoolId).where("id", "=", versionId).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Policy version was not found.");
      if (current.status !== "draft") throw new ConflictException("Only a draft can be submitted for review.");
      if (current.revision !== input.expected_revision) throw new ConflictException("The policy draft changed. Reload and review it again.");
      if (current.body_markdown.trim().length < 40 || current.summary.trim().length < 12) throw new BadRequestException("Add a meaningful summary and policy content before review.");
      const updated = await trx.updateTable("institution_policy_versions").set({ status: "in_review", submitted_by: user.id, submitted_at: new Date(), review_note: "", review_override_reason: "", reviewed_by: null, reviewed_at: null, review_separation_met: null })
        .where("id", "=", versionId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("The policy draft changed. Reload and try again.");
      await this.audit(trx, user, schoolId, "governance.policy.submitted", "policy_version", versionId, { version: updated.version, revision: updated.revision });
      const admins = await trx.selectFrom("school_memberships").select("user_id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
      await this.enqueue(trx, schoolId, "governance.policy.submitted", versionId, updated.revision, admins.map((item) => item.user_id), { title: "Policy ready for review", body: updated.title });
      return updated;
    });
  }

  async review(user: AuthUser, schoolId: string, versionId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = reviewInput.parse(body); uuid.parse(versionId);
      const current = await trx.selectFrom("institution_policy_versions").innerJoin("institution_policy_families", "institution_policy_families.id", "institution_policy_versions.family_id")
        .select(["institution_policy_versions.id", "institution_policy_versions.family_id", "institution_policy_versions.title", "institution_policy_versions.version", "institution_policy_versions.revision", "institution_policy_versions.status", "institution_policy_versions.submitted_by", "institution_policy_versions.audience_roles", "institution_policy_versions.effective_on", "institution_policy_families.risk_level", "institution_policy_families.code"])
        .where("institution_policy_versions.school_id", "=", schoolId).where("institution_policy_versions.id", "=", versionId).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Policy version was not found.");
      if (current.status !== "in_review") throw new ConflictException("Only a policy in review can be decided.");
      if (current.revision !== input.expected_revision) throw new ConflictException("The review changed. Reload and review it again.");
      const adminCount = await trx.selectFrom("school_memberships").select(({ fn }) => fn.countAll<number>().as("count")).where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirstOrThrow();
      const separated = current.submitted_by !== user.id;
      if (input.decision === "publish" && current.risk_level === "high" && !separated && Number(adminCount.count) > 1) throw new ForbiddenException("A different active administrator must review this high-risk policy.");
      if (input.decision === "publish" && !separated && input.override_reason.length < 20) throw new BadRequestException("Record why independent review is unavailable (at least 20 characters).");
      if (input.decision === "reject") {
        const rejected = await trx.updateTable("institution_policy_versions").set({ status: "draft", reviewed_by: user.id, reviewed_at: new Date(), review_note: input.note, review_separation_met: separated, review_override_reason: separated ? "" : input.override_reason, submitted_by: null, submitted_at: null })
          .where("id", "=", versionId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
        if (!rejected) throw new ConflictException("The review changed. Reload and try again.");
        await this.audit(trx, user, schoolId, "governance.policy.rejected", "policy_version", versionId, { version: rejected.version, revision: rejected.revision, review_separation_met: separated });
        return rejected;
      }
      await trx.updateTable("institution_policy_versions").set({ status: "retired", retired_at: new Date() }).where("family_id", "=", current.family_id).where("status", "=", "published").execute();
      const published = await trx.updateTable("institution_policy_versions").set({ status: "published", reviewed_by: user.id, reviewed_at: new Date(), review_note: input.note, review_separation_met: separated, review_override_reason: separated ? "" : input.override_reason, published_at: new Date(), effective_on: current.effective_on ?? new Date().toISOString().slice(0, 10) })
        .where("id", "=", versionId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
      if (!published) throw new ConflictException("The review changed. Reload and try again.");
      const audience = await trx.selectFrom("school_memberships").select("user_id").where("school_id", "=", schoolId).where("is_active", "=", true).where("role", "in", published.audience_roles as MemberRole[]).execute();
      await this.audit(trx, user, schoolId, "governance.policy.published", "policy_version", versionId, { family_code: current.code, version: published.version, revision: published.revision, review_separation_met: separated });
      await this.enqueue(trx, schoolId, "governance.policy.published", versionId, published.revision, audience.map((item) => item.user_id), { title: "Institution policy updated", body: published.title });
      return published;
    });
  }

  async publishedPolicies(user: AuthUser, schoolId: string) {
    const memberRoles = await this.memberships(user, schoolId);
    const result = await sql<Record<string, unknown>>`SELECT version.*,family.code,family.category,family.guidance,family.source_references,
        acknowledgement.id AS acknowledgement_id,acknowledgement.acknowledged_at
      FROM institution_policy_versions version JOIN institution_policy_families family ON family.id=version.family_id
      LEFT JOIN institution_policy_acknowledgements acknowledgement ON acknowledgement.policy_version_id=version.id AND acknowledgement.user_id=${user.id}::uuid
      WHERE version.school_id=${schoolId}::uuid AND version.status='published' AND version.audience_roles && ${memberRoles}::text[]
        AND version.effective_on<=CURRENT_DATE ORDER BY family.sort_order,family.title`.execute(this.db);
    return { policies: result.rows, membership_roles: memberRoles };
  }

  async acknowledge(user: AuthUser, schoolId: string, versionId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      const memberRoles = await this.memberships(user, schoolId, trx);
      const input = acknowledgementInput.parse(body); uuid.parse(versionId);
      const version = await trx.selectFrom("institution_policy_versions").selectAll().where("school_id", "=", schoolId).where("id", "=", versionId).where("status", "=", "published").executeTakeFirst();
      if (!version) throw new NotFoundException("Published policy version was not found.");
      const membershipRole = memberRoles.find((role) => version.audience_roles.includes(role));
      if (!membershipRole) throw new ForbiddenException("This policy is not published to your membership audience.");
      const inserted = await trx.insertInto("institution_policy_acknowledgements").values({ school_id: schoolId, policy_version_id: versionId, user_id: user.id, membership_role: membershipRole, acknowledgement_text: input.acknowledgement_text })
        .onConflict((conflict) => conflict.columns(["policy_version_id", "user_id"]).doNothing()).returningAll().executeTakeFirst();
      const acknowledgement = inserted ?? await trx.selectFrom("institution_policy_acknowledgements").selectAll().where("policy_version_id", "=", versionId).where("user_id", "=", user.id).executeTakeFirstOrThrow();
      if (inserted) {
        await this.audit(trx, user, schoolId, "governance.policy.acknowledged", "policy_acknowledgement", inserted.id, { policy_version_id: versionId, version: version.version, membership_role: membershipRole });
        await this.enqueue(trx, schoolId, "governance.policy.acknowledged", versionId, version.revision, [user.id], null, user.id);
      }
      return acknowledgement;
    });
  }
}
