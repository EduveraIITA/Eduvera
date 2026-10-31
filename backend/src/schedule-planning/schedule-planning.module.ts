import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { SchedulePlanningController } from './schedule-planning.controller.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
import { StaffCoverageReconciliationModule } from '../staff-operations/staff-coverage-reconciliation.module.js';
import { ActivityPlanningService } from './activity-planning.service.js';
import { ActivityPlanningController } from './activity-planning.controller.js';
import { OwnedPlanFootprintBridge } from './owned-plan-footprint.bridge.js';
@Module({imports:[SchoolModule,CampusModelCoreModule,StaffCoverageReconciliationModule],controllers:[SchedulePlanningController,ActivityPlanningController],providers:[SchedulePlanningService,ActivityPlanningService,OwnedPlanFootprintBridge],exports:[ActivityPlanningService,OwnedPlanFootprintBridge]})
export class SchedulePlanningModule {}
