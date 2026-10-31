import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { CampusViewController } from "./campus-view.controller.js";
import { CampusViewKpiRepository } from "./campus-view-kpi.repository.js";
import { CampusViewKpiService } from "./campus-view-kpi.service.js";
import { CampusViewRepository } from "./campus-view.repository.js";
import { CampusViewService } from "./campus-view.service.js";
import { CampusPersonalService } from "./campus-personal.service.js";
import { WorkspaceModule } from "../workspace/workspace.module.js";
import { TeachingSessionsModule } from "../teaching-sessions/teaching-sessions.module.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";
import { FacilitiesModule } from "../facilities/facilities.module.js";
import { CampusScenesModule } from "../campus-scenes/campus-scenes.module.js";
import { CampusEventsModule } from '../campus-events/campus-events.module.js';
import { CampusOperationsService } from './campus-operations.service.js';

@Module({
  imports: [CampusModelCoreModule, WorkspaceModule, TeachingSessionsModule, SchedulePlanningModule, FacilitiesModule, CampusScenesModule, CampusEventsModule],
  controllers: [CampusViewController],
  providers: [CampusViewRepository, CampusViewService, CampusViewKpiRepository, CampusViewKpiService, CampusPersonalService, CampusOperationsService],
})
export class CampusViewModule {}
