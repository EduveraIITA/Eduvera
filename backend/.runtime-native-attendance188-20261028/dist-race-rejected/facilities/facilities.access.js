var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { HUMAN_AGENT_IDENTITY_PORT } from '../campus-model-core/human-agent-identity.port.js';
import { executionNow, executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';
import { institutionSchoolPermission } from '../roles/authorization.js';
let FacilitiesAccess = class FacilitiesAccess {
    identities;
    constructor(identities) {
        this.identities = identities;
    }
    async campus(tx, user, schoolId) {
        if (!user.is_active || user.active_school_id !== schoolId || executionEnvironmentStorage.getStore()?.institution_id && executionEnvironmentStorage.getStore().institution_id !== schoolId)
            throw new ForbiddenException('Choose this campus and its current world before opening repairs.');
        const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException('Current canonical campus app access is required.');
        return actor;
    }
    async manages(tx, user, schoolId) {
        try {
            await institutionSchoolPermission(tx, user, schoolId, 'facilities.manage', true);
            return true;
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return false;
            throw error;
        }
    }
    async manager(tx, user, schoolId) { const actor = await this.campus(tx, user, schoolId); await institutionSchoolPermission(tx, user, schoolId, 'facilities.manage', true); return actor; }
};
FacilitiesAccess = __decorate([
    Injectable(),
    __param(0, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [Object])
], FacilitiesAccess);
export { FacilitiesAccess };
//# sourceMappingURL=facilities.access.js.map