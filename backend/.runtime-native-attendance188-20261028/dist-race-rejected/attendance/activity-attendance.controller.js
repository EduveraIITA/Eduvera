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
import { Controller, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { ActivityAttendanceWorkspaceService } from "./activity-attendance-workspace.service.js";
let ActivityAttendanceController = class ActivityAttendanceController {
    attendance;
    workspace;
    constructor(attendance, workspace) {
        this.attendance = attendance;
        this.workspace = workspace;
    }
    list(request, schoolId, query) {
        return this.workspace.list(request.authUser, schoolId, query);
    }
    forOccurrence(request, schoolId, id) {
        return this.workspace.openOccurrence(request.authUser, schoolId, id);
    }
    detail(request, schoolId, id) {
        return this.attendance.detail(request.authUser, schoolId, id);
    }
    history(request, schoolId, id, query) {
        return this.attendance.history(request.authUser, schoolId, id, query);
    }
    marks(request, schoolId, id) {
        return this.attendance.marks(request.authUser, schoolId, id, request.body, request);
    }
    submit(request, schoolId, id) {
        if (request.body && typeof request.body === "object" && "records" in request.body) {
            return this.attendance.submitRecords(request.authUser, schoolId, id, request.body, request);
        }
        return this.attendance.transition(request.authUser, schoolId, id, "submit", request.body, request);
    }
    finalize(request, schoolId, id) {
        return this.attendance.transition(request.authUser, schoolId, id, "finalize", request.body, request);
    }
    reopen(request, schoolId, id) {
        return this.attendance.transition(request.authUser, schoolId, id, "reopen", request.body, request);
    }
    evidence(request, schoolId, id) {
        return this.attendance.evidence(request.authUser, schoolId, id, request.body, request);
    }
    decideEvidence(request, schoolId, id, evidenceId) {
        return this.attendance.decideEvidence(request.authUser, schoolId, id, evidenceId, request.body, request);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "list", null);
__decorate([
    Get("for-occurrence/:occurrenceId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("occurrenceId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "forOccurrence", null);
__decorate([
    Get(":registerId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "detail", null);
__decorate([
    Get(":registerId/history"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "history", null);
__decorate([
    Put(":registerId/marks"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "marks", null);
__decorate([
    Post(":registerId/submit"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "submit", null);
__decorate([
    Post(":registerId/finalize"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "finalize", null);
__decorate([
    Post(":registerId/reopen"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "reopen", null);
__decorate([
    Post(":registerId/evidence"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "evidence", null);
__decorate([
    Post(":registerId/evidence/:evidenceId/decision"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("registerId")),
    __param(3, Param("evidenceId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ActivityAttendanceController.prototype, "decideEvidence", null);
ActivityAttendanceController = __decorate([
    Controller("api/v1/schools/:schoolId/activities/registers"),
    __metadata("design:paramtypes", [ActivityAttendanceService, ActivityAttendanceWorkspaceService])
], ActivityAttendanceController);
export { ActivityAttendanceController };
//# sourceMappingURL=activity-attendance.controller.js.map