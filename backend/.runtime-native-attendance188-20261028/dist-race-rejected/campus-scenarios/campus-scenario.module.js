var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusScenarioController } from "./campus-scenario.controller.js";
import { CampusScenarioRepository } from "./campus-scenario.repository.js";
import { CampusScenarioService } from "./campus-scenario.service.js";
import { TRANSIENT_EXECUTION_RUN_CATALOG } from "../campus-model-core/transient-execution-run.contracts.js";
let CampusScenarioModule = class CampusScenarioModule {
};
CampusScenarioModule = __decorate([
    Module({
        controllers: [CampusScenarioController],
        providers: [
            CampusScenarioRepository,
            CampusScenarioService,
            { provide: TRANSIENT_EXECUTION_RUN_CATALOG, useExisting: CampusScenarioService },
        ],
        exports: [TRANSIENT_EXECUTION_RUN_CATALOG],
    })
], CampusScenarioModule);
export { CampusScenarioModule };
//# sourceMappingURL=campus-scenario.module.js.map