import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { SchedulePlanningController } from './schedule-planning.controller.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
import { StaffCoverageReconciliationModule } from '../staff-operations/staff-coverage-reconciliation.module.js';
@Module({imports:[SchoolModule,CampusModelCoreModule,StaffCoverageReconciliationModule],controllers:[SchedulePlanningController],providers:[SchedulePlanningService]})
export class SchedulePlanningModule {}
