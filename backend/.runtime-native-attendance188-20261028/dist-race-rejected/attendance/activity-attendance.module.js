var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";
import { AttendanceModelModule } from "../attendance-model/attendance-model.module.js";
import { ActivityAttendanceController } from "./activity-attendance.controller.js";
import { ActivityAttendanceKernelModule } from "./activity-attendance-kernel.module.js";
import { ActivityAttendanceWorkspaceService } from "./activity-attendance-workspace.service.js";
import { ResponsibilityAttendanceRepository } from "./responsibility-attendance.repository.js";
import { SchoolModule } from "../school/school.module.js";
import { ActivityAttendanceLifecycleBridge } from "./activity-attendance-lifecycle.bridge.js";
import { AcademicParticipationEffects } from "./academic-participation-effects.service.js";
let ActivityAttendanceModule = class ActivityAttendanceModule {
};
ActivityAttendanceModule = __decorate([
    Module({
        imports: [CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule, AttendanceModelModule, SchoolModule],
        controllers: [ActivityAttendanceController],
        providers: [ActivityAttendanceWorkspaceService, ResponsibilityAttendanceRepository, ActivityAttendanceLifecycleBridge, AcademicParticipationEffects],
        exports: [ActivityAttendanceKernelModule, ActivityAttendanceWorkspaceService],
    })
], ActivityAttendanceModule);
export { ActivityAttendanceModule };
//# sourceMappingURL=activity-attendance.module.js.map