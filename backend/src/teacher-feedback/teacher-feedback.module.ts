import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module.js';
import { TeacherFeedbackController } from './teacher-feedback.controller.js';
import { TeacherFeedbackService } from './teacher-feedback.service.js';
@Module({imports:[SchoolModule],controllers:[TeacherFeedbackController],providers:[TeacherFeedbackService]})
export class TeacherFeedbackModule {}
