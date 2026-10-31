import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT } from "./decision-authority.port.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { FeeAuthorityController } from "./fee-authority.controller.js";
import { FeeAuthorityService } from "./fee-authority.service.js";

@Module({
  imports: [SchoolModule, CampusModelCoreModule],
  controllers: [GovernanceController, FeeAuthorityController],
  providers: [
    GovernanceService,
    FeeAuthorityService,
    { provide: GOVERNANCE_DECISION_AUTHORITY_PORT, useExisting: GovernanceService },
  ],
  exports: [GOVERNANCE_DECISION_AUTHORITY_PORT, FeeAuthorityService],
})
export class GovernanceModule {}
