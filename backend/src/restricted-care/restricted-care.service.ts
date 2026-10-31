import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction, type Selectable } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database, RestrictedCareCaseEntryTable, RestrictedCareCaseTable } from "../database/types.js";
import { assertActiveSchoolStaffMember } from "../roles/authorization.js";
import { RestrictedCareModel, refuseCareCommand } from "./restricted-care.model.js";
import type { PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";

type Db = Kysely<Database> | Transaction<Database>;
type StaffRole = "admin" | "staff";
type CaseAccess = { assignment_role: "reporter" | "owner" | "backup" | "contributor" | "reviewer"; access_level: "intake_only" | "full" };
export interface RestrictedCareDiscovery { can_report: boolean; can_manage_team: boolean; has_assignments: boolean }

const uuid = z.string().uuid();
const date = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const expectedRevision = z.number().int().positive();
const teamAssignmentInput = z.object({
  user_id: uuid,
  role_kind: z.enum(["designated_lead", "deputy_lead", "institution_head", "counsellor", "external_liaison"]),
  route_kind: z.enum(["primary", "alternate"]),
  valid_from: date,
  valid_until: date.nullable(),
}).superRefine((value, context) => {
  if (value.valid_until && value.valid_until < value.valid_from) {
    context.addIssue({ code: "custom", path: ["valid_until"], message: "End date cannot be before the start date." });
  }
});
const revokeInput = z.object({ expected_revision: expectedRevision, reason: z.string().trim().min(12).max(1000) });
const caseInput = z.object({
  command_id: uuid,
  student_id: uuid.nullable(),
  intake_route: z.enum(["primary", "alternate"]),
  source_kind: z.enum(["staff_observation", "child_disclosure", "guardian_report", "student_report", "anonymous", "other"]),
  urgency: z.enum(["urgent", "priority", "routine"]),
  concern_category: z.enum(["sexual_safety", "physical_safety", "emotional_wellbeing", "neglect", "bullying", "cyber_safety", "other"]),
  safety_state: z.enum(["immediate_action_required", "actions_underway", "no_immediate_danger", "unknown"]),
  ordinary_handler_involved: z.boolean(),
  observed_at: dateTime.nullable(),
  details: z.string().trim().min(20).max(6000),
}).superRefine((value, context) => {
  if (value.ordinary_handler_involved && value.intake_route !== "alternate") {
    context.addIssue({ code: "custom", path: ["intake_route"], message: "Use the alternate route when the ordinary handler may be involved." });
  }
});
const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_entry"), expected_revision: expectedRevision, entry_type: z.enum(["safety_action", "contact", "case_note", "outcome", "handover"]), note: z.string().trim().min(10).max(6000) }),
  z.object({ action: z.literal("reporting_decision"), expected_revision: expectedRevision, reporting_state: z.enum(["reporting_required", "not_applicable"]), rationale: z.string().trim().min(20).max(6000) }),
  z.object({ action: z.literal("external_report"), expected_revision: expectedRevision, authority_type: z.enum(["sjpu", "local_police", "child_welfare_committee", "child_helpline", "other"]), reported_at: dateTime, reference: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("transition"), expected_revision: expectedRevision, status: z.enum(["triage", "active", "closed"]), note: z.string().trim().min(20).max(6000) }),
  z.object({ action: z.literal("reassign"), expected_revision: expectedRevision, owner_user_id: uuid, note: z.string().trim().min(20).max(1000) }),
]).and(z.object({ command_id: uuid }));
const orphanInput = z.object({ command_id: uuid, expected_revision: expectedRevision, owner_user_id: uuid, note: z.string().trim().min(20).max(1000) });

@Injectable()
export class RestrictedCareService {
  private readonly encryptionKey = createHash("sha256").update(config().restrictedCaseEncryptionKey).digest();

  constructor(private readonly db: DatabaseService, private readonly model: RestrictedCareModel) {}

  private async membership(user: AuthUser, schoolId: string, db: Db = this.db): Promise<StaffRole> {
    uuid.parse(schoolId);
    if (!user.is_active || user.active_school_id !== schoolId || executionEnvironmentStorage.getStore()?.institution_id && executionEnvironmentStorage.getStore()!.institution_id !== schoolId) throw new ForbiddenException("Choose this institution before opening its protected care workspace.");
    const membership = await db.selectFrom("school_memberships as member").innerJoin("users as account", "account.id", "member.user_id").select("member.role")
      .where("member.school_id", "=", schoolId).where("member.user_id", "=", user.id).where("member.is_active", "=", true).where("account.is_active", "=", true)
      .where(sql<boolean>`campus_model_account_person_is_active(${schoolId}::uuid,${user.id}::uuid,NULL,${executionNow()}::timestamptz)`)
      .where("member.role", "in", ["admin", "staff"]).forShare(["member", "account"]).executeTakeFirst();
    if (!membership) throw new ForbiddenException("Active staff membership is required for the protected care route.");
    return membership.role as StaffRole;
  }

  private async admin(user: AuthUser, schoolId: string, db: Db = this.db) {
    if (await this.membership(user, schoolId, db) !== "admin") {
      throw new ForbiddenException("Institution administrator access is required to configure safeguarding roles.");
    }
  }

  private encrypt(value: string, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }

