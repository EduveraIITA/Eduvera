import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { StaffOperationsController } from "./staff-operations.controller.js";
import { StaffLeaveModelBridgeService } from "./staff-leave-model-bridge.service.js";
import { StaffOperationsService } from "./staff-operations.service.js";
import { AccessRolesService } from "../roles/access-roles.service.js";
import { StaffCoverageReconciliationModule } from "./staff-coverage-reconciliation.module.js";
import { StaffLeaveWorkProjection } from "./staff-leave-work.projection.js";
import { StaffLeaveReviewRoutingService } from "./staff-leave-review-routing.service.js";
import { StaffLeaveReviewRoutingController } from "./staff-leave-review-routing.controller.js";

@Module({
  imports: [CampusModelCoreModule, GovernanceModule, StaffCoverageReconciliationModule],
  controllers: [StaffOperationsController, StaffLeaveReviewRoutingController],
  providers: [StaffOperationsService, StaffLeaveModelBridgeService, StaffLeaveWorkProjection, StaffLeaveReviewRoutingService, AccessRolesService],
  exports: [StaffOperationsService, StaffLeaveWorkProjection],
})
export class StaffOperationsModule {}
