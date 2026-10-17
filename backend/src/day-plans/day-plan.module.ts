import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { DayPlanService } from "./day-plan.service.js";
import { DayPlanController } from "./day-plan.controller.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
@Module({
  imports: [SchoolModule, CampusModelCoreModule, StaffCoverageReconciliationModule],
  providers: [DayPlanService],
  controllers: [DayPlanController],
})
export class DayPlanModule {}
