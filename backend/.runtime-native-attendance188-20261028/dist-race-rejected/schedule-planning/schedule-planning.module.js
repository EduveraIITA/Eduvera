var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { SchedulePlanningController } from './schedule-planning.controller.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
import { StaffCoverageReconciliationModule } from '../staff-operations/staff-coverage-reconciliation.module.js';
import { ActivityPlanningService } from './activity-planning.service.js';
import { ActivityPlanningController } from './activity-planning.controller.js';
import { OwnedPlanFootprintBridge } from './owned-plan-footprint.bridge.js';
let SchedulePlanningModule = class SchedulePlanningModule {
};
SchedulePlanningModule = __decorate([
    Module({ imports: [SchoolModule, CampusModelCoreModule, StaffCoverageReconciliationModule], controllers: [SchedulePlanningController, ActivityPlanningController], providers: [SchedulePlanningService, ActivityPlanningService, OwnedPlanFootprintBridge], exports: [ActivityPlanningService, OwnedPlanFootprintBridge] })
], SchedulePlanningModule);
export { SchedulePlanningModule };
//# sourceMappingURL=schedule-planning.module.js.map