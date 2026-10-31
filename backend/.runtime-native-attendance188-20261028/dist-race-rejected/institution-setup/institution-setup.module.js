var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { AuditService } from "../common/audit.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { InstitutionSetupController } from "./institution-setup.controller.js";
import { InstitutionSetupService } from "./institution-setup.service.js";
let InstitutionSetupModule = class InstitutionSetupModule {
};
InstitutionSetupModule = __decorate([
    Module({
        // Authentication and CSRF are application-global guards. This owner does not
        // consume Auth providers; importing Auth here creates an ESM cycle through
        // Simulation → Attendance → Workspace → Resources → topology.
        imports: [CampusModelCoreModule],
        controllers: [InstitutionSetupController],
        providers: [InstitutionSetupService, AuditService],
        exports: [InstitutionSetupService],
    })
], InstitutionSetupModule);
export { InstitutionSetupModule };
//# sourceMappingURL=institution-setup.module.js.map