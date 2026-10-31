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
import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { GovernanceService } from "./governance.service.js";
let GovernanceController = class GovernanceController {
    governance;
    constructor(governance) {
        this.governance = governance;
    }
    workspace(req, schoolId) {
        return this.governance.workspace(req.authUser, schoolId);
    }
    authority(req, schoolId) {
        return this.governance.authorityWorkspace(req.authUser, schoolId);
    }
    draftAuthority(req, schoolId, body) {
        return this.governance.prepareAuthorityDraft(req.authUser, schoolId, body);
    }
    profile(req, schoolId, body) {
        return this.governance.updateProfile(req.authUser, schoolId, body);
    }
    draft(req, schoolId, code, body) {
        return this.governance.saveDraft(req.authUser, schoolId, code, body);
    }
    submit(req, schoolId, versionId, body) {
        return this.governance.submitForReview(req.authUser, schoolId, versionId, body);
    }
    review(req, schoolId, versionId, body) {
        return this.governance.review(req.authUser, schoolId, versionId, body);
    }
    policies(req, schoolId) {
        return this.governance.publishedPolicies(req.authUser, schoolId);
    }
    acknowledge(req, schoolId, versionId, body) {
        return this.governance.acknowledge(req.authUser, schoolId, versionId, body);
    }
};
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "workspace", null);
__decorate([
    Get("authority/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "authority", null);
__decorate([
    Post("authority/draft/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "draftAuthority", null);
__decorate([
    Patch("profile/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "profile", null);
__decorate([
    Post("policies/:code/draft/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("code")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "draft", null);
__decorate([
    Post("policy-versions/:versionId/submit/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("versionId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "submit", null);
__decorate([
    Post("policy-versions/:versionId/review/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("versionId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "review", null);
__decorate([
    Get("policies/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "policies", null);
__decorate([
    Post("policy-versions/:versionId/acknowledgements/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("versionId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], GovernanceController.prototype, "acknowledge", null);
GovernanceController = __decorate([
    Controller("api/v1/schools/:schoolId/governance"),
    __metadata("design:paramtypes", [GovernanceService])
], GovernanceController);
export { GovernanceController };
//# sourceMappingURL=governance.controller.js.map