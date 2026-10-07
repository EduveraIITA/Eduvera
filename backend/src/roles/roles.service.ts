import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { effectiveSchoolAccess } from "./authorization.js";
import { PERMISSIONS } from "./permissions.js";

const uuid = z.uuid();
const date = z.iso.date();
const profileInput = z.object({
  name: z.string().trim().min(2).max(80).refine(
    (name) => !["admin", "administrator", "principal", "student", "parent", "guardian", "default staff"].includes(name.toLowerCase()),
    "Choose a role name; built-in account types are reserved.",
  ),
  description: z.string().trim().max(500).default(""),
  duty_ids: z.array(uuid).max(100).default([]),
  template_key: z.string().trim().max(48).nullable().optional(),
  expected_revision: z.number().int().positive().optional(),
}).strict();
const assignmentInput = z.object({
  profile_ids: z.array(uuid).max(1, "Choose one role per staff member."),
  primary_profile_id: uuid.nullable(),
  expected_profile_ids: z.array(uuid).max(12),
}).strict();
const exceptionInput = z.object({
  permission: z.string().refine((code) => PERMISSIONS.some((item) => item.code === code), "Unknown access outcome."),
  reason: z.string().trim().min(8).max(500),
  scope_kind: z.enum(["institution", "assigned_resources"]).default("assigned_resources"),
  valid_from: date,
  valid_until: date,
}).strict();

type Db = DatabaseService | Transaction<Database>;
interface ProfileRow {
  id: string;
  name: string;
  description: string;
  template_key: string | null;
  system_managed: boolean;
  revision: number;
}
interface DutyMismatch {
  kind: "responsibility" | "class" | "event" | "assessment" | "transport" | "support";
  id: string;
  user_id: string;
  title: string;
  status: string;
  scope_label: string;
}
interface AccessExceptionRow {
  id: string;
  permission: string;
  reason: string;
  source_kind: string;
  scope_kind: string;
  valid_from: string;
  valid_until: string;
  review_due_on: string;
  status: string;
  revision: number;
}

const PROFILE_TEMPLATES = [
  { key: "teaching", name: "Teaching staff", description: "Class, subject and section teaching responsibilities.", duty_codes: ["class_teacher", "subject_teacher", "section_coordinator"] },
  { key: "assessment", name: "Assessment staff", description: "Examiner, invigilation and assessment coordination work.", duty_codes: ["internal_examiner", "invigilator", "exam_in_charge", "assessment_coordinator"] },
  { key: "events", name: "Event staff", description: "Event coordination, attendance, judging and escort work.", duty_codes: ["event_coordinator", "event_attendance", "event_judge", "event_escort"] },
  { key: "transport", name: "Transport staff", description: "Assigned journeys or institution transport planning.", duty_codes: ["transport_attendant", "transport_coordinator"] },
  { key: "office", name: "School office", description: "Student records, member onboarding and communication work.", duty_codes: ["student_records_officer", "membership_coordinator", "communications_coordinator"] },
  { key: "finance", name: "Finance staff", description: "Fee records, receipts and reconciliation work.", duty_codes: ["finance_officer"] },
  { key: "student_support", name: "Student support", description: "Mentoring, safety and bounded student-support work.", duty_codes: ["student_mentor", "safety_officer"] },
] as const;

@Injectable()
export class RolesService {
  constructor(private readonly db: DatabaseService) {}

  async effective(user: AuthUser, schoolId: string, db: Db = this.db) {
    const access = await effectiveSchoolAccess(db, user.id, schoolId);
    const profiles = access.role === "staff" ? (await sql<{ id: string; name: string; is_primary: boolean }>`
      SELECT DISTINCT role_id AS id,role_name AS name,false AS is_primary FROM staff_role_bindings
      WHERE school_id=${schoolId}::uuid AND user_id=${user.id}::uuid AND status='active' AND role_active
        AND starts_on<=current_date AND (ends_on IS NULL OR ends_on>=current_date)
      ORDER BY name`.execute(db)).rows : [];
    const permissions = [...new Set(access.sources.map((source) => source.permission))].sort();
    return {
      role: access.role,
      custom_role: profiles.find((profile) => profile.is_primary) ?? profiles[0] ?? null,
      work_profiles: profiles,
      permissions,
      access_explanations: access.sources.map((source) => ({
        ...source,
        label: PERMISSIONS.find((item) => item.code === source.permission)?.label ?? source.permission,
      })),
    };
  }

