import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { accessRoleCatalogue, staffRoleAssignments } from "../roles/access-roles.service.js";
import { roleOptions } from "../roles/scoped-role-policy.js";

type Db = Kysely<Database> | Transaction<Database>;
type MembershipRole = "staff" | "admin";
const uuid = z.string().uuid();
const date = z.iso.date();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const profileInput = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).default(""),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().max(30).default(""),
  staff_code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/),
  staff_kind: z.enum(["teaching", "non_teaching"]),
  designation: z.string().trim().min(2).max(120),
  department: z.string().trim().max(120).default(""),
  employment_type: z.enum(["full_time", "part_time", "contract"]),
  joined_on: date,
});
const policyInput = z.object({
  academic_year: z.string().trim().min(4).max(20),
  code: z.string().trim().min(2).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  annual_allowance: z.coerce.number().min(0).max(366),
  carry_forward_limit: z.coerce.number().min(0).max(366).default(0),
  requires_document_after_days: z.coerce.number().positive().max(366).nullable().default(null),
  is_paid: z.boolean().default(true),
  is_statutory: z.boolean().default(false),
  is_active: z.boolean().default(true),
  expected_revision: z.number().int().positive().optional(),
});
const assignmentInput = z.object({
  responsibility_type_id: uuid,
  staff_profile_id: uuid,
  class_section_id: uuid.nullable().default(null),
  subject_id: uuid.nullable().default(null),
  event_id: uuid.nullable().default(null),
  scope_label: z.string().trim().max(180).default(""),
  location: z.string().trim().max(120).default(""),
  starts_on: date,
  ends_on: date.nullable().default(null),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  notes: z.string().trim().max(1000).default(""),
  backup_staff_profile_id: uuid.nullable().default(null),
});
export { profileInput, policyInput, assignmentInput };

@Injectable()
export class StaffOperationsService {
  constructor(private readonly db: DatabaseService) {}

