import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { RequestsModule } from "../requests/requests.module.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceRepository } from "./workspace.repository.js";
import { WorkspaceService } from "./workspace.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";
import { ActivityWorkspaceProjection } from "./activity-workspace.projection.js";
import { StaffOperationsModule } from "../staff-operations/staff-operations.module.js";
import { LearningAssignmentsModule } from "../learning/learning-assignments.module.js";
import { FinanceArrangementsModule } from "../operations/finance-arrangements.module.js";
import { NativeFeeReviewsModule } from "../operations/native-fee-reviews.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { ResourceLoansModule } from "../resource-loans/resource-loans.module.js";
import { FacilitiesModule } from "../facilities/facilities.module.js";
import { AccommodationModule } from "../facilities/accommodation/accommodation.module.js";
import { DiningModule } from "../dining/dining.module.js";
import { GateModule } from "../gate/gate.module.js";
import { AssessmentsModule } from "../assessments/assessments.module.js";
import { RestrictedCareModule } from "../restricted-care/restricted-care.module.js";

@Module({
  imports: [CampusModelCoreModule, RequestsModule, SchedulePlanningModule, ActivityAttendanceKernelModule, StaffOperationsModule, LearningAssignmentsModule, FinanceArrangementsModule, NativeFeeReviewsModule, GovernanceModule, ResourceLoansModule, FacilitiesModule, AccommodationModule, DiningModule, GateModule, RestrictedCareModule, AssessmentsModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceRepository, WorkspaceService, ActivityWorkspaceProjection],
  exports: [WorkspaceRepository, WorkspaceService],
})
export class WorkspaceModule {}
