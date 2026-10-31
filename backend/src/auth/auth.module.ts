import { PersonalProfileController } from './personal-profile.controller.js';
import { PersonalProfileService } from './personal-profile.service.js';
import { AccountPhoneDelivery } from './account-phone-delivery.js';
import { Module } from "@nestjs/common";
import { AuditService } from "../common/audit.service.js";
import { AuthController } from "./auth.controller.js";
import { NativeAuthController } from "./native-auth.controller.js";
import { NativeGoogleController } from "./native-google.controller.js";
import { NativeGoogleService } from "./native-google.service.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard, SessionGuard } from "./guards.js";
import { InternalAgentDelegationService } from "./internal-agent-delegation.js";
import { CampusScenarioModule } from "../campus-scenarios/campus-scenario.module.js";
import { SimulationModule } from "../simulation/simulation.module.js";
import { SimulationWorldModule } from "../database/simulation-world.module.js";
import { ProgressiveWorkspaceModule } from "../institution-onboarding/progressive-workspace.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";

@Module({
  imports: [SimulationWorldModule, SimulationModule, CampusScenarioModule, ProgressiveWorkspaceModule, CampusModelCoreModule],
  controllers: [PersonalProfileController, AuthController, NativeAuthController, NativeGoogleController],
  providers: [PersonalProfileService, AccountPhoneDelivery, GoogleAuthService, NativeGoogleService, AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
  exports: [AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
})
export class AuthModule {}
