import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolController } from "./school.controller.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { OperatingDayModule } from "../operating-day/operating-day.module.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { ClassPracticeService } from "./class-practice.service.js";
import { ClassPracticeController } from "./class-practice.controller.js";

@Module({ imports: [CampusModelCoreModule, ActivityAttendanceKernelModule, StaffCoverageReconciliationModule, OperatingDayModule], controllers: [SchoolController, ClassPracticeController], providers: [SchoolService, SchoolEventService, ClassPracticeService], exports: [SchoolService, SchoolEventService] })
export class SchoolModule {}
