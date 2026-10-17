import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusScenarioService } from "./campus-scenario.service.js";

@Controller("api/v1/schools/:schoolId/campus-view/scenarios")
export class CampusScenarioController {
  constructor(private readonly scenarios: CampusScenarioService) {}

  @Get("targets")
  targets(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Query() query: unknown,
  ) {
    return this.scenarios.targets(request.authUser, schoolId, query);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Body() body: unknown,
  ) {
    return this.scenarios.create(request.authUser, schoolId, body);
  }

  @Get(":runId")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.scenarios.get(request.authUser, schoolId, runId);
  }

  @Delete(":runId")
  discard(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.scenarios.discard(request.authUser, schoolId, runId);
  }
}
