import { Module } from "@nestjs/common";
import { CampusLabHostedController } from "./campus-lab-hosted.controller.js";
import { CampusLabHostedService } from "./campus-lab-hosted.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { CampusLabSimulationEnvironmentService } from "../database/campus-lab-simulation-environment.service.js";

/**
 * Development-harness boundary. The product AppModule deliberately does not
 * import this module; a dedicated local harness bootstrap may opt into it.
 */
@Module({
  imports: [AuthModule],
  controllers: [CampusLabHostedController],
  providers: [CampusLabHostedService, CampusLabSimulationEnvironmentService],
})
export class CampusLabHostedModule {}
