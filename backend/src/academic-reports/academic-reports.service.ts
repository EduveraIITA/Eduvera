import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { hasScopedSchoolPermission, schoolPermission } from "../roles/authorization.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { assessmentResultsHref } from "../workspace/canonical-application-links.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { activityOccurrenceId } from "../schedule-planning/activity-occurrence.engine.js";
import { captureAcademicContext, publishedAcademicRoster } from "./academic-record-context.js";
import { calculateCreditGpa, evaluatePolicyPercentage, gradingPolicyConfigurationSchema, gradingPolicySnapshotSchema, latestCourseAttempts, policySemanticFingerprint, roundGradeValue,
  type GradingCreditCourse, type GradingPolicySnapshot } from "./grading-policy.js";

type Db = Kysely<Database> | Transaction<Database>;
const uuid = z.string().uuid();
const percentage = z.coerce.number().min(0).max(100);
const bandInput = z.object({
  code: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  label: z.string().trim().min(1).max(80),
  minimum_percentage: percentage,
  maximum_percentage: percentage,
});
const schemeInput = z.object({
  term_id: uuid,
  class_section_id: uuid,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  absence_treatment: z.enum(["incomplete", "zero"]).default("incomplete"),
  review_mode: z.enum(["owner_review", "independent"]).default("independent"),
  bands: z.array(bandInput).min(1).max(30).optional(),
  grading_policy_id: uuid.nullable().default(null),
  programme_key: z.string().trim().min(2).max(80).transform(value => value.toUpperCase()).nullable().default(null),
  term_index: z.number().int().positive().max(100).nullable().default(null),
  idempotency_key: uuid.optional(),
}).superRefine((value, context) => {
  if (!value.grading_policy_id && !value.bands) context.addIssue({ code: "custom", path: ["bands"], message: "Choose a grading policy or configure legacy bands." });
  if ((value.programme_key === null) !== (value.term_index === null)) context.addIssue({ code: "custom", path: ["programme_key"], message: "Programme and term number must be provided together." });
});
const policyInput = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(32).transform(value => value.toUpperCase()),
  configuration: gradingPolicyConfigurationSchema, idempotency_key: uuid.optional() }).strict();
const componentInput = z.object({
  code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  weight_percentage: z.coerce.number().positive().max(100),
  assessment_ids: z.array(uuid).min(1).max(30),
});
const subjectPlanInput = z.object({
  subject_id: uuid,
  pass_percentage: percentage.nullable().default(null),
  expected_revision: z.coerce.number().int().positive(),
  idempotency_key: uuid.optional(),
  credits: z.number().finite().positive().max(1000).multipleOf(0.0001).nullable().default(null),
  course_code: z.string().trim().min(2).max(80).transform(value => value.toUpperCase()).nullable().default(null),
  components: z.array(componentInput).min(1).max(20),
});
const revisionInput = z.object({ expected_revision: z.coerce.number().int().positive(), note: z.string().trim().max(1000).default(""), idempotency_key: uuid.optional() });
const generateInput = z.object({ expected_revision: z.coerce.number().int().positive(), correction_reason: z.string().trim().max(500).default(""), idempotency_key: uuid.optional() });
export { schemeInput, subjectPlanInput, revisionInput, generateInput, commentInput, policyInput };
const commentInput = z.object({
  expected_revision: z.coerce.number().int().positive(),
  expected_batch_revision: z.coerce.number().int().positive().optional(),
  idempotency_key: uuid.optional(),
  class_teacher_comment: z.string().trim().max(1000).default(""),
  principal_comment: z.string().trim().max(1000).default(""),
});
const commentReceipt = z.object({ id: uuid, student_id: uuid, class_teacher_comment: z.string(), principal_comment: z.string(),
  comment_revision: z.number().int().positive(), batch_revision: z.number().int().positive() });

interface PublishedSource {
  assessment_id: string;
  publication_id: string;
  title: string;
  maximum_marks: number;
  scheduled_on: string | null;
  results: Map<string, { outcome: "scored" | "absent" | "exempt" | "withheld" | "not_evaluated"; marks: number | null; academic_roster_source: unknown }>;
}

interface AcademicReportEventContractInput {
  schoolId: string;
  batchId: string;
  schemeId: string;
  classSectionId: string;
  action: string;
  status: string;
  revision: number;
  audienceUserIds: string[];
}

interface FamilyReportProjection extends Record<string, unknown> { report_student_id: string; batch_id: string; gpa: string | null; cgpa: string | null; credit_total: string | null; credit_points: string | null; cumulative_credits: string | null; cumulative_credit_points: string | null; cumulative_sources: Array<GradingCreditCourse & { included: boolean; reason: string }>; }

interface CommandRefusal { grading_command_refusal: { response: string | Record<string, unknown>; status: number } }
const isRefusal = (value: unknown): value is CommandRefusal => Boolean(value && typeof value === "object" && "grading_command_refusal" in value);

export function academicReportUpdatedEvent(input: AcademicReportEventContractInput) {
  const refresh = ["academic-reports", "teacher.home", "principal.home"];
  if (input.action === "publish") refresh.push("notifications", "attention");
  return {
    schoolId: input.schoolId,
    eventType: "academic_report.updated" as const,
    aggregateType: "grading_report_batch",
    aggregateId: input.batchId,
    audienceUserIds: input.audienceUserIds,
    payload: {
      report_batch_id: input.batchId,
      scheme_id: input.schemeId,
      class_section_id: input.classSectionId,
      action: input.action,
      status: input.status,
      revision: input.revision,
      refresh,
    },
    idempotencyKey: `academic-report:${input.batchId}:${input.action}:${input.revision}`,
  };
}