  private decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: string) {
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(iv));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, caseId: string | null, action: string, metadata: Record<string, unknown> = {}) {
    return db.insertInto("restricted_care_audits").values({ school_id: schoolId, case_id: caseId, actor_id: user.id, action, metadata, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
  }

  private async enqueue(db: Transaction<Database>, schoolId: string, caseId: string, revision: number, eventType: string) {
    const recipients = await db.selectFrom("restricted_care_case_assignments as assignment")
      .innerJoin("school_memberships as member", join => join.onRef("member.school_id", "=", "assignment.school_id").onRef("member.user_id", "=", "assignment.user_id"))
      .innerJoin("users as account", "account.id", "assignment.user_id").select("assignment.user_id")
      .where("assignment.school_id", "=", schoolId).where("assignment.case_id", "=", caseId).where("assignment.revoked_at", "is", null)
      .where("member.is_active", "=", true).where("member.role", "in", ["admin", "staff"]).where("account.is_active", "=", true)
      .where(sql<boolean>`campus_model_account_person_is_active(${schoolId}::uuid,assignment.user_id,NULL,${executionNow()}::timestamptz)`).execute();
    const audience = [...new Set(recipients.map((item) => item.user_id))];
    return db.insertInto("event_outbox").values({
      school_id: schoolId, event_type: eventType, aggregate_type: "restricted_care_case", aggregate_id: caseId,
      audience_user_ids: audience, payload: { case_id: caseId, revision, refresh: ["safeguarding", "notifications", "attention"] },
      idempotency_key: `${eventType}:${caseId}:${revision}`, notification_user_ids: audience,
      notification_payload: {
        kind: "general",
        title: "Protected care case updated",
        body: "Open the restricted care workspace for the latest authorized update.",
        staff_link: `/areas/care/concerns?section=cases&case=${caseId}&case_revision=${revision}`,
        admin_link: `/areas/care/concerns?section=cases&case=${caseId}&case_revision=${revision}`,
        attention_eligible: true,
        attention_module: "safeguarding",
        attention_source_kind: "restricted_care_update",
        attention_source_id: caseId,
        attention_source_revision: revision,
        attention_topic_key: `restricted-care:${caseId}`,
      } as any,
    }).returning("id").executeTakeFirstOrThrow();
  }

  private async caseAccess(user: AuthUser, schoolId: string, caseId: string, db: Db = this.db): Promise<CaseAccess> {
    uuid.parse(caseId);
    await this.membership(user, schoolId, db);
    const access = await db.selectFrom("restricted_care_case_assignments").select(["assignment_role", "access_level"])
      .where("school_id", "=", schoolId).where("case_id", "=", caseId).where("user_id", "=", user.id)
      .where("revoked_at", "is", null).forShare().executeTakeFirst();
    if (!access) throw new NotFoundException("Protected care case was not found.");
    return access;
  }

  private async currentOwner(db: Db, care: Pick<Selectable<RestrictedCareCaseTable>, "school_id" | "id" | "owner_user_id">, lock = false) {
    return (await sql<{ id: string }>`SELECT assignment.id FROM restricted_care_case_assignments assignment
      JOIN school_memberships member ON member.school_id=assignment.school_id AND member.user_id=assignment.user_id AND member.is_active AND member.role IN ('admin','staff')
      JOIN users account ON account.id=member.user_id AND account.is_active
      WHERE assignment.school_id=${care.school_id}::uuid AND assignment.case_id=${care.id}::uuid AND assignment.user_id=${care.owner_user_id}::uuid
        AND assignment.assignment_role='owner' AND assignment.access_level='full' AND assignment.revoked_at IS NULL
        AND campus_model_account_person_is_active(${care.school_id}::uuid,assignment.user_id,NULL,${executionNow()}::timestamptz)
      LIMIT 1 ${lock ? sql`FOR SHARE OF assignment,member,account` : sql``}`.execute(db)).rows[0] ?? null;
  }

  private async eligibleHandler(db: Db, schoolId: string, userId: string, care: { intake_route: string; ordinary_handler_involved: boolean; reported_by: string }, lock = false) {
    if (care.ordinary_handler_involved && care.reported_by === userId) return null;
    return (await sql<{ id: string }>`SELECT assignment.id FROM restricted_care_role_assignments assignment
      JOIN school_memberships member ON member.school_id=assignment.school_id AND member.user_id=assignment.user_id
        AND member.is_active AND member.role IN ('admin','staff')
      JOIN users account ON account.id=member.user_id AND account.is_active JOIN schools campus ON campus.id=assignment.school_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${userId}::uuid AND assignment.route_kind=${care.intake_route}
        AND assignment.status='active' AND assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
        AND campus_model_account_person_is_active(${schoolId}::uuid,assignment.user_id,NULL,${executionNow()}::timestamptz)
        AND (assignment.valid_until IS NULL OR assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
      ORDER BY assignment.id LIMIT 1 ${lock ? sql`FOR SHARE OF assignment,member,account` : sql``}`.execute(db)).rows[0] ?? null;
  }

  private async handlerOptions(db: Db, schoolId: string, care: { intake_route: string; ordinary_handler_involved: boolean; reported_by: string; owner_user_id: string }) {
    return (await sql<{ id: string; name: string; role_kind: string }>`SELECT DISTINCT ON (assignment.user_id) assignment.user_id AS id,
        trim(concat_ws(' ',account.first_name,account.last_name)) AS name,assignment.role_kind
      FROM restricted_care_role_assignments assignment JOIN users account ON account.id=assignment.user_id AND account.is_active
      JOIN school_memberships member ON member.school_id=assignment.school_id AND member.user_id=assignment.user_id AND member.is_active AND member.role IN ('admin','staff')
      JOIN schools campus ON campus.id=assignment.school_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.route_kind=${care.intake_route} AND assignment.status='active'
        AND campus_model_account_person_is_active(${schoolId}::uuid,assignment.user_id,NULL,${executionNow()}::timestamptz)
        AND assignment.user_id<>${care.owner_user_id}::uuid
        AND (NOT ${care.ordinary_handler_involved}::boolean OR assignment.user_id<>${care.reported_by}::uuid)
        AND assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
        AND (assignment.valid_until IS NULL OR assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
      ORDER BY assignment.user_id,assignment.created_at`.execute(db)).rows;
  }

  private async nativeReceipt(db: Db, user: AuthUser, schoolId: string, receiptId: string) {
    const receipt = await db.selectFrom("restricted_care_audits").select(["case_id", "metadata"])
      .where("school_id", "=", schoolId).where("actor_id", "=", user.id).where("id", "=", uuid.parse(receiptId)).executeTakeFirst();
    const metadata = receipt?.metadata as { result?: { id: string; revision: number; status: string; reporting_state: string } } | undefined;
    if (!receipt || !metadata?.result || metadata.result.id !== receipt.case_id) throw new ConflictException("The exact protected receipt is unavailable. Do not send a replacement request.");
    return { ...metadata.result, receipt_id: receiptId, receipt: "Recorded in the protected workspace. This receipt is not proof that an external report was made." };
  }

  async confirm(user: AuthUser, schoolId: string, commandId: string) {
    uuid.parse(commandId);
    return this.db.transaction().execute(async tx => {
      await this.membership(user, schoolId, tx);
      const retained = await this.model.retained(tx, user, schoolId, commandId);
      if (!retained) return { state: "not_found" as const };
      if (retained.target.domain !== "restricted_care") throw new ConflictException("This confirmation belongs to different work.");
      if (retained.state === "pending") return { state: "pending" as const };
      if (retained.receipt.terminal_state !== "accepted") return { state: "not_accepted" as const };
      return { state: "accepted" as const, result: await this.nativeReceipt(tx, user, schoolId, String(retained.receipt.metadata.receipt_id)) };
    });
  }

  private async eligibleStudent(user: AuthUser, schoolId: string, studentId: string, role: StaffRole, db: Db) {
    const row = await sql<{ allowed: boolean }>`SELECT EXISTS(
      SELECT 1 FROM students student JOIN schools campus ON campus.id=student.school_id
      WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND (
        ${role}='admin' OR EXISTS (
          SELECT 1 FROM enrollments enrollment
          WHERE enrollment.student_id=student.id AND enrollment.is_active AND (
            EXISTS (SELECT 1 FROM class_section_staff_assignments assignment
              WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${user.id}::uuid
                AND assignment.class_section_id=enrollment.class_section_id
                AND assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
                AND (assignment.valid_until IS NULL OR assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date))
            OR EXISTS (SELECT 1 FROM timetable_slots slot
              WHERE slot.class_section_id=enrollment.class_section_id AND slot.term_id=enrollment.term_id
                AND slot.teacher_user_id=${user.id}::uuid)
          )
        )
      )
    ) AS allowed`.execute(db);
    if (!row.rows[0]?.allowed) {
      throw new ForbiddenException("Select a currently assigned student, or leave the student unselected and record the identifying information inside the protected intake note.");
    }
  }

  async workspace(user: AuthUser, schoolId: string) {
    const role = await this.membership(user, schoolId);
    const cases = await sql<Record<string, unknown>>`SELECT care.id,care.student_id,care.owner_user_id,care.intake_route,
        care.urgency,care.concern_category,care.safety_state,care.status,care.reporting_state,care.opened_at,
        care.last_activity_at,care.revision,assignment.assignment_role,assignment.access_level,
        COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),NULLIF(trim(concat_ws(' ',student_user.first_name,student_user.last_name)),''),'Child not selected') AS subject_name,
        concat_ws(' ',owner.first_name,owner.last_name) AS owner_name
      FROM restricted_care_case_assignments assignment
      JOIN restricted_care_cases care ON care.id=assignment.case_id AND care.school_id=assignment.school_id
      LEFT JOIN students student ON student.id=care.student_id
      LEFT JOIN school_people person ON person.id=student.person_id
      LEFT JOIN users student_user ON student_user.id=student.user_id
      JOIN users owner ON owner.id=care.owner_user_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${user.id}::uuid AND assignment.revoked_at IS NULL
      ORDER BY CASE care.urgency WHEN 'urgent' THEN 1 WHEN 'priority' THEN 2 ELSE 3 END,care.last_activity_at DESC`.execute(this.db);
    const routeStatus = await sql<{ route_kind: "primary" | "alternate"; available: number }>`SELECT route_kind,count(*)::int AS available
      FROM restricted_care_role_assignments role_assignment
      JOIN school_memberships membership ON membership.school_id=role_assignment.school_id AND membership.user_id=role_assignment.user_id
        AND membership.is_active AND membership.role IN ('admin','staff')
      JOIN users account ON account.id=membership.user_id AND account.is_active JOIN schools campus ON campus.id=role_assignment.school_id
      WHERE role_assignment.school_id=${schoolId}::uuid AND role_assignment.status='active'
        AND campus_model_account_person_is_active(${schoolId}::uuid,role_assignment.user_id,NULL,${executionNow()}::timestamptz)
        AND role_assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
        AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
      GROUP BY route_kind`.execute(this.db);
    const eligibleStudents = role === "admin"
      ? await sql<Record<string, unknown>>`SELECT student.id,student.admission_number,
          COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),trim(concat_ws(' ',student_user.first_name,student_user.last_name))) AS name
        FROM students student LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN users student_user ON student_user.id=student.user_id
        WHERE student.school_id=${schoolId}::uuid ORDER BY name LIMIT 400`.execute(this.db)
      : await sql<Record<string, unknown>>`SELECT DISTINCT student.id,student.admission_number,
          COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),trim(concat_ws(' ',student_user.first_name,student_user.last_name))) AS name
        FROM students student JOIN schools campus ON campus.id=student.school_id JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
        LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN users student_user ON student_user.id=student.user_id
        WHERE student.school_id=${schoolId}::uuid AND (
          EXISTS (SELECT 1 FROM class_section_staff_assignments assignment WHERE assignment.school_id=${schoolId}::uuid
            AND assignment.user_id=${user.id}::uuid AND assignment.class_section_id=enrollment.class_section_id
            AND assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
            AND (assignment.valid_until IS NULL OR assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date))
          OR EXISTS (SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=enrollment.class_section_id
            AND slot.term_id=enrollment.term_id AND slot.teacher_user_id=${user.id}::uuid)
        ) ORDER BY name LIMIT 250`.execute(this.db);
    const team = role === "admin" ? await sql<Record<string, unknown>>`SELECT assignment.*,concat_ws(' ',member.first_name,member.last_name) AS member_name,
        member.email,creator.first_name AS creator_first_name,creator.last_name AS creator_last_name
      FROM restricted_care_role_assignments assignment JOIN users member ON member.id=assignment.user_id
      JOIN users creator ON creator.id=assignment.created_by WHERE assignment.school_id=${schoolId}::uuid
      ORDER BY (assignment.status='active') DESC,assignment.route_kind,assignment.role_kind,assignment.created_at DESC`.execute(this.db) : { rows: [] };
    const candidates = role === "admin" ? await sql<Record<string, unknown>>`SELECT DISTINCT membership.user_id AS id,
        concat_ws(' ',member.first_name,member.last_name) AS name,member.email,membership.role
      FROM school_memberships membership JOIN users member ON member.id=membership.user_id AND member.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active AND membership.role IN ('admin','staff')
        AND campus_model_account_person_is_active(${schoolId}::uuid,membership.user_id,NULL,${executionNow()}::timestamptz)
      ORDER BY name`.execute(this.db) : { rows: [] };
    return {
      can_manage_team: role === "admin", cases: cases.rows, team: team.rows, candidates: candidates.rows,
      eligible_students: eligibleStudents.rows,
      routes: {
        primary: Number(routeStatus.rows.find((item) => item.route_kind === "primary")?.available ?? 0),
        alternate: Number(routeStatus.rows.find((item) => item.route_kind === "alternate")?.available ?? 0),
      },
      legal_notice: "This workspace records restricted operational evidence. It does not determine whether reporting is legally required and must not delay immediate external help.",
    };
  }

  /** Navigation eligibility only. No protected case contents or identifiers are
   * loaded to build the shared shell; each selected case still checks access. */
  async discovery(user: AuthUser, schoolId: string): Promise<RestrictedCareDiscovery> {
    try {
      const role = await this.membership(user, schoolId);
      const assigned = await this.db.selectFrom("restricted_care_case_assignments").select("id")
        .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("revoked_at", "is", null).limit(1).executeTakeFirst();
      return { can_report: true, can_manage_team: role === "admin", has_assignments: Boolean(assigned) };
    } catch (error) {
      if (error instanceof ForbiddenException) return { can_report: false, can_manage_team: false, has_assignments: false };
      throw error;
    }
  }

  /** The administrator recovers routing, not access to allegations or reports. */
  async orphanedCases(user: AuthUser, schoolId: string, requestedPage: unknown = 1) {
    await this.admin(user, schoolId);
    const page = z.coerce.number().int().min(1).max(100_000).parse(requestedPage);
    type RecoveryRow = Pick<Selectable<RestrictedCareCaseTable>, "id" | "owner_user_id" | "intake_route" | "revision" | "ordinary_handler_involved" | "reported_by"> & { first_name: string; last_name: string };
    const rows = (await sql<{ total: number; cases: RecoveryRow[] }>`WITH orphaned AS (
      SELECT care.id,care.owner_user_id,care.intake_route,care.revision,care.ordinary_handler_involved,care.reported_by,owner.first_name,owner.last_name
      FROM restricted_care_cases care JOIN users owner ON owner.id=care.owner_user_id
      WHERE care.school_id=${schoolId}::uuid AND care.status<>'closed' AND NOT EXISTS (
        SELECT 1 FROM restricted_care_case_assignments assignment
        JOIN school_memberships member ON member.school_id=assignment.school_id AND member.user_id=assignment.user_id
          AND member.is_active AND member.role IN ('admin','staff')
        JOIN users account ON account.id=member.user_id AND account.is_active
        WHERE assignment.school_id=care.school_id AND assignment.case_id=care.id AND assignment.user_id=care.owner_user_id
          AND assignment.assignment_role='owner' AND assignment.access_level='full' AND assignment.revoked_at IS NULL
          AND campus_model_account_person_is_active(${schoolId}::uuid,assignment.user_id,NULL,${executionNow()}::timestamptz)
      )
    ), paged AS (SELECT * FROM orphaned ORDER BY id LIMIT 10 OFFSET ${(page - 1) * 10})
    SELECT (SELECT count(*)::int FROM orphaned) AS total,COALESCE(jsonb_agg(paged ORDER BY paged.id),'[]'::jsonb) AS cases FROM paged`.execute(this.db)).rows[0]!;
    const result = [];
    for (const care of rows.cases) {
      result.push({ id: care.id, revision: care.revision, intake_route: care.intake_route,
        owner_name: `${care.first_name} ${care.last_name}`.trim(), candidates: await this.handlerOptions(this.db, schoolId, care) });
    }
    return { cases: result, page, total: rows.total, pages: Math.max(1, Math.ceil(rows.total / 10)) };
  }

  async assignTeamMember(user: AuthUser, schoolId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = teamAssignmentInput.parse(body);
      const member = await trx.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId)
        .where("user_id", "=", input.user_id).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).executeTakeFirst();
      if (!member) throw new BadRequestException("The selected person must have an active staff membership.");
      await assertActiveSchoolStaffMember(trx, input.user_id, schoolId, "safety_officer");
      if (!(await sql<{ active: boolean }>`SELECT campus_model_account_person_is_active(${schoolId}::uuid,${input.user_id}::uuid,NULL,${executionNow()}::timestamptz) AS active`.execute(trx)).rows[0]?.active) throw new BadRequestException("Choose a staff member with current canonical campus app access.");
      const existing = await trx.selectFrom("restricted_care_role_assignments").select("id")
        .where("school_id", "=", schoolId).where("user_id", "=", input.user_id).where("role_kind", "=", input.role_kind)
        .where("route_kind", "=", input.route_kind).where("status", "=", "active").executeTakeFirst();
      if (existing) throw new ConflictException("This active safeguarding role assignment already exists.");
      const assignment = await trx.insertInto("restricted_care_role_assignments").values({
        school_id: schoolId, user_id: input.user_id, role_kind: input.role_kind, route_kind: input.route_kind,
        valid_from: input.valid_from, valid_until: input.valid_until, created_by: user.id, revoked_by: null,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit(trx, user, schoolId, null, "restricted_care.role.assigned", { assignment_id: assignment.id, role_kind: assignment.role_kind, route_kind: assignment.route_kind, revision: assignment.revision });
      return assignment;
    });
  }

  async revokeTeamMember(user: AuthUser, schoolId: string, assignmentId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx); uuid.parse(assignmentId);
      const input = revokeInput.parse(body);
      const current = await trx.selectFrom("restricted_care_role_assignments").selectAll().where("school_id", "=", schoolId)
        .where("id", "=", assignmentId).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Safeguarding role assignment was not found.");
      if (current.status !== "active") throw new ConflictException("This role assignment is already revoked.");
      if (current.revision !== input.expected_revision) throw new ConflictException("The role assignment changed. Reload and try again.");
      const updated = await trx.updateTable("restricted_care_role_assignments").set({ status: "revoked", revoked_by: user.id, revoked_at: executionNow(), revocation_reason: input.reason })
        .where("id", "=", assignmentId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("The role assignment changed. Reload and try again.");
      await this.audit(trx, user, schoolId, null, "restricted_care.role.revoked", { assignment_id: assignmentId, route_kind: current.route_kind, revision: updated.revision });
      return updated;
    });
  }

  async openCase(user: AuthUser, schoolId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      const role = await this.membership(user, schoolId, trx);
      const input = caseInput.parse(body);
      const command = await this.model.prepare(trx, user, { id: input.command_id, school_id: schoolId, revision: 0 }, "intake", input, { staff_user_id: user.id });
      if (command.replay) return this.nativeReceipt(trx, user, schoolId, command.receipt_id);
      if (input.student_id) await this.eligibleStudent(user, schoolId, input.student_id, role, trx);
      const ownerResult = await sql<{ user_id: string }>`SELECT role_assignment.user_id FROM restricted_care_role_assignments role_assignment
        JOIN school_memberships membership ON membership.school_id=role_assignment.school_id AND membership.user_id=role_assignment.user_id
          AND membership.is_active AND membership.role IN ('admin','staff')
        JOIN users account ON account.id=membership.user_id AND account.is_active JOIN schools campus ON campus.id=role_assignment.school_id
        WHERE role_assignment.school_id=${schoolId}::uuid AND role_assignment.route_kind=${input.intake_route}
          AND role_assignment.status='active' AND role_assignment.valid_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
          AND campus_model_account_person_is_active(${schoolId}::uuid,role_assignment.user_id,NULL,${executionNow()}::timestamptz)
          AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
          AND (${input.ordinary_handler_involved}::boolean=false OR role_assignment.user_id<>${user.id}::uuid)
        ORDER BY CASE role_assignment.role_kind WHEN 'designated_lead' THEN 1 WHEN 'deputy_lead' THEN 2
          WHEN 'institution_head' THEN 3 WHEN 'counsellor' THEN 4 ELSE 5 END,role_assignment.created_at LIMIT 1 FOR SHARE OF role_assignment,membership,account`.execute(trx);
      const ownerId = ownerResult.rows[0]?.user_id;
      if (!ownerId) refuseCareCommand(input.command_id, input.command_id, "route_unavailable", `${input.intake_route === "alternate" ? "Alternate" : "Primary"} protected recipient is not configured. Use the institution's approved external or emergency route; do not wait for this form.`);
      const caseId = input.command_id;
      const entryId = randomUUID();
      const protectedNote = this.encrypt(input.details, `${schoolId}:${caseId}:${entryId}:intake_note`);
      const careCase = await trx.insertInto("restricted_care_cases").values({
        id: caseId, school_id: schoolId, student_id: input.student_id, reported_by: user.id, owner_user_id: ownerId,
        intake_route: input.intake_route, source_kind: input.source_kind, urgency: input.urgency,
        concern_category: input.concern_category, safety_state: input.safety_state,
        ordinary_handler_involved: input.ordinary_handler_involved, observed_at: input.observed_at ? new Date(input.observed_at) : null,
        closed_by: null, retention_review_on: null, opened_at: executionNow(), last_activity_at: executionNow(), created_at: executionNow(), updated_at: executionNow(),
      }).returningAll().executeTakeFirstOrThrow();
      if (ownerId === user.id) {
        await trx.insertInto("restricted_care_case_assignments").values({ school_id: schoolId, case_id: caseId, user_id: user.id, assignment_role: "owner", access_level: "full", assigned_by: user.id, revoked_by: null }).execute();
      } else {
        await trx.insertInto("restricted_care_case_assignments").values([
          { school_id: schoolId, case_id: caseId, user_id: user.id, assignment_role: "reporter", access_level: "intake_only", assigned_by: user.id, revoked_by: null },
          { school_id: schoolId, case_id: caseId, user_id: ownerId, assignment_role: "owner", access_level: "full", assigned_by: user.id, revoked_by: null },
        ]).execute();
      }
      await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: "intake_note", ciphertext: protectedNote.ciphertext, content_iv: protectedNote.iv, content_tag: protectedNote.tag, created_by: user.id }).execute();
      const result = { id: caseId, revision: careCase.revision, status: careCase.status, reporting_state: careCase.reporting_state, owner_user_id: ownerId };
      const receipt = await this.audit(trx, user, schoolId, caseId, "restricted_care.case.opened", { revision: careCase.revision, owner_assigned: true, result });
      const event = await this.enqueue(trx, schoolId, caseId, careCase.revision, "restricted_care.case.opened");
      await this.model.finish(trx, user, careCase, command.prepared, receipt.id, event.id, "restricted_care.case.opened");
      return this.nativeReceipt(trx, user, schoolId, receipt.id);
    });
  }

  async caseDetail(user: AuthUser, schoolId: string, caseId: string) {
    const access = await this.caseAccess(user, schoolId, caseId);
    const careCase = await sql<Record<string, unknown>>`SELECT care.*,
        COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),NULLIF(trim(concat_ws(' ',student_user.first_name,student_user.last_name)),''),'Child not selected') AS subject_name,
        student.admission_number,concat_ws(' ',owner.first_name,owner.last_name) AS owner_name,
        concat_ws(' ',reporter.first_name,reporter.last_name) AS reporter_name
      FROM restricted_care_cases care LEFT JOIN students student ON student.id=care.student_id
      LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN users student_user ON student_user.id=student.user_id
      JOIN users owner ON owner.id=care.owner_user_id JOIN users reporter ON reporter.id=care.reported_by
      WHERE care.school_id=${schoolId}::uuid AND care.id=${caseId}::uuid`.execute(this.db);
    const item = careCase.rows[0];
    if (!item) throw new NotFoundException("Protected care case was not found.");
    const entries = await this.db.selectFrom("restricted_care_case_entries").selectAll().where("school_id", "=", schoolId)
      .where("case_id", "=", caseId)
      .$if(access.access_level === "intake_only", (query) => query.where("created_by", "=", user.id).where("entry_type", "=", "intake_note"))
      .orderBy("created_at").execute();
    const visibleEntries = entries.map((entry) => ({
      id: entry.id, entry_type: entry.entry_type, created_by: entry.created_by, created_at: entry.created_at,
      note: this.decrypt(entry.ciphertext, entry.content_iv, entry.content_tag, `${schoolId}:${caseId}:${entry.id}:${entry.entry_type}`),
    }));
    const sourceContentOmitted = executionEnvironmentStorage.getStore()?.kind === "simulation" && !entries.some(entry => entry.entry_type === "intake_note");
    if (access.access_level === "intake_only") {
      return { case: item, access, entries: visibleEntries, external_reports: [], audits: [], handover_candidates: [], source_content_omitted: sourceContentOmitted };
    }
    const reports = await this.db.selectFrom("restricted_care_external_reports").selectAll().where("school_id", "=", schoolId).where("case_id", "=", caseId).orderBy("reported_at").execute();
    const externalReports = reports.map((report) => ({
      id: report.id, authority_type: report.authority_type, reported_at: report.reported_at, recorded_by: report.recorded_by, created_at: report.created_at,
      reference: this.decrypt(report.reference_ciphertext, report.reference_iv, report.reference_tag, `${schoolId}:${caseId}:${report.id}:external_report`),
    }));
    const audits = await sql<Record<string, unknown>>`SELECT audit.id,audit.action,audit.metadata,audit.created_at,
        concat_ws(' ',actor.first_name,actor.last_name) AS actor_name FROM restricted_care_audits audit
      JOIN users actor ON actor.id=audit.actor_id WHERE audit.school_id=${schoolId}::uuid AND audit.case_id=${caseId}::uuid
      ORDER BY audit.created_at DESC LIMIT 80`.execute(this.db);
    const handoverCandidates = access.assignment_role === "owner" && item.status !== "closed"
      ? await this.handlerOptions(this.db, schoolId, item as unknown as Selectable<RestrictedCareCaseTable>) : [];
    return { case: item, access, entries: visibleEntries, external_reports: externalReports, audits: audits.rows, handover_candidates: handoverCandidates, source_content_omitted: sourceContentOmitted };
  }

  private async finishAction(trx: Transaction<Database>, user: AuthUser, care: Selectable<RestrictedCareCaseTable>, command: PreparedDomainCommand, eventType: string, metadata: Record<string, unknown> = {}) {
    const result = { id: care.id, revision: care.revision, status: care.status, reporting_state: care.reporting_state, action: eventType };
    const receipt = await this.audit(trx, user, care.school_id, care.id, eventType, { ...metadata, revision: care.revision, result });
    const event = await this.enqueue(trx, care.school_id, care.id, care.revision, eventType);
    await this.model.finish(trx, user, care, command, receipt.id, event.id, eventType);
    return this.nativeReceipt(trx, user, care.school_id, receipt.id);
  }

  private async transfer(trx: Transaction<Database>, user: AuthUser, care: Selectable<RestrictedCareCaseTable>, input: { command_id: string; owner_user_id: string; expected_revision: number; note: string }) {
    if (input.owner_user_id === care.owner_user_id) refuseCareCommand(input.command_id, care.id, "target_ineligible", "Choose a different eligible care lead.");
    const target = await this.eligibleHandler(trx, care.school_id, input.owner_user_id, care, true);
    if (!target) refuseCareCommand(input.command_id, care.id, "target_ineligible", "Choose a current eligible care lead on this case’s protected route.");
    await trx.updateTable("restricted_care_case_assignments").set({ revoked_by: user.id, revoked_at: executionNow(), revocation_reason: "Ownership transferred in protected care." })
      .where("school_id", "=", care.school_id).where("case_id", "=", care.id).where("user_id", "=", care.owner_user_id).where("assignment_role", "=", "owner").where("revoked_at", "is", null).execute();
    // An owner who originally reported retains only their own original intake.
    const reporterActive = care.owner_user_id === care.reported_by && await trx.selectFrom("school_memberships as member").innerJoin("users as account", "account.id", "member.user_id")
      .select("member.id").where("member.school_id", "=", care.school_id).where("member.user_id", "=", care.reported_by).where("member.is_active", "=", true)
      .where("account.is_active", "=", true).where("member.role", "in", ["admin", "staff"]).executeTakeFirst();
    if (reporterActive) await trx.insertInto("restricted_care_case_assignments").values({ school_id: care.school_id, case_id: care.id, user_id: care.reported_by, assignment_role: "reporter", access_level: "intake_only", assigned_by: user.id, revoked_by: null, assigned_at: executionNow() }).execute();
    const existing = await trx.selectFrom("restricted_care_case_assignments").select("id").where("school_id", "=", care.school_id).where("case_id", "=", care.id).where("user_id", "=", input.owner_user_id).where("revoked_at", "is", null).executeTakeFirst();
    if (existing) await trx.updateTable("restricted_care_case_assignments").set({ assignment_role: "owner", access_level: "full", assigned_by: user.id, assigned_at: executionNow() }).where("id", "=", existing.id).execute();
    else await trx.insertInto("restricted_care_case_assignments").values({ school_id: care.school_id, case_id: care.id, user_id: input.owner_user_id, assignment_role: "owner", access_level: "full", assigned_by: user.id, revoked_by: null, assigned_at: executionNow() }).execute();
    const entryId = randomUUID(), encrypted = this.encrypt(input.note, `${care.school_id}:${care.id}:${entryId}:handover`);
    await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: care.school_id, case_id: care.id, entry_type: "handover", ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id, created_at: executionNow() }).execute();
    return trx.updateTable("restricted_care_cases").set({ owner_user_id: input.owner_user_id, last_activity_at: executionNow() }).where("school_id", "=", care.school_id)
      .where("id", "=", care.id).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
  }

  async recoverOwner(user: AuthUser, schoolId: string, caseId: string, body: unknown) {
    uuid.parse(caseId); const input = orphanInput.parse(body);
    return this.db.transaction().execute(async trx => {
      await this.admin(user, schoolId, trx);
      const care = await trx.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", schoolId).where("id", "=", caseId).forUpdate().executeTakeFirst();
      if (!care) throw new NotFoundException("Protected recovery record was not found.");
      const retained = await this.model.retained(trx, user, schoolId, input.command_id);
      if (!retained && (care.status === "closed" || await this.currentOwner(trx, care, true))) refuseCareCommand(input.command_id, care.id, "recovery_not_applicable", "This case no longer needs owner recovery. Review the current queue.");
      const command = await this.model.prepare(trx, user, care, "orphan.reassign", input, { administrator_user_id: user.id, previous_owner_user_id: care.owner_user_id, recovery_scope: "owner_routing_only" });
      if (command.replay) return this.nativeReceipt(trx, user, schoolId, command.receipt_id);
      const updated = await this.transfer(trx, user, care, input);
      return this.finishAction(trx, user, updated, command.prepared, "restricted_care.case.recovered");
    });
  }

  async act(user: AuthUser, schoolId: string, caseId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.membership(user, schoolId, trx); uuid.parse(caseId);
      const input = actionInput.parse(body);
      const careCase = await trx.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", schoolId).where("id", "=", caseId).forUpdate().executeTakeFirst();
      if (!careCase) throw new NotFoundException("Protected care case was not found.");
      const retained = await this.model.retained(trx, user, schoolId, input.command_id);
      if (retained) {
        const replay = await this.model.prepare(trx, user, careCase, input.action, input, { actor_user_id: user.id, confirmation_scope: "own_exact_accepted_receipt_only" });
        if (!replay.replay) throw new ConflictException("Check this exact protected receipt before continuing.");
        return this.nativeReceipt(trx, user, schoolId, replay.receipt_id);
      }
      const access = await this.caseAccess(user, schoolId, caseId, trx);
      if (access.access_level !== "full") throw new ForbiddenException("Your reporter receipt does not grant access to case handling notes.");
      if (careCase.status === "closed") refuseCareCommand(input.command_id, careCase.id, "case_closed", "This case is closed. Review the current protected record.");
      const command = await this.model.prepare(trx, user, careCase, input.action, input, { case_assignment: access.assignment_role, actor_user_id: user.id });
      if (command.replay) return this.nativeReceipt(trx, user, schoolId, command.receipt_id);
      if (input.action === "reassign") {
        if (access.assignment_role !== "owner") throw new ForbiddenException("Only the current case owner can hand over ownership.");
        const updated = await this.transfer(trx, user, careCase, input);
        return this.finishAction(trx, user, updated, command.prepared, "restricted_care.case.reassigned");
      }
      if (input.action === "reporting_decision") {
        if (!(["owner", "reviewer"] as string[]).includes(access.assignment_role)) throw new ForbiddenException("Only the owner or assigned reviewer can record the reporting assessment.");
        const entryId = randomUUID(); const encrypted = this.encrypt(input.rationale, `${schoolId}:${caseId}:${entryId}:reporting_decision`);
        await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: "reporting_decision", ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id }).execute();
        const updated = await trx.updateTable("restricted_care_cases").set({ reporting_state: input.reporting_state, status: "active", last_activity_at: executionNow() }).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
        return this.finishAction(trx, user, updated, command.prepared, "restricted_care.reporting.assessed");
      }
      if (input.action === "external_report") {
        if (!(["owner", "reviewer"] as string[]).includes(access.assignment_role)) throw new ForbiddenException("Only the owner or assigned reviewer can record external reporting evidence.");
        if (new Date(input.reported_at) > executionNow()) throw new BadRequestException("Reported at cannot be later than the current campus time.");
        const reportId = randomUUID(); const encrypted = this.encrypt(input.reference, `${schoolId}:${caseId}:${reportId}:external_report`);
        await trx.insertInto("restricted_care_external_reports").values({ id: reportId, school_id: schoolId, case_id: caseId, authority_type: input.authority_type, reported_at: new Date(input.reported_at), reference_ciphertext: encrypted.ciphertext, reference_iv: encrypted.iv, reference_tag: encrypted.tag, recorded_by: user.id, created_at: executionNow() }).execute();
        const updated = await trx.updateTable("restricted_care_cases").set({ reporting_state: "reported", status: "active", last_activity_at: executionNow() }).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
        return this.finishAction(trx, user, updated, command.prepared, "restricted_care.external_report.recorded");
      }
      const entryType: RestrictedCareCaseEntryTable["entry_type"] = input.action === "transition" && input.status === "closed" ? "outcome" : input.action === "transition" ? "case_note" : input.entry_type;
      const note = input.note;
      const entryId = randomUUID(); const encrypted = this.encrypt(note, `${schoolId}:${caseId}:${entryId}:${entryType}`);
      await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: entryType, ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id }).execute();
      if (input.action === "transition" && input.status === "closed" && ["assessment_required", "reporting_required"].includes(careCase.reporting_state)) {
        refuseCareCommand(input.command_id, careCase.id, "reporting_incomplete", "Record the reporting assessment and any required external report before closure.");
      }
      const updates = input.action === "transition"
        ? { status: input.status, last_activity_at: executionNow(), ...(input.status === "closed" ? { closed_at: executionNow(), closed_by: user.id, retention_review_on: new Date(executionNow().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) } : {}) }
        : { last_activity_at: executionNow() };
      const updated = await trx.updateTable("restricted_care_cases").set(updates).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
      const eventType = input.action === "transition" ? `restricted_care.case.${input.status}` : "restricted_care.case.entry_added";
      return this.finishAction(trx, user, updated, command.prepared, eventType, { entry_type: entryType });
    });
  }
}
