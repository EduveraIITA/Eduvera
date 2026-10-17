import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import {
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "./execution-data-plane.js";
import { EXECUTION_CLOCK_PORT } from "../campus-model-core/execution-clock.port.js";
import {
  ScopedExecutionClock,
  SYSTEM_WALL_CLOCK,
  SystemWallClock,
} from "./execution-clock.runtime.js";
import { CampusLabSimulationEnvironmentService } from "./campus-lab-simulation-environment.service.js";

@Global()
@Module({
  providers: [
    ExecutionDataPlaneScope,
    ExecutionDataPlaneRegistry,
    DatabaseService,
    SystemWallClock,
    ScopedExecutionClock,
    CampusLabSimulationEnvironmentService,
    { provide: SYSTEM_WALL_CLOCK, useExisting: SystemWallClock },
    { provide: EXECUTION_CLOCK_PORT, useExisting: ScopedExecutionClock },
  ],
  exports: [
    DatabaseService,
    ExecutionDataPlaneScope,
    ExecutionDataPlaneRegistry,
    EXECUTION_CLOCK_PORT,
    CampusLabSimulationEnvironmentService,
  ],
})
export class DatabaseModule {}
