import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { GateController } from "./gate.controller.js";
import { GateService } from "./gate.service.js";
import { VisitArrangementsController } from "./visit-arrangements.controller.js";
import { VisitArrangementsService } from "./visit-arrangements.service.js";
import { VisitSharingController } from "./visit-sharing.controller.js";
import { VisitSharingService } from "./visit-sharing.service.js";
import { VisitSharingModel } from "./visit-sharing.model.js";
import { VisitOnboardingController, PublicVisitOnboardingController } from './visit-onboarding.controller.js';
import { VisitOnboardingService } from './visit-onboarding.service.js';
import { VisitOnboardingIdentity } from './visit-onboarding-identity.js';
import { VisitOnboardingModel } from './visit-onboarding.model.js';
@Module({imports:[SchoolModule,CampusModelCoreModule],controllers:[GateController,VisitArrangementsController,VisitSharingController,VisitOnboardingController,PublicVisitOnboardingController],providers:[GateService,VisitArrangementsService,VisitSharingService,VisitSharingModel,VisitOnboardingService,VisitOnboardingIdentity,VisitOnboardingModel],exports:[VisitSharingService]})
export class GateModule {}
