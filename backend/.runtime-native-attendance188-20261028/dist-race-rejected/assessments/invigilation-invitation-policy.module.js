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
import { Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { InvigilationInvitationPolicyService } from './invigilation-invitation-policy.service.js';
let InvigilationInvitationPolicyController = class InvigilationInvitationPolicyController {
    policies;
    constructor(policies) {
        this.policies = policies;
    }
    workspace(request, schoolId) {
        return this.policies.workspace(request.authUser, z.string().uuid().parse(schoolId));
    }
    approve(request, schoolId) {
        return this.policies.approve(request, z.string().uuid().parse(schoolId), request.body);
    }
};
__decorate([
    Get('/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InvigilationInvitationPolicyController.prototype, "workspace", null);
__decorate([
    Post('/'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InvigilationInvitationPolicyController.prototype, "approve", null);
InvigilationInvitationPolicyController = __decorate([
    Controller('api/v1/schools/:schoolId/assessments/invigilation-invitations'),
    __metadata("design:paramtypes", [InvigilationInvitationPolicyService])
], InvigilationInvitationPolicyController);
export { InvigilationInvitationPolicyController };
let InvigilationInvitationPolicyModule = class InvigilationInvitationPolicyModule {
};
InvigilationInvitationPolicyModule = __decorate([
    Module({ imports: [CampusModelCoreModule], controllers: [InvigilationInvitationPolicyController],
        providers: [InvigilationInvitationPolicyService], exports: [InvigilationInvitationPolicyService] })
], InvigilationInvitationPolicyModule);
export { InvigilationInvitationPolicyModule };
//# sourceMappingURL=invigilation-invitation-policy.module.js.map