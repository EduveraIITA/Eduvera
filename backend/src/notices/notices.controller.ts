import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { NoticesService } from "./notices.service.js";

@ApiTags("notices")
@ApiCookieAuth()
@Controller("api/v1/notices")
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get("references")
  @RequirePermission("messages.send")
  references(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.notices.references(request.authUser, query);
  }

  @Get()
  @RequirePermission("messages.view")
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.notices.list(request.authUser, query);
  }

  @Get(":id")
  @RequirePermission("messages.view")
  detail(@Req() request: AuthenticatedRequest, @Param("id") id: string,
    @Query() query: Record<string, string | undefined>) {
    return this.notices.detail(request.authUser, id, query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission("messages.send")
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notices.create(request, body);
  }

  @Patch(":id")
  @RequirePermission("messages.send")
  update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.update(request, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("messages.send")
  publish(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.publish(request, id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("messages.send")
  cancel(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.cancel(request, id, body);
  }

  @Post(":id/open")
  @HttpCode(200)
  @RequirePermission("messages.view")
  open(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.open(request, id, body);
  }

  @Post(":id/respond")
  @HttpCode(200)
  @RequirePermission("messages.view")
  respond(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.respond(request, id, body);
  }

  @Post(":id/assisted-responses")
  @HttpCode(200)
  @RequirePermission("messages.send")
  assistedResponse(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.assistedResponse(request, id, body);
  }

  @Post(":id/deliveries")
  @HttpCode(200)
  @RequirePermission("messages.send")
  recordDelivery(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.notices.recordDelivery(request, id, body);
  }
}
