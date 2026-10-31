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
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { RestrictedCareService } from "./restricted-care.service.js";
let RestrictedCareController = class RestrictedCareController {
    care;
    constructor(care) {
        this.care = care;
    }
    workspace(req, schoolId) {
        return this.care.workspace(req.authUser, schoolId);
    }
    confirm(req, schoolId, commandId) {
        return this.care.confirm(req.authUser, schoolId, commandId);
    }
    orphanedCases(req, schoolId, page) {
        return this.care.orphanedCases(req.authUser, schoolId, page ?? 1);
    }
    recoverOwner(req, schoolId, caseId, body) {
        return this.care.recoverOwner(req.authUser, schoolId, caseId, body);
    }
    assignTeamMember(req, schoolId, body) {
        return this.care.assignTeamMember(req.authUser, schoolId, body);
    }
    revokeTeamMember(req, schoolId, assignmentId, body) {
        return this.care.revokeTeamMember(req.authUser, schoolId, assignmentId, body);
    }
    openCase(req, schoolId, body) {
        return this.care.openCase(req.authUser, schoolId, body);
    }
    caseDetail(req, schoolId, caseId) {
        return this.care.caseDetail(req.authUser, schoolId, caseId);
    }
    act(req, schoolId, caseId, body) {
        return this.care.act(req.authUser, schoolId, caseId, body);
    }
};
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "workspace", null);
__decorate([
    Get("commands/:commandId/confirmation/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("commandId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "confirm", null);
__decorate([
    Get("orphaned-cases/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("page")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "orphanedCases", null);
__decorate([
    Post("orphaned-cases/:caseId/reassign/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("caseId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "recoverOwner", null);
__decorate([
    Post("team-assignments/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "assignTeamMember", null);
__decorate([
    Post("team-assignments/:assignmentId/revoke/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assignmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "revokeTeamMember", null);
__decorate([
    Post("cases/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "openCase", null);
__decorate([
    Get("cases/:caseId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("caseId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "caseDetail", null);
__decorate([
    Post("cases/:caseId/actions/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("caseId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], RestrictedCareController.prototype, "act", null);
RestrictedCareController = __decorate([
    Controller("api/v1/schools/:schoolId/restricted-care"),
    __metadata("design:paramtypes", [RestrictedCareService])
], RestrictedCareController);
export { RestrictedCareController };
//# sourceMappingURL=restricted-care.controller.js.map