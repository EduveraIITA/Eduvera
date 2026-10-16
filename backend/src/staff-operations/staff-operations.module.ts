import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { StaffOperationsController } from "./staff-operations.controller.js";
import { StaffLeaveModelBridgeService } from "./staff-leave-model-bridge.service.js";
import { StaffOperationsService } from "./staff-operations.service.js";
import { AccessRolesService } from "../roles/access-roles.service.js";

@Module({
  imports: [CampusModelCoreModule, GovernanceModule],
  controllers: [StaffOperationsController],
  providers: [StaffOperationsService, StaffLeaveModelBridgeService, AccessRolesService],
})
export class StaffOperationsModule {}
