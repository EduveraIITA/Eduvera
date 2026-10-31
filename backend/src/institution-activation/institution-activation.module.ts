import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { ProgressiveSetupController } from "./progressive-setup.controller.js";
import { ProgressiveSetupService } from "./progressive-setup.service.js";

@Module({
  imports: [AuthModule, CampusModelCoreModule, StaffCoverageReconciliationModule],
  controllers: [ProgressiveSetupController],
  providers: [ProgressiveSetupService],
  exports: [ProgressiveSetupService],
})
export class InstitutionActivationModule {}