  private async admin(user: AuthUser, schoolId: string, db: Db = this.db) {
    const membership = (await sql<{ role: string }>`SELECT membership.role FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid
        AND membership.role='admin' AND membership.is_active AND account.is_active
      LIMIT 1`.execute(db)).rows[0];
    if (!membership) throw new ForbiddenException("Only institution administrators can manage staff roles or access exceptions.");
  }

  async workspace(user: AuthUser, schoolId: string) {
    await this.admin(user, schoolId);
    const profiles = await sql<ProfileRow & { member_count: number; duty_ids: string[] }>`SELECT profile.*,
      (SELECT count(*)::int FROM school_custom_role_assignments assignment
        WHERE assignment.school_id=profile.school_id AND assignment.role_id=profile.id
          AND assignment.valid_from<=current_date AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date)) AS member_count,
      COALESCE((SELECT array_agg(duty.responsibility_type_id ORDER BY duty.responsibility_type_id)
        FROM school_custom_role_duties duty WHERE duty.school_id=profile.school_id AND duty.role_id=profile.id),'{}'::uuid[]) AS duty_ids
      FROM school_custom_roles profile WHERE profile.school_id=${schoolId}::uuid ORDER BY lower(profile.name)`.execute(this.db);
    const duties = await sql`SELECT id,code,name,category,scope_kind,description,access_summary,requires_acceptance,restricted
      FROM staff_responsibility_types WHERE school_id=${schoolId}::uuid AND is_active ORDER BY category,name`.execute(this.db);
    const members = await sql<{ user_id: string; name: string; email: string; role: string; profile_ids: string[]; primary_profile_id: string | null }>`
      SELECT membership.user_id,concat_ws(' ',account.first_name,account.last_name) AS name,account.email,membership.role,
        COALESCE((SELECT array_agg(assignment.role_id ORDER BY assignment.is_primary DESC,assignment.assigned_at)
          FROM school_custom_role_assignments assignment WHERE assignment.school_id=membership.school_id
            AND assignment.user_id=membership.user_id AND assignment.valid_from<=current_date
            AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date)),'{}'::uuid[]) AS profile_ids,
        (SELECT assignment.role_id FROM school_custom_role_assignments assignment
          WHERE assignment.school_id=membership.school_id AND assignment.user_id=membership.user_id
            AND assignment.is_primary AND assignment.valid_from<=current_date
            AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date) LIMIT 1) AS primary_profile_id
      FROM school_memberships membership JOIN users account ON account.id=membership.user_id
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active AND account.is_active
        AND membership.role IN ('staff','admin') ORDER BY account.first_name,account.last_name`.execute(this.db);
    const mismatches = await this.dutyMismatches(this.db, schoolId);
    const exceptions = await sql<AccessExceptionRow & { user_id: string }>`SELECT exception.id,exception.user_id,exception.permission,exception.reason,
      exception.source_kind,exception.scope_kind,exception.valid_from,exception.valid_until,exception.review_due_on,
      exception.status,exception.revision
      FROM school_access_exceptions exception WHERE exception.school_id=${schoolId}::uuid
        AND exception.status='active' AND exception.valid_until>=current_date
      ORDER BY exception.review_due_on,exception.created_at`.execute(this.db);
    return {
      templates: PROFILE_TEMPLATES,
      exception_options: PERMISSIONS.map(({ code, group, label, description }) => ({ code, group, label, description })),
      duties: duties.rows,
      profiles: profiles.rows,
      roles: profiles.rows,
      members: members.rows.map((member) => ({
        ...member,
        role_id: member.primary_profile_id,
        duty_mismatches: mismatches.filter((mismatch) => mismatch.user_id === member.user_id),
      })),
      exceptions: exceptions.rows,
    };
  }

