import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { InstitutionSetupService } from "./institution-setup.service.js";

@Controller("api/v1/schools/:schoolId/institution-setup")
export class InstitutionSetupController {
  constructor(private readonly setup: InstitutionSetupService) {}

  @Get("/")
  workspace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.setup.workspace(request.authUser, schoolId);
  }

  @Post("campuses/")
  createCampus(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.setup.createCampus(request.authUser, schoolId, body, request);
  }

  @Patch("campuses/:campusId/")
  updateCampus(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("campusId") campusId: string, @Body() body: unknown) {
    return this.setup.updateCampus(request.authUser, schoolId, campusId, body, request);
  }

  @Post("spaces/")
  createSpace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.setup.createSpace(request.authUser, schoolId, body, request);
  }

  @Patch("spaces/:spaceId/")
  updateSpace(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("spaceId") spaceId: string, @Body() body: unknown) {
    return this.setup.updateSpace(request.authUser, schoolId, spaceId, body, request);
  }

  @Post("assets/")
  createAsset(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.setup.createAsset(request.authUser, schoolId, body, request);
  }

  @Post("resource-types/")
  createResourceType(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.setup.createResourceType(request.authUser, schoolId, body, request);
  }

  @Patch("resource-types/:resourceTypeId/")
  updateResourceType(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("resourceTypeId") resourceTypeId: string, @Body() body: unknown) {
    return this.setup.updateResourceType(request.authUser, schoolId, resourceTypeId, body, request);
  }

  @Patch("assets/:assetId/")
  updateAsset(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("assetId") assetId: string, @Body() body: unknown) {
    return this.setup.updateAsset(request.authUser, schoolId, assetId, body, request);
  }

  @Patch("classes/:classSectionId/location/")
  @HttpCode(200)
  placeClass(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("classSectionId") classSectionId: string, @Body() body: unknown) {
    return this.setup.placeClass(request.authUser, schoolId, classSectionId, body, request);
  }

  @Post("staff/:staffProfileId/campus/")
  @HttpCode(200)
  placeStaff(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("staffProfileId") staffProfileId: string, @Body() body: unknown) {
    return this.setup.placeStaff(request.authUser, schoolId, staffProfileId, body, request);
  }

  @Post("observation-sources/")
  registerObservationSource(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.setup.registerObservationSource(request.authUser, schoolId, body, request);
  }

  @Patch("observation-sources/:sourceId/status/")
  setObservationSourceStatus(@Req() request: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("sourceId") sourceId: string, @Body() body: unknown) {
    return this.setup.setObservationSourceStatus(request.authUser, schoolId, sourceId, body, request);
  }
}
