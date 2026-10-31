import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { FeeAuthorityService } from "./fee-authority.service.js";

@Controller("api/v1/schools/:schoolId/governance/fee-authority")
export class FeeAuthorityController {
  constructor(private readonly authority: FeeAuthorityService) {}
  @Get("/") workspace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("command_id") commandId?: string) {
    return this.authority.workspace(request.authUser, schoolId, commandId);
  }
  @Post("confirm/") confirm(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.authority.confirm(request.authUser, schoolId, body);
  }
}
