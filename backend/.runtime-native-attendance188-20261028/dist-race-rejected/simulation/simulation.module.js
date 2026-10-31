var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SimulationModule_1;
import { Module } from "@nestjs/common";
import { TRANSIENT_EXECUTION_RUN_CATALOG } from "../campus-model-core/transient-execution-run.contracts.js";
import { SimulationController } from "./simulation.controller.js";
import { SimulationResourcesController } from "./simulation-resources.controller.js";
import { SimulationRepository } from "./simulation.repository.js";
import { SimulationService } from "./simulation.service.js";
import { SimulationWorkerService } from "./simulation-worker.service.js";
import { SIMULATION_RESOURCE_POLICY, simulationResourcePolicy, } from "./simulation-resource-policy.js";
const resourcePolicyProvider = {
    provide: SIMULATION_RESOURCE_POLICY,
    useFactory: simulationResourcePolicy,
};
const catalogProvider = {
    provide: TRANSIENT_EXECUTION_RUN_CATALOG,
    useExisting: SimulationService,
};
let SimulationModule = SimulationModule_1 = class SimulationModule {
    /** Register the deployment's reviewed isolated-world adapter. */
    static register(worldProvider) {
        return {
            module: SimulationModule_1,
            providers: [worldProvider],
            exports: [SimulationService, TRANSIENT_EXECUTION_RUN_CATALOG],
        };
    }
};
SimulationModule = SimulationModule_1 = __decorate([
    Module({
        controllers: [SimulationController, SimulationResourcesController],
        providers: [
            SimulationRepository,
            SimulationService,
            SimulationWorkerService,
            resourcePolicyProvider,
            catalogProvider,
        ],
        exports: [SimulationService, TRANSIENT_EXECUTION_RUN_CATALOG],
    })
], SimulationModule);
export { SimulationModule };
//# sourceMappingURL=simulation.module.js.map