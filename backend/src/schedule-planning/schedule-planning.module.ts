import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { SchedulePlanningController } from './schedule-planning.controller.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
@Module({imports:[SchoolModule,CampusModelCoreModule],controllers:[SchedulePlanningController],providers:[SchedulePlanningService]})
export class SchedulePlanningModule {}
