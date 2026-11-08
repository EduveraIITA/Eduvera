import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { FinanceArrangementsBridge } from "./finance-arrangements.bridge.js";
import { FinanceArrangementCommands } from "./finance-arrangements.commands.js";
import { FinanceArrangementsController } from "./finance-arrangements.controller.js";
import { FinanceArrangementsReadService } from "./finance-arrangements.read.js";
import { FinanceArrangementsService } from "./finance-arrangements.service.js";
import { ElectiveFinanceReviewService } from "./elective-finance-review.service.js";

@Module({ imports: [CampusModelCoreModule, GovernanceModule], controllers: [FinanceArrangementsController],
  providers: [FinanceArrangementsAccess, FinanceArrangementCommands, FinanceArrangementsBridge, FinanceArrangementsService, FinanceArrangementsReadService, ElectiveFinanceReviewService],
  exports: [FinanceArrangementsReadService, FinanceArrangementsService, FinanceArrangementsAccess, ElectiveFinanceReviewService] })
export class FinanceArrangementsModule {}
