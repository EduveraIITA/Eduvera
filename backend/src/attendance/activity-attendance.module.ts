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

@Module({
  imports: [CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule, AttendanceModelModule, SchoolModule],
  controllers: [ActivityAttendanceController],
  providers: [ActivityAttendanceWorkspaceService, ResponsibilityAttendanceRepository, ActivityAttendanceLifecycleBridge, AcademicParticipationEffects],
  exports: [ActivityAttendanceKernelModule, ActivityAttendanceWorkspaceService],
})
export class ActivityAttendanceModule {}
