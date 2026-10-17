import { Module } from "@nestjs/common";
import { CampusScenarioController } from "./campus-scenario.controller.js";
import { CampusScenarioRepository } from "./campus-scenario.repository.js";
import { CampusScenarioService } from "./campus-scenario.service.js";

@Module({
  controllers: [CampusScenarioController],
  providers: [CampusScenarioRepository, CampusScenarioService],
})
export class CampusScenarioModule {}
