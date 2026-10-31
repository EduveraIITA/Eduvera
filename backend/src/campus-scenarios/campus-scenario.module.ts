import { Module } from "@nestjs/common";
import { CampusScenarioController } from "./campus-scenario.controller.js";
import { CampusScenarioRepository } from "./campus-scenario.repository.js";
import { CampusScenarioService } from "./campus-scenario.service.js";
import { TRANSIENT_EXECUTION_RUN_CATALOG } from "../campus-model-core/transient-execution-run.contracts.js";

@Module({
  controllers: [CampusScenarioController],
  providers: [
    CampusScenarioRepository,
    CampusScenarioService,
    { provide: TRANSIENT_EXECUTION_RUN_CATALOG, useExisting: CampusScenarioService },
  ],
  exports: [TRANSIENT_EXECUTION_RUN_CATALOG],
})
export class CampusScenarioModule {}
