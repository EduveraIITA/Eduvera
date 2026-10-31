import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusEventFinanceController } from "./campus-event-finance.controller.js";
import { CampusEventFinanceService } from "./campus-event-finance.service.js";
import { CampusEventsController } from "./campus-events.controller.js";
import { CampusEventsService } from "./campus-events.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { SchedulePlanningModule } from '../schedule-planning/schedule-planning.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';

@Module({
  imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule],
  controllers: [CampusEventsController, CampusEventFinanceController],
  providers: [CampusEventsService, CampusEventFinanceService],
  exports: [CampusEventsService],
})
export class CampusEventsModule {}
