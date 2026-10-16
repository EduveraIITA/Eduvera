import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { DayPlanService } from "./day-plan.service.js";
import { DayPlanController } from "./day-plan.controller.js";
@Module({
  imports: [SchoolModule, CampusModelCoreModule],
  providers: [DayPlanService],
  controllers: [DayPlanController],
})
export class DayPlanModule {}
