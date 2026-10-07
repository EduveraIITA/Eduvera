import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { roleOptions, rolePermissions } from "./scoped-role-policy.js";

type Db = Kysely<Database> | Transaction<Database>;
const uuid = z.uuid();
const roleInput = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).default(""),
  context_kind: z.enum(["institution", "class", "event", "assessment", "trip"]),
  permissions: z.array(z.string()).min(1).max(30),
  template_id: uuid.nullable().default(null),
  expected_revision: z.number().int().positive().optional(),
  expected_assignment_count: z.number().int().nonnegative().optional(),
}).strict();

export async function accessRoleCatalogue(db: Db, schoolId: string) {
  return (await sql<any>`SELECT r.*,r.capability_permissions AS permissions,
    (SELECT count(*)::int FROM staff_role_bindings b WHERE b.school_id=r.school_id AND b.role_id=r.id
      AND b.status IN ('active','offered') AND (b.ends_on IS NULL OR b.ends_on>=current_date)) AS assignment_count
    FROM staff_responsibility_types r WHERE r.school_id=${schoolId}::uuid
      AND r.context_kind IN ('institution','class','event','assessment','trip')
      AND cardinality(r.capability_permissions)>0
      AND r.capability_permissions <@ staff_role_allowed_permissions(r.context_kind)
    ORDER BY r.source_kind,lower(r.name)`.execute(db)).rows;
}

export async function staffRoleAssignments(db: Db, schoolId: string, userId?: string) {
  return (await sql<any>`SELECT b.*,p.id AS staff_profile_id,s.name AS subject_name,
    t.service_date AS trip_service_date,t.scheduled_departure_time::text AS trip_departure_time,
    t.direction AS trip_direction,t.state AS trip_state,
    t.collector_assignment_status AS trip_assignment_status,
    (t.backup_collector_user_id=b.user_id AND t.assigned_collector_user_id IS DISTINCT FROM b.user_id) AS trip_is_backup,
    CASE WHEN b.status='active' AND b.ends_on<current_date THEN 'expired'
      WHEN b.status='active' AND b.starts_on>current_date THEN 'scheduled'
      WHEN NOT b.role_active THEN 'disabled' ELSE b.status END AS display_status
    FROM staff_role_bindings b JOIN staff_profiles p ON p.school_id=b.school_id AND p.user_id=b.user_id
    LEFT JOIN subjects s ON s.id=b.subject_id
    LEFT JOIN transport_trips t ON b.source_kind='transport_trip' AND t.school_id=b.school_id AND t.id=b.source_id
    WHERE b.school_id=${schoolId}::uuid AND (${userId ?? null}::uuid IS NULL OR b.user_id=${userId ?? null}::uuid)
    ORDER BY (b.status='active') DESC,b.starts_on DESC,b.scope_label,b.role_name`.execute(db)).rows;
}

@Injectable()
export class AccessRolesService {
  constructor(private readonly db: DatabaseService) {}

  private async admin(db: Db, user: AuthUser, schoolId: string) {
    uuid.parse(schoolId);
    const account = (await sql`SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid
        AND m.role='admin' AND m.is_active AND u.is_active FOR SHARE OF m,u`.execute(db)).rows[0];
    if (!account) throw new ForbiddenException("Only institution administrators can change roles and assignments.");
  }

