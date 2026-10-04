import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { DEFAULT_STAFF_PERMISSIONS, PERMISSIONS } from "./permissions.js";
const uuid = z.uuid();
const roleInput = z.object({ name: z.string().trim().min(2).max(80).refine(name=>!["admin","administrator","principal","student","parent","guardian","default staff"].includes(name.toLowerCase()), "Choose a custom name; built-in role names are reserved."), description: z.string().trim().max(500).default(""), permissions: z.array(z.string().refine(code => PERMISSIONS.some(p => p.code === code), "Unknown permission")).max(PERMISSIONS.length), expected_revision: z.number().int().positive().optional() }).strict();
type Db = DatabaseService | Transaction<Database>;
export interface RoleRow { id: string; name: string; description: string; permissions: string[]; revision: number }
@Injectable()
export class RolesService {
  constructor(private readonly db: DatabaseService) {}
  async effective(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    const member = await sql<{ role: string }>`SELECT m.role FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid AND m.is_active AND u.is_active ORDER BY (m.role='admin') DESC,(m.role='staff') DESC LIMIT 1`.execute(db);
    const role = member.rows[0]?.role;
    if (!role) throw new ForbiddenException("An active membership in this school is required.");
    if (role === "admin") return { role, custom_role: null, permissions: PERMISSIONS.map(p => p.code) as string[] };
    if (role !== "staff") return { role, custom_role: null, permissions: [] as string[] };
    const custom = await sql<RoleRow>`SELECT r.id,r.name,r.description,r.permissions,r.revision FROM school_custom_role_assignments a JOIN school_custom_roles r ON r.school_id=a.school_id AND r.id=a.role_id WHERE a.school_id=${schoolId}::uuid AND a.user_id=${user.id}::uuid`.execute(db);
    if (custom.rows[0]) return { role, custom_role: custom.rows[0], permissions: custom.rows[0].permissions };
    const legacy = await sql<{ permission: string }>`SELECT permission FROM school_permission_grants WHERE school_id=${schoolId}::uuid AND user_id=${user.id}::uuid`.execute(db);
    return { role, custom_role: null, permissions: [...DEFAULT_STAFF_PERMISSIONS, ...legacy.rows.map(p => p.permission)] };
  }
  private async admin(user: AuthUser, schoolId: string, db: Db = this.db) {
    if ((await this.effective(user, schoolId, db)).role !== "admin") throw new ForbiddenException("Only school admins and principals can edit roles or assignments.");
  }
  async workspace(user: AuthUser, schoolId: string) {
    await this.admin(user, schoolId);
    const roles = await sql<RoleRow & { member_count: number }>`SELECT r.*,count(a.user_id)::int AS member_count FROM school_custom_roles r LEFT JOIN school_custom_role_assignments a ON a.role_id=r.id AND a.school_id=r.school_id WHERE r.school_id=${schoolId}::uuid GROUP BY r.id ORDER BY lower(r.name)`.execute(this.db);
    const members = await sql<{ user_id: string; name: string; email: string; role: string; role_id: string | null }>`SELECT m.user_id,concat_ws(' ',u.first_name,u.last_name) AS name,u.email,m.role,a.role_id FROM school_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN school_custom_role_assignments a ON a.school_id=m.school_id AND a.user_id=m.user_id WHERE m.school_id=${schoolId}::uuid AND m.is_active AND u.is_active AND m.role IN ('staff','admin') ORDER BY u.first_name`.execute(this.db);
    return { permissions: PERMISSIONS, roles: roles.rows, members: members.rows };
  }
  private async audit(db: Db,user: AuthUser,schoolId: string,action: string,target: string,metadata: unknown) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES(${schoolId}::uuid,${user.id}::uuid,${action},${target}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }
  async save(user: AuthUser, schoolId: string, body: unknown, id?: string) {
    uuid.parse(schoolId); if(id) uuid.parse(id); const data=roleInput.parse(body);
    try { return await this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      await this.admin(user,schoolId,db);
      const permissions=[...new Set(data.permissions)].sort();
      let before: RoleRow | undefined;
      if(id) { before=(await sql<RoleRow>`SELECT * FROM school_custom_roles WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0]; if(!before) throw new NotFoundException("Role not found."); if(data.expected_revision!==before.revision) throw new ConflictException("This role changed. Refresh before saving."); }
      const result=id ? await sql<RoleRow>`UPDATE school_custom_roles SET name=${data.name},description=${data.description},permissions=${permissions}::text[],revision=revision+1,updated_at=now() WHERE school_id=${schoolId}::uuid AND id=${id}::uuid RETURNING *`.execute(db) : await sql<RoleRow>`INSERT INTO school_custom_roles(school_id,name,description,permissions,created_by) VALUES(${schoolId}::uuid,${data.name},${data.description},${permissions}::text[],${user.id}::uuid) RETURNING *`.execute(db);
      const saved=result.rows[0]!; await this.audit(db,user,schoolId,id ? "role.updated" : "role.created",saved.id,{before:before ?? null,after:saved}); return saved;
    }); } catch(error) { if((error as {code?:string}).code==='23505') throw new ConflictException("A role with this name already exists in this school."); throw error; }
  }
  async assign(user: AuthUser, schoolId: string, memberId: string, body: unknown) {
    uuid.parse(schoolId); uuid.parse(memberId); const data=z.object({role_id:uuid.nullable(),expected_role_id:uuid.nullable()}).strict().parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db); await this.admin(user,schoolId,db);
      const member=await sql`SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=${schoolId}::uuid AND m.user_id=${memberId}::uuid AND m.role='staff' AND m.is_active AND u.is_active AND NOT EXISTS(SELECT 1 FROM school_memberships am WHERE am.school_id=m.school_id AND am.user_id=m.user_id AND am.role='admin' AND am.is_active) FOR UPDATE OF m`.execute(db);
      if(!member.rows.length) throw new ForbiddenException("Custom roles can only be assigned to active staff. Admin/principal access is protected.");
      const old=(await sql<{role_id:string}>`SELECT role_id FROM school_custom_role_assignments WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid`.execute(db)).rows[0]?.role_id ?? null;
      if(old!==data.expected_role_id) throw new ConflictException("This assignment changed. Refresh and try again.");
      if(data.role_id) {
        const role=await sql`SELECT 1 FROM school_custom_roles WHERE school_id=${schoolId}::uuid AND id=${data.role_id}::uuid`.execute(db); if(!role.rows.length) throw new NotFoundException("Role not found in this school.");
        await sql`INSERT INTO school_custom_role_assignments(school_id,user_id,role_id,assigned_by) VALUES(${schoolId}::uuid,${memberId}::uuid,${data.role_id}::uuid,${user.id}::uuid) ON CONFLICT(school_id,user_id) DO UPDATE SET role_id=excluded.role_id,assigned_by=excluded.assigned_by,assigned_at=now()`.execute(db);
      } else await sql`DELETE FROM school_custom_role_assignments WHERE school_id=${schoolId}::uuid AND user_id=${memberId}::uuid`.execute(db);
      await this.audit(db,user,schoolId,"role.assigned",memberId,{before:old,after:data.role_id}); return {saved:true};
    });
  }
  async remove(user: AuthUser,schoolId: string,id: string,body: unknown) {
    uuid.parse(schoolId); uuid.parse(id); const {expected_revision}=z.object({expected_revision:z.number().int().positive()}).strict().parse(body);
    return this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db); await this.admin(user,schoolId,db);
      const role=(await sql<RoleRow>`SELECT * FROM school_custom_roles WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0]; if(!role) throw new NotFoundException("Role not found."); if(role.revision!==expected_revision) throw new ConflictException("This role changed. Refresh before deleting.");
      if((await sql`SELECT 1 FROM school_custom_role_assignments WHERE school_id=${schoolId}::uuid AND role_id=${id}::uuid`.execute(db)).rows.length) throw new ConflictException("Reassign staff before deleting this role.");
      await sql`DELETE FROM school_custom_roles WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db); await this.audit(db,user,schoolId,"role.deleted",id,{before:role}); return {deleted:true};
    });
  }
}
