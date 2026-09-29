import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { CoordinationService } from "./coordination.service.js";

@ApiTags("coordination")
@ApiCookieAuth()
@Controller("api/v1/coordination/follow-ups")
export class CoordinationController {
  constructor(private readonly coordination: CoordinationService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string>) {
    return this.coordination.list(req.authUser, query);
  }

  @Get(":id")
  detail(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("context") context?: string) {
    return this.coordination.detail(req.authUser, id, context);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: AuthenticatedRequest) {
    return this.coordination.create(req, req.body);
  }

  @Post(":id/entries")
  @HttpCode(200)
  respond(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.coordination.respond(req, id, req.body);
  }
}