  private async membership(user: AuthUser, schoolId: string, roles: MembershipRole[], db: Db = this.db) {
    uuid.parse(schoolId);
    const result = await db.selectFrom("school_memberships").select("role")
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true)
      .where("role", "in", roles).orderBy(sql`role='admin'`, "desc").executeTakeFirst();
    if (!result) throw new ForbiddenException("Active school staff access is required.");
    return result as { role: MembershipRole };
  }

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    return this.membership(user, schoolId, ["admin"], db);
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, action: string, targetId: string, metadata: Record<string, unknown> = {}) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES (${schoolId}::uuid,${user.id}::uuid,${action},${targetId}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }

  private async enqueue(db: Transaction<Database>, schoolId: string, requestId: string, event: string, audience: string[], notificationUsers: string[], notification: Record<string, unknown> | null, payload: Record<string, unknown>, aggregateType = "staff_leave_request") {
    const revision = typeof payload.revision === "number" ? payload.revision : 1;
    await db.insertInto("event_outbox").values({
      school_id: schoolId, event_type: event, aggregate_type: aggregateType, aggregate_id: requestId,
      audience_user_ids: [...new Set(audience)], payload,
      idempotency_key: `${event}:${requestId}:${revision}`,
      notification_user_ids: [...new Set(notificationUsers)], notification_payload: notification as any,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
  }

  private async createCoverageTasks(db: Transaction<Database>, user: AuthUser, schoolId: string, request: { id: string; staff_profile_id: string; starts_on: string; ends_on: string; portion: string; handover_note: string }, profile: { user_id: string | null }) {
    const scheduleTasks = await sql<{ id: string }>`INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,source_schedule_id,class_section_id,subject_id,
        duty_date,period_number,starts_at,ends_at,title,location,handover_note)
      SELECT ${schoolId}::uuid,${request.id}::uuid,${request.staff_profile_id}::uuid,schedule.id,schedule.class_section_id,schedule.subject_id,
        day::date,schedule.period_number,schedule.starts_at,schedule.ends_at,schedule.title,schedule.room,${request.handover_note}
      FROM generate_series(${request.starts_on}::date,${request.ends_on}::date,interval '1 day') day
      CROSS JOIN LATERAL effective_school_schedule(${schoolId}::uuid,day::date) schedule
      WHERE schedule.teacher_user_id=${profile.user_id}::uuid AND schedule.slot_type='class' AND NOT schedule.cancelled
        AND (${request.portion}='full_day' OR (${request.portion}='first_half' AND schedule.starts_at < time '12:00') OR (${request.portion}='second_half' AND schedule.starts_at >= time '12:00'))
      ON CONFLICT DO NOTHING RETURNING id`.execute(db);
    const responsibilityTasks = await sql<{ id: string }>`INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,responsibility_assignment_id,class_section_id,subject_id,
        duty_date,starts_at,ends_at,title,location,handover_note)
      SELECT assignment.school_id,${request.id}::uuid,assignment.staff_profile_id,assignment.id,assignment.class_section_id,assignment.subject_id,
        assignment.starts_on,assignment.starts_at,assignment.ends_at,type.name || CASE WHEN assignment.scope_label='' THEN '' ELSE ' · ' || assignment.scope_label END,
        assignment.location,${request.handover_note}
      FROM staff_responsibility_assignments assignment
      JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.staff_profile_id=${request.staff_profile_id}::uuid
        AND assignment.status='active' AND type.scope_kind IN ('event','scheduled_duty')
        AND assignment.starts_on BETWEEN ${request.starts_on}::date AND ${request.ends_on}::date
        AND (${request.portion}='full_day' OR assignment.starts_at IS NULL OR (${request.portion}='first_half' AND assignment.starts_at < time '12:00') OR (${request.portion}='second_half' AND assignment.starts_at >= time '12:00'))
      ON CONFLICT DO NOTHING RETURNING id`.execute(db);
    const ids = [...scheduleTasks.rows, ...responsibilityTasks.rows].map((row) => row.id);
    if (ids.length) {
      await db.insertInto("staff_coverage_task_audits").values(ids.map((task_id) => ({ school_id: schoolId, task_id, actor_id: user.id, action: "created" as const, from_status: null, to_status: "open", note: "Created automatically from approved leave." }))).execute();
    }
    return ids.length;
  }

  async workspace(user: AuthUser, schoolId: string) {
    const member = await this.membership(user, schoolId, ["admin", "staff"]);
    const [accessRoles, roleAssignments] = await Promise.all([
      member.role === "admin" ? accessRoleCatalogue(this.db, schoolId) : Promise.resolve([]),
      staffRoleAssignments(this.db, schoolId, member.role === "staff" ? user.id : undefined),
    ]);
    const access = { access_roles: accessRoles, role_assignments: roleAssignments,
      ...(member.role === "admin" ? { role_options: roleOptions() } : {}) };
    const yearResult = await sql<{ academic_year: string }>`SELECT academic_year FROM academic_terms
      WHERE school_id=${schoolId}::uuid ORDER BY is_active DESC,(CURRENT_DATE BETWEEN starts_on AND ends_on) DESC,starts_on DESC LIMIT 1`.execute(this.db);
    const academicYear = yearResult.rows[0]?.academic_year ?? "";
    const policies = await sql`SELECT * FROM staff_leave_policies WHERE school_id=${schoolId}::uuid
      AND (${academicYear}='' OR academic_year=${academicYear}) ORDER BY is_active DESC,name`.execute(this.db);
    const requests = await sql`SELECT r.*,p.name AS policy_name,p.code AS policy_code,
        profile.first_name,profile.last_name,profile.staff_code,profile.designation,profile.user_id,
        COALESCE((SELECT count(*)::int FROM generate_series(r.starts_on,r.ends_on,interval '1 day') day
          CROSS JOIN LATERAL effective_school_schedule(r.school_id,day::date) schedule
          WHERE schedule.teacher_user_id=profile.user_id AND schedule.slot_type='class'),0) AS affected_periods,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id),0) AS coverage_tasks,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status IN ('open','declined')),0) AS coverage_open
      FROM staff_leave_requests r JOIN staff_profiles profile ON profile.id=r.staff_profile_id
      JOIN staff_leave_policies p ON p.id=r.policy_id
      WHERE r.school_id=${schoolId}::uuid
        AND (${member.role}='admin' OR profile.user_id=${user.id}::uuid)
      ORDER BY (r.status='submitted') DESC,r.starts_on DESC,r.created_at DESC LIMIT 100`.execute(this.db);

    const responsibilityTypes = await sql`SELECT type.*,
        COALESCE((SELECT count(*)::int FROM staff_responsibility_assignments assignment
          WHERE assignment.responsibility_type_id=type.id AND assignment.status IN ('offered','active')),0) AS active_assignment_count
      FROM staff_responsibility_types type
      WHERE type.school_id=${schoolId}::uuid AND (${member.role}='admin' OR type.is_active)
      ORDER BY type.is_active DESC,type.category,type.name`.execute(this.db);
    const assignments = await sql<any>`SELECT assignment.*,type.code AS type_code,type.name AS type_name,type.category,type.scope_kind,
        type.description,type.access_summary,type.requires_acceptance,type.restricted,
        profile.first_name,profile.last_name,profile.staff_code,profile.designation,profile.user_id,profile_user.avatar_url,
        backup.first_name AS backup_first_name,backup.last_name AS backup_last_name,
        CASE WHEN section.id IS NULL THEN NULL ELSE 'Class ' || section.grade || section.section END AS class_name,
        subject.name AS subject_name,event.title AS event_title
      FROM staff_responsibility_assignments assignment
      JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
      JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
      LEFT JOIN users profile_user ON profile_user.id=profile.user_id
      LEFT JOIN staff_profiles backup ON backup.id=assignment.backup_staff_profile_id
      LEFT JOIN class_sections section ON section.id=assignment.class_section_id
      LEFT JOIN subjects subject ON subject.id=assignment.subject_id
      LEFT JOIN campus_events event ON event.id=assignment.event_id
      WHERE assignment.school_id=${schoolId}::uuid
        AND (${member.role}='admin' OR profile.user_id=${user.id}::uuid)
      ORDER BY (assignment.status='offered') DESC,(assignment.status='active') DESC,assignment.starts_on,assignment.created_at DESC`.execute(this.db);
    const coverageTasks = await sql`SELECT task.*,
        absent.first_name AS absent_first_name,absent.last_name AS absent_last_name,absent.designation AS absent_designation,
        replacement.first_name AS replacement_first_name,replacement.last_name AS replacement_last_name,replacement.user_id AS replacement_user_id,
        CASE WHEN section.id IS NULL THEN '' ELSE 'Class ' || section.grade || section.section END AS class_name,
        subject.name AS subject_name,leave_request.reason AS leave_reason
      FROM staff_coverage_tasks task
      JOIN staff_profiles absent ON absent.id=task.absent_staff_profile_id
      LEFT JOIN staff_profiles replacement ON replacement.id=task.replacement_staff_profile_id
      LEFT JOIN class_sections section ON section.id=task.class_section_id
      LEFT JOIN subjects subject ON subject.id=task.subject_id
      JOIN staff_leave_requests leave_request ON leave_request.id=task.leave_request_id
      WHERE task.school_id=${schoolId}::uuid
        AND (${member.role}='admin' OR absent.user_id=${user.id}::uuid OR replacement.user_id=${user.id}::uuid)
      ORDER BY task.duty_date,task.starts_at NULLS LAST,task.period_number NULLS LAST`.execute(this.db);
    if (member.role === "staff") {
      const profile = await sql`SELECT profile.*,u.avatar_url FROM staff_profiles profile LEFT JOIN users u ON u.id=profile.user_id
        WHERE profile.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid`.execute(this.db);
      if (!profile.rows[0]) throw new NotFoundException("Your staff profile is not ready. Ask the school office to complete onboarding.");
      const balances = await sql`SELECT p.id AS policy_id,p.code,p.name,p.annual_allowance,p.carry_forward_limit,p.requires_document_after_days,
          p.is_paid,p.is_statutory,p.academic_year,
          COALESCE((SELECT sum(a.days) FROM staff_leave_balance_adjustments a WHERE a.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND a.policy_id=p.id),0) AS adjustments,
          COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND r.policy_id=p.id AND r.status='approved'),0) AS used,
          COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND r.policy_id=p.id AND r.status='submitted'),0) AS pending
        FROM staff_leave_policies p WHERE p.school_id=${schoolId}::uuid AND p.academic_year=${academicYear} AND p.is_active ORDER BY p.name`.execute(this.db);
      return { ...access, mode: "staff", academic_year: academicYear, profile: profile.rows[0], policies: policies.rows, balances: balances.rows, requests: requests.rows, work_types: responsibilityTypes.rows, responsibility_types: responsibilityTypes.rows, assignments: assignments.rows, coverage_tasks: coverageTasks.rows };
    }

    const profiles = await sql`SELECT profile.*,u.avatar_url,
        count(item.id)::int AS onboarding_total,count(item.completed_at)::int AS onboarding_complete,
        COALESCE((SELECT count(*)::int FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.status='submitted'),0) AS pending_requests
      FROM staff_profiles profile LEFT JOIN users u ON u.id=profile.user_id
      LEFT JOIN staff_onboarding_items item ON item.staff_profile_id=profile.id
      WHERE profile.school_id=${schoolId}::uuid GROUP BY profile.id,u.avatar_url ORDER BY profile.status,profile.first_name,profile.last_name`.execute(this.db);
    const items = await sql`SELECT item.* FROM staff_onboarding_items item JOIN staff_profiles profile ON profile.id=item.staff_profile_id
      WHERE profile.school_id=${schoolId}::uuid ORDER BY item.staff_profile_id,item.label`.execute(this.db);
    const balances = await sql`SELECT profile.id AS staff_profile_id,p.id AS policy_id,p.name,p.code,p.annual_allowance,
        COALESCE((SELECT sum(a.days) FROM staff_leave_balance_adjustments a WHERE a.staff_profile_id=profile.id AND a.policy_id=p.id),0) AS adjustments,
        COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.policy_id=p.id AND r.status='approved'),0) AS used,
        COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.policy_id=p.id AND r.status='submitted'),0) AS pending
      FROM staff_profiles profile CROSS JOIN staff_leave_policies p
      WHERE profile.school_id=${schoolId}::uuid AND p.school_id=${schoolId}::uuid AND p.academic_year=${academicYear} AND p.is_active`.execute(this.db);
    const classes = await sql`SELECT id,'Class ' || grade || section AS name FROM class_sections WHERE school_id=${schoolId}::uuid AND academic_year=${academicYear} ORDER BY grade,section`.execute(this.db);
    const subjects = await sql`SELECT id,name FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(this.db);
    const events = await sql`SELECT id,title,starts_at,ends_at FROM campus_events WHERE school_id=${schoolId}::uuid AND status IN ('draft','published') AND ends_at >= now() - interval '1 day' ORDER BY starts_at LIMIT 100`.execute(this.db);
    return { ...access, mode: "admin", academic_year: academicYear, profiles: profiles.rows, onboarding_items: items.rows, policies: policies.rows, balances: balances.rows, requests: requests.rows, work_types: responsibilityTypes.rows, responsibility_types: responsibilityTypes.rows, assignments: assignments.rows, coverage_tasks: coverageTasks.rows, references: { classes: classes.rows, subjects: subjects.rows, events: events.rows } };
  }


  async createProfile(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = profileInput.parse(body);
    try {
      return await this.db.transaction().execute(async (db) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
        await this.principal(user, schoolId, db);
        const account = await sql<{ id: string }>`SELECT u.id FROM users u JOIN school_memberships m ON m.user_id=u.id
          WHERE m.school_id=${schoolId}::uuid AND m.role='staff' AND m.is_active AND lower(u.email)=${data.email} LIMIT 1`.execute(db);
        const profile = await db.insertInto("staff_profiles").values({
          school_id: schoolId, user_id: account.rows[0]?.id ?? null, staff_code: data.staff_code,
          first_name: data.first_name, last_name: data.last_name, email: data.email, phone: data.phone,
          staff_kind: data.staff_kind, designation: data.designation, department: data.department,
          employment_type: data.employment_type, joined_on: data.joined_on,
          status: account.rows[0] ? "onboarding" : "onboarding", created_by: user.id, updated_by: user.id,
        }).returningAll().executeTakeFirstOrThrow();
        const labels = [
          ["identity", "Identity verified"], ["service_contract", "Service contract recorded"],
          ["qualifications", "Qualifications checked"], ["emergency_contact", "Emergency contact recorded"],
          ["account_access", "School account active"],
        ] as const;
        await db.insertInto("staff_onboarding_items").values(labels.map(([item_key, label]) => ({
          school_id: schoolId, staff_profile_id: profile.id, item_key, label,
          ...(item_key === "account_access" && account.rows[0] ? { completed_at: new Date(), completed_by: user.id } : {}),
        }))).execute();
        let invitation: { token: string; expires_at: Date; id: string } | null = null;
        if (!account.rows[0]) {
          const token = randomBytes(32).toString("base64url");
          await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid AND lower(email)=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
          const invite = await sql<{ id: string; expires_at: Date }>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at)
            VALUES (${schoolId}::uuid,${data.email},'staff',${digest(token)},${user.id}::uuid,now()+interval '72 hours') RETURNING id,expires_at`.execute(db);
          invitation = { ...invite.rows[0]!, token };
        }
        await this.audit(db, user, schoolId, "staff.profile.created", profile.id, { staff_kind: profile.staff_kind, position: profile.designation, invitation_created: Boolean(invitation) });
        return { profile, invitation };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("Staff code or email is already in use.");
      throw error;
    }
  }

  async updateOnboarding(user: AuthUser, schoolId: string, profileId: string, body: unknown) {
    uuid.parse(profileId);
    const data = z.object({ item_id: uuid, completed: z.boolean(), note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", profileId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!profile) throw new NotFoundException();
      if (profile.revision !== data.expected_revision) throw new ConflictException("This staff record changed. Refresh before continuing.");
      const item = await db.selectFrom("staff_onboarding_items").selectAll().where("id", "=", data.item_id).where("staff_profile_id", "=", profileId).executeTakeFirst();
      if (!item) throw new NotFoundException();
      await db.updateTable("staff_onboarding_items").set({ completed_at: data.completed ? new Date() : null, completed_by: data.completed ? user.id : null, note: data.note, updated_at: new Date() }).where("id", "=", item.id).execute();
      const remaining = await sql<{ count: number }>`SELECT count(*)::int AS count FROM staff_onboarding_items WHERE staff_profile_id=${profileId}::uuid AND required AND completed_at IS NULL`.execute(db);
      const nextStatus = remaining.rows[0]!.count === 0 && profile.user_id ? "active" : "onboarding";
      const updated = await db.updateTable("staff_profiles").set({ status: nextStatus, updated_by: user.id, updated_at: new Date() }).where("id", "=", profileId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, "staff.onboarding.updated", profileId, { item_key: item.item_key, completed: data.completed, revision: updated.revision });
      return updated;
    });
  }

  async createResponsibility(user: AuthUser, schoolId: string, body: unknown) {
    const data = assignmentInput.parse(body);
    if (data.ends_on && data.ends_on < data.starts_on) throw new BadRequestException("End date cannot be before the start date.");
    if (Boolean(data.starts_at) !== Boolean(data.ends_at) || (data.starts_at && data.ends_at && data.ends_at <= data.starts_at)) throw new BadRequestException("Add a valid start and end time together.");
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const type = await db.selectFrom("staff_responsibility_types").selectAll().where("id", "=", data.responsibility_type_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
      if (!type) throw new NotFoundException("This work type is not available.");
      if(["assessment","trip","restricted_care"].includes(type.context_kind))throw new BadRequestException("Assign this person in the assessment, journey or restricted-care planning screen. A free-text duty cannot grant that access.");
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", data.staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
      if (!profile) throw new BadRequestException("Choose an active staff member.");
      if (!profile.user_id) throw new BadRequestException("Complete account onboarding before assigning work.");
      if (data.backup_staff_profile_id) {
        const backup = await db.selectFrom("staff_profiles").select(["id", "user_id"]).where("id", "=", data.backup_staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
        if (!backup?.user_id) throw new BadRequestException("Choose an active backup staff member.");
      }
      if (type.scope_kind === "class_section" && (!data.class_section_id || data.event_id)) throw new BadRequestException("Choose only a class scope for this work.");
      if (type.scope_kind === "event" && (!data.event_id || data.class_section_id || data.subject_id)) throw new BadRequestException("Choose only an event scope for this work.");
      if (["school", "scheduled_duty"].includes(type.scope_kind) && (data.class_section_id || data.event_id)) throw new BadRequestException("This work does not use a class or event scope.");
      if (type.scope_kind === "scheduled_duty" && (!data.ends_on || !data.starts_at || !data.ends_at)) throw new BadRequestException("Dated duties need an end date and time window.");
      if (data.class_section_id && !(await db.selectFrom("class_sections").select("id").where("id", "=", data.class_section_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose a class in this school.");
      if (data.subject_id && !(await db.selectFrom("subjects").select("id").where("id", "=", data.subject_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose a subject in this school.");
      if (data.event_id && !(await db.selectFrom("campus_events").select("id").where("id", "=", data.event_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose an event in this school.");
      const duplicate = await sql`SELECT 1 FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid
        AND responsibility_type_id=${type.id}::uuid AND staff_profile_id=${profile.id}::uuid AND status IN ('offered','active')
        AND class_section_id IS NOT DISTINCT FROM ${data.class_section_id}::uuid AND subject_id IS NOT DISTINCT FROM ${data.subject_id}::uuid
        AND event_id IS NOT DISTINCT FROM ${data.event_id}::uuid
        AND daterange(starts_on,COALESCE(ends_on,'infinity'::date),'[]') && daterange(${data.starts_on}::date,COALESCE(${data.ends_on}::date,'infinity'::date),'[]') LIMIT 1`.execute(db);
      if (duplicate.rows.length) throw new ConflictException("This work is already assigned for the selected dates.");
      const status = type.requires_acceptance ? "offered" : "active";
      const assignment = await db.insertInto("staff_responsibility_assignments").values({
        school_id: schoolId, responsibility_type_id: type.id, staff_profile_id: profile.id,
        class_section_id: data.class_section_id, subject_id: data.subject_id, event_id: data.event_id,
        scope_label: data.scope_label, location: data.location, starts_on: data.starts_on, ends_on: data.ends_on,
        starts_at: data.starts_at, ends_at: data.ends_at, status, notes: data.notes, assigned_by: user.id,
        backup_staff_profile_id: data.backup_staff_profile_id, responded_at: status === "active" ? new Date() : null,
        revoked_by: null, revoked_at: null,
      }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignment.id, actor_id: user.id, action: status === "active" ? "activated" : "offered", from_status: null, to_status: status }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      const audience = [...admins.rows.map((row) => row.user_id), ...(profile.user_id ? [profile.user_id] : [])];
      await this.enqueue(db, schoolId, assignment.id, `staff.responsibility.${status}`, audience, status === "offered" && profile.user_id ? [profile.user_id] : [], status === "offered" ? { kind: "general", title: "New work assignment", body: `${type.name} needs your response.`, link: "/teacher/responsibilities" } : null, { school_id: schoolId, status, revision: assignment.revision, responsibility_type: type.code }, "staff_responsibility");
      await this.audit(db, user, schoolId, `staff.responsibility.${status}`, assignment.id, { responsibility_type: type.code, staff_profile_id: profile.id });
      return assignment;
    });
  }

  async respondResponsibility(user: AuthUser, schoolId: string, assignmentId: string, body: unknown) {
    uuid.parse(assignmentId);
    const data = z.object({ decision: z.enum(["accepted", "declined"]), note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const result = await sql<any>`SELECT assignment.*,type.name AS type_name,type.code AS type_code,profile.user_id
        FROM staff_responsibility_assignments assignment JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        WHERE assignment.id=${assignmentId}::uuid AND assignment.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid FOR UPDATE`.execute(db);
      const assignment = result.rows[0];
      if (!assignment) throw new NotFoundException();
      if (assignment.status !== "offered" || assignment.revision !== data.expected_revision) throw new ConflictException("This offer changed. Refresh before responding.");
      if (data.decision === "declined" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining.");
      const status = data.decision === "accepted" ? "active" : "declined";
      const updated = await db.updateTable("staff_responsibility_assignments").set({ status, responded_at: new Date(), response_note: data.note, updated_at: new Date() }).where("id", "=", assignmentId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignmentId, actor_id: user.id, action: data.decision, from_status: "offered", to_status: status, note: data.note }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      await this.enqueue(db, schoolId, assignmentId, `staff.responsibility.${data.decision}`, [user.id, ...admins.rows.map((row) => row.user_id)], admins.rows.map((row) => row.user_id), { kind: "general", title: `Work assignment ${data.decision}`, body: `${assignment.type_name} was ${data.decision}.`, link: "/principal/staff" }, { school_id: schoolId, status, revision: updated.revision }, "staff_responsibility");
      await this.audit(db, user, schoolId, `staff.responsibility.${data.decision}`, assignmentId, { note: data.note });
      return updated;
    });
  }

  async revokeResponsibility(user: AuthUser, schoolId: string, assignmentId: string, body: unknown) {
    uuid.parse(assignmentId);
    const data = z.object({ reason: z.string().trim().min(4).max(500), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const assignment = await db.selectFrom("staff_responsibility_assignments").selectAll().where("id", "=", assignmentId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!assignment) throw new NotFoundException();
      if (!["offered", "active"].includes(assignment.status) || assignment.revision !== data.expected_revision) throw new ConflictException("This work assignment changed. Refresh before ending it.");
      const updated = await db.updateTable("staff_responsibility_assignments").set({ status: "revoked", revoked_by: user.id, revoked_at: new Date(), revocation_reason: data.reason, updated_at: new Date() }).where("id", "=", assignmentId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignmentId, actor_id: user.id, action: "revoked", from_status: assignment.status, to_status: "revoked", note: data.reason }).execute();
      await this.audit(db, user, schoolId, "staff.responsibility.revoked", assignmentId, { reason: data.reason });
      const holder=await db.selectFrom("staff_profiles").select("user_id").where("id","=",assignment.staff_profile_id).executeTakeFirst();
      await this.enqueue(db,schoolId,assignmentId,"staff.access.updated",[user.id,...(holder?.user_id?[holder.user_id]:[])],[],null,{school_id:schoolId,revision:updated.revision},"staff_access");
      return updated;
    });
  }

  async savePolicy(user: AuthUser, schoolId: string, body: unknown, policyId?: string) {
    if (policyId) uuid.parse(policyId);
    await this.principal(user, schoolId);
    const data = policyInput.parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      if (!policyId) {
        const created = await db.insertInto("staff_leave_policies").values({
          school_id: schoolId, academic_year: data.academic_year, code: data.code, name: data.name,
          annual_allowance: data.annual_allowance.toFixed(2), carry_forward_limit: data.carry_forward_limit.toFixed(2),
          requires_document_after_days: data.requires_document_after_days?.toFixed(2) ?? null,
          is_paid: data.is_paid, is_statutory: data.is_statutory, is_active: data.is_active, updated_by: user.id,
        }).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, "staff.leave_policy.created", created.id);
        return created;
      }
      if (!data.expected_revision) throw new BadRequestException("Refresh this policy before editing it.");
      const updated = await db.updateTable("staff_leave_policies").set({
        name: data.name, annual_allowance: data.annual_allowance.toFixed(2), carry_forward_limit: data.carry_forward_limit.toFixed(2),
        requires_document_after_days: data.requires_document_after_days?.toFixed(2) ?? null,
        is_paid: data.is_paid, is_statutory: data.is_statutory, is_active: data.is_active, updated_by: user.id, updated_at: new Date(),
      }).where("id", "=", policyId).where("school_id", "=", schoolId).where("revision", "=", data.expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("This policy changed. Refresh and review the latest values.");
      await this.audit(db, user, schoolId, "staff.leave_policy.updated", updated.id, { revision: updated.revision });
      return updated;
    });
  }

  async adjustBalance(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = z.object({ staff_profile_id: uuid, policy_id: uuid, days: z.coerce.number().min(-366).max(366).refine((value) => value !== 0), reason: z.string().trim().min(8).max(500) }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const adjustment = await db.insertInto("staff_leave_balance_adjustments").values({ school_id: schoolId, staff_profile_id: data.staff_profile_id, policy_id: data.policy_id, days: data.days.toFixed(2), reason: data.reason, recorded_by: user.id }).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, "staff.leave_balance.adjusted", adjustment.id, { staff_profile_id: data.staff_profile_id, policy_id: data.policy_id, days: data.days, reason: data.reason });
      return adjustment;
    });
  }

  async requestLeave(user: AuthUser, schoolId: string, body: unknown) {
    const data = z.object({ policy_id: uuid, starts_on: date, ends_on: date, portion: z.enum(["full_day", "first_half", "second_half"]).default("full_day"), reason: z.string().trim().min(8).max(1000), handover_note: z.string().trim().max(1000).default("") }).parse(body);
    if (data.ends_on < data.starts_on) throw new BadRequestException("Leave end date cannot be before the start date.");
    if (data.portion !== "full_day" && data.starts_on !== data.ends_on) throw new BadRequestException("Half-day leave must use one date.");
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:${user.id}`},0))`.execute(db);
      const profile = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId).where("user_id", "=", user.id).where("status", "!=", "inactive").executeTakeFirst();
      if (!profile) throw new NotFoundException("Your active staff profile is not ready.");
      const policy = await db.selectFrom("staff_leave_policies").selectAll().where("id", "=", data.policy_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
      if (!policy) throw new NotFoundException("This leave policy is not available.");
      const term = await sql`SELECT 1 FROM academic_terms WHERE school_id=${schoolId}::uuid AND academic_year=${policy.academic_year}
        AND ${data.starts_on}::date BETWEEN starts_on AND ends_on AND ${data.ends_on}::date BETWEEN starts_on AND ends_on LIMIT 1`.execute(db);
      if (!term.rows.length) throw new BadRequestException("Choose dates within the policy academic year.");
      const overlap = await sql`SELECT 1 FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND status IN ('submitted','approved')
        AND daterange(starts_on,ends_on,'[]') && daterange(${data.starts_on}::date,${data.ends_on}::date,'[]') LIMIT 1`.execute(db);
      if (overlap.rows.length) throw new ConflictException("A pending or approved leave request already covers these dates.");
      const counted = await sql<{ days: string }>`SELECT CASE WHEN ${data.portion} <> 'full_day' THEN 0.5::numeric ELSE count(*)::numeric END AS days
        FROM generate_series(${data.starts_on}::date,${data.ends_on}::date,interval '1 day') day
        WHERE extract(isodow FROM day) <> 7 AND NOT EXISTS (
          SELECT 1 FROM school_calendar_days calendar WHERE calendar.school_id=${schoolId}::uuid AND calendar.date=day::date AND NOT calendar.is_instructional
        )`.execute(db);
      const requestedDays = Number(counted.rows[0]?.days ?? 0);
      if (requestedDays <= 0) throw new BadRequestException("The selected dates contain no working days.");
      if (requestedDays > 62) throw new BadRequestException("One request cannot exceed 62 working days. Contact the school office for extended leave.");
      const totals = await sql<{ used: string; pending: string; adjustments: string }>`SELECT
        COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='approved'),0) AS used,
        COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='submitted'),0) AS pending,
        COALESCE((SELECT sum(days) FROM staff_leave_balance_adjustments WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid),0) AS adjustments`.execute(db);
      const available = Number(policy.annual_allowance) + Number(totals.rows[0]!.adjustments) - Number(totals.rows[0]!.used) - Number(totals.rows[0]!.pending);
      if (requestedDays > available) throw new BadRequestException(`Only ${available.toFixed(1)} days are available under ${policy.name}.`);
      const request = await db.insertInto("staff_leave_requests").values({ school_id: schoolId, staff_profile_id: profile.id, policy_id: policy.id, starts_on: data.starts_on, ends_on: data.ends_on, portion: data.portion, requested_days: requestedDays.toFixed(2), reason: data.reason, handover_note: data.handover_note }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: request.id, actor_id: user.id, action: "submitted", from_status: null, to_status: "submitted" }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      await this.enqueue(db, schoolId, request.id, "staff.leave.submitted", [user.id, ...admins.rows.map((row) => row.user_id)], admins.rows.map((row) => row.user_id), { kind: "leave", title: "Staff leave needs review", body: `${profile.first_name} ${profile.last_name} requested ${requestedDays} day${requestedDays === 1 ? "" : "s"}.`, admin_link: "/principal/staff?section=leave" }, { school_id: schoolId, status: request.status, revision: request.revision });
      await this.audit(db, user, schoolId, "staff.leave.submitted", request.id, { requested_days: requestedDays, policy_id: policy.id });
      return request;
    });
  }

  async decideLeave(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(requestId);
    const data = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(1000).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const request = await db.selectFrom("staff_leave_requests").selectAll().where("id", "=", requestId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!request) throw new NotFoundException();
      if (request.status !== "submitted") throw new ConflictException("This leave request has already been decided.");
      if (request.revision !== data.expected_revision) throw new ConflictException("This request changed. Refresh before deciding.");
      if (data.decision === "rejected" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining leave.");
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", request.staff_profile_id).executeTakeFirstOrThrow();
      if (data.decision === "approved") {
        const policy = await db.selectFrom("staff_leave_policies").selectAll().where("id", "=", request.policy_id).executeTakeFirstOrThrow();
        const totals = await sql<{ used: string; adjustments: string }>`SELECT
          COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='approved'),0) AS used,
          COALESCE((SELECT sum(days) FROM staff_leave_balance_adjustments WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid),0) AS adjustments`.execute(db);
        const available = Number(policy.annual_allowance) + Number(totals.rows[0]!.adjustments) - Number(totals.rows[0]!.used);
        if (Number(request.requested_days) > available) throw new ConflictException("The leave balance changed and is no longer sufficient.");
      }
      const updated = await db.updateTable("staff_leave_requests").set({ status: data.decision, decided_by: user.id, decided_at: new Date(), decision_note: data.note, updated_at: new Date() }).where("id", "=", request.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: request.id, actor_id: user.id, action: data.decision, from_status: request.status, to_status: data.decision, note: data.note }).execute();
      if (data.decision === "approved") await this.createCoverageTasks(db, user, schoolId, request, profile);
      const coverage = data.decision === "approved"
        ? await sql<{ affected: number }>`SELECT count(*)::int AS affected FROM staff_coverage_tasks WHERE leave_request_id=${request.id}::uuid`.execute(db)
        : await sql<{ affected: number }>`SELECT count(*)::int AS affected FROM generate_series(${request.starts_on}::date,${request.ends_on}::date,interval '1 day') day
          CROSS JOIN LATERAL effective_school_schedule(${schoolId}::uuid,day::date) schedule
          WHERE schedule.teacher_user_id=${profile.user_id}::uuid AND schedule.slot_type='class'`.execute(db);
      const coverageCount = coverage.rows[0]?.affected ?? 0;
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      const audience = [...admins.rows.map((row) => row.user_id), ...(profile.user_id ? [profile.user_id] : [])];
      await this.enqueue(db, schoolId, request.id, `staff.leave.${data.decision}`, audience, profile.user_id ? [profile.user_id] : [], { kind: "leave", title: `Leave ${data.decision}`, body: data.decision === "approved" ? `${request.requested_days} day(s) approved. ${coverageCount} timetable period(s) need coverage.` : data.note, staff_link: "/teacher/leave" }, { school_id: schoolId, status: updated.status, revision: updated.revision, affected_periods: coverageCount, refresh: ["principal.staff", "teacher.leave", "principal.timetable"] });
      await this.audit(db, user, schoolId, `staff.leave.${data.decision}`, request.id, { requested_days: request.requested_days, affected_periods: coverageCount, note: data.note });
      return { ...updated, affected_periods: coverageCount };
    });
  }

  async assignCoverage(user: AuthUser, schoolId: string, taskId: string, body: unknown) {
    uuid.parse(taskId);
    const data = z.object({ replacement_staff_profile_id: uuid, note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const task = await db.selectFrom("staff_coverage_tasks").selectAll().where("id", "=", taskId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!task) throw new NotFoundException();
      if (!["open", "declined", "offered"].includes(task.status) || task.revision !== data.expected_revision) throw new ConflictException("This cover task changed. Refresh before assigning it.");
      const replacement = await db.selectFrom("staff_profiles").selectAll().where("id", "=", data.replacement_staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
      if (!replacement?.user_id) throw new BadRequestException("Choose an active staff member with account access.");
      if (replacement.id === task.absent_staff_profile_id) throw new BadRequestException("The absent staff member cannot cover their own duty.");
      const leaveConflict = await sql`SELECT 1 FROM staff_leave_requests WHERE staff_profile_id=${replacement.id}::uuid AND status='approved'
        AND ${task.duty_date}::date BETWEEN starts_on AND ends_on LIMIT 1`.execute(db);
      if (leaveConflict.rows.length) throw new ConflictException("This staff member has approved leave on that date.");
      if (task.starts_at && task.ends_at) {
        const scheduleConflict = await sql`SELECT 1 FROM effective_school_schedule(${schoolId}::uuid,${task.duty_date}::date) schedule
          WHERE schedule.teacher_user_id=${replacement.user_id}::uuid AND schedule.starts_at < ${task.ends_at}::time AND schedule.ends_at > ${task.starts_at}::time AND NOT schedule.cancelled LIMIT 1`.execute(db);
        const coverConflict = await sql`SELECT 1 FROM staff_coverage_tasks WHERE replacement_staff_profile_id=${replacement.id}::uuid AND duty_date=${task.duty_date}::date
          AND status IN ('offered','accepted') AND id<>${task.id}::uuid AND starts_at < ${task.ends_at}::time AND ends_at > ${task.starts_at}::time LIMIT 1`.execute(db);
        if (scheduleConflict.rows.length || coverConflict.rows.length) throw new ConflictException("This staff member already has a class or cover duty at that time.");
      }
      const action = task.replacement_staff_profile_id ? "reassigned" : "offered";
      const updated = await db.updateTable("staff_coverage_tasks").set({ replacement_staff_profile_id: replacement.id, status: "offered", assigned_by: user.id, offered_at: new Date(), responded_at: null, response_note: data.note, updated_at: new Date() }).where("id", "=", task.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_coverage_task_audits").values({ school_id: schoolId, task_id: task.id, actor_id: user.id, action, from_status: task.status, to_status: "offered", note: data.note }).execute();
      await this.enqueue(db, schoolId, task.id, "staff.coverage.offered", [user.id, replacement.user_id], [replacement.user_id], { kind: "general", title: "Cover duty offered", body: `${task.title} on ${task.duty_date} needs your response.`, link: "/teacher/responsibilities" }, { school_id: schoolId, status: "offered", revision: updated.revision, duty_date: task.duty_date }, "staff_coverage_task");
      await this.audit(db, user, schoolId, `staff.coverage.${action}`, task.id, { replacement_staff_profile_id: replacement.id });
      return updated;
    });
  }

  async respondCoverage(user: AuthUser, schoolId: string, taskId: string, body: unknown) {
    uuid.parse(taskId);
    const data = z.object({ decision: z.enum(["accepted", "declined"]), note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const result = await sql<any>`SELECT task.*,profile.user_id,profile.first_name,profile.last_name FROM staff_coverage_tasks task
        JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id
        WHERE task.id=${taskId}::uuid AND task.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid FOR UPDATE`.execute(db);
      const task = result.rows[0];
      if (!task) throw new NotFoundException();
      if (task.status !== "offered" || task.revision !== data.expected_revision) throw new ConflictException("This cover offer changed. Refresh before responding.");
      if (data.decision === "declined" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining cover.");
      const updated = await db.updateTable("staff_coverage_tasks").set({ status: data.decision, responded_at: new Date(), response_note: data.note, updated_at: new Date() }).where("id", "=", task.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_coverage_task_audits").values({ school_id: schoolId, task_id: task.id, actor_id: user.id, action: data.decision, from_status: "offered", to_status: data.decision, note: data.note }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      await this.enqueue(db, schoolId, task.id, `staff.coverage.${data.decision}`, [user.id, ...admins.rows.map((row) => row.user_id)], admins.rows.map((row) => row.user_id), { kind: "general", title: `Cover duty ${data.decision}`, body: `${task.first_name} ${task.last_name} ${data.decision} ${task.title}.`, link: "/principal/staff?section=leave" }, { school_id: schoolId, status: data.decision, revision: updated.revision }, "staff_coverage_task");
      await this.audit(db, user, schoolId, `staff.coverage.${data.decision}`, task.id, { note: data.note });
      return updated;
    });
  }

  async withdrawLeave(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(requestId);
    const data = z.object({ expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const request = await sql<{ id: string; revision: number; status: string; staff_profile_id: string }>`SELECT r.id,r.revision,r.status,r.staff_profile_id FROM staff_leave_requests r JOIN staff_profiles profile ON profile.id=r.staff_profile_id
        WHERE r.id=${requestId}::uuid AND r.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid FOR UPDATE`.execute(db);
      const current = request.rows[0];
      if (!current) throw new NotFoundException();
      if (current.status !== "submitted" || current.revision !== data.expected_revision) throw new ConflictException("Only the latest pending request can be withdrawn.");
      const updated = await db.updateTable("staff_leave_requests").set({ status: "withdrawn", updated_at: new Date() }).where("id", "=", requestId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: requestId, actor_id: user.id, action: "withdrawn", from_status: "submitted", to_status: "withdrawn" }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      await this.enqueue(db, schoolId, requestId, "staff.leave.withdrawn", [user.id, ...admins.rows.map((row) => row.user_id)], [], null, { school_id: schoolId, status: "withdrawn", revision: updated.revision });
      await this.audit(db, user, schoolId, "staff.leave.withdrawn", requestId);
      return updated;
    });
  }
}
