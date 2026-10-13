import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";

@Module({ imports: [SchoolModule], controllers: [GovernanceController], providers: [GovernanceService] })
export class GovernanceModule {}
