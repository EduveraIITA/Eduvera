import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { CampusViewController } from "./campus-view.controller.js";
import { CampusViewKpiRepository } from "./campus-view-kpi.repository.js";
import { CampusViewKpiService } from "./campus-view-kpi.service.js";
import { CampusViewRepository } from "./campus-view.repository.js";
import { CampusViewService } from "./campus-view.service.js";

@Module({
  imports: [CampusModelCoreModule],
  controllers: [CampusViewController],
  providers: [CampusViewRepository, CampusViewService, CampusViewKpiRepository, CampusViewKpiService],
})
export class CampusViewModule {}
