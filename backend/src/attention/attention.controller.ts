import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { AttentionService } from "./attention.service.js";

@ApiTags("attention")
@ApiCookieAuth()
@Controller("api/v1/attention")
export class AttentionController {
  constructor(private readonly attention: AttentionService) {}

  @Get()
  inbox(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.attention.inbox(request.authUser, query);
  }
}