  private async audit(db: Transaction<Database>, user: AuthUser, schoolId: string, target: string, action: string, metadata: Record<string, unknown>, recipients: string[] = []) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${target}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
    const revision = typeof metadata.revision === "number" ? metadata.revision : 1;
    await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "staff.access.updated", aggregate_type: "staff_access", aggregate_id: target,
      audience_user_ids: [...new Set([user.id, ...recipients])], payload: { school_id: schoolId, revision },
      idempotency_key: `${action}:${target}:${revision}`, notification_user_ids: [], notification_payload: null }).onConflict((c) => c.column("idempotency_key").doNothing()).execute();
  }

  async save(user: AuthUser, schoolId: string, body: unknown, roleId?: string) {
    if (roleId) uuid.parse(roleId);
    const input = roleInput.parse(body);
    const permissions = rolePermissions(input.context_kind, input.permissions);
    return this.db.transaction().execute(async (db) => {
      await this.admin(db, user, schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${schoolId}`},0))`.execute(db);
      if ((await sql`SELECT 1 FROM staff_responsibility_types WHERE school_id=${schoolId}::uuid
        AND lower(trim(name))=lower(${input.name}) AND id IS DISTINCT FROM ${roleId ?? null}::uuid`.execute(db)).rows.length) {
        throw new ConflictException("A role with this name already exists.");
      }
      if (roleId) {
        const current = (await sql<any>`SELECT * FROM staff_responsibility_types
          WHERE school_id=${schoolId}::uuid AND id=${roleId}::uuid FOR UPDATE`.execute(db)).rows[0];
        if (!current) throw new NotFoundException("Role not found.");
        if (current.source_kind === "system") throw new BadRequestException("Create a copy to customise a built-in role.");
        if (current.context_kind !== input.context_kind) throw new BadRequestException("Create a new role to change its scope.");
        const assignments = (await sql<{ user_id: string }>`SELECT user_id FROM staff_role_bindings
          WHERE school_id=${schoolId}::uuid AND role_id=${roleId}::uuid AND status IN ('active','offered')
            AND (ends_on IS NULL OR ends_on>=current_date)`.execute(db)).rows;
        if (current.revision !== input.expected_revision || assignments.length !== input.expected_assignment_count) {
          throw new ConflictException("This role or its assignments changed. Refresh and review the impact before saving.");
        }
        // A role edit cannot convert an examiner into their own reviewer.
        const incompatible = await sql`SELECT 1 FROM assessment_staff_assignments a
          WHERE a.school_id=${schoolId}::uuid AND a.access_role_id=${roleId}::uuid
            AND ((a.role='examiner' AND 'assessments.moderate'=ANY(${permissions}::text[]))
              OR (a.role='moderator' AND 'assessments.mark'=ANY(${permissions}::text[]))) LIMIT 1`.execute(db);
        if (incompatible.rows.length) throw new ConflictException("This role is assigned to a different assessment duty. Keep marking and review separate.");
        const updated = (await sql<any>`UPDATE staff_responsibility_types SET name=${input.name},description=${input.description},
          capability_permissions=${permissions}::text[],updated_by=${user.id}::uuid
          WHERE school_id=${schoolId}::uuid AND id=${roleId}::uuid RETURNING *,capability_permissions AS permissions`.execute(db)).rows[0];
        await this.audit(db,user,schoolId,roleId,"staff.role.updated",{revision:updated.revision,before:current.capability_permissions,after:permissions,affected_assignments:assignments.length},assignments.map((a) => a.user_id));
        return updated;
      }
      if (input.template_id && !(await sql`SELECT 1 FROM staff_responsibility_types
        WHERE school_id=${schoolId}::uuid AND id=${input.template_id}::uuid AND context_kind=${input.context_kind} AND is_active`.execute(db)).rows.length) {
        throw new BadRequestException("Choose an active role template in this institution.");
      }
      const code = `role_${randomBytes(6).toString("hex")}`;
      const scope = input.context_kind === "institution" ? "school" : input.context_kind === "class" ? "class_section" : input.context_kind === "event" ? "event" : "scheduled_duty";
      const category = input.context_kind === "class" ? "academic" : input.context_kind === "event" ? "event" : input.context_kind === "assessment" ? "examination" : "operations";
      const created = (await sql<any>`INSERT INTO staff_responsibility_types(school_id,code,name,description,category,scope_kind,context_kind,
        workflow_family,source_kind,cloned_from_type_id,capability_permissions,requires_acceptance,updated_by)
        VALUES(${schoolId}::uuid,${code},${input.name},${input.description},${category},${scope},${input.context_kind},
          ${code},'institute',${input.template_id}::uuid,${permissions}::text[],false,${user.id}::uuid)
        RETURNING *,capability_permissions AS permissions`.execute(db)).rows[0];
      await this.audit(db,user,schoolId,created.id,"staff.role.created",{revision:created.revision,permissions,context:input.context_kind});
      return created;
    });
  }

  async assign(user: AuthUser, schoolId: string, body: unknown) {
    const input = z.object({ role_id: uuid, staff_profile_id: uuid, scope_id: uuid.nullable().default(null),
      subject_id: uuid.nullable().default(null), starts_on: z.iso.date(), ends_on: z.iso.date().nullable().default(null) }).strict().parse(body);
    if (input.ends_on && input.ends_on<input.starts_on) throw new BadRequestException("End date must not be before the start date.");
    return this.db.transaction().execute(async (db) => {
      await this.admin(db,user,schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${schoolId}`},0))`.execute(db);
      const role = (await sql<any>`SELECT * FROM staff_responsibility_types WHERE school_id=${schoolId}::uuid AND id=${input.role_id}::uuid AND is_active FOR SHARE`.execute(db)).rows[0];
      if (!role || !["institution","class"].includes(role.context_kind)) throw new BadRequestException("Assign this role from its event, assessment or journey planning screen.");
      rolePermissions(role.context_kind, role.capability_permissions);
      const profile = (await sql<{ id: string; user_id: string }>`SELECT p.id,p.user_id FROM staff_profiles p
        JOIN school_memberships m ON m.school_id=p.school_id AND m.user_id=p.user_id AND m.role='staff' AND m.is_active
        JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE p.school_id=${schoolId}::uuid AND p.id=${input.staff_profile_id}::uuid AND p.status='active'`.execute(db)).rows[0];
      if (!profile) throw new BadRequestException("Choose an active staff member with an institution account.");
      if (role.context_kind === "institution" && (input.scope_id || input.subject_id)) throw new BadRequestException("Institution access does not use a class or subject.");
      if (role.context_kind === "class" && (!input.scope_id || !(await sql`SELECT 1 FROM class_sections WHERE school_id=${schoolId}::uuid AND id=${input.scope_id}::uuid`.execute(db)).rows.length)) throw new BadRequestException("Choose a class in this institution.");
      if (input.subject_id && !(await sql`SELECT 1 FROM subjects WHERE school_id=${schoolId}::uuid AND id=${input.subject_id}::uuid`.execute(db)).rows.length) throw new BadRequestException("Choose a subject in this institution.");
      const existing = await sql`SELECT 1 FROM staff_role_bindings b WHERE b.school_id=${schoolId}::uuid AND b.user_id=${profile.user_id}::uuid
        AND b.role_id=${role.id}::uuid AND b.scope_id=${input.scope_id ?? schoolId}::uuid AND b.subject_id IS NOT DISTINCT FROM ${input.subject_id}::uuid
        AND b.status IN ('active','offered') AND daterange(b.starts_on,b.ends_on,'[]') && daterange(${input.starts_on}::date,${input.ends_on}::date,'[]')`.execute(db);
      if (existing.rows.length) throw new ConflictException("This role is already assigned for these records and dates.");
      const assigned = (await sql<any>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,
        class_section_id,subject_id,starts_on,ends_on,status,assigned_by,responded_at)
        VALUES(${schoolId}::uuid,${role.id}::uuid,${profile.id}::uuid,${input.scope_id}::uuid,${input.subject_id}::uuid,
          ${input.starts_on}::date,${input.ends_on}::date,'active',${user.id}::uuid,now()) RETURNING *`.execute(db)).rows[0];
      await db.insertInto("staff_responsibility_audits").values({school_id:schoolId,assignment_id:assigned.id,actor_id:user.id,action:"activated",from_status:null,to_status:"active"}).execute();
      await this.audit(db,user,schoolId,assigned.id,"staff.role.assigned",{revision:assigned.revision,role_id:role.id,scope_id:input.scope_id ?? schoolId},[profile.user_id]);
      return assigned;
    });
  }

  async changeAssignmentRole(user: AuthUser, schoolId: string, body: unknown) {
    const input = z.object({ source_kind: z.enum(["assignment","class_assignment","event_assignment","assessment_assignment","transport_trip"]),
      source_id:uuid,user_id:uuid,role_id:uuid,expected_role_id:uuid,expected_revision:z.number().int().positive() }).strict().parse(body);
    return this.db.transaction().execute(async(db) => {
      await this.admin(db,user,schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${schoolId}`},0))`.execute(db);
      await this.lockAssignment(db,schoolId,input.source_kind,input.source_id,input.user_id);
      const current=(await sql<any>`SELECT * FROM staff_role_bindings WHERE school_id=${schoolId}::uuid
        AND source_kind=${input.source_kind} AND source_id=${input.source_id}::uuid AND user_id=${input.user_id}::uuid`.execute(db)).rows[0];
      if (!current) throw new NotFoundException("Assignment no longer exists.");
      if (current.role_id!==input.expected_role_id || current.revision!==input.expected_revision || current.status!=="active") throw new ConflictException("Assignment changed. Refresh before changing access.");
      const role=(await sql<any>`SELECT * FROM staff_responsibility_types WHERE school_id=${schoolId}::uuid AND id=${input.role_id}::uuid AND is_active FOR SHARE`.execute(db)).rows[0];
      if (!role || role.context_kind!==current.context_kind) throw new BadRequestException("Choose a role for the same kind of records.");
      rolePermissions(role.context_kind,role.capability_permissions);
      if(input.source_kind==="assignment") await sql`UPDATE staff_responsibility_assignments SET responsibility_type_id=${role.id}::uuid,updated_at=now()
        WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid AND revision=${input.expected_revision}`.execute(db);
      else if(input.source_kind==="class_assignment") await sql`UPDATE class_section_staff_assignments SET access_role_id=${role.id}::uuid WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid`.execute(db);
      else if(input.source_kind==="event_assignment") await sql`UPDATE campus_event_staff SET access_role_id=${role.id}::uuid WHERE school_id=${schoolId}::uuid AND event_id=${input.source_id}::uuid AND user_id=${input.user_id}::uuid`.execute(db);
      else if(input.source_kind==="transport_trip") {
        const result=await sql`UPDATE transport_trips SET
          collector_access_role_id=CASE WHEN assigned_collector_user_id=${input.user_id}::uuid THEN ${role.id}::uuid ELSE collector_access_role_id END,
          backup_access_role_id=CASE WHEN backup_collector_user_id=${input.user_id}::uuid THEN ${role.id}::uuid ELSE backup_access_role_id END,
          revision=revision+1,updated_at=now()
          WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid AND revision=${input.expected_revision}
          RETURNING id`.execute(db);
        if (!result.rows.length) throw new ConflictException("Journey staffing changed. Refresh before saving.");
      }
      else {
        const slot=(await sql<{role:string}>`SELECT role FROM assessment_staff_assignments WHERE school_id=${schoolId}::uuid AND assessment_id=${input.source_id}::uuid AND user_id=${input.user_id}::uuid FOR UPDATE`.execute(db)).rows[0];
        if (!slot || (slot.role==="examiner" && role.capability_permissions.includes("assessments.moderate")) || (slot.role==="moderator" && role.capability_permissions.includes("assessments.mark"))) throw new BadRequestException("Keep examiner and reviewer access separate.");
        await sql`UPDATE assessment_staff_assignments SET access_role_id=${role.id}::uuid WHERE school_id=${schoolId}::uuid AND assessment_id=${input.source_id}::uuid AND user_id=${input.user_id}::uuid`.execute(db);
      }
      await this.audit(db,user,schoolId,input.source_id,"staff.assignment.role_changed",{revision:Date.now(),before:current.role_id,after:role.id,source_kind:input.source_kind},[input.user_id]);
      return {updated:true};
    });
  }

  private async lockAssignment(db: Transaction<Database>,schoolId:string,kind:string,id:string,userId:string) {
    if(kind==="assignment") await sql`SELECT id FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db);
    else if(kind==="class_assignment") await sql`SELECT id FROM class_section_staff_assignments WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND user_id=${userId}::uuid FOR UPDATE`.execute(db);
    else if(kind==="event_assignment") await sql`SELECT event_id FROM campus_event_staff WHERE school_id=${schoolId}::uuid AND event_id=${id}::uuid AND user_id=${userId}::uuid FOR UPDATE`.execute(db);
    else if(kind==="assessment_assignment") await sql`SELECT assessment_id FROM assessment_staff_assignments WHERE school_id=${schoolId}::uuid AND assessment_id=${id}::uuid AND user_id=${userId}::uuid FOR UPDATE`.execute(db);
    else await sql`SELECT id FROM transport_trips WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db);
  }

  async endClassAssignment(user:AuthUser,schoolId:string,body:unknown) {
    const input=z.object({source_id:uuid,expected_revision:z.number().int().positive(),reason:z.string().trim().min(4).max(500)}).strict().parse(body);
    return this.db.transaction().execute(async(db)=>{
      await this.admin(db,user,schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${schoolId}`},0))`.execute(db);
      const current=(await sql<any>`SELECT * FROM class_section_staff_assignments WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if(!current)throw new NotFoundException("Class assignment not found.");
      if(current.ended_at || current.access_revision!==input.expected_revision)throw new ConflictException("Assignment changed. Refresh before ending it.");
      const ended=(await sql<any>`UPDATE class_section_staff_assignments SET ended_at=now() WHERE id=${current.id}::uuid RETURNING access_revision`.execute(db)).rows[0];
      await this.audit(db,user,schoolId,current.id,"staff.assignment.ended",{revision:ended.access_revision,reason:input.reason},[current.user_id]);
      return {ended:true};
    });
  }

  options() { return roleOptions(); }
}
