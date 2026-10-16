import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT } from "./decision-authority.port.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";

@Module({
  imports: [SchoolModule],
  controllers: [GovernanceController],
  providers: [
    GovernanceService,
    { provide: GOVERNANCE_DECISION_AUTHORITY_PORT, useExisting: GovernanceService },
  ],
  exports: [GOVERNANCE_DECISION_AUTHORITY_PORT],
})
export class GovernanceModule {}
