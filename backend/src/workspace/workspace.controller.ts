import { Controller, Get, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("api/v1/workspace")
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  manifest(@Req() request: AuthenticatedRequest) {
    return this.workspace.manifest(
      request.authUser,
      request.executionEnvironment,
      request.executionEnvironmentView,
    );
  }
}
