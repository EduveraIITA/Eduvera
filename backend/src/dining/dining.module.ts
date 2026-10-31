import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { DiningService } from "./dining.service.js";
import { DiningAccess } from "./dining.access.js";
import { DiningModel } from "./dining.model.js";
import { DiningController } from "./dining.controller.js";
import { DiningWeeklyService } from "./dining-weekly.service.js";
@Module({
  imports: [CampusModelCoreModule],
  controllers: [DiningController],
  providers: [DiningService, DiningAccess, DiningModel, DiningWeeklyService],
  exports: [DiningService],
})
export class DiningModule {}
