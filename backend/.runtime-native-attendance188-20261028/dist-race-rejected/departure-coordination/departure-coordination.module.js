var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { DepartureCoordinationController } from "./departure-coordination.controller.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";
import { SchoolModule } from "../school/school.module.js";
import { TransportRetentionService } from "./transport-retention.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { TransportDutyModelBridgeService } from "./transport-duty-model-bridge.service.js";
let DepartureCoordinationModule = class DepartureCoordinationModule {
};
DepartureCoordinationModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule, GovernanceModule],
        controllers: [DepartureCoordinationController],
        providers: [DepartureCoordinationService, TransportRetentionService, TransportDutyModelBridgeService],
        exports: [TransportRetentionService],
    })
], DepartureCoordinationModule);
export { DepartureCoordinationModule };
//# sourceMappingURL=departure-coordination.module.js.map