import { Module } from "@nestjs/common";
import { DepartureCoordinationController } from "./departure-coordination.controller.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";
import { SchoolModule } from "../school/school.module.js";
import { TransportRetentionService } from "./transport-retention.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { TransportDutyModelBridgeService } from "./transport-duty-model-bridge.service.js";

@Module({
  imports:[SchoolModule,CampusModelCoreModule,GovernanceModule],
  controllers: [DepartureCoordinationController],
  providers: [DepartureCoordinationService,TransportRetentionService,TransportDutyModelBridgeService],
})
export class DepartureCoordinationModule {}
