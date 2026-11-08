import { LearningAssignmentHandoverController } from "./learning-assignment-handover.controller.js";
import { LearningAssignmentHandoverService } from "./learning-assignment-handover.service.js";
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { LearningAssignmentsController } from "./learning-assignments.controller.js";
import { LearningAssignmentsService } from "./learning-assignments.service.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
import { LearningOfferingsController } from "./learning-offerings.controller.js";
import { LearningOfferingsService } from "./learning-offerings.service.js";
import { FinanceArrangementsModule } from "../operations/finance-arrangements.module.js";
import { LearningElectiveChangeController, LearningElectiveFinanceController } from "./learning-elective-change.controller.js";
import { LearningElectiveChangeService } from "./learning-elective-change.service.js";
import { LearningElectiveModelService } from "./learning-elective-model.service.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";

@Module({ imports: [CampusModelCoreModule, SchoolModule, FinanceArrangementsModule, SchedulePlanningModule], controllers: [LearningAssignmentsController, LearningOfferingsController, LearningAssignmentHandoverController, LearningElectiveChangeController, LearningElectiveFinanceController],
  providers: [LearningAssignmentHandoverService, LearningAssignmentsService, LearningOfferingsService, LearningAssignmentContextService, LearningAssignmentModelService, LearningElectiveChangeService, LearningElectiveModelService], exports: [LearningAssignmentsService, LearningOfferingsService, LearningElectiveChangeService] })
export class LearningAssignmentsModule {}
