var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT } from "./decision-authority.port.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { FeeAuthorityController } from "./fee-authority.controller.js";
import { FeeAuthorityService } from "./fee-authority.service.js";
let GovernanceModule = class GovernanceModule {
};
GovernanceModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule],
        controllers: [GovernanceController, FeeAuthorityController],
        providers: [
            GovernanceService,
            FeeAuthorityService,
            { provide: GOVERNANCE_DECISION_AUTHORITY_PORT, useExisting: GovernanceService },
        ],
        exports: [GOVERNANCE_DECISION_AUTHORITY_PORT, FeeAuthorityService],
    })
], GovernanceModule);
export { GovernanceModule };
//# sourceMappingURL=governance.module.js.map