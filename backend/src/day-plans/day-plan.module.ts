import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { DayPlanService } from "./day-plan.service.js";
import { DayPlanController } from "./day-plan.controller.js";
@Module({
  imports: [SchoolModule],
  providers: [DayPlanService],
  controllers: [DayPlanController],
})
export class DayPlanModule {}