  private async dutyMismatches(db: Db, schoolId: string) {
    return (await sql<DutyMismatch>`WITH actual_duties AS (
        SELECT 'responsibility'::text AS kind,assignment.id,profile.user_id,type.id AS responsibility_type_id,
          type.name AS title,assignment.status,COALESCE(NULLIF(assignment.scope_label,''),type.access_summary) AS scope_label
        FROM staff_responsibility_assignments assignment
        JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        WHERE assignment.school_id=${schoolId}::uuid AND assignment.status IN ('offered','active')
          AND (assignment.ends_on IS NULL OR assignment.ends_on>=current_date)
          AND profile.user_id IS NOT NULL
        UNION ALL
        SELECT 'class',assignment.id,assignment.user_id,type.id,type.name,'active',
          concat('Class ',section.grade,section.section,CASE WHEN subject.name IS NULL THEN '' ELSE ' · '||subject.name END)
        FROM class_section_staff_assignments assignment
        JOIN class_sections section ON section.id=assignment.class_section_id
        LEFT JOIN subjects subject ON subject.id=assignment.subject_id
        JOIN staff_responsibility_types type ON type.school_id=assignment.school_id AND type.code=assignment.role
        WHERE assignment.school_id=${schoolId}::uuid
          AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date)
        UNION ALL
        SELECT 'event',event.id,staff.user_id,type.id,type.name,event.status,event.title
        FROM campus_event_staff staff
        JOIN campus_events event ON event.id=staff.event_id AND event.school_id=staff.school_id
        JOIN staff_responsibility_types type ON type.school_id=staff.school_id AND type.code=CASE staff.role
          WHEN 'organizer' THEN 'event_coordinator' WHEN 'attendance_taker' THEN 'event_attendance' ELSE 'event_escort' END
        WHERE staff.school_id=${schoolId}::uuid AND event.status NOT IN ('cancelled','completed')
        UNION ALL
        SELECT 'assessment',assessment.id,staff.user_id,type.id,type.name,assessment.status,assessment.title
        FROM assessment_staff_assignments staff
        JOIN assessments assessment ON assessment.id=staff.assessment_id AND assessment.school_id=staff.school_id
        JOIN staff_responsibility_types type ON type.school_id=staff.school_id AND type.code=CASE staff.role
          WHEN 'examiner' THEN 'internal_examiner' ELSE 'exam_in_charge' END
        WHERE staff.school_id=${schoolId}::uuid AND assessment.status NOT IN ('cancelled','published')
        UNION ALL
        SELECT 'transport',trip.id,collector.user_id,type.id,type.name,trip.state,route.name
        FROM transport_trips trip
        JOIN transport_routes route ON route.id=trip.route_id
        JOIN LATERAL (VALUES(trip.assigned_collector_user_id),(trip.backup_collector_user_id)) collector(user_id) ON collector.user_id IS NOT NULL
        JOIN staff_responsibility_types type ON type.school_id=trip.school_id AND type.code='transport_attendant'
        WHERE trip.school_id=${schoolId}::uuid AND trip.state IN ('planned','boarding','in_progress')
        UNION ALL
        SELECT 'support',assignment.id,assignment.user_id,type.id,type.name,assignment.status,
          replace(assignment.role_kind,'_',' ')
        FROM restricted_care_role_assignments assignment
        JOIN staff_responsibility_types type ON type.school_id=assignment.school_id AND type.code='safety_officer'
        WHERE assignment.school_id=${schoolId}::uuid AND assignment.status='active'
          AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date)
      )
      SELECT actual.kind,actual.id,actual.user_id,actual.title,actual.status,actual.scope_label
      FROM actual_duties actual
      WHERE EXISTS (
        SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=actual.user_id
          AND membership.role='staff' AND membership.is_active
      ) AND NOT EXISTS (
        SELECT 1 FROM school_memberships membership
        WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=actual.user_id
          AND membership.role='admin' AND membership.is_active
      ) AND NOT EXISTS (
        SELECT 1 FROM school_custom_role_assignments profile_assignment
        JOIN school_custom_role_duties duty ON duty.school_id=profile_assignment.school_id AND duty.role_id=profile_assignment.role_id
        WHERE profile_assignment.school_id=${schoolId}::uuid AND profile_assignment.user_id=actual.user_id
          AND profile_assignment.valid_from<=current_date
          AND (profile_assignment.valid_until IS NULL OR profile_assignment.valid_until>=current_date)
          AND duty.responsibility_type_id=actual.responsibility_type_id
      ) ORDER BY actual.title,actual.scope_label`.execute(db)).rows;
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, action: string, target: string, metadata: unknown) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${target}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }

  async save(user: AuthUser, schoolId: string, body: unknown, id?: string) {
    uuid.parse(schoolId);
    if (id) uuid.parse(id);
    const data = profileInput.parse(body);
    try {
      return await this.db.transaction().execute(async (db) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
        await this.admin(user, schoolId, db);
        const dutyIds = [...new Set(data.duty_ids)].sort();
        if (dutyIds.length) {
          const available = await sql<{ count: number }>`SELECT count(*)::int AS count FROM staff_responsibility_types
            WHERE school_id=${schoolId}::uuid AND is_active AND id=ANY(${dutyIds}::uuid[])`.execute(db);
          if (available.rows[0]?.count !== dutyIds.length) throw new NotFoundException("One or more responsibilities are not available in this institution.");
        }
        let before: ProfileRow | undefined;
        if (id) {
          before = (await sql<ProfileRow>`SELECT id,name,description,template_key,system_managed,revision FROM school_custom_roles
            WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
          if (!before) throw new NotFoundException("Role not found.");
          if (data.expected_revision !== before.revision) throw new ConflictException("This role changed. Refresh before saving.");
        }
        const result = id ? await sql<ProfileRow>`UPDATE school_custom_roles SET name=${data.name},description=${data.description},
          template_key=${data.template_key ?? null},permissions='{}'::text[],revision=revision+1,updated_at=now()
          WHERE school_id=${schoolId}::uuid AND id=${id}::uuid RETURNING id,name,description,template_key,system_managed,revision`.execute(db)
          : await sql<ProfileRow>`INSERT INTO school_custom_roles(school_id,name,description,permissions,template_key,created_by)
          VALUES(${schoolId}::uuid,${data.name},${data.description},'{}'::text[],${data.template_key ?? null},${user.id}::uuid)
          RETURNING id,name,description,template_key,system_managed,revision`.execute(db);
        const saved = result.rows[0]!;
        await sql`DELETE FROM school_custom_role_duties WHERE school_id=${schoolId}::uuid AND role_id=${saved.id}::uuid`.execute(db);
        if (dutyIds.length) await sql`INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id)
          SELECT ${schoolId}::uuid,${saved.id}::uuid,id FROM staff_responsibility_types
          WHERE school_id=${schoolId}::uuid AND id=ANY(${dutyIds}::uuid[])`.execute(db);
        if (id) {
          const assignedUsers = new Set((await sql<{ user_id: string }>`SELECT user_id FROM school_custom_role_assignments
            WHERE school_id=${schoolId}::uuid AND role_id=${saved.id}::uuid
              AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>=current_date)`.execute(db)).rows.map((row) => row.user_id));
          const affected = (await this.dutyMismatches(db, schoolId)).filter((item) => assignedUsers.has(item.user_id));
          if (affected.length) {
            const labels = [...new Set(affected.map((item) => item.title))].slice(0, 3).join(", ");
            throw new ConflictException(`This role is still needed for active responsibilities: ${labels}. Move or end them before removing the responsibility from the role.`);
          }
        }
        await this.audit(db, user, schoolId, id ? "work_profile.updated" : "work_profile.created", saved.id, {
          before: before ?? null,
          after: saved,
          responsibility_type_ids: dutyIds,
        });
        return { ...saved, duty_ids: dutyIds };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("A role with this name already exists in this institution.");
      throw error;
    }
  }

  async assign(user: AuthUser, schoolId: string, memberId: string, body: unknown) {
    uuid.parse(schoolId);
    uuid.parse(memberId);
    const data = assignmentInput.parse(body);
    const profileIds = [...new Set(data.profile_ids)].sort();
    const expected = [...new Set(data.expected_profile_ids)].sort();
    if (profileIds.length && (!data.primary_profile_id || !profileIds.includes(data.primary_profile_id))) {
      throw new BadRequestException("Choose one staff role.");
    }
    if (!profileIds.length && data.primary_profile_id) throw new BadRequestException("The selected role must be assigned.");
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.admin(user, schoolId, db);
      const member = await sql`SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id
        WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${memberId}::uuid
          AND membership.role='staff' AND membership.is_active AND account.is_active
          AND NOT EXISTS(SELECT 1 FROM school_memberships admin_membership WHERE admin_membership.school_id=membership.school_id
            AND admin_membership.user_id=membership.user_id AND admin_membership.role='admin' AND admin_membership.is_active)
        FOR UPDATE OF membership`.execute(db);
      if (!member.rows.length) throw new ForbiddenException("Roles can only be assigned to active staff. Administrator access is protected.");
      const old = (await sql<{ role_id: string }>`SELECT role_id FROM school_custom_role_assignments
        WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid
          AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>=current_date)
        ORDER BY role_id FOR UPDATE`.execute(db)).rows.map((row) => row.role_id).sort();
      if (JSON.stringify(old) !== JSON.stringify(expected)) throw new ConflictException("This staff role changed. Refresh and try again.");
      if (profileIds.length) {
        const available = await sql<{ count: number }>`SELECT count(*)::int AS count FROM school_custom_roles
          WHERE school_id=${schoolId}::uuid AND id=ANY(${profileIds}::uuid[])`.execute(db);
        if (available.rows[0]?.count !== profileIds.length) throw new NotFoundException("The selected role is not available in this institution.");
      }
      await sql`DELETE FROM school_custom_role_assignments WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid`.execute(db);
      for (const profileId of profileIds) await sql`INSERT INTO school_custom_role_assignments(
        school_id,user_id,role_id,assigned_by,is_primary,valid_from
      ) VALUES(${schoolId}::uuid,${memberId}::uuid,${profileId}::uuid,${user.id}::uuid,${profileId === data.primary_profile_id},current_date)`.execute(db);
      const incompatible = (await this.dutyMismatches(db, schoolId)).filter((item) => item.user_id === memberId);
      if (incompatible.length) {
        const labels = [...new Set(incompatible.map((item) => item.title))].slice(0, 3).join(", ");
        throw new ConflictException(`This staff member still owns responsibilities outside the selected role: ${labels}. Move or end them before changing the role.`);
      }
      await this.audit(db, user, schoolId, "work_profile.assigned", memberId, {
        before: old,
        after: profileIds,
        primary_profile_id: data.primary_profile_id,
      });
      return { saved: true, profile_ids: profileIds, primary_profile_id: data.primary_profile_id };
    });
  }

  async memberAccess(user: AuthUser, schoolId: string, memberId: string) {
    uuid.parse(memberId);
    await this.admin(user, schoolId);
    const member = (await sql<{ name: string; email: string }>`SELECT concat_ws(' ',account.first_name,account.last_name) AS name,account.email
      FROM school_memberships membership JOIN users account ON account.id=membership.user_id
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${memberId}::uuid AND membership.is_active`.execute(this.db)).rows[0];
    if (!member) throw new NotFoundException("Staff member not found.");
    const access = await effectiveSchoolAccess(this.db, memberId, schoolId);
    const exceptions = await sql<AccessExceptionRow>`SELECT id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,status,revision
      FROM school_access_exceptions WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid
        AND status='active' AND valid_until>=current_date ORDER BY review_due_on,created_at`.execute(this.db);
    return {
      member,
      permissions: [...new Set(access.sources.map((source) => source.permission))],
      explanations: access.sources.map((source) => ({
        ...source,
        label: PERMISSIONS.find((item) => item.code === source.permission)?.label ?? source.permission,
      })),
      exceptions: exceptions.rows.map((exception) => ({
        ...exception,
        label: PERMISSIONS.find((item) => item.code === exception.permission)?.label ?? exception.permission,
      })),
    };
  }

  async addException(user: AuthUser, schoolId: string, memberId: string, body: unknown) {
    uuid.parse(schoolId);
    uuid.parse(memberId);
    const data = exceptionInput.parse(body);
    const start = new Date(`${data.valid_from}T00:00:00Z`);
    const end = new Date(`${data.valid_until}T00:00:00Z`);
    if (end < start) throw new BadRequestException("The exception end date must be on or after its start date.");
    if ((end.getTime() - start.getTime()) / 86_400_000 > 90) throw new BadRequestException("Access exceptions can last at most 90 days.");
    return this.db.transaction().execute(async (db) => {
      await this.admin(user, schoolId, db);
      const member = await sql`SELECT 1 FROM school_memberships WHERE school_id=${schoolId}::uuid
        AND user_id=${memberId}::uuid AND role='staff' AND is_active FOR SHARE`.execute(db);
      if (!member.rows.length) throw new NotFoundException("Active staff member not found.");
      const overlapping = await sql`SELECT 1 FROM school_access_exceptions
        WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid
          AND permission=${data.permission} AND status='active'
          AND daterange(valid_from,valid_until,'[]') && daterange(${data.valid_from}::date,${data.valid_until}::date,'[]')
        LIMIT 1 FOR UPDATE`.execute(db);
      if (overlapping.rows.length) {
        throw new ConflictException("An active exception for this access outcome already overlaps these dates.");
      }
      const result = await sql<{ id: string }>`INSERT INTO school_access_exceptions(
        school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by
      ) VALUES(${schoolId}::uuid,${memberId}::uuid,${data.permission},${data.reason},'manual',${data.scope_kind},
        ${data.valid_from}::date,${data.valid_until}::date,LEAST(${data.valid_until}::date,${data.valid_from}::date+30),${user.id}::uuid)
      RETURNING id`.execute(db);
      await this.audit(db, user, schoolId, "access_exception.created", result.rows[0]!.id, { subject_user_id: memberId, ...data });
      return { id: result.rows[0]!.id, saved: true };
    });
  }

  async revokeException(user: AuthUser, schoolId: string, exceptionId: string, body: unknown) {
    uuid.parse(exceptionId);
    const data = z.object({ expected_revision: z.number().int().positive(), reason: z.string().trim().min(8).max(500) }).strict().parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.admin(user, schoolId, db);
      const result = await sql<{ user_id: string }>`UPDATE school_access_exceptions SET status='revoked',revoked_by=${user.id}::uuid,
        revoked_at=now(),revocation_reason=${data.reason},revision=revision+1,updated_at=now()
        WHERE school_id=${schoolId}::uuid AND id=${exceptionId}::uuid AND status='active' AND revision=${data.expected_revision}
        RETURNING user_id`.execute(db);
      if (!result.rows.length) throw new ConflictException("This exception changed or is no longer active.");
      await this.audit(db, user, schoolId, "access_exception.revoked", exceptionId, { subject_user_id: result.rows[0]!.user_id, reason: data.reason });
      return { revoked: true };
    });
  }

  async remove(user: AuthUser, schoolId: string, id: string, body: unknown) {
    uuid.parse(schoolId);
    uuid.parse(id);
    const { expected_revision } = z.object({ expected_revision: z.number().int().positive() }).strict().parse(body);
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.admin(user, schoolId, db);
      const profile = (await sql<ProfileRow>`SELECT id,name,description,template_key,system_managed,revision FROM school_custom_roles
        WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!profile) throw new NotFoundException("Role not found.");
      if (profile.revision !== expected_revision) throw new ConflictException("This role changed. Refresh before deleting.");
      if ((await sql`SELECT 1 FROM school_custom_role_assignments WHERE school_id=${schoolId}::uuid AND role_id=${id}::uuid`.execute(db)).rows.length) {
        throw new ConflictException("Move staff to another role before deleting this role.");
      }
      if ((await sql`SELECT 1 FROM school_invitations WHERE school_id=${schoolId}::uuid AND custom_role_id=${id}::uuid
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()`.execute(db)).rows.length) {
        throw new ConflictException("Update pending staff invitations before deleting this role.");
      }
      await sql`DELETE FROM school_custom_roles WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
      await this.audit(db, user, schoolId, "work_profile.deleted", id, { before: profile });
      return { deleted: true };
    });
  }
}
