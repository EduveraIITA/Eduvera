import { Module } from '@nestjs/common';
import { TeacherFeedbackController } from './teacher-feedback.controller.js';
import { TeacherFeedbackService } from './teacher-feedback.service.js';
@Module({controllers:[TeacherFeedbackController],providers:[TeacherFeedbackService]})
export class TeacherFeedbackModule {}
