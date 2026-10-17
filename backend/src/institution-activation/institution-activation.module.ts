import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { InstitutionActivationController } from "./institution-activation.controller.js";
import { InstitutionActivationService } from "./institution-activation.service.js";

@Module({
  imports: [AuthModule, CampusModelCoreModule, StaffCoverageReconciliationModule],
  controllers: [InstitutionActivationController],
  providers: [InstitutionActivationService],
})
export class InstitutionActivationModule {}
