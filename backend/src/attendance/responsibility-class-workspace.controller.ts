import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ResponsibilityClassWorkspaceService } from "./responsibility-class-workspace.service.js";

@Controller("api/v1/areas/people/classes")
export class ResponsibilityClassWorkspaceController {
  constructor(private readonly classes: ResponsibilityClassWorkspaceService) {}

  @Get()
  directory(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.classes.classes(
      request.authUser,
      request.executionEnvironment,
      request.executionEnvironmentView,
      date,
    );
  }

  @Get("updates/")
  updates(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.classes.updates(
      request.authUser,
      request.executionEnvironment,
      request.executionEnvironmentView,
      date,
    );
  }

  @Get(":classSectionId/")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("classSectionId") classSectionId: string,
    @Query("date") date?: string,
  ) {
    return this.classes.classDetail(
      request.authUser,
      request.executionEnvironment,
      request.executionEnvironmentView,
      classSectionId,
      date,
    );
  }
}
