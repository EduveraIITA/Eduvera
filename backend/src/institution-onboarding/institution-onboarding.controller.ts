import { Controller, Get, Patch, Post, Put, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { InstitutionOnboardingService } from "./institution-onboarding.service.js";

@Controller("api/v1/onboarding")
export class InstitutionOnboardingController {
  constructor(private readonly onboarding: InstitutionOnboardingService) {}

  @Get("workspace/")
  workspace(@Req() request: AuthenticatedRequest) {
    return this.onboarding.workspace(request.authUser);
  }

  @Post("workspace/")
  provisionWorkspace(@Req() request: AuthenticatedRequest) {
    return this.onboarding.provision(request.authUser, request.sessionHash, request.body, request);
  }

  @Put("goals/")
  goals(@Req() request: AuthenticatedRequest) {
    return this.onboarding.setGoals(request.authUser, request.body, request);
  }

  @Patch("resume/")
  resume(@Req() request: AuthenticatedRequest) {
    return this.onboarding.setResume(request.authUser, request.body, request);
  }

  @Patch("workspace-profile/")
  profile(@Req() request: AuthenticatedRequest) {
    return this.onboarding.setProfile(request.authUser, request.body, request);
  }

  @Post("institution-applications/")
  submitInstitution(@Req() request: AuthenticatedRequest) {
    return this.onboarding.submitFormal(request.authUser, request.body, request);
  }

}