@Injectable()
export class AcademicReportsService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService,
    @Optional() @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands?: DomainCommandGatewayPort,
    @Optional() @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts?: DomainCommandReceiptReadPort) {}

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException("Choose this institution before managing its grading policies.");
    const member = await db.selectFrom("school_memberships").innerJoin("users", "users.id", "school_memberships.user_id").select("school_memberships.id").where("school_memberships.school_id", "=", schoolId).where("school_memberships.user_id", "=", user.id).where("school_memberships.role", "=", "admin").where("school_memberships.is_active", "=", true).where("users.is_active", "=", true).forShare().executeTakeFirst();
    if (!member) throw new ForbiddenException("Institution administrator access is required.");
  }

  private unwrap<T>(value: T | CommandRefusal): T {
    if (isRefusal(value)) throw new HttpException(value.grading_command_refusal.response, value.grading_command_refusal.status);
    return value;
  }

  /** Every grading operation retains pre-write authority and command
   * evidence. Failure rolls back only native effects, retaining the refusal. */
  private async reportCommand<T extends object>(db: Transaction<Database>, user: AuthUser, schoolId: string,
    target: { id: string; kind: string; name: string; revision: number; currentRevision: number }, action: string,
    payload: Record<string, unknown>, effects: () => Promise<T>, configuration: GradingPolicySnapshot | null = null,
    commentClassId?: string): Promise<T | CommandRefusal> {
    if (!this.commands || !this.receipts) throw new ConflictException("Grading coordination is unavailable. Try again after recovery.");
    const commentActor = commentClassId ? await this.classCommenter(user, schoolId, commentClassId, db) : null;
    if (!commentClassId) await this.principal(user, schoolId, db);
    const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const key = typeof payload.idempotency_key === "string" ? payload.idempotency_key
      : activityOccurrenceId(schoolId, "academic_reports", `${user.id}:${target.kind}:${target.id}:${action}`, `${target.revision}:${requestHash}`);
    const retained = await this.receipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id,
      source_domain: "academic_reports", handler_key: `academic_reports.${action}`, handler_version: 1, idempotency_key: `grading:${user.id}:${key}` });
    if (retained) {
      if (retained.safe_context.request_hash !== requestHash || retained.target.kind !== target.kind || retained.target.domain_id !== target.id || retained.command_type !== `academic_reports.${action}` || retained.expected_revision !== target.revision) throw new ConflictException("This grading request key was already used for different work.");
      if (retained.state === "pending") throw new ConflictException("This grading action is awaiting confirmation. Refresh before retrying.");
      if (isRefusal(retained.receipt.metadata.result)) return retained.receipt.metadata.result;
      if (retained.receipt.terminal_state !== "accepted" || !retained.receipt.metadata.result) throw new ConflictException("This grading action needs recovery before retrying.");
      return retained.receipt.metadata.result as T;
    }
    const prepared = await this.commands.prepareDomainCommand(db, {
      school_id: schoolId, actor_user_id: user.id, command_type: `academic_reports.${action}`,
      handler_key: `academic_reports.${action}`, handler_version: 1, source_domain: "academic_reports",
      target: { kind: target.kind, domain: "academic_reports", domain_id: target.id, label: target.name, lifecycle_state: "active", source_revision: Math.max(1, target.currentRevision), metadata: {} },
      current_revision: target.currentRevision, expected_revision: target.revision, capability: commentClassId ? "reports.comment" : "academic_reports.manage", purpose: `academic_reports_${action.replaceAll(".", "_")}`,
      requested_at: executionNow().toISOString(), correlation_id: key, causation_id: null,
      idempotency_key: `grading:${user.id}:${key}`, operating_rule_version_ref: null,
      configuration_refs: configuration ? [{ kind: "grading_policy", ref: configuration.policy_id, version: String(configuration.version) }] : [],
      authority_attestation: { evaluator_domain: "academic_reports", decision: "allowed", reason_codes: [commentActor === "class_teacher" ? "current_assigned_class_commenter" : "current_institution_administrator"], authority_source_refs: [{ school_id: schoolId, user_id: user.id, role: commentActor ?? "admin", ...(commentClassId ? { class_section_id: commentClassId } : {}) }], operating_rule_refs: [], valid_until: null },
      safe_context: { request_hash: requestHash, source_id: target.id, action },
    });
    if (prepared.status === "completed") {
      if (isRefusal(prepared.metadata.result)) return prepared.metadata.result;
      if (prepared.terminal_state !== "accepted" || !prepared.metadata.result) throw new ConflictException("This grading action needs recovery before retrying.");
      return prepared.metadata.result as T;
    }
    await sql`SAVEPOINT academic_report_effects`.execute(db);
    try {
      const result = await effects();
      const retained = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
      const aggregateId = action === "report.remarks" ? retained.batch_id : retained.id;
      const domainEvent = typeof aggregateId === "string" && action.startsWith("report.")
        ? await db.selectFrom("event_outbox").select("id").where("school_id", "=", schoolId).where("aggregate_id", "=", aggregateId)
          .where("event_type", "=", "academic_report.updated").orderBy("sequence", "desc").executeTakeFirst() : undefined;
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: "grading_action_accepted",
        explanation: "The grading domain accepted this authorized operation.", resulting_revision: typeof retained.revision === "number" ? retained.revision : typeof retained.comment_revision === "number" ? retained.comment_revision : target.revision,
        domain_event_id: domainEvent?.id ?? null, metadata: { result: retained }, completed_at: executionNow().toISOString() });
      await sql`RELEASE SAVEPOINT academic_report_effects`.execute(db);
      return result;
    } catch (error) {
      if (!(error instanceof HttpException) || ![400, 403, 409, 422].includes(error.getStatus())) throw error;
      await sql`ROLLBACK TO SAVEPOINT academic_report_effects`.execute(db);
      const refusal: CommandRefusal = { grading_command_refusal: { response: error.getResponse() as string | Record<string, unknown>, status: error.getStatus() } };
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: error.getStatus() === 409 ? "conflicted" : "rejected", code: "grading_action_refused",
        explanation: error.message.slice(0, 500), resulting_revision: null, domain_event_id: null, metadata: { result: refusal }, completed_at: executionNow().toISOString() });
      await sql`RELEASE SAVEPOINT academic_report_effects`.execute(db);
      return refusal;
    }
  }

  private policySnapshot(value: unknown): GradingPolicySnapshot | null {
    if (value === null || value === undefined) return null;
    const parsed = gradingPolicySnapshotSchema.safeParse(value);
    if (!parsed.success) throw new ConflictException("The frozen grading policy is unavailable or invalid. Restore its reviewed configuration before continuing.");
    return parsed.data;
  }

  async listPolicies(user: AuthUser, schoolId: string) {
    uuid.parse(schoolId);
    const member = await this.db.selectFrom("school_memberships").select("role").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).orderBy(sql<number>`CASE WHEN role='admin' THEN 0 ELSE 1 END`).executeTakeFirst();
    if (!member || !["admin", "staff"].includes(member.role)) throw new ForbiddenException("Staff access is required.");
    let query = this.db.selectFrom("academic_grading_policies").selectAll().where("school_id", "=", schoolId);
    if (member.role !== "admin") query = query.where("status", "=", "active");
    return { policies: await query.orderBy("code").orderBy("version", "desc").execute() };
  }

  async createPolicy(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = policyInput.parse(body);
    // The optional key makes response-loss retries repeat-safe. A deliberate new
    // POST without a key creates the next policy version.
    const commandKey = data.idempotency_key ?? randomUUID();
    const result = await this.db.transaction().execute(async db => {
      await this.principal(user, schoolId, db);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:grading-policy:${data.code}`},0))`.execute(db);
      return this.reportCommand(db, user, schoolId, { id: `${schoolId}:${data.code}`, kind: "grading_policy_series", name: data.name, revision: 0, currentRevision: 0 }, "policy.create", { ...data, idempotency_key: commandKey }, async () => {
        const current = await db.selectFrom("academic_grading_policies").select(sql<number>`COALESCE(max(version),0)::int`.as("version")).where("school_id", "=", schoolId).where("code", "=", data.code).executeTakeFirstOrThrow();
        const policy = await db.insertInto("academic_grading_policies").values({ school_id: schoolId, code: data.code, version: current.version + 1, name: data.name, configuration: data.configuration, created_by: user.id }).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, null, null, "grading.policy.created", null, "draft", { policy_id: policy.id, code: policy.code, version: policy.version });
        return policy;
      });
    });
    return this.unwrap(result);
  }

  async activatePolicy(user: AuthUser, schoolId: string, policyId: string, body: unknown) {
    await this.principal(user, schoolId); uuid.parse(policyId);
    const data = revisionInput.parse(body);
    const result = await this.db.transaction().execute(async db => {
      await this.principal(user, schoolId, db);
      const policy = await db.selectFrom("academic_grading_policies").selectAll().where("school_id", "=", schoolId).where("id", "=", policyId).forUpdate().executeTakeFirst();
      if (!policy) throw new NotFoundException("Grading policy not found.");
      return this.reportCommand(db, user, schoolId, { id: policy.id, kind: "grading_policy", name: policy.name, revision: data.expected_revision, currentRevision: policy.revision }, "policy.activate", data, async () => {
        if (policy.status !== "draft" || policy.revision !== data.expected_revision) throw new ConflictException("This policy changed. Refresh before activating it.");
        gradingPolicyConfigurationSchema.parse(policy.configuration);
        const updated = await db.updateTable("academic_grading_policies").set({ status: "active", revision: policy.revision + 1, activated_by: user.id, activated_at: executionNow() }).where("id", "=", policy.id).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, null, null, "grading.policy.activated", "draft", "active", { policy_id: policy.id, version: policy.version, note: data.note });
        return updated;
      });
    });
    return this.unwrap(result);
  }

  private async classCommenter(user: AuthUser, schoolId: string, classSectionId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException("Choose this institution before editing its reports.");
    const memberships = await db.selectFrom("school_memberships").innerJoin("users", "users.id", "school_memberships.user_id")
      .select("school_memberships.role").where("school_memberships.school_id", "=", schoolId).where("school_memberships.user_id", "=", user.id)
      .where("school_memberships.is_active", "=", true).where("users.is_active", "=", true).forShare().execute();
    if (memberships.some(member => member.role === "admin")) return "admin" as const;
    if (!memberships.some(member => member.role === "staff")) throw new ForbiddenException("Current staff access is required to edit report remarks.");
    await schoolPermission(db, user, schoolId, "reports.comment");
    const assignment = await hasScopedSchoolPermission(db,user.id,schoolId,"reports.comment","class",classSectionId);
    if (!assignment) throw new ForbiddenException("Only the assigned class teacher can add report remarks.");
    return "class_teacher" as const;
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, schemeId: string | null, batchId: string | null, action: string, fromStatus: string | null, toStatus: string | null, metadata: Record<string, unknown> = {}) {
    return db.insertInto("grading_report_audits").values({ school_id: schoolId, scheme_id: schemeId, batch_id: batchId, actor_id: user.id, action, from_status: fromStatus, to_status: toStatus, metadata }).returning("id").executeTakeFirstOrThrow();
  }

  private async eventAudience(db: Db, schoolId: string, classSectionId: string, batchId: string, includeFamily: boolean) {
    const staff = (await sql<{ user_id: string }>`
      SELECT membership.user_id FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.role='admin' AND membership.is_active
      UNION
      SELECT binding.user_id FROM staff_role_bindings binding
      JOIN school_memberships membership ON membership.school_id=binding.school_id
        AND membership.user_id=binding.user_id AND membership.role='staff' AND membership.is_active
      JOIN users account ON account.id=binding.user_id AND account.is_active
      WHERE binding.school_id=${schoolId}::uuid AND binding.context_kind='class'
        AND binding.scope_id=${classSectionId}::uuid AND binding.role_active AND binding.status='active'
        AND 'reports.comment'=ANY(binding.permissions) AND binding.starts_on<=CURRENT_DATE
        AND (binding.ends_on IS NULL OR binding.ends_on>=CURRENT_DATE)
    `.execute(db)).rows.map((row) => row.user_id);
    if (!includeFamily) return staff;
    const family = (await sql<{ user_id: string }>`
      SELECT student.user_id FROM grading_report_students report
      JOIN students student ON student.id=report.student_id AND student.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=report.school_id
        AND membership.user_id=student.user_id AND membership.role='student' AND membership.is_active
      JOIN users account ON account.id=student.user_id AND account.is_active
      WHERE report.school_id=${schoolId}::uuid AND report.batch_id=${batchId}::uuid
      UNION
      SELECT parent.user_id FROM grading_report_students report
      JOIN guardian_relationships relationship ON relationship.school_id=report.school_id AND relationship.student_id=report.student_id
      JOIN parents parent ON parent.id=relationship.guardian_id AND parent.user_id IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=report.school_id
        AND membership.user_id=parent.user_id AND membership.role='guardian' AND membership.is_active
      JOIN users account ON account.id=parent.user_id AND account.is_active
      WHERE report.school_id=${schoolId}::uuid AND report.batch_id=${batchId}::uuid
    `.execute(db)).rows.map((row) => row.user_id);
    return [...new Set([...staff, ...family])];
  }

  private async emitUpdated(
    db: Db,
    batch: { id: string; school_id: string; scheme_id: string; status: string; revision: number },
    classSectionId: string,
    action: string,
    includeFamily = false,
  ) {
    const audienceUserIds = await this.eventAudience(db,batch.school_id,classSectionId,batch.id,includeFamily);
    await this.events.enqueueUserEvent(db, academicReportUpdatedEvent({
      schoolId: batch.school_id,
      batchId: batch.id,
      schemeId: batch.scheme_id,
      classSectionId,
      action,
      status: batch.status,
      revision: batch.revision,
      audienceUserIds,
    }));
  }

  private validateBands(bands: Array<z.infer<typeof bandInput>>) {
    const sorted = [...bands].sort((left, right) => left.minimum_percentage - right.minimum_percentage);
    if (sorted[0]!.minimum_percentage !== 0 || sorted.at(-1)!.maximum_percentage !== 100) throw new BadRequestException("Grade bands must cover 0 through 100.");
    const codes = new Set<string>();
    for (let index = 0; index < sorted.length; index += 1) {
      const band = sorted[index]!;
      if (band.maximum_percentage < band.minimum_percentage) throw new BadRequestException("A grade band cannot end before it starts.");
      if (codes.has(band.code)) throw new BadRequestException("Grade band codes must be unique.");
      codes.add(band.code);
      if (index > 0 && Math.abs(band.minimum_percentage - (sorted[index - 1]!.maximum_percentage + 0.01)) > 0.001) throw new BadRequestException("Grade bands cannot overlap or leave gaps.");
    }
    return sorted;
  }

  private gradeFor(bands: Array<{ code: string; minimum_percentage: string; maximum_percentage: string }>, value: number) {
    value = roundGradeValue(value, 2);
    return bands.find((band) => value >= Number(band.minimum_percentage) - 0.0001 && value <= Number(band.maximum_percentage) + 0.0001)?.code ?? "";
  }

  async workspace(user: AuthUser, schoolId: string) {
    uuid.parse(schoolId);
    const membership = await this.db.selectFrom("school_memberships").select("role").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).orderBy(sql<number>`CASE WHEN role='admin' THEN 0 ELSE 1 END`).executeTakeFirst();
    if (!membership || !["admin", "staff"].includes(membership.role)) throw new ForbiddenException("Staff access is required.");
    const admin = membership.role === "admin";
    if (!admin) await schoolPermission(this.db, user, schoolId, "reports.comment");
    const classScope = admin ? sql`` : sql`AND EXISTS(SELECT 1 FROM staff_role_bindings mine WHERE mine.school_id=scheme.school_id AND mine.scope_id=scheme.class_section_id AND mine.context_kind='class' AND mine.user_id=${user.id}::uuid AND mine.role_active AND mine.status='active' AND 'reports.comment'=ANY(mine.permissions) AND mine.starts_on<=CURRENT_DATE AND (mine.ends_on IS NULL OR mine.ends_on>=CURRENT_DATE))`;
    const schemes = await sql`SELECT scheme.*,term.name AS term_name,term.academic_year,'Class '||section.grade||section.section AS class_name,
      (SELECT count(*)::int FROM grading_scheme_subjects subject_plan WHERE subject_plan.scheme_id=scheme.id) AS subject_count,
      (SELECT count(*)::int FROM grading_report_batches batch WHERE batch.scheme_id=scheme.id) AS report_count
      FROM grading_schemes scheme JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE scheme.school_id=${schoolId}::uuid ${classScope} ORDER BY term.starts_on DESC,section.grade,section.section,scheme.created_at DESC`.execute(this.db);
    const batches = await sql`SELECT batch.*,scheme.name AS scheme_name,scheme.review_mode,'Class '||section.grade||section.section AS class_name,term.name AS term_name,
      count(student.id)::int AS learner_count,count(student.id) FILTER(WHERE student.outcome='incomplete')::int AS incomplete_count
      FROM grading_report_batches batch JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      LEFT JOIN grading_report_students student ON student.batch_id=batch.id WHERE batch.school_id=${schoolId}::uuid ${classScope}
      GROUP BY batch.id,scheme.name,scheme.review_mode,section.grade,section.section,term.name ORDER BY batch.generated_at DESC`.execute(this.db);
    const { policies } = await this.listPolicies(user, schoolId);
    if (!admin) return { mode: "staff", schemes: schemes.rows, batches: batches.rows, policies };
    const [terms, classes, subjects, assessments] = await Promise.all([
      sql`SELECT id,name,academic_year,starts_on,ends_on FROM academic_terms WHERE school_id=${schoolId}::uuid AND is_active ORDER BY starts_on DESC`.execute(this.db),
      sql`SELECT id,'Class '||grade||section AS name,academic_year FROM class_sections WHERE school_id=${schoolId}::uuid ORDER BY academic_year DESC,grade,section`.execute(this.db),
      sql`SELECT id,name,color,icon FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(this.db),
      sql`SELECT assessment.id,assessment.title,assessment.subject_id,assessment.class_section_id,cycle.term_id,assessment.maximum_marks,
        COALESCE((SELECT max(sequence) FROM assessment_publications publication WHERE publication.assessment_id=assessment.id),0)::int AS publication_sequence
        FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
        WHERE assessment.school_id=${schoolId}::uuid AND assessment.status='published' ORDER BY assessment.scheduled_at,assessment.title`.execute(this.db),
    ]);
    return { mode: "admin", schemes: schemes.rows, batches: batches.rows, policies, references: { terms: terms.rows, classes: classes.rows, subjects: subjects.rows, assessments: assessments.rows } };
  }

  async schemeDetail(user: AuthUser, schoolId: string, schemeId: string) {
    await this.principal(user, schoolId);
    uuid.parse(schemeId);
    const scheme = (await sql`SELECT scheme.*,term.name AS term_name,term.academic_year,'Class '||section.grade||section.section AS class_name
      FROM grading_schemes scheme JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE scheme.school_id=${schoolId}::uuid AND scheme.id=${schemeId}::uuid`.execute(this.db)).rows[0];
    if (!scheme) throw new NotFoundException("Grading scheme not found.");
    this.policySnapshot((scheme as Record<string, unknown>).result_policy);
    const bands = await this.db.selectFrom("grading_scheme_bands").selectAll().where("school_id", "=", schoolId).where("scheme_id", "=", schemeId).orderBy("display_order").execute();
    const subjects = await sql`SELECT plan.*,subject.name AS subject_name,subject.color,subject.icon FROM grading_scheme_subjects plan JOIN subjects subject ON subject.id=plan.subject_id WHERE plan.scheme_id=${schemeId}::uuid ORDER BY plan.display_order,subject.name`.execute(this.db);
    const components = await sql`SELECT component.*,array_agg(mapping.assessment_id ORDER BY assessment.scheduled_at,assessment.title) AS assessment_ids,
      array_agg(assessment.title ORDER BY assessment.scheduled_at,assessment.title) AS assessment_titles
      FROM grading_components component JOIN grading_component_assessments mapping ON mapping.component_id=component.id JOIN assessments assessment ON assessment.id=mapping.assessment_id
      WHERE component.school_id=${schoolId}::uuid AND component.scheme_subject_id IN(SELECT id FROM grading_scheme_subjects WHERE scheme_id=${schemeId}::uuid)
      GROUP BY component.id ORDER BY component.scheme_subject_id,component.display_order`.execute(this.db);
    return { scheme, bands, subjects: subjects.rows, components: components.rows };
  }

  async createScheme(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = schemeInput.parse(body);
    const result = await this.db.transaction().execute(async db => {
      await this.principal(user, schoolId, db);
      const term = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.term_id).where("school_id", "=", schoolId).executeTakeFirst();
      const section = await db.selectFrom("class_sections").selectAll().where("id", "=", data.class_section_id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!term || !section || term.academic_year !== section.academic_year) throw new BadRequestException("Choose a class and term from the same academic year.");
      let snapshot: GradingPolicySnapshot | null = null;
      if (data.grading_policy_id) {
        const policy = await db.selectFrom("academic_grading_policies").selectAll().where("school_id", "=", schoolId).where("id", "=", data.grading_policy_id).where("status", "=", "active").executeTakeFirst();
        if (!policy) throw new BadRequestException("Choose an active grading policy in this institution.");
        const configuration = gradingPolicyConfigurationSchema.parse(policy.configuration);
        snapshot = { policy_id: policy.id, code: policy.code, name: policy.name, version: policy.version, configuration, semantic_fingerprint: policySemanticFingerprint(configuration) };
        if (configuration.result_format === "gpa" && (!data.programme_key || !data.term_index)) throw new BadRequestException("GPA reports require a programme cohort key and positive term number.");
      } else if (data.programme_key) throw new BadRequestException("Cumulative programme reporting requires a GPA grading policy.");
      if (snapshot?.configuration.result_format !== "gpa" && data.programme_key) throw new BadRequestException("Only GPA schemes use a programme and term number.");
      const bands = snapshot?.configuration.bands ?? this.validateBands(data.bands!);
      const effects = async () => {
        let scheme;
        try {
          scheme = await db.insertInto("grading_schemes").values({ school_id: schoolId, term_id: data.term_id, class_section_id: data.class_section_id, name: data.name, code: data.code,
            absence_treatment: snapshot?.configuration.absence_treatment ?? data.absence_treatment, review_mode: data.review_mode,
            grading_policy_id: data.grading_policy_id, result_policy: snapshot, programme_key: data.programme_key, term_index: data.term_index,
            created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
        } catch (error) {
          if ((error as { code?: string }).code === "23505") throw new ConflictException("This grading scheme code is already used for the class and term.");
          throw error;
        }
        await db.insertInto("grading_scheme_bands").values(bands.map((band, index) => ({ school_id: schoolId, scheme_id: scheme.id, code: band.code, label: band.label, minimum_percentage: String(band.minimum_percentage), maximum_percentage: String(band.maximum_percentage), display_order: index + 1 }))).execute();
        await this.audit(db, user, schoolId, scheme.id, null, "grading.scheme.created", null, "draft", { bands: bands.length, policy_id: data.grading_policy_id });
        return scheme;
      };
      return this.reportCommand(db, user, schoolId, { id: `${data.term_id}:${data.class_section_id}:${data.code}`, kind: "grading_scheme", name: data.name, revision: 0, currentRevision: 0 }, "scheme.create", data, effects, snapshot);
    });
    return this.unwrap(result);
  }

  async saveSubjectPlan(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId);
    uuid.parse(schemeId);
    const data = subjectPlanInput.parse(body);
    const componentTotal = data.components.reduce((total, component) => total + component.weight_percentage, 0);
    if (Math.abs(componentTotal - 100) > 0.001) throw new BadRequestException("Subject component weights must total 100%.");
    const assessmentIds = data.components.flatMap((component) => component.assessment_ids);
    if (new Set(assessmentIds).size !== assessmentIds.length) throw new BadRequestException("An assessment can be used in only one component.");
    const result = await this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      const snapshot = this.policySnapshot(scheme.result_policy);
      const needsCredits = snapshot?.configuration.result_format === "gpa" || snapshot?.configuration.aggregation === "credit_weighted";
      if (needsCredits && (!data.credits || !data.course_code)) throw new BadRequestException("Provide positive credits and a stable course code for this subject.");
      if (data.course_code && await db.selectFrom("grading_scheme_subjects").select("id").where("scheme_id", "=", schemeId).where("course_code", "=", data.course_code).where("subject_id", "!=", data.subject_id).executeTakeFirst()) throw new BadRequestException("A course code can appear only once in a term report.");
      const effects = async () => {
      if (scheme.status !== "draft") throw new ConflictException("Active grading schemes cannot be edited. Create a new scheme version instead.");
      if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before saving.");
      const subject = await db.selectFrom("subjects").select("id").where("id", "=", data.subject_id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!subject) throw new BadRequestException("Choose a subject in this institution.");
      const eligible = await sql<{ id: string }>`SELECT assessment.id FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
        WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=ANY(${assessmentIds}::uuid[]) AND assessment.class_section_id=${scheme.class_section_id}::uuid
          AND cycle.term_id=${scheme.term_id}::uuid AND assessment.subject_id=${data.subject_id}::uuid AND assessment.status='published'
          AND EXISTS(SELECT 1 FROM assessment_publications publication WHERE publication.assessment_id=assessment.id)`.execute(db);
      if (eligible.rows.length !== assessmentIds.length) throw new BadRequestException("Every mapped assessment must be published for this class, term and subject.");
      const existing = await db.selectFrom("grading_scheme_subjects").select("id").where("scheme_id", "=", schemeId).where("subject_id", "=", data.subject_id).executeTakeFirst();
      if (existing) await db.deleteFrom("grading_scheme_subjects").where("id", "=", existing.id).execute();
      const displayOrder = (await sql<{ next: number }>`SELECT COALESCE(max(display_order),0)+1 AS next FROM grading_scheme_subjects WHERE scheme_id=${schemeId}::uuid`.execute(db)).rows[0]!.next;
      const plan = await db.insertInto("grading_scheme_subjects").values({ school_id: schoolId, scheme_id: schemeId, subject_id: data.subject_id, pass_percentage: snapshot ? null : data.pass_percentage === null ? null : String(data.pass_percentage), credits: data.credits === null ? null : String(data.credits), course_code: data.course_code, display_order: displayOrder }).returningAll().executeTakeFirstOrThrow();
      for (const [index, component] of data.components.entries()) {
        const row = await db.insertInto("grading_components").values({ school_id: schoolId, scheme_subject_id: plan.id, code: component.code, name: component.name, weight_percentage: String(component.weight_percentage), display_order: index + 1 }).returningAll().executeTakeFirstOrThrow();
        await db.insertInto("grading_component_assessments").values(component.assessment_ids.map((assessmentId) => ({ school_id: schoolId, component_id: row.id, assessment_id: assessmentId }))).execute();
      }
      const updated = await db.updateTable("grading_schemes").set({ revision: scheme.revision + 1, updated_by: user.id, updated_at: executionNow() }).where("id", "=", schemeId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, schemeId, null, "grading.subject.saved", "draft", "draft", { subject_id: data.subject_id, components: data.components.length });
      return updated;
      };
      return this.reportCommand(db, user, schoolId, { id: scheme.id, kind: "grading_scheme", name: scheme.name, revision: data.expected_revision, currentRevision: scheme.revision }, "subject.save", data, effects, snapshot);
    });
    return this.unwrap(result);
  }

  async activateScheme(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = revisionInput.parse(body);
    const result = await this.db.transaction().execute(async db => {
      await this.principal(user, schoolId, db);
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      const snapshot = this.policySnapshot(scheme.result_policy);
      const effects = async () => {
        if (scheme.status !== "draft") throw new ConflictException("Only a draft grading scheme can be activated.");
        if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before activating.");
        // Aggregate component weights before joining their many assessment links.
        const plans = await sql<{ id: string; weight: string; mappings: number; unmapped: number; credits: string | null; course_code: string | null }>`SELECT plan.id,plan.credits,plan.course_code,
          (SELECT COALESCE(sum(component.weight_percentage),0) FROM grading_components component WHERE component.scheme_subject_id=plan.id)::numeric AS weight,
          (SELECT count(*)::int FROM grading_components component JOIN grading_component_assessments mapping ON mapping.component_id=component.id WHERE component.scheme_subject_id=plan.id) AS mappings,
          (SELECT count(*)::int FROM grading_components component WHERE component.scheme_subject_id=plan.id AND NOT EXISTS(SELECT 1 FROM grading_component_assessments mapping WHERE mapping.component_id=component.id)) AS unmapped
          FROM grading_scheme_subjects plan WHERE plan.scheme_id=${schemeId}::uuid`.execute(db);
        if (!plans.rows.length) throw new BadRequestException("Add at least one subject grading plan.");
        if (plans.rows.some(plan => Math.abs(Number(plan.weight) - 100) > 0.001 || plan.mappings < 1 || plan.unmapped)) throw new BadRequestException("Every subject needs mapped components totalling 100%.");
        if (snapshot && (snapshot.configuration.result_format === "gpa" || snapshot.configuration.aggregation === "credit_weighted") && plans.rows.some(plan => !plan.credits || !plan.course_code)) throw new BadRequestException("Every subject needs credits and a stable course code.");
        const updated = await db.updateTable("grading_schemes").set({ status: "active", revision: scheme.revision + 1, activated_by: user.id, activated_at: executionNow(), updated_by: user.id, updated_at: executionNow() }).where("id", "=", schemeId).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, schemeId, null, "grading.scheme.activated", "draft", "active", { note: data.note });
        return updated;
      };
      return this.reportCommand(db, user, schoolId, { id: scheme.id, kind: "grading_scheme", name: scheme.name, revision: data.expected_revision, currentRevision: scheme.revision }, "scheme.activate", data, effects, snapshot);
    });
    return this.unwrap(result);
  }

  private async publishedSources(db: Db, schoolId: string, assessmentIds: string[]) {
    const sources = new Map<string, PublishedSource>();
    for (const assessmentId of assessmentIds) {
      const publication = (await sql<{ id: string; title: string; maximum_marks: string; scheduled_on: string | null }>`SELECT publication.id,assessment.title,assessment.maximum_marks,
          COALESCE(publication.academic_context->>'assessment_on',(assessment.scheduled_at AT TIME ZONE school.timezone)::date::text) AS scheduled_on FROM assessment_publications publication
        JOIN assessments assessment ON assessment.id=publication.assessment_id JOIN schools school ON school.id=assessment.school_id
        WHERE publication.school_id=${schoolId}::uuid AND publication.assessment_id=${assessmentId}::uuid
        ORDER BY publication.sequence DESC LIMIT 1`.execute(db)).rows[0];
      if (!publication) throw new BadRequestException("Every mapped assessment needs a published result.");
      const rows = await db.selectFrom("assessment_publication_results").select(["student_id", "outcome", "marks", "academic_roster_source"]).where("school_id", "=", schoolId).where("publication_id", "=", publication.id).execute();
      sources.set(assessmentId, { assessment_id: assessmentId, publication_id: publication.id, title: publication.title, maximum_marks: Number(publication.maximum_marks),scheduled_on:publication.scheduled_on,
        results: new Map(rows.map((row) => [row.student_id, { outcome: row.outcome, marks: row.marks === null ? null : Number(row.marks),academic_roster_source:row.academic_roster_source }])) });
    }
    return sources;
  }

  private async cumulativeHistory(db: Db, schoolId: string, studentId: string, programmeKey: string, termIndex: number, policy: GradingPolicySnapshot) {
    const prior = (await sql<{ term_index: number; scheme_id: string; batch_id: string; report_student_id: string; result_policy: unknown }>`SELECT scheme.term_index,scheme.id AS scheme_id,batch.id AS batch_id,report.id AS report_student_id,batch.result_policy
      FROM grading_report_students report JOIN grading_report_batches batch ON batch.id=report.batch_id AND batch.status='published'
      JOIN grading_schemes scheme ON scheme.id=batch.scheme_id
      WHERE report.school_id=${schoolId}::uuid AND report.student_id=${studentId}::uuid
        AND scheme.programme_key=${programmeKey} AND scheme.term_index<${termIndex}
      ORDER BY scheme.term_index,batch.published_at DESC,batch.sequence DESC,batch.id`.execute(db)).rows;
    const latest = new Map<number, typeof prior[number]>();
    const schemes = new Map<number, Set<string>>();
    for (const row of prior) {
      if (!latest.has(row.term_index)) latest.set(row.term_index, row);
      const choices = schemes.get(row.term_index) ?? new Set<string>(); choices.add(row.scheme_id); schemes.set(row.term_index, choices);
    }
    let reason: string | null = null;
    for (let index = 1; index < termIndex; index += 1) if (!latest.has(index)) reason = "missing_prior_terms";
    if ([...schemes.values()].some(choices => choices.size > 1)) reason = "ambiguous_prior_terms";
    for (const row of latest.values()) {
      const previousPolicy = this.policySnapshot(row.result_policy);
      if (!previousPolicy || previousPolicy.semantic_fingerprint !== policy.semantic_fingerprint) reason = "incompatible_policy";
    }
    const courses: GradingCreditCourse[] = [];
    for (const row of latest.values()) {
      const subjects = await db.selectFrom("grading_report_subjects").selectAll().where("school_id", "=", schoolId).where("batch_id", "=", row.batch_id).where("report_student_id", "=", row.report_student_id).execute();
      for (const subject of subjects) {
        if (!subject.course_code || !subject.credits) { reason = "incompatible_policy"; continue; }
        courses.push({ course_code: subject.course_code, credits: Number(subject.credits), grade_points: subject.grade_points === null ? null : Number(subject.grade_points),
          percentage: subject.percentage === null ? null : Number(subject.percentage), passed: subject.passed, outcome: subject.outcome,
          term_index: row.term_index, batch_id: row.batch_id, report_student_id: row.report_student_id, report_subject_id: subject.id });
      }
    }
    return { courses, reason };
  }

  async generateReport(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId); uuid.parse(schemeId);
    const data = generateInput.parse(body);
    const result = await this.db.transaction().execute(async db => {
      await this.principal(user, schoolId, db);
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      const policy = this.policySnapshot(scheme.result_policy);
      if (policy?.configuration.result_format === "gpa" && (!scheme.programme_key || !scheme.term_index)) throw new ConflictException("This GPA scheme is missing its programme cohort or term number.");
      if (policy?.configuration.result_format === "gpa") await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:grading-programme:${scheme.programme_key}`},0))`.execute(db);
      const effects = async () => {
        if (scheme.status !== "active") throw new ConflictException("Activate the grading scheme before generating reports.");
        if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before generating reports.");
        const sequence = Number((await sql<{ next: number }>`SELECT COALESCE(max(sequence),0)+1 AS next FROM grading_report_batches WHERE scheme_id=${schemeId}::uuid`.execute(db)).rows[0]!.next);
        if (sequence > 1 && data.correction_reason.length < 3) throw new BadRequestException("Add a reason for the corrected report release.");
        const bands = await db.selectFrom("grading_scheme_bands").selectAll().where("scheme_id", "=", schemeId).orderBy("display_order").execute();
        const plans = await db.selectFrom("grading_scheme_subjects").selectAll().where("scheme_id", "=", schemeId).orderBy("display_order").execute();
        if (!plans.length) throw new BadRequestException("The grading scheme has no subject plans.");
        if (policy && (policy.configuration.result_format === "gpa" || policy.configuration.aggregation === "credit_weighted") && plans.some(plan => !plan.course_code || !plan.credits || !Number.isFinite(Number(plan.credits)) || Number(plan.credits) <= 0)) throw new ConflictException("This grading scheme has a subject without valid course credits.");
        const components = await db.selectFrom("grading_components").selectAll().where("scheme_subject_id", "in", plans.map(plan => plan.id)).orderBy("display_order").execute();
        const mappings = await db.selectFrom("grading_component_assessments").selectAll().where("component_id", "in", components.map(component => component.id)).execute();
        const sources = await this.publishedSources(db, schoolId, [...new Set(mappings.map(mapping => mapping.assessment_id))]);
        const roster = await publishedAcademicRoster(db,schoolId,schemeId,[...sources.values()]);
        if (!roster.length) throw new BadRequestException("The selected published assessments have no learner results.");
        const previousBatch=await db.selectFrom("grading_report_batches").select("academic_context").where("school_id","=",schoolId).where("scheme_id","=",schemeId).orderBy("sequence","desc").executeTakeFirst();
        const academicContext=previousBatch?.academic_context ?? await captureAcademicContext(db,schoolId,scheme.class_section_id,scheme.term_id);
        const fingerprint = createHash("sha256").update(JSON.stringify({ scheme_revision: scheme.revision, policy,
          publications: [...sources.values()].map(source => [source.assessment_id, source.publication_id]).sort(),academic_context:academicContext,roster })).digest("hex");
        const batch = await db.insertInto("grading_report_batches").values({ school_id: schoolId, scheme_id: schemeId, sequence, source_scheme_revision: scheme.revision, source_fingerprint: fingerprint, correction_reason: data.correction_reason, generated_by: user.id, result_policy: policy,
          academic_context:sql`${JSON.stringify(academicContext)}::jsonb` }).returningAll().executeTakeFirstOrThrow();
        const cumulativeEvidence: unknown[] = [];
        for (const learner of roster) {
          const subjects = plans.map(plan => {
            const componentSnapshots = components.filter(component => component.scheme_subject_id === plan.id).map(component => {
              const sourceRows = mappings.filter(mapping => mapping.component_id === component.id).map(mapping => ({ source: sources.get(mapping.assessment_id)!, result: sources.get(mapping.assessment_id)!.results.get(learner.student_id) }));
              let incomplete = false; let exemptCount = 0; let withheld = false;
              const values: number[] = [];
              for (const row of sourceRows) {
                if (row.result?.outcome === "withheld") withheld = true;
                if (!row.result || ["withheld", "not_evaluated"].includes(row.result.outcome)) incomplete = true;
                else if (row.result.outcome === "exempt") exemptCount += 1;
                else if (row.result.outcome === "absent") {
                  if ((policy?.configuration.absence_treatment ?? scheme.absence_treatment) === "zero") values.push(0); else incomplete = true;
                } else if (row.result.outcome === "scored" && row.result.marks !== null) values.push(row.result.marks / row.source.maximum_marks * 100);
              }
              if (incomplete || !sourceRows.length) return { component, outcome: "incomplete" as const, percentage: null, weightedPoints: null, sourceRows, withheld };
              if (!values.length && exemptCount === sourceRows.length) return { component, outcome: "exempt" as const, percentage: null, weightedPoints: null, sourceRows, withheld };
              const value = values.reduce((sum, item) => sum + item, 0) / values.length;
              return { component, outcome: "complete" as const, percentage: value, weightedPoints: value * Number(component.weight_percentage) / 100, sourceRows, withheld };
            });
            let outcome: "complete" | "incomplete" | "exempt" | "withheld" = "complete";
            let value: number | null = null;
            if (policy && componentSnapshots.some(component => component.withheld)) outcome = "withheld";
            else if (componentSnapshots.some(component => component.outcome === "incomplete")) outcome = "incomplete";
            else {
              const complete = componentSnapshots.filter(component => component.outcome === "complete");
              if (!complete.length) outcome = "exempt";
              else {
                const activeWeight = complete.reduce((sum, component) => sum + Number(component.component.weight_percentage), 0);
                value = roundGradeValue(complete.reduce((sum, component) => sum + (component.weightedPoints ?? 0), 0) * 100 / activeWeight, 2);
              }
            }
            const calculated = value === null || !policy ? null : evaluatePolicyPercentage(policy.configuration, value);
            return { id: randomUUID(), plan, outcome, percentage: value, grade: calculated?.grade ?? (value === null ? "" : this.gradeFor(bands, value)),
              grade_points: calculated?.grade_points ?? null, passed: calculated?.passed ?? (value !== null && plan.pass_percentage !== null ? value >= Number(plan.pass_percentage) : null), componentSnapshots };
          });
          const completed = subjects.filter(subject => subject.outcome === "complete" && subject.percentage !== null);
          const learnerOutcome = subjects.some(subject => subject.outcome === "withheld") ? "withheld" as const : subjects.some(subject => subject.outcome === "incomplete") || !completed.length ? "incomplete" as const : "complete" as const;
          const weighted = policy?.configuration.aggregation === "credit_weighted";
          const denominator = completed.reduce((sum, subject) => sum + (weighted ? Number(subject.plan.credits) : 1), 0);
          const overall = learnerOutcome === "complete" && denominator > 0 ? roundGradeValue(completed.reduce((sum, subject) => sum + subject.percentage! * (weighted ? Number(subject.plan.credits) : 1), 0) / denominator, 2) : null;
          const reportStudentId = randomUUID();
          const courses: GradingCreditCourse[] = subjects.map(subject => ({ course_code: subject.plan.course_code ?? subject.plan.subject_id,
            credits: Number(subject.plan.credits), grade_points: subject.grade_points, percentage: subject.percentage, passed: subject.passed, outcome: subject.outcome,
            term_index: scheme.term_index ?? 1, batch_id: batch.id, report_student_id: reportStudentId, report_subject_id: subject.id }));
          let gpa: number | null = null; let cgpa: number | null = null; let creditTotal: number | null = null; let creditPoints: number | null = null;
          let cumulativeCredits: number | null = null; let cumulativePoints: number | null = null;
          let gpaReason: string | null = null; let cgpaReason: string | null = null;
          let cumulativeSources: Array<GradingCreditCourse & { included: boolean; reason: string }> = [];
          if (policy?.configuration.result_format === "gpa") {
            const semester = calculateCreditGpa(policy.configuration, courses);
            gpa = semester.gpa; creditTotal = semester.credits; creditPoints = semester.credit_points; gpaReason = semester.unavailable_reason;
            const history = await this.cumulativeHistory(db, schoolId, learner.student_id, scheme.programme_key!, scheme.term_index!, policy);
            const attempts = [...history.courses, ...courses];
            let selected: GradingCreditCourse[] = [];
            try { selected = latestCourseAttempts(attempts); } catch { history.reason = "ambiguous_course_attempts"; }
            const selectedIds = new Set(selected.map(course => course.report_subject_id));
            cumulativeSources = attempts.map(course => ({ ...course, included: selectedIds.has(course.report_subject_id), reason: selectedIds.has(course.report_subject_id) ? "latest_attempt" : "superseded_attempt" }));
            const cumulative = calculateCreditGpa(policy.configuration, selected);
            cgpaReason = history.reason ?? cumulative.unavailable_reason;
            if (!history.reason) { cgpa = cumulative.gpa; cumulativeCredits = cumulative.credits; cumulativePoints = cumulative.credit_points; }
          }
          cumulativeEvidence.push({ student_id: learner.student_id, gpa, cgpa, credit_total: creditTotal, credit_points: creditPoints,
            cumulative_credits: cumulativeCredits, cumulative_credit_points: cumulativePoints, gpa_unavailable_reason: gpaReason, cgpa_unavailable_reason: cgpaReason,
            cumulative_sources: cumulativeSources });
          const reportStudent = await db.insertInto("grading_report_students").values({ id: reportStudentId, school_id: schoolId, batch_id: batch.id, student_id: learner.student_id,
            academic_roster_source:sql`${JSON.stringify(learner.academic_roster_source)}::jsonb`,
            outcome: learnerOutcome, overall_percentage: overall === null ? null : overall.toFixed(2),
            overall_grade: overall === null || policy?.configuration.result_format === "gpa" ? "" : policy ? evaluatePolicyPercentage(policy.configuration, overall).grade : this.gradeFor(bands, overall),
            gpa: gpa === null ? null : String(gpa), cgpa: cgpa === null ? null : String(cgpa), credit_total: creditTotal === null ? null : String(creditTotal), credit_points: creditPoints === null ? null : String(creditPoints),
            cumulative_credits: cumulativeCredits === null ? null : String(cumulativeCredits), cumulative_credit_points: cumulativePoints === null ? null : String(cumulativePoints), cumulative_sources: sql`${JSON.stringify(cumulativeSources)}::jsonb`,
            gpa_unavailable_reason: gpaReason, cgpa_unavailable_reason: cgpaReason }).returningAll().executeTakeFirstOrThrow();
          for (const subject of subjects) {
            const reportSubject = await db.insertInto("grading_report_subjects").values({ id: subject.id, school_id: schoolId, batch_id: batch.id, report_student_id: reportStudent.id,
              scheme_subject_id: subject.plan.id, subject_id: subject.plan.subject_id, outcome: subject.outcome, percentage: subject.percentage === null ? null : subject.percentage.toFixed(2),
              grade: subject.grade, policy_graded: Boolean(policy), pass_percentage: subject.plan.pass_percentage, passed: subject.passed, grade_points: subject.grade_points === null ? null : String(subject.grade_points), credits: subject.plan.credits, course_code: subject.plan.course_code }).returningAll().executeTakeFirstOrThrow();
            for (const component of subject.componentSnapshots) {
              const resultComponent = await db.insertInto("grading_report_components").values({ school_id: schoolId, batch_id: batch.id, report_subject_id: reportSubject.id,
                component_id: component.component.id, component_name: component.component.name, weight_percentage: component.component.weight_percentage, outcome: component.outcome,
                percentage: component.percentage === null ? null : component.percentage.toFixed(2), weighted_points: component.weightedPoints === null ? null : component.weightedPoints.toFixed(4), source_assessment_count: component.sourceRows.length }).returningAll().executeTakeFirstOrThrow();
              if (component.sourceRows.length) await db.insertInto("grading_report_assessment_sources").values(component.sourceRows.map(row => ({ school_id: schoolId, batch_id: batch.id, report_component_id: resultComponent.id,
                assessment_id: row.source.assessment_id, publication_id: row.source.publication_id, student_id: learner.student_id, outcome: row.result?.outcome ?? "not_evaluated",
                marks: row.result?.outcome === "scored" && row.result.marks !== null ? String(row.result.marks) : null, maximum_marks: String(row.source.maximum_marks),
                normalized_percentage: row.result?.outcome === "scored" && row.result.marks !== null ? (row.result.marks / row.source.maximum_marks * 100).toFixed(2) : null }))).execute();
            }
          }
        }
        const completeFingerprint = createHash("sha256").update(JSON.stringify({ assessment_fingerprint: fingerprint, cumulative_evidence: cumulativeEvidence })).digest("hex");
        const completedBatch = await db.updateTable("grading_report_batches").set({ source_fingerprint: completeFingerprint }).where("id", "=", batch.id).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, schemeId, batch.id, sequence === 1 ? "report.generated" : "report.correction.generated", null, "draft", { sequence, learners: roster.length, source_fingerprint: completeFingerprint });
        await this.emitUpdated(db, completedBatch, scheme.class_section_id, "generated");
        return completedBatch;
      };
      return this.reportCommand(db, user, schoolId, { id: scheme.id, kind: "grading_scheme", name: scheme.name, revision: data.expected_revision, currentRevision: scheme.revision }, "report.generate", data, effects, policy);
    });
    return this.unwrap(result);
  }

  async reportDetail(user: AuthUser, schoolId: string, batchId: string) {
    uuid.parse(batchId);
    const batch = (await sql`SELECT batch.*,scheme.name AS scheme_name,scheme.review_mode,scheme.class_section_id,scheme.term_id,scheme.programme_key,scheme.term_index,
      COALESCE(batch.academic_context->>'term_name',term.name) AS term_name,COALESCE(batch.academic_context->>'academic_year',term.academic_year) AS academic_year,
      COALESCE(batch.academic_context->>'class_name','Class '||section.grade||section.section) AS class_name,
      CASE WHEN batch.academic_context->>'schema_version'='1' THEN 'report_snapshot' ELSE 'legacy_scheme_context' END AS academic_context_source
      FROM grading_report_batches batch JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE batch.school_id=${schoolId}::uuid AND batch.id=${batchId}::uuid`.execute(this.db)).rows[0] as Record<string, unknown> | undefined;
    if (!batch) throw new NotFoundException("Report batch not found.");
    await this.classCommenter(user, schoolId, String(batch.class_section_id));
    this.policySnapshot(batch.result_policy);
    const students = await sql`SELECT report.*,person.first_name,person.last_name,student.admission_number,
      (report.academic_roster_source->>'roll_number')::int AS roll_number
      FROM grading_report_students report JOIN students student ON student.id=report.student_id JOIN school_people person ON person.id=student.person_id
      WHERE report.batch_id=${batchId}::uuid ORDER BY roll_number NULLS LAST,person.first_name,person.last_name`.execute(this.db);
    const subjects = await sql`SELECT report.*,subject.name AS subject_name,subject.color,subject.icon FROM grading_report_subjects report JOIN subjects subject ON subject.id=report.subject_id WHERE report.batch_id=${batchId}::uuid ORDER BY report.report_student_id,subject.name`.execute(this.db);
    const components = await sql`SELECT * FROM grading_report_components WHERE batch_id=${batchId}::uuid ORDER BY report_subject_id,component_name`.execute(this.db);
    return { batch, students: students.rows, subjects: subjects.rows, components: components.rows };
  }

  async updateComments(user: AuthUser, schoolId: string, batchId: string, studentId: string, body: unknown) {
    uuid.parse(batchId); uuid.parse(studentId);
    const data = commentInput.parse(body);
    const result = await this.db.transaction().execute(async (db) => {
      // All report mutations lock the batch before its learner rows. A reviewer
      // cannot pass this edit, and a waiting edit re-reads the final lifecycle.
      const batch = await db.selectFrom("grading_report_batches").selectAll().where("school_id", "=", schoolId).where("id", "=", batchId).forUpdate().executeTakeFirst();
      if (!batch) throw new NotFoundException("Report batch not found.");
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("school_id", "=", schoolId).where("id", "=", batch.scheme_id).executeTakeFirstOrThrow();
      const actor = await this.classCommenter(user, schoolId, scheme.class_section_id, db);
      const row = await db.selectFrom("grading_report_students").selectAll().where("school_id", "=", schoolId).where("batch_id", "=", batchId).where("student_id", "=", studentId).forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundException("Learner report not found.");
      return this.reportCommand(db, user, schoolId, { id: row.id, kind: "grading_report_student", name: scheme.name, revision: data.expected_revision, currentRevision: row.comment_revision }, "report.remarks", data, async () => {
        if (batch.status !== "draft") throw new ConflictException("Remarks can only be edited before review.");
        if (data.expected_batch_revision !== undefined && batch.revision !== data.expected_batch_revision) throw new ConflictException("This report batch changed. Review the latest report before saving remarks.");
        if (row.comment_revision !== data.expected_revision) throw new ConflictException("These remarks changed. Refresh before saving.");
        const updated = await db.updateTable("grading_report_students").set({ class_teacher_comment: data.class_teacher_comment, principal_comment: actor === "admin" ? data.principal_comment : row.principal_comment, comment_revision: row.comment_revision + 1, comment_updated_by: user.id, comment_updated_at: executionNow() }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
        const updatedBatch = await db.updateTable("grading_report_batches").set({ revision: batch.revision + 1 }).where("id", "=", batchId).returningAll().executeTakeFirstOrThrow();
        const response = commentReceipt.parse({ id: updated.id, student_id: updated.student_id, class_teacher_comment: updated.class_teacher_comment,
          principal_comment: updated.principal_comment, comment_revision: updated.comment_revision, batch_revision: updatedBatch.revision });
        // Private remarks remain in the report owner. Core retains an opaque
        // native receipt reference, never learner marks or free-text comments.
        const receiptAudit = await this.audit(db, user, schoolId, batch.scheme_id, batchId, "report.remarks.updated", "draft", "draft",
          { student_id: studentId, actor, batch_revision: updatedBatch.revision, result: response });
        await this.emitUpdated(db, updatedBatch, scheme.class_section_id, "remarks", false);
        return { id: updated.id, batch_id: batchId, student_id: updated.student_id, comment_revision: updated.comment_revision,
          batch_revision: updatedBatch.revision, receipt_audit_id: receiptAudit.id };
      }, this.policySnapshot(batch.result_policy), scheme.class_section_id);
    });
    const receipt = this.unwrap(result);
    const audit = await this.db.selectFrom("grading_report_audits").select("metadata").where("id", "=", receipt.receipt_audit_id)
      .where("school_id", "=", schoolId).where("actor_id", "=", user.id).where("batch_id", "=", batchId)
      .where("action", "=", "report.remarks.updated").executeTakeFirst();
    const saved = commentReceipt.safeParse(audit?.metadata && typeof audit.metadata === "object" ? (audit.metadata as Record<string, unknown>).result : null);
    if (!saved.success || saved.data.id !== receipt.id) throw new ConflictException("The remarks outcome needs recovery before retrying.");
    return saved.data;
  }

  async batchAction(user: AuthUser, schoolId: string, batchId: string, action: string, body: unknown) {
    if (!["review", "publish", "cancel"].includes(action)) throw new NotFoundException();
    await this.principal(user, schoolId);
    const data = revisionInput.parse(body);
    if (data.note.length < 3) throw new BadRequestException("Add a note for this action.");
    const result = await this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const batch = await db.selectFrom("grading_report_batches").selectAll().where("id", "=", batchId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!batch) throw new NotFoundException("Report batch not found.");
      const policy = this.policySnapshot(batch.result_policy);
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", batch.scheme_id).executeTakeFirstOrThrow();
      if (policy?.configuration.result_format === "gpa") await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:grading-programme:${scheme.programme_key}`},0))`.execute(db);
      const effects = async () => {
      if (batch.revision !== data.expected_revision) throw new ConflictException("This report batch changed. Refresh before continuing.");
      let next = batch.status;
      const update: Record<string, unknown> = { revision: batch.revision + 1 };
      if (action === "review") {
        if (batch.status !== "draft") throw new ConflictException("Only a draft report batch can be reviewed.");
        const incomplete = Number((await sql<{ count: number }>`SELECT count(*)::int AS count FROM grading_report_students WHERE batch_id=${batchId}::uuid AND outcome='incomplete'`.execute(db)).rows[0]!.count);
        if (incomplete) throw new BadRequestException(`${incomplete} learner reports are incomplete. Publish the missing assessment results and generate a new batch.`);
        if (scheme.review_mode === "independent" && batch.generated_by === user.id) throw new ForbiddenException("An independent reviewer must be different from the person who generated the report batch.");
        next = "reviewed"; Object.assign(update, { reviewed_by: user.id, reviewed_at: executionNow(), review_note: data.note });
      }
      if (action === "publish") {
        if (policy?.configuration.result_format === "gpa" && scheme.programme_key && scheme.term_index) {
          const students = await db.selectFrom("grading_report_students").select(["student_id", "cumulative_sources", "cgpa_unavailable_reason"]).where("batch_id", "=", batchId).execute();
          for (const student of students) {
            const history = await this.cumulativeHistory(db, schoolId, student.student_id, scheme.programme_key, scheme.term_index, policy);
            if (history.reason && history.reason !== student.cgpa_unavailable_reason) throw new ConflictException("Prior term coverage or grading compatibility changed. Generate a new release before publication.");
            const frozen = Array.isArray(student.cumulative_sources) ? student.cumulative_sources as Array<Record<string, unknown>> : [];
            const frozenPrior = [...new Set(frozen.filter(source => Number(source.term_index) < scheme.term_index!).map(source => String(source.batch_id)))].sort();
            const currentPrior = [...new Set(history.courses.map(source => source.batch_id))].sort();
            if (JSON.stringify(frozenPrior) !== JSON.stringify(currentPrior)) throw new ConflictException("A prior term release changed after this report was generated. Generate a corrected release to include it.");
          }
        }
        if (batch.status !== "reviewed") throw new ConflictException("Review the report batch before publication.");
        next = "published"; Object.assign(update, { published_by: user.id, published_at: executionNow(), publication_note: data.note });
        const recipients = await sql<{ user_id: string; student_id: string; scope: "dependent" | "self" }>`
          SELECT DISTINCT audience.user_id,audience.student_id,audience.scope FROM (
            SELECT student.user_id,report.student_id,'self'::text AS scope
            FROM grading_report_students report JOIN students student ON student.id=report.student_id
            WHERE report.batch_id=${batchId}::uuid AND student.user_id IS NOT NULL
            UNION ALL
            SELECT parent.user_id,report.student_id,'dependent'::text AS scope
            FROM grading_report_students report
            JOIN guardian_relationships relationship ON relationship.student_id=report.student_id AND relationship.school_id=${schoolId}::uuid
            JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE report.batch_id=${batchId}::uuid AND parent.user_id IS NOT NULL
          ) audience
          JOIN users account ON account.id=audience.user_id AND account.is_active
          JOIN school_memberships membership ON membership.user_id=audience.user_id
            AND membership.school_id=${schoolId}::uuid AND membership.is_active
            AND membership.role=CASE audience.scope WHEN 'dependent' THEN 'guardian' ELSE 'student' END
        `.execute(db);
        for (const recipient of recipients.rows) await db.insertInto("notifications").values({
          recipient_id: recipient.user_id,
          kind: "general",
          title: "A report card has been published",
          body: scheme.name,
          link: assessmentResultsHref(
            recipient.scope,
            recipient.student_id,
            [["report_batch_id", batchId]],
          ),
          metadata: { report_batch_id: batchId, scheme_id: scheme.id, student_id: recipient.student_id },
          dedupe_key: `report:${batchId}:${recipient.user_id}:${recipient.student_id}`,
          ...(recipient.scope === "dependent" ? {
            attention_eligible: true,
            attention_school_id: schoolId,
            attention_student_id: recipient.student_id,
            attention_class_section_id: scheme.class_section_id,
            attention_portal: "parent" as const,
            attention_module: "results" as const,
            attention_source_kind: "report_publication" as const,
            attention_source_id: batchId,
            attention_source_revision: batch.sequence,
            attention_topic_key: `report:${scheme.id}:student:${recipient.student_id}`,
          } : {}),
        }).onConflict((conflict) => conflict.doNothing()).execute();
      }
      if (action === "cancel") {
        if (!['draft', 'reviewed'].includes(batch.status)) throw new ConflictException("A published report batch cannot be cancelled.");
        next = "cancelled";
      }
      const updated = await db.updateTable("grading_report_batches").set({ ...update, status: next }).where("id", "=", batchId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, batch.scheme_id, batchId, `report.${action}`, batch.status, next, { note: data.note });
      await this.emitUpdated(db,updated,scheme.class_section_id,action,action === "publish");
      return updated;
      };
      return this.reportCommand(db, user, schoolId, { id: batch.id, kind: "grading_report_batch", name: scheme.name, revision: data.expected_revision, currentRevision: batch.revision }, `report.${action}`, data, effects, policy);
    });
    return this.unwrap(result);
  }

  async familyReports(user: AuthUser, schoolId: string, studentId: string) {
    uuid.parse(schoolId); uuid.parse(studentId);
    const allowed = (await sql<{ ok: boolean }>`SELECT EXISTS(SELECT 1 FROM students student JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id AND membership.is_active AND membership.role='student' WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND student.user_id=${user.id}::uuid)
      OR EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=relationship.school_id AND membership.is_active AND membership.role='guardian' WHERE relationship.student_id=${studentId}::uuid AND relationship.school_id=${schoolId}::uuid AND parent.user_id=${user.id}::uuid) AS ok`.execute(this.db)).rows[0]?.ok;
    if (!allowed) throw new ForbiddenException("You cannot view this learner's report cards.");
    const student = (await sql`SELECT student.id,student.admission_number,person.first_name,person.last_name,'Class '||section.grade||section.section AS class_name FROM students student JOIN school_people person ON person.id=student.person_id LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active LEFT JOIN class_sections section ON section.id=enrollment.class_section_id WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid ORDER BY enrollment.enrolled_on DESC LIMIT 1`.execute(this.db)).rows[0];
    if (!student) throw new NotFoundException();
    const reports = await sql<FamilyReportProjection>`SELECT * FROM (SELECT DISTINCT ON(scheme.id) report.id AS report_student_id,batch.id AS batch_id,batch.sequence,batch.published_at,batch.correction_reason,
      scheme.id AS scheme_id,scheme.name AS scheme_name,COALESCE(batch.academic_context->>'term_name',term.name) AS term_name,
      COALESCE(batch.academic_context->>'academic_year',term.academic_year) AS academic_year,
      COALESCE(batch.academic_context->>'class_name','Class '||section.grade||section.section) AS class_name,scheme.class_section_id,scheme.term_id,batch.academic_context,
      CASE WHEN batch.academic_context->>'schema_version'='1' THEN 'report_snapshot' ELSE 'legacy_scheme_context' END AS academic_context_source,
      report.academic_roster_source,report.outcome,report.overall_percentage,report.overall_grade,report.class_teacher_comment,report.principal_comment,batch.result_policy,scheme.programme_key,scheme.term_index,report.gpa,report.cgpa,report.credit_total,report.credit_points,report.cumulative_credits,report.cumulative_credit_points,report.cumulative_sources,report.gpa_unavailable_reason,report.cgpa_unavailable_reason
      FROM grading_report_students report JOIN grading_report_batches batch ON batch.id=report.batch_id AND batch.status='published'
      JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id
      JOIN class_sections section ON section.id=scheme.class_section_id AND section.school_id=scheme.school_id
      WHERE report.school_id=${schoolId}::uuid AND report.student_id=${studentId}::uuid ORDER BY scheme.id,batch.sequence DESC) latest ORDER BY latest.published_at DESC`.execute(this.db);
    for (const report of reports.rows) this.policySnapshot(report.result_policy);
    const reportIds = reports.rows.map((report) => String((report as { report_student_id: string }).report_student_id));
    const subjects = reportIds.length ? await sql`SELECT result.*,subject.name AS subject_name,subject.color,subject.icon,
      COALESCE((SELECT array_agg(DISTINCT source.assessment_id ORDER BY source.assessment_id) FROM grading_report_components component
        JOIN grading_report_assessment_sources source ON source.report_component_id=component.id
        WHERE component.report_subject_id=result.id),'{}'::uuid[]) AS assessment_ids
      FROM grading_report_subjects result JOIN subjects subject ON subject.id=result.subject_id
      WHERE result.report_student_id=ANY(${reportIds}::uuid[]) ORDER BY result.report_student_id,subject.name`.execute(this.db) : { rows: [] };
    return { student, reports: reports.rows.map((report) => ({ ...report, subjects: subjects.rows.filter((subject) => String((subject as { report_student_id: string }).report_student_id) === String((report as { report_student_id: string }).report_student_id)) })) };
  }
}
