import { RequirePermission } from "../roles/permissions.js";
import { Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { AiService } from "./ai.service.js";

@ApiTags("attendance-copilot")
@ApiCookieAuth()
@Controller("api/v1/ai")
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post("attendance/query/")
  @HttpCode(200)
  @RequirePermission("ai.use")
  query(@Req() request: AuthenticatedRequest) {
    return this.ai.query(request.authUser, request.body, request);
  }
}
