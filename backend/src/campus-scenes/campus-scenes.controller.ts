import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusScenesService } from "./campus-scenes.service.js";

@Controller("api/v1/schools/:schoolId/campus-scenes")
export class CampusSceneDirectoryController {
  constructor(private readonly scenes: CampusScenesService) {}
  @Get("/")
  directory(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
  ) {
    return this.scenes.directory(request.authUser, school);
  }
}

@Controller("api/v1/schools/:schoolId/campus-scenes/:campusId")
export class CampusScenesController {
  constructor(private readonly scenes: CampusScenesService) {}
  @Get("resources/")
  resources(@Req() request: AuthenticatedRequest, @Param("schoolId") school: string, @Param("campusId") campus: string, @Query() query: unknown) {
    return this.scenes.resources(request.authUser, school, campus, query);
  }
  @Get("resource-states/")
  resourceStates(@Req() request: AuthenticatedRequest, @Param("schoolId") school: string, @Param("campusId") campus: string) {
    return this.scenes.resourceStates(request.authUser, school, campus);
  }
  @Get("published/")
  published(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
  ) {
    return this.scenes.published(request.authUser, school, campus);
  }
  @Get("workspace/")
  workspace(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
  ) {
    return this.scenes.workspace(request.authUser, school, campus);
  }
  @Put("draft/")
  save(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
    @Body() body: unknown,
  ) {
    return this.scenes.saveDraft(request.authUser, school, campus, body);
  }
  @Post("publish/")
  @HttpCode(200)
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
    @Body() body: unknown,
  ) {
    return this.scenes.publish(request.authUser, school, campus, body);
  }
  @Post("reviewed-places/")
  @HttpCode(200)
  reviewedPlaces(@Req() request: AuthenticatedRequest, @Param("schoolId") school: string, @Param("campusId") campus: string, @Body() body: unknown) {
    return this.scenes.saveReviewedPlaces(request.authUser, school, campus, body, request);
  }
  @Post("reopen/")
  @HttpCode(200)
  reopen(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
    @Body() body: unknown,
  ) {
    return this.scenes.reopen(request.authUser, school, campus, body);
  }
  @Post("images/")
  image(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
    @Body() body: unknown,
  ) {
    return this.scenes.uploadImage(request.authUser, school, campus, body);
  }
  @Get("images/:imageId/")
  async readImage(
    @Req() request: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("campusId") campus: string,
    @Param("imageId") id: string,
    @Res() reply: FastifyReply,
  ) {
    const image = await this.scenes.readImage(
      request.authUser,
      school,
      campus,
      id,
    );
    return reply
      .header("Content-Type", image.mime_type)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(image.bytes);
  }
}
