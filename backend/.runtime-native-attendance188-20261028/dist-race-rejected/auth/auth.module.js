var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { AuditService } from "../common/audit.service.js";
import { AuthController } from "./auth.controller.js";
import { NativeAuthController } from "./native-auth.controller.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard, SessionGuard } from "./guards.js";
import { InternalAgentDelegationService } from "./internal-agent-delegation.js";
import { CampusScenarioModule } from "../campus-scenarios/campus-scenario.module.js";
import { SimulationModule } from "../simulation/simulation.module.js";
import { SimulationWorldModule } from "../database/simulation-world.module.js";
import { ProgressiveWorkspaceModule } from "../institution-onboarding/progressive-workspace.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
let AuthModule = class AuthModule {
};
AuthModule = __decorate([
    Module({
        imports: [SimulationWorldModule, SimulationModule, CampusScenarioModule, ProgressiveWorkspaceModule, CampusModelCoreModule],
        controllers: [AuthController, NativeAuthController],
        providers: [GoogleAuthService, AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
        exports: [AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
    })
], AuthModule);
export { AuthModule };
//# sourceMappingURL=auth.module.js.map