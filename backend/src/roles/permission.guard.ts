import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { sql } from "kysely";
import type { AuthenticatedRequest } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { PERMISSION_METADATA } from "./permissions.js";
import { RolesService } from "./roles.service.js";
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector,private readonly db: DatabaseService,private readonly roles: RolesService) {}
  async canActivate(context: ExecutionContext) {
    const permission=this.reflector.getAllAndOverride<string>(PERMISSION_METADATA,[context.getHandler(),context.getClass()]);
    if(!permission) return true;
    const req=context.switchToHttp().getRequest<AuthenticatedRequest>();
    const params=req.params as Record<string,string>, query=req.query as Record<string,string>, body=(req.body ?? {}) as Record<string,unknown>;
    // Family requests retain relationship authority independently of staff role grants.
    if(context.getClass().name==='CoordinationController' && (query.context==='guardian' || body.context==='guardian')) return true;
    const supplied=params.schoolId || query.school_id || (typeof body.school_id==='string' ? body.school_id : undefined);
    const controller=context.getClass().name;
    const resources: Array<[string|undefined,string]> = [[params.classSectionId || query.class_section_id || (typeof body.class_section_id==='string' ? body.class_section_id : undefined),'class_sections'],[params.studentId,'students'],[params.eventId,'campus_events'],[params.conversationId,'chat_conversations'],[params.reportId,'chat_message_reports']];
    if(params.id && controller==='CoordinationController') resources.push([params.id,'attendance_followups']);
    if(params.id && controller==='DayPlanController') resources.push([params.id,context.getHandler().name==='respond' ? 'day_plan_periods':'day_plans']);
    if(params.sessionId && controller==='PhotoAttendanceController') resources.push([params.sessionId,'photo_attendance_sessions']);
    let school=supplied;
    for(const [id,table] of resources) {
      if(!id || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      const found=await sql<{school_id:string}>`SELECT school_id FROM ${sql.id(table)} WHERE id=${id}::uuid`.execute(this.db);
      if(found.rows[0]) { if(school && school!==found.rows[0].school_id) throw new ForbiddenException('School context does not match this record.'); school=found.rows[0].school_id; }
    }
    if(!school) school=req.authUser.active_school_id ?? undefined;
    if(!school) { const memberships=await this.db.selectFrom('school_memberships').select('school_id').where('user_id','=',req.authUser.id).where('is_active','=',true).where('role','in',['staff','admin']).execute(); const ids=[...new Set(memberships.map(m=>m.school_id))]; if(ids.length===1) school=ids[0]; else if(ids.length>1) throw new ForbiddenException('Select a school before using staff tools.'); }
    if(!school) return true; // Existing service rejects absent staff membership; family paths are independent.
    const effective=await this.roles.effective(req.authUser,school);
    if(effective.role==='staff' && !effective.permissions.includes(permission)) throw new ForbiddenException('Your school role does not allow this action ('+permission+').');
    return true;
  }
}
