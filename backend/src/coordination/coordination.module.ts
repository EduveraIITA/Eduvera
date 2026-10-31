import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CoordinationController } from "./coordination.controller.js";
import { CoordinationService } from "./coordination.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { FollowupModelBridgeService } from "./followup-model-bridge.service.js";

@Module({ imports: [SchoolModule, CampusModelCoreModule], controllers: [CoordinationController], providers: [CoordinationService, FollowupModelBridgeService] })
export class CoordinationModule {}
