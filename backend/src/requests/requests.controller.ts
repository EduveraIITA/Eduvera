import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequestsService } from "./requests.service.js";

@ApiTags("requests")
@ApiCookieAuth()
@Controller("api/v1/requests")
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  inbox(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.requests.inbox(request.authUser, query);
  }
}
