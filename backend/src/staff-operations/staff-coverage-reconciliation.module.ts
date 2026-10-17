import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import {
  STAFF_COVERAGE_RECONCILIATION_PORT,
  StaffCoverageReconciliationService,
} from "./staff-coverage-reconciliation.service.js";
import { StaffCoverageOfferBridgeService } from "./staff-coverage-offer-bridge.service.js";

@Module({
  imports: [CampusModelCoreModule],
  providers: [
    StaffCoverageOfferBridgeService,
    StaffCoverageReconciliationService,
    {
      provide: STAFF_COVERAGE_RECONCILIATION_PORT,
      useExisting: StaffCoverageReconciliationService,
    },
  ],
  exports: [STAFF_COVERAGE_RECONCILIATION_PORT, StaffCoverageOfferBridgeService],
})
export class StaffCoverageReconciliationModule {}
