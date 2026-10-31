var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { FinanceArrangementsBridge } from "./finance-arrangements.bridge.js";
import { FinanceArrangementCommands } from "./finance-arrangements.commands.js";
import { FinanceArrangementsController } from "./finance-arrangements.controller.js";
import { FinanceArrangementsReadService } from "./finance-arrangements.read.js";
import { FinanceArrangementsService } from "./finance-arrangements.service.js";
let FinanceArrangementsModule = class FinanceArrangementsModule {
};
FinanceArrangementsModule = __decorate([
    Module({ imports: [CampusModelCoreModule, GovernanceModule], controllers: [FinanceArrangementsController],
        providers: [FinanceArrangementsAccess, FinanceArrangementCommands, FinanceArrangementsBridge, FinanceArrangementsService, FinanceArrangementsReadService],
        exports: [FinanceArrangementsReadService, FinanceArrangementsService, FinanceArrangementsAccess] })
], FinanceArrangementsModule);
export { FinanceArrangementsModule };
//# sourceMappingURL=finance-arrangements.module.js.map