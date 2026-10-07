import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database, RestrictedCareCaseEntryTable } from "../database/types.js";
import { assertActiveSchoolStaffMember } from "../roles/authorization.js";

type Db = Kysely<Database> | Transaction<Database>;
type StaffRole = "admin" | "staff";
type CaseAccess = { assignment_role: "reporter" | "owner" | "backup" | "contributor" | "reviewer"; access_level: "intake_only" | "full" };

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
]);

@Injectable()
export class RestrictedCareService {
  private readonly encryptionKey = createHash("sha256").update(config().restrictedCaseEncryptionKey).digest();

  constructor(private readonly db: DatabaseService) {}

  private async membership(user: AuthUser, schoolId: string, db: Db = this.db): Promise<StaffRole> {
    uuid.parse(schoolId);
    const membership = await db.selectFrom("school_memberships").select("role")
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true)
      .where("role", "in", ["admin", "staff"]).executeTakeFirst();
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
    await db.insertInto("restricted_care_audits").values({ school_id: schoolId, case_id: caseId, actor_id: user.id, action, metadata }).execute();
  }

  private async enqueue(db: Transaction<Database>, schoolId: string, caseId: string, revision: number, eventType: string) {
    const recipients = await db.selectFrom("restricted_care_case_assignments").select("user_id")
      .where("school_id", "=", schoolId).where("case_id", "=", caseId).where("revoked_at", "is", null).execute();
    const audience = [...new Set(recipients.map((item) => item.user_id))];
    await db.insertInto("event_outbox").values({
      school_id: schoolId, event_type: eventType, aggregate_type: "restricted_care_case", aggregate_id: caseId,
      audience_user_ids: audience, payload: { case_id: caseId, revision },
      idempotency_key: `${eventType}:${caseId}:${revision}`, notification_user_ids: audience,
      notification_payload: { title: "Protected care case updated", body: "Open the restricted care workspace for the latest authorized update." } as any,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
  }

  private async caseAccess(user: AuthUser, schoolId: string, caseId: string, db: Db = this.db): Promise<CaseAccess> {
    uuid.parse(caseId);
    await this.membership(user, schoolId, db);
    const access = await db.selectFrom("restricted_care_case_assignments").select(["assignment_role", "access_level"])
      .where("school_id", "=", schoolId).where("case_id", "=", caseId).where("user_id", "=", user.id)
      .where("revoked_at", "is", null).executeTakeFirst();
    if (!access) throw new NotFoundException("Protected care case was not found.");
    return access;
  }

  private async eligibleStudent(user: AuthUser, schoolId: string, studentId: string, role: StaffRole, db: Db) {
    const row = await sql<{ allowed: boolean }>`SELECT EXISTS(
      SELECT 1 FROM students student
      WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND (
        ${role}='admin' OR EXISTS (
          SELECT 1 FROM enrollments enrollment
          WHERE enrollment.student_id=student.id AND enrollment.is_active AND (
            EXISTS (SELECT 1 FROM class_section_staff_assignments assignment
              WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${user.id}::uuid
                AND assignment.class_section_id=enrollment.class_section_id
                AND assignment.valid_from<=CURRENT_DATE AND (assignment.valid_until IS NULL OR assignment.valid_until>=CURRENT_DATE))
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
      WHERE role_assignment.school_id=${schoolId}::uuid AND role_assignment.status='active'
        AND role_assignment.valid_from<=CURRENT_DATE AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until>=CURRENT_DATE)
      GROUP BY route_kind`.execute(this.db);
    const eligibleStudents = role === "admin"
      ? await sql<Record<string, unknown>>`SELECT student.id,student.admission_number,
          COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),trim(concat_ws(' ',student_user.first_name,student_user.last_name))) AS name
        FROM students student LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN users student_user ON student_user.id=student.user_id
        WHERE student.school_id=${schoolId}::uuid ORDER BY name LIMIT 400`.execute(this.db)
      : await sql<Record<string, unknown>>`SELECT DISTINCT student.id,student.admission_number,
          COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),trim(concat_ws(' ',student_user.first_name,student_user.last_name))) AS name
        FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
        LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN users student_user ON student_user.id=student.user_id
        WHERE student.school_id=${schoolId}::uuid AND (
          EXISTS (SELECT 1 FROM class_section_staff_assignments assignment WHERE assignment.school_id=${schoolId}::uuid
            AND assignment.user_id=${user.id}::uuid AND assignment.class_section_id=enrollment.class_section_id
            AND assignment.valid_from<=CURRENT_DATE AND (assignment.valid_until IS NULL OR assignment.valid_until>=CURRENT_DATE))
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

  async assignTeamMember(user: AuthUser, schoolId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      await this.admin(user, schoolId, trx);
      const input = teamAssignmentInput.parse(body);
      const member = await trx.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId)
        .where("user_id", "=", input.user_id).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).executeTakeFirst();
      if (!member) throw new BadRequestException("The selected person must have an active staff membership.");
      await assertActiveSchoolStaffMember(trx, input.user_id, schoolId, "safety_officer");
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
      const updated = await trx.updateTable("restricted_care_role_assignments").set({ status: "revoked", revoked_by: user.id, revoked_at: new Date(), revocation_reason: input.reason })
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
      if (input.student_id) await this.eligibleStudent(user, schoolId, input.student_id, role, trx);
      const ownerResult = await sql<{ user_id: string }>`SELECT role_assignment.user_id FROM restricted_care_role_assignments role_assignment
        JOIN school_memberships membership ON membership.school_id=role_assignment.school_id AND membership.user_id=role_assignment.user_id
          AND membership.is_active AND membership.role IN ('admin','staff')
        WHERE role_assignment.school_id=${schoolId}::uuid AND role_assignment.route_kind=${input.intake_route}
          AND role_assignment.status='active' AND role_assignment.valid_from<=CURRENT_DATE
          AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until>=CURRENT_DATE)
          AND (${input.ordinary_handler_involved}::boolean=false OR role_assignment.user_id<>${user.id}::uuid)
        ORDER BY CASE role_assignment.role_kind WHEN 'designated_lead' THEN 1 WHEN 'deputy_lead' THEN 2
          WHEN 'institution_head' THEN 3 WHEN 'counsellor' THEN 4 ELSE 5 END,role_assignment.created_at LIMIT 1 FOR UPDATE OF role_assignment`.execute(trx);
      const ownerId = ownerResult.rows[0]?.user_id;
      if (!ownerId) throw new ConflictException(`${input.intake_route === "alternate" ? "Alternate" : "Primary"} protected recipient is not configured. Use the institution's approved external or emergency route; do not wait for this form.`);
      const caseId = randomUUID();
      const entryId = randomUUID();
      const protectedNote = this.encrypt(input.details, `${schoolId}:${caseId}:${entryId}:intake_note`);
      const careCase = await trx.insertInto("restricted_care_cases").values({
        id: caseId, school_id: schoolId, student_id: input.student_id, reported_by: user.id, owner_user_id: ownerId,
        intake_route: input.intake_route, source_kind: input.source_kind, urgency: input.urgency,
        concern_category: input.concern_category, safety_state: input.safety_state,
        ordinary_handler_involved: input.ordinary_handler_involved, observed_at: input.observed_at ? new Date(input.observed_at) : null,
        closed_by: null, retention_review_on: null,
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
      await this.audit(trx, user, schoolId, caseId, "restricted_care.case.opened", { route: input.intake_route, revision: careCase.revision, owner_assigned: true });
      await this.enqueue(trx, schoolId, caseId, careCase.revision, "restricted_care.case.opened");
      return { id: caseId, revision: careCase.revision, status: careCase.status, owner_user_id: ownerId, receipt: "Concern recorded in the restricted workspace. This receipt is not proof that an external report was made." };
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
    if (access.access_level === "intake_only") {
      return { case: item, access, entries: visibleEntries, external_reports: [], audits: [] };
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
    return { case: item, access, entries: visibleEntries, external_reports: externalReports, audits: audits.rows };
  }

  async act(user: AuthUser, schoolId: string, caseId: string, body: unknown) {
    return this.db.transaction().execute(async (trx) => {
      const access = await this.caseAccess(user, schoolId, caseId, trx);
      if (access.access_level !== "full") throw new ForbiddenException("Your reporter receipt does not grant access to case handling notes.");
      const input = actionInput.parse(body);
      const careCase = await trx.selectFrom("restricted_care_cases").selectAll().where("school_id", "=", schoolId).where("id", "=", caseId).forUpdate().executeTakeFirst();
      if (!careCase) throw new NotFoundException("Protected care case was not found.");
      if (careCase.revision !== input.expected_revision) throw new ConflictException("The case changed. Reload the protected workspace before continuing.");
      if (careCase.status === "closed") throw new ConflictException("A closed case cannot be changed in this release. Use the institution's controlled reopening procedure.");
      if (input.action === "reassign") {
        if (access.assignment_role !== "owner") throw new ForbiddenException("Only the current case owner can hand over ownership.");
        const target = await sql<{ id: string }>`SELECT role_assignment.id FROM restricted_care_role_assignments role_assignment
          JOIN school_memberships membership ON membership.school_id=role_assignment.school_id AND membership.user_id=role_assignment.user_id
            AND membership.is_active AND membership.role IN ('admin','staff')
          WHERE role_assignment.school_id=${schoolId}::uuid AND role_assignment.user_id=${input.owner_user_id}::uuid
            AND role_assignment.status='active' AND role_assignment.valid_from<=CURRENT_DATE
            AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until>=CURRENT_DATE) LIMIT 1`.execute(trx);
        if (!target.rows[0]) throw new BadRequestException("The new owner needs a current restricted-care role assignment.");
        await trx.updateTable("restricted_care_case_assignments").set({ revoked_by: user.id, revoked_at: new Date(), revocation_reason: input.note })
          .where("case_id", "=", caseId).where("user_id", "=", careCase.owner_user_id).where("assignment_role", "=", "owner").where("revoked_at", "is", null).execute();
        const existing = await trx.selectFrom("restricted_care_case_assignments").select("id").where("case_id", "=", caseId).where("user_id", "=", input.owner_user_id).where("revoked_at", "is", null).executeTakeFirst();
        if (existing) await trx.updateTable("restricted_care_case_assignments").set({ assignment_role: "owner", access_level: "full" }).where("id", "=", existing.id).execute();
        else await trx.insertInto("restricted_care_case_assignments").values({ school_id: schoolId, case_id: caseId, user_id: input.owner_user_id, assignment_role: "owner", access_level: "full", assigned_by: user.id, revoked_by: null }).execute();
        const entryId = randomUUID(); const encrypted = this.encrypt(input.note, `${schoolId}:${caseId}:${entryId}:handover`);
        await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: "handover", ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id }).execute();
        const updated = await trx.updateTable("restricted_care_cases").set({ owner_user_id: input.owner_user_id, last_activity_at: new Date() }).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
        await this.audit(trx, user, schoolId, caseId, "restricted_care.case.reassigned", { revision: updated.revision });
        await this.enqueue(trx, schoolId, caseId, updated.revision, "restricted_care.case.reassigned");
        return updated;
      }
      if (input.action === "reporting_decision") {
        if (!(["owner", "reviewer"] as string[]).includes(access.assignment_role)) throw new ForbiddenException("Only the owner or assigned reviewer can record the reporting assessment.");
        const entryId = randomUUID(); const encrypted = this.encrypt(input.rationale, `${schoolId}:${caseId}:${entryId}:reporting_decision`);
        await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: "reporting_decision", ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id }).execute();
        const updated = await trx.updateTable("restricted_care_cases").set({ reporting_state: input.reporting_state, status: "active", last_activity_at: new Date() }).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
        await this.audit(trx, user, schoolId, caseId, "restricted_care.reporting.assessed", { reporting_state: input.reporting_state, revision: updated.revision });
        await this.enqueue(trx, schoolId, caseId, updated.revision, "restricted_care.reporting.assessed");
        return updated;
      }
      if (input.action === "external_report") {
        if (!(["owner", "reviewer"] as string[]).includes(access.assignment_role)) throw new ForbiddenException("Only the owner or assigned reviewer can record external reporting evidence.");
        const reportId = randomUUID(); const encrypted = this.encrypt(input.reference, `${schoolId}:${caseId}:${reportId}:external_report`);
        await trx.insertInto("restricted_care_external_reports").values({ id: reportId, school_id: schoolId, case_id: caseId, authority_type: input.authority_type, reported_at: new Date(input.reported_at), reference_ciphertext: encrypted.ciphertext, reference_iv: encrypted.iv, reference_tag: encrypted.tag, recorded_by: user.id }).execute();
        const updated = await trx.updateTable("restricted_care_cases").set({ reporting_state: "reported", status: "active", last_activity_at: new Date() }).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
        await this.audit(trx, user, schoolId, caseId, "restricted_care.external_report.recorded", { authority_type: input.authority_type, revision: updated.revision });
        await this.enqueue(trx, schoolId, caseId, updated.revision, "restricted_care.external_report.recorded");
        return updated;
      }
      const entryType: RestrictedCareCaseEntryTable["entry_type"] = input.action === "transition" && input.status === "closed" ? "outcome" : input.action === "transition" ? "case_note" : input.entry_type;
      const note = input.note;
      const entryId = randomUUID(); const encrypted = this.encrypt(note, `${schoolId}:${caseId}:${entryId}:${entryType}`);
      await trx.insertInto("restricted_care_case_entries").values({ id: entryId, school_id: schoolId, case_id: caseId, entry_type: entryType, ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_tag: encrypted.tag, created_by: user.id }).execute();
      if (input.action === "transition" && input.status === "closed" && ["assessment_required", "reporting_required"].includes(careCase.reporting_state)) {
        throw new ConflictException("Record the reporting assessment and any required external report before closure.");
      }
      const updates = input.action === "transition"
        ? { status: input.status, last_activity_at: new Date(), ...(input.status === "closed" ? { closed_at: new Date(), closed_by: user.id, retention_review_on: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) } : {}) }
        : { last_activity_at: new Date() };
      const updated = await trx.updateTable("restricted_care_cases").set(updates).where("id", "=", caseId).where("revision", "=", input.expected_revision).returningAll().executeTakeFirstOrThrow();
      const eventType = input.action === "transition" ? `restricted_care.case.${input.status}` : "restricted_care.case.entry_added";
      await this.audit(trx, user, schoolId, caseId, eventType, { entry_type: entryType, revision: updated.revision });
      await this.enqueue(trx, schoolId, caseId, updated.revision, eventType);
      return updated;
    });
  }
}
