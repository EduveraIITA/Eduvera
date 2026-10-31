import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { ProgressiveSetupService } from "./progressive-setup.service.js";

@Controller("api/v1/schools/:schoolId/get-started")
@RequirePermission("sis.manage")
export class ProgressiveSetupController {
  constructor(private readonly setup: ProgressiveSetupService) {}

  @Get("/")
  workspace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.setup.workspace(request.authUser, schoolId);
  }

  @Post(":capability/")
  configure(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("capability") capability: string) {
    return this.setup.setup(request.authUser, schoolId, capability, request.body, request);
  }
}
