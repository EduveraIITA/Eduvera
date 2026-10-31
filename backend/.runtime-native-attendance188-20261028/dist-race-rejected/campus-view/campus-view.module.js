var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let CampusViewModule = class CampusViewModule {
};
CampusViewModule = __decorate([
    Module({
        imports: [CampusModelCoreModule, WorkspaceModule, TeachingSessionsModule, SchedulePlanningModule, FacilitiesModule, CampusScenesModule, CampusEventsModule],
        controllers: [CampusViewController],
        providers: [CampusViewRepository, CampusViewService, CampusViewKpiRepository, CampusViewKpiService, CampusPersonalService, CampusOperationsService],
    })
], CampusViewModule);
export { CampusViewModule };
//# sourceMappingURL=campus-view.module.js.map