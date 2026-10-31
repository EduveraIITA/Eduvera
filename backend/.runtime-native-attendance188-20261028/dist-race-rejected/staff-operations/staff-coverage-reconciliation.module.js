var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { STAFF_COVERAGE_RECONCILIATION_PORT, StaffCoverageReconciliationService, } from "./staff-coverage-reconciliation.service.js";
import { StaffCoverageOfferBridgeService } from "./staff-coverage-offer-bridge.service.js";
let StaffCoverageReconciliationModule = class StaffCoverageReconciliationModule {
};
StaffCoverageReconciliationModule = __decorate([
    Module({
        imports: [CampusModelCoreModule],
        providers: [
            StaffCoverageOfferBridgeService,
            StaffCoverageReconciliationService,
            {
                provide: STAFF_COVERAGE_RECONCILIATION_PORT,
                useExisting: StaffCoverageReconciliationService,
            },
        ],
        exports: [STAFF_COVERAGE_RECONCILIATION_PORT, StaffCoverageOfferBridgeService],
    })
], StaffCoverageReconciliationModule);
export { StaffCoverageReconciliationModule };
//# sourceMappingURL=staff-coverage-reconciliation.module.js.map