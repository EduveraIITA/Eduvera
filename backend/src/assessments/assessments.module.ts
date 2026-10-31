import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { AssessmentInvigilationOfferBridgeService } from "./assessment-invigilation-offer-bridge.service.js";
import { AssessmentModelBridgeService } from "./assessment-model-bridge.service.js";
import { AssessmentsController } from "./assessments.controller.js";
import { AssessmentsService } from "./assessments.service.js";
import { ExamOperationsService } from "./exam-operations.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { SchedulePlanningModule } from '../schedule-planning/schedule-planning.module.js';
import { InvigilationInvitationPolicyModule } from './invigilation-invitation-policy.module.js';

@Module({
  imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule, InvigilationInvitationPolicyModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService, ExamOperationsService, AssessmentModelBridgeService, AssessmentInvigilationOfferBridgeService],
  exports: [AssessmentsService, ExamOperationsService],
})
export class AssessmentsModule {}
