import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { SchedulePlanningController } from './schedule-planning.controller.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
@Module({imports:[SchoolModule],controllers:[SchedulePlanningController],providers:[SchedulePlanningService]})
export class SchedulePlanningModule {}
