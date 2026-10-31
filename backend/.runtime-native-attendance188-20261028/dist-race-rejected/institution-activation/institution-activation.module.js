var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { ProgressiveSetupController } from "./progressive-setup.controller.js";
import { ProgressiveSetupService } from "./progressive-setup.service.js";
let InstitutionActivationModule = class InstitutionActivationModule {
};
InstitutionActivationModule = __decorate([
    Module({
        imports: [AuthModule, CampusModelCoreModule, StaffCoverageReconciliationModule],
        controllers: [ProgressiveSetupController],
        providers: [ProgressiveSetupService],
        exports: [ProgressiveSetupService],
    })
], InstitutionActivationModule);
export { InstitutionActivationModule };
//# sourceMappingURL=institution-activation.module.js.map