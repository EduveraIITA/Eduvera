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
import { Controller, Get, GoneException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { AccessRolesService } from "../roles/access-roles.service.js";
import { StaffOperationsService } from "./staff-operations.service.js";
let StaffOperationsController = class StaffOperationsController {
    staff;
    accessRoles;
    constructor(staff, accessRoles) {
        this.staff = staff;
        this.accessRoles = accessRoles;
    }
    createRole(req, schoolId) {
        return this.accessRoles.save(req.authUser, schoolId, req.body);
    }
    updateRole(req, schoolId, roleId) {
        return this.accessRoles.save(req.authUser, schoolId, req.body, roleId);
    }
    assignRole(req, schoolId) {
        return this.accessRoles.assign(req.authUser, schoolId, req.body);
    }
    changeRole(req, schoolId) {
        return this.accessRoles.changeAssignmentRole(req.authUser, schoolId, req.body);
    }
    endClassRole(req, schoolId) {
        return this.accessRoles.endClassAssignment(req.authUser, schoolId, req.body);
    }
    workspace(req, schoolId, requestId) {
        return this.staff.workspace(req.authUser, schoolId, requestId);
    }
    createProfile(req, schoolId) {
        return this.staff.createProfile(req.authUser, schoolId, req.body);
    }
    createWorkType(req, schoolId) {
        void req;
        void schoolId;
        throw new GoneException("Work types have been replaced by Roles & access. Refresh the app.");
    }
    updateWorkType(req, schoolId, workTypeId) {
        void req;
        void schoolId;
        void workTypeId;
        throw new GoneException("Work types have been replaced by Roles & access. Refresh the app.");
    }
    updateOnboarding(req, schoolId, profileId) {
        return this.staff.updateOnboarding(req.authUser, schoolId, profileId, req.body);
    }
    createPolicy(req, schoolId) {
        return this.staff.savePolicy(req.authUser, schoolId, req.body);
    }
    updatePolicy(req, schoolId, policyId) {
        return this.staff.savePolicy(req.authUser, schoolId, req.body, policyId);
    }
    adjustBalance(req, schoolId) {
        return this.staff.adjustBalance(req.authUser, schoolId, req.body);
    }
    createResponsibility(req, schoolId) {
        return this.staff.createResponsibility(req.authUser, schoolId, req.body);
    }
    respondResponsibility(req, schoolId, assignmentId) {
        return this.staff.respondResponsibility(req.authUser, schoolId, assignmentId, req.body);
    }
    revokeResponsibility(req, schoolId, assignmentId) {
        return this.staff.revokeResponsibility(req.authUser, schoolId, assignmentId, req.body);
    }
    assignCoverage(req, schoolId, taskId) {
        return this.staff.assignCoverage(req.authUser, schoolId, taskId, req.body);
    }
    respondCoverage(req, schoolId, taskId) {
        return this.staff.respondCoverage(req.authUser, schoolId, taskId, req.body);
    }
    saveCoveragePolicy(req, schoolId) {
        return this.staff.saveCoveragePolicy(req.authUser, schoolId, req.body);
    }
    requestLeave(req, schoolId) {
        return this.staff.requestLeave(req.authUser, schoolId, req.body);
    }
    leaveImpact(req, schoolId) {
        return this.staff.leaveImpact(req.authUser, schoolId, req.body);
    }
    decideLeave(req, schoolId, requestId) {
        return this.staff.decideLeave(req.authUser, schoolId, requestId, req.body);
    }
    withdrawLeave(req, schoolId, requestId) {
        return this.staff.withdrawLeave(req.authUser, schoolId, requestId, req.body);
    }
    rerouteLeave(req, schoolId, requestId) {
        return this.staff.rerouteLeave(req.authUser, schoolId, requestId, req.body);
    }
};
__decorate([
    Post("access-roles/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "createRole", null);
__decorate([
    Patch("access-roles/:roleId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("roleId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "updateRole", null);
__decorate([
    Post("role-assignments/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "assignRole", null);
__decorate([
    Post("role-assignments/change-role/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "changeRole", null);
__decorate([
    Post("role-assignments/end-class/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "endClassRole", null);
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("request_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "workspace", null);
__decorate([
    Post("profiles/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "createProfile", null);
__decorate([
    Post("work-types/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "createWorkType", null);
__decorate([
    Patch("work-types/:workTypeId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("workTypeId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "updateWorkType", null);
__decorate([
    Patch("profiles/:profileId/onboarding/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("profileId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "updateOnboarding", null);
__decorate([
    Post("leave-policies/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "createPolicy", null);
__decorate([
    Patch("leave-policies/:policyId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("policyId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "updatePolicy", null);
__decorate([
    Post("balance-adjustments/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "adjustBalance", null);
__decorate([
    Post("responsibilities/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "createResponsibility", null);
__decorate([
    Post("responsibilities/:assignmentId/response/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assignmentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "respondResponsibility", null);
__decorate([
    Post("responsibilities/:assignmentId/revoke/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assignmentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "revokeResponsibility", null);
__decorate([
    Post("coverage-tasks/:taskId/assign/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("taskId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "assignCoverage", null);
__decorate([
    Post("coverage-tasks/:taskId/response/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("taskId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "respondCoverage", null);
__decorate([
    Patch("coverage-policy/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "saveCoveragePolicy", null);
__decorate([
    Post("leave-requests/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "requestLeave", null);
__decorate([
    Post("leave-impact/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "leaveImpact", null);
__decorate([
    Post("leave-requests/:requestId/decision/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "decideLeave", null);
__decorate([
    Post("leave-requests/:requestId/withdraw/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "withdrawLeave", null);
__decorate([
    Post("leave-requests/:requestId/reroute/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffOperationsController.prototype, "rerouteLeave", null);
StaffOperationsController = __decorate([
    Controller("api/v1/schools/:schoolId/staff"),
    __metadata("design:paramtypes", [StaffOperationsService, AccessRolesService])
], StaffOperationsController);
export { StaffOperationsController };
//# sourceMappingURL=staff-operations.controller.js.map