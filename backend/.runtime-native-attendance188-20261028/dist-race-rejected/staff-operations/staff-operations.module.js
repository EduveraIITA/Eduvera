var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let StaffOperationsModule = class StaffOperationsModule {
};
StaffOperationsModule = __decorate([
    Module({
        imports: [CampusModelCoreModule, GovernanceModule, StaffCoverageReconciliationModule],
        controllers: [StaffOperationsController, StaffLeaveReviewRoutingController],
        providers: [StaffOperationsService, StaffLeaveModelBridgeService, StaffLeaveWorkProjection, StaffLeaveReviewRoutingService, AccessRolesService],
        exports: [StaffOperationsService, StaffLeaveWorkProjection],
    })
], StaffOperationsModule);
export { StaffOperationsModule };
//# sourceMappingURL=staff-operations.module.js.map