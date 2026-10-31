import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { OperatingDayController } from "./operating-day.controller.js";
import { OperatingDayRepository } from "./operating-day.repository.js";
import { OperatingDayService } from "./operating-day.service.js";

@Module({
  imports: [CampusModelCoreModule],
  controllers: [OperatingDayController],
  providers: [OperatingDayRepository, OperatingDayService],
  exports: [OperatingDayService],
})
export class OperatingDayModule {}
