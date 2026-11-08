import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { LearningElectiveChangeService } from "./learning-elective-change.service.js";
function writable(req: AuthenticatedRequest) {
  const world = req.executionEnvironmentView;
  if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
    throw new ForbiddenException("This Simulation is read-only. Return to a working world before changing an elective review.");
}
@Controller("api/v1/learning/elective-changes")
export class LearningElectiveChangeController {
  constructor(private readonly service: LearningElectiveChangeService) {}
  @Get("options") options(@Req() req: AuthenticatedRequest, @Query("source_offering_id") offeringId: string, @Query("person_id") personId: string) { return this.service.options(req.authUser, offeringId, personId); }
  @Post("preview") @HttpCode(200) preview(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.service.preview(req.authUser, body); }
  @Post() @HttpCode(200) request(@Req() req: AuthenticatedRequest, @Body() body: unknown) { writable(req); return this.service.request(req.authUser, body); }
  @Get(":id") detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.detail(req.authUser, id); }
  @Get(":id/confirmation") confirmation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("command_id") commandId: string, @Query("action") action: string) { return this.service.confirmation(req.authUser, id, commandId, action); }
  @Post(":id/finance-assignment") @HttpCode(200) assign(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { writable(req); return this.service.assignFinance(req.authUser, id, body); }
  @Post(":id/apply") @HttpCode(200) apply(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { writable(req); return this.service.apply(req.authUser, id, body); }
  @Post(":id/withdraw") @HttpCode(200) withdraw(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) { writable(req); return this.service.withdraw(req.authUser, id, body); }
}
@Controller("api/v1/schools/:schoolId/fees/elective-reviews")
export class LearningElectiveFinanceController {
  constructor(private readonly service: LearningElectiveChangeService) {}
  @Get(":id") read(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.service.financeWorkspace(req.authUser, schoolId, id); }
  @Get(":id/confirmation") confirmation(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Query("command_id") commandId: string) { return this.service.confirmation(req.authUser, id, commandId, "finance.classify", schoolId); }
  @Post(":id/decision") @HttpCode(200) decide(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Body() body: unknown) { writable(req); return this.service.classify(req.authUser, schoolId, id, body); }
}
