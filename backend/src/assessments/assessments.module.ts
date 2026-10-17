import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { AssessmentInvigilationOfferBridgeService } from "./assessment-invigilation-offer-bridge.service.js";
import { AssessmentModelBridgeService } from "./assessment-model-bridge.service.js";
import { AssessmentsController } from "./assessments.controller.js";
import { AssessmentsService } from "./assessments.service.js";
import { ExamOperationsService } from "./exam-operations.service.js";

@Module({
  imports: [SchoolModule, CampusModelCoreModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService, ExamOperationsService, AssessmentModelBridgeService, AssessmentInvigilationOfferBridgeService],
  exports: [AssessmentsService, ExamOperationsService],
})
export class AssessmentsModule {}
