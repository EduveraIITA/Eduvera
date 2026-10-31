var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { PERMISSION_METADATA } from "./permissions.js";
import { RolesService } from "./roles.service.js";
let PermissionGuard = class PermissionGuard {
    reflector;
    db;
    roles;
    executionScope;
    constructor(reflector, db, roles, executionScope) {
        this.reflector = reflector;
        this.db = db;
        this.roles = roles;
        this.executionScope = executionScope;
    }
    async canActivate(context) {
        const permission = this.reflector.getAllAndOverride(PERMISSION_METADATA, [context.getHandler(), context.getClass()]);
        if (!permission)
            return true;
        const req = context.switchToHttp().getRequest();
        const authorize = async () => {
            const params = req.params, query = req.query, body = (req.body ?? {});
            // Family requests retain relationship authority independently of staff role grants.
            if (context.getClass().name === 'CoordinationController' && (query.context === 'guardian' || body.context === 'guardian'))
                return true;
            const supplied = params.schoolId || query.school_id || (typeof body.school_id === 'string' ? body.school_id : undefined);
            const controller = context.getClass().name;
            const resources = [[params.classSectionId || query.class_section_id || (typeof body.class_section_id === 'string' ? body.class_section_id : undefined), 'class_sections'], [params.studentId, 'students'], [params.eventId, 'campus_events'], [params.conversationId, 'chat_conversations']];
            if (params.id && controller === 'CoordinationController')
                resources.push([params.id, 'attendance_followups']);
            if (params.id && controller === 'NoticesController')
                resources.push([params.id, 'school_notices']);
            if (params.id && controller === 'DayPlanController')
                resources.push([params.id, context.getHandler().name === 'respond' ? 'day_plan_periods' : 'day_plans']);
            if (params.sessionId && controller === 'PhotoAttendanceController')
                resources.push([params.sessionId, 'photo_attendance_sessions']);
            let school = supplied;
            for (const [id, table] of resources) {
                if (!id || !/^[0-9a-f-]{36}$/i.test(id))
                    continue;
                const found = await sql `SELECT school_id FROM ${sql.id(table)} WHERE id=${id}::uuid`.execute(this.db);
                if (found.rows[0]) {
                    if (school && school !== found.rows[0].school_id)
                        throw new ForbiddenException('School context does not match this record.');
                    school = found.rows[0].school_id;
                }
            }
            if (params.reportId && /^[0-9a-f-]{36}$/i.test(params.reportId)) {
                const found = await sql `
        SELECT conversation.school_id
        FROM chat_message_reports report
        JOIN chat_messages message ON message.id=report.message_id
        JOIN chat_conversations conversation ON conversation.id=message.conversation_id
        WHERE report.id=${params.reportId}::uuid
        LIMIT 1
      `.execute(this.db);
                if (found.rows[0]) {
                    if (school && school !== found.rows[0].school_id)
                        throw new ForbiddenException('School context does not match this record.');
                    school = found.rows[0].school_id;
                }
            }
            if (!school)
                school = req.authUser.active_school_id ?? undefined;
            if (!school) {
                const memberships = await this.db.selectFrom('school_memberships').select('school_id').where('user_id', '=', req.authUser.id).where('is_active', '=', true).where('role', 'in', ['staff', 'admin']).execute();
                const ids = [...new Set(memberships.map(m => m.school_id))];
                if (ids.length === 1)
                    school = ids[0];
                else if (ids.length > 1)
                    throw new ForbiddenException('Select a school before using staff tools.');
            }
            if (!school)
                return true; // Existing service rejects absent staff membership; family paths are independent.
            const effective = await this.roles.effective(req.authUser, school);
            if ((effective.role === 'staff' || effective.role === 'member') && !effective.permissions.includes(permission))
                throw new ForbiddenException('Your school role does not allow this action (' + permission + ').');
            return true;
        };
        // Session/run authorization is intentionally resolved on the Live control
        // plane. Domain resource and role authority, however, must come from the
        // selected environment. Guards execute before Nest interceptors, so bind
        // their database work explicitly instead of leaking Live lookups into a
        // Simulation request.
        return req.executionEnvironment?.kind === "simulation"
            ? this.executionScope.run(req.executionEnvironment, authorize)
            : authorize();
    }
};
PermissionGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector, DatabaseService, RolesService, ExecutionDataPlaneScope])
], PermissionGuard);
export { PermissionGuard };
//# sourceMappingURL=permission.guard.js.map