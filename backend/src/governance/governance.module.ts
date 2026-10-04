import { Module } from "@nestjs/common";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";

@Module({ controllers: [GovernanceController], providers: [GovernanceService] })
export class GovernanceModule {}
