import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { OrganizationService } from "./organization.service.js";

@Controller("api/v1/schools/:schoolId/organization")
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  workspace(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
  ) {
    return this.organization.workspace(request.authUser, schoolId);
  }

  @Put()
  save(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") schoolId: string,
    @Body() body: unknown,
  ) {
    return this.organization.save(request.authUser, schoolId, body);
  }
}
