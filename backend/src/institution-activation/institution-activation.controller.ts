import { Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { InstitutionActivationService } from "./institution-activation.service.js";

@Controller("api/v1/schools/:schoolId/activation")
@RequirePermission("sis.manage")
export class InstitutionActivationController {
  constructor(private readonly activation: InstitutionActivationService) {}

  @Get("/")
  workspace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.activation.workspace(request.authUser, schoolId);
  }

  @Post("quick-start/")
  quickStart(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.activation.quickStart(request.authUser, schoolId, request.body, request);
  }

  @Post("review/")
  @HttpCode(200)
  review(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.activation.review(request.authUser, schoolId, request);
  }

  @Post("activate/")
  @HttpCode(200)
  activate(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.activation.activate(request.authUser, schoolId, request.body, request);
  }
}
