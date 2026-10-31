var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let AssessmentsModule = class AssessmentsModule {
};
AssessmentsModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule, InvigilationInvitationPolicyModule],
        controllers: [AssessmentsController],
        providers: [AssessmentsService, ExamOperationsService, AssessmentModelBridgeService, AssessmentInvigilationOfferBridgeService],
        exports: [AssessmentsService, ExamOperationsService],
    })
], AssessmentsModule);
export { AssessmentsModule };
//# sourceMappingURL=assessments.module.js.map