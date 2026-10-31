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
import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { RequirePermission } from "../roles/permissions.js";
import { AcademicReportsService } from "./academic-reports.service.js";
let AcademicReportsController = class AcademicReportsController {
    reports;
    constructor(reports) {
        this.reports = reports;
    }
    policies(req, schoolId) {
        return this.reports.listPolicies(req.authUser, schoolId);
    }
    createPolicy(req, schoolId, body) {
        return this.reports.createPolicy(req.authUser, schoolId, body);
    }
    activatePolicy(req, schoolId, policyId, body) {
        return this.reports.activatePolicy(req.authUser, schoolId, policyId, body);
    }
    workspace(req, schoolId) {
        return this.reports.workspace(req.authUser, schoolId);
    }
    family(req, schoolId, studentId) {
        return this.reports.familyReports(req.authUser, schoolId, studentId);
    }
    createScheme(req, schoolId, body) {
        return this.reports.createScheme(req.authUser, schoolId, body);
    }
    schemeDetail(req, schoolId, schemeId) {
        return this.reports.schemeDetail(req.authUser, schoolId, schemeId);
    }
    saveSubject(req, schoolId, schemeId, body) {
        return this.reports.saveSubjectPlan(req.authUser, schoolId, schemeId, body);
    }
    activate(req, schoolId, schemeId, body) {
        return this.reports.activateScheme(req.authUser, schoolId, schemeId, body);
    }
    generate(req, schoolId, schemeId, body) {
        return this.reports.generateReport(req.authUser, schoolId, schemeId, body);
    }
    reportDetail(req, schoolId, batchId) {
        return this.reports.reportDetail(req.authUser, schoolId, batchId);
    }
    comments(req, schoolId, batchId, studentId, body) {
        return this.reports.updateComments(req.authUser, schoolId, batchId, studentId, body);
    }
    action(req, schoolId, batchId, action, body) {
        return this.reports.batchAction(req.authUser, schoolId, batchId, action, body);
    }
};
__decorate([
    Get("policies/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "policies", null);
__decorate([
    Post("policies/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "createPolicy", null);
__decorate([
    Post("policies/:policyId/activate/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("policyId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "activatePolicy", null);
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "workspace", null);
__decorate([
    Get("family/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "family", null);
__decorate([
    Post("schemes/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "createScheme", null);
__decorate([
    Get("schemes/:schemeId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("schemeId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "schemeDetail", null);
__decorate([
    Put("schemes/:schemeId/subjects/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("schemeId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "saveSubject", null);
__decorate([
    Post("schemes/:schemeId/activate/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("schemeId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "activate", null);
__decorate([
    Post("schemes/:schemeId/generate/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("schemeId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "generate", null);
__decorate([
    Get("batches/:batchId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("batchId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "reportDetail", null);
__decorate([
    Put("batches/:batchId/students/:studentId/comments/"),
    RequirePermission("reports.comment"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("batchId")),
    __param(3, Param("studentId")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "comments", null);
__decorate([
    Post("batches/:batchId/actions/:action/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("batchId")),
    __param(3, Param("action")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AcademicReportsController.prototype, "action", null);
AcademicReportsController = __decorate([
    Controller("api/v1/schools/:schoolId/academic-reports"),
    __metadata("design:paramtypes", [AcademicReportsService])
], AcademicReportsController);
export { AcademicReportsController };
//# sourceMappingURL=academic-reports.controller.js.map