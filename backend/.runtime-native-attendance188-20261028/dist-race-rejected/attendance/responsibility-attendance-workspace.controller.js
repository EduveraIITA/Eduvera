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
import { Controller, Get, Query, Req } from "@nestjs/common";
import { ResponsibilityAttendanceWorkspaceService } from "./responsibility-attendance-workspace.service.js";
let ResponsibilityAttendanceWorkspaceController = class ResponsibilityAttendanceWorkspaceController {
    attendance;
    constructor(attendance) {
        this.attendance = attendance;
    }
    workspace(request, surface, date, caseId) {
        return this.attendance.workspace(request.authUser, request.executionEnvironment, request.executionEnvironmentView, { surface, date, case_id: caseId });
    }
};
__decorate([
    Get("workspace"),
    __param(0, Req()),
    __param(1, Query("surface")),
    __param(2, Query("date")),
    __param(3, Query("case_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ResponsibilityAttendanceWorkspaceController.prototype, "workspace", null);
ResponsibilityAttendanceWorkspaceController = __decorate([
    Controller("api/v1/attendance"),
    __metadata("design:paramtypes", [ResponsibilityAttendanceWorkspaceService])
], ResponsibilityAttendanceWorkspaceController);
export { ResponsibilityAttendanceWorkspaceController };
//# sourceMappingURL=responsibility-attendance-workspace.controller.js.map