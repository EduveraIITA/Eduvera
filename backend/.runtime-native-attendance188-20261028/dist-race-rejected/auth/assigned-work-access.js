var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
/** Technical app scope only. Each owning domain still checks its exact source. */
export async function assignedWorkOnly(db, schoolId, userId) {
    const row = (await sql `SELECT campus_membership_is_work_only(${schoolId}::uuid,${userId}::uuid) AS limited`.execute(db)).rows[0];
    return row?.limited === true;
}
/** Deliberately bounded adapters, not a role portal or a caller-selected scope. */
export function assignedWorkRequestAllowed(method, path, schoolId) {
    const verb = method.toUpperCase();
    const read = verb === 'GET' || verb === 'HEAD';
    if (read && /^\/api\/v1\/(?:workspace|events\/stream|notifications)\/?$/u.test(path))
        return true;
    const visit = path.match(/^\/api\/v1\/gate\/schools\/([0-9a-f-]+)\/visit-arrangements\/(.+?)\/?$/iu);
    if (visit) {
        if (visit[1]?.toLowerCase() !== schoolId.toLowerCase())
            return false;
        const tail = visit[2];
        if (read && /^(?:shared(?:\/discovery)?|[0-9a-f-]+\/shared(?:\/commands\/[0-9a-f-]+)?)$/iu.test(tail))
            return true;
        return verb === 'POST' && /^[0-9a-f-]+\/shared\/questions$/iu.test(tail);
    }
    const campus = path.match(/^\/api\/v1\/schools\/([0-9a-f-]+)\/(.+?)\/?$/iu);
    if (!campus || campus[1]?.toLowerCase() !== schoolId.toLowerCase())
        return false;
    const tail = campus[2];
    if (read && /^invitations\/[0-9a-f-]+\/continuation$/iu.test(tail))
        return true;
    if (read && tail === 'facilities/workspace')
        return true;
    if (read && /^facilities\/repairs\/[0-9a-f-]+(?:\/(?:confirmation|photos\/[0-9a-f-]+))?$/iu.test(tail))
        return true;
    return verb === 'POST' && /^facilities\/repairs\/[0-9a-f-]+\/(?:actions|photos|external-access\/[0-9a-f-]+\/activate)$/iu.test(tail);
}
let AssignedWorkAccess = class AssignedWorkAccess {
    db;
    constructor(db) {
        this.db = db;
    }
    async only(user, schoolId = user.active_school_id) {
        return Boolean(schoolId) && assignedWorkOnly(this.db, schoolId, user.id);
    }
    /** Called inside the selected-world data-plane scope, never an earlier guard. */
    async assertRequest(request) {
        if (!request.authUser?.active_school_id || !await this.only(request.authUser))
            return;
        const path = request.url.split('?', 1)[0];
        if (!assignedWorkRequestAllowed(request.method, path, request.authUser.active_school_id))
            throw new ForbiddenException('This campus access is limited to items shared with you. Open your Areas or Work to continue.');
    }
};
AssignedWorkAccess = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], AssignedWorkAccess);
export { AssignedWorkAccess };
//# sourceMappingURL=assigned-work-access.js.map