import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { SimulationService } from "./simulation.service.js";

@Controller("api/v1/schools/:schoolId/simulation")
export class SimulationController {
  constructor(private readonly simulations: SimulationService) {}

  @Get("runs")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Query() query: unknown,
  ) {
    return this.simulations.list(request.authUser, schoolId, query);
  }

  @Post("runs")
  create(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.create(request.authUser, schoolId, body);
  }

  @Post("compare")
  compare(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.compare(request.authUser, schoolId, body);
  }

  @Get("runs/:runId")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.simulations.get(request.authUser, schoolId, runId);
  }

  @Patch("runs/:runId/draft")
  updateDraft(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.updateDraft(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/changes")
  recordChange(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.recordChange(request.authUser, schoolId, runId, body);
  }

  @Put("runs/:runId/behaviour")
  configureBehaviour(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.configureBehaviour(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/duplicate")
  duplicate(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.duplicate(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/start")
  start(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.start(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/pause")
  pause(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.simulations.pause(request.authUser, schoolId, runId);
  }

  @Post("runs/:runId/resume")
  resume(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.resume(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/stop")
  stop(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.stop(request.authUser, schoolId, runId, body);
  }

  @Post("runs/:runId/pin")
  pin(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.simulations.pin(request.authUser, schoolId, runId);
  }

  @Post("runs/:runId/unpin")
  unpin(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
  ) {
    return this.simulations.unpin(request.authUser, schoolId, runId);
  }

  @Post("runs/:runId/remove")
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.simulations.remove(request.authUser, schoolId, runId, body);
  }
}
