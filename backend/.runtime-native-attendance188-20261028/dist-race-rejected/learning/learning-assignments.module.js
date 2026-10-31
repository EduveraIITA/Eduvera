var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { LearningAssignmentsController } from "./learning-assignments.controller.js";
import { LearningAssignmentsService } from "./learning-assignments.service.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
import { LearningOfferingsController } from "./learning-offerings.controller.js";
import { LearningOfferingsService } from "./learning-offerings.service.js";
let LearningAssignmentsModule = class LearningAssignmentsModule {
};
LearningAssignmentsModule = __decorate([
    Module({ imports: [CampusModelCoreModule, SchoolModule], controllers: [LearningAssignmentsController, LearningOfferingsController],
        providers: [LearningAssignmentsService, LearningOfferingsService, LearningAssignmentContextService, LearningAssignmentModelService], exports: [LearningAssignmentsService] })
], LearningAssignmentsModule);
export { LearningAssignmentsModule };
//# sourceMappingURL=learning-assignments.module.js.map