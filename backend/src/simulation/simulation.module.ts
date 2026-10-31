import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { TRANSIENT_EXECUTION_RUN_CATALOG } from "../campus-model-core/transient-execution-run.contracts.js";
import { SimulationController } from "./simulation.controller.js";
import { SimulationResourcesController } from "./simulation-resources.controller.js";
import { SimulationRepository } from "./simulation.repository.js";
import { SimulationService } from "./simulation.service.js";
import { SimulationWorkerService } from "./simulation-worker.service.js";
import {
  SIMULATION_RESOURCE_POLICY,
  simulationResourcePolicy,
} from "./simulation-resource-policy.js";

const resourcePolicyProvider: Provider = {
  provide: SIMULATION_RESOURCE_POLICY,
  useFactory: simulationResourcePolicy,
};

const catalogProvider: Provider = {
  provide: TRANSIENT_EXECUTION_RUN_CATALOG,
  useExisting: SimulationService,
};

@Module({
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
export class SimulationModule {
  /** Register the deployment's reviewed isolated-world adapter. */
  static register(worldProvider: Provider): DynamicModule {
    return {
      module: SimulationModule,
      providers: [worldProvider],
      exports: [SimulationService, TRANSIENT_EXECUTION_RUN_CATALOG],
    };
  }
}
