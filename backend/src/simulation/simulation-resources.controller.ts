import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../common/request.js";
import { SimulationWorldService } from "../database/simulation-world.service.js";
import { SimulationService } from "./simulation.service.js";

@Controller("api/v1/schools/:schoolId/simulation")
export class SimulationResourcesController {
  constructor(private readonly simulations: SimulationService, private readonly worlds: SimulationWorldService) {}

  @Get("runs/:runId/resources")
  async list(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string,
    @Param("runId") runId: string, @Query() query: unknown) {
    const page = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1),
      page_size: z.coerce.number().int().min(1).max(25).default(5) }).strict().parse(query);
    // The ordinary Live control-plane administrator + tenant/retention check is
    // mandatory even if the caller currently has a Simulation selected.
    await this.simulations.get(request.authUser, schoolId, runId);
    return this.worlds.resources(schoolId, runId, page.page, page.page_size);
  }
}
