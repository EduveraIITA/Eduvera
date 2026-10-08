import { Module } from '@nestjs/common';
import { StudentPulseController } from './student-pulse.controller.js';
import { StudentPulseService } from './student-pulse.service.js';
@Module({ controllers: [StudentPulseController], providers: [StudentPulseService] })
export class StudentPulseModule {}
