import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { LearningAssignmentsController } from "./learning-assignments.controller.js";
import { LearningAssignmentsService } from "./learning-assignments.service.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
import { LearningOfferingsController } from "./learning-offerings.controller.js";
import { LearningOfferingsService } from "./learning-offerings.service.js";

@Module({ imports: [CampusModelCoreModule, SchoolModule], controllers: [LearningAssignmentsController, LearningOfferingsController],
  providers: [LearningAssignmentsService, LearningOfferingsService, LearningAssignmentContextService, LearningAssignmentModelService], exports: [LearningAssignmentsService] })
export class LearningAssignmentsModule {}
