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
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Query, Req } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { ResponsibilityAttendanceWorkspaceController } from "../attendance/responsibility-attendance-workspace.controller.js";
import { ResponsibilityAttendanceRepository } from "../attendance/responsibility-attendance.repository.js";
import { ResponsibilityAttendanceWorkspaceService } from "../attendance/responsibility-attendance-workspace.service.js";
import { ResponsibilityClassWorkspaceController } from "../attendance/responsibility-class-workspace.controller.js";
import { ResponsibilityClassWorkspaceService } from "../attendance/responsibility-class-workspace.service.js";
import { WorkspaceModule } from "../workspace/workspace.module.js";
import { AttendanceModelService } from "./attendance-model.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
let AttendanceModelController = class AttendanceModelController {
    attendance;
    constructor(attendance) {
        this.attendance = attendance;
    }
    workspace(request, date) {
        return this.attendance.workspace(request.authUser, date);
    }
    session(request, sessionId) {
        return this.attendance.screen(request.authUser, sessionId);
    }
    history(request, sessionId) {
        return this.attendance.history(request.authUser, sessionId);
    }
    submit(request, sessionId) {
        return this.attendance.save(request.authUser, sessionId, request.body, request);
    }
    lock(request, sessionId) {
        return this.attendance.setLock(request.authUser, sessionId, true, request.body, request);
    }
    unlock(request, sessionId) {
        return this.attendance.setLock(request.authUser, sessionId, false, request.body, request);
    }
    issueQr(request, sessionId) {
        return this.attendance.issueQr(request.authUser, sessionId, request);
    }
    decideEvidence(request, sessionId, evidenceId) {
        return this.attendance.decideEvidence(request.authUser, sessionId, evidenceId, request.body, request);
    }
    selfCheckIn(request, token) {
        return this.attendance.selfCheckIn(request.authUser, token, request);
    }
};
__decorate([
    Get("workspace"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "workspace", null);
__decorate([
    Get("sessions/:sessionId"),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "session", null);
__decorate([
    Get("sessions/:sessionId/history"),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "history", null);
__decorate([
    Post("sessions/:sessionId/submit"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "submit", null);
__decorate([
    Post("sessions/:sessionId/lock"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "lock", null);
__decorate([
    Delete("sessions/:sessionId/lock"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "unlock", null);
__decorate([
    Post("sessions/:sessionId/qr"),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "issueQr", null);
__decorate([
    Post("sessions/:sessionId/evidence/:evidenceId/decision"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __param(2, Param("evidenceId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "decideEvidence", null);
__decorate([
    Post("self-check-in"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Body("token")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AttendanceModelController.prototype, "selfCheckIn", null);
AttendanceModelController = __decorate([
    Controller("api/v1/attendance-model"),
    __metadata("design:paramtypes", [AttendanceModelService])
], AttendanceModelController);
let AttendanceModelModule = class AttendanceModelModule {
};
AttendanceModelModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule, WorkspaceModule],
        controllers: [AttendanceModelController, ResponsibilityAttendanceWorkspaceController, ResponsibilityClassWorkspaceController],
        providers: [AttendanceModelService, ResponsibilityAttendanceRepository, ResponsibilityAttendanceWorkspaceService, ResponsibilityClassWorkspaceService],
        exports: [AttendanceModelService],
    })
], AttendanceModelModule);
export { AttendanceModelModule };
//# sourceMappingURL=attendance-model.module.js.map